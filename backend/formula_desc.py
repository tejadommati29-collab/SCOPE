"""Python port of the Predict-Single-Cathode page logic, so the batch screening treats every formula EXACTLY like the Predict page does:

  * frontend/formula.js      -> parse(), classify(), validate(), analyse()   (formula text -> A-site / B-site / oxygen, with the same checks)
  * frontend/descriptors.js  -> compute()                                    (the 15 formula descriptors, same per-element tables)

Nothing is guessed: an element that is not in the descriptor tables leaves its descriptors empty (the caller reports it).
`test_port.js` style cross-checks against the JavaScript were run while developing (see README)."""
import re, math

# ------------------------------------------------------------------ periodic table (118 symbols, atomic-number order)
_SYMS = ("H He Li Be B C N O F Ne Na Mg Al Si P S Cl Ar K Ca Sc Ti V Cr Mn Fe Co Ni Cu Zn Ga Ge As Se Br Kr Rb Sr Y Zr Nb Mo Tc Ru Rh Pd Ag Cd In Sn Sb Te I Xe "
         "Cs Ba La Ce Pr Nd Pm Sm Eu Gd Tb Dy Ho Er Tm Yb Lu Hf Ta W Re Os Ir Pt Au Hg Tl Pb Bi Po At Rn Fr Ra Ac Th Pa U Np Pu Am Cm Bk Cf Es Fm Md No Lr Rf Db Sg Bh Hs Mt Ds Rg Cn Nh Fl Mc Lv Ts Og").split()
Z = {s: i + 1 for i, s in enumerate(_SYMS)}
assert len(Z) == 118

NOBLE = set("He Ne Ar Kr Xe Rn Og".split())
RADIO = set("Tc Pm Po At Fr Ra Ac Th Pa U".split())
A_SURE = set("Na K Rb Cs Ca Sr Ba La Nd Sm Eu Gd Dy Ho Er Tm Yb Lu Pm".split())
B_SURE = set("Sc Ti V Cr Mn Fe Co Ni Cu Zn Al Ga Ge Zr Nb Mo Ru Rh Pd In Sn Sb Hf Ta W Re Os Ir Pt Au Mg".split())
AMBIG = set("Ce Pr Tb Y Bi Pb Ag Tl Li Cd Hg Th U".split())
OX = {
    "Li": [1], "Na": [1], "K": [1], "Rb": [1], "Cs": [1], "Be": [2], "Mg": [2], "Ca": [2], "Sr": [2], "Ba": [2], "Sc": [3], "Y": [3], "La": [3], "Ce": [3, 4], "Pr": [3, 4], "Nd": [3], "Pm": [3],
    "Sm": [2, 3], "Eu": [2, 3], "Gd": [3], "Tb": [3, 4], "Dy": [3], "Ho": [3], "Er": [3], "Tm": [3], "Yb": [2, 3], "Lu": [3], "Ti": [3, 4], "Zr": [4], "Hf": [4], "V": [3, 5], "Nb": [3, 5], "Ta": [5],
    "Cr": [3, 6], "Mo": [4, 6], "W": [4, 6], "Mn": [2, 4], "Fe": [2, 4], "Co": [2, 4], "Ni": [2, 4], "Cu": [1, 3], "Zn": [2], "Cd": [2], "Hg": [2], "Al": [3], "Ga": [3], "In": [3], "Tl": [1, 3],
    "Ge": [2, 4], "Sn": [2, 4], "Pb": [2, 4], "Sb": [3, 5], "Bi": [3, 5], "Ru": [3, 5], "Rh": [3, 4], "Pd": [2, 4], "Ir": [3, 4], "Pt": [2, 4], "Re": [4, 7], "Os": [4, 6], "Ag": [1], "Au": [1, 3],
    "Th": [4], "U": [4, 6], "F": [-1], "Cl": [-1], "Br": [-1], "I": [-1], "N": [-3], "S": [-2], "Se": [-2]}
TOL_SITE, TOL_Q = 0.02, 0.05


