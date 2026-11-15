// =====================================================================
// src/lib/bareme.js — e un material barem? (în browser)
// Oglinda lui isBaremRow din api/_lib/barem.js: rubrica „bareme", cuvântul „barem" în
// titlu sau „barem" / „bar" (numele oficiale: „…_bar_07_LRO.pdf") în numele fișierului.
// Folosit la clase (src/components/ContentPage.jsx): baremele stau în fila „📋 Bareme",
// nu printre exercițiile PDF (15 nov. 2026).
// =====================================================================
export function normBarem(s) {
  return String(s || '').toLowerCase()
    .replace(/[ăâ]/g, 'a').replace(/î/g, 'i').replace(/[șş]/g, 's').replace(/[țţ]/g, 't')
    .replace(/[_\-.·–—]/g, ' ').replace(/\s+/g, ' ').trim();
}

export function numeFisier(row) {
  let last = String((row && row.file_url) || '').split('#')[0].split('?')[0].split('/').pop() || '';
  try { last = decodeURIComponent(last); } catch { /* rămâne cum e */ }
  return last.replace(/\.[a-z0-9]{2,5}$/i, '').replace(/^\d{9,}[_-]/, '');
}

export function esteBarem(row) {
  if (!row) return false;
  if (row.subcategory === 'bareme') return true;
  if (/\bbarem/.test(normBarem(row.title))) return true;
  return /\bbarem\b|\bbar\b/.test(normBarem(numeFisier(row)));
}
