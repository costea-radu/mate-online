// =====================================================================
// api/live.js — MEDITAȚII LIVE cu profesorul virtual (sala de tip Zoom)
//
// POST { action, ... } (autentificat; `program` merge și fără cont)
//   program        — profesorii, ședințele de azi și de mâine, prețurile, drepturile mele
//   join           — intrarea în sală (verifică abonamentul / biletul), cronologia lecției
//   prepare        — pregătește lecția (script + voce), pe bucăți; răspunde cu progresul
//   timeline       — cronologia actualizată (1-la-1 cu vocea încă în lucru)
//   heartbeat      — „sunt încă în sală" (prezența, timpul petrecut)
//   chat           — mesaj în chat; profesorul răspunde la întrebări (text + voce)
//   messages       — mesajele noi (plasă de siguranță pe lângă timpul real)
//   poll_answer    — răspunsul la întrebarea profesorului (grilă / completare)
//   poll_results   — rezultatele agregate ale unei întrebări
//   private_subjects — subiectele cu barem, pentru o ședință 1-la-1
//   private_start  — pornește o ședință 1-la-1 (8/lună incluse în abonament, apoi 20 lei)
//   private_begin  — pornește ceasul celor 60 de minute (după ce lecția e gata)
//   private_state  — unde a rămas elevul (reluare după o deconectare)
//   extend         — prelungirea: elevul care nu a terminat exercițiile nu e oprit
//                    la 60 de minute (1-la-1) / la sfârșitul orei (grup ținut 1-la-1)
//   leave          — ieșirea din sală (1-la-1: „Încheie ședința")
//   admin_*        — programul pe zile, subiectul unei ședințe, pregătirea lecțiilor,
//                    meditațiile gratuite (admin_set_free)
//
// MEDITAȚIILE GRATUITE: câteva lecții pregătite (implicit 2, una de EN și una de
// BAC; adminul le schimbă) se fac 1-la-1 fără plată și fără abonament, de oricine
// are cont (cel mult LIVE_GRATUIT_LUNA pe lună); ședința de grup cu un astfel de
// subiect e și ea gratuită. Vezi „MEDITAȚIILE GRATUITE" mai jos și L.freeAccess.
// GET ?action=cron — ședințele de azi/mâine, subiectele, lecțiile pentru următoarele
//   ore, asocierea subiect ↔ barem pentru materialele noi (Bearer CRON_SECRET)
//
// Profesorul explică DOAR subiecte cu barem asociat sigur. Plățile (10 lei grup,
// 20 lei 1-la-1) trec prin api/create-checkout.js → api/stripe-webhook.js.
// Tabelele: supabase/meditatii_live.sql. Ghid: GHID_MEDITATII_LIVE.md.
// =====================================================================
const ai = require('./_lib/ai');
const B = require('./_lib/barem');
const L = require('./_lib/live');
const LL = require('./_lib/liveLesson');
const tts = require('./_lib/tts');
const mathcheck = require('./_lib/mathcheck');

// încărcat leneș: ai-pdf-context aduce pdf-parse (greu) — doar când chiar trebuie
let _pdf = null;
const pdfContext = () => (_pdf || (_pdf = require('./ai-pdf-context')));

const SETUP_HINT = 'Meditațiile live nu sunt încă activate. (Admin: rulează supabase/meditatii_live.sql în Supabase → SQL Editor.)';
const isMissingTable = (err) => !!err && /relation .* does not exist|does not exist|schema cache/i.test(String(err.message || err));
function fail(status, message, code = null) { const e = new Error(message); e.status = status; if (code) e.code = code; return e; }
function dbCheck(error, what = '') {
  if (!error) return;
  if (isMissingTable(error)) throw fail(503, SETUP_HINT, 'LIVE_SETUP');
  throw fail(500, `${what ? what + ': ' : ''}${error.message}`);
}

// ─── cine face cererea ────────────────────────────────────────────────────────
async function who(req, supa, { required = true } = {}) {
  let userId = null;
  try { userId = await ai.authUser(req, supa); }
  catch (e) { if (required) throw e; return { userId: null, profile: null }; }
  const { data: profile, error } = await supa.from('profiles')
    .select('id, full_name, email, subscription_status, role, is_admin').eq('id', userId).maybeSingle();
  if (error || !profile) { if (required) throw fail(401, 'Utilizator negăsit. Reautentifică-te.'); return { userId, profile: null }; }
  return { userId, profile };
}
const premiumOf = (p) => ai.isPremium(p);

// ─── difuzarea în timp real (Supabase Realtime, canal privat „live:<id>") ─────
// Doar serverul trimite mesaje pe canal (vezi politicile din SQL): chatul și
// vocea profesorului nu pot fi falsificate din browser.
async function broadcast(sessionId, event, payload) {
  const base = String(process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || '').replace(/\/+$/, '');
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!base || !key) return false;
  try {
    const r = await fetch(`${base}/realtime/v1/api/broadcast`, {
      method: 'POST',
      headers: { apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ messages: [{ topic: `live:${sessionId}`, event, payload, private: true }] }),
      signal: AbortSignal.timeout(4000),
    });
    return r.ok;
  } catch { return false; }
}

// ─── cache-ul lecțiilor în memoria instanței (scriptul + vocea: sute de KB) ───
const LESSON_TTL = 60 * 1000;
const lessonCache = new Map();
async function loadLesson(supa, lessonId, { fresh = false } = {}) {
  if (!lessonId) return null;
  const c = lessonCache.get(lessonId);
  if (!fresh && c && Date.now() - c.at < LESSON_TTL) return c.row;
  const { data, error } = await supa.from('live_lessons').select('*').eq('id', lessonId).maybeSingle();
  dbCheck(error, 'lecția');
  // numele profesorului din lecțiile scrise înainte de o redenumire (ex. „Prof. Radu" → „Prof. Tudor")
  if (data?.script) data.script = LL.dropUnreadable(LL.renameTeacher(data.script, L.teacherById(data.teacher)));
  if (data) lessonCache.set(lessonId, { at: Date.now(), row: data });
  if (lessonCache.size > 40) lessonCache.delete(lessonCache.keys().next().value);
  return data || null;
}

// ═════════════════════════════════════════════════════════════════════════════
// SUBIECTELE CU BAREM
// ═════════════════════════════════════════════════════════════════════════════
const eligibleCache = new Map(); // `${exam}|${profile}` → { at, list }
// profilurile de BAC care nu fac parte din meditațiile live
const LIVE_OFF_PROFILES = new Set(['pedagogic']);

async function eligibleSubjects(supa, { exam, profile = null, fresh = false }) {
  const key = `${exam}|${profile || ''}`;
  const c = eligibleCache.get(key);
  if (!fresh && c && Date.now() - c.at < 10 * 60 * 1000) return c.list;
  const category = exam === 'en' ? 'evaluare-nationala' : 'bacalaureat';
  const { data: rows, error } = await supa.from('content')
    .select('id, title, category, subcategory, profile, file_url, is_free, created_at')
    .eq('category', category).eq('content_type', 'pdf').limit(3000);
  dbCheck(error, 'materialele');
  const subjects = (rows || []).filter((r) => r.file_url && !B.isBaremRow(r))
    .map((r) => ({ ...r, ...L.subjectExam(r, B) }))
    .filter((r) => r.exam !== 'bac' || !LIVE_OFF_PROFILES.has(r.profile))
    .filter((r) => !profile || r.exam !== 'bac' || r.profile === profile);
  const ok = new Map();
  for (let i = 0; i < subjects.length; i += 150) {
    const ids = subjects.slice(i, i + 150).map((s) => s.id);
    const { data: pdf } = await supa.from('ai_pdf_text').select('content_id, barem_status, barem_title:barem->>title').in('content_id', ids);
    for (const p of pdf || []) if (L.BAREM_OK.has(p.barem_status)) ok.set(p.content_id, p);
  }
  const list = subjects.filter((s) => ok.has(s.id))
    .map((s) => ({ id: s.id, title: s.title, exam: s.exam, profile: s.profile || null, baremTitle: ok.get(s.id)?.barem_title || null, created_at: s.created_at }))
    .sort((a, b) => String(b.title).localeCompare(String(a.title), 'ro', { numeric: true }));
  eligibleCache.set(key, { at: Date.now(), list });
  return list;
}

// lecțiile gata, pe profesor → Set(subject_id)
async function readyLessons(supa, teacherId) {
  const { data } = await supa.from('live_lessons').select('subject_id').eq('teacher', teacherId).eq('status', 'gata').limit(2000);
  return new Set((data || []).map((r) => r.subject_id));
}

// ═════════════════════════════════════════════════════════════════════════════
// PROGRAMUL (ședințele de grup ale unei zile)
// ═════════════════════════════════════════════════════════════════════════════
async function ensureDay(supa, day) {
  const planned = L.plannedSessions(day).map((p) => ({ ...p, status: 'programata' }));
  const { error: upErr } = await supa.from('live_sessions').upsert(planned, { onConflict: 'day,slot,teacher', ignoreDuplicates: true });
  dbCheck(upErr, 'programul');
  const { data, error } = await supa.from('live_sessions').select('*').eq('kind', 'grup').eq('day', day).order('starts_at');
  dbCheck(error, 'programul');
  const active = new Set(L.teachers().map((t) => t.id));
  const slotIds = new Set(L.slots().map((s) => s.id));
  return (data || []).filter((s) => active.has(s.teacher) && slotIds.has(s.slot));
}

// Subiectul ședințelor care nu au încă unul (determinist, vezi L.pickSubject)
async function assignSubjects(supa, sessions, now = new Date()) {
  const need = sessions.filter((s) => !s.subject_id && s.status !== 'anulata' && L.phaseOf(s, now) !== 'incheiata');
  if (!need.length) return sessions;
  const usedToday = new Set(sessions.map((s) => s.subject_id).filter(Boolean));
  const usage = new Map(); // teacher → Map(subject → lastUsed)
  const ready = new Map();
  for (const s of need) {
    if (!usage.has(s.teacher)) {
      const { data } = await supa.from('live_sessions').select('subject_id, starts_at')
        .eq('teacher', s.teacher).eq('kind', 'grup').not('subject_id', 'is', null)
        .lt('starts_at', now.toISOString()).order('starts_at', { ascending: false }).limit(600);
      const m = new Map();
      for (const r of data || []) if (!m.has(r.subject_id)) m.set(r.subject_id, r.starts_at);
      usage.set(s.teacher, m);
      ready.set(s.teacher, await readyLessons(supa, s.teacher));
    }
    // examenul SĂLII, strict: în sala „BAC Tehnologic" intră doar subiecte de tehnologic
    // cu barem. Fără niciunul, sala așteaptă (cronul citește baremele, întâi pentru ea).
    const pool = await eligibleSubjects(supa, { exam: s.exam, profile: s.profile });
    if (!pool.length) continue;
    const u = usage.get(s.teacher), rd = ready.get(s.teacher);
    const cands = pool.map((p) => ({ id: p.id, ready: rd.has(p.id), lastUsed: u.get(p.id) || null, profile: p.profile, full: L.isFullSubject(p.title) }));
    const pick = L.pickSubject(cands, { seed: `${s.day}|${s.slot}|${s.teacher}`, now, exclude: [...usedToday], preferFull: true });
    if (!pick) continue;
    usedToday.add(pick.id);
    const patch = { subject_id: pick.id, profile: s.exam === 'bac' ? (s.profile || pick.profile || null) : null };
    const { data: upd } = await supa.from('live_sessions').update(patch).eq('id', s.id).is('subject_id', null).select('*').maybeSingle();
    if (upd) Object.assign(s, upd);
  }
  return sessions;
}

// câți elevi sunt ACUM în sală (au dat semn de viață în ultimele 2 minute)
async function presentCounts(supa, sessionIds) {
  if (!sessionIds.length) return {};
  const since = new Date(Date.now() - 120 * 1000).toISOString();
  const { data } = await supa.from('live_participants').select('session_id').in('session_id', sessionIds).gte('last_seen', since).limit(5000);
  const out = {};
  for (const r of data || []) out[r.session_id] = (out[r.session_id] || 0) + 1;
  return out;
}

async function subjectTitles(supa, ids) {
  const list = [...new Set(ids.filter(Boolean))];
  if (!list.length) return {};
  const { data } = await supa.from('content').select('id, title').in('id', list);
  return Object.fromEntries((data || []).map((r) => [r.id, r.title]));
}

async function lessonStatusFor(supa, pairs, { detail = false } = {}) {
  // pairs: [{ subject_id, teacher }] → { `${subject}|${teacher}`: status }
  // detail: „gata_fara_voce" = gata, dar vorbește vocea browserului (fără chei TTS)
  const subjects = [...new Set(pairs.map((p) => p.subject_id).filter(Boolean))];
  if (!subjects.length) return {};
  const { data } = await supa.from('live_lessons').select('subject_id, teacher, status, version, noVoice:progress->noVoice').in('subject_id', subjects).order('version', { ascending: false });
  const out = {};
  for (const r of data || []) {
    const k = `${r.subject_id}|${r.teacher}`;
    if (!out[k]) out[k] = detail && r.status === 'gata' && r.noVoice === true ? 'gata_fara_voce' : r.status;
  }
  return out;
}

// ─── biletele și ședințele 1-la-1 folosite luna aceasta ───────────────────────
async function myTickets(supa, userId) {
  const { data } = await supa.from('live_tickets').select('id, kind, session_id, status, created_at').eq('user_id', userId).in('status', ['platit']).limit(200);
  return data || [];
}
// Se numără doar ședințele 1-la-1 PORNITE (ceasul de 60 de minute a început):
// dacă lecția nu s-a putut pregăti, elevul nu pierde nimic din abonament.
async function includedUsedThisMonth(supa, userId) {
  const { count } = await supa.from('live_sessions').select('*', { count: 'exact', head: true })
    .eq('owner_id', userId).eq('kind', 'privat').eq('access', 'inclus').gte('created_at', L.monthStart())
    .not('state->>startedAt', 'is', null);
  return count || 0;
}
async function privateAccessFor(supa, profile) {
  if (!profile) return { ok: false, via: null, price: L.PRICE_PRIVATE_LEI(), included: 0, includedLeft: 0, unusedTickets: 0 };
  const [used, tickets] = await Promise.all([includedUsedThisMonth(supa, profile.id), myTickets(supa, profile.id)]);
  const unused = tickets.filter((t) => t.kind === 'privat' && !t.session_id).length;
  return { ...L.privateAccess({ profile, includedUsed: used, unusedTickets: unused }), unusedTickets: unused, includedUsed: used };
}

// ═════════════════════════════════════════════════════════════════════════════
// MEDITAȚIILE GRATUITE — lecțiile alese din Admin (app_settings, cheia
// 'live_free_lessons'). Până alege adminul: două lecții gata, alese automat
// (una de EN, una de BAC — L.pickFreeLessons), salvate o singură dată ca să
// rămână aceleași. Fără tabela de setări (SQL-ul nerulat): tot alegerea
// automată, calculată la cerere. Reguli: L.freeAccess / L.groupAccess.
// ═════════════════════════════════════════════════════════════════════════════
const SET = require('./_lib/settings');
const FREE_KEY = 'live_free_lessons';
const FREE_TTL = 60 * 1000;
const FREE_LIGHT = 'subject_id, teacher, version, status, title, exam, profile, updated_at, noVoice:progress->noVoice, sv:script->v, pasi:script->pasi';
let freeCache = null;

