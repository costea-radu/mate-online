// =====================================================================
// api/_lib/planPregatire.js — „🗺️ HARTA PREGĂTIRII", planul de parcurs din
// „🎯 Pregătește-mă de examen" (13 nov. 2026)
//
// Cererea lui Radu (13 nov., dimineața): „pune în «pregătește-mă de examen» un
// plan de pregătire cu exerciții în ordine: planul să conțină, în ordine, toate
// exercițiile interactive din subiectele de la «capitole cu exerciții»,
// «exerciții pe subiecte» și apoi «teste interactive» de la tipul de examen ales
// de elev. După terminarea testelor interactive, să se treacă la cele PDF. (…)
// Să se poată alege și o clasă (…) Planul să se poată vedea ca o hartă (…) Harta
// să se updateze mereu, dacă se adaugă exerciții noi în site. Să se poată stagna
// pe hartă la un exercițiu până îl termină, dar să poată și trece mai departe
// după mai multe încercări. Dacă se întrerupe șirul de zile, să se poată relua de
// unde a rămas."
// Și (13 nov., după-amiaza): „scoate din hartă PDF exerciții pe capitole și
// exerciții pe subiecte. păstrează doar subiecte de examen cu corectare după
// barem. împarte harta în două: prima dată harta exercițiilor interactive și a
// doua harta exercițiilor PDF" + „fă să apară progresul din hartă în «rezultate»,
// la profesori și părinți".
//
// Cum merge:
//   · ȚINTA (user_stats.prep_exam): un examen (EN, BAC M1/M2/M3) sau o clasă
//     (clasa-5 … clasa-12) — aleasă în /pregateste-ma (api/_lib/pregatireZilnica.js).
//   · DOUĂ HĂRȚI, fiecare cu drumul și pasul ei curent:
//       🧩 INTERACTIVĂ — examen: Capitole cu exerciții · Exerciții pe subiecte ·
//          Teste interactive; clasă: interactivele clasei alese, apoi ale claselor
//          dinainte (… a V-a);
//       📄 PDF — DOAR subiecte cu corectare după barem: examen → Variante ·
//          (BAC) Teste de antrenament · Simulări, fiecare cu baremul lui legat
//          (potrivirea site-ului din ai_pdf_text sau legătura botului de examene din
//          exam_bot_index); clasă → fișele clasei (și ale celor dinainte) care au
//          barem. Fără informații despre bareme (tabelele lipsă): la examen intră
//          toate subiectele (au barem oficial), la clasă niciuna.
//     Pasul zilei vine din harta interactivă; când e gata, din cea PDF. Harta PDF
//     se poate lucra oricând, în paralel (cu Premium — corectarea e Premium).
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
//   · PASUL CURENT al unei hărți = primul pas accesibil care nu e trecut și nici
//     sărit. Elevul „stagnează" pe el până îl trece sau până are destule încercări
//     ca să sară; pașii de după sunt încuiați (cei la care a lucrat deja din site
//     rămân deschiși). Nimic nu depinde de seria de zile.
//   · FĂRĂ ABONAMENT: pașii Premium și testele PDF (corectarea lor e Premium) apar
//     pe hartă cu ⭐ și nu opresc planul.
//   · PROFESORII ȘI PĂRINȚII văd progresul (rezumat) în „Rezultate" —
//     rezumateElevi() → api/teacher-students.js → src/components/TeacherResults.jsx.
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
const HARTI = ['interactiv', 'pdf'];

// baremul legat: potrivirea confirmată a site-ului / ales de admin (ai_pdf_text) sau
// legătura botului de examene (exam_bot_index) — aceleași stări ca în api/_lib/examBotRun.js
const BAREM_SITE_OK = new Set(['ok', 'ok_antet', 'ok_continut', 'inclus', 'ok_admin']);
const BAREM_BOT_OK = new Set([...BAREM_SITE_OK, 'ok_bot']);

