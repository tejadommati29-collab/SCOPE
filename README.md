# SCOPE (NGIT)
Dataset-based batch screening following *Deng et al., "Machine-Learning-Based Screening of Perovskite Cathodes for Low-Temperature SOFC Operation", Crystals 2026, 16, 68*.
Stack (all free): Python · Flask · scikit-learn · SQLite · vanilla HTML/CSS/JS.

## Run locally (free)
```
pip install -r requirements.txt
python backend/app.py
```
Then open http://localhost:5000
Login: use **Create account** to register a username (3–30 letters/digits/`.`/`_`/`@`/`-`) and password; a taken username shows "Use another username". Then **Log in**: an unknown username shows "Account not found. Please create a new account", a wrong password shows "Incorrect password". Passwords are saved hashed, and the admin page lists every registered username.

## Free hosting
* **PythonAnywhere (free)** – recommended: persistent disk, so SQLite DB, uploads and models survive. Upload the folder, create a Flask web app, point WSGI to `backend/wsgi.py`, `pip install -r requirements.txt`.
* **Render free web service** – works (`Procfile` included) but its free disk is **ephemeral**: data is lost on redeploy/restart. Use only for demos.
* Set `STORAGE_DIR` to change where `app.db`, `uploads/` and `models/` are kept; set `SECRET_KEY` env vars for deployment.

## What it does
Upload CSV/XLSX → auto column detection (editable) → all usable descriptors from the paper's list, basic + enhanced + 1000/T (unavailable ones are dropped, never invented; no feature selection) →
Pipeline(median imputer → StandardScaler → model) → grouped 5-fold CV GridSearchCV for the **SVR** (the only classical model; KNN/MLP/RF/GBR were removed to save training time) →
predict log10(k*) and k*=10^x for every cathode → Mahalanobis AD (0.8 quantile of training distances) → Ehull ≤ 57 meV/atom → log10(k*) ≥ −6.40 (*LSC benchmark used in the research paper*) →
PASS / FAIL / NOT FULLY EVALUABLE → top-5 candidate cards, screening funnel, log10(k*)-vs-Ehull scatter plot, filters, details modal, Shapley feature contributions, Excel/CSV export. Everything is saved per roll number in SQLite + disk.

## Where your data is stored
In `~/.perovskite_screening` (Windows: `C:\Users\<you>\.perovskite_screening`), outside the code folder, so unzipping a new version never wipes your history. An older `pcs/storage` folder is copied there automatically on first start. Login is a per-tab session: the login page appears every time you open the app fresh.

## Honest limitations (please read)
* **Cost is now an automatic estimate, not a filter.** From each cathode's formula the app works out the moles of every precursor (e.g. La2O3, SrCO3, MnO2), converts them to grams, multiplies by the price per kg (99 % purity basis), adds the costs and divides by the theoretical mass of cathode times the synthesis yield (95 %, `COST_YIELD_PERCENT`; small excess for Li/Na/K/Bi/Pb). The result is an **estimated USD per kg of cathode**, shown with a **Cheap / Moderate / Expensive** level (cheapest / middle / dearest third of the screened cathodes). It does **not** change PASS / FAIL. Prices are built-in approximate estimates (`DEFAULT_ROWS` in `backend/cost.py`, not live quotes). To override an element, edit `precursor_prices.csv` in the data folder by hand (columns: element, precursor, price_per_kg, purity_percent, pack_size_g); it is re-read automatically.
* **Not an exact reproduction**: the paper's Arrhenius-normalised dataset, Table S2 hyper-parameters, and RF-generated enhanced descriptors are not available. Enhanced columns (Gap, TEC, O_pband …) are ordinary SVR inputs. Ehull is taken from your column.
* Hyper-parameter grids are deliberately small so training finishes in about a minute; .
* The AD threshold is the 0.8 quantile of the *training* distances, so ~20 % of your own cathodes are outside by construction.
* Predictions for uploaded rows come from a model trained on those rows (in-sample); the cross-validated value is shown in each cathode's details.
* Same formula (e.g. `La0.6Sr0.4CoO3` = `La0.6Sr0.4Co1O3`) is counted once; the same dataset uploaded twice is stored once.
* Column abbreviations (`Sa`, `Ionic`, `Ion`) follow the paper's Fig. 3 labels. Shapley values use a built-in Monte-Carlo estimator, not the `shap` package.
* Shared-password login (stored hashed, 7-day tokens, no rate limiting) – fine for a college project, not for the open internet.

## Best in category
* **Best in category** (results page + export): among the PASS cathodes only, the most stable (lowest Ehull), lowest estimated cost, most active (highest predicted log10(k*)) and most balanced (lowest rank-sum of the three ranks). Ties are listed, and a category whose criterion is missing is skipped with a note. Only values already in the results are used.