async function freeLessons(supa, { fresh = false } = {}) {
  if (!fresh && freeCache && Date.now() - freeCache.at < FREE_TTL) return freeCache;
  let st = { setup: false, value: null };
  try { st = await SET.readSetting(supa, FREE_KEY); }
  catch (e) { console.warn('live: setarea meditațiilor gratuite:', e.message); }
  let ids = st.value && Array.isArray(st.value.subjects) ? L.normalizeFreeIds(st.value.subjects) : null;
  let auto = !!(st.value && st.value.auto);
  if (!ids) {
    auto = true;
    const { data } = await supa.from('live_lessons').select(FREE_LIGHT).eq('status', 'gata').limit(2000);
    ids = L.pickFreeLessons(data || []).map((l) => String(l.subject_id).toLowerCase());
    if (st.setup && ids.length >= L.FREE_DEFAULT_COUNT) {
      await SET.insertSettingIfMissing(supa, FREE_KEY, { subjects: ids, auto: true, at: new Date().toISOString() });
    }
  }
  freeCache = { at: Date.now(), ids, set: new Set(ids), auto, setup: st.setup };
  return freeCache;
}
async function isFreeSubject(supa, subjectId) {
  if (!subjectId) return false;
  return (await freeLessons(supa)).set.has(String(subjectId).toLowerCase());
}
// Ședințele 1-la-1 GRATUITE pornite de elev luna aceasta (cele nepornite nu se numără)
async function freeUsedThisMonth(supa, userId) {
  const { count } = await supa.from('live_sessions').select('*', { count: 'exact', head: true })
    .eq('owner_id', userId).eq('kind', 'privat').eq('access', 'gratuit').gte('created_at', L.monthStart())
    .not('state->>startedAt', 'is', null);
  return count || 0;
}

// Lecțiile gratuite, pentru lobby: titlul, examenul, dacă lecția e gata
async function freeLessonsView(supa, teacherId) {
  const f = await freeLessons(supa);
  if (!f.ids.length) return [];
  const { data: rows } = await supa.from('content').select('id, title, category, subcategory, profile, file_url').in('id', f.ids);
  const byId = new Map((rows || []).map((r) => [String(r.id).toLowerCase(), r]));
  const status = await lessonStatusFor(supa, f.ids.map((id) => ({ subject_id: id, teacher: teacherId })));
  return f.ids.map((id) => {
    const c = byId.get(id);
    const se = c && L.subjectExam(c, B);
    if (!se) return null;                       // subiect șters între timp
    const lesson = status[`${c.id}|${teacherId}`] || 'nou';
    return { subjectId: c.id, title: c.title, exam: se.exam, profile: se.profile || null, examLabel: L.EXAM_LABEL(se.exam, se.profile), lesson, ready: lesson === 'gata' };
  }).filter(Boolean);
}

// ═════════════════════════════════════════════════════════════════════════════
// ACȚIUNEA `program` — lobby-ul
// ═════════════════════════════════════════════════════════════════════════════
const roomOf = (slot) => (slot ? { id: slot.room, n: slot.roomN, label: slot.roomLabel, short: slot.roomShort } : null);

async function program(req, res, supa) {
  const { userId, profile } = await who(req, supa, { required: false });
  const now = new Date();
  const today = L.dayKey(now);
  const days = [today, L.addDays(today, 1)];
  const all = [];
  for (const d of days) all.push(...await assignSubjects(supa, await ensureDay(supa, d), now));
  const ids = all.map((s) => s.id);
  const [present, titles, lessons] = await Promise.all([
    presentCounts(supa, ids), subjectTitles(supa, all.map((s) => s.subject_id)),
    lessonStatusFor(supa, all),
  ]);
  const tickets = userId ? await myTickets(supa, userId) : [];
  const grupTickets = new Set(tickets.filter((t) => t.kind === 'grup' && t.session_id).map((t) => t.session_id));
  const slotInfo = Object.fromEntries(L.slots().map((s) => [s.id, s]));
  const free = await freeLessons(supa);
  const freeOf = (s) => !!s.subject_id && free.set.has(String(s.subject_id).toLowerCase());
  const view = (s) => ({
    id: s.id, teacher: s.teacher, slot: s.slot, label: slotInfo[s.slot]?.label || s.slot, room: roomOf(slotInfo[s.slot]),
    exam: s.exam, profile: s.profile, examLabel: L.EXAM_LABEL(s.exam, s.profile),
    subject: s.subject_id ? { id: s.subject_id, title: titles[s.subject_id] || 'Subiect de examen' } : null,
    starts_at: s.starts_at, ends_at: s.ends_at, phase: L.phaseOf(s, now), present: present[s.id] || 0,
    lesson: s.subject_id ? (lessons[`${s.subject_id}|${s.teacher}`] || 'nou') : null,
    free: freeOf(s),
    access: L.groupAccess({ profile: userId ? profile : null, ticket: grupTickets.has(s.id) ? { status: 'platit' } : null, free: freeOf(s) }),
  });
  let mine = [];
  if (userId) {
    const { data } = await supa.from('live_sessions').select('id, teacher, subject_id, starts_at, ends_at, status, state, created_at')
      .eq('owner_id', userId).eq('kind', 'privat').order('created_at', { ascending: false }).limit(6);
    const t2 = await subjectTitles(supa, (data || []).map((s) => s.subject_id));
    mine = (data || []).map((s) => ({
      id: s.id, teacher: s.teacher, subject: { id: s.subject_id, title: t2[s.subject_id] || 'Subiect' },
      created_at: s.created_at, started: !!s.state?.startedAt, phase: L.phaseOf(s, now), status: s.status,
    }));
  }
  const freeUsed = userId ? await freeUsedThisMonth(supa, userId) : 0;
  return res.status(200).json({
    now: now.toISOString(), tz: L.TZ,
    teachers: L.teachers().map(L.publicTeacher),
    slots: L.slots().map((s) => ({ id: s.id, label: s.label, room: s.room })),
    intervals: L.intervals().map((i) => ({ id: i.id, label: i.label })),
    rooms: L.rooms(),
    prices: { grup: L.PRICE_GROUP_LEI(), privat: L.PRICE_PRIVATE_LEI(), privatMin: L.PRIVATE_MINUTES(), privatIncluse: L.PRIVATE_INCLUDED(), gratuiteLuna: L.FREE_MONTHLY() },
    joinEarlyMin: L.JOIN_EARLY_MIN(),
    // meditațiile gratuite (1-la-1 fără plată, pentru oricine are cont)
    freeLessons: await freeLessonsView(supa, L.teachers()[0].id),
    days: days.map((d, i) => ({ day: d, label: i === 0 ? 'Azi' : 'Mâine', sessions: all.filter((s) => s.day === d).map(view) })),
    me: userId ? {
      loggedIn: true, premium: premiumOf(profile), admin: !!profile?.is_admin,
      name: L.displayName(profile?.full_name, userId),
      private: await privateAccessFor(supa, profile),
      free: { monthly: L.FREE_MONTHLY(), used: freeUsed, left: Math.max(0, L.FREE_MONTHLY() - freeUsed) },
      privateSessions: mine,
    } : { loggedIn: false },
  });
}

// ═════════════════════════════════════════════════════════════════════════════
// LECȚIA: găsire / creare / pregătire (cu lacăt)
// ═════════════════════════════════════════════════════════════════════════════
const LIGHT = 'id, subject_id, teacher, version, status, title, exam, profile, duration_sec, error, locked_until, updated_at, total:progress->total, done:progress->done, noVoice:progress->noVoice, phase:progress->>phase, pasi:script->pasi';

async function lessonFor(supa, subjectId, teacherId, { create = true } = {}) {
  const { data, error } = await supa.from('live_lessons').select(LIGHT)
    .eq('subject_id', subjectId).eq('teacher', teacherId).order('version', { ascending: false }).limit(1);
  dbCheck(error, 'lecția');
  if (data && data[0]) return data[0];
  if (!create) return null;
  const { data: ins, error: e2 } = await supa.from('live_lessons')
    .insert({ subject_id: subjectId, teacher: teacherId, version: 1, status: 'nou' }).select(LIGHT).maybeSingle();
  if (e2) {
    // două cereri simultane → a doua o citește pe cea creată de prima
    const { data: again } = await supa.from('live_lessons').select(LIGHT).eq('subject_id', subjectId).eq('teacher', teacherId).order('version', { ascending: false }).limit(1);
    if (again && again[0]) return again[0];
    dbCheck(e2, 'lecția');
  }
  return ins;
}

const lessonView = (l) => l && ({ id: l.id, status: l.status, title: l.title, error: l.status === 'eroare' ? l.error : null, total: Number(l.total) || 0, done: Number(l.done) || 0, phase: l.phase || null });

// ─── ÎNTREBĂRILE PE PAȘI pentru lecțiile scrise înainte de ele ───────────────
// O lecție „gata" fără script.pasi primește întrebările pe pași (Subiectele II și
// III) o singură dată — doar întrebările; explicațiile și vocea rămân. NICIODATĂ cât
// o ședință de grup cu aceeași lecție e în curs sau pornește în câteva minute: toți
// elevii ei trebuie să aibă aceeași cronologie.
const lessonLacksSteps = (l) => !!l && l.status === 'gata' && L.STEPS_ON() && Number(l.pasi || 0) < LL.PASI_V;
async function groupBusy(supa, subjectId, teacher, now = new Date()) {
  if (!subjectId) return false;
  const { data } = await supa.from('live_sessions').select('id')
    .eq('kind', 'grup').eq('subject_id', subjectId).eq('teacher', teacher).in('status', ['programata', 'activa'])
    .lte('starts_at', new Date(now.getTime() + 5 * 60000).toISOString()).gt('ends_at', now.toISOString()).limit(1);
  return !!(data && data.length);
}
// Se completează acum, la intrarea în sală? 1-la-1 nepornit, sau sala de așteptare a
// unei ședințe de grup care începe peste mai mult de 3 minute (cât durează completarea)
async function stepsUpgradeFor(supa, session, light, now = new Date()) {
  if (!session || !lessonLacksSteps(light) || session.state?.startedAt || session.state?.mode) return false;
  if (session.kind === 'grup' && new Date(session.starts_at).getTime() - now.getTime() < 3 * 60000) return false;
  return !(await groupBusy(supa, session.subject_id, session.teacher, now));
}

// Pregătește lecția cât permite bugetul: scriptul (o dată), apoi vocea.
// revoice: o lecție gata „cu vocea browserului" (făcută înainte de cheile TTS)
// primește acum vocea generată. Dacă vocea eșuează, lecția rămâne jucabilă cu
// vocea browserului — o ședință nu se blochează niciodată din cauza vocii.
// fromRef: 1-la-1 în curs — vocea se generează întâi de la itemul la care e elevul.
// scriptOnly: doar textul lecției (Pregătirea de examen vorbește cu vocea browserului);
//   fără voce configurată, lecția devine imediat „gata" (vocea browserului), ca la live.
// steps: o lecție scrisă înainte de întrebările pe pași le primește acum (forceSteps:
//   le scrie din nou, de la zero — din Admin).
async function prepareLesson(supa, lessonId, { budgetMs = 55000, log = console.warn, revoice = false, fromRef = null, scriptOnly = false, steps = false, forceSteps = false } = {}) {
  const t0 = Date.now();
  const nowIso = new Date().toISOString();
  const until = new Date(Date.now() + budgetMs + 90 * 1000).toISOString();
  const { data: locked, error: lockErr } = await supa.from('live_lessons')
    .update({ locked_until: until }).eq('id', lessonId)
    .or(`locked_until.is.null,locked_until.lt.${nowIso}`).select('*');
  dbCheck(lockErr, 'lecția');
  if (!locked || !locked.length) {
    const { data: cur } = await supa.from('live_lessons').select(LIGHT).eq('id', lessonId).maybeSingle();
    return { ...lessonView(cur), busy: true };
  }
  let row = locked[0];
  const teacher = L.teacherById(row.teacher) || L.teachers()[0];
  const save = async (patch) => {
    const { data, error } = await supa.from('live_lessons').update(patch).eq('id', row.id).select('*').maybeSingle();
    if (error) log(`live: salvarea lecției ${row.id}: ${error.message}`);
    if (data) row = data;
  };
  // vocea browserului (fără fișiere) — lecția e jucabilă imediat
  const browserVoice = async (why) => {
    await save({ status: 'gata', error: why || null, progress: { ...row.progress, noVoice: true, phase: 'gata', total: LL.segmentsInOrder(row.script).length } });
  };
  try {
    if (revoice && row.status === 'gata' && row.progress?.noVoice && row.script && tts.provider()) {
      await save({ status: 'script', error: null, progress: { ...row.progress, noVoice: false, phase: 'voce', audio: row.progress?.audio || {} } });
    }
    // ── 1. scriptul ──
    if (row.status === 'nou' || (row.status === 'eroare' && !row.script)) {
      await save({ status: 'nou', error: null, progress: { ...(row.progress || {}), phase: 'script', startedAt: new Date().toISOString() } });
      const { data: other } = await supa.from('live_lessons').select('script')
        .eq('subject_id', row.subject_id).neq('teacher', row.teacher).not('script', 'is', null)
        .order('updated_at', { ascending: false }).limit(1);
      let script = null, costMicro = 0;
      if (other && other[0]?.script) {
        script = LL.adaptScript(other[0].script, teacher);
      } else {
        const { data: content } = await supa.from('content').select('*').eq('id', row.subject_id).maybeSingle();
        if (!content) throw fail(404, 'Subiectul nu mai există.');
        const ctx = await pdfContext().getPdfContext(supa, content);
        const se = L.subjectExam(content, B) || { exam: 'en', profile: null };
        // paginile PDF (subiect + barem): modelul vede formulele pierdute la extragerea textului
        const attachments = await LL.pdfAttachments({ supa, content, ctx, pdfCtx: pdfContext(), log });
        const r = await LL.generateScript({ ctx, content, teacher, exam: se.exam, profile: se.profile, log, attachments });
        script = r.script;
        costMicro = ai.costMicroLei(r.usage.model, r.usage);
        await ai.logUsage(supa, null, 'live-lectie', r.usage);
      }
      const total = LL.segmentsInOrder(script).length;
      await save({
        status: 'script', script, title: script.title, exam: script.exam, profile: script.profile,
        progress: { audio: {}, total, done: 0, phase: 'voce' }, error: null,
        cost_micro: (row.cost_micro || 0) + costMicro,
      });
    }
    // ── 1b. întrebările pe pași (lecțiile scrise înainte de ele) ──
    if ((steps || forceSteps) && row.script && (forceSteps || LL.needsSteps(row.script)) && ['gata', 'script', 'audio'].includes(row.status)) {
      const was = row.status;
      const audio = row.progress?.audio || {};
      const voiced = !row.progress?.noVoice && Object.keys(audio).length > 0;
      // cât se scriu întrebările, o ședință de grup nu pornește pe lecția veche (așteaptă „gata")
      if (was === 'gata') await save({ status: 'script', progress: { ...row.progress, phase: 'pasi' } });
      try {
        const r = await LL.addStepQuestions({ script: row.script, teacher, log, force: !!forceSteps });
        const costMicro = r.usage.in || r.usage.out ? ai.costMicroLei(r.usage.model, r.usage) : 0;
        if (costMicro) await ai.logUsage(supa, null, 'live-pasi', r.usage);
        // vocea generată: frazele noi (întrebările) se înregistrează mai jos, în același apel
        const next = voiced && tts.provider() ? 'audio' : (was === 'gata' ? 'gata' : was);
        const all = LL.segmentsInOrder(r.script);
        await save({
          script: r.script, status: next, error: null,
          progress: { ...row.progress, total: all.length, done: all.filter((x) => audio[x.id]).length, phase: next === 'gata' ? 'gata' : 'voce', pasi: { at: new Date().toISOString(), ...r.report } },
          cost_micro: (row.cost_micro || 0) + costMicro,
          ...(next === 'gata' ? { duration_sec: L.buildTimeline(r.script, row.progress?.noVoice ? {} : audio, { mode: 'grup' }).duration } : {}),
        });
        log(`live: lecția ${row.id} — întrebări pe pași: ${r.report.ai} scrise de model, ${r.report.fromBarem} din barem${r.report.missing.length ? `, fără întrebare: ${r.report.missing.join(', ')}` : ''}`);
      } catch (e) {
        // lecția rămâne cum era (fără să mai reîncerce la fiecare intrare); Admin poate cere din nou
        log(`live: întrebările pe pași pentru lecția ${row.id} au eșuat: ${e.message}`);
        await save({ status: was, script: { ...row.script, pasi: LL.PASI_V, pasiErr: String(e.message || e).slice(0, 200) }, progress: { ...row.progress, phase: was === 'gata' ? 'gata' : row.progress?.phase } });
      }
    }
    // ── 2. vocea ──
    // (doar textul: cu voce configurată, lecția rămâne „script" — vocea se face când o
    //  cere o ședință live; fără voce configurată → gata, cu vocea browserului)
    if (scriptOnly && row.script && ['script', 'eroare'].includes(row.status) && !tts.provider()) await browserVoice(null);
    if (!scriptOnly && (row.status === 'script' || row.status === 'audio' || (row.status === 'eroare' && row.script))) {
      const audio = { ...(row.progress?.audio || {}) };
      const doneBefore = Object.keys(audio).length;
      const left = Math.max(5000, budgetMs - (Date.now() - t0) - 4000);
      let r;
      try {
        r = await LL.voiceScript(supa, {
          lessonId: row.id, script: row.script, teacher, audio, budgetMs: left, log, fromRef,
          onProgress: async (a) => { await save({ status: 'audio', progress: { ...row.progress, audio: a, done: Object.keys(a).length } }); },
        });
      } catch (e) {
        if (e.code !== 'NO_TTS') { await browserVoice(`vocea: ${String(e.message || e).slice(0, 300)}`); return { ...lessonView(row), noVoice: true }; }
        // fără nicio voce configurată: lecția merge cu vocea browserului (durate estimate)
        await browserVoice(null);
        return { ...lessonView(row), noVoice: true };
      }
      // vocea nu merge deloc (cheie greșită, cotă depășită): nimic nou, doar erori →
      // lecția pleacă acum cu vocea browserului; ce s-a generat rămâne pentru mai târziu
      if (r.failed >= 3 && r.done === doneBefore) {
        await browserVoice(`vocea generată a eșuat de ${r.failed} ori — merge cu vocea browserului`);
        return { ...lessonView(row), noVoice: true };
      }
      const allDone = r.done >= r.total;
      const dur = allDone ? L.buildTimeline(row.script, audio, { mode: 'grup' }).duration : null;
      await save({
        status: allDone ? 'gata' : 'audio', error: null,
        progress: { ...row.progress, audio, total: r.total, done: r.done, phase: allDone ? 'gata' : 'voce' },
        cost_micro: (row.cost_micro || 0) + (r.cost || 0), ...(dur ? { duration_sec: dur } : {}),
      });
    }
  } catch (e) {
    log(`live: pregătirea lecției ${row.id} a eșuat: ${e.message}`);
    // cu scriptul gata, lecția merge oricum (vocea browserului); fără script → eroare
    if (row.script) await browserVoice(String(e.message || e).slice(0, 300));
    else await save({ status: 'eroare', error: String(e.message || e).slice(0, 400) });
  } finally {
    await supa.from('live_lessons').update({ locked_until: null }).eq('id', row.id);
    lessonCache.delete(row.id);
  }
  return {
    ...lessonView({ ...row, total: row.progress?.total, done: row.progress?.done }),
    noVoice: !!row.progress?.noVoice,
    playable: row.status === 'gata' || (row.script ? LL.playableHead(row.script, row.progress?.audio || {}) : false),
  };
}

