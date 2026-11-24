"""Units of every model input (feature), every output and every screening filter.
Same table as frontend/units.js - keep the two in step. "" = dimensionless (ratio, index, count or log of a dimensionless number).
Sa (ionic Lewis acidity) is in valence units (v.u.)."""
TEC = "x1e-6 1/K"
EHULL = "meV/atom"

UNITS = {
    "Ion_A": "eV", "Ion_B": "eV", "EN_A": "", "EN_B": "", "R_A": "Å", "R_B": "Å", "Sa_A": "v.u.", "Sa_B": "v.u.",
    "Delec_B": "electrons", "t": "", "Ionic_A": "", "Ionic_B": "", "Avg_Ionic_Character": "",
    "SmithAcid_A": "", "SmithAcid_B": "", "1000/T": "x1e3 1/K",
    "Work_Function": "eV", "O_pband": "eV", "Log_dieletric": "", "Oxide_vacancy": "eV", "Gap": "eV",
    "Bulk_Ionic": "S/cm", "Total_Electronic": "S/cm", "ASR": "Ω·cm²",
    "E_above_hull": EHULL, "TEC": TEC,
}


def unit(name):
    return UNITS.get(name, "")


def with_unit(name, text=None):
    """'Ion_A' -> 'Ion_A (eV)'; a name without a known unit is returned unchanged."""
    u = unit(name)
    t = name if text is None else text
    return f"{t} ({u})" if u else t
