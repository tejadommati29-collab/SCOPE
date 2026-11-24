/* Predict-single-cathode input helper: element autocomplete + automatic formula recognition.
   Self-contained (no dependency on app.js). Used by P.predict / runPredict through window.FX.
   Parser / classifier / validator are pure functions, so they can also be tested in Node. */
(function (root) {
"use strict";

/* ---------------- periodic table (all 118 elements, in atomic-number order) ---------------- */
const SYM = {};
("H Hydrogen,He Helium,Li Lithium,Be Beryllium,B Boron,C Carbon,N Nitrogen,O Oxygen,F Fluorine,Ne Neon,Na Sodium,Mg Magnesium,Al Aluminium,Si Silicon,P Phosphorus,S Sulfur,Cl Chlorine,Ar Argon,K Potassium,Ca Calcium," +
 "Sc Scandium,Ti Titanium,V Vanadium,Cr Chromium,Mn Manganese,Fe Iron,Co Cobalt,Ni Nickel,Cu Copper,Zn Zinc,Ga Gallium,Ge Germanium,As Arsenic,Se Selenium,Br Bromine,Kr Krypton,Rb Rubidium,Sr Strontium,Y Yttrium,Zr Zirconium," +
 "Nb Niobium,Mo Molybdenum,Tc Technetium,Ru Ruthenium,Rh Rhodium,Pd Palladium,Ag Silver,Cd Cadmium,In Indium,Sn Tin,Sb Antimony,Te Tellurium,I Iodine,Xe Xenon,Cs Caesium,Ba Barium,La Lanthanum,Ce Cerium,Pr Praseodymium,Nd Neodymium," +
 "Pm Promethium,Sm Samarium,Eu Europium,Gd Gadolinium,Tb Terbium,Dy Dysprosium,Ho Holmium,Er Erbium,Tm Thulium,Yb Ytterbium,Lu Lutetium,Hf Hafnium,Ta Tantalum,W Tungsten,Re Rhenium,Os Osmium,Ir Iridium,Pt Platinum,Au Gold,Hg Mercury," +
 "Tl Thallium,Pb Lead,Bi Bismuth,Po Polonium,At Astatine,Rn Radon,Fr Francium,Ra Radium,Ac Actinium,Th Thorium,Pa Protactinium,U Uranium,Np Neptunium,Pu Plutonium,Am Americium,Cm Curium,Bk Berkelium,Cf Californium,Es Einsteinium,Fm Fermium," +
 "Md Mendelevium,No Nobelium,Lr Lawrencium,Rf Rutherfordium,Db Dubnium,Sg Seaborgium,Bh Bohrium,Hs Hassium,Mt Meitnerium,Ds Darmstadtium,Rg Roentgenium,Cn Copernicium,Nh Nihonium,Fl Flerovium,Mc Moscovium,Lv Livermorium,Ts Tennessine,Og Oganesson")
  .split(",").forEach((p, i) => { const [s, n] = p.split(" "); SYM[s] = { s, n, z: i + 1 }; });
const EL = Object.keys(SYM).map(k => SYM[k]);

/* ---------------- chemistry rules ---------------- */
const set = s => new Set(s.split(" "));
const NOBLE = set("He Ne Ar Kr Xe Rn Og");
const RADIO = set("Tc Pm Po At Fr Ra Ac Th Pa U");
const A_SURE = set("Na K Rb Cs Ca Sr Ba La Nd Sm Eu Gd Dy Ho Er Tm Yb Lu Pm");                       // large cations -> A-site
const B_SURE = set("Sc Ti V Cr Mn Fe Co Ni Cu Zn Al Ga Ge Zr Nb Mo Ru Rh Pd In Sn Sb Hf Ta W Re Os Ir Pt Au Mg"); // small / transition cations -> B-site
const AMBIG = set("Ce Pr Tb Y Bi Pb Ag Tl Li Cd Hg Th U");                                         // can be A or B: decided by the stoichiometry, never guessed
/* usual oxidation-state range [lowest, highest]; a single value = fixed valence. Anions are negative. */
const OX = {
  Li: [1], Na: [1], K: [1], Rb: [1], Cs: [1], Be: [2], Mg: [2], Ca: [2], Sr: [2], Ba: [2], Sc: [3], Y: [3], La: [3], Ce: [3, 4], Pr: [3, 4], Nd: [3], Pm: [3],
  Sm: [2, 3], Eu: [2, 3], Gd: [3], Tb: [3, 4], Dy: [3], Ho: [3], Er: [3], Tm: [3], Yb: [2, 3], Lu: [3], Ti: [3, 4], Zr: [4], Hf: [4], V: [3, 5], Nb: [3, 5], Ta: [5],
  Cr: [3, 6], Mo: [4, 6], W: [4, 6], Mn: [2, 4], Fe: [2, 4], Co: [2, 4], Ni: [2, 4], Cu: [1, 3], Zn: [2], Cd: [2], Hg: [2], Al: [3], Ga: [3], In: [3], Tl: [1, 3],
  Ge: [2, 4], Sn: [2, 4], Pb: [2, 4], Sb: [3, 5], Bi: [3, 5], Ru: [3, 5], Rh: [3, 4], Pd: [2, 4], Ir: [3, 4], Pt: [2, 4], Re: [4, 7], Os: [4, 6], Ag: [1], Au: [1, 3],
  Th: [4], U: [4, 6], F: [-1], Cl: [-1], Br: [-1], I: [-1], N: [-3], S: [-2], Se: [-2]
};
const TOL_SITE = 0.02, TOL_Q = 0.05;

/* ---------------- helpers ---------------- */
const esc = s => String(s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const fmtN = n => (n == null || !isFinite(n)) ? "" : String(+(+n).toFixed(4));
const idx = n => Math.abs(n - 1) < 1e-9 ? "" : fmtN(n);
const sumSite = (rows, site) => rows.filter(r => r.site === site && r.n > 0).reduce((a, r) => a + r.n, 0);
const NUMAT = /^(\d+\.?\d*|\.\d+)/;

/* ---------------- parser ---------------- */
function parseGroup(s, i, closer, errs) {
  const list = [], CL = { "(": ")", "[": "]", "{": "}" };
  while (i < s.length) {
    const c = s[i];
    if (c === closer) return { list, i };
    if (CL[c]) {
      const r = parseGroup(s, i + 1, CL[c], errs);
      if (r.i >= s.length || s[r.i] !== CL[c]) { errs.push(`Unbalanced bracket '${c}' – a closing '${CL[c]}' is missing.`); return { list: list.concat(r.list), i: s.length }; }
      i = r.i + 1;
      const m = NUMAT.exec(s.slice(i)); let mult = 1;
      if (m) { mult = parseFloat(m[0]); i += m[0].length; }
      r.list.forEach(x => list.push({ el: x.el, n: x.n * mult, explicit: x.explicit || !!m }));
      continue;
    }
    if (c === ")" || c === "]" || c === "}") { errs.push(`Unexpected '${c}' at position ${i + 1} – no matching opening bracket.`); i++; continue; }
    const rest = s.slice(i), m2 = /^[A-Z][a-z]/.exec(rest);
    let el = null;
    if (m2 && SYM[m2[0]]) el = m2[0];
    else if (/^[A-Z]/.test(rest) && SYM[rest[0]]) {
      if (m2) { errs.push(`'${m2[0]}' (position ${i + 1}) is not an element symbol.`); i += 2; continue; }
      el = rest[0];
    } else {
      const ch = rest[0];
      errs.push(/[a-z]/.test(ch) ? `Unexpected '${ch}' at position ${i + 1} – element symbols start with a capital letter (Co, not co or CO).`
        : /\d|\./.test(ch) ? `Unexpected '${ch}' at position ${i + 1} – an index must follow an element.`
        : `Unexpected '${ch}' at position ${i + 1}.`);
      i++; continue;
    }
    i += el.length;
    const m = NUMAT.exec(s.slice(i)); let n = 1, explicit = false;
    if (m) { n = parseFloat(m[0]); i += m[0].length; explicit = true; }
    list.push({ el, n, explicit });
  }
  return { list, i };
}

/* oxygen deficiency written as O3-δ, O(3-δ), O3-0.05, O3+δ ... */
const RE_DEF = /O(?:\(\s*(\d*\.?\d+)\s*([-+])\s*(δ|Δ|[dxyz]|\d*\.?\d+)\s*\)|(\d*\.?\d+)?([-+±])(δ|Δ|[dxyz]|\d*\.?\d+))/;

function parse(text) {
  const res = { items: [], O: { n: 0, present: false, implied: false }, delta: { sym: false, val: null }, errors: [], warnings: [] };
  let s = String(text == null ? "" : text).replace(/[₀-₉]/g, c => "₀₁₂₃₄₅₆₇₈₉".indexOf(c)).replace(/[−–—]/g, "-").replace(/\s+/g, "");
  if (!s) return res;
  s = s.replace(RE_DEF, function (m, b1, s1, d1, b2, s2, d2) {
    const b = b1 !== undefined ? b1 : b2, sg = s1 || s2, d = d1 !== undefined ? d1 : d2;
    let base = b !== undefined ? parseFloat(b) : null;
    if (base == null) { res.warnings.push("Oxygen index is missing before the δ term – ABO3 (3) assumed."); base = 3; }
    if (/^[δΔdxyz]$/.test(d) || sg === "±") { res.delta = { sym: true, val: null }; return "O" + fmtN(base); }
    const v = parseFloat(d);
    res.delta = { sym: false, val: sg === "-" ? v : -v };
    return "O" + fmtN(sg === "-" ? base - v : base + v);
  });
  const r = parseGroup(s, 0, null, res.errors);
  let oN = 0, oExplicit = false;
  r.list.forEach(x => { if (x.el === "O") { oN += x.n; res.O.present = true; if (x.explicit) oExplicit = true; } else res.items.push(x); });
  res.O.n = oN; res.O.implied = res.O.present && !oExplicit;
  res.errors = res.errors.slice(0, 3);
  return res;
}

/* ---------------- A-site / B-site recognition ---------------- */
function classify(items) {
  const rows = [], amb = [], notes = [];
  items.forEach(it => {
    let site = "X";
    if (A_SURE.has(it.el)) site = "A"; else if (B_SURE.has(it.el)) site = "B"; else if (AMBIG.has(it.el)) site = null;
    const row = { el: it.el, n: it.n, site, implied: !it.explicit };
    rows.push(row); if (site === null) amb.push(row);
  });
  if (amb.length) {
    const sA = sumSite(rows, "A"), sB = sumSite(rows, "B"), T = amb.reduce((a, r) => a + r.n, 0), tol = 0.03;
    const openA = sA < 1 - tol, openB = sB < 1 - tol, fitA = Math.abs(T - (1 - sA)) <= tol, fitB = Math.abs(T - (1 - sB)) <= tol;
    let to = null;
    if (!openA && openB) to = "B"; else if (openA && !openB) to = "A";
    else if (openA && openB) { if (fitA && !fitB) to = "A"; else if (fitB && !fitA) to = "B"; }
    const names = amb.map(r => r.el).join(", ");
    amb.forEach(r => { r.site = to || "X"; });
    notes.push(to ? { l: "info", t: `${names} can sit on the A- or the B-site. It was placed on the ${to}-site from the site totals – please check it.` }
                  : { l: "warn", t: `${names} could be A-site or B-site and the stoichiometry does not decide it. It is listed under "Additional components" – move it to the correct site below.` });
  }
  const odd = rows.filter(r => r.site === "X" && !AMBIG.has(r.el)).map(r => r.el);
  if (odd.length) notes.push({ l: "info", t: `${odd.join(", ")} ${odd.length > 1 ? "are" : "is"} neither a typical A- nor B-site cation, so ${odd.length > 1 ? "they are" : "it is"} listed under "Additional components".` });
  return { rows, notes };
}

/* ---------------- charge neutrality (usual oxidation-state ranges) ---------------- */
function chargeCheck(rows, nO) {
  let lo = 0, hi = 0, fixed = 0; const vars = [], missing = [];
  rows.forEach(r => {
    if (!r.el || !SYM[r.el] || !(r.n > 0) || r.el === "O") return;
    const q = OX[r.el];
    if (!q) { missing.push(r.el); return; }
    const a = q[0], b = q[q.length - 1];
    lo += r.n * a; hi += r.n * b;
    if (a === b) fixed += r.n * a; else vars.push({ r, a, b });
  });
  if (missing.length) return { l: "info", t: `Charge-neutrality check skipped: no oxidation-state data for ${[...new Set(missing)].join(", ")}.` };
  const T = 2 * nO, q = x => (Math.round(x * 100) / 100).toFixed(2);
  if (!vars.length) {
    const d = fixed - T;
    return Math.abs(d) <= TOL_Q ? { l: "ok", t: `Charge neutral: cations +${q(fixed)} balance oxygen −${q(T)}.` }
      : { l: "warn", t: `Not charge neutral with the usual oxidation states: cations give +${q(fixed)} but oxygen needs +${q(T)} (difference ${d > 0 ? "+" : ""}${q(d)}). Check the indexes or δ.` };
  }
  if (vars.length === 1) {
    const v = vars[0], need = (T - fixed) / v.r.n, rng = v.a === v.b ? v.a + "+" : `${v.a}–${v.b}+`;
    return need >= v.a - TOL_Q && need <= v.b + TOL_Q
      ? { l: "ok", t: `Charge balanced if ${v.r.el} has an average oxidation state of ${q(need)}+ (usual range ${rng}).` }
      : { l: "warn", t: `Charge cannot be balanced: ${v.r.el} would need ${q(need)}+, outside its usual range ${rng}. Check the indexes or δ.` };
  }
  const names = vars.map(v => v.r.el).join(", ");
  return T >= lo - TOL_Q && T <= hi + TOL_Q
    ? { l: "ok", t: `Charge balance is possible, but ${names} are multivalent, so their individual oxidation states are not unique.` }
    : { l: "warn", t: `Charge cannot be balanced: the cations can supply +${q(lo)} to +${q(hi)}, oxygen needs +${q(T)}. Check the indexes or δ.` };
}

/* ---------------- validation of the (possibly hand-edited) state ---------------- */
function validate(st) {
  const out = [], push = (l, t) => out.push({ l, t }), rows = st.rows;
  const named = rows.filter(r => r.el);
  rows.forEach(r => {
    if (!r.el) { push("err", "A row has no element – choose one or remove the row."); return; }
    if (!SYM[r.el]) { push("err", `'${r.el}' is not a valid element symbol.`); return; }
    if (r.el === "O") push("err", "Oxygen belongs in the Oxygen field, not in a site row.");
    if (!(r.n > 0) || !isFinite(r.n)) push("err", `The index of ${r.el} must be a number greater than 0.`);
    if (NOBLE.has(r.el)) push("err", `${r.el} is a noble gas – not supported in a perovskite oxide.`);
    else if (RADIO.has(r.el) || SYM[r.el].z >= 93) push("warn", `${r.el} is radioactive/synthetic – there is little property data for it.`);
  });
  const cnt = {}; named.forEach(r => { cnt[r.el] = (cnt[r.el] || 0) + 1; });
  const dups = Object.keys(cnt).filter(k => cnt[k] > 1 && k !== "O");
  if (dups.length) push("err", `Duplicate element${dups.length > 1 ? "s" : ""}: ${dups.map(k => `${k} (${cnt[k]}×)`).join(", ")}. Combine them into one index.`);
  const hasA = rows.some(r => r.site === "A" && r.el), hasB = rows.some(r => r.site === "B" && r.el);
  if (!hasA) push("err", "No A-site element identified (e.g. La, Sr, Ba). Add one in the A-site box.");
  if (!hasB) push("err", "No B-site element identified (e.g. Fe, Co, Mn). Add one in the B-site box.");
  const sA = sumSite(rows, "A"), sB = sumSite(rows, "B");
  if (hasA && hasB && rows.every(r => r.n > 0 || !r.el)) {
    const okA = Math.abs(sA - 1) <= TOL_SITE, okB = Math.abs(sB - 1) <= TOL_SITE;
    if (okA && okB) push("ok", "A-site and B-site totals are both 1 (ABO3 stoichiometry).");
    else if (Math.abs(sA - sB) <= TOL_SITE * Math.max(sA, sB) && sA > 1.5) push("warn", `A-site and B-site totals are both ${fmtN(sA)} – this looks like a doubled / ordered cell (e.g. A2B2O6 or a double perovskite). Fractions are normalised per site, but the model expects ABO3: divide the indexes by ${fmtN(sA)} if you meant a single ABO3 unit.`);
    else {
      [["A", sA, okA], ["B", sB, okB]].forEach(([nm, sm, ok]) => {
        if (ok) return;
        if (sm >= 0.8 && sm <= 1.2) push("warn", `${nm}-site total is ${fmtN(sm)}, not 1 (${nm}-site ${sm < 1 ? "deficiency" : "excess"}?). Doping fractions are normalised to the site total.`);
        else push("err", `${nm}-site total is ${fmtN(sm)} – far from 1, so this is not an ABO3-type composition (or an element is on the wrong site).`);
      });
    }
  }
  /* oxygen */
  if (!(st.O > 0)) push("err", "No oxygen found – this tool handles oxide perovskites. Enter the oxygen index (e.g. O3).");
  else {
    const dbl = Math.abs(sA - sB) <= TOL_SITE * Math.max(sA, sB) && sA > 1.5, nominal = dbl ? 3 * sA : 3;
    if (st.O < 0.7 * nominal) push("err", `Oxygen index ${fmtN(st.O)} is far too low for an ABO3-type oxide (nominal ${fmtN(nominal)}).`);
    else if (st.O > nominal + 0.05) push("warn", `Oxygen index ${fmtN(st.O)} is above the nominal ${fmtN(nominal)} (oxygen excess?).`);
    else if (st.O < nominal - 0.6) push("warn", `Large oxygen deficiency δ = ${fmtN(nominal - st.O)}.`);
    if (st.deltaSym) push("warn", `δ was written as a symbol but no value was given – oxygen is taken as ${fmtN(st.O)} (δ = 0). Enter δ in the Oxygen box if it is known.`);
    if (st.oImplied) push("warn", "No oxygen index was given – it is taken as 1, which is unusual. Did you mean O3?");
  }
  if (st.O > 0 && !out.some(m => m.l === "err" && /Duplicate|valid element|noble/.test(m.t))) { const c = chargeCheck(rows, st.O); if (c) push(c.l, c.t); }
  return out;
}

const canonical = st => {
  const part = site => st.rows.filter(r => r.site === site && r.el && r.n > 0).map(r => r.el + idx(r.n)).join("");
  return part("A") + part("B") + part("X") + (st.O > 0 ? "O" + idx(st.O) : "");
};

function analyse(text) {
  const p = parse(text), c = classify(p.items);
  const st = { rows: c.rows, O: p.O.n, deltaSym: p.delta.sym, oImplied: p.O.implied };
  const msgs = p.errors.map(t => ({ l: "err", t })).concat(p.warnings.map(t => ({ l: "warn", t })), c.notes, validate(st));
  return { st, msgs, formula: canonical(st) };
}

/* ---------------- autocomplete ---------------- */
function matches(tok, skipO) {
  if (!tok) return [];
  const t = tok.toLowerCase();
  let a = EL.filter(e => e.s.toLowerCase().startsWith(t) && !(skipO && e.s === "O")).sort((x, y) => x.s < y.s ? -1 : 1);
  if (t.length >= 3 || !a.length) a = a.concat(EL.filter(e => e.n.toLowerCase().startsWith(t) && !a.includes(e) && !(skipO && e.s === "O")));
  return a;
}

function attachAC(input, mode) {
  const wrap = input.parentElement;
  let list = wrap.querySelector(".ac-list");
  if (!list) { list = document.createElement("div"); list.className = "ac-list hidden"; wrap.appendChild(list); }
  let act = -1, cur = [], tk = null;
  const hide = () => { list.classList.add("hidden"); act = -1; };
  const token = () => {
    const v = input.value, pos = input.selectionStart == null ? v.length : input.selectionStart;
    if (mode === "whole") return { tok: v.trim(), start: 0, end: v.length };
    const m = /[A-Z][a-z]*$/.exec(v.slice(0, pos));
    return m ? { tok: m[0], start: pos - m[0].length, end: pos } : { tok: "", start: pos, end: pos };
  };
  const paint = () => { [...list.children].forEach((c, i) => c.classList.toggle("on", i === act)); const el = list.children[act]; if (el && el.scrollIntoView) el.scrollIntoView({ block: "nearest" }); };
  const show = () => {
    tk = token(); cur = matches(tk.tok, mode === "whole");
    if (!cur.length || (cur.length === 1 && cur[0].s === tk.tok)) return hide();
    list.innerHTML = cur.map(e => `<div class="ac-i" data-s="${e.s}"><b>${e.s}</b><span>${e.n}</span></div>`).join("");
    list.style.top = (input.offsetTop + input.offsetHeight + 2) + "px"; list.style.left = input.offsetLeft + "px";
    list.classList.remove("hidden"); act = -1;
  };
  const pick = sym => {
    if (mode === "whole") input.value = sym;
    else { const v = input.value; input.value = v.slice(0, tk.start) + sym + v.slice(tk.end); const p = tk.start + sym.length; try { input.setSelectionRange(p, p); } catch (e) { } }
    hide(); input.dispatchEvent(new Event("input", { bubbles: true }));
    if (mode === "whole") input.dispatchEvent(new Event("change", { bubbles: true }));
    input.focus();
  };
  input.addEventListener("input", show);
  input.addEventListener("focus", () => { if (mode === "whole") show(); });
  input.addEventListener("click", () => { if (mode !== "whole") show(); });
  input.addEventListener("blur", () => setTimeout(hide, 150));
  input.addEventListener("keydown", e => {
    if (list.classList.contains("hidden")) return;
    if (e.key === "ArrowDown") { e.preventDefault(); act = Math.min(cur.length - 1, act + 1); paint(); }
    else if (e.key === "ArrowUp") { e.preventDefault(); act = Math.max(0, act - 1); paint(); }
    else if ((e.key === "Enter" || e.key === "Tab") && act >= 0) { e.preventDefault(); e.stopImmediatePropagation(); pick(cur[act].s); }
    else if (e.key === "Escape") { e.stopPropagation(); hide(); }
  });
  list.addEventListener("mousedown", e => { const it = e.target.closest(".ac-i"); if (it) { e.preventDefault(); pick(it.dataset.s); } });
}

/* ---------------- editable identification panel ---------------- */
let inp = null, box = null, st = null, notes = [], perr = [], pwarn = [], timer = 0, dirty = false, nid = 1, last = null;
const blank = () => ({ rows: [], O: 0, deltaSym: false, oImplied: false });

function rowHtml(r) {
  const o = s => (s === "X" && r.site !== "X") ? "" : `<option value="${s}"${r.site === s ? " selected" : ""}>${{ A: "A-site", B: "B-site", X: "Other" }[s]}</option>`;
  return `<div class="fx-row" data-id="${r.id}"><span class="ac-wrap"><input class="fx-el" value="${esc(r.el)}" placeholder="Element" aria-label="Element" maxlength="3" autocomplete="off" spellcheck="false"></span>` +
    `<input class="fx-n" type="number" step="any" min="0" value="${fmtN(r.n)}" title="Stoichiometric index"><span class="fx-f" title="Normalised fraction within the site"></span>` +
    `<select class="fx-s" title="Move to another site">${o("A")}${o("B")}${o("X")}</select><button type="button" class="fx-x" title="Remove">×</button></div>`;
}
function render() {
  if (!box) return;
  if (!st.rows.length && !(st.O > 0) && !inp.value.trim()) { box.classList.add("hidden"); box.innerHTML = ""; return; }
  const grp = (site, title) => {
    if (site === "X" && !st.rows.some(r => r.site === "X")) return "";
    return `<div class="fx-site" data-site="${site}"><h4>${title}</h4>${st.rows.filter(r => r.site === site).map(rowHtml).join("")}` +
      (site === "X" ? "" : `<button type="button" class="fx-add" data-add="${site}">+ Add element</button>`) + `<div class="fx-tot" data-tot="${site}"></div></div>`;
  };
  const d = st.O > 0 && !st.deltaSym ? fmtN(3 - st.O) : "";
  box.innerHTML = `<div class="fx-sum"></div><div class="fx-cols">${grp("A", "A-site")}${grp("B", "B-site")}` +
    `<div class="fx-site fx-ox"><h4>Oxygen</h4><div class="fx-orow"><label>O index<input id="fx_o" type="number" step="any" min="0" value="${fmtN(st.O)}"></label>` +
    `<label>δ (deficiency)<input id="fx_d" type="number" step="any" value="${d}" placeholder="0"></label></div></div>` +
    `${grp("X", "Other elements")}</div><div class="fx-msgs"></div>`;
  box.classList.remove("hidden");
  box.querySelectorAll(".fx-el").forEach(i => attachAC(i, "whole"));
  refresh();
}
function rowById(id) { return st.rows.find(r => r.id === +id); }
function refresh() {
  if (!box || !st) return;
  ["A", "B", "X"].forEach(s => {
    const sm = sumSite(st.rows, s), t = box.querySelector(`[data-tot="${s}"]`);
    if (t) t.textContent = st.rows.some(r => r.site === s) ? `Total = ${fmtN(sm) || 0}` : "";
  });
  box.querySelectorAll(".fx-row[data-id]").forEach(el => {
    const r = rowById(el.dataset.id), f = el.querySelector(".fx-f"), sm = r ? sumSite(st.rows, r.site) : 0;
    if (f) f.textContent = r && r.n > 0 && sm > 0 ? (r.n / sm).toFixed(3) : "";
  });
  const fo = inp === document.activeElement, text = inp.value.trim();
  const quiet = fo && !/[0-9)\]}δ]$/.test(text);
  const msgs = perr.map(t => ({ l: "err", t })).concat(pwarn.map(t => ({ l: "warn", t })), notes, validate(st));
  last = { msgs, formula: canonical(st) };
  const s = box.querySelector(".fx-sum"), m = box.querySelector(".fx-msgs");
  if (s) s.innerHTML = `Detected formula: <b>${esc(last.formula) || "—"}</b>`;
  if (m) m.innerHTML = quiet ? "" : msgs.map(x => `<div class="fx-m ${x.l}">${esc(x.t)}</div>`).join("");
}
function load() {
  dirty = false;
  const text = inp.value, p = parse(text), c = classify(p.items);
  st = { rows: c.rows.map(r => Object.assign(r, { id: nid++ })), O: p.O.n, deltaSym: p.delta.sym, oImplied: p.O.implied };
  notes = c.notes; perr = p.errors; pwarn = p.warnings;
  render();
}
function onPanel(e) {
  const t = e.target, row = t.closest && t.closest(".fx-row[data-id]"), r = row && rowById(row.dataset.id);
  if (e.type === "input") {
    if (r && t.classList.contains("fx-el")) { r.el = t.value.trim(); refresh(); }
    else if (r && t.classList.contains("fx-n")) { r.n = parseFloat(t.value); r.implied = false; refresh(); }
    else if (t.id === "fx_o") { st.O = parseFloat(t.value) || 0; st.deltaSym = false; st.oImplied = false; const d = box.querySelector("#fx_d"); if (d) d.value = st.O > 0 ? fmtN(3 - st.O) : ""; refresh(); }
    else if (t.id === "fx_d") { const v = parseFloat(t.value); if (isFinite(v)) { st.O = 3 - v; st.deltaSym = false; st.oImplied = false; const o = box.querySelector("#fx_o"); if (o) o.value = fmtN(st.O); } refresh(); }
  } else if (e.type === "change") {
    if (r && t.classList.contains("fx-el")) { const v = t.value.trim(); if (/^[a-z]{1,2}$/i.test(v)) { r.el = v[0].toUpperCase() + v.slice(1).toLowerCase(); t.value = r.el; } refresh(); }
    else if (r && t.classList.contains("fx-s")) { r.site = t.value; render(); }
  } else if (e.type === "click") {
    if (r && t.classList.contains("fx-x")) { st.rows = st.rows.filter(x => x !== r); render(); }
    else if (t.classList.contains("fx-add")) { st.rows.push({ el: "", n: 1, site: t.dataset.add, implied: false, id: nid++ }); render(); const ins = box.querySelectorAll(`.fx-site[data-site="${t.dataset.add}"] .fx-el`); if (ins.length) ins[ins.length - 1].focus(); }
  }
}

