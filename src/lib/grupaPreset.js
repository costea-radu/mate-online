// =====================================================================
// src/lib/grupaPreset.js — testele generate acum, trimise spre testul pe grupă
//
// „🧩 Generează exerciții/teste interactive/PDF" → „👥 Teste diferite / elev"
// (src/components/TesteDiferite.jsx) → „👥 Folosește-le în testul interactiv pe
// grupă": testele generate (deja salvate în „Testele și exercițiile mele") ajung
// bifate în „👥 Test interactiv pe grupă (teste diferite)"
// (src/components/GroupAssignment.jsx). Drumul: sessionStorage, o singură dată.
//   { items:[{ source:'personal', refId, title }], format:'pdf'|'interactive', category, at }
// =====================================================================
export const PRESET_KEY = 'mate_grupa_preset';
const TTL_MS = 6 * 3600 * 1000;

export function savePreset({ items, format, category = '' }) {
  try {
    sessionStorage.setItem(PRESET_KEY, JSON.stringify({
      items: (items || []).map(({ source, refId, title }) => ({ source: source || 'personal', refId, title })),
      format: format === 'pdf' ? 'pdf' : 'interactive', category: category || '', at: Date.now(),
    }));
    return true;
  } catch { return false; }
}

// citește și ȘTERGE (o singură dată) — null dacă nu e nimic valid
export function takePreset() {
  try {
    const raw = sessionStorage.getItem(PRESET_KEY);
    if (!raw) return null;
    sessionStorage.removeItem(PRESET_KEY);
    const p = JSON.parse(raw);
    if (!p || !Array.isArray(p.items) || !p.items.length) return null;
    if (p.at && Date.now() - p.at > TTL_MS) return null;
    return { ...p, items: p.items.filter((i) => i && i.refId) };
  } catch { return null; }
}
