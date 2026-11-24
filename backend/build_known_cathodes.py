"""Developer script: store every cathode of the training dataset in backend/builtin_models/known_cathodes.json: the 15 descriptors + 5 material
properties (one set per composition) and, for every temperature it was measured at, the recorded log10(k*), Ehull and TEC.
The Predict Single Cathode page uses it: if the formula AND the temperature are in the dataset, the dataset's own values are reproduced; otherwise
the page predicts as usual.
    cd backend
    python build_known_cathodes.py path/to/dataset.xlsx"""
import sys, json
from pathlib import Path
import pandas as pd
import formula_desc as fd

OUT = Path(__file__).resolve().parent / "builtin_models" / "known_cathodes.json"
P5 = ["Work_Function", "O_pband", "Log_dieletric", "Oxide_vacancy", "Gap"]


def main(path):
    df = pd.read_excel(path, sheet_name=0) if not str(path).lower().endswith(".csv") else pd.read_csv(path)
    df.columns = [str(c).strip() for c in df.columns]; F = "Material composition"; out = {}
    for _, r in df.iterrows():
        a = fd.analyse(str(r[F]))
        if any(m["l"] == "err" for m in a["msgs"]): continue
        k = fd.comp_key(a["composition"])
        e = out.setdefault(k, {"formula": str(r[F]), "values": {c: float(r[c]) for c in fd.BASIC + P5}, "rows": []})
        t = round(1000.0 / float(r["1000/T"]) - 273.15, 2)
        if not any(abs(x[0] - t) < 0.05 for x in e["rows"]): e["rows"].append([t, float(r["LogKstar"]), float(r["E_above_hull"]), float(r["TEC"])])
    OUT.write_text(json.dumps({"dataset": Path(path).name, "cathodes": out}, separators=(",", ":")))
    print(f"{len(out)} cathodes, {sum(len(v['rows']) for v in out.values())} temperature rows saved to {OUT}")


if __name__ == "__main__":
    if len(sys.argv) != 2: sys.exit(__doc__)
    main(sys.argv[1])
