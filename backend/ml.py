"""ML core: column detection, preprocessing, model comparison, SVR primary model,
Mahalanobis applicability domain, Shapley explanations and paper-based screening.
Nothing here invents data: missing descriptors / screening columns are reported, never filled."""
import os, re, warnings, contextlib, threading
import numpy as np, pandas as pd
from sklearn.base import clone
from sklearn.pipeline import Pipeline
from sklearn.preprocessing import StandardScaler
from sklearn.impute import SimpleImputer
from sklearn.svm import SVR
from sklearn.model_selection import GroupKFold, GroupShuffleSplit, GridSearchCV
from sklearn.metrics import r2_score, mean_absolute_error

warnings.filterwarnings("ignore")
# ---- live progress: app.py installs a callback per request thread; the training code reports what it is doing ----
_tl = threading.local()
def say(msg, detail=""):
    cb = getattr(_tl, "cb", None)
    if cb:
        try: cb(msg, detail)
        except Exception: pass

EHULL_LIMIT = 57.0      # meV/atom, LSC value used in the paper
TEC_LIMIT = 15.0        # x1e-6 1/K: thermal-expansion criterion (set by the user for the Predict page)
ORR_LIMIT = -6.40       # log10(k*) of LSC, "LSC benchmark used in the research paper"
AD_QUANTILE = 0.8       # paper: empirical quantile threshold 0.8


def norm(s): return re.sub(r"[^a-z0-9]", "", str(s).lower())

# key, group, label (paper wording; A/B abbreviations follow paper Fig. 3 naming), aliases (normalised)
DESC = [
 ("Ion_A", "basic", "Valence-electron ionization energy, A-site", ["iona"]),
 ("Ion_B", "basic", "Valence-electron ionization energy, B-site", ["ionb"]),
 ("EN_A", "basic", "Site-averaged electronegativity, A-site", ["ena"]),
 ("EN_B", "basic", "Site-averaged electronegativity, B-site", ["enb"]),
 ("R_A", "basic", "Shannon ionic radius, A-site", ["ra"]),
 ("R_B", "basic", "Shannon ionic radius, B-site", ["rb"]),
 ("Sa_A", "basic", "Ionic Lewis acidity, A-site", ["saa"]),
 ("Sa_B", "basic", "Ionic Lewis acidity, B-site", ["sab"]),
 ("Delec_B", "basic", "B-site d-electron count", ["delecb"]),
 ("t", "basic", "Goldschmidt tolerance factor", ["t", "tolerancefactor"]),
 ("Ionic_A", "basic", "Ionicity index, A-site", ["ionica"]),
 ("Ionic_B", "basic", "Ionicity index, B-site", ["ionicb"]),
 ("Avg_Ionic_Character", "basic", "Average ionic character (ionicity)", ["avgioniccharacter"]),
 ("SmithAcid_A", "basic", "Smith acidity, A-site", ["smithacida"]),
 ("SmithAcid_B", "basic", "Smith acidity, B-site", ["smithacidb"]),
 ("1000/T", "temperature", "Inverse absolute temperature (1000/T)", ["1000t", "invt", "inverset"]),
 ("Gap", "enhanced", "Band gap", ["gap", "bandgap"]),
 ("Oxide_vacancy", "enhanced", "Oxygen-vacancy formation energy", ["oxidevacancy", "ovacancy"]),
 ("E_above_hull", "enhanced", "Ehull (energy above hull)", ["eabovehull", "ehull", "energyabovehull"]),
 ("TEC", "enhanced", "Thermal expansion coefficient (TEC)", ["tec"]),
 ("Work_Function", "enhanced", "Work function", ["workfunction"]),
 ("Log_dieletric", "enhanced", "Log dielectric constant", ["logdieletric", "logdielectric"]),
 ("O_pband", "enhanced", "O p-band center", ["opband", "opbandcenter"]),
]
FORMULA_AL = ["materialcomposition", "formula", "chemicalformula", "composition", "cathode", "material", "compound", "name", "id"]
TARGET_AL = ["logkstar", "logk", "log10kstar", "log10k"]
RAWK_AL = ["kstar", "k"]
EHULL_AL = ["eabovehull", "ehull", "energyabovehull"]
TEMP_AL = ["temperature", "temp", "tc", "tk", "tcelsius"]


