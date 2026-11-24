"""Precursor-cost ESTIMATE of a cathode (shown in the screening results; it is NOT a pass/fail filter).

How the estimate is made (everything is automatic - nobody has to enter prices)
------------------------------------------------------------------------------
1. The cathode formula and every precursor formula are read with the same formula parser (`parse_formula`).
2. For every metal of the cathode the built-in synthesis route uses one precursor (e.g. La -> La2O3, Sr -> SrCO3, Mn -> MnO2).
   Moles of precursor = n_el / k  (n_el = stoichiometry of the metal, k = atoms of that metal per precursor formula unit),
   plus an optional excess for volatile elements (EXCESS_PCT).
3. Mass of precursor = moles x molar mass.  Cost = mass x price per kg, with the price normalised to 99 % purity
   (price x 99 / listed purity).
4. Total precursor cost for ONE MOLE of cathode = sum over the metals.
5. Cost per kg of cathode = total cost / (theoretical mass of one mole of cathode in kg x synthesis yield).
   Result: an estimated USD per kg of cathode.  Oxygen is not priced (comes from air / the precursors).
6. Level (Cheap / Moderate / Expensive): the cheaper third / middle third / dearer third of the screened cathodes.

Prices: a built-in table of approximate market prices (DEFAULT_PRICES, USD/kg, order-of-magnitude estimates - NOT live quotes)
is always used. An administrator MAY override any element with a row in ``precursor_prices.csv`` (optional; use USD/kg).
An element with no price at all gives cost = NOT AVAILABLE for that cathode - it is never guessed.
Cost never changes the PASS / FAIL result of a cathode.
"""
import re, csv, io, os, json, math, hashlib, threading, tempfile
from pathlib import Path

REF_PURITY = 99.0          # % - reference grade the prices are normalised to
REF_PACK_G = 500.0         # g - reference pack size
COLUMNS = ["element", "precursor", "price_per_kg", "purity_percent", "pack_size_g"]
RULE_TEXT = "estimate only: precursor cost per kg of cathode, shown as Cheap / Moderate / Expensive (does not affect PASS / FAIL)"
CURRENCY = "USD"
SYNTH_YIELD = float(os.environ.get("COST_YIELD_PERCENT", "95")) / 100.0      # overall synthesis yield (fraction of the theoretical mass obtained)
EXCESS_PCT = {"Li": 5.0, "Na": 5.0, "K": 5.0, "Bi": 5.0, "Pb": 5.0}          # % extra precursor for elements that volatilise during firing
EXCESS_DEFAULT = 0.0

