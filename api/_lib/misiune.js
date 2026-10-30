// =====================================================================
// api/_lib/misiune.js — MISIUNEA ZILNICĂ din Arena matematică (30 oct. 2026)
//
// Ca la Duolingo: UN exercițiu pe zi. Elevul își alege clasa (a V-a … a XII-a)
// și primește, în fiecare zi, următorul exercițiu INTERACTIV din site al clasei,
// în ordinea din site — „drumul clasei": întâi cele pe care nu le-a făcut
// niciodată, apoi cele la care a avut sub 70%, apoi recapitulare. Exercițiul
// zilei rămâne același toată ziua (se poate relua de câte ori vrea).
//
// Misiunea e ÎNDEPLINITĂ când elevul trimite rezolvarea cu cel puțin 50%
// (scorul verificat pe server de api/ai-score.js — nu se poate „bifa" din
// browser). Recompensa trece prin xp.bonus (XP + monede, plafonul ligii);
// la fiecare 7 zile la rând, un bonus de serie.
//
// Progresul arătat: zilele la rând cu misiunea îndeplinită, recordul, totalul,
// săptămâna (L M M J V S D) și cât a parcurs din drumul clasei.
//
// Tabela: supabase/gamificare_v8_misiune_zilnica.sql (daily_exercises +
// user_stats.mission_category). Doar serverul scrie (rolul de serviciu).
// Funcțiile cu baza de date nu aruncă: Arena și salvarea scorului nu au voie
// să cadă din cauza misiunii.
// =====================================================================
const xp = require('./xp');
const http = require('./http');
const barem = require('./barem');

const CLASE = [
  { id: 'clasa-5', nr: 5, label: 'a V-a' },
  { id: 'clasa-6', nr: 6, label: 'a VI-a' },
  { id: 'clasa-7', nr: 7, label: 'a VII-a' },
  { id: 'clasa-8', nr: 8, label: 'a VIII-a' },
  { id: 'clasa-9', nr: 9, label: 'a IX-a' },
  { id: 'clasa-10', nr: 10, label: 'a X-a' },
  { id: 'clasa-11', nr: 11, label: 'a XI-a' },
  { id: 'clasa-12', nr: 12, label: 'a XII-a' },
];
// Clasele fără exerciții interactive proprii (încă) iau din examenul lor:
// a VIII-a → Evaluarea Națională, liceul → Bacalaureatul.
const REZERVA = {
  'clasa-8': 'evaluare-nationala',
  'clasa-9': 'bacalaureat', 'clasa-10': 'bacalaureat', 'clasa-11': 'bacalaureat', 'clasa-12': 'bacalaureat',
};

const PRAG_PCT = 50;          // misiunea e îndeplinită de la 50%
const PRAG_STAPANIT = 70;     // sub atât, exercițiul revine la recapitulare
const XP_BAZA = 20;           // recompensa misiunii
const XP_PERFECT = 10;        // + la 90% sau mai mult
const MONEDE = 5;
const SERIE_PAS = 7;          // la fiecare 7 zile la rând…
const SERIE_XP = 30;          // … un bonus de serie
const SERIE_MONEDE = 10;
const ZILE_ISTORIC = 400;     // cât istoric citim pentru serie și record

const clasaValida = (c) => CLASE.some((x) => x.id === c);
const clasaInfo = (c) => CLASE.find((x) => x.id === c) || null;
const ZILE_SAPT = ['L', 'M', 'M', 'J', 'V', 'S', 'D'];

// ─── Logica pură (testabilă) ────────────────────────────────────────────────

// Seria: zilele consecutive cu misiunea îndeplinită care se termină AZI sau
// IERI (dacă azi nu e încă făcută, seria de ieri e încă „vie" până la noapte).
// Recordul: cea mai lungă serie din istoric.
function serie(zile, azi) {
  const set = [...new Set((zile || []).filter(Boolean))].sort();
  let record = 0, run = 0, prev = null;
  for (const d of set) {
    run = prev && xp.daysBetween(prev, d) === 1 ? run + 1 : 1;
    if (run > record) record = run;
    prev = d;
  }
  const are = new Set(set);
  let start = are.has(azi) ? azi : xp.addDays(azi, -1);
  let curenta = 0;
  while (are.has(start)) { curenta++; start = xp.addDays(start, -1); }
  return { curenta, record, total: set.length, aziFacut: are.has(azi) };
}

// Săptămâna curentă (de luni), cu starea fiecărei zile.
function saptamana(zile, azi) {
  const are = new Set((zile || []).filter(Boolean));
  const luni = xp.weekStart(new Date(`${azi}T12:00:00Z`));
  return ZILE_SAPT.map((label, i) => {
    const day = xp.addDays(luni, i);
    const stare = are.has(day) ? 'facut' : day === azi ? 'azi' : day > azi ? 'viitor' : 'ratat';
    return { day, label, stare };
  });
}

