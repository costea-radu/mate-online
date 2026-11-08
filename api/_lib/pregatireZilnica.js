// =====================================================================
// api/_lib/pregatireZilnica.js — „🎯 PREGĂTEȘTE-MĂ DE EXAMEN" (8 nov. 2026)
//
// Cererea: un buton „pregătește-mă de examen" care amintește zilnic, printr-o
// notificare, să rezolvi un test; progresul cu XP în Arena și clasament cu alți
// utilizatori, simplu ca pe Duolingo, cu promovare și alte răsplăți; „se
// consideră lucru și dacă elevul rezolvă o parte dintr-un test, nu complet".
//
// Cum merge:
//   · elevul își alege examenul (EN, BAC Mate-Info, BAC Științele Naturii, BAC
//     Tehnologic) și primește în fiecare zi TESTUL ZILEI din site: un test
//     interactiv (gratuit, corectat pe loc) sau — cu Premium, la alegere — un
//     subiect oficial PDF (EN: „✏️ Rezolvă pe PDF"; BAC: foaia de lucru);
//     ordinea e cea a misiunii zilnice: întâi testele nerezolvate, apoi cele sub
//     70%, apoi recapitulare (misiune.alegeExercitiul);
//   · ZIUA SE BIFEAZĂ de la PRAG_ITEMI exerciții lucrate (implicit 3) într-un
//     test de examen — oricare, nu neapărat testul zilei, și nu neapărat întreg:
//     api/ai-score.js (inclusiv salvarea automată de la jumătate),
//     api/rezolva-pdf.js, api/ai-correct.js și api/ai-handwriting.js apelează
//     `inregistreaza`;
//   · RĂSPLATA (o dată pe zi, prin xp.bonus — deci și puncte de LIGĂ, cu plafonul
//     zilnic): 25 XP + 5 🪙, +10 XP la 80% sau mai mult; la fiecare 7 zile la
//     rând încă 40 XP + 15 🪙; INSIGNE (prima zi, 7 și 30 de zile la rând, 10 și
//     50 de zile, primul test complet); seria de zile; liga săptămânală, cu
//     promovare, rămâne cea din Arena (api/gamificare.js → closeSeasons);
//   · în fluxul Arenei (api/_lib/arenaFeed.js): „Ana P. a lucrat la Subiectul I ·
//     Evaluarea Națională", seriile și insignele — fără note;
//   · amintirea zilnică: api/_lib/pregatireNotificari.js.
//
// Tabela: supabase/pregatire_zilnica.sql (daily_tests + user_stats.prep_*).
// Funcțiile cu baza de date nu aruncă: salvarea scorurilor nu are voie să cadă
// din cauza pregătirii.
// =====================================================================
const xp = require('./xp');
const http = require('./http');
const barem = require('./barem');
const misiune = require('./misiune');
const feed = require('./arenaFeed');

const EXAMENE = [
  { id: 'evaluare-nationala', label: 'Evaluarea Națională', scurt: 'EN', category: 'evaluare-nationala', profile: null },
  { id: 'bac-mate-info', label: 'BAC Mate-Info', scurt: 'BAC M1', category: 'bacalaureat', profile: 'mate-info' },
  { id: 'bac-stiinte', label: 'BAC Științele Naturii', scurt: 'BAC M2', category: 'bacalaureat', profile: 'stiinte-naturii' },
  { id: 'bac-tehnologic', label: 'BAC Tehnologic', scurt: 'BAC M3', category: 'bacalaureat', profile: 'tehnologic' },
];
const FORMATE = ['interactiv', 'pdf'];
const SUBCAT_PDF = ['variante', 'simulari', 'teste-antrenament'];   // subiecte întregi (nu bareme, nu fișe pe capitole)
const CATEGORII_EXAMEN = ['evaluare-nationala', 'bacalaureat'];