# Built-in precursor prices: element, usual precursor, USD per kg (approximate bulk / chemical-grade market level), purity %, pack g.
# ORDER-OF-MAGNITUDE ESTIMATES from general market knowledge, not live quotes. Because the result is only used to compare cathodes
# with each other (Cheap / Moderate / Expensive), the relative size of the prices matters more than the exact figure. Override any of
# them on the Admin page if you have real supplier prices (USD/kg).
DEFAULT_PRICES = [
    ("Li", "Li2CO3", 15), ("Na", "Na2CO3", 1), ("K", "K2CO3", 2), ("Mg", "MgO", 2), ("Ca", "CaCO3", 1), ("Sr", "SrCO3", 4), ("Ba", "BaCO3", 3),
    ("Sc", "Sc2O3", 3000), ("Y", "Y2O3", 8), ("La", "La2O3", 5), ("Ce", "CeO2", 5), ("Pr", "Pr6O11", 90), ("Nd", "Nd2O3", 80),
    ("Sm", "Sm2O3", 10), ("Gd", "Gd2O3", 30), ("Dy", "Dy2O3", 300), ("Er", "Er2O3", 40), ("Yb", "Yb2O3", 70),
    ("Ti", "TiO2", 4), ("Zr", "ZrO2", 8), ("Hf", "HfO2", 800), ("V", "V2O5", 15), ("Nb", "Nb2O5", 60), ("Ta", "Ta2O5", 400),
    ("Cr", "Cr2O3", 4), ("Mo", "MoO3", 40), ("W", "WO3", 30), ("Mn", "MnO2", 3), ("Fe", "Fe2O3", 1.5), ("Co", "Co3O4", 45),
    ("Ni", "NiO", 25), ("Cu", "CuO", 10), ("Zn", "ZnO", 3), ("Al", "Al2O3", 2), ("Ga", "Ga2O3", 400), ("In", "In2O3", 400),
    ("Sn", "SnO2", 30), ("Pb", "PbO", 3), ("Bi", "Bi2O3", 20), ("Sb", "Sb2O3", 10),
    ("Be", "BeO", 600), ("B", "B2O3", 3), ("Si", "SiO2", 2), ("Ge", "GeO2", 1500), ("Rb", "Rb2CO3", 1500), ("Cs", "Cs2CO3", 1000),
    ("Eu", "Eu2O3", 40), ("Tb", "Tb4O7", 1000), ("Ho", "Ho2O3", 60), ("Tm", "Tm2O3", 500), ("Lu", "Lu2O3", 700),
    ("Cd", "CdO", 15), ("Tl", "Tl2O3", 500), ("Se", "SeO2", 50), ("Te", "TeO2", 100), ("Re", "Re2O7", 1000),
    ("Ru", "RuO2", 9000), ("Ir", "IrO2", 130000), ("Rh", "Rh", 140000), ("Pd", "Pd", 30000), ("Pt", "Pt", 30000), ("Ag", "Ag", 900), ("Au", "Au", 120000),
]
DEFAULT_ROWS = [{"element": el, "precursor": pre, "price_per_kg": str(pr), "purity_percent": "99", "pack_size_g": "500"} for el, pre, pr in DEFAULT_PRICES]
_TOL = 1e-9

# Standard atomic weights (g/mol, IUPAC abridged). Reference constants - NOT prices.
ATOMIC_MASS = {
    "H": 1.008, "He": 4.0026, "Li": 6.94, "Be": 9.0122, "B": 10.81, "C": 12.011, "N": 14.007, "O": 15.999, "F": 18.998,
    "Ne": 20.180, "Na": 22.990, "Mg": 24.305, "Al": 26.982, "Si": 28.085, "P": 30.974, "S": 32.06, "Cl": 35.45, "Ar": 39.948,
    "K": 39.098, "Ca": 40.078, "Sc": 44.956, "Ti": 47.867, "V": 50.942, "Cr": 51.996, "Mn": 54.938, "Fe": 55.845,
    "Co": 58.933, "Ni": 58.693, "Cu": 63.546, "Zn": 65.38, "Ga": 69.723, "Ge": 72.630, "As": 74.922, "Se": 78.971,
    "Br": 79.904, "Kr": 83.798, "Rb": 85.468, "Sr": 87.62, "Y": 88.906, "Zr": 91.224, "Nb": 92.906, "Mo": 95.95,
    "Tc": 98.0, "Ru": 101.07, "Rh": 102.91, "Pd": 106.42, "Ag": 107.87, "Cd": 112.41, "In": 114.82, "Sn": 118.71,
    "Sb": 121.76, "Te": 127.60, "I": 126.90, "Xe": 131.29, "Cs": 132.91, "Ba": 137.33, "La": 138.91, "Ce": 140.12,
    "Pr": 140.91, "Nd": 144.24, "Pm": 145.0, "Sm": 150.36, "Eu": 151.96, "Gd": 157.25, "Tb": 158.93, "Dy": 162.50,
    "Ho": 164.93, "Er": 167.26, "Tm": 168.93, "Yb": 173.05, "Lu": 174.97, "Hf": 178.49, "Ta": 180.95, "W": 183.84,
    "Re": 186.21, "Os": 190.23, "Ir": 192.22, "Pt": 195.08, "Au": 196.97, "Hg": 200.59, "Tl": 204.38, "Pb": 207.2,
    "Bi": 208.98, "Po": 209.0, "At": 210.0, "Rn": 222.0, "Fr": 223.0, "Ra": 226.0, "Ac": 227.0, "Th": 232.04,
    "Pa": 231.04, "U": 238.03, "Np": 237.0, "Pu": 244.0,
}


