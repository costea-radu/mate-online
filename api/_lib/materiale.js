// =====================================================================
// api/_lib/materiale.js — lista de materiale care se pot PUNCTA
// (dueluri 1-la-1 și turnee). O singură sursă de adevăr pentru amândouă.
//
// Două lucruri pe care le rezolvă:
//   1. BAREMELE NU APAR. Un barem e răspunsul testului — pus într-un duel
//      sau într-un turneu, „exercițiul" e deja rezolvat. Le recunoaștem cu
//      `barem.isBaremRow` (subcategoria `bareme`, „barem" în titlu sau
//      numele oficial de fișier cu „_bar_" acolo unde testul are „_var_").
//   2. APAR TOATE, nu primele 300. Citim tabela paginat (http.allRows), deci
//      formularul primește tot ce există pe site, iar căutarea din pagină e
//      instantanee — fără o cerere nouă la fiecare literă.
// =====================================================================
const http = require('./http');
const barem = require('./barem');

// `subcategory` și `file_url` nu pleacă spre client — sunt doar pentru filtru.
const CAMPURI = 'id, title, category, is_free, content_type, subcategory, file_url, sort_order';

const TIPURI = ['interactive', 'pdf'];

function normalizeTip(tip) {
  return TIPURI.includes(tip) ? tip : null;
}

// Rândurile brute (fără bareme), în ordinea din site.
async function randuri(supa, { tip = null, doarGratuite = false } = {}) {
  const feluri = normalizeTip(tip) ? [normalizeTip(tip)] : TIPURI;
  const rows = await http.allRows(
    (from, to) => {
      let q = supa.from('content').select(CAMPURI).in('content_type', feluri);
      if (doarGratuite) q = q.eq('is_free', true);
      return q.order('sort_order', { ascending: true }).range(from, to);
    },
    { pageSize: 1000, maxPages: 8 },
  );
  return rows.filter((r) => !barem.isBaremRow(r));
}

// Forma trimisă în pagină (compactă — lista poate avea peste o mie de rânduri).
function catreClient(rows) {
  return rows.map((c) => ({
    id: c.id,
    titlu: c.title,
    categorie: c.category,
    gratuit: !!c.is_free,
    tip: c.content_type,
  }));
}

// Potrivire simplă pe titlu + categorie, fără diacritice („fractii" găsește
// „Fracții"). Se folosește și în pagină, dar o ținem și pe server pentru
// cererile care vin cu `q`.
function normText(s) {
  return String(s || '').toLowerCase()
    .replace(/[ăâ]/g, 'a').replace(/î/g, 'i').replace(/[șş]/g, 's').replace(/[țţ]/g, 't')
    .replace(/\s+/g, ' ').trim();
}

function filtreaza(items, q) {
  const termen = normText(q);
  if (!termen) return items;
  return items.filter((x) => normText(`${x.titlu} ${x.categorie}`).includes(termen));
}

// ─── API-ul folosit de api/duel.js și api/turneu.js ──────────────────────────
// Întoarce { interactive, pdf, total: { interactive, pdf } } sau, dacă se cere
// un singur `tip`, { items, total, tip }.
async function liste(supa, { doarGratuite = false } = {}) {
  const rows = await randuri(supa, { doarGratuite });
  const inter = catreClient(rows.filter((r) => r.content_type === 'interactive'));
  const pdf = catreClient(rows.filter((r) => r.content_type === 'pdf'));
  return {
    materiale: { interactive: inter, pdf },
    total: { interactive: inter.length, pdf: pdf.length },
  };
}

async function lista(supa, { tip, q = '', doarGratuite = false } = {}) {
  const fel = normalizeTip(tip) || 'interactive';
  const rows = await randuri(supa, { tip: fel, doarGratuite });
  const items = catreClient(rows);
  return { ok: true, tip: fel, q: String(q || ''), total: items.length, items: filtreaza(items, q) };
}

// Verificare la salvare: id-urile primite chiar sunt materiale punctabile și
// NU sunt bareme. (Filtrul din pagină e comoditate; ăsta e gardul.)
async function validate(supa, ids) {
  const lista_ = [...new Set((Array.isArray(ids) ? ids : []).filter(Boolean))];
  if (!lista_.length) return [];
  const rows = await http.inBatches(lista_, (chunk, from, to) => supa.from('content')
    .select(CAMPURI).in('id', chunk).in('content_type', TIPURI).range(from, to));
  return rows.filter((r) => !barem.isBaremRow(r));
}

module.exports = { TIPURI, randuri, catreClient, filtreaza, liste, lista, validate };