// Exercițiul zilei, din drumul clasei (pool = materialele, în ordinea din site):
//   1) primul pe care elevul nu l-a rezolvat NICIODATĂ (și nu i-a fost misiune);
//   2) altfel, primul la care are sub 70% (dar nu cel de ieri — altă zi, altceva);
//   3) altfel, recapitulare: cel care i-a fost misiune cel mai demult.
// progres: Map(content_id → procent), folosite: Map(content_id → ultima zi de misiune)
function alegeExercitiul(pool, { progres = new Map(), folosite = new Map(), ieri = null } = {}) {
  const lista = Array.isArray(pool) ? pool.filter((r) => r && r.id) : [];
  if (!lista.length) return null;
  const nou = lista.find((r) => !progres.has(r.id) && !folosite.has(r.id));
  if (nou) return nou;
  const slab = lista.find((r) => r.id !== ieri && (progres.has(r.id) ? progres.get(r.id) : 0) < PRAG_STAPANIT);
  if (slab) return slab;
  const cand = lista.filter((r) => r.id !== ieri);
  const sursa = cand.length ? cand : lista;
  return sursa.reduce((best, r) => {
    const a = folosite.get(best.id) || '';
    const b = folosite.get(r.id) || '';
    return b < a ? r : best;
  }, sursa[0]);
}

// Cât din drumul clasei a parcurs: exercițiile clasei rezolvate cu ≥ 50%.
function drum(pool, progres) {
  const total = Array.isArray(pool) ? pool.length : 0;
  const parcurse = total ? pool.filter((r) => (progres.get(r.id) ?? -1) >= PRAG_PCT).length : 0;
  return { parcurse, total, pct: total ? Math.round((parcurse / total) * 100) : 0 };
}

// Recompensa, la îndeplinire: baza + „perfect" + bonusul de serie (la 7, 14, 21…)
function recompensa(pct, serieNoua) {
  const perfect = pct >= 90;
  const bonusSerie = serieNoua > 0 && serieNoua % SERIE_PAS === 0;
  return {
    xp: XP_BAZA + (perfect ? XP_PERFECT : 0) + (bonusSerie ? SERIE_XP : 0),
    coins: MONEDE + (bonusSerie ? SERIE_MONEDE : 0),
    perfect, bonusSerie,
  };
}

// ─── Cu baza de date ────────────────────────────────────────────────────────

// Exercițiile interactive ale clasei, în ordinea din site, fără bareme.
// Fără abonament: doar cele gratuite. Clasa fără exerciții → rezerva (EN / BAC).
async function poolClasa(supa, categorie, { premium = false } = {}) {
  const citeste = async (cat) => {
    const rows = await http.allRows((from, to) => {
      let q = supa.from('content')
        .select('id, title, category, is_free, content_type, subcategory, file_url, sort_order')
        .eq('content_type', 'interactive').eq('category', cat);
      if (!premium) q = q.eq('is_free', true);
      return q.order('sort_order', { ascending: true }).range(from, to);
    }, { pageSize: 1000, maxPages: 3 });
    return rows.filter((r) => !barem.isBaremRow(r));
  };
  let lista = await citeste(categorie);
  let din = categorie;
  if (!lista.length && REZERVA[categorie]) {
    lista = await citeste(REZERVA[categorie]);
    din = REZERVA[categorie];
  }
  return { lista, din };
}

// procentele elevului pe exercițiile din pool (progress — cel mai recent scor)
async function progresPe(supa, userId, ids) {
  const out = new Map();
  if (!ids.length) return out;
  const rows = await http.inBatches(ids, (chunk, from, to) => supa.from('progress')
    .select('content_id, score, max_score').eq('user_id', userId).in('content_id', chunk).range(from, to));
  for (const p of rows) out.set(p.content_id, p.max_score > 0 ? Math.round((p.score / p.max_score) * 100) : 0);
  return out;
}

async function istoric(supa, userId) {
  const { data, error } = await supa.from('daily_exercises')
    .select('*').eq('user_id', userId)
    .order('day', { ascending: false }).limit(ZILE_ISTORIC);
  if (error) return { rows: null, error };
  return { rows: data || [], error: null };
}