// ═════════════════════════════════════════════════════════════════════════════
// CRONOLOGIA unei ședințe
// ═════════════════════════════════════════════════════════════════════════════
// Grup: ceasul pornește la ora de început (sau când lecția e gata, dacă întârzie)
// și e ACELAȘI pentru toți. Ce trebuie verificat pe server (ferestrele
// întrebărilor, răspunsurile corecte, sesiunile de întrebări) se ține compact
// în live_sessions.state, ca fiecare răspuns al elevilor să nu recitească lecția.
function computeTimeline(session, lesson, { individual = false } = {}) {
  if (!lesson?.script) return null;
  const audio = lesson.progress?.noVoice ? {} : (lesson.progress?.audio || {});
  let tl;
  if (session.kind === 'grup' && !individual) {
    const start = new Date(session.state?.startedAt || session.starts_at).getTime();
    // sfârșitul INIȚIAL al orei (prelungirile pentru elevii care continuă 1-la-1 nu lungesc lecția comună)
    const target = Math.max(1800, (new Date(L.baseEndOf(session) || session.ends_at).getTime() - start) / 1000 - 120);
    tl = L.fitTimeline(lesson.script, audio, target);
  } else tl = L.buildTimeline(lesson.script, audio, { mode: 'privat' });
  // fără voce generată (nicio cheie TTS): playerul nu așteaptă sunetul, vorbește browserul
  if (tl && lesson.progress?.noVoice) tl.noVoice = true;
  return tl;
}
// 1-la-1 poate porni înainte să fie gata toată vocea (începutul e de ajuns)
const playableFor = (session, lesson) => lesson.status === 'gata' || (session.kind === 'privat' && LL.playableHead(lesson.script || {}, lesson.progress?.audio || {}));

// „amprenta" cronologiei: lecția + versiunea regulilor de durată (dacă se schimbă
// estimarea duratelor, ședințele în curs își recalculează ferestrele întrebărilor)
const TL_VERSION = 2;
const tlStamp = (lesson) => `${lesson.updated_at}|v${TL_VERSION}`;

// răspunsurile corecte ale tuturor întrebărilor (încercarea, pașii, verificarea)
function pollKeys(script) {
  const out = {};
  for (const it of script?.items || []) {
    for (const p of L.itemPolls(it)) out[p.id] = { type: p.type, answer: p.answer, accept: p.accept || null };
  }
  return out;
}
const pollOf = (script, id) => (script?.items || []).flatMap((it) => L.itemPolls(it)).find((p) => p.id === id) || null;

function compactState(tl, lesson) {
  const polls = {}, qna = [];
  for (const s of tl.scenes) {
    if (s.type === 'sondaj' && s.poll) polls[s.poll.id] = [s.t0, s.t0 + s.dur];
    if (s.type === 'intrebari') qna.push([s.t0, s.t0 + s.dur]);
  }
  return { stamp: tlStamp(lesson), duration: tl.duration, covered: tl.covered ?? null, total: tl.total ?? null, polls, qna, keys: pollKeys(lesson.script) };
}

// Asigură ceasul și starea compactă a unei ședințe de grup (când lecția e gata).
// La ORA DE ÎNCEPUT (la prima cerere de după ea) se hotărăște cum merge ședința:
//   · cel puțin LIVE_MINIM_GRUP elevi (implicit 2) în sală → ședința COMUNĂ pornește;
//   · un singur elev → ședința devine 1-la-1 pentru el (fără cost în plus); cine
//     mai intră după aceea primește tot o ședință 1-la-1 cu aceeași lecție;
//   · niciun elev → nu pornește nimic (se hotărăște când intră primul).
// Înainte de ora de început, toți stau în sala de așteptare.
const MIN_GROUP = () => Math.max(1, parseInt(process.env.LIVE_MINIM_GRUP || '2', 10) || 2);

// Ședința de grup merge „1-la-1" pentru elevul acesta? (a rămas singur la început,
// sau ședința comună s-a terminat deja, dar ora nu — cine intră târziu își ia lecția întreagă)
function individualFor(session, now = new Date()) {
  if (!session || session.kind !== 'grup') return false;
  const st = session.state || {};
  if (st.mode === 'individual') return true;
  if (st.startedAt && st.tl?.duration && now.getTime() < new Date(session.ends_at).getTime()) {
    return (now.getTime() - new Date(st.startedAt).getTime()) / 1000 > st.tl.duration + 5;
  }
  return false;
}

// de ce e 1-la-1 (pentru mesajul din sală): „singur" la ora de început / „dupa" lecția comună
const modeWhy = (session, personal) => (!personal ? null : session.state?.mode === 'individual' ? 'singur' : 'dupa');

async function ensureGroupClock(supa, session, lesson, now = new Date()) {
  if (session.kind !== 'grup' || !lesson || lesson.status !== 'gata') return session;
  const st = { ...(session.state || {}) };
  let changed = false, decided = false;
  const t = now.getTime();
  if (!st.startedAt && !st.mode && t >= new Date(session.starts_at).getTime() && t < new Date(session.ends_at).getTime()) {
    const present = (await presentCounts(supa, [session.id]))[session.id] || 0;
    if (present >= MIN_GROUP()) { st.startedAt = now.toISOString(); changed = decided = true; }
    else if (present >= 1) { st.mode = 'individual'; st.individualAt = now.toISOString(); changed = decided = true; }
  }
  if (st.startedAt && (!st.tl || st.tl.stamp !== tlStamp(lesson) || st.lessonId !== lesson.id)) {
    const tl = computeTimeline({ ...session, state: st }, lesson);
    if (tl) { st.tl = compactState(tl, lesson); st.lessonId = lesson.id; changed = true; }
  }
  if (!changed) return session;
  const patch = { state: st, lesson_id: lesson.id, ...(session.status === 'programata' && (st.startedAt || st.mode) ? { status: 'activa' } : {}) };
  // doar primul câștigă la hotărâre (nu se mută startedAt și nici modul între participanți)
  let q = supa.from('live_sessions').update(patch).eq('id', session.id);
  if (decided) q = q.is('state->>startedAt', null).is('state->>mode', null);
  else if (!session.state?.startedAt) q = q.is('state->>startedAt', null);
  const { data } = await q.select('*').maybeSingle();
  if (data) {
    if (decided) broadcast(session.id, 'session', { changed: true }).catch(() => {});   // sala de așteptare află imediat
    return data;
  }
  const { data: cur } = await supa.from('live_sessions').select('*').eq('id', session.id).maybeSingle();
  return cur || session;
}

// ═════════════════════════════════════════════════════════════════════════════
// INTRAREA ÎN SALĂ
// ═════════════════════════════════════════════════════════════════════════════
async function loadSession(supa, sessionId) {
  if (!sessionId || !/^[0-9a-f-]{36}$/i.test(String(sessionId))) throw fail(400, 'Ședință invalidă.');
  const { data, error } = await supa.from('live_sessions').select('*').eq('id', sessionId).maybeSingle();
  dbCheck(error, 'ședința');
  if (!data) throw fail(404, 'Ședința nu există.');
  return data;
}

async function accessToSession(supa, session, profile) {
  if (session.kind === 'privat') {
    if (session.owner_id === profile.id) return { ok: true, via: 'proprietar' };
    if (profile.is_admin) return { ok: true, via: 'admin' };
    return { ok: false, via: null, price: null, private: true };
  }
  let ticket = null;
  const free = await isFreeSubject(supa, session.subject_id);   // subiectul e o meditație gratuită
  if (!premiumOf(profile) && !free) {
    const { data } = await supa.from('live_tickets').select('id, status').eq('user_id', profile.id).eq('kind', 'grup').eq('session_id', session.id).eq('status', 'platit').limit(1);
    ticket = data && data[0] ? data[0] : null;
  }
  return L.groupAccess({ profile, ticket, free });
}

async function registerParticipant(supa, session, profile, via) {
  const row = { session_id: session.id, user_id: profile.id, display_name: L.displayName(profile.full_name, profile.id), access: via, last_seen: new Date().toISOString() };
  const { error } = await supa.from('live_participants').upsert(row, { onConflict: 'session_id,user_id' });
  dbCheck(error, 'participanții');
  return row;
}

async function recentMessages(supa, session, userId, { afterId = 0, limit = 60 } = {}) {
  let q = supa.from('live_messages').select('id, user_id, author, role, to_teacher, text, reply_to, audio_url, audio_dur, lip, created_at')
    .eq('session_id', session.id).eq('hidden', false).order('id', { ascending: false }).limit(limit);
  if (afterId) q = q.gt('id', afterId);
  const { data, error } = await q;
  dbCheck(error, 'chatul');
  // mesajele private (elev → profesor și răspunsul lui) le vede doar elevul lor
  const mine = new Set((data || []).filter((m) => m.user_id === userId).map((m) => m.id));
  const own = (m) => !m.to_teacher || m.user_id === userId || (m.role === 'profesor' && mine.has(m.reply_to));
  return (data || []).filter(own).reverse().map((m) => msgView(m, session, userId));
}
function msgView(m, session, userId = null) {
  const created = new Date(m.created_at).getTime();
  const origin = new Date(session.state?.startedAt || session.starts_at).getTime();
  return {
    id: m.id, author: m.author, role: m.role, private: !!m.to_teacher, text: m.text, replyTo: m.reply_to || null,
    audio: m.audio_url || null, dur: m.audio_dur || null, lip: m.lip || null,
    at: m.created_at, sec: Math.round((created - origin) / 100) / 10,
    mine: !!userId && m.user_id === userId,
  };
}