def load_df(raw):
    """Clean uploaded frame. Returns (df, info). Coerces numeric-looking columns, drops empty/duplicate rows."""
    info = {"raw_rows": len(raw), "invalid": {}, "empty_dropped": 0, "dup_dropped": 0}
    df = raw.copy()
    df.columns = [str(c).strip() for c in df.columns]
    # ---- automatic clean-up of whatever file the user uploads (no manual editing needed) ----
    junk = {"", "-", "--", "—", "na", "n/a", "nan", "none", "null", "nil", "#n/a"}
    for c in df.columns:
        if not pd.api.types.is_numeric_dtype(df[c]) and not pd.api.types.is_bool_dtype(df[c]):                                    # trim spaces / non-breaking spaces, blank-like text -> empty
            df[c] = df[c].map(lambda v: (lambda t: np.nan if t.lower() in junk else t)(re.sub(r"\s+", " ", v.replace("\u00a0", " ")).strip()) if isinstance(v, str) else v)
    df = df.dropna(axis=1, how="all")                                # empty / 'Unnamed' columns
    df = df.dropna(how="all")                                        # empty rows
    info["empty_dropped"] = info["raw_rows"] - len(df)
    for c in df.columns:
        if not pd.api.types.is_numeric_dtype(df[c]) and not pd.api.types.is_bool_dtype(df[c]):
            num = pd.to_numeric(df[c], errors="coerce")
            if num.notna().sum() >= 0.5 * df[c].notna().sum() and num.notna().sum() > 0:
                bad = int((df[c].notna() & num.isna()).sum())
                if bad: info["invalid"][c] = bad
                df[c] = num
    key = df.copy()                                                  # exact-same rows: compared after trimming + rounding float noise
    for c in key.columns:
        if pd.api.types.is_numeric_dtype(key[c]): key[c] = key[c].round(9)
    dup = key.duplicated(keep="first")
    info["dup_dropped"] = int(dup.sum())
    df = df[~dup.to_numpy()].reset_index(drop=True)
    return df, info


def is_const(s):
    """True for constant or numerically constant columns (e.g. 1000/T identical for every row up to float noise)."""
    v = pd.to_numeric(s, errors="coerce").dropna()
    return len(v) == 0 or float(v.max() - v.min()) <= 1e-6 * max(1.0, float(abs(v).max()))


def _find(cols, aliases):
    for c in cols:
        if norm(c) in aliases: return c
    return None


def analyze(df, info):
    cols = list(df.columns)
    num_cols = [c for c in cols if pd.api.types.is_numeric_dtype(df[c])]
    formula = _find(cols, FORMULA_AL)
    if formula is None:
        obj = [c for c in cols if c not in num_cols]
        formula = max(obj, key=lambda c: df[c].nunique(), default=None)
    target = _find(num_cols, TARGET_AL)
    target_note = None
    if target is None:
        rk = _find(num_cols, RAWK_AL)
        if rk is not None and (df[rk].dropna() > 0).all():
            target, target_note = rk, "Raw k* column detected: log10 will be applied."
    desc, used_cols = [], set()
    for key, grp, label, al in DESC:
        col = _find(cols, al + [norm(key)])
        e = {"key": key, "group": grp, "label": label, "column": col, "present": col is not None, "usable": False, "reason": "Not in dataset"}
        if col is not None:
            used_cols.add(col)
            s = df[col]
            if col not in num_cols: e["reason"] = "Non-numeric"
            elif s.notna().mean() < 0.5: e["reason"] = ">50% missing"
            elif is_const(s): e["reason"] = "Constant value (no information)"
            else: e["usable"], e["reason"] = True, "OK"
        desc.append(e)
    miss = {c: int(df[c].isna().sum()) for c in cols if df[c].isna().any()}
    return {
        "columns": cols, "rows": len(df), "n_columns": len(cols), "missing": miss,
        "duplicates_removed": info["dup_dropped"], "empty_rows_removed": info["empty_dropped"],
        "invalid_numeric": info["invalid"], "target_note": target_note,
        "mapping": {"formula": formula, "target": target, "ehull": _find(num_cols, EHULL_AL),
                    "temperature": _find(num_cols, TEMP_AL) or _find(num_cols, ["1000t"]),
                    "features": [e["column"] for e in desc if e["usable"] and e["group"] != "enhanced"]},
        "descriptors": desc,
        "screening_availability": {"ehull": _find(num_cols, EHULL_AL) is not None},
    }


def target_series(df, mp):
    y = pd.to_numeric(df[mp["target"]], errors="coerce")
    if norm(mp["target"]) in RAWK_AL: y = np.log10(y.where(y > 0))
    return y


def pipe(est): return Pipeline([("imp", SimpleImputer(strategy="median")), ("sc", StandardScaler()), ("m", est)])