# ------------------------------------------------------------------ formula parser
class FormulaError(ValueError):
    pass


_SUB = str.maketrans("₀₁₂₃₄₅₆₇₈₉₊₋", "0123456789+-")
_OPEN = {"(": ")", "[": "]", "{": "}"}
_CLOSE = {v: k for k, v in _OPEN.items()}
_NUM = re.compile(r"\d+(?:\.\d+)?|\.\d+")
_EL = re.compile(r"[A-Z][a-z]?")


def _parse_part(s):
    stack, opens, i, n = [{}], [], 0, len(s)
    while i < n:
        c = s[i]
        if c in _OPEN:
            stack.append({}); opens.append(c); i += 1
        elif c in _CLOSE:
            if len(stack) == 1 or opens.pop() != _CLOSE[c]:
                raise FormulaError("unbalanced brackets")
            grp = stack.pop(); i += 1
            m = _NUM.match(s, i); mult = 1.0
            if m: mult = float(m.group()); i = m.end()
            for el, v in grp.items(): stack[-1][el] = stack[-1].get(el, 0.0) + v * mult
        else:
            m = _EL.match(s, i)
            if not m: raise FormulaError(f"unexpected character '{c}'")
            el = m.group(); i = m.end()
            if el not in ATOMIC_MASS: raise FormulaError(f"unknown element '{el}'")
            m = _NUM.match(s, i); cnt = 1.0
            if m: cnt = float(m.group()); i = m.end()
            stack[-1][el] = stack[-1].get(el, 0.0) + cnt
    if len(stack) != 1: raise FormulaError("unbalanced brackets")
    return stack[0]


def parse_formula(text):
    """'La0.6Sr0.4CoO3' -> {'La': 0.6, 'Sr': 0.4, 'Co': 1.0, 'O': 3.0}.  Understands (), [], {}, subscript digits,
    hydrates written with '·', '•' or '*' (e.g. 'Co(NO3)2·6H2O') and an oxygen-deficiency suffix such as '-δ'."""
    s = str(text if text is not None else "").translate(_SUB).replace("−", "-").replace("–", "-")
    s = re.sub(r"\s+", "", s)
    s = re.sub(r"[-+±](?:δ|Δ|d|x|y|z)$", "", s)
    if not s: raise FormulaError("empty formula")
    total, parts = {}, re.split(r"[·•*]", s)
    for k, part in enumerate(parts):
        mult = 1.0
        if k:
            m = re.match(r"\d+(?:\.\d+)?(?=[A-Z(\[{])", part)
            if m: mult = float(m.group()); part = part[m.end():]
        if not part: raise FormulaError("empty part in formula")
        for el, v in _parse_part(part).items(): total[el] = total.get(el, 0.0) + v * mult
    return {el: round(v, 8) for el, v in total.items() if v > 0}


def molar_mass(comp):
    return sum(ATOMIC_MASS[el] * n for el, n in comp.items())


def cathode_composition(text):
    """Metal stoichiometry of a cathode formula (oxygen is not priced and is dropped)."""
    comp = {el: n for el, n in parse_formula(text).items() if el != "O"}
    if not comp: raise FormulaError("no metal found in the formula")
    return comp


# ------------------------------------------------------------------ price table
class TableFileError(ValueError):
    pass


def _canon(h): return re.sub(r"[^a-z0-9]", "", str(h).lower())


_HEAD = {"element": {"element", "elem", "symbol"}, "precursor": {"precursor", "precursorformula", "compound"},
         "price_per_kg": {"priceperkg", "pricekg", "priceperkilogram", "price"},
         "purity_percent": {"puritypercent", "purity", "puritypct"},
         "pack_size_g": {"packsizeg", "packsize", "pack", "packg", "packsizegrams"}}