## Built-in SVR (no upload / training for first-time users)
The **Predict Single Cathode** page works immediately for every new user: just predict. The SVR is trained once on your dataset and shipped *inside the code folder* (`backend/builtin_models/`), so it survives re-deploys (also on Render's ephemeral disk).
To create / refresh it (run once on your computer, then zip or deploy the whole folder):
```
pip install -r requirements.txt
cd backend
python build_builtin_models.py path/to/your_dataset.xlsx
```
This writes `svr_pipeline.joblib` and `meta.json` to `backend/builtin_models/`. The model uses the full descriptor set (basic + enhanced + 1000/T). Keep the library versions in `requirements.txt` the same on the server as on the machine that built the model (joblib files are version-sensitive).

**Status:** `backend/builtin_models/` contains the SVR trained on `SCOPE_Master_Combined_Dataset.xlsx` (1636 rows, 23 descriptors; test R² 0.89, CV R² 0.89).

**Predict using SVR (other features).** `python build_property_models.py path/to/dataset.xlsx` trains one SVR per extra feature (band gap, O-vacancy energy, work function, log dielectric, O p-band centre from the 15 formula descriptors; Ehull and TEC from the 15 descriptors + those 5 properties; bulk ionic conductivity, total electronic conductivity and ASR as log10 from the descriptors + 1000/T) and saves `props.joblib` + `props_meta.json`. Scores are grouped cross-validated R².


## Predict single cathode: how the verdict is made
All 23 model inputs are used: the 15 formula descriptors, the 5 material properties, 1000/T (from the temperature in °C) and Ehull + TEC, which are predicted by SVR first. PASS needs all three: TEC ≤ 15 ×10⁻⁶ K⁻¹ (user-set; the paper has no TEC limit), Ehull ≤ 57 meV/atom and log10(k*) ≥ −6.40 (paper limits). Applicability domain (Mahalanobis) and the cost estimate are shown for information and do not affect PASS / FAIL on this page.


## Dataset screening (new): temperature + Screen, same logic as Predict Single Cathode
On the **Upload Dataset** tab choose a CSV/XLSX of cathode formulas, type the operating **temperature (°C)** and press **Screen**. Nothing is trained: every cathode goes through the Predict-page pipeline with the built-in models (`backend/screening.py`):
1. formula recognised (A-site / B-site / oxygen, same checks as the page - `backend/formula_desc.py` is a port of `formula.js` + `descriptors.js`, cross-checked against the JS);
2. the 15 descriptors: the dataset's own column if it has one, otherwise **calculated from the formula**;
3. 1000/T from the temperature box;
4. the 5 properties (Gap, O-vacancy energy, work function, log dielectric, O p-band): dataset column if present, otherwise **predicted by SVR**;
5. **Ehull and TEC predicted** by SVR, then **log10(k\*) predicted** by the built-in SVR from all 23 inputs.
**Funnel / PASS filters (only these three):** TEC <= 15 x1e-6 1/K -> log10(k*) >= -6.40 -> Ehull <= 57 meV/atom. Applicability domain and cost are shown for information only. A cathode whose formula is not recognised, or whose element has no descriptor data and no dataset column, is listed as NOT EVALUABLE with the reason (never guessed). Results are identical to the Predict page for the same formula and temperature.
Older datasets screened with the previous train-on-upload flow still open normally.

## Units (shown everywhere)
Every input, output and filter carries its unit in the app (Predict page fields, model-input tables, results table, filters, funnel, detail pop-ups, 3D panel, admin Model details) and in the Excel/CSV export (column names and a "Units" line in the Notes sheet). The single source of truth is `frontend/units.js` (mirrored in `backend/units.py` for exports / admin) - edit both to change a unit.
| Quantity | Unit |
|---|---|
| Valence-electron ionization energy (A, B) · Band gap · Work function · O p-band centre · O-vacancy formation energy | eV |
| Shannon ionic radius (A, B) | Å |
| Ionic Lewis acidity Sa (A, B) | v.u. (valence units) |
| B-site d-electron count | electrons |
| Electronegativity · tolerance factor · ionicity indices · average ionic character · Smith acidity · log dielectric constant · Mahalanobis distance | no unit (left blank) |
| Temperature | °C (model input 1000/T in 10³ K⁻¹) |
| Bulk ionic / total electronic conductivity | S/cm |
| ASR | Ω·cm² |
| **Outputs** TEC · Ehull · k* · log10(k*) · cost | ×10⁻⁶ K⁻¹ · meV/atom · cm/s · log₁₀(cm/s) · USD/kg |
| **Filters** TEC ≤ 15 · log10(k*) ≥ −6.40 · Ehull ≤ 57 | ×10⁻⁶ K⁻¹ · log₁₀(cm/s) · meV/atom |

## Element tables (formula -> 15 descriptors)
`frontend/descriptors.js` and `backend/formula_desc.py` (keep both identical) hold the per-element values, now calibrated on `SCOPE_Master_Combined_Dataset.xlsx`:
12 A-site elements (Ba Bi Ca Cs Dy Gd La Nd Pr Rb Sm Sr) and 21 B-site elements (Al Ce Co Cr Cu Fe Ga Hf In Mg Mn Mo Nb Ni Sb Sc Sn Ti Y Zn Zr).
Checked against the dataset: 329 of 334 compositions are reproduced to within rounding (max error 5e-4). The 5 exceptions are dataset quirks, not table errors:
the four `LnBaCo2O5` layered double perovskites (the dataset counts Ba on the B-site) and `Ba0.5Zn0.5Fe0.2Ti0.4Cu0.4O3` (Zn counted on the A-site); the app flags these as non-ABO3 anyway.
Hf, In, Sn (1 composition each) and Sb, Mg, Ce (2-3) are determined from very few rows, and Y has the same EN / R values as Zr in the dataset, so treat those elements with care.
