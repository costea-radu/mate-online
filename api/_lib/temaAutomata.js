// =====================================================================
// api/_lib/temaAutomata.js — „📝 CREEAZĂ O TEMĂ ELEVULUI" (11 nov. 2026)
//
// Cererea: în contul de părinte, „asistentul AI să facă doar asta: creează o
// temă elevului, ceea ce creează automat o temă pentru nivelul elevului, sau
// subiect de examen din cele din site, fără AI".
//
// Logica pură (testabilă) a alegerii — fără niciun model AI:
//   · alegeTema     — N exerciții din „drumul clasei" (ordinea din site): întâi
//                     cele pe care elevul nu le-a făcut niciodată, apoi cele la
//                     care a avut sub 70%; fără cele primite deja ca temă de
//                     curând; dacă nu ajung, recapitulare (cele mai slabe întâi);
//   · alegeSubiect  — un test de examen: întâi unul nerezolvat, apoi cel mai slab;
//   · clasaSugerata / examenSugerat — nivelul elevului, din ce a ales el în site
//     (misiunea zilnică, „Pregătește-mă de examen") sau din ce a lucrat.
// Baza de date: api/homework.js (auto_options / auto_create).
// =====================================================================

const PRAG = 70;            // sub atât, exercițiul mai are nevoie de lucru (ca la misiunea zilnică)
const NUMERE = [3, 5, 8, 10];

const numarValid = (n) => {
  const v = parseInt(n, 10);
  return NUMERE.includes(v) ? v : 5;
};

// pool = materialele (în ordinea din site); progres: Map(id → procent); deja: Set(id)
function alegeTema(pool, { progres = new Map(), deja = new Set(), numar = 5, prag = PRAG } = {}) {
  const lista = (Array.isArray(pool) ? pool : []).filter((r) => r && r.id);
  const n = Math.max(1, numar | 0);
  const nefacute = lista.filter((r) => !progres.has(r.id) && !deja.has(r.id));
  const slabe = lista.filter((r) => progres.has(r.id) && progres.get(r.id) < prag && !deja.has(r.id));
  const out = [...nefacute, ...slabe].slice(0, n);
  if (out.length < n) {
    // nu mai sunt destule noi: recapitulare — întâi ce n-a primit de curând, apoi cele
    // mai slabe procente (ce n-a lucrat deloc = cel mai slab)
    const ales = new Set(out.map((r) => r.id));
    const pct = (r) => (progres.has(r.id) ? progres.get(r.id) : -1);
    const rest = lista.filter((r) => !ales.has(r.id))
      .sort((a, b) => ((deja.has(a.id) ? 1 : 0) - (deja.has(b.id) ? 1 : 0)) || (pct(a) - pct(b)));
    for (const r of rest) { if (out.length >= n) break; out.push(r); }
  }
  return out;
}

// un singur test de examen
function alegeSubiect(pool, { progres = new Map(), deja = new Set(), prag = PRAG } = {}) {
  const lista = (Array.isArray(pool) ? pool : []).filter((r) => r && r.id);
  if (!lista.length) return null;
  return lista.find((r) => !progres.has(r.id) && !deja.has(r.id))
    || lista.filter((r) => progres.has(r.id) && progres.get(r.id) < prag && !deja.has(r.id))
      .sort((a, b) => progres.get(a.id) - progres.get(b.id))[0]
    || lista.find((r) => !progres.has(r.id))
    || [...lista].sort((a, b) => (progres.get(a.id) ?? 0) - (progres.get(b.id) ?? 0))[0];
}

// clasa elevului: cea aleasă la misiunea zilnică; altfel cea la care a lucrat cel mai mult
function clasaSugerata({ misiune = null, categorii = [] } = {}) {
  if (/^clasa-(5|6|7|8|9|10|11|12)$/.test(String(misiune || ''))) return { clasa: misiune, sursa: 'misiune' };
  const nr = {};
  for (const c of categorii || []) if (/^clasa-(5|6|7|8|9|10|11|12)$/.test(String(c || ''))) nr[c] = (nr[c] || 0) + 1;
  const top = Object.entries(nr).sort((a, b) => b[1] - a[1])[0];
  if (top) return { clasa: top[0], sursa: 'rezultate' };
  const en = (categorii || []).filter((c) => c === 'evaluare-nationala').length;
  const bac = (categorii || []).filter((c) => c === 'bacalaureat').length;
  if (en || bac) return { clasa: en >= bac ? 'clasa-8' : 'clasa-12', sursa: 'examen' };
  return { clasa: null, sursa: null };
}

// examenul elevului: cel ales în „Pregătește-mă de examen"; altfel după clasă
function examenSugerat({ ales = null, clasa = null, valide = [] } = {}) {
  if (ales && valide.includes(ales)) return ales;
  const m = /^clasa-(\d+)$/.exec(String(clasa || ''));
  if (m && Number(m[1]) >= 9) return 'bac-mate-info';
  return 'evaluare-nationala';
}

function titluTema(fel, { clasaLabel = null, examLabel = null, n = 0 } = {}) {
  if (fel === 'examen') return `Subiect de examen · ${examLabel || 'Examen'}`;
  return `Temă · Clasa ${clasaLabel || ''}`.trim() + (n ? ` (${n} ${n === 1 ? 'exercițiu' : 'exerciții'})` : '');
}

module.exports = { PRAG, NUMERE, numarValid, alegeTema, alegeSubiect, clasaSugerata, examenSugerat, titluTema };