def _num(v, label):
    s = re.sub(r"^[\s$€£₹¥]+|[\s$€£₹¥]+$", "", str(v if v is not None else "").replace("\u00a0", " ").strip())
    if s == "": raise ValueError(f"{label} is empty")
    if re.fullmatch(r"\d{1,3}(,\d{3})+(\.\d+)?", s): s = s.replace(",", "")
    try: x = float(s)
    except ValueError: raise ValueError(f"{label} '{v}' is not a number")
    if not math.isfinite(x): raise ValueError(f"{label} '{v}' is not a finite number")
    return x


def _pack_g(v):
    m = re.fullmatch(r"\s*([\d.,]+)\s*(kg|g)?\s*", str(v if v is not None else ""), re.I)
    if not m: raise ValueError(f"pack size '{v}' is not a number (grams, e.g. 500, or '0.5 kg')")
    x = _num(m.group(1), "pack size") * (1000.0 if (m.group(2) or "").lower() == "kg" else 1.0)
    if x <= 0: raise ValueError("pack size must be greater than 0")
    return x


class Entry:
    __slots__ = ("row", "element", "precursor", "purity", "pack_g", "norm_kg", "molar_mass", "k", "per_mol", "source")


class PriceTable:
    """Validated view of the raw rows. Invalid rows are ignored (never repaired or guessed) and reported in `issues`."""

    def __init__(self, rows):
        self.rows = [{c: str(r.get(c, "") if r.get(c, "") is not None else "").strip() for c in COLUMNS} for r in (rows or [])]
        self.entries, self.issues, self.row_report = {}, [], []
        cand = {}
        for i, r in enumerate(self.rows, 1):
            if not any(r.values()):
                self.row_report.append({"i": i, "status": "blank"}); continue
            try: e = self._row(i, r)
            except ValueError as ex:
                self.issues.append({"row": i, "level": "error", "message": f"Row {i}: {ex} - row ignored."})
                self.row_report.append({"i": i, "status": "error", "message": str(ex)}); continue
            cand.setdefault(e.element, []).append(e)
            self.row_report.append({"i": i, "status": "ok", "norm_price_kg": e.norm_kg, "price_per_mol_element": e.per_mol, "used": False})
        for el, es in cand.items():
            es.sort(key=lambda e: (abs(math.log(e.pack_g / REF_PACK_G)), abs(e.purity - REF_PURITY), e.norm_kg, e.row))
            e = es[0]; self.entries[el] = e; self.row_report[e.row - 1]["used"] = True
            if len(es) > 1:
                self.issues.append({"row": e.row, "level": "info", "message": f"{el}: {len(es)} valid rows - using row {e.row} (pack closest to {REF_PACK_G:g} g, then purity closest to {REF_PURITY:g} %)."})
            if abs(e.pack_g - REF_PACK_G) > 1e-9:
                self.issues.append({"row": e.row, "level": "warn", "message": f"{el} (row {e.row}): price is for a {e.pack_g:g} g pack. It is a per-kg price, used as given - it is NOT rescaled to a {REF_PACK_G:g} g pack."})
            if abs(e.purity - REF_PURITY) > 1e-9:
                self.issues.append({"row": e.row, "level": "info", "message": f"{el} (row {e.row}): purity {e.purity:g} % normalised to {REF_PURITY:g} %."})
            if el in {d["element"] for d in DEFAULT_ROWS}:
                self.issues.append({"row": e.row, "level": "info", "message": f"{el}: your row overrides the built-in price estimate."})
        for d in DEFAULT_ROWS:                                   # built-in estimates for every element the admin did not price
            if d["element"] not in self.entries:
                e = self._row(0, d); e.source = "built-in"; self.entries[e.element] = e
        self.fp = hashlib.sha256(json.dumps([REF_PURITY, REF_PACK_G, SYNTH_YIELD, sorted(EXCESS_PCT.items()),
                                             sorted((el, round(e.per_mol, 10)) for el, e in self.entries.items())]).encode()).hexdigest()[:16]

    def _row(self, i, r):
        el = r["element"]
        if not el: raise ValueError("element is empty")
        el = el[:1].upper() + el[1:].lower()
        if el not in ATOMIC_MASS: raise ValueError(f"'{r['element']}' is not an element symbol")
        if el == "O": raise ValueError("oxygen is not priced (it comes from air / the precursors)")
        pre = r["precursor"] or el
        try: comp = parse_formula(pre)
        except FormulaError as ex: raise ValueError(f"precursor '{r['precursor']}' cannot be read ({ex})")
        if el not in comp: raise ValueError(f"precursor '{r['precursor']}' does not contain {el}")
        price = _num(r["price_per_kg"], "price per kg")
        if price <= 0: raise ValueError("price per kg must be greater than 0")
        purity = _num(str(r["purity_percent"]).replace("%", ""), "purity")
        if not (1 < purity <= 100): raise ValueError(f"purity must be a percentage between 1 and 100 (e.g. 99.5), got {r['purity_percent']}")
        pack = _pack_g(r["pack_size_g"])
        e = Entry(); e.row, e.element, e.precursor, e.purity, e.pack_g = i, el, pre, purity, pack
        e.source = "admin"
        e.norm_kg = price * REF_PURITY / purity
        e.molar_mass, e.k = molar_mass(comp), comp[el]
        e.per_mol = e.norm_kg * e.molar_mass / (e.k * 1000.0)        # normalised price of ONE MOLE of the element
        return e