const envInt = (k, d, min, max) => { const n = parseInt(process.env[k] || '', 10); return Number.isFinite(n) && n >= min && n <= max ? n : d; };
const PRAG_ITEMI = envInt('PREGATIRE_PRAG_ITEMI', 3, 1, 18);   // de la câte exerciții lucrate se bifează ziua
const XP_ZI = 25;          // răsplata zilei
const XP_BUN = 10;         // + la 80% sau mai mult (doar pe scor verificat)
const PRAG_BUN = 80;
const MONEDE = 5;
const SERIE_PAS = 7;       // la fiecare 7 zile la rând…
const SERIE_XP = 40;       // … un bonus
const SERIE_MONEDE = 15;
const SERII_IN_FLUX = [3, 7, 14, 21, 30, 50, 75, 100, 150, 200, 365];
const ZILE_ISTORIC = 400;

// Insignele pregătirii (tabela user_badges — aceeași ca la exercițiile
// interactive; numele și pictograma se salvează în rând, src/lib/badges.js le
// descrie în „Contul meu")
const INSIGNE = [
  { id: 'pregatire-prima-zi', icon: '📝', name: 'Prima zi de pregătire', desc: 'Ai bifat prima zi din „Pregătește-mă de examen".', cand: (c) => c.total >= 1 },
  { id: 'pregatire-test-complet', icon: '✅', name: 'Test complet', desc: 'Ai rezolvat un test de examen de la început până la sfârșit.', cand: (c) => !!c.complet },
  { id: 'pregatire-serie-7', icon: '🔥', name: 'O săptămână de pregătire', desc: '7 zile la rând cu testul zilei.', cand: (c) => c.serie >= 7 },
  { id: 'pregatire-zile-10', icon: '🎓', name: '10 zile de pregătire', desc: 'Ai lucrat la testul zilei în 10 zile.', cand: (c) => c.total >= 10 },
  { id: 'pregatire-serie-30', icon: '🗓️', name: 'O lună fără pauză', desc: '30 de zile la rând cu testul zilei.', cand: (c) => c.serie >= 30 },
  { id: 'pregatire-zile-50', icon: '🏅', name: '50 de zile de pregătire', desc: 'Ai lucrat la testul zilei în 50 de zile.', cand: (c) => c.total >= 50 },
];

const isMissing = (err) => !!err && /column .* does not exist|does not exist|schema cache|could not find/i.test(String(err.message || err));
const examInfo = (id) => EXAMENE.find((e) => e.id === id) || null;
const examValid = (id) => !!examInfo(id);
const formatValid = (f) => FORMATE.includes(f);
const ePremium = (profile) => !!(profile && (profile.subscription_status === 'active' || profile.is_admin));
const SUB_NUME = { 1: 'Subiectul I', 2: 'Subiectul al II-lea', 3: 'Subiectul al III-lea' };

// ─── Logica pură (testabilă) ────────────────────────────────────────────────

// examenul unui material din site (categoria + profilul la BAC)
function examenulMaterialului(c) {
  if (!c) return null;
  if (c.category === 'evaluare-nationala') return 'evaluare-nationala';
  if (c.category === 'bacalaureat') {
    const e = EXAMENE.find((x) => x.profile && x.profile === c.profile);
    return e ? e.id : 'bacalaureat';
  }
  return null;
}

// materialul contează la pregătire? (orice test / set de examen, nu baremele)
function eDeExamen(c) {
  return !!c && CATEGORII_EXAMEN.includes(c.category) && !barem.isBaremRow(c);
}

// adresa testului zilei (vizualizatorul obișnuit, cu insigna „🎯 TESTUL ZILEI")
function urlTest(t) {
  if (!t || !t.id) return null;
  return t.tip === 'pdf'
    ? `/pdf-viewer?id=${encodeURIComponent(t.id)}&pregatire=1`
    : `/exercitiu?id=${encodeURIComponent(t.id)}&pregatire=1`;
}

// subiectele (1, 2, 3) → „Subiectul I și Subiectul al II-lea"
function numeSubiecte(subs) {
  return [...new Set((subs || []).map(Number).filter((s) => s >= 1 && s <= 3))].sort().map((s) => SUB_NUME[s]);
}

