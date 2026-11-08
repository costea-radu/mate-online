// =====================================================================
// api/_lib/pregatireNotificari.js — AMINTIREA ZILNICĂ A TESTULUI (8 nov. 2026)
//
// „🎯 Pregătește-mă de examen": „acest buton să amintească zilnic printr-o
// notificare, utilizatorul să rezolve un test".
//
// Ca la misiunea zilnică (api/_lib/misiuneNotificari.js — aceleași chei VAPID,
// aceeași tabelă push_subscriptions, același clopoțel ca rezervă):
//   · elevul apasă în /pregateste-ma „🔔 Amintește-mi" și își alege ora
//     (implicit 18:00); în fiecare zi, la ora aleasă, DACĂ ziua nu e încă bifată
//     (sub PRAG_ITEMI exerciții lucrate), primește „📝 Testul zilei te așteaptă"
//     — clicul deschide direct testul zilei;
//   · seara (MISIUNE_SERIE_ORA, implicit 20:00), cine are o serie de cel puțin 2
//     zile și n-a lucrat încă primește „🔥 Seria ta de N zile se pierde la noapte";
//   · cel mult o amintire + o alertă de serie pe zi (revendicate atomic în
//     user_stats.prep_notified_on / prep_streak_notified_on); nimic 22:00–8:00;
//     nimic cui a oprit notificările din cont.
// Cronul: GET /api/gamificare?action=cron-pregatire, la fiecare oră (vercel.json).
// SQL: supabase/pregatire_zilnica.sql.
// =====================================================================
const xp = require('./xp');
const http = require('./http');
const PUSH = require('./push');
const MN = require('./misiuneNotificari');
const misiune = require('./misiune');
const P = require('./pregatireZilnica');

const ORE = MN.ORE;
const ORA_IMPLICITA = 18;
const { SERIE_ORA, SERIE_MIN, FEREASTRA, LOT, PARALEL } = MN;
const isMissing = MN.isMissing;

const zile = (n) => `${n} ${n === 1 ? 'zi' : 'zile'}`;
const urlTest = (row) => (row && row.content_id
  ? P.urlTest({ id: row.content_id, tip: row.content_type === 'pdf' ? 'pdf' : 'interactiv' })
  : '/pregateste-ma');

// ─── Mesajele ────────────────────────────────────────────────────────────────
function mesajAmintire({ titlu = null, examen = null, serie = 0, row = null, azi = xp.dayKey() } = {}) {
  const t = String(titlu || '').trim().slice(0, 90);
  const E = P.examInfo(examen);
  return {
    title: serie >= 1 ? `📝 Testul zilei · seria ta: ${zile(serie)} 🔥` : '📝 Testul zilei te așteaptă',
    body: t
      ? `${t} — rezolvă măcar ${P.PRAG_ITEMI} exerciții și ziua e bifată. Contează și o parte din test.`
      : `Un test${E ? ` de ${E.label}` : ''}: rezolvă măcar ${P.PRAG_ITEMI} exerciții și ziua e bifată.`,
    url: urlTest(row),
    tag: `pregatire-${azi}`,
    kind: 'pregatire',
    requireInteraction: false,
  };
}

function mesajSerie({ serie = 0, titlu = null, row = null, azi = xp.dayKey() } = {}) {
  const t = String(titlu || '').trim().slice(0, 80);
  return {
    title: `🔥 Seria ta de ${zile(serie)} de pregătire se pierde la noapte`,
    body: t ? `${P.PRAG_ITEMI} exerciții o salvează: 📝 ${t}.` : `${P.PRAG_ITEMI} exerciții dintr-un test o salvează.`,
    url: urlTest(row),
    tag: `pregatire-${azi}`,
    kind: 'pregatire',
    requireInteraction: false,
  };
}