def fmt_n(n):
    """JS: String(+(+n).toFixed(4))"""
    if n is None or not math.isfinite(n): return ""
    s = ("%.4f" % n).rstrip("0").rstrip(".")
    return "0" if s in ("-0", "") else s


def _idx(n): return "" if abs(n - 1) < 1e-9 else fmt_n(n)


_NUMAT = re.compile(r"^(\d+\.?\d*|\.\d+)")
_CL = {"(": ")", "[": "]", "{": "}"}


# ------------------------------------------------------------------ parser
def _parse_group(s, i, closer, errs):
    out = []
    while i < len(s):
        c = s[i]
        if closer is not None and c == closer: return out, i
        if c in _CL:
            sub, j = _parse_group(s, i + 1, _CL[c], errs)
            if j >= len(s) or s[j] != _CL[c]:
                errs.append(f"Unbalanced bracket '{c}' – a closing '{_CL[c]}' is missing."); return out + sub, len(s)
            i = j + 1
            m = _NUMAT.match(s[i:]); mult = 1.0
            if m: mult = float(m.group(0)); i += len(m.group(0))
            for x in sub: out.append({"el": x["el"], "n": x["n"] * mult, "explicit": x["explicit"] or bool(m)})
            continue
        if c in ")]}":
            errs.append(f"Unexpected '{c}' at position {i + 1} – no matching opening bracket."); i += 1; continue
        rest = s[i:]; m2 = re.match(r"[A-Z][a-z]", rest); el = None
        if m2 and m2.group(0) in Z: el = m2.group(0)
        elif re.match(r"[A-Z]", rest) and rest[0] in Z:
            if m2:
                errs.append(f"'{m2.group(0)}' (position {i + 1}) is not an element symbol."); i += 2; continue
            el = rest[0]
        else:
            ch = rest[0]
            errs.append(f"Unexpected '{ch}' at position {i + 1} – element symbols start with a capital letter (Co, not co or CO)." if re.match(r"[a-z]", ch)
                        else f"Unexpected '{ch}' at position {i + 1} – an index must follow an element." if re.match(r"[\d.]", ch)
                        else f"Unexpected '{ch}' at position {i + 1}.")
            i += 1; continue
        i += len(el)
        m = _NUMAT.match(s[i:]); n, explicit = 1.0, False
        if m: n = float(m.group(0)); i += len(m.group(0)); explicit = True
        out.append({"el": el, "n": n, "explicit": explicit})
    return out, i


# oxygen deficiency written as O3-δ, O(3-δ), O3-0.05, O3+δ ...
_RE_DEF = re.compile(r"O(?:\(\s*(\d*\.?\d+)\s*([-+])\s*(δ|Δ|[dxyz]|\d*\.?\d+)\s*\)|(\d*\.?\d+)?([-+±])(δ|Δ|[dxyz]|\d*\.?\d+))")


def parse(text):
    res = {"items": [], "O": {"n": 0.0, "present": False, "implied": False}, "delta": {"sym": False, "val": None}, "errors": [], "warnings": []}
    s = "" if text is None else str(text)
    s = re.sub(r"[₀-₉]", lambda m: str("₀₁₂₃₄₅₆₇₈₉".index(m.group(0))), s)
    s = re.sub(r"[−–—]", "-", s); s = re.sub(r"\s+", "", s)
    if not s: return res

    def repl(m):
        b1, s1, d1, b2, s2, d2 = m.groups()
        b = b1 if b1 is not None else b2; sg = s1 or s2; d = d1 if d1 is not None else d2
        base = float(b) if b is not None else None
        if base is None: res["warnings"].append("Oxygen index is missing before the δ term – ABO3 (3) assumed."); base = 3.0
        if re.fullmatch(r"[δΔdxyz]", d) or sg == "±":
            res["delta"] = {"sym": True, "val": None}; return "O" + fmt_n(base)
        v = float(d); res["delta"] = {"sym": False, "val": v if sg == "-" else -v}
        return "O" + fmt_n(base - v if sg == "-" else base + v)
    s = _RE_DEF.sub(repl, s, count=1)
    lst, _ = _parse_group(s, 0, None, res["errors"])
    o_n, o_expl = 0.0, False
    for x in lst:
        if x["el"] == "O":
            o_n += x["n"]; res["O"]["present"] = True
            if x["explicit"]: o_expl = True
        else: res["items"].append(x)
    res["O"]["n"] = o_n; res["O"]["implied"] = res["O"]["present"] and not o_expl
    res["errors"] = res["errors"][:3]
    return res


