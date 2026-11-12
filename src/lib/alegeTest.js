// =====================================================================
// src/lib/alegeTest.js — alegerea testului pentru „▶ Începe un test" (pură, fără
// bază de date — testată în test/navigare-pe-cont.test.js). Interogările sunt în
// src/lib/testRapid.js.
// =====================================================================

// rubricile cu teste întregi, în ordinea în care le preferăm (restul vin după)
const PREFERATE = ['teste-interactive', 'variante', 'simulari'];

// Alege din listă: întâi un test nerezolvat dintr-o rubrică preferată, apoi orice
// nerezolvat, apoi primul din listă. Pură (testată în test/navigare-pe-cont.test.js).
export function alegeTest(rows = [], rezolvate = new Set()) {
  const lista = (rows || []).filter((r) => r && r.id);
  if (!lista.length) return null;
  const rang = (r) => { const i = PREFERATE.indexOf(r.subcategory || ''); return i < 0 ? PREFERATE.length : i; };
  const ordonate = lista.map((r, i) => ({ r, i })).sort((a, b) => rang(a.r) - rang(b.r) || a.i - b.i).map((x) => x.r);
  return ordonate.find((r) => !rezolvate.has(r.id)) || ordonate[0];
}

export const linkTest = (t) => (t && t.id ? `/exercitiu?id=${t.id}` : null);
