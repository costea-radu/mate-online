// =====================================================================
// api/_lib/misiuneNotificari.js — NOTIFICAREA MISIUNII ZILNICE (30 oct. 2026)
//
// Cererea: „pune notificare pentru misiunea zilnică".
//
// Elevul apasă în cardul „🎯 Misiunea zilnică" (Arena) „🔔 Amintește-mi" și își
// alege ora (implicit 17:00). În fiecare zi, la ora aleasă, DACĂ misiunea de azi
// nu e încă îndeplinită, primește:
//   · notificarea Web Push — vine și cu site-ul închis (Chrome, Edge, Firefox,
//     Android, aplicația ExamenMate; pe iPhone doar aplicația de pe ecranul
//     principal, iOS 16.4+); clicul deschide direct exercițiul zilei;
//   · dacă browserul nu poate primi notificări (iPhone în Safari, permisiune
//     refuzată, cheile VAPID lipsă), aceeași amintire ajunge în clopoțelul 🔔.
// Seara (MISIUNE_SERIE_ORA, implicit 20:00), cine are o serie de cel puțin 2
// zile la rând și n-a făcut încă misiunea primește „🔥 Seria ta de N zile se
// pierde la noapte" — o singură dată pe zi.
//
// Reguli: cel mult o amintire + o alertă de serie pe zi (revendicate ATOMIC în
// user_stats — două rulări simultane ale cronului nu trimit de două ori); nimic
// între 22:00 și 8:00 (ora României); nimic cui a oprit notificările din cont
// (profiles.notifications_enabled = false) sau cui a făcut deja misiunea.
//
// Cronul: GET /api/gamificare?action=cron-misiune, la fiecare oră (vercel.json);
// o oră ratată se recuperează în ora următoare (fereastra de 2 ore).
// SQL: supabase/misiune_notificari.sql (coloanele noi din user_stats). Fără el,
// cardul nu arată opțiunea (doar adminul vede de ce), iar restul merge ca înainte.
// =====================================================================
const ai = require('./ai');
const xp = require('./xp');
const http = require('./http');
const PUSH = require('./push');
const misiune = require('./misiune');

const ORE = [8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21];   // orele din care alege elevul
const ORA_IMPLICITA = 17;                                             // după școală
const SERIE_ORA = (() => { const n = parseInt(process.env.MISIUNE_SERIE_ORA || '20', 10); return n >= 12 && n <= 21 ? n : 20; })();
const SERIE_MIN = 2;          // alerta de serie: de la 2 zile la rând
const FEREASTRA = 2;          // o oră de cron ratată se recuperează în următoarea
const LINISTE_DE = 22;        // 22:00 – 8:00: fără notificări
const LINISTE_PANA = 8;
const LOT = 100;              // utilizatori citiți deodată
const PARALEL = 8;            // trimiteri în paralel

const isMissing = (err) => !!err && /column .* does not exist|does not exist|schema cache|could not find/i.test(String(err.message || err));

// ora curentă în România (0–23)
function oraRo(now = new Date()) {
  const s = new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Bucharest', hour: '2-digit', hourCycle: 'h23' }).format(now);
  const h = parseInt(s, 10);
  return Number.isFinite(h) ? h % 24 : 0;
}
const oraValida = (h) => ORE.includes(Number(h));
const eLiniste = (h) => h >= LINISTE_DE || h < LINISTE_PANA;
const fmtOra = (h) => `${String(h).padStart(2, '0')}:00`;

// E momentul amintirii? (ora aleasă ≤ acum < ora aleasă + fereastră, încă netrimisă azi)
function eMomentul({ ora, trimisLa }, h, azi) {
  const o = oraValida(ora) ? Number(ora) : ORA_IMPLICITA;
  if (eLiniste(h)) return false;
  if (trimisLa && String(trimisLa).slice(0, 10) >= azi) return false;
  return h >= o && h < o + FEREASTRA;
}

