// =====================================================================
// api/_lib/planPregatire.js — „🗺️ HARTA PREGĂTIRII", planul de parcurs din
// „🎯 Pregătește-mă de examen" (13 nov. 2026)
//
// Cererea lui Radu: „pune în «pregătește-mă de examen» un plan de pregătire cu
// exerciții în ordine: planul să conțină, în ordine, toate exercițiile
// interactive din subiectele de la «capitole cu exerciții», «exerciții pe
// subiecte» și apoi «teste interactive» de la tipul de examen ales de elev. După
// terminarea testelor interactive, să se treacă la cele PDF. (…) Să se poată
// alege și o clasă: (…) toate exercițiile interactive de la acea clasă, în
// ordinea din site, apoi din clasele precedente. Apoi (…) exerciții PDF. (…)
// Planul să se poată vedea ca o hartă pe care s-au parcurs exerciții. Harta să se
// updateze mereu, dacă se adaugă exerciții noi în site. Să se poată stagna pe
// hartă la un exercițiu până îl termină, dar să poată și trece mai departe după
// mai multe încercări. Dacă se întrerupe șirul de zile, să se poată relua de unde
// a rămas."
//
// Cum merge:
//   · ȚINTA (user_stats.prep_exam): un examen (EN, BAC M1/M2/M3) sau o clasă
//     (clasa-5 … clasa-12) — aleasă în /pregateste-ma (api/_lib/pregatireZilnica.js).
//   · ETAPELE, în ordinea din site:
//       examen → Capitole cu exerciții · Exerciții pe subiecte · Teste interactive
//                (interactive), apoi PDF: capitole · exerciții pe subiecte ·
//                variante · (BAC: teste de antrenament) · simulări — fără bareme;
//       clasă  → interactivele clasei alese, apoi ale claselor dinainte (… a V-a),
//                apoi PDF-urile, în aceeași ordine.
//   · HARTA se construiește din `content` la FIECARE deschidere (sort_order, apoi
//     created_at descrescător — exact ca listele din site): un exercițiu nou apare
//     singur la locul lui, marcat „nou" dacă e adăugat după începutul planului.
//   · STAREA unui pas vine din `progress` (aceeași sursă ca „Rezultatele mele"):
//       nou       — neînceput;
//       inceput   — doar salvarea automată de la jumătate (attempts = 0) → „neterminat";
//       incercat  — trimis / corectat, sub prag (încercările se numără);
//       trecut    — PRAG_INTERACTIV% la interactive, PRAG_PDF% la PDF (nota 5);
//                   ținut minte în prep_plan.trecute: o reluare mai slabă nu-l
//                   mai scoate de pe hartă;
//       sarit     — „⏭ Treci mai departe", permis după INCERCARI_SARIRE încercări.
//   · PASUL CURENT = primul pas accesibil care nu e trecut și nici sărit. Elevul
//     „stagnează" pe el până îl trece sau până are destule încercări ca să sară;
//     pașii de după sunt încuiați (cei la care a lucrat deja din site rămân deschiși).
//     Nimic nu depinde de seria de zile: după o pauză, planul continuă de unde a rămas.
//   · FĂRĂ ABONAMENT: pașii Premium și testele PDF (corectarea lor e Premium) apar
//     pe hartă cu ⭐ și nu opresc planul.
//
// Tabela: supabase/plan_pregatire.sql (coloana user_stats.prep_plan — sărite,
// trecute, începutul planului). Fără coloană, harta merge, doar „⏭ Treci mai
// departe" cere migrarea. Funcțiile cu baza de date nu aruncă spre apelant.
// =====================================================================
const http = require('./http');
const barem = require('./barem');

const envInt = (k, d, min, max) => { const n = parseInt(process.env[k] || '', 10); return Number.isFinite(n) && n >= min && n <= max ? n : d; };
const PRAG_INTERACTIV = envInt('PLAN_PRAG', 70, 1, 100);       // pasul interactiv e trecut de la atât la sută
const PRAG_PDF = envInt('PLAN_PRAG_PDF', 50, 1, 100);          // testul PDF: nota 5 (corectarea costă AI)
const INCERCARI_SARIRE = envInt('PLAN_INCERCARI', 3, 1, 20);    // după câte încercări poate trece mai departe
const MAX_LISTA = 3000;                                         // plafonul listelor din prep_plan