// testele interactive de EN au 18 itemi: 6 + 6 + 6 → subiectele lucrate
function subiecteDinRaspunsuri(answers, total) {
  if (!Array.isArray(answers) || Number(total) !== 18) return [];
  const out = new Set();
  answers.slice(0, 18).forEach((a, i) => { if (a != null && String(a).trim() !== '') out.add(Math.floor(i / 6) + 1); });
  return [...out];
}

const raspunsuriDate = (answers) => (Array.isArray(answers) ? answers.filter((a) => a != null && String(a).trim() !== '').length : 0);

// răsplata zilei: baza + „bine" + bonusul de serie (la 7, 14, 21…)
function recompensa({ pct = null, verificat = true, serieNoua = 0 } = {}) {
  const bun = verificat && pct != null && pct >= PRAG_BUN;
  const bonusSerie = serieNoua > 0 && serieNoua % SERIE_PAS === 0;
  return {
    xp: XP_ZI + (bun ? XP_BUN : 0) + (bonusSerie ? SERIE_XP : 0),
    coins: MONEDE + (bonusSerie ? SERIE_MONEDE : 0),
    bun, bonusSerie,
  };
}

// insignele noi pentru starea de acum (fără cele pe care le are deja)
function insigneNoi({ serie = 0, total = 0, complet = false } = {}, avute = new Set()) {
  return INSIGNE.filter((b) => !avute.has(b.id) && b.cand({ serie, total, complet }));
}

// „🔀 Alt test": următorul din listă după cel de acum (ciclic), întâi cele încă
// nestăpânite (sub 70%) — apăsat de mai multe ori, trece pe rând prin toate
function urmatorul(lista, curentId, progres = new Map()) {
  const L = Array.isArray(lista) ? lista.filter((r) => r && r.id) : [];
  if (!L.length) return null;
  const n = L.length;
  const i0 = L.findIndex((r) => r.id === curentId);
  for (let k = 1; k <= n; k++) {
    const r = L[((i0 + k) % n + n) % n];
    if (r.id !== curentId && (progres.get(r.id) ?? -1) < misiune.PRAG_STAPANIT) return r;
  }
  const r = L[((i0 + 1) % n + n) % n];
  return r && r.id !== curentId ? r : null;
}

// formatul testului zilei: PDF doar cu Premium (corectarea scrisului e Premium)
function formatFolosit(ales, premium) {
  if (ales === 'pdf' && premium) return 'pdf';
  return 'interactiv';
}

// ─── Cu baza de date ────────────────────────────────────────────────────────

// Testele examenului, în ordinea din site. Fără abonament: doar cele gratuite.
async function poolExamen(supa, exam, { format = 'interactiv', premium = false } = {}) {
  const E = examInfo(exam);
  if (!E) return [];
  const rows = await http.allRows((from, to) => {
    let q = supa.from('content')
      .select('id, title, category, subcategory, profile, is_free, content_type, file_url, sort_order')
      .eq('category', E.category);
    if (format === 'pdf') q = q.eq('content_type', 'pdf').in('subcategory', SUBCAT_PDF);
    else q = q.eq('content_type', 'interactive');
    if (E.profile) q = q.eq('profile', E.profile);
    if (!premium) q = q.eq('is_free', true);
    return q.order('sort_order', { ascending: true }).range(from, to);
  }, { pageSize: 1000, maxPages: 3 });
  return rows.filter((r) => !barem.isBaremRow(r));
}

async function progresPe(supa, userId, ids) {
  const out = new Map();
  if (!ids.length) return out;
  const rows = await http.inBatches(ids, (chunk, from, to) => supa.from('progress')
    .select('content_id, score, max_score').eq('user_id', userId).in('content_id', chunk).range(from, to));
  for (const p of rows) out.set(p.content_id, p.max_score > 0 ? Math.round((p.score / p.max_score) * 100) : 0);
  return out;
}