async function join(req, res, supa) {
  const { userId, profile } = await who(req, supa);
  const session = await loadSession(supa, req.body?.sessionId);
  const now = new Date();
  const phase = L.phaseOf(session, now);
  const teacher = L.publicTeacher(L.teacherById(session.teacher));
  const access = await accessToSession(supa, session, profile);
  const base = {
    session: { id: session.id, kind: session.kind, teacher: session.teacher, slot: session.slot, exam: session.exam, profile: session.profile,
      examLabel: L.EXAM_LABEL(session.exam, session.profile), starts_at: session.starts_at, ends_at: session.ends_at, phase,
      // meditație gratuită (1-la-1 pornită gratuit / ședința de grup cu un subiect gratuit)
      free: session.kind === 'privat' ? session.access === 'gratuit' : access.via === 'gratuit' },
    teacher, now: now.toISOString(), me: { id: userId, name: L.displayName(profile.full_name, userId), admin: !!profile.is_admin, premium: premiumOf(profile) },
    privMinutes: L.PRIVATE_MINUTES(), extendMaxMin: L.EXT_MAX_MIN(),
  };
  if (!access.ok) {
    return res.status(402).json({ ...base, error: access.private ? 'Aceasta este ședința 1-la-1 a altui elev.' : `Ședința costă ${access.price} lei (sau e inclusă în abonament).`, code: 'LIVE_PAYMENT', price: access.price });
  }
  if (session.kind === 'grup' && !L.canJoinPhase(phase) && !profile.is_admin) {
    return res.status(409).json({ ...base, error: phase === 'incheiata' ? 'Ședința s-a încheiat.' : `Sala se deschide cu ${L.JOIN_EARLY_MIN()} minute înainte de început.`, code: 'LIVE_CLOSED' });
  }
  if (!session.subject_id) {
    return res.status(200).json({ ...base, access: access.via, lesson: null, waiting: 'fara_subiect' });
  }
  await registerParticipant(supa, session, profile, access.via);
  let lessonLight = await lessonFor(supa, session.subject_id, session.teacher);
  // lecție scrisă înainte de întrebările pe pași: întâi se completează (o singură dată pe
  // subiect, ~1 minut) — sala așteaptă „pregătirea", ca la o lecție nouă (vezi prepare)
  const stepsFirst = await stepsUpgradeFor(supa, session, lessonLight, now);
  let s = session;
  let lesson = null;
  if (lessonLight.status === 'gata' || (session.kind === 'privat' && ['script', 'audio'].includes(lessonLight.status))) {
    lesson = await loadLesson(supa, lessonLight.id, { fresh: lessonLight.status !== 'gata' });
    s = await ensureGroupClock(supa, session, lesson, now);
  }
  const title = (await subjectTitles(supa, [session.subject_id]))[session.subject_id] || lesson?.title || 'Subiect';
  const personal = individualFor(s, now);            // ședință de grup ținută 1-la-1 pentru acest elev
  const out = {
    ...base,
    session: { ...base.session, subject: { id: session.subject_id, title }, startedAt: personal ? null : (s.state?.startedAt || null), mode: personal ? 'individual' : null, modeWhy: modeWhy(s, personal), state: session.kind === 'privat' ? (s.state?.player || null) : null },
    access: access.via, channel: `live:${session.id}`,
    lesson: lessonView(lessonLight),
    messages: await recentMessages(supa, s, userId),
  };
  if (lesson && (lesson.status === 'gata' || session.kind === 'privat')) {
    const tl = computeTimeline(s, lesson, { individual: personal });
    const playable = playableFor(session, lesson) && !stepsFirst;
    out.timeline = playable ? tl : null;
    out.lesson.playable = playable;
    if (stepsFirst) out.lesson = { ...out.lesson, status: 'script', phase: 'pasi' };
    out.noVoice = !!lesson.progress?.noVoice;
    out.baremTitle = lesson.script?.baremTitle || null;
  }
  // răspunsurile mele la întrebări (reluare după reîncărcarea paginii)
  const { data: ans } = await supa.from('live_poll_answers').select('poll_id, answer, correct').eq('session_id', session.id).eq('user_id', userId);
  out.myAnswers = Object.fromEntries((ans || []).map((a) => [a.poll_id, { answer: a.answer, correct: a.correct }]));
  return res.status(200).json(out);
}

// Pregătirea lecției, cerută din sală (elevul așteaptă) sau de admin.
async function prepare(req, res, supa) {
  const { profile } = await who(req, supa);
  const session = await loadSession(supa, req.body?.sessionId);
  const access = await accessToSession(supa, session, profile);
  if (!access.ok) throw fail(402, 'Nu ai acces la această ședință.', 'LIVE_PAYMENT');
  if (!session.subject_id) throw fail(409, 'Ședința nu are încă un subiect cu barem.');
  const lesson = await lessonFor(supa, session.subject_id, session.teacher);
  if (lesson.status === 'gata') {
    // întrebările pe pași lipsesc (lecție scrisă înainte de ele) și se pot completa acum
    if (await stepsUpgradeFor(supa, session, lesson)) {
      const r = await prepareLesson(supa, lesson.id, { steps: true, budgetMs: Math.min(240000, Math.max(30000, Number(req.body?.budgetMs) || 90000)) });
      return res.status(200).json({ lesson: r });
    }
    return res.status(200).json({ lesson: { ...lessonView(lesson), playable: true } });
  }
  // 1-la-1 deja pornit: vocea continuă în fundal, întâi de la itemul la care e elevul
  const fromRef = typeof req.body?.fromRef === 'string' ? req.body.fromRef.slice(0, 20) : null;
  const r = await prepareLesson(supa, lesson.id, { budgetMs: Math.min(240000, Math.max(20000, Number(req.body?.budgetMs) || 55000)), fromRef });
  return res.status(200).json({ lesson: r });
}

async function timeline(req, res, supa) {
  const { profile } = await who(req, supa);
  const session = await loadSession(supa, req.body?.sessionId);
  const access = await accessToSession(supa, session, profile);
  if (!access.ok) throw fail(402, 'Nu ai acces la această ședință.', 'LIVE_PAYMENT');
  const light = session.subject_id ? await lessonFor(supa, session.subject_id, session.teacher, { create: false }) : null;
  if (!light) return res.status(200).json({ timeline: null, lesson: null });
  const lesson = await loadLesson(supa, light.id, { fresh: true });
  const s = await ensureGroupClock(supa, session, lesson);
  const playable = playableFor(session, lesson);
  const personal = individualFor(s);
  return res.status(200).json({
    timeline: playable ? computeTimeline(s, lesson, { individual: personal }) : null,
    lesson: { ...lessonView(light), playable },
    startedAt: personal ? null : (s.state?.startedAt || null), mode: personal ? 'individual' : null, modeWhy: modeWhy(s, personal),
    startsAt: s.starts_at, endsAt: s.ends_at,
    now: new Date().toISOString(), noVoice: !!lesson.progress?.noVoice,
  });
}

// Prelungirea (vezi L.extensionPlan): browserul o cere cât elevul lucrează la 1-la-1
// și imediat după sfârșitul lecției comune (ca „Continuă 1-la-1" să rămână posibil).
const commonLessonOver = (session, now = new Date()) => {
  const st = session?.state || {};
  return !!(st.startedAt && st.tl?.duration && (now.getTime() - new Date(st.startedAt).getTime()) / 1000 >= st.tl.duration);
};
async function extend(req, res, supa) {
  const { userId, profile } = await who(req, supa);
  const session = await loadSession(supa, req.body?.sessionId);
  const access = await accessToSession(supa, session, profile);
  if (!access.ok) throw fail(402, 'Nu ai acces la această ședință.', 'LIVE_PAYMENT');
  const now = new Date();
  const individual = session.kind === 'grup' && (session.state?.mode === 'individual' || commonLessonOver(session, now));
  const plan = L.extensionPlan(session, { now, individual });
  const view = (ends, extra = {}) => ({
    ends_at: new Date(ends).toISOString(), base_end: plan.base ? new Date(plan.base).toISOString() : null, cap: plan.cap ? new Date(plan.cap).toISOString() : null,
    extended: !!plan.base && ends > plan.base, now: now.toISOString(), ...extra,
  });
  if (!plan.ok) return res.status(200).json(view(Date.parse(session.ends_at), { ok: false, reason: plan.reason }));
  if (!plan.changed) return res.status(200).json(view(plan.next, { ok: true }));
  const nextIso = new Date(plan.next).toISOString();
  const patch = { ends_at: nextIso, ...(session.status === 'incheiata' ? {} : { status: 'activa' }) };
  const { data } = await supa.from('live_sessions').update(patch).eq('id', session.id).eq('ends_at', session.ends_at).select('ends_at').maybeSingle();
  if (!data) {   // altcineva a prelungit-o chiar acum
    const cur = await loadSession(supa, session.id);
    return res.status(200).json(view(Date.parse(cur.ends_at), { ok: true }));
  }
  return res.status(200).json(view(plan.next, { ok: true, changed: true }));
}

async function heartbeat(req, res, supa) {
  const { userId } = await who(req, supa);
  const sessionId = req.body?.sessionId;
  const add = Math.max(0, Math.min(90, parseInt(req.body?.seconds || 0, 10) || 0));
  const { data: p } = await supa.from('live_participants').select('seconds').eq('session_id', sessionId).eq('user_id', userId).maybeSingle();
  if (!p) return res.status(200).json({ ok: false });
  await supa.from('live_participants').update({ last_seen: new Date().toISOString(), seconds: (p.seconds || 0) + add }).eq('session_id', sessionId).eq('user_id', userId);
  const counts = await presentCounts(supa, [sessionId]);
  return res.status(200).json({ ok: true, present: counts[sessionId] || 0, now: new Date().toISOString() });
}

// ═════════════════════════════════════════════════════════════════════════════
// CHATUL și RĂSPUNSURILE PROFESORULUI
// ═════════════════════════════════════════════════════════════════════════════
const MAX_MSG_PER_SESSION = () => parseInt(process.env.LIVE_MESAJE_MAX || '80', 10);
const MAX_ANSWERS_GROUP = () => parseInt(process.env.LIVE_INTREBARI_MAX || '10', 10);
const CHAT_MODEL = () => process.env.LIVE_CHAT_MODEL || ai.TUTOR_MODEL || ai.CHAT_MODEL;

const ANSWER_SCHEMA = ai.S.obj({
  say: ai.S.str('ce ROSTEȘTE profesorul: fără LaTeX, fără simboluri; propoziții scurte'),
  text: ai.S.str('același răspuns, pentru chat: formulele în LaTeX între $...$'),
  board: ai.S.arr(ai.S.str('un rând pe tablă: un pas (LaTeX între $...$)'), '0–6 rânduri de scris pe tablă (doar la 1-la-1): pașii de calcul, câte unul pe rând'),
});

function itemContext(script, index) {
  const items = script?.items || [];
  const it = Number.isInteger(index) && items[index] ? items[index] : null;
  if (!it) return '';
  const main = (it.modes?.barem || []).map((s) => s.say).join(' ');
  return [
    `ITEMUL DE ACUM: ${it.title} (${it.ref}, ${it.points || 5} puncte)`,
    `Enunț: ${it.statement}`,
    it.options ? `Variante: ${it.options.map((o, i) => `${'abcd'[i]}) ${o}`).join('   ')}` : '',
    `Răspunsul din barem: ${it.answer}`,
    `Baremul itemului: ${it.barem}`,
    `Ce am explicat deja: ${main.slice(0, 1500)}`,
    Array.isArray(it.steps) && it.steps.length
      ? `Întrebările pe pași puse elevilor (răspunsurile din barem): ${it.steps.map((s) => `${s.question} → ${s.type === 'grila' ? `${s.answer}) ${(s.options || [])['abcd'.indexOf(s.answer)] || ''}` : s.answer}`).join('; ').slice(0, 900)}`
      : '',
  ].filter(Boolean).join('\n');
}

// „Elev A42F" (cont fără nume) nu e un prenume: profesorul nu i se adresează așa
const realFirstName = (author) => {
  const a = String(author || '').trim();
  return !a || /^elev(ul)?\b/i.test(a) ? null : a.split(/\s+/)[0];
};

async function teacherAnswer(supa, { session, lesson, question, author, itemIndex, history = [], userId, privat = session.kind === 'privat', context = null, usageKey = 'live-chat' }) {
  const teacher = L.teacherById(session.teacher) || L.teachers()[0];
  const script = lesson?.script || {};
  const list = (script.items || []).map((it, i) => `${i + 1}. ${it.ref} — ${String(it.statement).slice(0, 90)}`).join('\n');
  const first = realFirstName(author);
  const system = [
    `Ești ${teacher.name}, ${teacher.gender === 'f' ? 'profesoară virtuală' : 'profesor virtual'} de matematică (AI) pe ExamenMate, într-o meditație online ${privat ? '1-la-1' : 'de grup'}. ${teacher.style || ''}`,
    context || `Subiectul ședinței: „${script.title || 'subiect de examen'}" (${L.EXAM_LABEL(script.exam, script.profile)}). Explicăm DOAR pe baza baremului.`,
    itemContext(script, itemIndex),
    list && !context ? `Itemii ședinței:\n${list}` : '',
    '',
    'CUM RĂSPUNZI:',
    `· Scurt și clar: ${privat ? 'cel mult 6 propoziții' : 'cel mult 4 propoziții'}. ${first ? `Te adresezi elevului pe prenume (${first}).` : 'Nu îi știi prenumele: nu i te adresa cu un nume (nici „Elev…").'}`,
    '· Rezultatele și pașii din barem sunt sursa de adevăr. Nu inventa alt rezultat.',
    '· Dacă întrebarea nu ține de matematica din ședință, spui politicos că acum lucrăm subiectul și, dacă e nevoie, recomanzi o ședință 1-la-1.',
    '· Fără date personale, fără linkuri, fără emoji. Nu repeta întrebarea.',
    '· „say" se rostește: fără LaTeX și fără simboluri („x la pătrat", „radical din 3", „a supra b").',
    privat ? '· „board": dacă elevul cere un calcul sau un pas („nu înțeleg cum ați ajuns la…", „arătați că…"), scrii pe tablă pașii, câte unul pe rând, fără pași săriți; altfel lista rămâne goală.' : '',
  ].filter(Boolean).join('\n');
  const messages = [...history.slice(-6), { role: 'user', content: `${first || 'Elevul'} întreabă: ${question}` }];
  let data, usage;
  try {
    const r = await ai.chatJson({ system, messages, schema: ANSWER_SCHEMA, schemaName: 'raspuns_live', model: CHAT_MODEL(), maxTokens: 1200, temperature: 0.4 });
    data = r.data; usage = r.usage;
  } catch (e) {
    await ai.logUsage(supa, userId, usageKey, e.usage || {});
    throw fail(502, 'Profesorul nu a putut răspunde acum. Mai încearcă o dată.');
  }
  await ai.logUsage(supa, userId, usageKey, usage);
  const text = String(data?.text || data?.say || '').trim().slice(0, 1500);
  const say = String(data?.say || text).trim().slice(0, 900);
  const board = Array.isArray(data?.board) ? data.board.map((b) => String(b).slice(0, 200)).filter(Boolean).slice(0, 6) : [];
  return { text, say, board: privat ? board : [], teacher };
}

