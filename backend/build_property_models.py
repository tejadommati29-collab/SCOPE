"""One-time developer script: train one SVR per 'other feature' on YOUR dataset and save them in backend/builtin_models/props.joblib.
Used by the 'Predict using SVR' button on the Predict Single Cathode page.

    cd backend
    python build_property_models.py path/to/your_dataset.xlsx

Material properties (Gap, Oxygen-vacancy energy, Work function, log dielectric, O p-band centre) are constant for a composition, so they are learned
from the 15 formula descriptors, one row per composition. Ehull and TEC are learned from the 15 descriptors + those 5 properties (they are inputs of the
log k* model). Bulk ionic conductivity, total electronic conductivity and ASR change with temperature, so they are learned (as log10) from the 15
descriptors + 1000/T.
Every score is a cross-validated R2 in which a composition is never in both the training and the validation part."""
import sys, json, warnings
from pathlib import Path
import numpy as np, pandas as pd, joblib
from sklearn.pipeline import Pipeline
from sklearn.preprocessing import StandardScaler
from sklearn.svm import SVR
from sklearn.model_selection import GridSearchCV, GroupKFold
from sklearn.metrics import r2_score, mean_absolute_error
warnings.filterwarnings("ignore")

OUT = Path(__file__).resolve().parent / "builtin_models"
BASIC = ["Ion_A", "Ion_B", "EN_A", "EN_B", "R_A", "R_B", "Sa_A", "Sa_B", "Delec_B", "t", "Ionic_A", "Ionic_B", "Avg_Ionic_Character", "SmithAcid_A", "SmithAcid_B"]
FORMULA = "Material composition"
P5 = ["Work_Function", "O_pband", "Log_dieletric", "Oxide_vacancy", "Gap"]
# key -> (dataset column, feature set: "d" = 15 descriptors, "dt" = + 1000/T, "dp" = + the 5 material properties, log10 target)
TARGETS = {
    "Gap": ("Gap", "d", False), "Oxide_vacancy": ("Oxide_vacancy", "d", False), "Work_Function": ("Work_Function", "d", False),
    "Log_dieletric": ("Log_dieletric", "d", False), "O_pband": ("O_pband", "d", False),
    "E_above_hull": ("E_above_hull", "dp", False), "TEC": ("TEC", "dp", False),
    "Bulk_Ionic": ("Bulk_Ionic_Conductivity_S_cm", "dt", True), "Total_Electronic": ("Total_Electronic_Conductivity_S_cm", "dt", True), "ASR": ("ASR_Ohm_cm2", "dt", True)}
GRID = {"svr__C": [0.3, 1, 3, 10, 30, 100], "svr__epsilon": [0.01, 0.05, 0.1, 0.2], "svr__gamma": ["scale", 0.003, 0.01, 0.03, 0.1]}


def pipe(): return Pipeline([("sc", StandardScaler()), ("svr", SVR(kernel="rbf"))])


def tune(X, y, g, seed=0):
    k = min(5, len(set(g)))
    gs = GridSearchCV(pipe(), GRID, cv=GroupKFold(k), scoring="neg_mean_squared_error", n_jobs=-1)
    gs.fit(X, y, groups=g); return gs.best_estimator_, gs.best_params_


def nested_cv(X, y, g, reps=3):
    """Outer grouped CV (tuning is repeated inside each training part) - an honest estimate for compositions the model has never seen."""
    pred = np.zeros(len(y)); r2s = []
    ug = np.array(sorted(set(g)))
    for rep in range(reps):
        rng = np.random.RandomState(rep); perm = rng.permutation(len(ug)); fold = {gg: i % 5 for i, gg in zip(range(len(ug)), ug[perm])}
        f = np.array([fold[x] for x in g]); p = np.zeros(len(y))
        for k in range(5):
            tr, te = f != k, f == k
            m, _ = tune(X[tr], y[tr], g[tr]); p[te] = m.predict(X[te])
        r2s.append(r2_score(y, p)); pred += p / reps
    return float(np.mean(r2s)), float(mean_absolute_error(y, pred))


def main(path):
    raw = pd.read_excel(path, sheet_name=0) if not str(path).lower().endswith(".csv") else pd.read_csv(path)
    raw.columns = [str(c).strip() for c in raw.columns]
    OUT.mkdir(parents=True, exist_ok=True)
    comp = raw.drop_duplicates(FORMULA).reset_index(drop=True)          # one row per composition for the material properties
    models, meta = {}, {}
    for key, (col, fs, lg) in TARGETS.items():
        d = raw if fs == "dt" else comp
        feats = BASIC + (["1000/T"] if fs == "dt" else P5 if fs == "dp" else [])
        X = d[feats].astype(float).values; y = d[col].astype(float).values; g = d[FORMULA].values
        if lg: y = np.log10(np.clip(y, 1e-12, None))
        m, bp = tune(X, y, g); r2, mae = nested_cv(X, y, g)
        m.fit(X, y); models[key] = {"model": m, "features": feats, "log10": lg}
        meta[key] = {"column": col, "features": len(feats), "log10": lg, "rows": int(len(d)), "compositions": int(d[FORMULA].nunique()),
                     "cv_R2": round(r2, 3), "cv_MAE": round(mae, 4), "params": {k: (v if isinstance(v, str) else float(v)) for k, v in bp.items()},
                     "min": float(np.min(y)), "max": float(np.max(y))}
        print(f"{key:18s} rows {len(d):3d} | CV R2 {r2:6.3f} | MAE {mae:.4f}{' (log10)' if lg else ''} | {bp}", flush=True)
    rng = {c: [float(raw[c].min()), float(raw[c].max())] for c in BASIC + P5 + ["1000/T"]}
    models["_meta"] = {"ranges": rng, "dataset": Path(path).name}
    joblib.dump(models, OUT / "props.joblib", compress=3)
    (OUT / "props_meta.json").write_text(json.dumps({"targets": meta, "dataset": Path(path).name}, indent=1))
    print("Saved", OUT / "props.joblib")


if __name__ == "__main__":
    if len(sys.argv) != 2: sys.exit(__doc__)
    main(sys.argv[1])