const ROMAN = { 5: 'V', 6: 'VI', 7: 'VII', 8: 'VIII', 9: 'IX', 10: 'X', 11: 'XI', 12: 'XII' };
const CLASE = [5, 6, 7, 8, 9, 10, 11, 12];
const numeClasa = (g) => `Clasa a ${ROMAN[g]}-a`;
const STARI_LUCRATE = ['trecut', 'incercat', 'inceput', 'sarit'];

// ─── Etapele unei ținte, în ordinea din site ────────────────────────────────
// tinta: { tip: 'examen', category, profile } | { tip: 'clasa', clasa }
// `profil: null` = oricare (EN; „Capitole cu exerciții" de la BAC sunt comune profilurilor)
function etape(tinta) {
  if (!tinta) return [];
  if (tinta.tip === 'clasa') {
    const g0 = Number(tinta.clasa);
    if (!CLASE.includes(g0)) return [];
    const out = [];
    for (let g = g0; g >= 5; g--) out.push({ id: `c${g}-int`, titlu: `${numeClasa(g)} · exerciții interactive`, tip: 'interactive', category: `clasa-${g}`, subcategory: null, profil: null });
    for (let g = g0; g >= 5; g--) out.push({ id: `c${g}-pdf`, titlu: `${numeClasa(g)} · exerciții PDF`, tip: 'pdf', category: `clasa-${g}`, subcategory: null, profil: null });
    return out;
  }
  const cat = tinta.category;
  if (cat !== 'evaluare-nationala' && cat !== 'bacalaureat') return [];
  const en = cat === 'evaluare-nationala';
  const prof = en ? null : (tinta.profile || null);
  const subiecte = en ? 'exercitii-subiecte' : 'exercitii';
  return [
    { id: 'capitole', titlu: 'Capitole cu exerciții', tip: 'interactive', category: cat, subcategory: 'capitole', profil: null },
    { id: 'subiecte', titlu: 'Exerciții pe subiecte', tip: 'interactive', category: cat, subcategory: subiecte, profil: prof },
    { id: 'teste', titlu: 'Teste interactive', tip: 'interactive', category: cat, subcategory: 'teste-interactive', profil: prof },
    { id: 'pdf-capitole', titlu: 'Capitole cu exerciții · PDF', tip: 'pdf', category: cat, subcategory: 'capitole', profil: null },
    { id: 'pdf-subiecte', titlu: 'Exerciții pe subiecte · PDF', tip: 'pdf', category: cat, subcategory: subiecte, profil: prof },
    { id: 'pdf-variante', titlu: en ? 'Variante date și modele · PDF' : 'Variante date, olimpici, rezerve · PDF', tip: 'pdf', category: cat, subcategory: 'variante', profil: prof },
    ...(en ? [] : [{ id: 'pdf-antrenament', titlu: 'Teste de antrenament · PDF', tip: 'pdf', category: cat, subcategory: 'teste-antrenament', profil: prof }]),
    { id: 'pdf-simulari', titlu: en ? 'Simulări · PDF' : 'Simulări și modele · PDF', tip: 'pdf', category: cat, subcategory: 'simulari', profil: prof },
  ];
}

// categoriile din care se citește conținutul planului
function categorii(tinta) {
  if (!tinta) return [];
  if (tinta.tip === 'clasa') return CLASE.filter((g) => g <= Number(tinta.clasa)).sort((a, b) => b - a).map((g) => `clasa-${g}`);
  return tinta.category ? [tinta.category] : [];
}

const tipul = (row) => (row && row.content_type === 'pdf' ? 'pdf' : row && row.content_type === 'interactive' ? 'interactive' : null);

function sePotriveste(row, et) {
  if (!row || row.category !== et.category || tipul(row) !== et.tip) return false;
  if (et.subcategory && row.subcategory !== et.subcategory) return false;
  if (et.profil && row.profile !== et.profil) return false;
  return true;
}

