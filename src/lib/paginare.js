// =====================================================================
// src/lib/paginare.js — paginile arătate în bara de paginare (4 nov. 2026,
// „📚 Testele și exercițiile mele" pe pagini — src/pages/ProfesorVirtual.jsx)
//   pageWindow(6, 20) → [1, '…', 4, 5, 6, 7, 8, '…', 20]
// =====================================================================
export function pageWindow(page, pages, span = 2) {
  const n = Math.max(1, parseInt(pages, 10) || 1);
  const cur = Math.max(1, Math.min(n, parseInt(page, 10) || 1));
  if (n <= 1) return [1];
  const out = new Set([1, n]);
  for (let p = cur - span; p <= cur + span; p++) if (p >= 1 && p <= n) out.add(p);
  const list = [...out].sort((a, b) => a - b);
  const res = [];
  list.forEach((p, i) => { if (i && p - list[i - 1] > 1) res.push('…'); res.push(p); });
  return res;
}
