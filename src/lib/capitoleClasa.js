// =====================================================================
// src/lib/capitoleClasa.js — LECȚIILE UNEI CLASE, PE CAPITOLE (18 nov. 2026)
//
// Cererea lui Radu: „Împarte pe capitole lecțiile din «clase». Pune acele pictograme
// ca la hartă și la bareme."
//
// Capitolul fiecărui material îl dă TITLUL, cu regulile „🗺️ Hărții pregătirii" și ale
// filei „📋 Bareme": api/_lib/capitoleHarta.js — același fișier și în browser (vite.config.js
// îl dă ca modul ES), deci un material stă în același capitol peste tot. Capitolele vin în
// ordinea primului lor material din site; ce nu se recunoaște — „Alte exerciții" /
// „Alte fișe", la sfârșit (ca pe hartă).
// Progresul elevului pe capitol = câte materiale a TRECUT: 70% la exercițiile interactive,
// 50% la PDF-uri (nota 5) — pragurile hărții (api/_lib/planPregatire.js → PRAG_INTERACTIV,
// PRAG_PDF, stareNod; un rând salvat parțial, cu attempts = 0, nu e trecut).
// Interfața: src/components/CapitoleClasa.jsx.
// =====================================================================
import { capitolDin } from '../../api/_lib/capitoleHarta.js';

export const PRAG = { interactive: 70, pdf: 50 };

const pctDin = (p) => (Number(p.max_score) > 0 ? Math.round((Number(p.score) / Number(p.max_score)) * 100) : 0);
// rândurile vechi (dinainte de salvarea parțială) nu au attempts → 1
const incercariDin = (p) => (p.attempts == null ? 1 : Math.max(0, Math.round(Number(p.attempts) || 0)));

// a trecut elevul materialul? (`p` = rândul lui din `progress`)
export function trecut(item, p) {
  if (!item || !p) return false;
  return incercariDin(p) >= 1 && pctDin(p) >= (item.content_type === 'pdf' ? PRAG.pdf : PRAG.interactive);
}

export const capitolAlte = (tip) => ({ id: 'alte', titlu: tip === 'pdf' ? 'Alte fișe' : 'Alte exerciții', icon: 'alte', alte: true });

// Materialele unei file → [{ id, titlu, icon, alte, items, total, trecute, gata }].
// `progres` (content_id → rândul din `progress`) doar la elevul logat; fără el, trecute = 0.
export function peCapitole(items, category, tip, progres = null) {
  const caps = [];
  const idx = new Map();
  for (const it of items || []) {
    const c = capitolDin(it && it.title, category) || capitolAlte(tip);
    if (!idx.has(c.id)) {
      idx.set(c.id, caps.length);
      caps.push({ id: c.id, titlu: c.titlu, icon: c.icon, alte: !!c.alte, items: [] });
    }
    caps[idx.get(c.id)].items.push(it);
  }
  return [...caps.filter((c) => !c.alte), ...caps.filter((c) => c.alte)].map((c) => {
    const trecute = progres ? c.items.filter((it) => trecut(it, progres[it.id])).length : 0;
    return { ...c, total: c.items.length, trecute, gata: !!progres && c.items.length > 0 && trecute === c.items.length };
  });
}

// capitolul în care stă un material — pentru revenirea la cardul lui
export function capitolulMaterialului(caps, id) {
  if (id == null || id === '') return null;
  const c = (caps || []).find((x) => x.items.some((it) => String(it.id) === String(id)));
  return c ? c.id : null;
}

// Ce capitole stau deschise la intrarea în filă:
//   • ce a lăsat elevul deschis în sesiunea asta (`salvate`, pe clasă și filă);
//   • altfel, primul capitol neterminat (elev logat) / primul capitol (vizitator);
//     la întoarcerea dintr-un exercițiu — doar capitolul lui;
//   • mereu: capitolul cardului la care se întoarce și capitolul unic al unei file.
export function deschiseLaIntrare(caps, { salvate = null, cardId = null, cuProgres = false } = {}) {
  const lista = caps || [];
  const ids = new Set(lista.map((c) => c.id));
  const out = new Set();
  const alCardului = capitolulMaterialului(lista, cardId);
  if (Array.isArray(salvate)) salvate.forEach((id) => { if (ids.has(id)) out.add(id); });
  else if (!alCardului && lista.length) out.add(((cuProgres && lista.find((c) => !c.gata)) || lista[0]).id);
  if (alCardului) out.add(alCardului);
  if (lista.length === 1) out.add(lista[0].id);
  return out;
}

// „1 exercițiu", „5 exerciții", „20 de exerciții" · „1 fișă", „5 fișe", „20 de fișe"
const FORME = { interactive: ['exercițiu', 'exerciții'], pdf: ['fișă', 'fișe'] };
export function cate(tip, n) {
  const k = Math.max(0, Math.round(Number(n) || 0));
  const [unu, multe] = FORME[tip] || FORME.interactive;
  if (k === 1) return `1 ${unu}`;
  const de = k % 100 >= 20 || (k >= 100 && k % 100 === 0) ? 'de ' : '';
  return `${k} ${de}${multe}`;
}

// rândul de sub titlul capitolului: „5 exerciții · 2 trecute", „1 fișă · 🏁 trecută"
export function subtitluCapitol(c, tip, cuProgres = false) {
  const baza = cate(tip, c.total);
  if (!cuProgres) return baza;
  const unul = tip === 'pdf' ? 'trecută' : 'trecut';
  if (c.gata) return `${baza} · 🏁 ${c.total === 1 ? unul : 'toate trecute'}`;
  if (!c.trecute) return baza;
  return `${baza} · ${c.trecute} ${c.trecute === 1 ? unul : 'trecute'}`;
}