// Pașii planului: rândurile vin deja în ordinea din site (sort_order ↑, created_at ↓);
// un material apare o singură dată, în prima etapă în care se potrivește.
function construiesteNoduri(rows, lista) {
  const noduri = [];
  const vazute = new Set();
  for (const et of lista) {
    for (const r of rows || []) {
      if (!r || !r.id || vazute.has(r.id) || !sePotriveste(r, et) || barem.isBaremRow(r)) continue;
      vazute.add(r.id);
      noduri.push({ id: r.id, titlu: String(r.title || 'Exercițiu').slice(0, 160), tip: et.tip, etapa: et.id, gratuit: !!r.is_free, creat: r.created_at || null });
    }
  }
  return noduri;
}

const pctDin = (p) => (!p ? null : (Number(p.max_score) > 0 ? Math.round((Number(p.score) / Number(p.max_score)) * 100) : 0));
// rândurile vechi (înainte de salvarea parțială) au attempts = 1 implicit; salvarea
// parțială scrie explicit 0 → „neterminat"
const incercariDin = (p) => (!p ? 0 : (p.attempts == null ? 1 : Math.max(0, Math.round(Number(p.attempts) || 0))));

// Starea unui pas, din rândul lui din `progress`
function stareNod(nod, p, { sarite = new Set(), trecute = new Set() } = {}) {
  const prag = nod.tip === 'pdf' ? PRAG_PDF : PRAG_INTERACTIV;
  const pct = pctDin(p);
  const incercari = incercariDin(p);
  const trecutAcum = !!p && incercari >= 1 && pct >= prag;
  let stare = 'nou';
  if (trecutAcum || trecute.has(nod.id)) stare = 'trecut';
  else if (sarite.has(nod.id)) stare = 'sarit';
  else if (p && incercari >= 1) stare = 'incercat';
  else if (p) stare = 'inceput';
  return { stare, pct, incercari, prag, trecutAcum, la: p ? p.completed_at || null : null };
}

// Fără abonament: interactivele gratuite. Testele PDF le corectează profesorul
// virtual (Premium), deci nu opresc planul unui cont gratuit.
const accesibil = (nod, premium) => !!premium || (nod.gratuit && nod.tip === 'interactive');

// Harta întreagă: starea fiecărui pas, pasul curent, ce e deschis
function calculeaza(noduri, progres, { sarite = new Set(), trecute = new Set(), premium = false, start = null } = {}) {
  const out = (noduri || []).map((n, i) => {
    const s = stareNod(n, progres.get(n.id) || null, { sarite, trecute });
    const zi = n.creat ? String(n.creat).slice(0, 10) : null;
    return { ...n, i, ...s, accesibil: accesibil(n, premium), nou: !!(start && zi && zi > start) };
  });
  const curent = out.findIndex((n) => n.accesibil && n.stare !== 'trecut' && n.stare !== 'sarit');
  for (const n of out) {
    n.deschis = n.accesibil && (curent < 0 || n.i <= curent || STARI_LUCRATE.includes(n.stare));
    n.poateSari = n.i === curent && n.stare === 'incercat' && n.incercari >= INCERCARI_SARIRE;
  }
  return { noduri: out, curent };
}

// Ce primește pagina: etapele cu numărătorile lor, pașii (compacți), pasul curent
function vedere({ noduri, curent }, lista, { tinta = null, coloana = true, premium = false } = {}) {
  const idxEtapa = new Map(lista.map((e, k) => [e.id, k]));
  const etapeOut = lista.map((e) => {
    const ale = noduri.filter((n) => n.etapa === e.id);
    return {
      id: e.id, titlu: e.titlu, tip: e.tip, total: ale.length,
      trecute: ale.filter((n) => n.stare === 'trecut').length,
      sarite: ale.filter((n) => n.stare === 'sarit').length,
      incercate: ale.filter((n) => n.stare === 'incercat' || n.stare === 'inceput').length,
      inchise: ale.filter((n) => !n.accesibil).length,
      curenta: curent >= 0 && noduri[curent].etapa === e.id,
    };
  }).filter((e) => e.total > 0);
  const total = noduri.length;
  const trecute = noduri.filter((n) => n.stare === 'trecut').length;
  const sarite = noduri.filter((n) => n.stare === 'sarit').length;
  const accesibile = noduri.filter((n) => n.accesibil);
  const c = curent >= 0 ? noduri[curent] : null;
  return {
    activ: true,
    coloana,
    tinta: tinta ? { id: tinta.id || null, label: tinta.label || null, tip: tinta.tip } : null,
    etape: etapeOut,
    noduri: noduri.map((n) => ({
      id: n.id, titlu: n.titlu, tip: n.tip, etapa: n.etapa, e: idxEtapa.get(n.etapa),
      stare: n.stare, pct: n.pct, incercari: n.incercari, gratuit: n.gratuit,
      accesibil: n.accesibil, deschis: n.deschis, nou: n.nou, poateSari: n.poateSari,
    })),
    curent,
    pas: c ? {
      id: c.id, titlu: c.titlu, tip: c.tip, etapa: c.etapa, nr: c.i + 1, stare: c.stare, pct: c.pct,
      incercari: c.incercari, prag: c.prag, poateSari: c.poateSari, nou: c.nou,
      incercariRamase: Math.max(0, INCERCARI_SARIRE - c.incercari),
    } : null,
    total, trecute, sarite,
    procent: total ? Math.round((trecute / total) * 100) : 0,
    // tot ce poate face elevul e gata (cu Premium: tot planul)
    terminat: total > 0 && curent < 0 && accesibile.length > 0,
    ramasePremium: premium ? 0 : noduri.filter((n) => !n.accesibil && n.stare !== 'trecut').length,
    reguli: { pragInteractiv: PRAG_INTERACTIV, pragPdf: PRAG_PDF, incercariSarire: INCERCARI_SARIRE },
  };
}