// ─── Starea pentru pagină ────────────────────────────────────────────────────
async function stare(supa, userId) {
  let push = { on: false, key: null, why: null };
  try { const p = await PUSH.pushInfo(supa); push = { on: !!p.on, key: p.key || null, why: p.why || null }; } catch { /* fără push */ }
  const base = { ore: ORE, oraImplicita: ORA_IMPLICITA, serieOra: SERIE_ORA, push };
  try {
    const { data, error } = await supa.from('user_stats')
      .select('prep_notify, prep_notify_hour').eq('user_id', userId).maybeSingle();
    if (error) return { ...base, setup: !isMissing(error), on: false, ales: false, ora: ORA_IMPLICITA, mesaj: error.message };
    return {
      ...base,
      setup: true,
      on: data?.prep_notify === true,
      ales: data ? data.prep_notify !== null && data.prep_notify !== undefined : false,
      ora: MN.oraValida(data?.prep_notify_hour) ? Number(data.prep_notify_hour) : ORA_IMPLICITA,
    };
  } catch (e) {
    return { ...base, setup: false, on: false, ales: false, ora: ORA_IMPLICITA, mesaj: e.message };
  }
}

async function seteaza(supa, userId, { on, ora, subscription = null, unsubscribe = null, userAgent = '' } = {}) {
  await xp.ensureStats(supa, userId);
  const patch = { updated_at: new Date().toISOString() };
  if (on !== undefined) patch.prep_notify = !!on;
  if (ora !== undefined && ora !== null) {
    if (!MN.oraValida(ora)) { const e = new Error('Alege o oră între 8:00 și 21:00.'); e.status = 400; throw e; }
    patch.prep_notify_hour = Number(ora);
  }
  const { error } = await supa.from('user_stats').update(patch).eq('user_id', userId);
  if (error) {
    if (isMissing(error)) { const e = new Error('Amintirile testului zilei nu sunt încă activate (Admin: rulează supabase/pregatire_zilnica.sql).'); e.status = 503; throw e; }
    throw new Error(`Nu am putut salva amintirea (${error.message}).`);
  }
  if (unsubscribe) { try { await PUSH.removeSubscription(supa, userId, String(unsubscribe).slice(0, 900)); } catch { /* ignorăm */ } }
  let salvat = false;
  if (on !== false && subscription) {
    try {
      const info = await PUSH.pushInfo(supa);
      if (info.on) salvat = await PUSH.saveSubscription(supa, userId, subscription, userAgent);
    } catch { salvat = false; }
  }
  return { ok: true, pushSalvat: salvat, notificari: await stare(supa, userId) };
}

async function trimiteProba(supa, userId) {
  const info = await PUSH.pushInfo(supa).catch(() => ({ on: false }));
  if (!info.on) return { ok: true, push: false, sent: 0, motiv: info.why === 'sql' ? 'sql' : 'chei' };
  const r = await PUSH.sendToUser(supa, userId, {
    title: '🔔 Notificările merg!',
    body: 'Așa îți amintesc de testul zilei, la ora aleasă — doar în zilele în care n-ai lucrat încă.',
    url: '/pregateste-ma', tag: 'pregatire-proba', kind: 'pregatire', requireInteraction: false,
  }, { ttl: 600, urgency: 'normal' });
  return { ok: true, push: true, ...r };
}

// ─── Trimiterea (cron) ───────────────────────────────────────────────────────
async function candidati(supa, { coloana, azi, oraMin, oraMax }) {
  return http.allRows((from, to) => supa.from('user_stats')
    .select(`user_id, prep_exam, prep_notify_hour, ${coloana}`)
    .eq('prep_notify', true)
    .not('prep_exam', 'is', null)
    .gte('prep_notify_hour', oraMin).lte('prep_notify_hour', oraMax)
    .or(`${coloana}.is.null,${coloana}.lt.${azi}`)
    .order('user_id', { ascending: true })
    .range(from, to), { pageSize: 1000, maxPages: 20 });
}

async function contextLot(supa, ids, azi) {
  const [deAzi, istoric, profile] = await Promise.all([
    http.inBatches(ids, (chunk, from, to) => supa.from('daily_tests')
      .select('user_id, status, content_id, content_title, content_type, exam').eq('day', azi).in('user_id', chunk).range(from, to)).catch(() => []),
    http.inBatches(ids, (chunk, from, to) => supa.from('daily_tests')
      .select('user_id, day').eq('status', 'lucrat').gte('day', xp.addDays(azi, -60)).in('user_id', chunk).range(from, to)).catch(() => []),
    http.inBatches(ids, (chunk, from, to) => supa.from('profiles')
      .select('id, notifications_enabled').in('id', chunk).range(from, to)).catch(() => []),
  ]);
  const azim = new Map(deAzi.map((r) => [r.user_id, r]));
  const zileDe = new Map();
  for (const r of istoric) {
    if (!zileDe.has(r.user_id)) zileDe.set(r.user_id, []);
    zileDe.get(r.user_id).push(String(r.day).slice(0, 10));
  }
  const oprit = new Set(profile.filter((p) => p.notifications_enabled === false).map((p) => p.id));
  return { azim, zileDe, oprit };
}