// ─── Etapele unei ținte, în ordinea din site ────────────────────────────────
// tinta: { tip: 'examen', category, profile } | { tip: 'clasa', clasa }
// `profil: null` = oricare (EN; „Capitole cu exerciții" de la BAC sunt comune profilurilor)
// `doarCuBarem` (hartă PDF): intră doar subiectele cu barem; `dacaNuStim` — ce intră când
// nu se știe nimic despre bareme (tabelele lipsă): 'toate' (subiecte oficiale) / 'niciunul'
function etape(tinta) {
  if (!tinta) return [];
  if (tinta.tip === 'clasa') {
    const g0 = Number(tinta.clasa);
    if (!CLASE.includes(g0)) return [];
    const out = [];
    for (let g = g0; g >= 5; g--) out.push({ id: `c${g}-int`, harta: 'interactiv', titlu: `${numeClasa(g)} · exerciții interactive`, tip: 'interactive', category: `clasa-${g}`, subcategory: null, profil: null });
    for (let g = g0; g >= 5; g--) out.push({ id: `c${g}-pdf`, harta: 'pdf', titlu: `${numeClasa(g)} · fișe PDF cu barem`, tip: 'pdf', category: `clasa-${g}`, subcategory: null, profil: null, doarCuBarem: true, dacaNuStim: 'niciunul' });
    return out;
  }
  const cat = tinta.category;
  if (cat !== 'evaluare-nationala' && cat !== 'bacalaureat') return [];
  const en = cat === 'evaluare-nationala';
  const prof = en ? null : (tinta.profile || null);
  const subiecte = en ? 'exercitii-subiecte' : 'exercitii';
  const pdf = (o) => ({ harta: 'pdf', tip: 'pdf', category: cat, profil: prof, doarCuBarem: true, dacaNuStim: 'toate', ...o });
  return [
    { id: 'capitole', harta: 'interactiv', titlu: 'Capitole cu exerciții', tip: 'interactive', category: cat, subcategory: 'capitole', profil: null },
    { id: 'subiecte', harta: 'interactiv', titlu: 'Exerciții pe subiecte', tip: 'interactive', category: cat, subcategory: subiecte, profil: prof },
    { id: 'teste', harta: 'interactiv', titlu: 'Teste interactive', tip: 'interactive', category: cat, subcategory: 'teste-interactive', profil: prof },
    // harta PDF: doar subiectele de examen (13 nov., după-amiaza: fără capitole și exerciții pe subiecte în PDF)
    pdf({ id: 'pdf-variante', titlu: en ? 'Variante date și modele' : 'Variante date, olimpici, rezerve', subcategory: 'variante' }),
    ...(en ? [] : [pdf({ id: 'pdf-antrenament', titlu: 'Teste de antrenament', subcategory: 'teste-antrenament' })]),
    pdf({ id: 'pdf-simulari', titlu: en ? 'Simulări' : 'Simulări și modele', subcategory: 'simulari' }),
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

// intră un PDF în harta PDF? cuBarem = Set (ce are barem) sau null (nu se știe)
function intraPdf(row, et, cuBarem) {
  if (!et.doarCuBarem) return true;
  if (cuBarem instanceof Set) return cuBarem.has(row.id);
  return et.dacaNuStim === 'toate';
}

// Pașii planului: rândurile vin deja în ordinea din site (sort_order ↑, created_at ↓);
// un material apare o singură dată, în prima etapă în care se potrivește.
function construiesteNoduri(rows, lista, { cuBarem = null } = {}) {
  const noduri = [];
  const vazute = new Set();
  for (const et of lista) {
    for (const r of rows || []) {
      if (!r || !r.id || vazute.has(r.id) || !sePotriveste(r, et) || barem.isBaremRow(r) || !intraPdf(r, et, cuBarem)) continue;
      vazute.add(r.id);
      noduri.push({ id: r.id, titlu: String(r.title || 'Exercițiu').slice(0, 160), tip: et.tip, harta: et.harta || (et.tip === 'pdf' ? 'pdf' : 'interactiv'), etapa: et.id, gratuit: !!r.is_free, creat: r.created_at || null });
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

// O hartă: starea fiecărui pas, pasul curent, ce e deschis (indicii `i` — în harta ei)
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

// cele două hărți, fiecare calculată separat
function calculeazaHarti(noduri, progres, opt = {}) {
  const out = {};
  for (const h of HARTI) out[h] = calculeaza((noduri || []).filter((n) => n.harta === h), progres, opt);
  return out;
}

// Ce primește pagina pentru o hartă: etapele cu numărătorile lor, pașii (compacți), pasul curent
function vedereHarta({ noduri, curent }, lista, { premium = false } = {}) {
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
    etape: etapeOut,
    noduri: noduri.map((n) => ({
      id: n.id, titlu: n.titlu, tip: n.tip, etapa: n.etapa, e: idxEtapa.get(n.etapa),
      stare: n.stare, pct: n.pct, incercari: n.incercari, gratuit: n.gratuit,
      accesibil: n.accesibil, deschis: n.deschis, nou: n.nou, poateSari: n.poateSari,
    })),
    curent,
    pas: c ? {
      id: c.id, titlu: c.titlu, tip: c.tip, harta: c.harta, etapa: c.etapa, nr: c.i + 1, stare: c.stare, pct: c.pct,
      incercari: c.incercari, prag: c.prag, poateSari: c.poateSari, nou: c.nou,
      incercariRamase: Math.max(0, INCERCARI_SARIRE - c.incercari),
    } : null,
    total, trecute, sarite,
    neterminate: noduri.filter((n) => n.stare === 'inceput').length,
    procent: total ? Math.round((trecute / total) * 100) : 0,
    // tot ce poate face elevul pe harta asta e gata (cu Premium: toată harta)
    terminat: total > 0 && curent < 0 && accesibile.length > 0,
    ramasePremium: premium ? 0 : noduri.filter((n) => !n.accesibil && n.stare !== 'trecut').length,
  };
}

// adresa unui pas: vizualizatorul obișnuit, cu insigna „🗺️ Harta pregătirii"; la PDF,
// modul în care elevul trimite rezolvarea (pdf · chat · foaie · poza)
function urlPas(nod, { mod = null } = {}) {
  if (!nod || !nod.id) return null;
  const id = encodeURIComponent(nod.id);
  if (nod.tip === 'pdf') return `/pdf-viewer?id=${id}&pregatire=1&plan=1${mod ? `&mod=${encodeURIComponent(mod)}` : ''}`;
  return `/exercitiu?id=${id}&pregatire=1&plan=1`;
}
function cuAdrese(pas) {
  if (!pas) return null;
  const p = { ...pas, url: urlPas(pas) };
  if (pas.tip === 'pdf') p.moduri = ['pdf', 'chat', 'foaie', 'poza'].map((m) => ({ mod: m, url: urlPas(pas, { mod: m }) }));
  return p;
}

const REGULI = () => ({ pragInteractiv: PRAG_INTERACTIV, pragPdf: PRAG_PDF, incercariSarire: INCERCARI_SARIRE });

// Ce primește pagina: cele două hărți + pasul zilei (din harta interactivă; când e gata, din cea PDF)
function vedere(harti, lista, { tinta = null, coloana = true, premium = false } = {}) {
  const v = {};
  for (const h of HARTI) {
    v[h] = vedereHarta(harti[h], lista.filter((e) => (e.harta || (e.tip === 'pdf' ? 'pdf' : 'interactiv')) === h), { premium });
    v[h].pas = cuAdrese(v[h].pas);
  }
  const total = v.interactiv.total + v.pdf.total;
  return {
    activ: true,
    coloana,
    tinta: tinta ? { id: tinta.id || null, label: tinta.label || null, tip: tinta.tip } : null,
    interactiv: v.interactiv,
    pdf: v.pdf,
    pas: v.interactiv.pas || v.pdf.pas || null,
    total,
    trecute: v.interactiv.trecute + v.pdf.trecute,
    terminat: total > 0 && !v.interactiv.pas && !v.pdf.pas && (v.interactiv.terminat || v.pdf.terminat),
    reguli: REGULI(),
  };
}

// Rezumatul pentru profesori și părinți (în „Rezultate"): fără lista pașilor
function rezumatHarta(h) {
  if (!h) return null;
  return {
    total: h.total, trecute: h.trecute, sarite: h.sarite, neterminate: h.neterminate, procent: h.procent,
    terminat: h.terminat, ramasePremium: h.ramasePremium,
    pas: h.pas ? { nr: h.pas.nr, titlu: h.pas.titlu, stare: h.pas.stare, incercari: h.pas.incercari, pct: h.pas.pct } : null,
    etape: (h.etape || []).map((e) => ({ titlu: e.titlu, total: e.total, trecute: e.trecute })),
  };
}
function rezumat(v) {
  if (!v) return null;
  return { tinta: v.tinta, interactiv: rezumatHarta(v.interactiv), pdf: rezumatHarta(v.pdf), reguli: v.reguli };
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

// PDF-urile (dintre `rows`) care au barem legat → Set; null = nu se știe nimic (tabelele lipsă)
async function bareme(supa, rows) {
  const pdfs = (rows || []).filter((r) => r && r.id && tipul(r) === 'pdf' && !barem.isBaremRow(r));
  if (!pdfs.length) return new Set();
  const ids = pdfs.map((r) => r.id);
  const fisier = new Map(pdfs.map((r) => [r.id, r.file_url || null]));
  const ok = new Set();
  let stiut = false;
  try {   // potrivirea site-ului (Profesorul Virtual, corectarea) și baremul ales de admin
    const site = await http.inBatches(ids, (chunk, from, to) => supa.from('ai_pdf_text')
      .select('content_id, file_url, barem_status, barem_id, barem_override_id').in('content_id', chunk).range(from, to));
    stiut = true;
    for (const d of site) {
      if (!d || !d.content_id) continue;
      if (d.barem_override_id) { ok.add(d.content_id); continue; }
      const f = fisier.get(d.content_id);
      if (BAREM_SITE_OK.has(d.barem_status) && (d.barem_id || d.barem_status === 'inclus') && (!d.file_url || !f || d.file_url === f)) ok.add(d.content_id);
    }
  } catch { /* cache-ul PDF lipsește */ }
  try {   // legăturile botului de examene (EN / BAC)
    const bot = await http.inBatches(ids, (chunk, from, to) => supa.from('exam_bot_index')
      .select('content_id, barem_status, barem_id').in('content_id', chunk).range(from, to));
    stiut = true;
    for (const d of bot) if (d && d.content_id && BAREM_BOT_OK.has(d.barem_status) && (d.barem_id || d.barem_status === 'inclus')) ok.add(d.content_id);
  } catch { /* botul nu e instalat */ }
  return stiut ? ok : null;
}

// conținutul unei ținte, gata de construit hărți: { lista, rows, cuBarem }
async function sursa(supa, tinta) {
  const lista = etape(tinta);
  if (!lista.length) return null;
  const rows = await continut(supa, tinta);
  const cuBarem = lista.some((e) => e.doarCuBarem) ? await bareme(supa, rows.filter((r) => lista.some((e) => e.doarCuBarem && sePotriveste(r, e)))) : null;
  return { lista, rows, cuBarem };
}

async function progres(supa, userId, ids) {
  const out = new Map();
  if (!ids.length) return out;
  const rows = await http.inBatches(ids, (chunk, from, to) => supa.from('progress')
    .select('content_id, score, max_score, attempts, completed_at').eq('user_id', userId).in('content_id', chunk).range(from, to));
  for (const p of rows) if (p && p.content_id) out.set(p.content_id, p);
  return out;
}

// Hărțile unui elev. `stats` = rândul din user_stats (cu prep_plan, dacă există).
async function calculeazaPentru(supa, userId, { tinta, stats, premium = false }) {
  const s = await sursa(supa, tinta);
  if (!s) return null;
  const noduri = construiesteNoduri(s.rows, s.lista, { cuBarem: s.cuBarem });
  const prog = await progres(supa, userId, noduri.map((n) => n.id));
  const plan = citestePlan(stats);
  const harti = calculeazaHarti(noduri, prog, { sarite: plan.sarite, trecute: plan.trecute, premium, start: plan.start });
  return { lista: s.lista, noduri, prog, plan, harti };
}

async function stare(supa, userId, { tinta, stats, premium = false, azi = null } = {}) {
  try {
    const x = await calculeazaPentru(supa, userId, { tinta, stats, premium });
    if (!x) return null;
    const { lista, plan, harti } = x;
    // pașii trecuți acum rămân trecuți pe hartă; începutul planului (pentru „nou")
    const noi = HARTI.flatMap((h) => harti[h].noduri.filter((n) => n.trecutAcum && !plan.trecute.has(n.id)).map((n) => n.id));
    const tid = tinta && tinta.id ? tinta.id : null;
    const tintaNoua = plan.tinta !== tid;
    if (plan.coloana && (noi.length || !plan.start || tintaNoua)) {
      for (const id of noi) plan.trecute.add(id);
      // planul începe azi (sau din nou, la altă țintă): „nou" = adăugat în site după ziua asta
      if (!plan.start || tintaNoua) plan.start = azi || new Date().toISOString().slice(0, 10);
      plan.tinta = tid;
      await scriePlan(supa, userId, plan);
    }
    return vedere(harti, lista, { tinta, coloana: plan.coloana, premium });
  } catch (e) {
    console.warn('plan.stare:', e?.message || e);
    return null;
  }
}

// „⏭ Treci mai departe": doar pe pasul curent al hărții lui, după INCERCARI_SARIRE încercări
async function sari(supa, userId, { contentId, tinta, stats, premium = false } = {}) {
  const id = String(contentId || '');
  if (!id) return { error: 'Lipsește pasul.' };
  const plan0 = citestePlan(stats);
  if (!plan0.coloana) return { error: 'Trecerea peste un pas nu e activă încă (Admin: rulează supabase/plan_pregatire.sql).', setup: false };
  const x = await calculeazaPentru(supa, userId, { tinta, stats, premium });
  if (!x) return { error: 'Alege întâi examenul sau clasa.' };
  const { plan, harti } = x;
  const h = HARTI.find((k) => harti[k].noduri.some((n) => n.id === id));
  if (!h) return { error: 'Pasul nu mai e în planul tău.' };
  const r = harti[h];
  const nod = r.noduri.find((n) => n.id === id);
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

// Progresul din hartă al mai multor elevi, pentru „Rezultate" (profesori și părinți).
// elevi: [{ id, premium }]; stari: Map(id → rândul din user_stats); progRows: rândurile lor
// din `progress` (deja citite de api/teacher-students.js). Conținutul și baremele se
// citesc o singură dată pentru fiecare țintă. → Map(id → rezumat)
async function rezumateElevi(supa, elevi, { stari = new Map(), progRows = [], tintaInfo = () => null } = {}) {
  const out = new Map();
  const peTinta = new Map();
  for (const e of elevi || []) {
    const st = stari.get(e.id);
    const t = st ? tintaInfo(st.prep_exam) : null;
    if (!t) continue;
    if (!peTinta.has(t.id)) peTinta.set(t.id, { tinta: t, elevi: [] });
    peTinta.get(t.id).elevi.push(e);
  }
  const progPeElev = new Map();
  for (const p of progRows || []) {
    if (!p || !p.user_id || !p.content_id) continue;
    if (!progPeElev.has(p.user_id)) progPeElev.set(p.user_id, new Map());
    const m = progPeElev.get(p.user_id);
    const vechi = m.get(p.content_id);
    if (!vechi || String(p.completed_at || '') > String(vechi.completed_at || '')) m.set(p.content_id, p);
  }
  for (const { tinta, elevi: lista } of peTinta.values()) {
    let s = null;
    try { s = await sursa(supa, tinta); } catch (e) { console.warn('plan.rezumateElevi:', e?.message || e); }
    if (!s) continue;
    const noduri = construiesteNoduri(s.rows, s.lista, { cuBarem: s.cuBarem });
    for (const e of lista) {
      const plan = citestePlan(stari.get(e.id));
      const harti = calculeazaHarti(noduri, progPeElev.get(e.id) || new Map(), { sarite: plan.sarite, trecute: plan.trecute, premium: !!e.premium, start: plan.start });
      out.set(e.id, rezumat(vedere(harti, s.lista, { tinta, coloana: plan.coloana, premium: !!e.premium })));
    }
  }
  return out;
}

module.exports = {
  PRAG_INTERACTIV, PRAG_PDF, INCERCARI_SARIRE, ROMAN, CLASE, HARTI, numeClasa,
  // pure
  etape, categorii, sePotriveste, intraPdf, construiesteNoduri, stareNod, accesibil, calculeaza, calculeazaHarti,
  vedereHarta, vedere, urlPas, rezumat, citestePlan, deScris, pctDin, incercariDin,
  // cu baza de date
  continut, bareme, progres, stare, sari, scriePlan, rezumateElevi,
};
