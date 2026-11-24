/* Descriptors calculated from the cathode formula alone (the 15 "basic" descriptors).
   Per-element values were calibrated on SCOPE_Master_Combined_Dataset.xlsx (334 compositions, 12 A-site + 21 B-site elements): all but five of its
   perovskites are reproduced exactly (see README). A site descriptor is the stoichiometry-weighted mean over the
   elements on that site. Elements that are not in the tables are NOT guessed - their fields stay empty for manual entry.
   Row order: [Ion, EN, R, Sa, Ionicity, SmithAcidity, (B-site only) d-electrons]. R = Shannon radius (A: 12-coord, B: 6-coord). */
(function (root) {
"use strict";
const A = {
  Ba:[10.0,1.087,1.61,0.194,0.7643,-10.8],
  Bi:[25.56,1.399,1.17,0.436,0.7344,-3.5],
  Ca:[11.87,1.092,1.34,0.264,0.7639,-7.5],
  Cs:[3.89,0.946,1.88,0.088,0.7788,-13.0],
  Dy:[22.8,1.293,1.24,0.396,0.7453,-4.7],
  Gd:[20.63,1.263,1.27,0.371,0.7481,-5.0],
  La:[19.18,1.225,1.36,0.343,0.7517,-6.1],
  Nd:[22.1,1.256,1.31,0.363,0.7488,-5.7],
  Pr:[21.62,1.258,1.32,0.326,0.7486,-5.8],
  Rb:[4.18,0.961,1.72,0.097,0.7774,-12.7],
  Sm:[23.4,1.283,1.28,0.38,0.7463,-5.1],
  Sr:[11.03,1.093,1.44,0.222,0.7638,-9.4]
};
const B = {
  Al:[28.43,1.61,0.5,0.583,0.714,-2.0,0.0],
  Ce:[36.76,1.608,0.87,0.45,0.7139,-2.7,0.0],
  Co:[33.5,1.69,0.55,0.5,0.7058,-3.8,6.0],
  Cr:[30.96,1.59,0.62,0.5,0.7161,6.6,3.0],
  Cu:[20.29,1.37,0.73,0.374,0.7372,-2.5,9.0],
  Fe:[30.65,1.65,0.55,0.528,0.7099,-1.7,5.0],
  Ga:[28.0,1.81,0.62,0.65,0.6933,-1.6,0.0],
  Hf:[33.33,1.706,0.71,0.59,0.7043,-3.1,0.0],
  In:[28.03,1.81,0.8,0.495,0.6941,-2.4,0.0],
  Mg:[15.03,1.31,0.72,0.334,0.7451,-4.5,0.0],
  Mn:[33.67,1.6275,0.58,0.513,0.7122,-1.92,4.0],
  Mo:[68.83,2.101,0.59,1.185,0.6655,5.2,0.0],
  Nb:[50.57,1.86,0.64,0.835,0.6892,1.0,0.0],
  Ni:[35.19,1.7,0.56,0.502,0.7048,-2.4,7.0],
  Sb:[56.0,1.971,0.6,0.833,0.6783,2.3,0.0],
  Sc:[24.76,1.42,0.885,0.481,0.733,0.0,0.0],
  Sn:[40.73,1.85,0.69,0.714,0.6901,1.5,0.0],
  Ti:[43.27,1.73,0.605,0.676,0.7016,0.7,0.0],
  Y:[28.865,1.275,0.81,0.515,0.7484,-3.2,0.0],
  Zn:[17.96,1.336,0.74,0.405,0.7407,-3.2,0.0],
  Zr:[28.865,1.275,0.81,0.515,0.7484,-3.2,0.0]
};
const O_R = 1.40;   /* Shannon radius of O2- (6-coord) used in the Goldschmidt tolerance factor */

function site(rows, tab, hasD) {
  const list = rows.filter(r => r.el && r.n > 0), tot = list.reduce((a, r) => a + r.n, 0);
  const unknown = list.filter(r => !tab[r.el]).map(r => r.el);
  if (!list.length || unknown.length) return { ok: false, unknown, tot };
  const m = i => list.reduce((a, r) => a + tab[r.el][i] * r.n / tot, 0);
  return { ok: true, tot, ion: m(0), en: m(1), r: m(2), sa: m(3), ionic: m(4), sm: m(5), d: hasD ? m(6) : null };
}
/* comp = {A:[[el,n],..], B:[[el,n],..]} (indexes as typed; normalised here) */
function compute(comp) {
  const a = site((comp.A || []).map(x => ({ el: x[0], n: x[1] })), A, false), b = site((comp.B || []).map(x => ({ el: x[0], n: x[1] })), B, true);
  const v = {}, round = (x, k) => +x.toFixed(k);
  if (a.ok) { v.Ion_A = round(a.ion, 4); v.EN_A = round(a.en, 4); v.R_A = round(a.r, 4); v.Sa_A = round(a.sa, 4); v.Ionic_A = round(a.ionic, 4); v.SmithAcid_A = round(a.sm, 4); }
  if (b.ok) { v.Ion_B = round(b.ion, 4); v.EN_B = round(b.en, 4); v.R_B = round(b.r, 4); v.Sa_B = round(b.sa, 4); v.Ionic_B = round(b.ionic, 4); v.SmithAcid_B = round(b.sm, 4); v.Delec_B = round(b.d, 4); }
  if (a.ok && b.ok) {
    v.t = round((a.r + O_R) / (Math.SQRT2 * (b.r + O_R)), 4);
    v.Avg_Ionic_Character = round((a.tot * a.ionic + b.tot * b.ionic) / (a.tot + b.tot), 4);
  }
  return { values: v, unknownA: a.unknown || [], unknownB: b.unknown || [] };
}
root.DESC_CALC = { compute, A, B };
if (typeof module !== "undefined" && module.exports) module.exports = root.DESC_CALC;
})(typeof window !== "undefined" ? window : globalThis);