async function chat(req, res, supa) {
  const { userId, profile } = await who(req, supa);
  const session = await loadSession(supa, req.body?.sessionId);
  const access = await accessToSession(supa, session, profile);
  if (!access.ok) throw fail(402, 'Nu ai acces la această ședință.', 'LIVE_PAYMENT');
  if (L.phaseOf(session) === 'incheiata' && !profile.is_admin) throw fail(409, 'Ședința s-a încheiat.');
  // ședința de grup ținută 1-la-1 (un singur elev la început): ca la 1-la-1, dar
  // mesajele rămân ale fiecărui elev (dacă mai intră cineva, are ședința lui)
  const individual = individualFor(session);
  const privat = session.kind === 'privat' || individual;
  const toTeacher = individual ? true : (session.kind === 'privat' ? false : !!req.body?.toTeacher);
  const { text, flagged } = L.moderate(req.body?.text || '');
  if (!text) throw fail(400, 'Mesajul e gol.');

  // limite anti-abuz: 1 mesaj la 2,5 s, maximum N pe ședință
  const { data: last } = await supa.from('live_messages').select('id, created_at').eq('session_id', session.id).eq('user_id', userId).order('id', { ascending: false }).limit(1);
  if (last && last[0] && Date.now() - new Date(last[0].created_at).getTime() < 2500) throw fail(429, 'Mai încet 🙂 — un mesaj la câteva secunde.');
  const { count: mineCount } = await supa.from('live_messages').select('*', { count: 'exact', head: true }).eq('session_id', session.id).eq('user_id', userId);
  if ((mineCount || 0) >= MAX_MSG_PER_SESSION()) throw fail(429, 'Ai trimis multe mesaje în această ședință. Pentru întrebări pe îndelete, alege o ședință 1-la-1.');

  const author = L.displayName(profile.full_name, userId);
  const { data: msg, error } = await supa.from('live_messages')
    .insert({ session_id: session.id, user_id: userId, author, role: 'elev', to_teacher: toTeacher, text }).select('*').maybeSingle();
  dbCheck(error, 'chatul');
  const mine = msgView(msg, session, userId);
  if (!toTeacher && !privat) broadcast(session.id, 'chat', { msg: { ...mine, mine: false } }).catch(() => {});

  // profesorul răspunde: la 1-la-1 la orice; în grup la întrebări (sau mesaje private către el)
  const wantsAnswer = privat || toTeacher || L.isQuestion(text);
  let answer = null;
  if (wantsAnswer && !flagged) {
    let allowed = true;
    let note = 'Ai pus deja multe întrebări în ședința de grup. Le poți lua pe rând într-o ședință 1-la-1, pe îndelete.';
    // meditația gratuită (1-la-1 pornită gratuit sau ședința de grup cu subiect gratuit, fără
    // abonament): profesorul răspunde la cel mult LIVE_GRATUIT_INTREBARI întrebări în chat
    const freeChat = (session.kind === 'privat' && session.access === 'gratuit') || access.via === 'gratuit';
    if (freeChat || !privat) {
      // câte răspunsuri a primit deja elevul în această ședință
      let n = 0;
      if (session.kind === 'privat') {
        const { count } = await supa.from('live_messages').select('*', { count: 'exact', head: true }).eq('session_id', session.id).eq('role', 'profesor');
        n = count || 0;
      } else {
        const { data: myQ } = await supa.from('live_messages').select('id').eq('session_id', session.id).eq('user_id', userId).limit(200);
        const ids = (myQ || []).map((m) => m.id);
        if (ids.length) {
          const { count } = await supa.from('live_messages').select('*', { count: 'exact', head: true }).eq('session_id', session.id).eq('role', 'profesor').in('reply_to', ids);
          n = count || 0;
        }
      }
      const capFree = freeChat ? L.FREE_ANSWERS() : Infinity;
      const capGroup = privat ? Infinity : MAX_ANSWERS_GROUP();
      allowed = n < Math.min(capFree, capGroup);
      if (!allowed && n >= capFree) {
        note = `În meditațiile gratuite, profesorul răspunde la cel mult ${capFree} întrebări în chat — lecția merge mai departe ca până acum. Cu abonamentul ExamenMate îl întrebi cât vrei.`;
      }
    }
    if (allowed) {
      const light = session.subject_id ? await lessonFor(supa, session.subject_id, session.teacher, { create: false }) : null;
      const lesson = light ? await loadLesson(supa, light.id) : null;
      let history = [];
      if (privat) {
        const { data: h } = await supa.from('live_messages').select('id, user_id, reply_to, role, text').eq('session_id', session.id).order('id', { ascending: false }).limit(24);
        let rows = h || [];
        if (individual) {   // doar conversația acestui elev
          const mineIds = new Set(rows.filter((m) => m.user_id === userId).map((m) => m.id));
          rows = rows.filter((m) => m.user_id === userId || (m.role === 'profesor' && mineIds.has(m.reply_to)));
        }
        history = rows.slice(0, 8).reverse().slice(0, -1).map((m) => ({ role: m.role === 'profesor' ? 'assistant' : 'user', content: m.text }));
      }
      const itemIndex = Number.isInteger(req.body?.item) ? req.body.item : null;
      const a = await teacherAnswer(supa, { session, lesson, question: text, author, itemIndex, history, userId, privat });
      const { data: tmsg, error: e2 } = await supa.from('live_messages')
        .insert({ session_id: session.id, user_id: null, author: a.teacher.name, role: 'profesor', to_teacher: toTeacher, text: a.text, reply_to: msg.id })
        .select('*').maybeSingle();
      dbCheck(e2, 'chatul');
      // vocea: la 1-la-1 mereu; în grup doar pentru întrebările publice (se rostesc în „Întrebări")
      if (privat || !toTeacher) {
        try {
          const v = await tts.voiceSegment(supa, { text: a.say, teacher: L.teacherById(session.teacher), path: `answers/${session.id}/${tmsg.id}` });
          if (v) {
            await supa.from('live_messages').update({ audio_url: v.url, audio_dur: v.dur, lip: v.lip }).eq('id', tmsg.id);
            Object.assign(tmsg, { audio_url: v.url, audio_dur: v.dur, lip: v.lip });
          }
        } catch (e) { if (e.code !== 'NO_TTS') console.warn('live: vocea răspunsului:', e.message); }
      }
      answer = { ...msgView(tmsg, session), board: a.board, say: a.say };   // say = textul de rostit (fără LaTeX)
      if (!toTeacher && !privat) broadcast(session.id, 'chat', { msg: answer }).catch(() => {});
    } else {
      answer = { id: -Date.now(), author: 'ExamenMate', role: 'sistem', private: true, text: note, at: new Date().toISOString() };
    }
  }
  return res.status(200).json({ message: mine, answer, flagged });
}

async function messages(req, res, supa) {
  const { userId, profile } = await who(req, supa);
  const session = await loadSession(supa, req.body?.sessionId);
  const access = await accessToSession(supa, session, profile);
  if (!access.ok) throw fail(402, 'Nu ai acces la această ședință.', 'LIVE_PAYMENT');
  const list = await recentMessages(supa, session, userId, { afterId: parseInt(req.body?.afterId || 0, 10) || 0, limit: 80 });
  return res.status(200).json({ messages: list, now: new Date().toISOString() });
}

// ═════════════════════════════════════════════════════════════════════════════
// ÎNTREBĂRILE PROFESORULUI (sondaje)
// ═════════════════════════════════════════════════════════════════════════════
const lastPollCast = new Map();
async function pollAggregate(supa, session, pollId, key) {
  const { data } = await supa.from('live_poll_answers').select('answer, correct').eq('session_id', session.id).eq('poll_id', pollId).limit(5000);
  return L.pollResults({ type: key?.type }, data || []);
}

async function pollAnswer(req, res, supa) {
  const { userId, profile } = await who(req, supa);
  const session = await loadSession(supa, req.body?.sessionId);
  const access = await accessToSession(supa, session, profile);
  if (!access.ok) throw fail(402, 'Nu ai acces la această ședință.', 'LIVE_PAYMENT');
  const pollId = String(req.body?.pollId || '').slice(0, 40);
  const answer = String(req.body?.answer ?? '').trim().slice(0, 80);
  if (!pollId || !answer) throw fail(400, 'Răspuns gol.');

  let key = session.state?.tl?.keys?.[pollId] || null;
  const individual = individualFor(session);
  if (session.kind === 'grup' && !individual) {
    const win = session.state?.tl?.polls?.[pollId];
    const started = session.state?.startedAt ? new Date(session.state.startedAt).getTime() : null;
    if (!win || !started) throw fail(409, 'Întrebarea nu mai e deschisă.');
    const pos = (Date.now() - started) / 1000;
    if (pos < win[0] - 3 || pos > win[1] + 4) throw fail(409, 'Timpul pentru această întrebare a expirat.');
  } else if (!key) {
    const light = await lessonFor(supa, session.subject_id, session.teacher, { create: false });
    const lesson = light ? await loadLesson(supa, light.id) : null;
    key = pollKeys(lesson?.script)[pollId] || null;
  }
  if (!key) throw fail(404, 'Întrebare necunoscută.');
  // „Nu știu" (1-la-1): elevul cere răspunsul — se înregistrează ca greșit
  const correct = answer === '?' ? false : L.checkPollAnswer(key, answer, mathcheck.answersEquivalent);
  const { error } = await supa.from('live_poll_answers').upsert({ session_id: session.id, poll_id: pollId, user_id: userId, answer, correct: !!correct }, { onConflict: 'session_id,poll_id,user_id' });
  dbCheck(error, 'răspunsurile');
  const results = await pollAggregate(supa, session, pollId, key);
  // rezultatele se difuzează cel mult o dată pe secundă și jumătate per întrebare
  if (session.kind === 'grup' && !individual) {
    const k = `${session.id}|${pollId}`;
    if (!lastPollCast.has(k) || Date.now() - lastPollCast.get(k) > 1500) {
      lastPollCast.set(k, Date.now());
      broadcast(session.id, 'poll', { pollId, results }).catch(() => {});
    }
  }
  // în grup, corectitudinea se arată la „rezultate"; la 1-la-1 imediat (cu explicația)
  const now1 = session.kind === 'privat' || individual;
  let explain;
  if (now1) {
    const light = await lessonFor(supa, session.subject_id, session.teacher, { create: false }).catch(() => null);
    const lesson = light ? await loadLesson(supa, light.id).catch(() => null) : null;
    explain = pollOf(lesson?.script, pollId)?.explain || null;
  }
  return res.status(200).json({ ok: true, correct: !!correct, answer: now1 ? key.answer : undefined, explain, results });
}

async function pollResultsAction(req, res, supa) {
  const { profile } = await who(req, supa);
  const session = await loadSession(supa, req.body?.sessionId);
  const access = await accessToSession(supa, session, profile);
  if (!access.ok) throw fail(402, 'Nu ai acces la această ședință.', 'LIVE_PAYMENT');
  const pollId = String(req.body?.pollId || '');
  const key = session.state?.tl?.keys?.[pollId] || { type: req.body?.type === 'grila' ? 'grila' : 'completare' };
  return res.status(200).json({ pollId, results: await pollAggregate(supa, session, pollId, key) });
}

// ═════════════════════════════════════════════════════════════════════════════
// 1-LA-1
// ═════════════════════════════════════════════════════════════════════════════
async function privateSubjects(req, res, supa) {
  const { profile } = await who(req, supa);
  const exam = req.body?.exam === 'bac' ? 'bac' : 'en';
  const profileFilter = exam === 'bac' && req.body?.profile ? String(req.body.profile) : null;
  const teacherId = L.teacherById(req.body?.teacher) ? req.body.teacher : L.teachers()[0].id;
  const list = await eligibleSubjects(supa, { exam, profile: profileFilter });
  const ready = await readyLessons(supa, teacherId);
  const anyReady = new Set();
  const { data: others } = await supa.from('live_lessons').select('subject_id').eq('status', 'gata').limit(3000);
  for (const r of others || []) anyReady.add(r.subject_id);
  const free = await freeLessons(supa);
  return res.status(200).json({
    exam, teacher: teacherId,
    // întâi meditațiile gratuite, apoi lecțiile gata de pornire
    subjects: list.map((s) => ({ ...s, ready: ready.has(s.id), scriptReady: anyReady.has(s.id), free: free.set.has(String(s.id).toLowerCase()) }))
      .sort((a, b) => (b.free - a.free) || (b.ready - a.ready) || String(b.title).localeCompare(String(a.title), 'ro', { numeric: true })),
    access: await privateAccessFor(supa, profile),
    freeAccess: L.freeAccess({ profile, free: true, freeUsed: await freeUsedThisMonth(supa, profile.id) }),
  });
}

async function privateStart(req, res, supa) {
  const { userId, profile } = await who(req, supa);
  const teacher = L.teacherById(req.body?.teacher);
  if (!teacher) throw fail(400, 'Alege un profesor.');
  const subjectId = String(req.body?.subjectId || '');
  const { data: content } = await supa.from('content').select('id, title, category, subcategory, profile, file_url').eq('id', subjectId).maybeSingle();
  if (!content) throw fail(404, 'Subiectul nu există.');
  const se = L.subjectExam(content, B);
  if (!se || B.isBaremRow(content)) throw fail(400, 'Alege un subiect de Evaluare Națională sau de Bacalaureat.');
  const { data: pdf } = await supa.from('ai_pdf_text').select('barem_status').eq('content_id', content.id).maybeSingle();
  if (!pdf || !L.BAREM_OK.has(pdf.barem_status)) throw fail(409, 'Pentru acest subiect nu am baremul oficial, așa că nu îl explic. Alege un subiect cu barem.', 'NO_BAREM');

  // o ședință 1-la-1 deja deschisă (nefinalizată, din ultimele ore) se reia, nu se plătește de două ori
  const { data: open } = await supa.from('live_sessions').select('id, ends_at, status').eq('owner_id', userId).eq('kind', 'privat')
    .eq('teacher', teacher.id).eq('subject_id', content.id).neq('status', 'incheiata').gt('ends_at', new Date().toISOString()).limit(1);
  if (open && open[0]) return res.status(200).json({ sessionId: open[0].id, resumed: true });

  // meditație gratuită: fără plată și fără să consume ședințele incluse / biletele
  let access = null;
  let freeNote = '';
  if (!profile.is_admin && await isFreeSubject(supa, content.id)) {
    const fa = L.freeAccess({ profile, free: true, freeUsed: await freeUsedThisMonth(supa, userId) });
    if (fa.ok) access = fa;
    else freeNote = `Ai făcut deja cele ${fa.freeMonthly} meditații gratuite din luna aceasta. `;
  }
  if (!access) access = await privateAccessFor(supa, profile);
  if (!access.ok) {
    return res.status(402).json({ error: `${freeNote}Ședința 1-la-1 costă ${access.price} lei${access.included ? ` (ai folosit cele ${access.included} incluse luna aceasta)` : ' (sau e inclusă în abonament: 8 pe lună)'}.`, code: 'LIVE_PAYMENT', price: access.price, access });
  }
  // cel mult 3 ședințe 1-la-1 nepornite pe zi (fiecare subiect nou costă o pregătire)
  const { count: pending } = await supa.from('live_sessions').select('*', { count: 'exact', head: true })
    .eq('owner_id', userId).eq('kind', 'privat').gte('created_at', new Date(Date.now() - 86400000).toISOString())
    .is('state->>startedAt', null);
  if ((pending || 0) >= 3 && !profile.is_admin) throw fail(429, 'Ai deja câteva ședințe 1-la-1 deschise și nepornite. Intră într-una dintre ele din „Ședințele mele".');

  const now = new Date();
  // ceasul de 60 de minute pornește la private_begin; până atunci, o marjă pentru pregătire
  const provisionalEnd = new Date(now.getTime() + (L.PRIVATE_MINUTES() + 30) * 60000);
  const lesson = await lessonFor(supa, content.id, teacher.id);
  const { data: s, error } = await supa.from('live_sessions').insert({
    kind: 'privat', teacher: teacher.id, exam: se.exam, profile: se.profile || null, subject_id: content.id,
    lesson_id: lesson.id, starts_at: now.toISOString(), ends_at: provisionalEnd.toISOString(),
    owner_id: userId, access: access.via, status: 'programata', state: {},
  }).select('*').maybeSingle();
  dbCheck(error, 'ședința');
  await registerParticipant(supa, s, profile, 'proprietar');
  return res.status(200).json({ sessionId: s.id, via: access.via, lesson: lessonView(lesson) });
}

