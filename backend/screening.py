"""Batch screening = the Predict-Single-Cathode logic applied to every cathode of an uploaded dataset.

For each cathode (exactly as on the Predict page):
  1. the formula is recognised (A-site / B-site / oxygen, same checks as the page);
  2. the 15 descriptors: the dataset's own value when the dataset has that column, otherwise CALCULATED from the formula;
  3. 1000/T from the temperature typed in the box (deg C);
  4. the 5 material properties (Gap, Oxide_vacancy, Work_Function, Log_dieletric, O_pband): the dataset's value when present, otherwise PREDICTED (SVR);
  5. Ehull and TEC are PREDICTED (SVR) from the 15 descriptors + 5 properties;
  6. log10(k*) is PREDICTED by the built-in SVR from all 23 inputs.
Filters (these three decide PASS / FAIL):  TEC <= 15 x1e-6 1/K,  log10(k*) >= -6.40,  Ehull <= 57 meV/atom.
Applicability domain (Mahalanobis) and the cost estimate are information only.
A cathode that cannot be evaluated (formula not recognised, element without descriptor data and no dataset column) is reported as NOT EVALUABLE - nothing is invented."""
import numpy as np, pandas as pd
import ml
import formula_desc as fd

P5 = ["Work_Function", "O_pband", "Log_dieletric", "Oxide_vacancy", "Gap"]          # same order as the property models' inputs


def dataset_columns(df):
    """{descriptor key: dataset column} for the 15 formula descriptors and the 5 properties the dataset already contains (numeric columns only)."""
    al = {k: a + [ml.norm(k)] for k, _, _, a in ml.DESC}; out = {}
    for k in fd.BASIC + P5:
        c = ml._find(list(df.columns), al[k])
        if c is not None and pd.api.types.is_numeric_dtype(df[c]) and df[c].notna().any(): out[k] = c
    return out


def _num(v):
    try:
        f = float(v)
        return f if np.isfinite(f) else None
    except (TypeError, ValueError): return None


def _orig(df, i):
    return {c: ml._f(v) if isinstance(v, (int, float, np.number)) else (None if pd.isna(v) else str(v)) for c, v in df.iloc[i].items()}


def _blank(i, formula, orig, reason, notes, thr, temp_c, sources=None, feats=None):
    """A cathode that could not be evaluated."""
    return {"row_index": i, "formula": formula, "pred_log": None, "pred_k": None, "dist": None, "ad": None, "ad_result": "NOT AVAILABLE",
            "ehull": None, "ehull_result": "NOT AVAILABLE", "tec": None, "tec_result": "NOT AVAILABLE", "orr_value": None, "orr_result": "NOT AVAILABLE",
            "final": "INCOMPLETE", "reason": reason,
            "detail": {"original": orig, "features": feats or {}, "sources": sources or {}, "notes": notes, "shap": [], "shap_base": None, "cv_pred_log": None, "in_training": False,
                       "thresholds": thr, "fails": [], "not_available": [reason], "temperature_c": temp_c}}