async function cron(supa, { now = new Date(), budgetMs = 240000 } = {}) {
  const t0 = Date.now();
  const h = MN.oraRo(now);
  const azi = xp.dayKey(now);
  const out = { ok: true, ora: h, azi, amintiri: { candidati: 0, trimise: 0, push: 0, clopotel: 0, facute: 0, oprite: 0 }, serie: { candidati: 0, trimise: 0, push: 0, clopotel: 0 } };
  if (MN.eLiniste(h)) return { ...out, sarit: 'liniste (22:00–8:00)' };

  let rows;
  try {
    rows = await candidati(supa, { coloana: 'prep_notified_on', azi, oraMin: Math.max(ORE[0], h - FEREASTRA + 1), oraMax: h });
  } catch (e) {
    return { ...out, ok: false, setup: !isMissing(e), mesaj: isMissing(e) ? 'Rulează supabase/pregatire_zilnica.sql.' : e.message };
  }
  out.amintiri.candidati = rows.length;
  for (let i = 0; i < rows.length && Date.now() - t0 < budgetMs; i += LOT) {
    const lot = rows.slice(i, i + LOT);
    // eslint-disable-next-line no-await-in-loop
    const ctx = await contextLot(supa, lot.map((r) => r.user_id), azi);
    // eslint-disable-next-line no-await-in-loop
    await MN.inParalel(lot, PARALEL, async (r) => {
      if (Date.now() - t0 >= budgetMs) return;
      const m = ctx.azim.get(r.user_id) || null;
      if (!(await MN.revendica(supa, r.user_id, 'prep_notified_on', azi))) return;
      if (m && m.status === 'lucrat') { out.amintiri.facute++; return; }
      if (ctx.oprit.has(r.user_id)) { out.amintiri.oprite++; return; }
      const s = misiune.serie(ctx.zileDe.get(r.user_id) || [], azi);
      const payload = mesajAmintire({ titlu: m?.content_title, examen: r.prep_exam, serie: s.curenta, row: m, azi });
      const d = await MN.livreaza(supa, r.user_id, payload, azi, 'zi', 'pregatire');
      out.amintiri.trimise++;
      if (d.push) out.amintiri.push++; else if (d.clopotel) out.amintiri.clopotel++;
    });
  }

  if (h >= SERIE_ORA && h < SERIE_ORA + FEREASTRA && !MN.eLiniste(h) && Date.now() - t0 < budgetMs) {
    let srows = [];
    try { srows = await candidati(supa, { coloana: 'prep_streak_notified_on', azi, oraMin: ORE[0], oraMax: SERIE_ORA - 1 }); } catch { srows = []; }
    out.serie.candidati = srows.length;
    for (let i = 0; i < srows.length && Date.now() - t0 < budgetMs; i += LOT) {
      const lot = srows.slice(i, i + LOT);
      // eslint-disable-next-line no-await-in-loop
      const ctx = await contextLot(supa, lot.map((r) => r.user_id), azi);
      // eslint-disable-next-line no-await-in-loop
      await MN.inParalel(lot, PARALEL, async (r) => {
        if (Date.now() - t0 >= budgetMs) return;
        const m = ctx.azim.get(r.user_id) || null;
        const s = misiune.serie(ctx.zileDe.get(r.user_id) || [], azi);
        if (!(await MN.revendica(supa, r.user_id, 'prep_streak_notified_on', azi))) return;
        if ((m && m.status === 'lucrat') || s.aziFacut || s.curenta < SERIE_MIN || ctx.oprit.has(r.user_id)) return;
        const d = await MN.livreaza(supa, r.user_id, mesajSerie({ serie: s.curenta, titlu: m?.content_title, row: m, azi }), azi, 'serie', 'pregatire');
        out.serie.trimise++;
        if (d.push) out.serie.push++; else if (d.clopotel) out.serie.clopotel++;
      });
    }
  }
  out.ms = Date.now() - t0;
  return out;
}

module.exports = { ORE, ORA_IMPLICITA, mesajAmintire, mesajSerie, stare, seteaza, trimiteProba, cron };