// adresa unui pas: vizualizatorul obișnuit, cu insigna „🗺️ Planul meu"; la PDF, modul
// în care elevul trimite rezolvarea (pdf · chat · foaie · poza)
function urlPas(nod, { mod = null } = {}) {
  if (!nod || !nod.id) return null;
  const id = encodeURIComponent(nod.id);
  if (nod.tip === 'pdf') return `/pdf-viewer?id=${id}&pregatire=1&plan=1${mod ? `&mod=${encodeURIComponent(mod)}` : ''}`;
  return `/exercitiu?id=${id}&pregatire=1&plan=1`;
}

// ─── prep_plan (jsonb în user_stats) ─────────────────────────────────────────
function citestePlan(stats) {
  let raw = stats ? stats.prep_plan : null;
  if (typeof raw === 'string') { try { raw = JSON.parse(raw); } catch { raw = null; } }
  const o = raw && typeof raw === 'object' ? raw : {};
  const lista = (v) => (Array.isArray(v) ? v.map(String).filter(Boolean).slice(-MAX_LISTA) : []);
  return {
    coloana: !!stats && Object.prototype.hasOwnProperty.call(stats, 'prep_plan'),
    start: typeof o.start === 'string' && /^\d{4}-\d\d-\d\d$/.test(o.start) ? o.start : null,
    tinta: typeof o.tinta === 'string' ? o.tinta : null,
    sarite: new Set(lista(o.sarite)),
    trecute: new Set(lista(o.trecute)),
  };
}

const deScris = (plan) => ({
  v: 1, start: plan.start || null, tinta: plan.tinta || null,
  sarite: [...plan.sarite].slice(-MAX_LISTA), trecute: [...plan.trecute].slice(-MAX_LISTA),
});

async function scriePlan(supa, userId, plan) {
  try {
    const { error } = await supa.from('user_stats')
      .update({ prep_plan: deScris(plan), updated_at: new Date().toISOString() }).eq('user_id', userId);
    return !error;
  } catch { return false; }
}

// ─── Cu baza de date ────────────────────────────────────────────────────────
async function continut(supa, tinta) {
  const cats = categorii(tinta);
  if (!cats.length) return [];
  return http.allRows((from, to) => supa.from('content')
    .select('id, title, category, subcategory, profile, is_free, content_type, file_url, sort_order, created_at')
    .in('category', cats).in('content_type', ['interactive', 'pdf'])
    .order('sort_order', { ascending: true }).order('created_at', { ascending: false })
    .range(from, to), { pageSize: 1000, maxPages: 6 });
}

async function progres(supa, userId, ids) {
  const out = new Map();
  if (!ids.length) return out;
  const rows = await http.inBatches(ids, (chunk, from, to) => supa.from('progress')
    .select('content_id, score, max_score, attempts, completed_at').eq('user_id', userId).in('content_id', chunk).range(from, to));
  for (const p of rows) if (p && p.content_id) out.set(p.content_id, p);
  return out;
}