async function istoric(supa, userId) {
  const { data, error } = await supa.from('daily_tests')
    .select('*').eq('user_id', userId)
    .order('day', { ascending: false }).limit(ZILE_ISTORIC);
  if (error) return { rows: null, error };
  return { rows: data || [], error: null };
}

// Alege testul zilei (din formatul cerut; dacă nu are niciunul, din celălalt).
// `dupa` = testul de acum („🔀 Alt test"): următorul din listă, nu cel mai vechi.
async function alegeTest(supa, userId, { exam, format, premium, rows = [], azi, dupa = null }) {
  const incercari = format === 'pdf' ? ['pdf', 'interactiv'] : ['interactiv', ...(premium ? ['pdf'] : [])];
  for (const f of incercari) {
    // eslint-disable-next-line no-await-in-loop
    const lista = await poolExamen(supa, exam, { format: f, premium });
    if (!lista.length || (dupa && lista.length === 1 && lista[0].id === dupa)) continue;
    // eslint-disable-next-line no-await-in-loop
    const progres = await progresPe(supa, userId, lista.map((r) => r.id));
    let ales;
    if (dupa) ales = urmatorul(lista, dupa, progres);
    else {
      const folosite = new Map();
      for (const r of rows || []) if (r.content_id && r.day !== azi && !folosite.has(r.content_id)) folosite.set(r.content_id, r.day);
      const ieri = (rows || []).find((r) => r.day === xp.addDays(azi, -1));
      ales = misiune.alegeExercitiul(lista, { progres, folosite, ieri: ieri ? ieri.content_id : null });
    }
    if (ales) return { ales, format: f === 'pdf' ? 'pdf' : 'interactiv', total: lista.length, rezolvate: lista.filter((r) => (progres.get(r.id) ?? -1) >= 50).length };
  }
  return { ales: null, format: formatFolosit(format, premium), total: 0, rezolvate: 0 };
}

// Rândul zilei: nou sau actualizat
async function atribuie(supa, userId, { exam, format, premium, rows, azi, existent = null, dupa = null }) {
  const r = await alegeTest(supa, userId, { exam, format, premium, rows, azi, dupa });
  if (dupa && !r.ales) return { row: existent, drum: null, format: r.format, faraAltul: true };
  const camp = {
    exam, content_id: r.ales ? r.ales.id : null, content_title: r.ales ? r.ales.title : null,
    content_type: r.ales ? (r.ales.content_type === 'pdf' ? 'pdf' : 'interactive') : null,
  };
  let row = null;
  if (existent) {
    const { data } = await supa.from('daily_tests').update(camp).eq('id', existent.id).select().maybeSingle();
    row = data || { ...existent, ...camp };
  } else {
    const { data, error } = await supa.from('daily_tests')
      .insert({ user_id: userId, day: azi, status: 'deschis', ...camp }).select().maybeSingle();
    if (error || !data) { // două cereri simultane → rândul există deja
      const { data: again } = await supa.from('daily_tests').select('*').eq('user_id', userId).eq('day', azi).maybeSingle();
      row = again || null;
    } else row = data;
  }
  return { row, drum: { total: r.total, rezolvate: r.rezolvate }, format: r.format };
}

async function insigneAvute(supa, userId) {
  try {
    const { data } = await supa.from('user_badges').select('badge_id, name, icon, earned_at')
      .eq('user_id', userId).like('badge_id', 'pregatire-%');
    return data || [];
  } catch { return []; }
}

// Insignele câștigate acum (serie / zile / test complet) + rândurile din fluxul Arenei
async function acordaInsigne(supa, userId, { serie = 0, total = 0, complet = false, azi }) {
  const avute = new Set((await insigneAvute(supa, userId)).map((x) => x.badge_id));
  const castigate = [];
  for (const ins of insigneNoi({ serie, total, complet }, avute)) {
    // eslint-disable-next-line no-await-in-loop
    const { error } = await supa.from('user_badges').insert({ user_id: userId, badge_id: ins.id, name: ins.name, icon: ins.icon, meta: { pregatire: true, zi: azi } });
    if (error) continue;   // (user_id, badge_id) e unic: o cerere simultană a câștigat-o deja
    castigate.push({ id: ins.id, icon: ins.icon, name: ins.name });
    // eslint-disable-next-line no-await-in-loop
    await feed.post(supa, { userId, kind: 'insigna', dedupeKey: `insigna:${userId}:${ins.id}`, payload: { insigna: ins.name, insignaIcon: ins.icon } });
  }
  return castigate;
}