# WIDER SVR grid (C up to 1000, gamma down to 0.001, more epsilon values)
SVR_GRID_WIDE = {"m__C": [1, 10, 100, 300, 1000], "m__gamma": ["scale", 0.001, 0.003, 0.01, 0.03, 0.1], "m__epsilon": [0.05, 0.1, 0.2, 0.3]}
N_REPEATS = 2                     # (3) test R2 is also reported as the average over this many different grouped 60:40 splits

def _specs():
    """Only the SVR is tuned and evaluated (KNN / MLP / RF / GBR were removed - they cost a lot of time and were never used for screening)."""
    return {"SVR": (SVR(cache_size=1000), SVR_GRID_WIDE, "grid")}


# ======================================================================================================
#  NEW: grouped validation helpers
#  Each composition appears several times (different temperatures -> different 1000/T), so EVERY split and
#  EVERY cross-validation below is grouped by the composition column: all rows of one composition are always
#  on the same side. Random row-wise splitting is never used.
# ======================================================================================================
N_JOBS = max(1, min(8, os.cpu_count() or 1))
N_FOLDS = 5              # grouped CV folds
TEST_SIZE = 0.40         # 60 : 40 grouped train / test split
SPLIT_SEED = 42
BIG_ROWS = 1500          # above this many TRAINING rows the slow steps use cheaper (still grouped) settings
SHAP_ROWS = 300          # Shapley values are computed on a random sample of this many rows (global importance)
SVR_GRID_SMALL = {"m__C": [1, 10, 100], "m__gamma": ["scale", 0.05], "m__epsilon": [0.1]}


def _par():
    """Run the scikit-learn searches on all CPU cores (threads – works the same on Windows and Linux)."""
    try:
        try: from joblib import parallel_config as _pc
        except ImportError: from joblib import parallel_backend as _pc
        return _pc(backend="threading", n_jobs=N_JOBS)
    except Exception:
        return contextlib.nullcontext()


def _pmap(fn, items):
    """Evaluate fn on every item in parallel threads (falls back to a plain loop if joblib is unavailable)."""
    try:
        from joblib import Parallel, delayed
        return Parallel(n_jobs=N_JOBS, prefer="threads")(delayed(fn)(i) for i in items)
    except Exception:
        return [fn(i) for i in items]


def _search(name, est, grid, kind, cv):
    """Grouped-CV grid search (slow-path fallback for the SVR). cv is a GroupKFold; the composition groups are passed to fit() so folds never split a composition."""
    p = pipe(est); X, y, g = _search.data
    s = GridSearchCV(p, grid, cv=cv, scoring=SCORING, refit="r2")
    s.fit(X, y, groups=g); return s, "GridSearchCV"


SCORING = {"r2": "r2", "mae": "neg_mean_absolute_error"}


def _search_metrics(s):
    """Grouped-CV R2/MAE of the best candidate, read from the search itself (no second CV pass)."""
    cr = getattr(s, "cv_results_", {}); i = s.best_index_
    if "mean_test_mae" not in cr: return None
    return {"R2": float(cr["mean_test_r2"][i]), "R2_std": float(cr["std_test_r2"][i]), "MAE": float(-cr["mean_test_mae"][i]), "MAE_std": float(cr["std_test_mae"][i])}


def _cv_eval(best, X, y, cv, groups):
    """Grouped cross-validation of a fitted pipeline (imputer + scaler + model are re-fitted inside every fold)."""
    oof = np.zeros(len(y)); r2, mae = [], []
    for tr, te in cv.split(X, y, groups):
        m = clone(best).fit(X.iloc[tr], y[tr]); p = m.predict(X.iloc[te]); oof[te] = p
        r2.append(r2_score(y[te], p)); mae.append(mean_absolute_error(y[te], p))
    return oof, {"R2": float(np.mean(r2)), "R2_std": float(np.std(r2)), "MAE": float(np.mean(mae)), "MAE_std": float(np.std(mae))}