# ------------------------------------------------------------------ A-site / B-site recognition
def _sum_site(rows, site): return sum(r["n"] for r in rows if r["site"] == site and r["n"] > 0)


def classify(items):
    rows, amb, notes = [], [], []
    for it in items:
        site = "X"
        if it["el"] in A_SURE: site = "A"
        elif it["el"] in B_SURE: site = "B"
        elif it["el"] in AMBIG: site = None
        row = {"el": it["el"], "n": it["n"], "site": site, "implied": not it["explicit"]}
        rows.append(row)
        if site is None: amb.append(row)
    if amb:
        sA, sB, T, tol = _sum_site(rows, "A"), _sum_site(rows, "B"), sum(r["n"] for r in amb), 0.03
        openA, openB = sA < 1 - tol, sB < 1 - tol
        fitA, fitB = abs(T - (1 - sA)) <= tol, abs(T - (1 - sB)) <= tol
        to = None
        if not openA and openB: to = "B"
        elif openA and not openB: to = "A"
        elif openA and openB:
            if fitA and not fitB: to = "A"
            elif fitB and not fitA: to = "B"
        names = ", ".join(r["el"] for r in amb)
        for r in amb: r["site"] = to or "X"
        notes.append({"l": "info", "t": f"{names} can sit on the A- or the B-site. It was placed on the {to}-site from the site totals – please check it."} if to
                      else {"l": "warn", "t": f"{names} could be A-site or B-site and the stoichiometry does not decide it. It is listed under \"Additional components\"."})
    odd = [r["el"] for r in rows if r["site"] == "X" and r["el"] not in AMBIG]
    if odd: notes.append({"l": "info", "t": f"{', '.join(odd)} {'are' if len(odd) > 1 else 'is'} neither a typical A- nor B-site cation, so {'they are' if len(odd) > 1 else 'it is'} listed under \"Additional components\"."})
    return rows, notes


# ------------------------------------------------------------------ charge neutrality (usual oxidation-state ranges)
def charge_check(rows, nO):
    lo = hi = fixed = 0.0; vars_, missing = [], []
    for r in rows:
        if not r["el"] or r["el"] not in Z or not (r["n"] > 0) or r["el"] == "O": continue
        q = OX.get(r["el"])
        if not q: missing.append(r["el"]); continue
        a, b = q[0], q[-1]; lo += r["n"] * a; hi += r["n"] * b
        if a == b: fixed += r["n"] * a
        else: vars_.append((r, a, b))
    if missing: return {"l": "info", "t": f"Charge-neutrality check skipped: no oxidation-state data for {', '.join(dict.fromkeys(missing))}."}
    T = 2 * nO; q2 = lambda x: "%.2f" % (round(x * 100) / 100)
    if not vars_:
        d = fixed - T
        return {"l": "ok", "t": f"Charge neutral: cations +{q2(fixed)} balance oxygen −{q2(T)}."} if abs(d) <= TOL_Q else \
               {"l": "warn", "t": f"Not charge neutral with the usual oxidation states: cations give +{q2(fixed)} but oxygen needs +{q2(T)} (difference {'+' if d > 0 else ''}{q2(d)}). Check the indexes or δ."}
    if len(vars_) == 1:
        r, a, b = vars_[0]; need = (T - fixed) / r["n"]; rng = f"{a}+" if a == b else f"{a}–{b}+"
        return {"l": "ok", "t": f"Charge balanced if {r['el']} has an average oxidation state of {q2(need)}+ (usual range {rng})."} if a - TOL_Q <= need <= b + TOL_Q else \
               {"l": "warn", "t": f"Charge cannot be balanced: {r['el']} would need {q2(need)}+, outside its usual range {rng}. Check the indexes or δ."}
    names = ", ".join(v[0]["el"] for v in vars_)
    return {"l": "ok", "t": f"Charge balance is possible, but {names} are multivalent, so their individual oxidation states are not unique."} if lo - TOL_Q <= T <= hi + TOL_Q else \
           {"l": "warn", "t": f"Charge cannot be balanced: the cations can supply +{q2(lo)} to +{q2(hi)}, oxygen needs +{q2(T)}. Check the indexes or δ."}