// Forma trimisă paginii /pregateste-ma
function vedere({ row, rows, azi, exam, format, formatAles, premium, drum = null, insigne = [] }) {
  const zile = (rows || []).filter((r) => r.status === 'lucrat').map((r) => r.day);
  if (row && row.status === 'lucrat' && !zile.includes(row.day)) zile.push(row.day);
  const s = misiune.serie(zile, azi);
  const E = examInfo(exam);
  const test = row && row.content_id
    ? { id: row.content_id, titlu: row.content_title || 'Testul zilei', tip: row.content_type === 'pdf' ? 'pdf' : 'interactiv' }
    : null;
  if (test) test.url = urlTest(test);
  const ultimele = (rows || []).filter((r) => r.status === 'lucrat' && r.day !== azi).slice(0, 6)
    .map((r) => ({ zi: r.day, titlu: r.content_title || 'Test', itemi: r.items_done || 0, nota: r.grade != null ? Number(r.grade) : null }));
  return {
    activ: true,
    azi,
    examen: E ? { id: E.id, label: E.label, scurt: E.scurt } : null,
    examene: EXAMENE.map((e) => ({ id: e.id, label: e.label, scurt: e.scurt })),
    format, formatAles: formatAles || null, premium,
    test,
    status: row ? row.status : null,
    lucrat: !!row && row.status === 'lucrat',
    itemi: row ? row.items_done || 0 : 0,
    prag: PRAG_ITEMI,
    celMaiBun: row && row.best_pct != null ? row.best_pct : null,
    nota: row && row.grade != null ? Number(row.grade) : null,    // privată: o vede doar elevul
    undeA: row ? row.worked_on || null : null,
    xpPrimit: row ? row.xp || 0 : 0,
    serie: s.curenta, record: s.record, total: s.total, aziFacut: s.aziFacut,
    saptamana: misiune.saptamana(zile, azi),
    drum,
    ultimele,
    insigne: insigne.map((b) => ({ id: b.badge_id, icon: b.icon, name: b.name, cand: b.earned_at })),
    insigneToate: INSIGNE.map((b) => ({ id: b.id, icon: b.icon, name: b.name, desc: b.desc })),
    recompensa: { xp: XP_ZI, bun: XP_BUN, pragBun: PRAG_BUN, coins: MONEDE, seriePas: SERIE_PAS, serieXp: SERIE_XP, serieMonede: SERIE_MONEDE },
  };
}