// ─── Mesajele ────────────────────────────────────────────────────────────────
const zile = (n) => `${n} ${n === 1 ? 'zi' : 'zile'}`;
const urlExercitiu = (id) => (id ? `/exercitiu?id=${encodeURIComponent(id)}&misiune=1` : '/arena');

// Amintirea zilnică. `serie` = zilele la rând de până ieri (încă „vie").
function mesajAmintire({ titlu = null, clasa = null, serie = 0, exercitiuId = null, azi = xp.dayKey() } = {}) {
  const t = String(titlu || '').trim().slice(0, 90);
  const cl = misiune.clasaInfo(clasa);
  return {
    title: serie >= 1 ? `🎯 Misiunea zilei · seria ta: ${zile(serie)} 🔥` : '🎯 Misiunea zilei te așteaptă',
    body: t
      ? `🧩 ${t} — un exercițiu, câteva minute. Rezolvă-l cu cel puțin ${misiune.PRAG_PCT}% ca să bifezi ziua.`
      : `Un exercițiu${cl ? ` de clasa ${cl.label}` : ''}, câteva minute. Rezolvă-l cu cel puțin ${misiune.PRAG_PCT}% ca să bifezi ziua.`,
    url: urlExercitiu(exercitiuId),
    tag: `misiune-${azi}`,
    kind: 'misiune',
    requireInteraction: false,
  };
}

// Alerta de seară: seria se pierde la miezul nopții.
function mesajSerie({ serie = 0, titlu = null, exercitiuId = null, azi = xp.dayKey() } = {}) {
  const t = String(titlu || '').trim().slice(0, 80);
  return {
    title: `🔥 Seria ta de ${zile(serie)} se pierde la noapte`,
    body: t ? `Un singur exercițiu o salvează: 🧩 ${t}.` : 'Un singur exercițiu o salvează — misiunea de azi te așteaptă.',
    url: urlExercitiu(exercitiuId),
    tag: `misiune-${azi}`,                 // înlocuiește amintirea de după-amiază, dacă e încă pe ecran
    kind: 'misiune',
    requireInteraction: false,
  };
}

// ─── Starea pentru card ──────────────────────────────────────────────────────
async function stare(supa, userId) {
  let push = { on: false, key: null, why: null };
  try { const p = await PUSH.pushInfo(supa); push = { on: !!p.on, key: p.key || null, why: p.why || null }; } catch { /* fără push */ }
  const base = { ore: ORE, oraImplicita: ORA_IMPLICITA, serieOra: SERIE_ORA, push };
  try {
    const { data, error } = await supa.from('user_stats')
      .select('mission_notify, mission_notify_hour').eq('user_id', userId).maybeSingle();
    if (error) return { ...base, setup: !isMissing(error), on: false, ales: false, ora: ORA_IMPLICITA, mesaj: error.message };
    return {
      ...base,
      setup: true,
      on: data?.mission_notify === true,
      ales: data ? data.mission_notify !== null && data.mission_notify !== undefined : false,  // a răspuns o dată (da / nu)
      ora: oraValida(data?.mission_notify_hour) ? Number(data.mission_notify_hour) : ORA_IMPLICITA,
    };
  } catch (e) {
    return { ...base, setup: false, on: false, ales: false, ora: ORA_IMPLICITA, mesaj: e.message };
  }
}