# ------------------------------------------------------------------ validation
def validate(st):
    out = []; push = lambda l, t: out.append({"l": l, "t": t}); rows = st["rows"]
    named = [r for r in rows if r["el"]]
    for r in rows:
        if not r["el"]: push("err", "A row has no element – choose one or remove the row."); continue
        if r["el"] not in Z: push("err", f"'{r['el']}' is not a valid element symbol."); continue
        if r["el"] == "O": push("err", "Oxygen belongs in the Oxygen field, not in a site row.")
        if not (r["n"] > 0) or not math.isfinite(r["n"]): push("err", f"The index of {r['el']} must be a number greater than 0.")
        if r["el"] in NOBLE: push("err", f"{r['el']} is a noble gas – not supported in a perovskite oxide.")
        elif r["el"] in RADIO or Z[r["el"]] >= 93: push("warn", f"{r['el']} is radioactive/synthetic – there is little property data for it.")
    cnt = {}
    for r in named: cnt[r["el"]] = cnt.get(r["el"], 0) + 1
    dups = [k for k in cnt if cnt[k] > 1 and k != "O"]
    if dups: push("err", f"Duplicate element{'s' if len(dups) > 1 else ''}: {', '.join(f'{k} ({cnt[k]}×)' for k in dups)}. Combine them into one index.")
    hasA = any(r["site"] == "A" and r["el"] for r in rows); hasB = any(r["site"] == "B" and r["el"] for r in rows)
    if not hasA: push("err", "No A-site element identified (e.g. La, Sr, Ba).")
    if not hasB: push("err", "No B-site element identified (e.g. Fe, Co, Mn).")
    sA, sB = _sum_site(rows, "A"), _sum_site(rows, "B")
    if hasA and hasB and all(r["n"] > 0 or not r["el"] for r in rows):
        okA, okB = abs(sA - 1) <= TOL_SITE, abs(sB - 1) <= TOL_SITE
        if okA and okB: push("ok", "A-site and B-site totals are both 1 (ABO3 stoichiometry).")
        elif abs(sA - sB) <= TOL_SITE * max(sA, sB) and sA > 1.5:
            push("warn", f"A-site and B-site totals are both {fmt_n(sA)} – this looks like a doubled / ordered cell (e.g. A2B2O6 or a double perovskite). Fractions are normalised per site, but the model expects ABO3.")
        else:
            for nm, sm, ok in (("A", sA, okA), ("B", sB, okB)):
                if ok: continue
                if 0.8 <= sm <= 1.2: push("warn", f"{nm}-site total is {fmt_n(sm)}, not 1 ({nm}-site {'deficiency' if sm < 1 else 'excess'}?). Doping fractions are normalised to the site total.")
                else: push("err", f"{nm}-site total is {fmt_n(sm)} – far from 1, so this is not an ABO3-type composition (or an element is on the wrong site).")
    if not (st["O"] > 0): push("err", "No oxygen found – this tool handles oxide perovskites. Enter the oxygen index (e.g. O3).")
    else:
        dbl = abs(sA - sB) <= TOL_SITE * max(sA, sB) and sA > 1.5; nominal = 3 * sA if dbl else 3
        if st["O"] < 0.7 * nominal: push("err", f"Oxygen index {fmt_n(st['O'])} is far too low for an ABO3-type oxide (nominal {fmt_n(nominal)}).")
        elif st["O"] > nominal + 0.05: push("warn", f"Oxygen index {fmt_n(st['O'])} is above the nominal {fmt_n(nominal)} (oxygen excess?).")
        elif st["O"] < nominal - 0.6: push("warn", f"Large oxygen deficiency δ = {fmt_n(nominal - st['O'])}.")
        if st["deltaSym"]: push("warn", f"δ was written as a symbol but no value was given – oxygen is taken as {fmt_n(st['O'])} (δ = 0).")
        if st["oImplied"]: push("warn", "No oxygen index was given – it is taken as 1, which is unusual. Did you mean O3?")
    if st["O"] > 0 and not any(m["l"] == "err" and re.search(r"Duplicate|valid element|noble", m["t"]) for m in out):
        c = charge_check(rows, st["O"])
        if c: out.append(c)
    return out