// Starea pentru /pregateste-ma (și atribuirea testului zilei)
async function stare(supa, userId, profile = null) {
  try {
    const azi = xp.dayKey();
    const { rows, error } = await istoric(supa, userId);
    if (error) return { activ: false, setup: !isMissing(error) ? true : false, mesaj: error.message };
    const stats = await xp.ensureStats(supa, userId);
    const premium = ePremium(profile);
    const deAzi = rows.find((r) => r.day === azi) || null;
    const exam = examValid(stats.prep_exam) ? stats.prep_exam
      : (deAzi && examValid(deAzi.exam) ? deAzi.exam : ((rows.find((r) => examValid(r.exam)) || {}).exam || null));
    if (!exam) {
      // sugestia: examenul din „Planul meu" (meditații), dacă și l-a ales acolo
      let sugestie = null;
      try {
        const { data: med } = await supa.from('ai_meditatii_profile').select('exam_target').eq('user_id', userId).maybeSingle();
        if (med && examValid(med.exam_target)) sugestie = med.exam_target;
      } catch { /* fără „Planul meu" */ }
      return {
        activ: true, azi, alegeExamen: true, examen: null, sugestie,
        examene: EXAMENE.map((e) => ({ id: e.id, label: e.label, scurt: e.scurt })),
        premium, prag: PRAG_ITEMI, serie: 0, record: 0, total: 0, saptamana: misiune.saptamana([], azi),
        insigneToate: INSIGNE.map((b) => ({ id: b.id, icon: b.icon, name: b.name, desc: b.desc })),
        recompensa: { xp: XP_ZI, bun: XP_BUN, pragBun: PRAG_BUN, coins: MONEDE, seriePas: SERIE_PAS, serieXp: SERIE_XP, serieMonede: SERIE_MONEDE },
      };
    }
    const formatAles = formatValid(stats.prep_format) ? stats.prep_format : null;
    const format = formatFolosit(formatAles || 'interactiv', premium);
    const insigne = await insigneAvute(supa, userId);
    // testul de azi există (sau ziua e deja bifată fără test) → doar îl arătăm
    if (deAzi && (deAzi.content_id || deAzi.status === 'lucrat') && deAzi.exam === exam) {
      return vedere({ row: deAzi, rows, azi, exam, format: deAzi.content_type === 'pdf' ? 'pdf' : format, formatAles, premium, insigne });
    }
    const r = await atribuie(supa, userId, { exam, format, premium, rows, azi, existent: deAzi });
    return vedere({ row: r.row, rows, azi, exam, format: r.format, formatAles, premium, drum: r.drum, insigne });
  } catch (e) {
    console.warn('pregatire.stare:', e?.message || e);
    return { activ: false, mesaj: e?.message || 'eroare' };
  }
}

// Elevul își alege (sau schimbă) examenul și, opțional, formatul testului zilei
async function alege(supa, userId, profile, { examen = undefined, format = undefined } = {}) {
  if (examen !== undefined && !examValid(examen)) return { error: 'Alege examenul: Evaluarea Națională sau unul dintre profilurile de BAC.' };
  if (format !== undefined && format !== null && !formatValid(format)) return { error: 'Format necunoscut.' };
  const { error: eTab } = await supa.from('daily_tests').select('id').limit(1);
  if (eTab) return { error: 'Pregătirea zilnică nu e activă încă (Admin: rulează supabase/pregatire_zilnica.sql).', setup: false };
  await xp.ensureStats(supa, userId);
  const patch = { updated_at: new Date().toISOString() };
  if (examen !== undefined) patch.prep_exam = examen;
  if (format !== undefined) patch.prep_format = format;
  const { error } = await supa.from('user_stats').update(patch).eq('user_id', userId);
  if (error) return { error: `Nu am putut salva alegerea (${error.message}).` };
  // testul de azi, dacă nu e încă lucrat, trece pe noul examen / format
  const azi = xp.dayKey();
  const { rows } = await istoric(supa, userId);
  const deAzi = (rows || []).find((r) => r.day === azi) || null;
  if (deAzi && deAzi.status === 'deschis') {
    const stats = await xp.ensureStats(supa, userId);
    const exam = examValid(stats.prep_exam) ? stats.prep_exam : deAzi.exam;
    const premium = ePremium(profile);
    await atribuie(supa, userId, { exam, format: formatFolosit(stats.prep_format || 'interactiv', premium), premium, rows, azi, existent: deAzi });
  }
  return { ok: true, pregatire: await stare(supa, userId, profile) };
}

// „🔀 Alt test" — următorul din listă (testul de azi rămâne valabil dacă e lucrat)
async function altTest(supa, userId, profile) {
  const azi = xp.dayKey();
  const { rows, error } = await istoric(supa, userId);
  if (error) return { error: 'Pregătirea zilnică nu e activă încă.' };
  const deAzi = rows.find((r) => r.day === azi) || null;
  const stats = await xp.ensureStats(supa, userId);
  const exam = examValid(stats.prep_exam) ? stats.prep_exam : (deAzi && deAzi.exam);
  if (!exam) return { error: 'Alege întâi examenul.' };
  const premium = ePremium(profile);
  const format = formatFolosit(stats.prep_format || 'interactiv', premium);
  const r = await atribuie(supa, userId, { exam, format, premium, rows, azi, existent: deAzi, dupa: deAzi && deAzi.content_id ? deAzi.content_id : null });
  return { ok: true, faraAltul: !!r.faraAltul, pregatire: await stare(supa, userId, profile) };
}

