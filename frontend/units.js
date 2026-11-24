/* Units of every model input (feature), every output and every screening filter - ONE table used all over the app.
   (backend/units.py holds the same table for the Excel/CSV export and the admin Model-details page - keep the two in step.)
   "" = a dimensionless quantity (ratio, index, count or log of a dimensionless number).
   Sa (ionic Lewis acidity) is given in valence units (v.u., Brown's Lewis acid strength). */
(function (root) {
"use strict";
const LOGK = "log₁₀(cm/s)", TEC = "×10⁻⁶ K⁻¹", EH = "meV/atom", COST = "USD/kg", TEMP = "°C";
const UNITS = {
  /* 15 formula descriptors */
  Ion_A: "eV", Ion_B: "eV", EN_A: "", EN_B: "", R_A: "Å", R_B: "Å", Sa_A: "v.u.", Sa_B: "v.u.",
  Delec_B: "electrons", t: "", Ionic_A: "", Ionic_B: "", Avg_Ionic_Character: "",
  SmithAcid_A: "", SmithAcid_B: "",
  /* temperature input */
  "1000/T": "10³ K⁻¹",
  /* material properties (inputs) */
  Work_Function: "eV", O_pband: "eV", Log_dieletric: "", Oxide_vacancy: "eV", Gap: "eV",
  /* extra features on the Predict page (not model inputs) */
  "σ_ion": "S/cm", "σ_total": "S/cm", ASR: "Ω·cm²", _x1: "S/cm", _x2: "S/cm", _x4: "Ω·cm²",
  Bulk_Ionic: "S/cm", Total_Electronic: "S/cm",
  /* outputs predicted by the models */
  E_above_hull: EH, TEC: TEC, Temperature: TEMP
};
/* names a dataset / table may use for the same quantity (matched after lower-casing and dropping every non-alphanumeric) */
const ALIAS = { iona: "Ion_A", ionb: "Ion_B", ena: "EN_A", enb: "EN_B", ra: "R_A", rb: "R_B", saa: "Sa_A", sab: "Sa_B", delecb: "Delec_B", tolerancefactor: "t",
  ionica: "Ionic_A", ionicb: "Ionic_B", avgioniccharacter: "Avg_Ionic_Character", smithacida: "SmithAcid_A", smithacidb: "SmithAcid_B",
  "1000t": "1000/T", bandgap: "Gap", ovacancy: "Oxide_vacancy", workfunction: "Work_Function", opband: "O_pband", opbandcenter: "O_pband",
  logdielectric: "Log_dieletric", logdieletric: "Log_dieletric", eabovehull: "E_above_hull", ehull: "E_above_hull", energyabovehull: "E_above_hull",
  tec: "TEC", logkstar: "LOGK", logk: "LOGK", log10kstar: "LOGK", log10k: "LOGK", kstar: "KSTAR", temperature: "Temperature", tc: "Temperature" };
const EXTRA = { LOGK: LOGK, KSTAR: "cm/s" };
const norm = s => String(s == null ? "" : s).toLowerCase().replace(/[^a-z0-9]/g, "");
const NORM = {}; Object.keys(UNITS).forEach(k => { NORM[norm(k)] = UNITS[k]; });
Object.keys(ALIAS).forEach(a => { const k = ALIAS[a]; NORM[a] = UNITS[k] || EXTRA[k]; });
/* unit text for a feature key / column name ("" when unknown) */
function unit(name) { if (name == null) return ""; if (UNITS[name] !== undefined) return UNITS[name]; return NORM[norm(name)] || ""; }
/* "Band gap (eV)" - plain text, safe inside <option>, SVG text and tooltips */
function label(text, name) { const u = unit(name == null ? text : name); return u ? text + " (" + u + ")" : text; }
root.UNITS = { table: UNITS, unit, label, LOGK, TEC, EH, COST, TEMP };
})(typeof window !== "undefined" ? window : globalThis);