// Pune exercițiul zilei într-un rând (nou sau existent, încă deschis).
async function atribuie(supa, userId, profile, categorie, rows, azi, existent = null) {
  const premium = !!(profile && (profile.subscription_status === 'active' || profile.is_admin));
  const { lista, din } = await poolClasa(supa, categorie, { premium });
  const progres = await progresPe(supa, userId, lista.map((r) => r.id));
  const folosite = new Map();
  for (const r of rows || []) if (r.content_id && r.day !== azi && !folosite.has(r.content_id)) folosite.set(r.content_id, r.day);
  const ieriRow = (rows || []).find((r) => r.day === xp.addDays(azi, -1));
  const ales = alegeExercitiul(lista, { progres, folosite, ieri: ieriRow ? ieriRow.content_id : null });
  const camp = {
    category: categorie, content_id: ales ? ales.id : null, content_title: ales ? ales.title : null,
    status: 'deschis', attempts: 0, best_pct: null, xp: 0, done_at: null,
  };
  let row = null;
  if (existent) {
    const { data } = await supa.from('daily_exercises').update(camp)
      .eq('id', existent.id).eq('status', 'deschis').select().maybeSingle();
    row = data || existent;
  } else {
    const { data, error } = await supa.from('daily_exercises')
      .insert({ user_id: userId, day: azi, ...camp }).select().maybeSingle();
    if (error || !data) { // două cereri simultane → rândul există deja
      const { data: again } = await supa.from('daily_exercises')
        .select('*').eq('user_id', userId).eq('day', azi).maybeSingle();
      row = again || null;
    } else row = data;
  }
  return { row, lista, progres, din };
}

// Forma trimisă paginii
function vedere({ row, rows, azi, categorie, lista, progres, din }) {
  const zile = (rows || []).filter((r) => r.status === 'indeplinit').map((r) => r.day);
  if (row && row.status === 'indeplinit' && !zile.includes(row.day)) zile.push(row.day);
  const s = serie(zile, azi);
  const info = clasaInfo(categorie);
  return {
    activ: true,
    azi,
    clasa: info ? { id: info.id, nr: info.nr, label: info.label } : null,
    clase: CLASE,
    din: din && din !== categorie ? din : null,     // exercițiul vine din rezervă (EN / BAC)
    exercitiu: row && row.content_id ? { id: row.content_id, titlu: row.content_title || 'Exercițiul zilei' } : null,
    status: row ? row.status : null,
    incercari: row ? row.attempts || 0 : 0,
    celMaiBun: row && row.best_pct != null ? row.best_pct : null,
    xpPrimit: row ? row.xp || 0 : 0,
    prag: PRAG_PCT,
    serie: s.curenta,
    record: s.record,
    total: s.total,
    aziFacut: s.aziFacut,
    saptamana: saptamana(zile, azi),
    drum: lista ? drum(lista, progres || new Map()) : null,
    recompensa: { xp: XP_BAZA, perfect: XP_PERFECT, coins: MONEDE, seriePas: SERIE_PAS, serieXp: SERIE_XP },
  };
}

// Starea misiunii pentru /arena (și atribuirea exercițiului zilei).
async function stare(supa, userId, profile = null) {
  try {
    const azi = xp.dayKey();
    const { rows, error } = await istoric(supa, userId);
    if (error) return { activ: false, setup: false, mesaj: error.message };
    const stats = await xp.ensureStats(supa, userId);
    const deAzi = rows.find((r) => r.day === azi) || null;
    const categorie = clasaValida(stats.mission_category) ? stats.mission_category
      : (deAzi && clasaValida(deAzi.category) ? deAzi.category
        : ((rows.find((r) => clasaValida(r.category)) || {}).category || null));
    if (!categorie) {
      // încă nicio clasă aleasă: pagina arată alegerea (a V-a … a XII-a)
      return { activ: true, azi, clasa: null, clase: CLASE, alegeClasa: true, serie: 0, record: 0, total: 0, saptamana: saptamana([], azi) };
    }
    // (îndeplinită și fără exercițiu — ex. materialul s-a șters între timp — rămâne bifată)
    if (deAzi && (deAzi.content_id || deAzi.status === 'indeplinit')) {
      // drumul clasei (pentru bara de progres) — citit, nu reatribuit
      const premium = !!(profile && (profile.subscription_status === 'active' || profile.is_admin));
      const { lista, din } = await poolClasa(supa, deAzi.category, { premium });
      const progres = await progresPe(supa, userId, lista.map((r) => r.id));
      return vedere({ row: deAzi, rows, azi, categorie: deAzi.category, lista, progres, din });
    }
    // fără misiune azi (sau una fără exercițiu, ex. clasa n-avea atunci nimic) → o atribuim
    const r = await atribuie(supa, userId, profile, categorie, rows, azi, deAzi);
    return vedere({ row: r.row, rows, azi, categorie, lista: r.lista, progres: r.progres, din: r.din });
  } catch (e) {
    console.warn('misiune.stare:', e?.message || e);
    return { activ: false, mesaj: e?.message || 'eroare' };
  }
}