# ------------------------------------------------------------------ csv io (storage folder)
def parse_csv_text(text):
    """-> list of raw row dicts (only the five known columns)."""
    text = text.lstrip("\ufeff")
    rd = csv.reader(io.StringIO(text))
    try: head = next(rd)
    except StopIteration: raise TableFileError("The CSV file is empty (no header row).")
    idx = {}
    for j, h in enumerate(head):
        for key, al in _HEAD.items():
            if _canon(h) in al and key not in idx: idx[key] = j
    missing = [c for c in COLUMNS if c not in idx]
    if missing: raise TableFileError("Missing column(s): " + ", ".join(missing) + ". Expected header: " + ",".join(COLUMNS))
    out = []
    for row in rd:
        if not any(str(x).strip() for x in row): continue
        out.append({c: (row[idx[c]] if idx[c] < len(row) else "") for c in COLUMNS})
    return out


_LOCK = threading.Lock()


def csv_text(rows):
    buf = io.StringIO(); w = csv.writer(buf, lineterminator="\n"); w.writerow(COLUMNS)
    for r in rows:
        if any(str(r.get(c, "")).strip() for c in COLUMNS): w.writerow([str(r.get(c, "")).strip() for c in COLUMNS])
    return buf.getvalue()


def write_csv(path, rows):
    """Atomic write (temp file + replace) so a screening running at the same moment never reads a half-written table."""
    path = Path(path)
    with _LOCK:
        fd, tmp = tempfile.mkstemp(dir=str(path.parent), prefix=".prices_", suffix=".tmp")
        try:
            with os.fdopen(fd, "w", encoding="utf-8", newline="") as f: f.write(csv_text(rows))
            os.replace(tmp, path)
        finally:
            if os.path.exists(tmp): os.unlink(tmp)


def read_rows(path):
    p = Path(path)
    if not p.exists(): return []
    return parse_csv_text(p.read_text(encoding="utf-8-sig"))