def canonical(st):
    part = lambda site: "".join(r["el"] + _idx(r["n"]) for r in st["rows"] if r["site"] == site and r["el"] and r["n"] > 0)
    return part("A") + part("B") + part("X") + ("O" + _idx(st["O"]) if st["O"] > 0 else "")


def analyse(text):
    """Same as FX.analyse: returns {st, msgs, formula, composition}. msgs entries are {l: err|warn|info|ok, t: text}; any 'err' blocks the prediction."""
    p = parse(text); rows, notes = classify(p["items"])
    st = {"rows": rows, "O": p["O"]["n"], "deltaSym": p["delta"]["sym"], "oImplied": p["O"]["implied"]}
    msgs = [{"l": "err", "t": t} for t in p["errors"]] + [{"l": "warn", "t": t} for t in p["warnings"]] + notes + validate(st)
    part = lambda s: [(r["el"], r["n"]) for r in rows if r["site"] == s and r["el"] and r["n"] > 0]
    return {"st": st, "msgs": msgs, "formula": canonical(st), "composition": {"A": part("A"), "B": part("B"), "X": part("X"), "O": st["O"]}}


# ------------------------------------------------------------------ the 15 formula descriptors (frontend/descriptors.js)
# Row order: [Ion, EN, R, Sa, Ionicity, SmithAcidity, (B-site only) d-electrons]
A_TAB = {
    "Ba": [10.0, 1.087, 1.61, 0.194, 0.7643, -10.8], "Bi": [25.56, 1.399, 1.17, 0.436, 0.7344, -3.5],
    "Ca": [11.87, 1.092, 1.34, 0.264, 0.7639, -7.5], "Cs": [3.89, 0.946, 1.88, 0.088, 0.7788, -13.0],
    "Dy": [22.8, 1.293, 1.24, 0.396, 0.7453, -4.7], "Gd": [20.63, 1.263, 1.27, 0.371, 0.7481, -5.0],
    "La": [19.18, 1.225, 1.36, 0.343, 0.7517, -6.1], "Nd": [22.1, 1.256, 1.31, 0.363, 0.7488, -5.7],
    "Pr": [21.62, 1.258, 1.32, 0.326, 0.7486, -5.8], "Rb": [4.18, 0.961, 1.72, 0.097, 0.7774, -12.7],
    "Sm": [23.4, 1.283, 1.28, 0.38, 0.7463, -5.1], "Sr": [11.03, 1.093, 1.44, 0.222, 0.7638, -9.4]}