def run(df, formula_col, temp_c, bundle, props, ehull_limit=ml.EHULL_LIMIT, tec_limit=ml.TEC_LIMIT, orr_limit=ml.ORR_LIMIT):
    """Returns (rows, info). `rows` have the same keys the rest of the app uses for a screening row (+ tec / tec_result)."""
    thr = {"ad": bundle["threshold"], "ehull": ehull_limit, "orr": orr_limit, "tec": tec_limit}
    inv_t = 1000.0 / (temp_c + 273.15); have = dataset_columns(df); feats_model = bundle["features"]
    pending, rows, blank = [], [], 0
    # ---- 1-2: formula recognition + the 15 descriptors (dataset value, else calculated) ----
    for i in range(len(df)):
        raw = df[formula_col].iloc[i]; text = "" if pd.isna(raw) else str(raw).strip()
        if not text: blank += 1; continue
        orig = _orig(df, i); a = fd.analyse(text); errs = [m["t"] for m in a["msgs"] if m["l"] == "err"]
        notes = [m for m in a["msgs"] if m["l"] in ("warn", "info")]; name = a["formula"] if not errs and a["formula"] else text
        if errs:
            rows.append(_blank(i, name, orig, "Formula not recognised: " + errs[0], notes, thr, temp_c)); continue
        calc = fd.compute(a["composition"]); vals, src, miss = {}, {}, []
        for k in fd.BASIC:
            dv = _num(df[have[k]].iloc[i]) if k in have else None
            if dv is not None: vals[k], src[k] = dv, "dataset"
            elif k in calc["values"]: vals[k], src[k] = calc["values"][k], "formula"
            else: miss.append(k)
        if miss:
            unk = list(dict.fromkeys(calc["unknownA"] + calc["unknownB"]))
            why = (f"No built-in descriptor data for {', '.join(unk)}" if unk else "Descriptors could not be calculated from the formula") + \
                  f" and the dataset has no value for: {', '.join(miss)}. Add those descriptor columns to the dataset to evaluate this cathode."
            rows.append(_blank(i, name, orig, why, notes, thr, temp_c, src, vals)); continue
        pending.append({"i": i, "name": name, "orig": orig, "vals": vals, "src": src, "notes": notes, "composition": a["composition"]})
    if pending:
        X15 = pd.DataFrame([{k: p["vals"][k] for k in fd.BASIC} for p in pending])
        # ---- 4: 5 material properties (dataset value, else predicted) ----
        for k in P5:
            e = props[k]; pr = e["model"].predict(X15[e["features"]].to_numpy(dtype=float))
            for j, p in enumerate(pending):
                dv = _num(df[have[k]].iloc[p["i"]]) if k in have else None
                p["vals"][k], p["src"][k] = (dv, "dataset") if dv is not None else (float(pr[j]), "predicted")
        # ---- 5: Ehull and TEC predicted from the 15 descriptors + 5 properties ----
        for k in ("E_above_hull", "TEC"):
            e = props[k]; pr = e["model"].predict(pd.DataFrame([{f: p["vals"][f] for f in e["features"]} for p in pending])[e["features"]].to_numpy(dtype=float))
            for j, p in enumerate(pending): p["vals"][k], p["src"][k] = float(pr[j]), "predicted"
        for p in pending: p["vals"]["1000/T"], p["src"]["1000/T"] = inv_t, "temperature"
        # ---- 6: log10(k*) with the built-in SVR + applicability domain (information only) ----
        X = pd.DataFrame([{c: p["vals"][c] for c in feats_model} for p in pending])[feats_model]
        pl = bundle["pipeline"]; pred = pl.predict(X); Xs = pl[:-1].transform(X); d0 = Xs - bundle["mu"]
        dist = np.sqrt(np.einsum("ij,jk,ik->i", d0, bundle["VI"], d0))
        for j, p in enumerate(pending):
            v = p["vals"]; k_pred = float(pred[j]); eh, tc = v["E_above_hull"], v["TEC"]; inside = bool(dist[j] <= thr["ad"]); fails = []
            tec_r = "PASS" if tc <= tec_limit else "FAIL"; orr_r = "PASS" if k_pred >= orr_limit else "FAIL"; eh_r = "PASS" if eh <= ehull_limit else "FAIL"
            if tec_r == "FAIL": fails.append(f"TEC {tc:.2f} x10^-6 1/K exceeds the {tec_limit:g} x10^-6 1/K limit.")
            if orr_r == "FAIL": fails.append(f"ORR activity criterion not satisfied: predicted log10(k*) {k_pred:.2f} < benchmark {orr_limit:.2f} (log10 of k* in cm/s; LSC benchmark used in the research paper).")
            if eh_r == "FAIL": fails.append(f"Ehull {eh:.1f} meV/atom exceeds the {ehull_limit:g} meV/atom limit (LSC value).")
            notes = list(p["notes"])
            rows.append({"row_index": p["i"], "formula": p["name"], "pred_log": k_pred, "pred_k": float(10 ** k_pred), "dist": float(dist[j]), "ad": "INSIDE" if inside else "OUTSIDE",
                         "ad_result": "PASS" if inside else "FAIL", "ehull": float(eh), "ehull_result": eh_r, "tec": float(tc), "tec_result": tec_r,
                         "orr_value": k_pred, "orr_result": orr_r, "final": "FAIL" if fails else "PASS", "reason": " | ".join(fails),
                         "detail": {"original": p["orig"], "features": {c: ml._f(v[c]) for c in feats_model}, "sources": {c: p["src"][c] for c in feats_model}, "notes": notes,
                                    "composition": {s: [list(x) for x in p["composition"][s]] for s in ("A", "B")}, "shap": [], "shap_base": None, "cv_pred_log": None, "in_training": False,
                                    "thresholds": thr, "fails": fails, "not_available": [], "temperature_c": temp_c}})
    rows.sort(key=lambda r: r["row_index"])
    return rows, {"blank_rows": blank, "dataset_columns": {k: have[k] for k in have}, "inv_t": inv_t, "evaluated": len(pending)}