// Harta + pasul curent. `stats` = rândul din user_stats (cu prep_plan, dacă există).
// azi = ziua (YYYY-MM-DD), pentru începutul planului.
async function calculeazaPentru(supa, userId, { tinta, stats, premium = false, azi = null }) {
  const lista = etape(tinta);
  if (!lista.length) return null;
  const rows = await continut(supa, tinta);
  const noduri = construiesteNoduri(rows, lista);
  const prog = await progres(supa, userId, noduri.map((n) => n.id));
  const plan = citestePlan(stats);
  const r = calculeaza(noduri, prog, { sarite: plan.sarite, trecute: plan.trecute, premium, start: plan.start });
  return { lista, noduri, prog, plan, r };
}

async function stare(supa, userId, { tinta, stats, premium = false, azi = null } = {}) {
  try {
    const x = await calculeazaPentru(supa, userId, { tinta, stats, premium, azi });
    if (!x) return null;
    const { lista, plan, r } = x;
    // pașii trecuți acum rămân trecuți pe hartă; începutul planului (pentru „nou")
    const noi = r.noduri.filter((n) => n.trecutAcum && !plan.trecute.has(n.id)).map((n) => n.id);
    const tid = tinta && tinta.id ? tinta.id : null;
    const tintaNoua = plan.tinta !== tid;
    if (plan.coloana && (noi.length || !plan.start || tintaNoua)) {
      for (const id of noi) plan.trecute.add(id);
      // planul începe azi (sau din nou, la altă țintă): „nou" = adăugat în site după ziua asta
      if (!plan.start || tintaNoua) plan.start = azi || new Date().toISOString().slice(0, 10);
      plan.tinta = tid;
      await scriePlan(supa, userId, plan);
    }
    const v = vedere(r, lista, { tinta, coloana: plan.coloana, premium });
    if (v.pas) {
      const c = r.noduri[r.curent];
      v.pas.url = urlPas(c);
      if (c.tip === 'pdf') v.pas.moduri = ['pdf', 'chat', 'foaie', 'poza'].map((m) => ({ mod: m, url: urlPas(c, { mod: m }) }));
    }
    return v;
  } catch (e) {
    console.warn('plan.stare:', e?.message || e);
    return null;
  }
}

// „⏭ Treci mai departe": doar pe pasul curent, după INCERCARI_SARIRE încercări
async function sari(supa, userId, { contentId, tinta, stats, premium = false, azi = null } = {}) {
  const id = String(contentId || '');
  if (!id) return { error: 'Lipsește pasul.' };
  const plan0 = citestePlan(stats);
  if (!plan0.coloana) return { error: 'Trecerea peste un pas nu e activă încă (Admin: rulează supabase/plan_pregatire.sql).', setup: false };
  const x = await calculeazaPentru(supa, userId, { tinta, stats, premium, azi });
  if (!x) return { error: 'Alege întâi examenul sau clasa.' };
  const { plan, r } = x;
  const nod = r.noduri.find((n) => n.id === id);
  if (!nod) return { error: 'Pasul nu mai e în planul tău.' };
  if (nod.stare === 'trecut') return { error: 'Pasul e deja trecut.' };
  if (r.curent < 0 || nod.i !== r.curent) return { error: 'Poți trece mai departe doar de la pasul la care ai ajuns.' };
  if (nod.incercari < INCERCARI_SARIRE) {
    const rest = INCERCARI_SARIRE - nod.incercari;
    return { error: `Mai încearcă: treci mai departe după ${INCERCARI_SARIRE} încercări (mai ai ${rest === 1 ? 'una' : rest}).`, incercari: nod.incercari };
  }
  plan.sarite.add(id);
  if (!(await scriePlan(supa, userId, plan))) return { error: 'Nu am putut salva. Încearcă din nou.' };
  return { ok: true };
}

module.exports = {
  PRAG_INTERACTIV, PRAG_PDF, INCERCARI_SARIRE, ROMAN, CLASE, numeClasa,
  // pure
  etape, categorii, sePotriveste, construiesteNoduri, stareNod, accesibil, calculeaza, vedere, urlPas, citestePlan, deScris, pctDin, incercariDin,
  // cu baza de date
  continut, progres, stare, sari, scriePlan,
};