B_TAB = {
    "Al": [28.43, 1.61, 0.5, 0.583, 0.714, -2.0, 0.0], "Ce": [36.76, 1.608, 0.87, 0.45, 0.7139, -2.7, 0.0],
    "Co": [33.5, 1.69, 0.55, 0.5, 0.7058, -3.8, 6.0], "Cr": [30.96, 1.59, 0.62, 0.5, 0.7161, 6.6, 3.0],
    "Cu": [20.29, 1.37, 0.73, 0.374, 0.7372, -2.5, 9.0], "Fe": [30.65, 1.65, 0.55, 0.528, 0.7099, -1.7, 5.0],
    "Ga": [28.0, 1.81, 0.62, 0.65, 0.6933, -1.6, 0.0], "Hf": [33.33, 1.706, 0.71, 0.59, 0.7043, -3.1, 0.0],
    "In": [28.03, 1.81, 0.8, 0.495, 0.6941, -2.4, 0.0], "Mg": [15.03, 1.31, 0.72, 0.334, 0.7451, -4.5, 0.0],
    "Mn": [33.67, 1.6275, 0.58, 0.513, 0.7122, -1.92, 4.0], "Mo": [68.83, 2.101, 0.59, 1.185, 0.6655, 5.2, 0.0],
    "Nb": [50.57, 1.86, 0.64, 0.835, 0.6892, 1.0, 0.0], "Ni": [35.19, 1.7, 0.56, 0.502, 0.7048, -2.4, 7.0],
    "Sb": [56.0, 1.971, 0.6, 0.833, 0.6783, 2.3, 0.0], "Sc": [24.76, 1.42, 0.885, 0.481, 0.733, 0.0, 0.0],
    "Sn": [40.73, 1.85, 0.69, 0.714, 0.6901, 1.5, 0.0], "Ti": [43.27, 1.73, 0.605, 0.676, 0.7016, 0.7, 0.0],
    "Y": [28.865, 1.275, 0.81, 0.515, 0.7484, -3.2, 0.0], "Zn": [17.96, 1.336, 0.74, 0.405, 0.7407, -3.2, 0.0],
    "Zr": [28.865, 1.275, 0.81, 0.515, 0.7484, -3.2, 0.0]}
O_R = 1.40
BASIC = ["Ion_A", "Ion_B", "EN_A", "EN_B", "R_A", "R_B", "Sa_A", "Sa_B", "Delec_B", "t", "Ionic_A", "Ionic_B", "Avg_Ionic_Character", "SmithAcid_A", "SmithAcid_B"]


def _site(rows, tab, has_d):
    lst = [r for r in rows if r[0] and r[1] > 0]; tot = sum(r[1] for r in lst)
    unknown = [r[0] for r in lst if r[0] not in tab]
    if not lst or unknown: return {"ok": False, "unknown": unknown, "tot": tot}
    m = lambda i: sum(tab[r[0]][i] * r[1] / tot for r in lst)
    return {"ok": True, "tot": tot, "ion": m(0), "en": m(1), "r": m(2), "sa": m(3), "ionic": m(4), "sm": m(5), "d": m(6) if has_d else None}


def compute(comp):
    """comp = {A: [(el, n)...], B: [(el, n)...]}. Returns {values, unknownA, unknownB}: the 15 descriptors that could be calculated (never invented)."""
    a, b = _site(comp.get("A") or [], A_TAB, False), _site(comp.get("B") or [], B_TAB, True); v = {}
    if a["ok"]:
        v.update(Ion_A=round(a["ion"], 4), EN_A=round(a["en"], 4), R_A=round(a["r"], 4), Sa_A=round(a["sa"], 4), Ionic_A=round(a["ionic"], 4), SmithAcid_A=round(a["sm"], 4))
    if b["ok"]:
        v.update(Ion_B=round(b["ion"], 4), EN_B=round(b["en"], 4), R_B=round(b["r"], 4), Sa_B=round(b["sa"], 4), Ionic_B=round(b["ionic"], 4), SmithAcid_B=round(b["sm"], 4), Delec_B=round(b["d"], 4))
    if a["ok"] and b["ok"]:
        v["t"] = round((a["r"] + O_R) / (math.sqrt(2) * (b["r"] + O_R)), 4)
        v["Avg_Ionic_Character"] = round((a["tot"] * a["ionic"] + b["tot"] * b["ionic"]) / (a["tot"] + b["tot"]), 4)
    return {"values": v, "unknownA": a.get("unknown", []), "unknownB": b.get("unknown", [])}


def comp_key(comp):
    """Order-independent key of a composition {A: [(el, n)...], B: [(el, n)...]}: same cathode written in any element order / with or without an implied index gives the same key."""
    side = lambda rows: ",".join(f"{e}{round(float(n), 4):g}" for e, n in sorted((r[0], r[1]) for r in (rows or []) if r[0] and r[1] > 0))
    return side(comp.get("A")) + "|" + side(comp.get("B"))