// Apelat după fiecare corectare / salvare de scor la un material de examen.
//   itemi   — câte exerciții a lucrat elevul în acest test (cumulativ, la acest material)
//   pct     — procentul (verificat) sau null; nota — nota testului sau null (privată)
//   subiecte — [1, 2, 3] subiectele lucrate (pentru flux, fără note); complet — testul întreg
// Bifează ziua o singură dată (actualizare condiționată pe status) și dă răsplata.
async function inregistreaza(supa, userId, { content = null, itemi = 0, pct = null, nota = null, subiecte = [], complet = false, verificat = true } = {}) {
  try {
    if (!userId || !content || !eDeExamen(content)) return null;
    const n = Math.max(0, Math.round(Number(itemi) || 0));
    if (n < 1) return null;
    const azi = xp.dayKey();
    const { data: row0, error } = await supa.from('daily_tests').select('*').eq('user_id', userId).eq('day', azi).maybeSingle();
    if (error) return null;                                   // migrarea nu e rulată
    let row = row0;
    if (!row) {
      // a lucrat la un test de examen fără să fi deschis azi pagina: contează
      // doar dacă și-a început pregătirea (și-a ales examenul)
      const { data: st } = await supa.from('user_stats').select('prep_exam').eq('user_id', userId).maybeSingle();
      if (!st || !examValid(st.prep_exam)) return null;
      const { data: ins } = await supa.from('daily_tests').insert({
        user_id: userId, day: azi, exam: st.prep_exam, status: 'deschis',
        content_id: content.id || null, content_title: content.title || null,
        content_type: content.content_type === 'pdf' ? 'pdf' : 'interactive',
      }).select().maybeSingle();
      row = ins || (await supa.from('daily_tests').select('*').eq('user_id', userId).eq('day', azi).maybeSingle()).data;
      if (!row) return null;
    }
    const itemiZi = Math.max(row.items_done || 0, n);
    const best = pct == null ? row.best_pct : Math.max(row.best_pct == null ? -1 : row.best_pct, Math.round(pct));
    const grade = nota == null ? row.grade : Math.max(row.grade == null ? 0 : Number(row.grade), Number(nota));
    const sub = numeSubiecte(subiecte);
    const undeA = complet ? 'tot testul' : (sub.length ? sub.join(', ') : row.worked_on);
    const camp = { items_done: itemiZi, best_pct: best, grade, worked_on: undeA };
    const exam = examInfo(row.exam);
    const baza = { titlu: content.title || row.content_title || null, itemi: itemiZi, prag: PRAG_ITEMI, examen: exam ? exam.label : null };

    if (row.status === 'lucrat' || itemiZi < PRAG_ITEMI) {
      await supa.from('daily_tests').update(camp).eq('id', row.id);
      // testul întreg rezolvat mai târziu, în aceeași zi → fluxul o spune, iar
      // insigna „Test complet" se câștigă și acum (nu doar la bifarea zilei)
      let insigne = [];
      if (row.status === 'lucrat' && complet) {
        await feed.post(supa, { userId, kind: 'test', dedupeKey: `test:${userId}:${azi}`, actualizeaza: true, payload: { examen: baza.examen, complet: true, link: '/pregateste-ma' } });
        insigne = await acordaInsigne(supa, userId, { complet: true, azi });
      }
      return { ...baza, lucrat: row.status === 'lucrat', tocmaiBifata: false, lipsa: Math.max(0, PRAG_ITEMI - itemiZi), ...(insigne.length ? { insigne } : {}) };
    }

    // ── ziua se bifează acum: o singură cerere câștigă rândul ──
    const { data: upd } = await supa.from('daily_tests')
      .update({ ...camp, status: 'lucrat', done_at: new Date().toISOString() })
      .eq('id', row.id).eq('status', 'deschis').select();
    if (!Array.isArray(upd) || !upd.length) return { ...baza, lucrat: true, tocmaiBifata: false, lipsa: 0 };

    const { rows } = await istoric(supa, userId);
    const zile = (rows || []).filter((r) => r.status === 'lucrat').map((r) => r.day);
    if (!zile.includes(azi)) zile.push(azi);
    const s = misiune.serie(zile, azi);
    const rec = recompensa({ pct: best != null && best >= 0 ? best : null, verificat, serieNoua: s.curenta });
    const b = await xp.bonus(supa, userId, {
      source: 'pregatire-zilnica', refId: content.id || null, xp: rec.xp, coins: rec.coins,
      meta: { pregatire: 'zilnica', itemi: itemiZi, serie: s.curenta, titlu: baza.titlu, ...(rec.bonusSerie ? { bonus_serie: true } : {}) },
    });
    await supa.from('daily_tests').update({ xp: rec.xp }).eq('id', row.id);

    // fluxul Arenei: ce a făcut (fără note), seria la praguri, apoi insignele noi
    await feed.post(supa, {
      userId, kind: 'test', dedupeKey: `test:${userId}:${azi}`,
      payload: { examen: baza.examen, subiecte: complet ? [] : sub, complet, link: '/pregateste-ma' },
    });
    if (SERII_IN_FLUX.includes(s.curenta)) {
      await feed.post(supa, { userId, kind: 'serie', dedupeKey: `serie:${userId}:${azi}`, payload: { serie: s.curenta, link: '/pregateste-ma' } });
    }
    const castigate = await acordaInsigne(supa, userId, { serie: s.curenta, total: s.total, complet, azi });

    return {
      ...baza, lucrat: true, tocmaiBifata: true, lipsa: 0,
      xp: rec.xp, coins: rec.coins, bun: rec.bun, bonusSerie: rec.bonusSerie,
      serie: s.curenta, record: s.record, total: s.total,
      insigne: castigate, totalXp: b ? b.totalXp : null,
    };
  } catch (e) {
    console.warn('pregatire.inregistreaza:', e?.message || e);
    return null; // pregătirea nu blochează niciodată salvarea scorului
  }
}