// Elevul își alege (sau își schimbă) clasa. Misiunea de azi, dacă nu e încă
// îndeplinită, trece pe un exercițiu din noua clasă; altfel noua clasă începe mâine.
async function alegeClasa(supa, userId, profile, categorie) {
  if (!clasaValida(categorie)) return { error: 'Alege o clasă între a V-a și a XII-a.' };
  const { error: eTab } = await supa.from('daily_exercises').select('id').limit(1);
  if (eTab) return { error: 'Misiunea zilnică nu e activă încă (migrarea supabase/gamificare_v8_misiune_zilnica.sql nu e rulată).' };
  await xp.ensureStats(supa, userId);
  const { error } = await supa.from('user_stats')
    .update({ mission_category: categorie, updated_at: new Date().toISOString() }).eq('user_id', userId);
  if (error) return { error: `Nu am putut salva clasa (${error.message}).` };
  const azi = xp.dayKey();
  const { rows } = await istoric(supa, userId);
  const deAzi = (rows || []).find((r) => r.day === azi) || null;
  if (deAzi && deAzi.status === 'deschis' && deAzi.category !== categorie) {
    await atribuie(supa, userId, profile, categorie, rows, azi, deAzi);
  }
  return { ok: true, misiune: await stare(supa, userId, profile) };
}

// Apelat de api/ai-score.js după fiecare rezolvare FINALĂ (nu și la salvarea
// parțială): dacă exercițiul e cel al misiunii de azi, numără încercarea și,
// de la 50%, îndeplinește misiunea (o singură dată — condiționat pe status).
async function inregistreaza(supa, userId, { contentId, score = 0, maxScore = 0, verified = true } = {}) {
  try {
    if (!contentId) return null;
    const azi = xp.dayKey();
    const { data: row, error } = await supa.from('daily_exercises')
      .select('*').eq('user_id', userId).eq('day', azi).maybeSingle();
    if (error || !row || row.content_id !== contentId) return null;
    const pct = maxScore > 0 ? Math.max(0, Math.min(100, Math.round((score / maxScore) * 100))) : 0;
    const attempts = (row.attempts || 0) + 1;
    const best = Math.max(row.best_pct == null ? -1 : row.best_pct, pct);
    const dejaFacuta = row.status === 'indeplinit';

    if (dejaFacuta || pct < PRAG_PCT) {
      await supa.from('daily_exercises').update({ attempts, best_pct: best }).eq('id', row.id);
      return {
        indeplinita: dejaFacuta, tocmaiIndeplinita: false, pct, prag: PRAG_PCT, incercari: attempts,
        titlu: row.content_title || null,
      };
    }

    // ── îndeplinită acum: o singură cerere câștigă rândul (condiția pe status) ──
    const { data: upd } = await supa.from('daily_exercises')
      .update({ status: 'indeplinit', attempts, best_pct: best, done_at: new Date().toISOString() })
      .eq('id', row.id).eq('status', 'deschis').select();
    if (!Array.isArray(upd) || !upd.length) {
      return { indeplinita: true, tocmaiIndeplinita: false, pct, prag: PRAG_PCT, incercari: attempts, titlu: row.content_title || null };
    }
    const { rows } = await istoric(supa, userId);
    const zile = (rows || []).filter((r) => r.status === 'indeplinit').map((r) => r.day);
    if (!zile.includes(azi)) zile.push(azi);
    const s = serie(zile, azi);
    // scor neverificat (material fără chei): misiunea se bifează, dar fără bonusul „perfect"
    const rec = recompensa(verified ? pct : Math.min(pct, 89), s.curenta);
    const b = await xp.bonus(supa, userId, {
      source: 'misiune-zilnica', refId: contentId, xp: rec.xp, coins: rec.coins,
      meta: { misiune: 'zilnica', pct, serie: s.curenta, titlu: row.content_title || null, ...(rec.bonusSerie ? { bonus_serie: true } : {}) },
    });
    await supa.from('daily_exercises').update({ xp: rec.xp }).eq('id', row.id);
    return {
      indeplinita: true, tocmaiIndeplinita: true, pct, prag: PRAG_PCT, incercari: attempts,
      titlu: row.content_title || null,
      xp: rec.xp, coins: rec.coins, perfect: rec.perfect, bonusSerie: rec.bonusSerie,
      serie: s.curenta, record: s.record, total: s.total,
      totalXp: b ? b.totalXp : null,
    };
  } catch (e) {
    console.warn('misiune.inregistreaza:', e?.message || e);
    return null; // misiunea nu blochează niciodată salvarea scorului
  }
}

module.exports = {
  CLASE, REZERVA, PRAG_PCT, PRAG_STAPANIT, XP_BAZA, XP_PERFECT, MONEDE, SERIE_PAS, SERIE_XP, SERIE_MONEDE,
  // pure
  clasaValida, clasaInfo, serie, saptamana, alegeExercitiul, drum, recompensa,
  // cu baza de date
  poolClasa, stare, alegeClasa, inregistreaza,
};