# ------------------------------------------------------------------ cost estimate
def cost_index(formula, table):
    """Estimated precursor cost (USD per kg of cathode) of one composition. status 'OK' or 'NA' (never guesses a missing price)."""
    try:
        full = parse_formula(formula)
        comp = cathode_composition(formula)
    except FormulaError as ex:
        return {"status": "NA", "index": None, "composition": {}, "parts": [], "missing": [], "reason": f"Cost not available: the formula could not be read ({ex})."}
    missing = [el for el in comp if el not in table.entries]
    if missing:
        return {"status": "NA", "index": None, "composition": comp, "parts": [], "missing": missing, "reason": "Cost not available: no price for " + ", ".join(missing) + "."}
    m_cat = molar_mass(full)                                    # theoretical g per mole of cathode (oxygen included)
    parts, tot = [], 0.0
    for el, n in comp.items():
        e = table.entries[el]; xs = EXCESS_PCT.get(el, EXCESS_DEFAULT)
        mol_pre = n / e.k * (1 + xs / 100.0)                    # mol of precursor per mol of cathode
        mass_g = mol_pre * e.molar_mass                         # g of precursor per mol of cathode
        c = mass_g / 1000.0 * e.norm_kg                         # USD per mol of cathode
        tot += c
        parts.append({"element": el, "n": n, "precursor": e.precursor, "norm_price_kg": e.norm_kg, "excess_pct": xs, "mol_precursor": mol_pre,
                      "mass_g": mass_g, "cost": c, "pack_g": e.pack_g, "purity": e.purity, "source": e.source})
    for p in parts: p["share"] = p["cost"] / tot if tot else 0.0
    kg_cat = m_cat / 1000.0 * SYNTH_YIELD                       # kg of cathode actually obtained per mole
    return {"status": "OK", "index": tot / kg_cat, "cost_per_mol": tot, "cathode_molar_mass": m_cat, "yield_pct": SYNTH_YIELD * 100,
            "currency": CURRENCY, "unit": f"{CURRENCY}/kg", "composition": comp, "parts": parts, "missing": [], "reason": None}


def _tier(idx, cheap_max, expensive_min):
    if cheap_max is None: return "MODERATE"
    if idx <= cheap_max * (1 + _TOL): return "CHEAP"
    if idx > expensive_min * (1 + _TOL): return "EXPENSIVE"
    return "MODERATE"


def _finish(r, res, info, pre):
    """Merge the cost estimate into a row dict. The cost NEVER changes the PASS / FAIL result: `final` only reflects the earlier stages."""
    d = r["detail"]; fails, nas = list(pre["fails"]), list(pre["nas"])
    r["cost"], r["cost_result"] = info["index"], res
    r["final"] = "FAIL" if fails else ("INCOMPLETE" if nas else "PASS")
    r["reason"] = " | ".join(fails) if fails else "; ".join(nas)
    d["fails"], d["not_available"], d["cost"] = fails, nas, info


