// =====================================================================
// src/lib/titluPagina.js — titlul filei din browser, pe rută.
// Site-ul e un SPA: fără asta, titlul rămânea cel al primei pagini deschise
// oricâte pagini schimbai (și așa ajungea și în Google Analytics).
// Textele sunt aceleași pe care serverul le pune în HTML (api/page-meta.js →
// api/_lib/seoRute.json). Pur — testat în test/seo-rute.test.js.
// =====================================================================
import RUTE from '../../api/_lib/seoRute.json' with { type: 'json' };

export const TITLU_IMPLICIT = RUTE['/'].title;

// null = nu ne atingem de titlu:
//   · articolele (/rezolvari/<slug>) își pun singure titlul (src/pages/ArticolPage.jsx);
//   · la PRIMA încărcare a unei pagini publice titlul vine de la server și poate fi
//     unul aprobat în Admin (tabelul seo_meta) — nu-l înlocuim cu cel implicit.
export function titluPentru(pathname, { primaIncarcare = false } = {}) {
  const p = String(pathname || '/').replace(/\/+$/, '') || '/';
  if (/^\/rezolvari\/[^/]+$/.test(p)) return null;
  const r = Object.prototype.hasOwnProperty.call(RUTE, p) ? RUTE[p] : null;
  if (primaIncarcare && !(r && r.index === false)) return null;
  if (r) return r.title;
  if (p.startsWith('/meditatii/sala/')) return 'Meditație live – ExamenMate';
  return TITLU_IMPLICIT;
}