// Rezumatul pentru navbar / Home / Arena (fără atribuire)
async function rezumat(supa, userId) {
  try {
    const azi = xp.dayKey();
    const [{ data: st }, { data: rows, error }] = await Promise.all([
      supa.from('user_stats').select('prep_exam').eq('user_id', userId).maybeSingle(),
      supa.from('daily_tests').select('day, status').eq('user_id', userId).order('day', { ascending: false }).limit(120),
    ]);
    if (error) return null;
    const zile = (rows || []).filter((r) => r.status === 'lucrat').map((r) => r.day);
    const s = misiune.serie(zile, azi);
    const deAzi = (rows || []).find((r) => r.day === azi);
    return { examen: st && examValid(st.prep_exam) ? st.prep_exam : null, azi: deAzi ? deAzi.status : null, serie: s.curenta, aziFacut: s.aziFacut };
  } catch { return null; }
}

module.exports = {
  EXAMENE, FORMATE, SUBCAT_PDF, PRAG_ITEMI, XP_ZI, XP_BUN, PRAG_BUN, MONEDE, SERIE_PAS, SERIE_XP, SERIE_MONEDE, INSIGNE, SERII_IN_FLUX,
  // pure
  examInfo, examValid, formatValid, examenulMaterialului, eDeExamen, urlTest, numeSubiecte, subiecteDinRaspunsuri,
  raspunsuriDate, recompensa, insigneNoi, formatFolosit, urmatorul,
  // cu baza de date
  poolExamen, stare, alege, altTest, inregistreaza, rezumat,
};