def apply_stage(rows, table):
    """Cost estimate for a whole screening. `rows` are the row dicts (formula, detail{fails, not_available}); they are updated in place.
    Safe to call again after the prices changed (uses detail['pre_cost'])."""
    cache, priced = {}, []
    for r in rows:
        d = r["detail"]; pre = d.setdefault("pre_cost", {"fails": list(d.get("fails", [])), "nas": list(d.get("not_available", []))})
        f = str(r["formula"]); info = cache.get(f) or cache.setdefault(f, cost_index(f, table)); r["_info"], r["_pre"] = dict(info), pre
        if info["status"] == "OK": priced.append(r)
    n = len(priced); costs = sorted(r["_info"]["index"] for r in priced); k = n // 3
    cheap_max = costs[k - 1] if k else None; expensive_min = costs[n - k - 1] if k else None
    for r in rows:
        info, pre = r.pop("_info"), r.pop("_pre")
        info.update({"rank": None, "n_priced": n, "cheap_max": cheap_max, "expensive_min": expensive_min, "rule": RULE_TEXT})
        if info["status"] != "OK": _finish(r, "NOT AVAILABLE", info, pre); continue
        info["rank"] = 1 + sum(1 for c in costs if c < info["index"] * (1 - _TOL))
        _finish(r, _tier(info["index"], cheap_max, expensive_min), info, pre)
    na_rows = [r for r in rows if r["cost_result"] == "NOT AVAILABLE"]
    missing = sorted({m for r in na_rows for m in r["detail"]["cost"].get("missing", [])})
    cnt = lambda v: sum(1 for r in rows if r["cost_result"] == v)
    return {"fp": table.fp, "status": "partial" if na_rows else "ok", "rule": RULE_TEXT, "unit": f"{CURRENCY}/kg", "yield_pct": SYNTH_YIELD * 100,
            "n_priced": n, "cheap_max": cheap_max, "expensive_min": expensive_min, "median": costs[n // 2] if n else None,
            "cheap": cnt("CHEAP"), "moderate": cnt("MODERATE"), "expensive": cnt("EXPENSIVE"), "not_available": len(na_rows),
            "missing_elements": missing, "builtin_elements": len([1 for e in table.entries.values() if e.source == "built-in"]),
            "table_errors": sum(1 for i in table.issues if i["level"] == "error")}


def apply_single(x, table, pool):
    """Cost estimate for ONE predicted cathode; the Cheap / Moderate / Expensive level compares it with the last screening (`pool` = summary['cost'])."""
    d = x["detail"]; pre = d.setdefault("pre_cost", {"fails": list(d.get("fails", [])), "nas": list(d.get("not_available", []))})
    info = cost_index(x["formula"] if x.get("formula") and x["formula"] != "New cathode" else "", table)
    if info["status"] == "NA" and not info["composition"] and not info["missing"]:
        info["reason"] = "Cost not available: enter the cathode formula so its precursor cost can be estimated."
    pool = pool or {}; cheap_max, expensive_min = pool.get("cheap_max"), pool.get("expensive_min")
    info.update({"rank": None, "n_priced": pool.get("n_priced", 0), "cheap_max": cheap_max, "expensive_min": expensive_min, "rule": RULE_TEXT, "vs_last_screening": True})
    if info["status"] != "OK": _finish(x, "NOT AVAILABLE", info, pre)
    elif cheap_max is None:
        info["note"] = "The Cheap / Moderate / Expensive level compares with the cathodes of a screening, and this dataset has no usable one yet."
        _finish(x, "NOT AVAILABLE", info, pre)
    else: _finish(x, _tier(info["index"], cheap_max, expensive_min), info, pre)
    return x


# ------------------------------------------------------------------ funnel + summary
def funnel(rows):
    """Sequential survivors. Batch screening: screened -> TEC -> log10(k*) -> Ehull -> final PASS (applicability domain and cost are information only).
    Results made by the older dataset-training flow keep their old stages: AD -> Ehull -> ORR."""
    total = len(rows); cur = list(rows); out = [{"key": "screened", "label": "Cathodes screened", "rule": "", "entered": total, "passed": total, "failed": 0, "na": 0}]
    if any(r.get("tec_result") for r in rows):
        stages = (("tec", "Thermal expansion (TEC)", "predicted TEC ≤ 15 ×10⁻⁶ K⁻¹", "tec_result"),
                  ("orr", "Active (log10 k*)", "predicted log10(k*) ≥ −6.40 log₁₀(cm/s)", "orr_result"),
                  ("ehull", "Stable (Ehull)", "predicted Ehull ≤ 57 meV/atom", "ehull_result"))
    else:
        stages = (("ad", "Inside applicability domain", "Mahalanobis distance ≤ AD threshold", "ad_result"),
                  ("ehull", "Stable (Ehull)", "Ehull ≤ 57 meV/atom", "ehull_result"),
                  ("orr", "Active (ORR)", "predicted log10(k*) ≥ −6.40 log₁₀(cm/s)", "orr_result"))
    for key, label, rule, f in stages:
        p = [r for r in cur if r[f] == "PASS"]; na = sum(1 for r in cur if r[f] == "NOT AVAILABLE")
        out.append({"key": key, "label": label, "rule": rule, "entered": len(cur), "passed": len(p), "failed": len(cur) - len(p) - na, "na": na}); cur = p
    out.append({"key": "final", "label": "Final PASS", "rule": "passes every filter", "entered": len(cur), "passed": len(cur), "failed": 0, "na": 0})
    return out


def summary_fields(rows, cs):
    cnt = lambda v: sum(1 for r in rows if r["final"] == v)
    return {"PASS": cnt("PASS"), "FAIL": cnt("FAIL"), "INCOMPLETE": cnt("INCOMPLETE"), "pass_pct": round(100 * cnt("PASS") / max(len(rows), 1), 1),
            "cost": cs, "cost_cheap": cs["cheap"], "cost_moderate": cs["moderate"], "cost_expensive": cs["expensive"], "cost_not_available": cs["not_available"], "funnel": funnel(rows)}