// Ceasul celor 60 de minute pornește abia acum — și abia acum se consumă
// ședința inclusă sau biletul (o lecție care nu a pornit nu costă nimic).
async function privateBegin(req, res, supa) {
  const { userId, profile } = await who(req, supa);
  const session = await loadSession(supa, req.body?.sessionId);
  if (session.kind !== 'privat' || session.owner_id !== userId) throw fail(403, 'Nu e ședința ta.');
  if (session.state?.startedAt) return res.status(200).json({ startedAt: session.state.startedAt, ends_at: session.ends_at });
  let via = session.access;
  const wasFree = via === 'gratuit';
  if (wasFree) {
    // tot gratuită? (adminul o poate scoate dintre cele gratuite; plafonul lunar)
    const f = await freeLessons(supa, { fresh: true });
    const fa = L.freeAccess({ profile, free: f.set.has(String(session.subject_id || '').toLowerCase()), freeUsed: await freeUsedThisMonth(supa, userId) });
    if (!fa.ok) via = null;   // → drumul obișnuit: ședință inclusă / bilet / plată
  }
  if (via !== 'admin' && via !== 'gratuit') {
    const acc = await privateAccessFor(supa, profile);
    if (!acc.ok) {
      throw fail(402, wasFree
        ? `Meditația nu mai e gratuită (sau ai făcut deja meditațiile gratuite din luna aceasta) — ședința 1-la-1 costă ${acc.price} lei.`
        : `Ședința 1-la-1 costă ${acc.price} lei — ai folosit ședințele incluse luna aceasta.`, 'LIVE_PAYMENT');
    }
    via = acc.via;
    if (via === 'bilet') {
      const { data: t } = await supa.from('live_tickets').select('id').eq('user_id', userId).eq('kind', 'privat').eq('status', 'platit').is('session_id', null).order('created_at').limit(1);
      if (!t || !t[0]) throw fail(402, 'Nu mai ai niciun bilet 1-la-1 neconsumat.', 'LIVE_PAYMENT');
      const { data: used } = await supa.from('live_tickets').update({ status: 'folosit', session_id: session.id, used_at: new Date().toISOString() })
        .eq('id', t[0].id).eq('status', 'platit').select('id').maybeSingle();
      if (!used) throw fail(409, 'Biletul a fost folosit între timp. Reîncearcă.');
    }
  }
  const now = new Date();
  const ends = new Date(now.getTime() + L.PRIVATE_MINUTES() * 60000);
  const { data } = await supa.from('live_sessions').update({ access: via, state: { ...(session.state || {}), startedAt: now.toISOString() }, ends_at: ends.toISOString(), status: 'activa' })
    .eq('id', session.id).is('state->>startedAt', null).select('state, ends_at').maybeSingle();
  if (!data) {
    const cur = await loadSession(supa, session.id);
    return res.status(200).json({ startedAt: cur.state?.startedAt, ends_at: cur.ends_at });
  }
  return res.status(200).json({ startedAt: data.state.startedAt, ends_at: data.ends_at, via });
}

async function privateState(req, res, supa) {
  const { userId } = await who(req, supa);
  const session = await loadSession(supa, req.body?.sessionId);
  if (session.kind !== 'privat' || session.owner_id !== userId) throw fail(403, 'Nu e ședința ta.');
  const p = req.body?.player || {};
  const player = { scene: Math.max(0, parseInt(p.scene || 0, 10) || 0), mode: typeof p.mode === 'string' ? p.mode.slice(0, 20) : null, at: new Date().toISOString() };
  await supa.from('live_sessions').update({ state: { ...(session.state || {}), player } }).eq('id', session.id);
  return res.status(200).json({ ok: true });
}

async function leave(req, res, supa) {
  const { userId } = await who(req, supa);
  const session = await loadSession(supa, req.body?.sessionId);
  const add = Math.max(0, Math.min(90, parseInt(req.body?.seconds || 0, 10) || 0));
  const { data: p } = await supa.from('live_participants').select('seconds').eq('session_id', session.id).eq('user_id', userId).maybeSingle();
  if (p) await supa.from('live_participants').update({ seconds: (p.seconds || 0) + add, last_seen: new Date(Date.now() - 5 * 60000).toISOString() }).eq('session_id', session.id).eq('user_id', userId);
  if (session.kind === 'privat' && session.owner_id === userId && req.body?.end) {
    await supa.from('live_sessions').update({ status: 'incheiata', ends_at: new Date().toISOString() }).eq('id', session.id);
  }
  return res.status(200).json({ ok: true });
}

// ═════════════════════════════════════════════════════════════════════════════
// ADMIN
// ═════════════════════════════════════════════════════════════════════════════
async function requireAdminUser(req, supa) {
  const { userId, profile } = await who(req, supa);
  if (!profile?.is_admin) throw fail(403, 'Doar administratorii.');
  return { userId, profile };
}

async function adminOverview(req, res, supa) {
  await requireAdminUser(req, supa);
  const day = L.parseDayKey(req.body?.day) ? req.body.day : L.dayKey();
  const sessions = await assignSubjects(supa, await ensureDay(supa, day));
  const ids = sessions.map((s) => s.id);
  const [present, titles, lessons] = await Promise.all([presentCounts(supa, ids), subjectTitles(supa, sessions.map((s) => s.subject_id)), lessonStatusFor(supa, sessions, { detail: true })]);
  const { data: parts } = ids.length ? await supa.from('live_participants').select('session_id').in('session_id', ids).limit(10000) : { data: [] };
  const total = {};
  for (const p of parts || []) total[p.session_id] = (total[p.session_id] || 0) + 1;
  const [en, bac] = await Promise.all([eligibleSubjects(supa, { exam: 'en', fresh: !!req.body?.fresh }), eligibleSubjects(supa, { exam: 'bac', fresh: !!req.body?.fresh })]);
  const { data: lessonRows } = await supa.from('live_lessons').select('id, subject_id, teacher, version, status, title, duration_sec, error, cost_micro, updated_at, noVoice:progress->noVoice, sv:script->v, pasi:script->pasi, pasiInfo:progress->pasi').order('updated_at', { ascending: false }).limit(60);
  const free = await freeAdminView(supa, { fresh: !!req.body?.fresh });
  const freeSet = new Set(free.lessons.map((l) => String(l.subjectId).toLowerCase()));
  const slotInfo = Object.fromEntries(L.slots().map((s) => [s.id, s]));
  return res.status(200).json({
    day, teachers: L.teachers().map(L.publicTeacher), slots: L.slots(), intervals: L.intervals(),
    rooms: L.rooms().map((r) => ({ ...r, subjects: (r.exam === 'en' ? en : bac.filter((x) => x.profile === r.profile)).length })),
    sessions: sessions.map((s) => ({
      id: s.id, slot: s.slot, label: slotInfo[s.slot]?.label || s.slot, room: roomOf(slotInfo[s.slot]),
      teacher: s.teacher, exam: s.exam, profile: s.profile, examLabel: L.EXAM_LABEL(s.exam, s.profile),
      subject: s.subject_id ? { id: s.subject_id, title: titles[s.subject_id] || '?' } : null,
      lesson: s.subject_id ? (lessons[`${s.subject_id}|${s.teacher}`] || 'nou') : null,
      phase: L.phaseOf(s), status: s.status, present: present[s.id] || 0, participants: total[s.id] || 0, note: s.admin_note || null,
    })),
    subjects: { en, bac },
    lessons: (lessonRows || []).map((l) => ({ ...l, cost_lei: Math.round((l.cost_micro || 0) / 1e4) / 100, free: freeSet.has(String(l.subject_id).toLowerCase()) })),
    free,
    tts: tts.provider(),
  });
}

// ─── Meditațiile gratuite (Admin → „🎁 Meditațiile gratuite") ────────────────
// lista de acum + toate lecțiile gata (una pe subiect), din care adminul alege
async function freeAdminView(supa, { fresh = false } = {}) {
  const f = await freeLessons(supa, { fresh });
  const { data: readyRows } = await supa.from('live_lessons').select(FREE_LIGHT).eq('status', 'gata').order('updated_at', { ascending: false }).limit(2000);
  const ready = new Map();
  for (const l of readyRows || []) if (!ready.has(String(l.subject_id).toLowerCase())) ready.set(String(l.subject_id).toLowerCase(), l);
  const ids = [...new Set([...f.ids, ...ready.keys()])];
  const rows = [];
  for (let i = 0; i < ids.length; i += 150) {
    const { data } = await supa.from('content').select('id, title, category, subcategory, profile, file_url').in('id', ids.slice(i, i + 150));
    rows.push(...(data || []));
  }
  const byId = new Map(rows.map((r) => [String(r.id).toLowerCase(), r]));
  const describe = (id) => {
    const c = byId.get(id);
    const l = ready.get(id);
    const se = c ? L.subjectExam(c, B) : (l ? { exam: l.exam, profile: l.profile } : null);
    return {
      subjectId: c ? c.id : (l ? l.subject_id : id), title: (c && c.title) || (l && l.title) || 'Subiect șters',
      exam: se?.exam || null, profile: se?.profile || null, examLabel: se ? L.EXAM_LABEL(se.exam, se.profile) : '—',
      ready: !!l, missing: !c,
    };
  };
  const byExam = (a, b) => (a.exam === b.exam ? 0 : a.exam === 'en' ? -1 : 1) || String(a.examLabel).localeCompare(String(b.examLabel), 'ro')
    || String(b.title).localeCompare(String(a.title), 'ro', { numeric: true });
  return {
    setup: f.setup, auto: f.auto, max: L.FREE_MAX, defaultCount: L.FREE_DEFAULT_COUNT,
    monthly: L.FREE_MONTHLY(), answers: L.FREE_ANSWERS(),
    lessons: f.ids.map(describe),
    ready: [...ready.keys()].map(describe).filter((x) => !x.missing && x.exam).sort(byExam)
      .map((x) => ({ ...x, free: f.set.has(String(x.subjectId).toLowerCase()) })),
  };
}

async function adminSetFree(req, res, supa) {
  const { userId } = await requireAdminUser(req, supa);
  const raw = Array.isArray(req.body?.subjectIds) ? req.body.subjectIds : null;
  if (!raw) throw fail(400, 'subjectIds (listă) obligatoriu.');
  if (raw.length > L.FREE_MAX) throw fail(400, `Cel mult ${L.FREE_MAX} meditații gratuite deodată.`);
  const ids = L.normalizeFreeIds(raw);
  if (ids.length) {
    const { data: rows } = await supa.from('content').select('id, title, category, subcategory, profile, file_url').in('id', ids);
    const ok = new Set((rows || []).filter((r) => L.subjectExam(r, B) && !B.isBaremRow(r)).map((r) => String(r.id).toLowerCase()));
    if (ids.some((id) => !ok.has(id))) throw fail(400, 'Unele lecții nu (mai) sunt subiecte de Evaluare Națională / Bacalaureat. Reîncarcă pagina.');
  }
  await SET.writeSetting(supa, FREE_KEY, { subjects: ids, auto: false, at: new Date().toISOString(), by: userId }, userId);
  freeCache = null;
  return res.status(200).json({ ok: true, free: await freeAdminView(supa, { fresh: true }) });
}

async function adminSetSubject(req, res, supa) {
  await requireAdminUser(req, supa);
  const session = await loadSession(supa, req.body?.sessionId);
  let patch = {};
  // doar când se cere schimbarea subiectului (nota sau anularea nu îl ating)
  if (Object.prototype.hasOwnProperty.call(req.body || {}, 'subjectId')) {
    const subjectId = req.body.subjectId || null;
    patch = { subject_id: subjectId, state: {}, lesson_id: null };
    if (subjectId) {
      const { data: content } = await supa.from('content').select('id, title, category, subcategory, profile, file_url').eq('id', subjectId).maybeSingle();
      const se = content && L.subjectExam(content, B);
      if (!se) throw fail(400, 'Subiect invalid.');
      const room = session.kind === 'grup' ? L.slotById(session.slot) : null;
      if (room && (se.exam !== room.exam || (room.profile && se.profile !== room.profile))) {
        throw fail(400, `Subiectul nu e pentru sala „${room.roomLabel}".`);
      }
      patch = { ...patch, exam: room ? room.exam : se.exam, profile: room ? room.profile : (se.profile || null) };
    }
  }
  if (req.body?.note !== undefined) patch.admin_note = String(req.body.note || '').slice(0, 300) || null;
  if (req.body?.cancel === true) patch.status = 'anulata';
  if (req.body?.cancel === false) patch.status = 'programata';
  if (!Object.keys(patch).length) return res.status(200).json({ ok: true, session });
  const { data, error } = await supa.from('live_sessions').update(patch).eq('id', session.id).select('*').maybeSingle();
  dbCheck(error, 'ședința');
  broadcast(session.id, 'session', { changed: true }).catch(() => {});
  return res.status(200).json({ ok: true, session: data });
}

async function adminPrepare(req, res, supa) {
  await requireAdminUser(req, supa);
  let lessonId = req.body?.lessonId || null;
  if (!lessonId) {
    const subjectId = req.body?.subjectId;
    const teacher = L.teacherById(req.body?.teacher);
    if (!subjectId || !teacher) throw fail(400, 'subjectId + teacher obligatorii.');
    if (req.body?.regenerate) {
      const cur = await lessonFor(supa, subjectId, teacher.id, { create: false });
      const { data: ins, error } = await supa.from('live_lessons').insert({ subject_id: subjectId, teacher: teacher.id, version: (cur?.version || 0) + 1, status: 'nou' }).select('id').maybeSingle();
      dbCheck(error, 'lecția');
      lessonId = ins.id;
    } else {
      lessonId = (await lessonFor(supa, subjectId, teacher.id)).id;
    }
  }
  // întrebările pe pași: doar când nicio ședință de grup cu lecția aceasta nu e în curs
  let steps = !!req.body?.steps;
  if (steps) {
    const { data: lrow } = await supa.from('live_lessons').select('subject_id, teacher').eq('id', lessonId).maybeSingle();
    if (lrow && await groupBusy(supa, lrow.subject_id, lrow.teacher)) throw fail(409, 'O ședință de grup cu această lecție e în curs sau începe imediat — completează întrebările pe pași după ea.');
  }
  const r = await prepareLesson(supa, lessonId, {
    revoice: !!req.body?.revoice, steps, forceSteps: steps && !!req.body?.force,
    budgetMs: Math.min(600000, Math.max(30000, Number(req.body?.budgetMs) || 240000)),
  });
  return res.status(200).json({ lesson: r });
}

async function adminLesson(req, res, supa) {
  await requireAdminUser(req, supa);
  const lesson = await loadLesson(supa, req.body?.lessonId, { fresh: true });
  if (!lesson) throw fail(404, 'Lecția nu există.');
  const tl = lesson.script ? L.buildTimeline(lesson.script, lesson.progress?.audio || {}, { mode: 'grup' }) : null;
  return res.status(200).json({
    lesson: { ...lessonView({ ...lesson, total: lesson.progress?.total, done: lesson.progress?.done }), script: lesson.script, duration: tl?.duration || null, cost_lei: Math.round((lesson.cost_micro || 0) / 1e4) / 100 },
  });
}