def shapley(model, X, bg, T=8, seed=0):
    """Monte-Carlo permutation Shapley values (interventional, background = training rows).
    All coalitions are built and scored in a few large batches (imputer/scaler are element-wise, so substituting
    features in the transformed space gives exactly the same predictions as substituting before the pipeline)."""
    rng = np.random.default_rng(seed); n, p = X.shape
    pre, est = model[:-1], model[-1]
    Xv = np.asarray(pre.transform(X), dtype=float); Bv = np.asarray(pre.transform(bg), dtype=float)
    phi = np.zeros((n, p)); rows = max(1, 60000 // (T * (p + 1)))
    for a in range(0, n, rows):
        b = min(n, a + rows); m = b - a
        start = Bv[rng.integers(len(Bv), size=(m, T))]
        perm = rng.random((m, T, p)).argsort(-1); rank = perm.argsort(-1)
        k = np.arange(p + 1)[None, None, :, None]
        H = np.where(rank[:, :, None, :] < k, Xv[a:b][:, None, None, :], start[:, :, None, :])
        pr = est.predict(H.reshape(-1, p)).reshape(m, T, p + 1)
        ph = np.zeros((m, T, p)); np.put_along_axis(ph, perm, np.diff(pr, axis=2), axis=2)
        phi[a:b] = ph.sum(1) / T
    return phi, float(est.predict(Bv).mean())


def global_shap(model, X, label_map, max_rows=SHAP_ROWS):
    """Global Shapley importance on a random sample of at most `max_rows` rows (background = all rows of X)."""
    bg = X
    if len(X) > max_rows: X = X.iloc[np.sort(np.random.default_rng(0).choice(len(X), max_rows, replace=False))]
    phi, base = shapley(model, X, bg, T=8)
    out = []
    for j, c in enumerate(X.columns):
        v = X[c].values; sd = np.std(v)
        corr = float(np.corrcoef(v, phi[:, j])[0, 1]) if sd > 0 and np.std(phi[:, j]) > 0 else 0.0
        out.append({"feature": c, "label": label_map.get(c, c), "mean_abs": float(np.abs(phi[:, j]).mean()), "mean_signed": float(phi[:, j].mean()),
                    "corr_with_value": corr, "direction": "positive (higher value → higher log k*)" if corr > 0.1 else "negative (higher value → lower log k*)" if corr < -0.1 else "mixed / weak"})
    return sorted(out, key=lambda r: -r["mean_abs"]), base


def _holdout(model, X, y):
    """R2 / MAE (log units) of a fitted model on some data."""
    p = model.predict(X)
    return {"R2": float(r2_score(y, p)), "MAE": float(mean_absolute_error(y, p))}


def _relations(X_tr, y_tr, target_name="log10(k*)"):
    """Pearson correlation and covariance matrices of the training descriptors + the target."""
    t = X_tr.copy(); t[target_name] = y_tr
    clean = lambda m: [[(round(float(v), 4) if np.isfinite(v) else None) for v in row] for row in m.values]
    return {"names": list(t.columns), "target": target_name, "n": int(len(t)), "corr": clean(t.corr()), "cov": clean(t.cov())}


# ======================================================================================================
#  Fast grouped-CV grid search for the SVR (imputer + scaler fitted once per fold)
# ======================================================================================================
class _Folds:
    """SPEED: for every grouped fold the median imputer + StandardScaler are fitted ONCE on that fold's TRAINING rows and applied to all
    columns. Both steps work column by column, so any column subset gives exactly the same numbers as a Pipeline fitted on that subset
    (and still no information leaks from the validation fold). Only the SVR itself is re-fitted for every candidate."""
    def __init__(self, X, y, splits):
        self.ix = {c: i for i, c in enumerate(X.columns)}; self.y = np.asarray(y, dtype=float); self.folds = []; self.ok = True
        A = X.to_numpy(dtype=float)
        for tr, va in splits:
            if np.isnan(A[tr]).all(axis=0).any(): self.ok = False; break          # an all-empty column changes the imputer's output shape -> use the slow path
            imp = SimpleImputer(strategy="median").fit(A[tr]); Tr = imp.transform(A[tr]); sc = StandardScaler().fit(Tr)
            self.folds.append((sc.transform(Tr), sc.transform(imp.transform(A[va])), tr, va))
    def sub(self, cols): return [self.ix[c] for c in cols]


class _FastSearch:
    """Same attributes the sklearn GridSearchCV exposes that the rest of the code reads."""
    def __init__(self, est, params, cr, i): self.best_estimator_, self.best_params_, self.cv_results_, self.best_index_ = est, params, cr, i


def _svr_search_fast(fc, cols, grid, X, y):
    """Exhaustive grouped-CV grid search of the SVR (same grid, same folds, same scores and same tie-breaking as GridSearchCV) - just faster."""
    from sklearn.model_selection import ParameterGrid
    cand = list(ParameterGrid(grid)); idx = fc.sub(cols)
    def one(p):
        prm = {k.replace("m__", ""): v for k, v in p.items()}; r2s, maes = [], []
        for Xt, Xv, tr, va in fc.folds:
            pr = SVR(cache_size=1000, **prm).fit(Xt[:, idx], fc.y[tr]).predict(Xv[:, idx]); yv = fc.y[va]
            r2s.append(r2_score(yv, pr)); maes.append(mean_absolute_error(yv, pr))
        return r2s, maes
    res = _pmap(one, cand)
    A = lambda k: np.array([r[k] for r in res])
    r2, mae = A(0), A(1)
    cr = {"mean_test_r2": r2.mean(1), "std_test_r2": r2.std(1), "mean_test_mae": -mae.mean(1), "std_test_mae": mae.std(1)}
    i = int(np.argmax(cr["mean_test_r2"])); best = cand[i]
    est = pipe(SVR(cache_size=1000, **{k.replace("m__", ""): v for k, v in best.items()})).fit(X, y)
    return _FastSearch(est, dict(best), cr, i), "GridSearchCV"


def repeated_scores_all(Xall, y, groups, cols, best_models, big, n=N_REPEATS):
    """Average TEST R2/MAE of the SVR over n different grouped 60:40 splits (seeds 0..n-1); the SVR is re-tuned with its own grouped-CV grid on each split."""
    acc = ([], [])
    for sd in range(n):
        say(f"Repeated split {sd + 1} of {n}", "grouped 60:40 · re-tuning the SVR")
        tr, te = next(GroupShuffleSplit(n_splits=1, test_size=TEST_SIZE, random_state=sd).split(Xall, y, groups))
        Xt, yt, gt, Xe, ye = Xall.iloc[tr][cols], y[tr], groups[tr], Xall.iloc[te][cols], y[te]
        if len(set(gt)) < N_FOLDS: continue
        try:
            fc = _Folds(Xt, yt, list(GroupKFold(N_FOLDS).split(Xt, yt, gt)))
            if fc.ok: m = _svr_search_fast(fc, cols, SVR_GRID_SMALL if big else SVR_GRID_WIDE, Xt, yt)[0].best_estimator_
            else:
                with _par(): m = GridSearchCV(pipe(SVR(cache_size=1000)), SVR_GRID_SMALL if big else SVR_GRID_WIDE, cv=GroupKFold(N_FOLDS), scoring="r2", refit=True).fit(Xt, yt, groups=gt).best_estimator_
            p = m.predict(Xe); acc[0].append(float(r2_score(ye, p))); acc[1].append(float(mean_absolute_error(ye, p)))
        except Exception as e: print(f"[repeated splits] SVR skipped on split {sd}: {e}", flush=True)
    if not acc[0]: return {}
    return {"SVR": {"n_splits": len(acc[0]), "r2_mean": float(np.mean(acc[0])), "r2_std": float(np.std(acc[0])), "mae_mean": float(np.mean(acc[1])), "r2_each": acc[0]}}


def train_all(df, mp, cols_primary, label_map, q=AD_QUANTILE):
    """Train all models on ALL candidate descriptors (basic + enhanced + 1000/T): no feature selection of any kind."""
    y_all = target_series(df, mp); keep_rows = y_all.notna()
    if keep_rows.sum() < 20: raise ValueError(f"Only {int(keep_rows.sum())} rows have a valid target – at least 20 are needed for a grouped 60:40 split with cross-validation.")
    d = df[keep_rows]; y = y_all[keep_rows].values
    # non-numeric columns (Material composition, A, B ...) are never features; the target is LogKstar
    feats = [c for c in cols_primary if pd.api.types.is_numeric_dtype(d[c])]
    Xall = d[feats]
    # NEW: groups = composition column (rows of one composition = one group)
    fcol = mp.get("formula")
    groups = d[fcol].astype(str).values if fcol in d.columns else np.arange(len(d))
    n_groups = int(len(set(groups)))
    if n_groups < 8: raise ValueError(f"Only {n_groups} distinct compositions – at least 8 are needed for a grouped 60:40 split with 5-fold grouped CV.")
    # NEW: grouped 60:40 split – a composition is either completely in training or completely in testing
    tr_i, te_i = next(GroupShuffleSplit(n_splits=1, test_size=TEST_SIZE, random_state=SPLIT_SEED).split(Xall, y, groups))
    tr_i, te_i = np.sort(tr_i), np.sort(te_i)
    if len(set(groups[tr_i])) < N_FOLDS: raise ValueError(f"Only {len(set(groups[tr_i]))} compositions fall in the training part – at least {N_FOLDS} are needed for grouped 5-fold CV.")
    X_tr, X_te, y_tr, y_te, g_tr = Xall.iloc[tr_i], Xall.iloc[te_i], y[tr_i], y[te_i], groups[tr_i]
    features = list(Xall.columns); print("Features:", features, flush=True)
    say("Features prepared", f"{len(features)} descriptors used (all of them, incl. 1000/T)")
    say("Grouped 60:40 split by composition", f"{len(tr_i)} training rows · {len(te_i)} test rows · {n_groups} compositions")
    gkf = GroupKFold(N_FOLDS); fcA = _Folds(X_tr, y_tr, list(gkf.split(X_tr, y_tr, g_tr)))
    # ---- model comparison (grouped tuning, scaler inside the pipeline) ----
    _search.data = (X_tr, y_tr, g_tr)
    comp, best_models = [], {}
    big = len(X_tr) > BIG_ROWS
    if big: print(f"[training] {len(X_tr)} training rows: using a smaller SVR grid to stay fast", flush=True)
    for name, (est, grid, kind) in _specs().items():
        if name == "SVR" and big: grid = SVR_GRID_SMALL
        say(f"Tuning {name}", "grouped 5-fold cross-validation")
        if name == "SVR" and fcA.ok: s, method = _svr_search_fast(fcA, features, grid, X_tr, y_tr)
        else:
            with _par():
                s, method = _search(name, est, grid, kind, gkf)
        best = s.best_estimator_; cv = _search_metrics(s) or _cv_eval(best, X_tr, y_tr, gkf, g_tr)[1]
        trm, tem = _holdout(best, X_tr, y_tr), _holdout(best, X_te, y_te)
        say(f"{name} evaluated on the unseen 40%", f"test R² {tem['R2']:.3f} · CV R² {cv['R2']:.3f}")
        params = {k.replace("m__", ""): (v if isinstance(v, (int, float, str, type(None))) else str(v)) for k, v in s.best_params_.items()}
        comp.append({"model": name, "search": method, "params": params, "R2": tem["R2"], "MAE": tem["MAE"],       # test-set scores
                     "train_R2": trm["R2"], "train_MAE": trm["MAE"],
                     "cv_R2": cv["R2"], "cv_R2_std": cv["R2_std"], "cv_MAE": cv["MAE"]})
        best_models[name] = best
    svr = best_models["SVR"]
    say("Repeated-split check", "re-tuning the SVR on different grouped splits")
    repeated = repeated_scores_all(Xall, y, groups, features, best_models, big, N_REPEATS)
    for c_ in comp:
        r_ = repeated.get(c_["model"])
        if r_: c_["R2_avg"], c_["R2_avg_std"], c_["MAE_avg"], c_["n_splits"] = r_["r2_mean"], r_["r2_std"], r_["mae_mean"], r_["n_splits"]
    print("[repeated splits] avg test R2: " + " | ".join(f"{k} {v['r2_mean']:.3f}" for k, v in repeated.items()), flush=True)
    sv = next(c_ for c_ in comp if c_["model"] == "SVR")
    versus = {"selected": {"label": "SVR (all features)", "n_features": len(features), "features": features, "cv_r2": sv["cv_R2"], "cv_mae": sv["cv_MAE"], "test_r2": sv["R2"], "test_mae": sv["MAE"],
                           "params": sv["params"]}}
    # ---- applicability domain and SHAP ----
    say("Applicability domain", "Mahalanobis distance threshold from the training data")
    Xs = svr[:-1].transform(X_tr); mu = Xs.mean(0); VI = np.linalg.pinv(np.cov(Xs, rowvar=False).reshape(Xs.shape[1], Xs.shape[1]))
    dtr = np.sqrt(np.einsum("ij,jk,ik->i", Xs - mu, VI, Xs - mu)); thr = float(np.quantile(dtr, q))
    best_test = max(comp, key=lambda r: r["R2"])["model"]
    say("Shapley feature importance", "which descriptors drive the SVR predictions")
    gs, base = global_shap(svr, X_tr, label_map)
    p_tr, p_te = svr.predict(X_tr), svr.predict(X_te)
    idx = d.index
    names = [str(v) for v in d[fcol].iloc[tr_i]] if fcol in d.columns else None
    stats = {c: {"min": _f(Xall[c].min()), "max": _f(Xall[c].max()), "median": _f(Xall[c].median())} for c in features}
    # ---- everything needed to predict a single new cathode is saved with the model ----
    bundle = {"pipeline": svr, "features": features, "mu": mu, "VI": VI, "threshold": thr, "quantile": q,
              "oof": {int(i): float(v) for i, v in zip(idx[te_i], p_te)},
              "train_index": [int(i) for i in idx[tr_i]], "test_index": [int(i) for i in idx[te_i]],
              "background": X_tr.reset_index(drop=True), "train_formulas": names, "train_y": [float(v) for v in y_tr], "feature_stats": stats}
    fs_out = {"selected": features, "versus": versus, "n_candidates": len(features)}
    result = {"comparison": comp, "primary": "SVR", "best_by_test_r2": best_test, "features": features, "selected_features": features,
              "n_train": int(len(tr_i)), "n_test": int(len(te_i)), "n_total": int(keep_rows.sum()), "n_groups": n_groups,
              "n_train_groups": int(len(set(g_tr))), "n_test_groups": int(len(set(groups[te_i]))),
              "n_dropped_no_target": int((~keep_rows).sum()), "ad": {"quantile": q, "threshold": thr, "n_train": int(len(dtr))},
              "parity": {"y": y_te.tolist(), "pred": p_te.tolist(), "y_train": y_tr.tolist(), "pred_train": p_tr.tolist()},
              "stats": _relations(X_tr, y_tr), "feature_stats": stats, "feature_selection": fs_out,
              "shap": gs, "shap_base": base, "repeated": repeated,
              "cv": "Grouped 60:40 split by composition (GroupShuffleSplit, seed 42): a composition is never in both parts. All descriptors are used (no feature selection); tuning (grouped 5-fold CV) uses the 60% training part only; scores shown are on the unseen 40%."}
    return result, bundle


def _f(v):
    try:
        v = float(v); return None if np.isnan(v) or np.isinf(v) else v
    except Exception: return None


def screen(df, mp, bundle, label_map, ehull_limit=EHULL_LIMIT, orr_limit=ORR_LIMIT, ad_filter=True):
    pl, cols = bundle["pipeline"], bundle["features"]; X = df[cols]
    pred = pl.predict(X); Xs = pl[:-1].transform(X)
    dist = np.sqrt(np.einsum("ij,jk,ik->i", Xs - bundle["mu"], bundle["VI"], Xs - bundle["mu"])); thr = bundle["threshold"]
    phi, base = shapley(pl, X, bundle["background"], T=8)
    eh = df[mp["ehull"]] if mp.get("ehull") and mp["ehull"] in df.columns else None
    rows = []
    for i in range(len(df)):
        pl_k = float(pred[i]); inside = bool(dist[i] <= thr); fails, nas = [], []
        if not inside and ad_filter: fails.append(f"Outside applicability domain (Mahalanobis {dist[i]:.2f} > threshold {thr:.2f}); prediction is less reliable.")
        ev = _f(eh.iloc[i]) if eh is not None else None
        if ev is None: er = "NOT AVAILABLE"; nas.append("Ehull value not available - stability criterion not evaluated.")
        elif ev <= ehull_limit: er = "PASS"
        else: er = "FAIL"; fails.append(f"Ehull {ev:.1f} meV/atom exceeds the {ehull_limit:g} meV/atom limit (LSC value).")
        orr = "PASS" if pl_k >= orr_limit else "FAIL"
        if orr == "FAIL": fails.append(f"ORR activity criterion not satisfied: predicted log10(k*) {pl_k:.2f} < benchmark {orr_limit:.2f} (log10 of k* in cm/s; LSC benchmark used in the research paper).")
        final = "FAIL" if fails else ("INCOMPLETE" if nas else "PASS")
        rows.append({"row_index": i, "formula": str(df[mp["formula"]].iloc[i]) if mp.get("formula") else f"Row {i+1}",
            "pred_log": pl_k, "pred_k": float(10 ** pl_k), "dist": float(dist[i]), "ad": "INSIDE" if inside else "OUTSIDE", "ad_result": "PASS" if inside else "FAIL",
            "ehull": ev, "ehull_result": er, "orr_value": pl_k, "orr_result": orr, "final": final,
            "reason": " | ".join(fails) if fails else ("; ".join(nas) if nas else ""),
            "detail": {"original": {c: _f(v) if isinstance(v, (int, float, np.number)) else (None if pd.isna(v) else str(v)) for c, v in df.iloc[i].items()},
                       "features": {c: _f(X.iloc[i][c]) for c in cols},
                       "shap": [{"feature": c, "label": label_map.get(c, c), "value": float(phi[i, j])} for j, c in enumerate(cols)],
                       "shap_base": base, "cv_pred_log": bundle["oof"].get(i), "in_training": i not in bundle["oof"],
                       "thresholds": {"ad": thr, "ehull": ehull_limit, "orr": orr_limit}, "fails": fails, "not_available": nas}})
    return rows


# ---------------- closeness-to-passing ranking (dataset-independent) ----------------
# Each available criterion gives a normalised shortfall (0 = criterion satisfied):
#   AD   : (distance - threshold) / threshold          ORR : log10(k*) deficit below -6.40 (1.0 = one log unit)
#   Ehull: (Ehull - 57) / 57
# Score = MEAN shortfall over the criteria that could actually be evaluated (so datasets with
# fewer screening columns stay comparable). Fixed cut-offs, not data quantiles:
TIER_GREEN = 0.10   # score <= 0.10  -> "near passing"
TIER_RED = 0.50     # score  > 0.50  -> "far from passing"


def closeness(dist, thr, ehull, ehull_limit, pred, orr_limit=ORR_LIMIT):
    p = {"ad": max(0.0, (dist - thr) / thr) if thr else 0.0,
         "ehull": None if ehull is None else max(0.0, (ehull - ehull_limit) / ehull_limit),
         "orr": max(0.0, orr_limit - pred)}
    v = [x for x in p.values() if x is not None]
    s = float(sum(v) / len(v))
    return s, p, ("green" if s <= TIER_GREEN else "red" if s > TIER_RED else "orange")


def closeness_batch(tec, tec_limit, ehull, ehull_limit, pred, orr_limit=ORR_LIMIT):
    """Batch-screening ranking: mean normalised shortfall over the three filters (TEC, Ehull, log10 k*). The applicability domain is information only
    and is NOT part of the score. A cathode without predictions (not evaluable) gets no score and tier 'na'."""
    p = {"tec": None if tec is None else max(0.0, (tec - tec_limit) / tec_limit),
         "ehull": None if ehull is None else max(0.0, (ehull - ehull_limit) / ehull_limit),
         "orr": None if pred is None else max(0.0, orr_limit - pred)}
    v = [x for x in p.values() if x is not None]
    if not v: return None, p, "na"
    sc = float(sum(v) / len(v))
    return sc, p, ("green" if sc <= TIER_GREEN else "red" if sc > TIER_RED else "orange")


def predict_single(bundle, values, label_map, formula=None, ehull=None, ehull_limit=EHULL_LIMIT, orr_limit=ORR_LIMIT, ad_filter=True):
    """Predict ONE new cathode with the saved model. Uses exactly the same code as the batch screening, so decisions always agree."""
    cols = bundle["features"]
    row = {c: (float(values[c]) if values.get(c) not in (None, "") else np.nan) for c in cols}
    df = pd.DataFrame([row]); df["_formula"] = formula or "New cathode"; df["_ehull"] = np.nan if ehull in (None, "") else float(ehull)
    r = screen(df, {"formula": "_formula", "ehull": "_ehull"}, bundle, label_map, ehull_limit, orr_limit, ad_filter)[0]
    r["imputed"] = [c for c in cols if np.isnan(row[c])]
    return r


def compare_with_training(bundle, values, k=3):
    """Compare ONE cathode with the saved training data: range check for every descriptor + the k most similar training cathodes."""
    cols, bg = bundle["features"], bundle["background"]
    row = pd.DataFrame([{c: (float(values[c]) if values.get(c) not in (None, "") else np.nan) for c in cols}])
    pre = bundle["pipeline"][:-1]
    A = np.asarray(pre.transform(bg), dtype=float); b = np.asarray(pre.transform(row), dtype=float)[0]
    dist = np.sqrt(((A - b) ** 2).sum(1)); order = np.argsort(dist)[:k]
    names, ys = bundle.get("train_formulas"), bundle.get("train_y")
    near = [{"formula": (names[i] if names else f"Training cathode {i + 1}"), "distance": float(dist[i]), "log_k": (float(ys[i]) if ys else None)} for i in order]
    ranges = []
    for c in cols:
        v = row[c].iloc[0]; lo, hi = float(bg[c].min()), float(bg[c].max())
        ranges.append({"feature": c, "value": None if np.isnan(v) else float(v), "min": lo, "max": hi, "inside": bool(np.isnan(v) or lo <= v <= hi)})
    return {"nearest": near, "ranges": ranges, "n_outside": sum(1 for r in ranges if not r["inside"]), "n_training": int(len(bg))}