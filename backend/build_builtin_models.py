"""One-time developer script: train the SVR on YOUR dataset and save them inside the code
folder (backend/builtin_models/), so every user can predict a single cathode straight away - no upload, no training.

Usage (run once on your computer, then zip / deploy the whole folder):
    cd backend
    python build_builtin_models.py path/to/your_dataset.xlsx     # .csv / .xlsx / .xls

It uses exactly the same code as the website (ml.analyze -> ml.train_all), with ALL descriptors
(basic + enhanced + 1000/T). Re-run it whenever you want to refresh the built-in models."""
import sys, json
from pathlib import Path
import pandas as pd, joblib
import ml

OUT = Path(__file__).resolve().parent / "builtin_models"


def read_file(path):
    p = str(path)
    if p.lower().endswith(".csv"): raw = pd.read_csv(p)
    else:
        sheets = pd.read_excel(p, sheet_name=None); raw = max(sheets.values(), key=lambda d: d.size)
    return ml.load_df(raw)


def jd(x): return json.loads(json.dumps(x, default=lambda o: o.item() if hasattr(o, "item") else str(o)))


def main(path, only=None):
    df, info = read_file(path); an = ml.analyze(df, info); mp = an["mapping"]
    if not mp.get("formula"): sys.exit("No chemical-formula column found in the dataset.")
    if not mp.get("target"): sys.exit("No log10(k*) target column found in the dataset.")
    labels = {e["column"]: e["label"] for e in an["descriptors"] if e["column"]}
    basic = [c for c in mp["features"] if c != mp["target"] and pd.api.types.is_numeric_dtype(df[c]) and not ml.is_const(df[c])]
    enh = [e["column"] for e in an["descriptors"] if e["usable"] and e["group"] == "enhanced"]
    feats = basic + [c for c in enh if c not in basic]                       # full descriptor set
    print(f"{len(df)} rows | formula: {mp['formula']} | target: {mp['target']} | {len(feats)} descriptors: {feats}", flush=True)
    OUT.mkdir(parents=True, exist_ok=True)
    mf = OUT / "meta.json"; meta = json.loads(mf.read_text()) if mf.exists() else {"scores": {}}
    keep = lambda t: {k: t.get(k) for k in ("features", "feature_stats", "shap")}
    meta.update(descriptors=jd(an["descriptors"]), dataset=Path(path).name, n_rows=int(len(df)))
    if only in (None, "svr"):
        print("Training SVR ...", flush=True); res, b = ml.train_all(df, mp, feats, labels)
        joblib.dump(b, OUT / "svr_pipeline.joblib", compress=3); c = res["comparison"][0]
        meta["train"] = jd(keep(res)); meta["scores"]["SVR"] = {"test_R2": c["R2"], "cv_R2": c["cv_R2"], "MAE": c["MAE"]}
        print(f"  SVR  test R2 {c['R2']:.3f}  (CV {c['cv_R2']:.3f})  MAE {c['MAE']:.3f}", flush=True)
    mf.write_text(json.dumps(meta, indent=1)); print(f"\nSaved to {OUT}", flush=True)


if __name__ == "__main__":
    a = [x for x in sys.argv[1:] if not x.startswith("--")]; f = [x for x in sys.argv[1:] if x.startswith("--")]
    if len(a) != 1 or any(x not in ("--svr-only",) for x in f): sys.exit(__doc__ + "\n    optional: --svr-only")
    main(a[0], "svr" if "--svr-only" in f else None)