// ═════════════════════════════════════════════════════════════════════════════
// CRON (la 15 minute): programul, subiectele, lecțiile următoarelor ore,
// asocierea subiect ↔ barem pentru materialele fără cache
// ═════════════════════════════════════════════════════════════════════════════
async function cron(supa) {
  const t0 = Date.now();
  const budget = parseInt(process.env.LIVE_CRON_MS || '600000', 10);
  const now = new Date();
  const report = { sessions: 0, prepared: [], warmed: 0, closed: 0, errors: [] };
  const today = L.dayKey(now);
  const sessions = [];
  for (const d of [today, L.addDays(today, 1)]) sessions.push(...await assignSubjects(supa, await ensureDay(supa, d), now));
  report.sessions = sessions.length;

  // lecțiile pentru ședințele din următoarele LIVE_PREGATIRE_ORE ore (implicit 4).
  // ECONOMIC (implicit): o lecție NOUĂ se scrie abia când cineva arată interes —
  // a cumpărat bilet sau a intrat în sala de așteptare (se deschide cu 15 minute
  // înainte; sala cere singură pregătirea). Fără elevi, fără cost.
  // LIVE_PREGATIRE_AUTO=1 → toate se pregătesc din timp, ca înainte.
  const auto = /^(1|da|true|yes)$/i.test(String(process.env.LIVE_PREGATIRE_AUTO || '').trim());
  const horizon = now.getTime() + parseFloat(process.env.LIVE_PREGATIRE_ORE || '4') * 3600000;
  const soon = sessions.filter((s) => s.subject_id && s.status !== 'anulata' && new Date(s.starts_at).getTime() <= horizon && new Date(s.ends_at).getTime() > now.getTime())
    .sort((a, b) => new Date(a.starts_at) - new Date(b.starts_at));
  const liveNow = new Set(sessions.filter((s) => L.phaseOf(s, now) === 'live').map((s) => `${s.subject_id}|${s.teacher}`));
  report.skipped = 0;
  for (const s of soon) {
    if (Date.now() - t0 > budget - 60000) break;
    try {
      const l = await lessonFor(supa, s.subject_id, s.teacher);
      const startsIn = new Date(s.starts_at).getTime() - now.getTime();
      const busy = liveNow.has(`${s.subject_id}|${s.teacher}`);
      // vocea generată pentru o lecție făcută fără chei TTS — doar înainte de ședință
      const revoice = l.status === 'gata' && l.noVoice === true && !!tts.provider() && startsIn > 45 * 60000 && !busy;
      // întrebările pe pași pentru o lecție scrisă înainte de ele — tot doar înainte de ședință
      const steps = lessonLacksSteps(l) && startsIn > 10 * 60000 && !busy;
      if (l.status === 'gata' && !revoice && !steps) continue;
      if (!auto && !revoice && (steps || l.status === 'nou' || (l.status === 'eroare' && !l.title))) {
        const [{ count: people }, { count: tickets }] = await Promise.all([
          supa.from('live_participants').select('*', { count: 'exact', head: true }).eq('session_id', s.id),
          supa.from('live_tickets').select('*', { count: 'exact', head: true }).eq('session_id', s.id).eq('status', 'platit'),
        ]);
        if (!(people || 0) && !(tickets || 0)) { report.skipped++; continue; }
      }
      const r = await prepareLesson(supa, l.id, { revoice, steps, budgetMs: Math.max(30000, budget - (Date.now() - t0) - 60000) });
      report.prepared.push({ session: s.id, lesson: l.id, status: r.status, done: r.done, total: r.total, revoice, steps });
    } catch (e) { report.errors.push(`${s.id}: ${e.message}`); }
  }

  // asocierea subiect ↔ barem pentru materialele EN/BAC încă necitite (câteva pe rulare);
  // întâi cele pentru sălile care nu au încă niciun subiect cu barem (ex. BAC Tehnologic)
  try {
    if (Date.now() - t0 < budget - 90000) {
      const { data: rows } = await supa.from('content').select('id, title, category, subcategory, profile, file_url, created_at')
        .in('category', ['evaluare-nationala', 'bacalaureat']).eq('content_type', 'pdf').order('created_at', { ascending: false }).limit(3000);
      const subj = (rows || []).filter((r) => r.file_url && !B.isBaremRow(r));
      const have = new Set();
      for (let i = 0; i < subj.length; i += 200) {
        const { data: cached } = await supa.from('ai_pdf_text').select('content_id').in('content_id', subj.slice(i, i + 200).map((r) => r.id));
        for (const c of cached || []) have.add(c.content_id);
      }
      const empty = [];
      for (const r of L.rooms()) if (!(await eligibleSubjects(supa, { exam: r.exam, profile: r.profile })).length) empty.push(r);
      report.emptyRooms = empty.map((r) => r.id);
      const forEmpty = (row) => { const se = L.subjectExam(row, B); return !!se && empty.some((r) => r.exam === se.exam && (!r.profile || r.profile === se.profile)); };
      const todo = subj.filter((r) => !have.has(r.id))
        .sort((a, b) => Number(forEmpty(b)) - Number(forEmpty(a)))
        .slice(0, parseInt(process.env.LIVE_CRON_BAREME || '4', 10));
      if (todo.length) {
        const { data: full } = await supa.from('content').select('*').in('id', todo.map((r) => r.id));
        const byId = new Map((full || []).map((r) => [r.id, r]));
        for (const t of todo) {
          if (Date.now() - t0 > budget - 60000) break;
          const c = byId.get(t.id);
          if (!c) continue;
          try { await pdfContext().getPdfContext(supa, c); report.warmed++; } catch (e) { report.errors.push(`barem ${c.id}: ${e.message}`); }
        }
      }
      if (report.warmed) eligibleCache.clear();
    }
  } catch (e) { report.errors.push(`bareme: ${e.message}`); }

  // ședințele trecute → încheiate
  const { data: closed } = await supa.from('live_sessions').update({ status: 'incheiata' })
    .lt('ends_at', now.toISOString()).in('status', ['programata', 'activa']).select('id');
  report.closed = (closed || []).length;
  report.ms = Date.now() - t0;
  return report;
}

// ═════════════════════════════════════════════════════════════════════════════
// PREGĂTIRE DE EXAMEN („Planul meu", ca o meditație live) — logica în
// api/_lib/pregatire.js. Exercițiile de pe fiecare poziție vin din lecțiile pe
// barem ale meditațiilor live (aceleași subiecte oficiale, același profesor);
// o lecție lipsă se scrie o singură dată (doar textul — vocea e a browserului)
// și se refolosește la toți elevii și la ședințele live. Progresul stă în
// ai_meditatii_sessions (chapter „pregatire:<examen>", payload.prep).
// ═════════════════════════════════════════════════════════════════════════════
const P = require('./_lib/pregatire');
const PREP_TEACHER = () => (L.teacherById('radu') ? 'radu' : L.teachers()[0].id);
const PREP_ROWS = 'id, status, score, max_score, duration_sec, created_at, completed_at, prep:payload->prep';
const PREP_GEN_MAX = () => Math.max(0, parseInt(process.env.PREP_GENERARI_ZI || '12', 10) || 0);  // lecții noi scrise pentru un elev, pe zi
const scriptReady = (l) => !!l && ['script', 'audio', 'gata'].includes(l.status);
const cap1 = (s) => (s ? s.charAt(0).toLocaleUpperCase('ro') + s.slice(1).toLocaleLowerCase('ro') : s);