// Pornește / oprește / schimbă ora. `subscription` = PushSubscription.toJSON() (opțional).
async function seteaza(supa, userId, { on, ora, subscription = null, unsubscribe = null, userAgent = '' } = {}) {
  await xp.ensureStats(supa, userId);
  const patch = { updated_at: new Date().toISOString() };
  if (on !== undefined) patch.mission_notify = !!on;
  if (ora !== undefined && ora !== null) {
    if (!oraValida(ora)) { const e = new Error('Alege o oră între 8:00 și 21:00.'); e.status = 400; throw e; }
    patch.mission_notify_hour = Number(ora);
    // ora schimbată: amintirea de azi poate pleca la noua oră, dacă n-a plecat deja
  }
  const { error } = await supa.from('user_stats').update(patch).eq('user_id', userId);
  if (error) {
    if (isMissing(error)) { const e = new Error('Amintirile misiunii nu sunt încă activate (Admin: rulează supabase/misiune_notificari.sql).'); e.status = 503; throw e; }
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

// „Trimite o probă" — elevul vede pe loc dacă notificările ajung la el.
async function trimiteProba(supa, userId) {
  const info = await PUSH.pushInfo(supa).catch(() => ({ on: false }));
  if (!info.on) return { ok: true, push: false, sent: 0, motiv: info.why === 'sql' ? 'sql' : 'chei' };
  const r = await PUSH.sendToUser(supa, userId, {
    title: '🔔 Notificările merg!',
    body: 'Așa îți amintesc de misiunea zilei, la ora aleasă — doar în zilele în care n-ai făcut-o încă.',
    url: '/arena', tag: 'misiune-proba', kind: 'misiune', requireInteraction: false,
  }, { ttl: 600, urgency: 'normal' });
  return { ok: true, push: true, ...r };
}

// ─── Trimiterea (cron) ───────────────────────────────────────────────────────
// Rândurile din user_stats care au amintirea pornită, pe o coloană de „trimis azi"
async function candidati(supa, { coloana, azi, oraMin, oraMax }) {
  return http.allRows((from, to) => supa.from('user_stats')
    .select(`user_id, mission_category, mission_notify_hour, ${coloana}`)
    .eq('mission_notify', true)
    .not('mission_category', 'is', null)
    .gte('mission_notify_hour', oraMin).lte('mission_notify_hour', oraMax)
    .or(`${coloana}.is.null,${coloana}.lt.${azi}`)
    .order('user_id', { ascending: true })
    .range(from, to), { pageSize: 1000, maxPages: 20 });
}

// O singură rulare câștigă trimiterea de azi (update condiționat pe coloană)
async function revendica(supa, userId, coloana, azi) {
  const { data, error } = await supa.from('user_stats')
    .update({ [coloana]: azi })
    .eq('user_id', userId)
    .or(`${coloana}.is.null,${coloana}.lt.${azi}`)
    .select('user_id');
  return !error && Array.isArray(data) && data.length > 0;
}

// Pentru un lot de elevi: misiunea de azi, seria (din istoric) și dacă vor notificări din cont
async function contextLot(supa, ids, azi) {
  const [deAzi, istoric, profile] = await Promise.all([
    http.inBatches(ids, (chunk, from, to) => supa.from('daily_exercises')
      .select('user_id, status, content_id, content_title, category').eq('day', azi).in('user_id', chunk).range(from, to)).catch(() => []),
    http.inBatches(ids, (chunk, from, to) => supa.from('daily_exercises')
      .select('user_id, day').eq('status', 'indeplinit').gte('day', xp.addDays(azi, -60)).in('user_id', chunk).range(from, to)).catch(() => []),
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

// Trimite: Web Push; fără nicio notificare livrată → clopoțelul din site
async function livreaza(supa, userId, payload, azi, fel) {
  let r = { sent: 0, failed: 0, gone: 0 };
  try { r = await PUSH.sendToUser(supa, userId, payload, { ttl: 4 * 3600, urgency: 'normal' }); } catch { /* clopoțelul */ }
  if (r.sent > 0) return { push: true, clopotel: false };
  let ok = false;
  try {
    ok = await ai.createNotification(supa, {
      recipientId: userId, type: 'misiune', title: payload.title, body: payload.body,
      data: { url: payload.url }, dedupeKey: `misiune-${fel}:${azi}`, dedupeDays: 1,
    });
  } catch { ok = false; }
  return { push: false, clopotel: !!ok };
}

async function inParalel(list, n, fn) {
  let i = 0;
  const worker = async () => { while (i < list.length) { const x = list[i++]; await fn(x); } };
  await Promise.all(Array.from({ length: Math.max(1, Math.min(n, list.length)) }, worker));
}

async function cron(supa, { now = new Date(), budgetMs = 240000 } = {}) {
  const t0 = Date.now();
  const h = oraRo(now);
  const azi = xp.dayKey(now);
  const out = { ok: true, ora: h, azi, amintiri: { candidati: 0, trimise: 0, push: 0, clopotel: 0, facute: 0, oprite: 0 }, serie: { candidati: 0, trimise: 0, push: 0, clopotel: 0 } };
  if (eLiniste(h)) return { ...out, sarit: 'liniste (22:00–8:00)' };

  // 1) amintirea zilnică, la ora aleasă (sau recuperată în ora următoare)
  let rows;
  try {
    rows = await candidati(supa, { coloana: 'mission_notified_on', azi, oraMin: Math.max(ORE[0], h - FEREASTRA + 1), oraMax: h });
  } catch (e) {
    return { ...out, ok: false, setup: !isMissing(e), mesaj: isMissing(e) ? 'Rulează supabase/misiune_notificari.sql.' : e.message };
  }
  out.amintiri.candidati = rows.length;
  for (let i = 0; i < rows.length && Date.now() - t0 < budgetMs; i += LOT) {
    const lot = rows.slice(i, i + LOT);
    const ctx = await contextLot(supa, lot.map((r) => r.user_id), azi);
    await inParalel(lot, PARALEL, async (r) => {
      if (Date.now() - t0 >= budgetMs) return;
      const m = ctx.azim.get(r.user_id) || null;
      if (!(await revendica(supa, r.user_id, 'mission_notified_on', azi))) return;   // altă rulare a luat-o
      if (m && m.status === 'indeplinit') { out.amintiri.facute++; return; }
      if (ctx.oprit.has(r.user_id)) { out.amintiri.oprite++; return; }
      const s = misiune.serie(ctx.zileDe.get(r.user_id) || [], azi);
      const payload = mesajAmintire({ titlu: m?.content_title, clasa: r.mission_category, serie: s.curenta, exercitiuId: m?.content_id, azi });
      const d = await livreaza(supa, r.user_id, payload, azi, 'zi');
      out.amintiri.trimise++;
      if (d.push) out.amintiri.push++; else if (d.clopotel) out.amintiri.clopotel++;
    });
  }

  // 2) seara: seria în pericol (doar cui și-a ales o oră mai devreme decât alerta)
  if (h >= SERIE_ORA && h < SERIE_ORA + FEREASTRA && !eLiniste(h) && Date.now() - t0 < budgetMs) {
    let srows = [];
    try { srows = await candidati(supa, { coloana: 'mission_streak_notified_on', azi, oraMin: ORE[0], oraMax: SERIE_ORA - 1 }); } catch { srows = []; }
    out.serie.candidati = srows.length;
    for (let i = 0; i < srows.length && Date.now() - t0 < budgetMs; i += LOT) {
      const lot = srows.slice(i, i + LOT);
      const ctx = await contextLot(supa, lot.map((r) => r.user_id), azi);
      await inParalel(lot, PARALEL, async (r) => {
        if (Date.now() - t0 >= budgetMs) return;
        const m = ctx.azim.get(r.user_id) || null;
        const s = misiune.serie(ctx.zileDe.get(r.user_id) || [], azi);
        if (!(await revendica(supa, r.user_id, 'mission_streak_notified_on', azi))) return;
        if ((m && m.status === 'indeplinit') || s.aziFacut || s.curenta < SERIE_MIN || ctx.oprit.has(r.user_id)) return;
        const d = await livreaza(supa, r.user_id, mesajSerie({ serie: s.curenta, titlu: m?.content_title, exercitiuId: m?.content_id, azi }), azi, 'serie');
        out.serie.trimise++;
        if (d.push) out.serie.push++; else if (d.clopotel) out.serie.clopotel++;
      });
    }
  }
  out.ms = Date.now() - t0;
  return out;
}

module.exports = {
  ORE, ORA_IMPLICITA, SERIE_ORA, SERIE_MIN, FEREASTRA, LINISTE_DE, LINISTE_PANA,
  oraRo, oraValida, eLiniste, eMomentul, fmtOra, mesajAmintire, mesajSerie,
  stare, seteaza, trimiteProba, cron,
};
