// =====================================================================
// src/lib/ciornaTest.js — răspunsurile de data trecută la un test interactiv
// (13 nov. 2026 — harta pregătirii: „să se poată reveni la un exercițiu sau test
// neterminat, să apară în «rezultate»")
//
// Ce a completat elevul într-un test (q0, q1, … — aceleași răspunsuri pe care
// bridge-ul le trimite la salvarea automată, src/lib/tutorBridge.js) se ține minte
// pe acest dispozitiv, 30 de zile. Când revine la testul neterminat, vizualizatorul
// (src/pages/InteractiveViewer.jsx) le pune la loc (MATE_ANSWERS_SET). După
// „Corectează total" (scorul salvat) sau după „Resetează" (toate golite), ciorna se
// șterge. Pe server rămâne scorul provizoriu (progress.attempts = 0 → „neterminat").
// Funcții pure, cu `storage` injectabil (testate în test/rezultate-neterminate.test.js).
// =====================================================================

export const ZILE_CIORNA = 30;
const MS_ZI = 24 * 3600 * 1000;

export const cheieCiorna = (userId, contentId) => (userId && contentId ? `em_ciorna_${userId}_${contentId}` : null);

// există măcar un răspuns completat?
export const areRaspunsuri = (a) => Array.isArray(a) && a.some((x) => x !== null && x !== undefined && String(x).trim() !== '');

const st = (storage) => {
  if (storage) return storage;
  try { return typeof window !== 'undefined' ? window.localStorage : null; } catch { return null; }
};

export function citesteCiorna(cheie, { storage = null, acum = Date.now() } = {}) {
  const s = st(storage);
  if (!cheie || !s) return null;
  try {
    const o = JSON.parse(s.getItem(cheie) || 'null');
    if (!o || !Array.isArray(o.a) || !areRaspunsuri(o.a)) return null;
    if (!(acum - Number(o.t || 0) <= ZILE_CIORNA * MS_ZI)) { s.removeItem(cheie); return null; }
    return o.a.slice(0, 60);
  } catch { return null; }
}

export function scrieCiorna(cheie, raspunsuri, { storage = null, acum = Date.now() } = {}) {
  const s = st(storage);
  if (!cheie || !s || !areRaspunsuri(raspunsuri)) return false;
  try { s.setItem(cheie, JSON.stringify({ a: raspunsuri.slice(0, 60), t: acum })); return true; } catch { return false; }
}

export function stergeCiorna(cheie, { storage = null } = {}) {
  const s = st(storage);
  if (!cheie || !s) return;
  try { s.removeItem(cheie); } catch { /* ignore */ }
}

// un rând din `progress` care e doar salvarea automată de la jumătate (attempts = 0),
// fără „Corectează total" → în „Rezultatele mele", sus, cu „▶ Continuă"
export const eNeterminat = (p) => !!(p && p.content_id && p.attempts !== null && p.attempts !== undefined && Number(p.attempts) === 0);