async function prepWho(req, supa) {
  const { userId, profile } = await who(req, supa);
  if (!ai.isPremium(profile)) throw fail(402, 'Pregătirea de examen face parte din abonament (meditațiile cu Profesorul Virtual).', 'PREMIUM_REQUIRED');
  const { data: med, error } = await supa.from('ai_meditatii_profile').select('user_id, grade, exam_target').eq('user_id', userId).maybeSingle();
  if (error && !isMissingTable(error)) throw fail(500, `profilul de meditații: ${error.message}`);
  const E = P.examOf(med?.exam_target);
  if (!E) throw fail(409, 'Alege întâi examenul (Evaluarea Națională sau profilul de BAC) în „Planul meu".', 'PREP_NO_EXAM');
  const first = String(profile.full_name || '').trim().split(/\s+/)[0].replace(/[^\p{L}'-]/gu, '');
  return { userId, profile, E, name: first ? cap1(first).slice(0, 20) : null };
}

async function prepRows(supa, userId, target) {
  const { data, error } = await supa.from('ai_meditatii_sessions').select(PREP_ROWS)
    .eq('user_id', userId).eq('chapter', P.chapterOf(target)).order('created_at', { ascending: false }).limit(500);
  if (error) throw fail(500, `progresul: ${error.message}`);
  return data || [];
}

async function prepRow(supa, userId, rowId) {
  if (!rowId) throw fail(400, 'Lipsește exercițiul.');
  const { data, error } = await supa.from('ai_meditatii_sessions').select('id, user_id, status, score, max_score, duration_sec, payload, created_at')
    .eq('id', String(rowId)).eq('user_id', userId).maybeSingle();
  if (error) throw fail(500, error.message);
  if (!data || !data.payload?.prep) throw fail(404, 'Exercițiul nu mai există. Reîncarcă pagina.');
  return data;
}

// lecțiile noi scrise azi pentru acest elev (plafonul PREP_GENERARI_ZI)
function gensToday(rows) {
  const since = L.dayKey();
  return (rows || []).reduce((n, r) => n + (r.prep?.gen || []).filter((t) => L.dayKey(new Date(t)) === since).length, 0);
}

// Subiectele cu barem ale examenului elevului + lecția lor (dacă a fost scrisă)
async function prepPool(supa, E) {
  const subjects = await eligibleSubjects(supa, { exam: E.exam, profile: E.profile });
  const teacher = PREP_TEACHER();
  const lessons = new Map();
  const ids = subjects.map((s) => s.id);
  for (let i = 0; i < ids.length; i += 150) {
    const { data } = await supa.from('live_lessons').select(LIGHT).eq('teacher', teacher).in('subject_id', ids.slice(i, i + 150)).order('version', { ascending: false });
    for (const r of data || []) if (!lessons.has(r.subject_id)) lessons.set(r.subject_id, r);
  }
  return subjects.map((s) => ({ ...s, full: L.isFullSubject(s.title), lesson: lessons.get(s.id) || null }));
}

// Lecția (doar textul) unui subiect: gata → o întoarce; altfel o scrie acum (1–3
// minute); dacă altcineva o scrie chiar acum, o așteaptă (nu se plătește de două ori)
async function prepEnsureScript(supa, subjectId, { waitMs = 170000 } = {}) {
  const teacher = PREP_TEACHER();
  let l = await lessonFor(supa, subjectId, teacher);
  if (scriptReady(l)) return l;
  if (l.status === 'eroare' && !l.title) return null;
  const r = await prepareLesson(supa, l.id, { scriptOnly: true, budgetMs: 20000 });
  if (r?.busy) {
    const t0 = Date.now();
    while (Date.now() - t0 < waitMs) {
      await new Promise((ok) => setTimeout(ok, 3000));
      l = await lessonFor(supa, subjectId, teacher, { create: false });
      if (scriptReady(l)) return l;
      if (!l || l.status === 'eroare') return null;
    }
    return null;
  }
  l = await lessonFor(supa, subjectId, teacher, { create: false });
  return scriptReady(l) ? l : null;
}

// Următorul exercițiu de pe poziție, dintr-un subiect nelucrat: întâi din lecțiile
// deja scrise; dacă nu mai e niciunul (și plafonul zilei permite), scrie lecția unui subiect nou.
async function prepPick(supa, E, { pos, exclude = new Set(), seed, generate = true, needPolls = false }) {
  const pool = await prepPool(supa, E);
  const ordered = P.orderSubjects(pool.filter((s) => !exclude.has(s.id)), seed);
  const usable = (items) => items.length && (!needPolls || items.some((it) => P.hasPolls(it)));
  for (const s of ordered.filter((x) => scriptReady(x.lesson))) {
    const lesson = await loadLesson(supa, s.lesson.id);
    const items = P.itemsAt(lesson?.script, pos);
    if (usable(items)) return { sid: s.id, title: s.title, lesson, items };
  }
  if (!generate) return null;
  for (const s of ordered.filter((x) => !x.lesson || x.lesson.status === 'nou').slice(0, 3)) {
    const l = await prepEnsureScript(supa, s.id);
    if (!l) continue;
    const lesson = await loadLesson(supa, l.id, { fresh: true });
    const items = P.itemsAt(lesson?.script, pos);
    if (usable(items)) return { sid: s.id, title: s.title, lesson, items, generated: true };
  }
  return null;
}

// exercițiul unui subiect anume (reluarea unui exercițiu început)
async function prepExerciseOf(supa, sid, pos) {
  const light = await lessonFor(supa, sid, PREP_TEACHER(), { create: false });
  if (!scriptReady(light)) return null;
  const lesson = await loadLesson(supa, light.id);
  const items = P.itemsAt(lesson?.script, pos);
  if (!items.length) return null;
  const { data: c } = await supa.from('content').select('id, title').eq('id', sid).maybeSingle();
  return { sid, title: c?.title || lesson.title || 'Subiect', lesson, items };
}

// blocul de lucru deschis pe poziție (ultimele 8 ore) — acolo se adaugă exercițiile
const openBlock = (rows, pos) => (rows || []).find((r) => r.prep?.mode === 'antrenament' && r.prep.pos === pos
  && Date.now() - new Date(r.created_at).getTime() < 8 * 3600 * 1000) || null;

async function prepState(req, res, supa) {
  const { userId, E, name } = await prepWho(req, supa);
  const rows = await prepRows(supa, userId, E.target);
  const prog = P.progressFrom(rows, E.exam);
  const proposal = P.proposeWelcome({ exam: E.exam, target: E.target, prog, name });
  return res.status(200).json({
    exam: { target: E.target, exam: E.exam, profile: E.profile, label: E.label },
    positions: P.publicProgress(E.exam, prog), current: proposal.pos, proposal,
    settings: P.settings(), teacher: L.publicTeacher(L.teacherById(PREP_TEACHER())), me: { name },
    now: new Date().toISOString(),
  });
}

async function prepExercise(req, res, supa) {
  const { userId, E } = await prepWho(req, supa);
  const pos = P.positionOf(E.exam, String(req.body?.pos || ''));
  if (!pos) throw fail(400, 'Exercițiu necunoscut.');
  const rows = await prepRows(supa, userId, E.target);
  const prog = P.progressFrom(rows, E.exam);
  const st = prog.byPos[pos.pos];
  const block = openBlock(rows, pos.pos);
  // un exercițiu început și neterminat (pagină închisă, reîncărcată) se reia
  const pending = (block?.prep?.ex || []).find((e) => !e.done && !st.used.includes(e.sid)) || null;
  const exclude = new Set(st.used);
  const skip = typeof req.body?.skip === 'string' ? req.body.skip : null;   // „alt exercițiu" (nu pe acesta)
  if (skip) exclude.add(skip);
  let pick = pending && pending.sid !== skip ? await prepExerciseOf(supa, pending.sid, pos.pos) : null;
  let genRow = null;
  if (!pick) {
    pick = await prepPick(supa, E, { pos: pos.pos, exclude, seed: `${userId}|${pos.pos}`, generate: gensToday(rows) < PREP_GEN_MAX() });
    if (pick?.generated) genRow = new Date().toISOString();
  }
  if (!pick) {
    return res.status(200).json({ exhausted: true, proposal: P.proposeExhausted({ exam: E.exam, pos: pos.pos, prog }), positions: P.publicProgress(E.exam, prog) });
  }
  const now = new Date().toISOString();
  const entry = { sid: pick.sid, title: pick.title, refs: pick.items.map((it) => it.ref), polls: {}, done: false, at: now };
  let rowId;
  if (block) {
    const cur = await prepRow(supa, userId, block.id);
    const prep = cur.payload.prep;
    const ex = (prep.ex || []).filter((e) => e.done || e.sid === entry.sid);
    const old = ex.find((e) => !e.done && e.sid === entry.sid);
    if (old) old.at = now; else ex.push(entry);
    const gen = genRow ? [...(prep.gen || []), genRow] : (prep.gen || []);
    const { error } = await supa.from('ai_meditatii_sessions').update({ payload: { ...cur.payload, prep: { ...prep, ex, gen } } }).eq('id', cur.id);
    if (error) throw fail(500, error.message);
    rowId = cur.id;
  } else {
    const prep = { v: 1, mode: 'antrenament', pos: pos.pos, exam: E.exam, profile: E.profile, ex: [entry], gen: genRow ? [genRow] : [] };
    const { data, error } = await supa.from('ai_meditatii_sessions').insert({
      user_id: userId, kind: 'exercitii', chapter: P.chapterOf(E.target), topic: `Pregătire de examen · ${pos.label}`,
      difficulty: E.label, status: 'activa', payload: { prep },
    }).select('id').maybeSingle();
    if (error) throw fail(500, error.message);
    rowId = data.id;
  }
  const n = st.done + 1;
  return res.status(200).json({
    rowId,
    exercise: { sid: pick.sid, title: pick.title, pos: pos.pos, label: pos.label, short: pos.short, n, target: st.nextTestAt, refs: entry.refs, mastered: st.mastered },
    timeline: P.exerciseTimeline({ items: pick.items, sid: pick.sid, n, title: pick.title }),
    generated: !!pick.generated,
  });
}

// Cât lucrează elevul la un exercițiu, următorul se pregătește din timp (o lecție
// nouă se scrie în 1–3 minute): la „Următorul exercițiu" e deja gata.
async function prepPrefetch(req, res, supa) {
  const { userId, E } = await prepWho(req, supa);
  const pos = P.positionOf(E.exam, String(req.body?.pos || ''));
  if (!pos) throw fail(400, 'Exercițiu necunoscut.');
  const rows = await prepRows(supa, userId, E.target);
  const st = P.progressFrom(rows, E.exam).byPos[pos.pos];
  const exclude = new Set(st.used);
  if (typeof req.body?.current === 'string') exclude.add(req.body.current);
  const ready = await prepPick(supa, E, { pos: pos.pos, exclude, seed: `${userId}|${pos.pos}`, generate: false });
  if (ready) {
    // exercițiul următor (Subiectele II și III), dintr-o lecție scrisă înainte de întrebările
    // pe pași: le completează acum, cât elevul lucrează (o singură dată pe subiect)
    const light = ready.lesson;
    if (/^II/.test(pos.pos) && light && lessonLacksSteps({ status: light.status, pasi: light.script?.pasi })
      && !(await groupBusy(supa, light.subject_id, light.teacher))) {
      await prepareLesson(supa, light.id, { steps: true, scriptOnly: true, budgetMs: 90000 }).catch(() => {});
    }
    return res.status(200).json({ ready: true });
  }
  if (gensToday(rows) >= PREP_GEN_MAX()) return res.status(200).json({ ready: false, capped: true });
  const pick = await prepPick(supa, E, { pos: pos.pos, exclude, seed: `${userId}|${pos.pos}`, generate: true });
  if (pick?.generated) {
    const block = openBlock(rows, pos.pos);
    if (block) {
      const cur = await prepRow(supa, userId, block.id);
      const prep = cur.payload.prep;
      await supa.from('ai_meditatii_sessions').update({ payload: { ...cur.payload, prep: { ...prep, gen: [...(prep.gen || []), new Date().toISOString()] } } }).eq('id', cur.id);
    }
  }
  return res.status(200).json({ ready: !!pick, generated: !!pick?.generated });
}

async function prepAnswer(req, res, supa) {
  const { userId } = await prepWho(req, supa);
  const row = await prepRow(supa, userId, req.body?.rowId);
  const pollId = String(req.body?.pollId || '').slice(0, 90);
  const answer = String(req.body?.answer ?? '').trim().slice(0, 80);
  if (!pollId || !answer) throw fail(400, 'Răspuns gol.');
  const prep = row.payload.prep;
  const isTest = prep.mode === 'test';
  if (isTest && prep.finished) throw fail(409, 'Testul s-a încheiat.');
  const { ns, id } = P.splitNs(pollId);
  const sid = (isTest ? (prep.items || []) : (prep.ex || [])).map((e) => e.sid).find((s) => P.nsOf(s) === ns);
  if (!sid) throw fail(404, 'Întrebare necunoscută.');
  const light = await lessonFor(supa, sid, PREP_TEACHER(), { create: false });
  const lesson = light ? await loadLesson(supa, light.id) : null;
  const key = pollKeys(lesson?.script)[id];
  if (!key) throw fail(404, 'Întrebare necunoscută.');
  const correct = answer === '?' ? false : !!L.checkPollAnswer(key, answer, mathcheck.answersEquivalent);
  if (isTest) {
    prep.answers = { ...(prep.answers || {}), [pollId]: { answer, correct } };
  } else {
    const e = [...(prep.ex || [])].reverse().find((x) => x.sid === sid);
    if (e) e.polls = { ...(e.polls || {}), [pollId]: { answer, correct } };
  }
  const { error } = await supa.from('ai_meditatii_sessions').update({ payload: { ...row.payload, prep } }).eq('id', row.id);
  if (error) throw fail(500, error.message);
  // la test nu se spune nimic până la final
  if (isTest) return res.status(200).json({ ok: true, answered: Object.keys(prep.answers).length });
  const poll = pollOf(lesson.script, id);
  return res.status(200).json({ ok: true, correct, answer: key.answer, explain: poll?.explain || null });
}

async function prepDone(req, res, supa) {
  const { userId, E } = await prepWho(req, supa);
  const row = await prepRow(supa, userId, req.body?.rowId);
  const prep = row.payload.prep;
  if (prep.mode !== 'antrenament') throw fail(400, 'Nu e un exercițiu de antrenament.');
  const sid = String(req.body?.sid || '');
  const e = [...(prep.ex || [])].reverse().find((x) => x.sid === sid);
  if (!e) throw fail(404, 'Exercițiul nu mai există.');
  const secs = Math.max(0, Math.min(3600, parseInt(req.body?.seconds || 0, 10) || 0));
  const now = new Date().toISOString();
  if (!e.done) { e.done = true; e.secs = secs; e.doneAt = now; }
  const polls = Object.values(e.polls || {});
  const result = { correct: polls.filter((x) => x.correct).length, total: polls.length };
  const doneEx = (prep.ex || []).filter((x) => x.done);
  const all = doneEx.flatMap((x) => Object.values(x.polls || {}));
  const pos = P.positionOf(E.exam, prep.pos);
  const { error } = await supa.from('ai_meditatii_sessions').update({
    payload: { ...row.payload, prep }, status: 'finalizata', completed_at: now,
    score: all.filter((x) => x.correct).length, max_score: all.length, duration_sec: (row.duration_sec || 0) + secs,
    topic: `Pregătire de examen · ${pos ? pos.label : prep.pos} (${doneEx.length} ${doneEx.length === 1 ? 'exercițiu' : 'exerciții'})`,
  }).eq('id', row.id);
  if (error) throw fail(500, error.message);
  const prog = P.progressFrom(await prepRows(supa, userId, E.target), E.exam);
  return res.status(200).json({
    result, positions: P.publicProgress(E.exam, prog),
    proposal: P.proposeAfterExercise({ exam: E.exam, pos: prep.pos, prog, result }),
  });
}

async function prepTest(req, res, supa) {
  const { userId, E } = await prepWho(req, supa);
  const pos = P.positionOf(E.exam, String(req.body?.pos || ''));
  if (!pos) throw fail(400, 'Exercițiu necunoscut.');
  const rows = await prepRows(supa, userId, E.target);
  const st = P.progressFrom(rows, E.exam).byPos[pos.pos];
  const N = P.testSize(pos);
  const seed = `${userId}|${pos.pos}|test${st.tests}`;
  const picked = [];
  const taken = new Set();
  const take = (p) => { if (p && !taken.has(p.sid)) { taken.add(p.sid); picked.push(p); } };
  // întâi exerciții NOI (nelucrate nici la antrenament, nici la testele trecute)
  const used = new Set(st.used);
  let gens = gensToday(rows);
  const genAt = [];
  while (picked.length < N) {
    const p = await prepPick(supa, E, { pos: pos.pos, exclude: new Set([...used, ...taken]), seed, generate: gens < PREP_GEN_MAX() && genAt.length < 2, needPolls: true });
    if (!p) break;
    if (p.generated) { gens++; genAt.push(new Date().toISOString()); }
    take(p);
  }
  // prea puține noi → completăm cu cele lucrate (întâi cele de demult)
  if (picked.length < N) {
    const pool = await prepPool(supa, E);
    for (const s of P.orderSubjects(pool.filter((x) => used.has(x.id) && scriptReady(x.lesson)), seed)) {
      if (picked.length >= N) break;
      const lesson = await loadLesson(supa, s.lesson.id);
      const items = P.itemsAt(lesson?.script, pos.pos);
      if (items.some((it) => P.hasPolls(it))) take({ sid: s.id, title: s.title, items });
    }
  }
  if (!picked.length) throw fail(409, 'Nu am încă exerciții cu întrebări pentru un test la această poziție. Mai lucrează câteva exerciții și încearcă din nou.', 'PREP_NO_TEST');
  const items = picked.map((p) => ({
    sid: p.sid, title: p.title, refs: p.items.map((it) => it.ref),
    polls: P.testPollsOf(p.items, p.sid).map((q) => q.id),
  }));
  const prep = { v: 1, mode: 'test', pos: pos.pos, exam: E.exam, profile: E.profile, doneBefore: st.done, items, answers: {}, gen: genAt };
  const { data, error } = await supa.from('ai_meditatii_sessions').insert({
    user_id: userId, kind: 'exercitii', chapter: P.chapterOf(E.target), topic: `Test de verificare · ${pos.label}`,
    difficulty: E.label, status: 'activa', payload: { prep },
  }).select('id').maybeSingle();
  if (error) throw fail(500, error.message);
  const nQ = items.reduce((k, it) => k + it.polls.length, 0);
  const words = picked.length === 1 ? 'un exercițiu' : `${picked.length} exerciții`;
  return res.status(200).json({
    rowId: data.id,
    test: { pos: pos.pos, label: pos.label, short: pos.short, exercises: picked.length, questions: nQ },
    timeline: P.testTimeline(picked, { introSay: `Testul de verificare la ${pos.spoken}: ${words}, fără ajutor. Rezolvă pe foaie și alege răspunsul. Nu îți spun nimic până la final.` }),
  });
}

async function prepTestFinish(req, res, supa) {
  const { userId, E } = await prepWho(req, supa);
  const row = await prepRow(supa, userId, req.body?.rowId);
  const prep = row.payload.prep;
  if (prep.mode !== 'test') throw fail(400, 'Nu e un test.');
  const secs = Math.max(0, Math.min(7200, parseInt(req.body?.seconds || 0, 10) || 0));
  const g = P.gradeTest(prep);
  if (!prep.finished) {
    prep.finished = true;
    prep.result = { correct: g.correct, total: g.total, passed: g.passed };
    const { error } = await supa.from('ai_meditatii_sessions').update({
      payload: { ...row.payload, prep }, status: 'finalizata', completed_at: new Date().toISOString(),
      score: g.correct, max_score: g.total, duration_sec: (row.duration_sec || 0) + secs,
    }).eq('id', row.id);
    if (error) throw fail(500, error.message);
  }
  const prog = P.progressFrom(await prepRows(supa, userId, E.target), E.exam);
  const result = { correct: g.correct, total: g.total, passed: g.passed, pct: g.total ? Math.round((100 * g.correct) / g.total) : 0 };
  // explicațiile exercițiilor greșite (pe barem), dacă elevul le cere
  const wrong = [];
  for (const sid of g.wrongSids) {
    const ex = await prepExerciseOf(supa, sid, prep.pos);
    if (ex) wrong.push(ex);
  }
  const review = wrong.length ? P.reviewTimeline(wrong, { introSay: wrong.length === 1 ? 'Hai să vedem pe barem exercițiul la care ai greșit.' : 'Hai să vedem pe barem exercițiile la care ai greșit.' }) : null;
  return res.status(200).json({
    result, review, positions: P.publicProgress(E.exam, prog),
    proposal: P.proposeAfterTest({ exam: E.exam, pos: prep.pos, result, prog }),
  });
}

// Întrebare către profesor în timpul pregătirii (răspuns cu voce + pe tablă)
async function prepChat(req, res, supa) {
  const { userId, profile, E, name } = await prepWho(req, supa);
  await ai.enforceRateLimit(supa, userId, profile);
  const { text, flagged } = L.moderate(req.body?.text || '');
  if (!text) throw fail(400, 'Mesajul e gol.');
  const teacher = L.teacherById(PREP_TEACHER()) || L.teachers()[0];
  const sys = (t) => ({ id: -Date.now(), author: 'ExamenMate', role: 'sistem', text: t, at: new Date().toISOString() });
  if (flagged) return res.status(200).json({ answer: sys('Hai să rămânem la matematică — întreabă-mă despre exercițiul de pe tablă.') });
  const sid = typeof req.body?.sid === 'string' ? req.body.sid : null;
  const ref = typeof req.body?.ref === 'string' ? req.body.ref.slice(0, 20) : null;
  let lesson = null, itemIndex = null, title = null;
  if (sid && ref) {
    const ex = await prepExerciseOf(supa, sid, ref.split('.').slice(0, 2).join('.'));
    const it = ex?.items.find((x) => x.ref === ref) || ex?.items[0] || null;
    if (it) { lesson = { script: { title: ex.title, exam: E.exam, profile: E.profile, items: [it] } }; itemIndex = 0; title = ex.title; }
  }
  const pos = P.positionOf(E.exam, String(req.body?.pos || ''));
  const history = (Array.isArray(req.body?.history) ? req.body.history : []).slice(-6)
    .map((m) => ({ role: m && m.role === 'profesor' ? 'assistant' : 'user', content: String(m?.text || '').slice(0, 800) }))
    .filter((m) => m.content);
  const context = [
    `Pregătire de examen 1-la-1 pentru ${E.label}${pos ? `, la ${pos.label}` : ''}: elevul lucrează, pe rând, exercițiile de pe această poziție din subiectele oficiale, explicate DOAR pe baza baremului.`,
    title ? `Exercițiul de acum e din „${title}".` : '',
  ].filter(Boolean).join(' ');
  const a = await teacherAnswer(supa, {
    session: { teacher: teacher.id, kind: 'privat' }, lesson, question: text, author: name || 'Elevul', itemIndex,
    history, userId, privat: true, context, usageKey: 'pregatire-chat',
  });
  return res.status(200).json({
    answer: { id: Date.now(), author: a.teacher.name, role: 'profesor', text: a.text, say: a.say, board: a.board, at: new Date().toISOString() },
  });
}

// ═════════════════════════════════════════════════════════════════════════════
const ACTIONS = {
  program, join, prepare, timeline, heartbeat, chat, messages,
  poll_answer: pollAnswer, poll_results: pollResultsAction,
  private_subjects: privateSubjects, private_start: privateStart, private_begin: privateBegin, private_state: privateState,
  extend,
  leave,
  admin_overview: adminOverview, admin_set_subject: adminSetSubject, admin_prepare: adminPrepare, admin_lesson: adminLesson,
  admin_set_free: adminSetFree,
  // Pregătirea de examen („Planul meu")
  prep_state: prepState, prep_exercise: prepExercise, prep_prefetch: prepPrefetch, prep_answer: prepAnswer,
  prep_done: prepDone, prep_test: prepTest, prep_test_finish: prepTestFinish, prep_chat: prepChat,
};

module.exports = async function handler(req, res) {
  ai.applyCors(res);
  if (req.method === 'OPTIONS') return res.status(204).end();
  const supa = ai.admin();
  if (req.method === 'GET') {
    if (req.query?.action === 'cron' && ai.isCronRequest(req)) {
      try { return res.status(200).json(await cron(supa)); }
      catch (e) { console.error('live cron:', e); return res.status(e.status || 500).json({ error: e.message }); }
    }
    return res.status(405).json({ error: 'Method Not Allowed' });
  }
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method Not Allowed' });
  try {
    const fn = ACTIONS[req.body?.action];
    if (!fn) return res.status(400).json({ error: 'action invalid' });
    return await fn(req, res, supa);
  } catch (err) {
    if (!err.status || err.status >= 500) console.error('live error:', err);
    return res.status(err.status || 500).json({ error: err.message || 'Eroare server', code: err.code || null });
  }
};

// pentru teste
module.exports._internals = { computeTimeline, compactState, pollKeys, itemContext, ensureGroupClock, prepareLesson, cron, broadcast, msgView,
  resetCaches: () => { eligibleCache.clear(); lessonCache.clear(); freeCache = null; },
  resetFree: () => { freeCache = null; } };