const FX = {
  esc, SYM, EL, parse, classify, validate, canonical, analyse, matches, chargeCheck,
  mount() {
    inp = document.getElementById("pf_name"); box = document.getElementById("fx");
    if (!inp || !box) return;
    st = blank(); notes = []; perr = []; pwarn = []; dirty = false;
    attachAC(inp, "token");
    inp.addEventListener("input", () => { dirty = true; clearTimeout(timer); timer = setTimeout(load, 200); });
    inp.addEventListener("blur", () => { if (dirty) { clearTimeout(timer); load(); } else refresh(); });
    inp.addEventListener("focus", () => { if (st) refresh(); });
    ["input", "change", "click"].forEach(ev => box.addEventListener(ev, onPanel));
    if (inp.value.trim()) load();
  },
  /* current A-/B-site composition (as identified, including the user's edits) for the descriptor calculator */
  composition() {
    if (!inp) return null;
    if (dirty) { clearTimeout(timer); load(); }
    st.rows.forEach(r => { if (r.el && /^[a-z]{1,2}$/i.test(r.el)) r.el = r.el[0].toUpperCase() + r.el.slice(1).toLowerCase(); });
    const part = s => st.rows.filter(r => r.site === s && r.el && r.n > 0).map(r => [r.el, r.n]);
    return { A: part("A"), B: part("B"), formula: canonical(st) };
  },
  reset() { if (!box) return; clearTimeout(timer); dirty = false; st = blank(); notes = []; perr = []; pwarn = []; box.innerHTML = ""; box.classList.add("hidden"); },
  /* what runPredict should send: the corrected formula + how it was identified */
  forPredict() {
    if (!inp) return { formula: "", original: "" };
    if (dirty) { clearTimeout(timer); load(); }
    const original = inp.value.trim();
    if (!original) return { formula: "", original: "" };
    st.rows.forEach(r => { if (r.el && /^[a-z]{1,2}$/i.test(r.el)) r.el = r.el[0].toUpperCase() + r.el.slice(1).toLowerCase(); });
    const msgs = perr.map(t => ({ l: "err", t })).concat(validate(st));
    const bad = msgs.find(m => m.l === "err");
    if (bad) { if (box) { const m = box.querySelector(".fx-msgs"); if (m) m.innerHTML = perr.map(t => ({ l: "err", t })).concat(pwarn.map(t => ({ l: "warn", t })), notes, validate(st)).map(x => `<div class="fx-m ${x.l}">${esc(x.t)}</div>`).join(""); box.scrollIntoView({ block: "nearest", behavior: "smooth" }); } return { error: "Please fix the formula first: " + bad.t }; }
    const part = s => st.rows.filter(r => r.site === s && r.el && r.n > 0).map(r => [r.el, r.n]);
    return { formula: canonical(st), original, composition: { A: part("A"), B: part("B"), X: part("X"), O: st.O } };
  },
  /* shows "Entered formula" above the verdict when the corrected formula differs from what was typed */
  annotate() {
    const el = document.querySelector("#predres .pres"); if (!el || !inp) return;
    const o = inp.value.trim(), c = st ? canonical(st) : "";
    if (o && c && o !== c) el.insertAdjacentHTML("afterbegin", `<div class="small muted" style="margin-bottom:8px">Entered formula: <b>${esc(o)}</b> · identified as <b>${esc(c)}</b></div>`);
  }
};
root.FX = FX;
if (typeof module !== "undefined" && module.exports) module.exports = FX;
})(typeof window !== "undefined" ? window : globalThis);
