// =====================================================================
// api/_lib/live.js — MEDITAȚII LIVE: logica pură (fără rețea, fără DB)
//
// Sala de tip Zoom/Meet cu profesorul virtual:
//   · ședințe de GRUP zilnice, la aceeași oră (implicit 17–19), câte una în
//     fiecare sală: Evaluarea Națională, BAC Mate-Info, BAC Științele Naturii,
//     BAC Tehnologic — oricâți elevi, 10 lei ședința sau incluse în abonament;
//   · ședințe 1-la-1 pornite ORICÂND, de 60 de minute — 20 lei sau incluse
//     în abonament (8 pe lună; peste, 20 lei);
//   · profesorul explică DOAR subiecte de EN/BAC cu barem asociat
//     („fără barem nu explică nimic"), în mai multe moduri, pe baza lui.
//
// Tot ce e aici e determinist și testat în test/meditatii-live.test.js:
// programul pe ora României, alegerea subiectului, drepturile de acces,
// moderarea chatului, construirea cronologiei (scenele sincronizate pentru
// toți participanții) și „mișcarea gurii" calculată din vocea generată.
// =====================================================================
const crypto = require('node:crypto');

const TZ = 'Europe/Bucharest';
const envInt = (k, d) => { const v = parseInt(process.env[k] || '', 10); return Number.isFinite(v) ? v : d; };
const envNum = (k, d) => { const v = parseFloat(process.env[k] || ''); return Number.isFinite(v) ? v : d; };

// ─── Prețuri și reguli (schimbabile din env, fără cod) ───────────────────────
const PRICE_GROUP_LEI = () => envNum('LIVE_PRICE_GRUP_LEI', 10);
const PRICE_PRIVATE_LEI = () => envNum('LIVE_PRICE_PRIVAT_LEI', 20);
const PRIVATE_INCLUDED = () => Math.max(0, envInt('LIVE_PRIVAT_INCLUSE', 8));   // pe lună, pentru abonați
const PRIVATE_MINUTES = () => Math.max(10, envInt('LIVE_PRIVAT_MINUTE', 60));
const JOIN_EARLY_MIN = () => Math.max(0, envInt('LIVE_INTRARE_DEVREME_MIN', 15)); // sala de așteptare

// ═════════════════════════════════════════════════════════════════════════════
// 1. PROFESORUL VIRTUAL
// Un singur profesor (bărbat), cu portretul animat din public/live/radu/.
// Numele, prezentarea și vocea se pot schimba din env (LIVE_PROF_RADU_NUME,
// ..._BIO, ..._VOCE_OPENAI, ..._VOCE_AZURE). Mecanismul acceptă și alți profesori
// (LIVE_PROFESORI="radu,altul" + public/live/altul/), dar implicit e unul singur.
// Pe ecran poartă mereu eticheta „Profesor virtual · AI".
// ═════════════════════════════════════════════════════════════════════════════
const TEACHER_DEFAULTS = {
  radu: {
    id: 'radu', name: 'Prof. Radu', gender: 'm', color: '#1f6dab',
    bio: 'Profesor de matematică. Explică pe barem, pas cu pas, cu calm și cu multe verificări.',
    voice: { openai: 'ash', azure: 'ro-RO-EmilNeural' },
    style: 'Vorbești calm, cald și clar, ca un profesor de liceu cu experiență care își cunoaște elevii. Folosești exemple scurte și verifici des dacă s-a înțeles.',
  },
};

function teachers() {
  const ids = String(process.env.LIVE_PROFESORI || 'radu').split(',').map((s) => s.trim().toLowerCase()).filter(Boolean);
  const out = [];
  for (const id of ids) {
    const base = TEACHER_DEFAULTS[id] || { id, name: `Prof. ${id[0].toUpperCase()}${id.slice(1)}`, gender: 'm', color: '#1f6dab', bio: '', voice: { openai: 'ash', azure: 'ro-RO-EmilNeural' }, style: TEACHER_DEFAULTS.radu.style };
    const U = id.toUpperCase();
    out.push({
      ...base,
      name: process.env[`LIVE_PROF_${U}_NUME`] || base.name,
      bio: process.env[`LIVE_PROF_${U}_BIO`] || base.bio,
      voice: {
        openai: process.env[`LIVE_PROF_${U}_VOCE_OPENAI`] || base.voice.openai,
        azure: process.env[`LIVE_PROF_${U}_VOCE_AZURE`] || base.voice.azure,
      },
    });
  }
  return out.length ? out : [TEACHER_DEFAULTS.radu];
}
const teacherById = (id) => teachers().find((t) => t.id === id) || null;
// profesorul public (fără stilul din prompt)
const publicTeacher = (t) => t && ({ id: t.id, name: t.name, gender: t.gender, color: t.color, bio: t.bio });

// ═════════════════════════════════════════════════════════════════════════════
// 2. TIMPUL — ora României (UTC+2 iarna, UTC+3 vara)
// ═════════════════════════════════════════════════════════════════════════════
function roParts(d) {
  const p = Object.fromEntries(
    new Intl.DateTimeFormat('en-US', {
      timeZone: TZ, hour12: false,
      year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', second: '2-digit', weekday: 'short',
    }).formatToParts(d).map((x) => [x.type, x.value])
  );
  return { y: +p.year, m: +p.month, d: +p.day, hh: +p.hour % 24, mm: +p.minute, ss: +p.second, wd: p.weekday };
}
function roOffsetMs(d) {
  const p = roParts(d);
  return Date.UTC(p.y, p.m - 1, p.d, p.hh, p.mm, p.ss) - Math.floor(d.getTime() / 1000) * 1000;
}
// instantul UTC al orei locale (România) „Y-M-D hh:mm"
function roTime(y, m, d, hh = 0, mm = 0) {
  const naive = Date.UTC(y, m - 1, d, hh, mm, 0);
  let off = roOffsetMs(new Date(naive));
  off = roOffsetMs(new Date(naive - off));
  return new Date(naive - off);
}
const pad2 = (n) => String(n).padStart(2, '0');
// „2026-09-23" — ziua din România pentru un instant
function dayKey(now = new Date()) {
  const p = roParts(now);
  return `${p.y}-${pad2(p.m)}-${pad2(p.d)}`;
}
function parseDayKey(key) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(key || ''));
  if (!m) return null;
  return { y: +m[1], m: +m[2], d: +m[3] };
}
function addDays(key, n) {
  const p = parseDayKey(key);
  const t = new Date(Date.UTC(p.y, p.m - 1, p.d + n));
  return `${t.getUTCFullYear()}-${pad2(t.getUTCMonth() + 1)}-${pad2(t.getUTCDate())}`;
}
// numărul zilei (pentru rotații deterministe): zile de la 1970-01-01
function dayNumber(key) {
  const p = parseDayKey(key);
  return Math.floor(Date.UTC(p.y, p.m - 1, p.d) / 86400000);
}
// începutul lunii curente (România), ISO — pentru plafonul de 1-la-1 incluse
function monthStart(now = new Date()) {
  const p = roParts(now);
  return roTime(p.y, p.m, 1, 0, 0).toISOString();
}

// ═════════════════════════════════════════════════════════════════════════════
// 3. PROGRAMUL — în fiecare zi, la aceeași oră, câte o ședință în fiecare SALĂ:
//    o sală = un examen (EN, BAC Mate-Info, BAC Științele Naturii, BAC Tehnologic).
//    LIVE_INTERVALE="17-19"  (ora României; mai multe intervale: "17-19,19-21")
//    LIVE_SALI="en,mate-info,stiinte-naturii,tehnologic"  (implicit toate patru)
// Id-ul unei ședințe în zi = intervalul + sala: „17-en", „17-mi", „17-sn", „17-teh"
// (unic pe zi și profesor — vezi live_sessions_slot_uq).
// ═════════════════════════════════════════════════════════════════════════════
function intervals() {
  const raw = String(process.env.LIVE_INTERVALE || '17-19');
  const out = [];
  for (const part of raw.split(',')) {
    const m = /^\s*(\d{1,2})(?::(\d{2}))?\s*-\s*(\d{1,2})(?::(\d{2}))?\s*$/.exec(part);
    if (!m) continue;
    const sh = +m[1], sm = +(m[2] || 0), eh = +m[3], em = +(m[4] || 0);
    if (sh > 23 || sm > 59 || em > 59 || eh > 24 || eh * 60 + em <= sh * 60 + sm) continue;
    const id = sm ? `${sh}${pad2(sm)}` : String(sh);
    if (out.some((x) => x.id === id)) continue;
    out.push({ id, start: [sh, sm], end: [eh, em], label: `${pad2(sh)}:${pad2(sm)}–${pad2(eh)}:${pad2(em)}` });
  }
  return out.length ? out : [{ id: '17', start: [17, 0], end: [19, 0], label: '17:00–19:00' }];
}

// Sălile posibile (profilurile de BAC ca în restul site-ului: src/lib/contentMeta.js)
const ROOMS = [
  { id: 'en', exam: 'en', profile: null, label: 'Evaluarea Națională', short: 'EN', keys: ['en', 'evaluare', 'evaluare-nationala', 'evaluarea-nationala'] },
  { id: 'mi', exam: 'bac', profile: 'mate-info', label: 'BAC Mate-Info', short: 'BAC Mate-Info', keys: ['mi', 'mate-info', 'bac-mate-info', 'm1'] },
  { id: 'sn', exam: 'bac', profile: 'stiinte-naturii', label: 'BAC Științele Naturii', short: 'BAC Șt. Naturii', keys: ['sn', 'stiinte', 'stiinte-naturii', 'bac-stiinte', 'bac-stiinte-naturii'] },
  { id: 'teh', exam: 'bac', profile: 'tehnologic', label: 'BAC Tehnologic', short: 'BAC Tehnologic', keys: ['teh', 'tehnologic', 'bac-tehnologic'] },
];
const DEFAULT_ROOMS = 'en,mate-info,stiinte-naturii,tehnologic';

function parseRooms(raw) {
  const out = [];
  for (const part of String(raw || '').split(',')) {
    const k = foldRo(part).trim().replace(/[\s_]+/g, '-');
    const r = ROOMS.find((x) => x.keys.includes(k));
    if (r && !out.includes(r)) out.push(r);
  }
  return out;
}
function rooms() {
  let list = parseRooms(process.env.LIVE_SALI || DEFAULT_ROOMS);
  if (!list.length) list = parseRooms(DEFAULT_ROOMS);
  return list.map((r, i) => ({ id: r.id, n: i + 1, exam: r.exam, profile: r.profile, label: r.label, short: r.short }));
}
const roomById = (id) => rooms().find((r) => r.id === id) || null;

// Ședințele de grup ale unei zile: fiecare interval × fiecare sală
function slots() {
  const out = [];
  for (const iv of intervals()) {
    for (const r of rooms()) {
      out.push({ id: `${iv.id}-${r.id}`, interval: iv.id, room: r.id, roomN: r.n, roomLabel: r.label, roomShort: r.short,
        exam: r.exam, profile: r.profile, start: iv.start, end: iv.end, label: iv.label });
    }
  }
  return out;
}
const slotById = (id) => slots().find((s) => s.id === String(id)) || null;

function slotTimes(key, slot) {
  const p = parseDayKey(key);
  return {
    startsAt: roTime(p.y, p.m, p.d, slot.start[0], slot.start[1]).toISOString(),
    endsAt: roTime(p.y, p.m, p.d, slot.end[0], slot.end[1]).toISOString(),
  };
}

// Numele programelor oficiale de BAC (pentru modelul care scrie lecția)
const PROFILE_LABELS = {
  'mate-info': 'M_mate-info', 'stiinte-naturii': 'M_șt-nat', tehnologic: 'M_tehnologic',
};

// Ce se predă într-o ședință: examenul sălii (același în fiecare zi)
function examFor(key, slotId) {
  const s = slotById(slotId);
  return s ? { exam: s.exam, profile: s.profile } : { exam: 'en', profile: null };
}

// Ședințele de grup ale unei zile (fără DB) — ce ar trebui să existe.
function plannedSessions(key, teacherList = teachers()) {
  const out = [];
  for (const s of slots()) {
    const times = slotTimes(key, s);
    for (const t of teacherList) {
      out.push({ kind: 'grup', day: key, slot: s.id, teacher: t.id, exam: s.exam, profile: s.profile, starts_at: times.startsAt, ends_at: times.endsAt });
    }
  }
  return out;
}

// Faza unei ședințe la momentul `now`:
//   viitoare → sala_asteptare (cu JOIN_EARLY_MIN minute înainte) → live → incheiata
function phaseOf(session, now = new Date()) {
  if (!session) return 'necunoscuta';
  if (session.status === 'anulata') return 'anulata';
  const t = now.getTime();
  const s = new Date(session.starts_at).getTime();
  const e = new Date(session.ends_at).getTime();
  if (t >= e || session.status === 'incheiata') return 'incheiata';
  if (t >= s) return 'live';
  if (t >= s - JOIN_EARLY_MIN() * 60000) return 'sala_asteptare';
  return 'viitoare';
}
const canJoinPhase = (ph) => ph === 'live' || ph === 'sala_asteptare';

// ═════════════════════════════════════════════════════════════════════════════
// 4. SUBIECTELE — doar cele cu BAREM asociat
// ═════════════════════════════════════════════════════════════════════════════
// Stările din ai_pdf_text (vezi api/ai-pdf-context.js) care înseamnă „are barem
// potrivit sigur". 'este_barem' = materialul ESTE un barem (nu un subiect).
const BAREM_OK = new Set(['ok', 'ok_antet', 'ok_continut', 'inclus', 'ok_admin']);
const hasBarem = (row) => !!row && BAREM_OK.has(row.barem_status) && String(row.barem_text || '').trim().length >= 80;

// exam + profil al unui material din `content` (barem.js le citește din titlu,
// din numele fișierului și din coloana `profile`)
function subjectExam(content, B) {
  if (!content) return null;
  if (content.category === 'evaluare-nationala') return { exam: 'en', profile: null };
  if (content.category === 'bacalaureat') return { exam: 'bac', profile: (B && B.profileOf(content)) || null };
  return null;
}

// Alegerea subiectului pentru o ședință de grup (deterministă):
//   1. subiectele cu lecție DEJA pregătită pentru acest profesor, nefolosite în
//      ultimele LIVE_REFOLOSIRE_ZILE zile (fără cost nou de generare);
//   2. subiecte noi (niciodată predate de acest profesor);
//   3. cel mai demult folosit.
// `candidates` = [{ id, title, ready: bool, lastUsed: ISO|null }]
// `preferFull`: dacă există subiecte COMPLETE (variante, modele, simulări), se
// aleg doar dintre ele — o ședință de grup de 2 ore pe o fișă de 6 exerciții s-ar
// termina după 40 de minute.
function pickSubject(candidates, { seed = '', now = new Date(), reuseDays = envInt('LIVE_REFOLOSIRE_ZILE', 21), exclude = [], preferFull = false } = {}) {
  let list = (candidates || []).filter((c) => c && c.id && !exclude.includes(c.id));
  if (!list.length) return null;
  if (preferFull && list.some((c) => c.full)) list = list.filter((c) => c.full);
  const h = (id) => crypto.createHash('sha1').update(String(seed) + ':' + id).digest().readUInt32BE(0);
  const cutoff = now.getTime() - reuseDays * 86400000;
  const fresh = (c) => !c.lastUsed || new Date(c.lastUsed).getTime() < cutoff;
  const byHash = (a, b) => h(a.id) - h(b.id);
  const ready = list.filter((c) => c.ready && fresh(c)).sort(byHash);
  if (ready.length) return ready[0];
  const never = list.filter((c) => !c.lastUsed).sort(byHash);
  if (never.length) return never[0];
  return list.slice().sort((a, b) => new Date(a.lastUsed).getTime() - new Date(b.lastUsed).getTime() || byHash(a, b))[0];
}

// Subiect COMPLET de examen (variantă / model / simulare, cu toate subiectele),
// nu o fișă tematică („Subiectul I, ex. 5: radicali"), după titlu.
function isFullSubject(title) {
  const t = foldRo(title).replace(/[–—]/g, '-');
  if (/\bsubiectul\s+(i{1,3}|al\s+(ii|iii|doilea|treilea)(-lea)?)\b\s*[,.:-]?\s*(ex|exercitiul|item(ul)?|problema)\b/.test(t)) return false;
  if (/\b(ex|exercitiul|problema|itemul)\s*\.?\s*\d/.test(t)) return false;
  if (/\b(varianta|variante|model(ul)?|simulare|simularea|antrenament|sesiunea|rezerva|speciala|examen(ul)?)\b/.test(t)) return true;
  return /\b(19|20)\d{2}\b/.test(t);
}

// ═════════════════════════════════════════════════════════════════════════════
// 5. DREPTURILE DE ACCES
// ═════════════════════════════════════════════════════════════════════════════
const isAdminP = (p) => p?.is_admin === true;
const isSubscribedP = (p) => p?.subscription_status === 'active';

// Ședință de GRUP: admin / abonament → gratuit; altfel bilet de 10 lei.
function groupAccess({ profile, ticket = null }) {
  if (isAdminP(profile)) return { ok: true, via: 'admin', price: 0 };
  if (isSubscribedP(profile)) return { ok: true, via: 'abonament', price: 0 };
  if (ticket && ticket.status !== 'rambursat') return { ok: true, via: 'bilet', price: 0 };
  return { ok: false, via: null, price: PRICE_GROUP_LEI() };
}

// Ședință 1-la-1: admin → gratuit; abonat → primele N din lună incluse; apoi
// (sau fără abonament) un bilet de 20 lei neconsumat.
function privateAccess({ profile, includedUsed = 0, unusedTickets = 0 }) {
  const included = PRIVATE_INCLUDED();
  if (isAdminP(profile)) return { ok: true, via: 'admin', price: 0, included, includedLeft: included };
  const sub = isSubscribedP(profile);
  const left = sub ? Math.max(0, included - includedUsed) : 0;
  if (left > 0) return { ok: true, via: 'inclus', price: 0, included, includedLeft: left };
  if (unusedTickets > 0) return { ok: true, via: 'bilet', price: 0, included: sub ? included : 0, includedLeft: 0 };
  return { ok: false, via: null, price: PRICE_PRIVATE_LEI(), included: sub ? included : 0, includedLeft: 0 };
}

// ═════════════════════════════════════════════════════════════════════════════
// 6. NUMELE AFIȘAT ȘI MODERAREA CHATULUI (elevii sunt, de regulă, minori)
// ═════════════════════════════════════════════════════════════════════════════
// „Andrei Mihai Popescu" → „Andrei P." — prenumele + inițiala, nimic în plus.
function displayName(fullName, userId = '') {
  const parts = String(fullName || '').replace(/[^\p{L}\s'-]/gu, ' ').trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return `Elev ${String(userId).replace(/-/g, '').slice(0, 4).toUpperCase() || ''}`.trim();
  const first = parts[0].slice(0, 20);
  const cap = (s) => s.charAt(0).toLocaleUpperCase('ro') + s.slice(1).toLocaleLowerCase('ro');
  if (parts.length === 1) return cap(first);
  return `${cap(first)} ${parts[parts.length - 1].charAt(0).toLocaleUpperCase('ro')}.`;
}

// Cuvinte care nu au ce căuta într-o clasă (listă scurtă, fără diacritice).
const BAD_WORDS = ['pula', 'pizda', 'muie', 'futu', 'fut', 'cacat', 'dracu', 'idiot', 'idiota', 'prost', 'proasta', 'bou', 'handicapat', 'retardat', 'curva', 'jeg', 'fraier', 'sugi'];
const foldRo = (s) => String(s || '').toLowerCase().replace(/[ăâ]/g, 'a').replace(/î/g, 'i').replace(/[șş]/g, 's').replace(/[țţ]/g, 't');

// Curăță un mesaj de elev înainte să-l vadă ceilalți: fără linkuri, emailuri,
// numere de telefon (date personale) și fără înjurături. { text, flagged }
function moderate(raw, { max = 300 } = {}) {
  let t = String(raw || '').replace(/[\u0000-\u0008\u000b-\u001f\u007f]/g, '').replace(/\s+/g, ' ').trim().slice(0, max);
  let flagged = false;
  const hide = (re, rep) => { t = t.replace(re, () => { flagged = true; return rep; }); };
  hide(/\b(?:https?:\/\/|www\.)\S+/gi, '[link ascuns]');
  hide(/\b[\w.+-]+@[\w-]+\.[\w.]+\b/g, '[email ascuns]');
  hide(/(?:\+?4?0|\b0)[\s.-]?7\d{2}[\s.-]?\d{3}[\s.-]?\d{3}\b/g, '[telefon ascuns]');
  hide(/\b(?:instagram|insta|tiktok|snap(?:chat)?|whatsapp|discord)\s*[:@]?\s*@?[\w.]{3,}/gi, '[cont ascuns]');
  const words = t.split(/(\s+)/);
  for (let i = 0; i < words.length; i++) {
    const f = foldRo(words[i]).replace(/[^a-z]/g, '');
    if (f && BAD_WORDS.some((b) => f === b || (b.length >= 4 && f.startsWith(b)))) { words[i] = '***'; flagged = true; }
  }
  t = words.join('').trim();
  return { text: t, flagged };
}

// E o întrebare pentru profesor? (în grup profesorul răspunde doar la întrebări)
function isQuestion(text) {
  const t = foldRo(text).trim();
  if (!t) return false;
  if (t.includes('?')) return true;
  return /^(de ce|cum|cand|care|cat|ce |unde|poti|puteti|se poate|nu inteleg|nu am inteles|n-am inteles|explica|explicati|domnule profesor|doamna profesoara|profesor|prof)/.test(t);
}

// ═════════════════════════════════════════════════════════════════════════════
// 7. RĂSPUNSURILE LA ÎNTREBĂRILE PROFESORULUI (grilă / de completat)
// ═════════════════════════════════════════════════════════════════════════════
// poll = { id, type: 'grila'|'completare', options?: [..], answer: 'b' | '24' }
// `equiv(a, b)` = echivalența matematică (mathcheck.answersEquivalent)
function checkPollAnswer(poll, answer, equiv = null) {
  if (!poll) return null;
  const a = String(answer ?? '').trim();
  if (!a) return false;
  if (poll.type === 'grila') {
    const letter = (/^\s*([a-d])\s*\)?\s*$/i.exec(a) || [])[1];
    return !!letter && letter.toLowerCase() === String(poll.answer || '').trim().toLowerCase().replace(/\)$/, '');
  }
  const exp = String(poll.answer ?? '').trim();
  if (!exp) return null;
  const alts = [exp, ...(Array.isArray(poll.accept) ? poll.accept : [])];
  for (const e of alts) {
    if (typeof equiv === 'function') {
      try { if (equiv(a, e)) return true; } catch { /* mai jos */ }
    }
    if (foldRo(a).replace(/\s+/g, '') === foldRo(e).replace(/\s+/g, '')) return true;
  }
  return false;
}

// Rezultatele agregate: { total, correct, byOption: {a: 3, b: 7}, pct: {...} }
function pollResults(poll, answers) {
  const byOption = {};
  let correct = 0, total = 0;
  for (const r of answers || []) {
    total++;
    if (r.correct) correct++;
    if (poll?.type === 'grila') {
      const k = String(r.answer || '').trim().toLowerCase().replace(/\)$/, '');
      byOption[k] = (byOption[k] || 0) + 1;
    }
  }
  const pct = {};
  for (const [k, v] of Object.entries(byOption)) pct[k] = total ? Math.round((v / total) * 100) : 0;
  return { total, correct, correctPct: total ? Math.round((correct / total) * 100) : 0, byOption, pct };
}

// ═════════════════════════════════════════════════════════════════════════════
// 8. CRONOLOGIA — scenele pe care le văd TOȚI participanții în același timp
//
// Lecția (scriptul) are itemi; fiecare item are „moduri" de explicare
// (pe barem, intuitiv, greșeli frecvente, altă metodă), fiecare mod = segmente
// de vorbire cu rândurile scrise pe tablă în timpul lor. Vocea fiecărui segment
// are o durată exactă (măsurată la generare), deci cronologia e exactă.
//
// Tipuri de scene: intro · item (enunțul) · sondaj · rezultate · explicatie ·
// verificare · intrebari (profesorul răspunde la chat) · pauza · final.
// ═════════════════════════════════════════════════════════════════════════════
const GAP = 0.45;              // pauza naturală dintre două segmente de vorbire (s)
const POLL_GRILA_SEC = () => envInt('LIVE_SONDAJ_GRILA_SEC', 45);
const POLL_COMPLETARE_SEC = () => envInt('LIVE_SONDAJ_COMPLETARE_SEC', 60);
const POLL_VERIFICARE_SEC = () => envInt('LIVE_SONDAJ_VERIFICARE_SEC', 35);
const RESULTS_SEC = 7;
const QNA_SEC = () => envInt('LIVE_INTREBARI_SEC', 180);
const BREAK_SEC = () => envInt('LIVE_PAUZA_SEC', 300);

// durata unui segment de vorbire: din audio (măsurată) sau estimată din text
// (~2,6 cuvinte/s în română, vorbire de profesor), ca rezervă fără voce
function segDuration(seg, audio) {
  const a = audio && audio[seg.id];
  if (a && a.dur > 0) return a.dur;
  // fără fișier audio vorbește vocea browserului: ~2,4 cuvinte pe secundă + o marjă
  // pentru pornire (aceeași estimare ca în src/lib/live/player.js)
  const words = String(seg.say || '').split(/\s+/).filter(Boolean).length;
  return Math.max(1.5, words / 2.4 + 0.5);
}

// Construiește scenele unui set de segmente, cu offseturi relative la scenă.
function packSegments(segments, audio) {
  let t = 0;
  const out = [];
  for (const seg of segments || []) {
    if (!seg || !String(seg.say || '').trim()) continue;
    const dur = segDuration(seg, audio);
    const a = (audio && audio[seg.id]) || {};
    out.push({
      id: seg.id, t, dur: Math.round(dur * 1000) / 1000,
      say: seg.say, caption: seg.caption || seg.say,
      board: Array.isArray(seg.board) ? seg.board : [],
      audio: a.url || null, lip: a.lip || null,
    });
    t += dur + GAP;
  }
  return { segs: out, dur: out.length ? t - GAP : 0 };
}

// ordinea modurilor alternative (după „pe barem")
const ALT_MODES = ['intuitiv', 'greseli', 'alta_metoda'];
const MODE_LABELS = {
  barem: 'Pe barem, pas cu pas', intuitiv: 'Pe înțelesul tuturor', greseli: 'Greșeli care costă puncte', alta_metoda: 'Altă metodă (se punctează la fel)',
};

// `script` (vezi _lib/liveLesson.js): { title, intro:[seg], outro:[seg],
//   items: [{ ref, section, title, statement, options, kind, answer, points,
//             intro:[seg], tryPoll, afterTry:[seg], modes:{barem:[seg], ...},
//             check, video }] , qna:[seg], breakSay:[seg] }
// `audio` = { [segId]: { url, dur, lip } }
// opts.mode = 'grup' | 'privat'; opts.targetSec = durata-țintă (grup)
function buildTimeline(script, audio = {}, opts = {}) {
  const mode = opts.mode || 'grup';
  const scenes = [];
  let t = 0;
  const r3 = (x) => Math.round(x * 1000) / 1000;
  const push = (sc) => { sc.t0 = r3(t); sc.dur = r3(sc.dur); scenes.push(sc); t = r3(sc.t0 + sc.dur); };
  const segScene = (type, segments, extra = {}) => {
    const p = packSegments(segments, audio);
    if (!p.segs.length && !extra.minDur) return null;
    return { type, dur: Math.max(p.dur, extra.minDur || 0) + (p.segs.length ? 0.8 : 0), segs: p.segs, ...extra };
  };
  const dropAlt = new Set(opts.dropAlt || []);   // itemii fără al doilea mod (pentru încadrarea în timp)
  const maxItems = Number.isFinite(opts.maxItems) ? opts.maxItems : Infinity;

  const intro = segScene('intro', script.intro);
  if (intro) push(intro);

  const items = (script.items || []).slice(0, maxItems);
  let lastSection = null;
  const half = Math.floor(items.length / 2);
  items.forEach((it, i) => {
    // întrebări la schimbarea subiectului (după Subiectul I, după al II-lea)
    if (mode === 'grup' && lastSection && it.section !== lastSection && opts.qna !== false) {
      const q = segScene('intrebari', script.qna, { minDur: opts.qnaSec ?? QNA_SEC(), section: lastSection });
      if (q) push(q);
    }
    // pauza de la jumătatea ședinței de grup (2 ore, ca la o meditație reală)
    if (mode === 'grup' && i === half && items.length >= 8 && opts.pause !== false) {
      const b = segScene('pauza', script.breakSay, { minDur: opts.breakSec ?? BREAK_SEC() });
      if (b) push(b);
    }
    lastSection = it.section;
    const common = { item: i, ref: it.ref, section: it.section, title: it.title };
    // 1) enunțul (pe tabla digitală) + ce spune profesorul la început
    const head = segScene('item', it.intro, { ...common, statement: it.statement, options: it.options || null, points: it.points || null, minDur: 2 });
    if (head) push(head);
    // 2) „încercați singuri" (grilă sau rezultat) — sondajul ÎNAINTE de explicație
    if (it.tryPoll) {
      const secs = it.tryPoll.type === 'grila' ? POLL_GRILA_SEC() : POLL_COMPLETARE_SEC();
      push({ type: 'sondaj', ...common, poll: publicPoll(it.tryPoll), dur: mode === 'privat' ? 0 : secs, wait: mode === 'privat' });
      const res = segScene('rezultate', it.afterTry, { ...common, poll: publicPoll(it.tryPoll, true), minDur: RESULTS_SEC });
      if (res) push(res);
    }
    // 3) explicația pe barem (obligatorie)
    const main = segScene('explicatie', it.modes?.barem, { ...common, mode: 'barem', label: MODE_LABELS.barem });
    if (main) push(main);
    // 4) al doilea mod (grup: unul singur, alternativ; 1-la-1: la cerere)
    if (mode === 'grup' && !dropAlt.has(i)) {
      const avail = ALT_MODES.filter((m) => Array.isArray(it.modes?.[m]) && it.modes[m].length);
      const pick = avail.length ? avail[i % avail.length] : null;
      if (pick) {
        const alt = segScene('explicatie', it.modes[pick], { ...common, mode: pick, label: MODE_LABELS[pick] });
        if (alt) push(alt);
      }
    }
    if (mode === 'privat') {
      // „Ai înțeles?" — cu celelalte moduri gata de rostit la „Explică altfel"
      const alts = ALT_MODES.filter((m) => Array.isArray(it.modes?.[m]) && it.modes[m].length).map((m) => {
        const p = packSegments(it.modes[m], audio);
        return { mode: m, label: MODE_LABELS[m], segs: p.segs, dur: Math.round((p.dur + 0.8) * 1000) / 1000 };
      }).filter((a) => a.segs.length);
      push({ type: 'intrebare_intelegere', ...common, dur: 0, wait: true, modes: alts.map((a) => a.mode), alts });
    }
    // 5) verificarea (pentru itemii cu rezolvare, fără sondaj la început)
    if (it.check) {
      push({ type: 'sondaj', ...common, poll: publicPoll(it.check), dur: mode === 'privat' ? 0 : POLL_VERIFICARE_SEC(), wait: mode === 'privat', verificare: true });
      const res = segScene('rezultate', it.afterCheck || [], { ...common, poll: publicPoll(it.check, true), minDur: RESULTS_SEC });
      if (res) push(res);
    }
    // 6) video pe tabla digitală (dacă subiectul are rezolvare video în site)
    if (it.video && it.video.url && mode === 'grup' && Number(it.video.sec) > 0) {
      push({ type: 'video', ...common, video: it.video, dur: Math.min(600, Number(it.video.sec)) });
    }
  });
  if (mode === 'grup' && opts.qna !== false && items.length) {
    const q = segScene('intrebari', script.qna, { minDur: opts.qnaSec ?? QNA_SEC(), section: lastSection, last: true });
    if (q) push(q);
  }
  const outro = segScene('final', script.outro);
  if (outro) push(outro);
  return { scenes, duration: Math.round(t) };
}

// sondajul fără răspunsul corect (pentru browser, cât timp e deschis);
// `reveal` = true doar pentru scena de rezultate
function publicPoll(poll, reveal = false) {
  if (!poll) return null;
  const p = { id: poll.id, type: poll.type, question: poll.question, options: poll.options || null, unit: poll.unit || null };
  if (reveal) { p.answer = poll.answer; p.explain = poll.explain || null; }
  return p;
}

// Încadrarea ședinței de grup în intervalul orar (implicit 2 ore − 5 minute).
// Pe rând: fără al doilea mod la itemii scurți (grilele), apoi la toți, apoi
// întrebări mai scurte, apoi mai puțini itemi (restul rămân „temă", cu baremul).
// Dacă lecția e mai scurtă, sesiunile de întrebări cresc până la țintă.
function fitTimeline(script, audio, targetSec) {
  const items = script.items || [];
  const shortIdx = items.map((it, i) => (it.tryPoll ? i : -1)).filter((i) => i >= 0);
  const allIdx = items.map((_, i) => i);
  const attempts = [
    {},
    { dropAlt: shortIdx },
    { dropAlt: allIdx },
    { dropAlt: allIdx, qnaSec: 90, breakSec: 180 },
  ];
  let best = null;
  for (const a of attempts) {
    const tl = buildTimeline(script, audio, { mode: 'grup', ...a });
    best = { tl, opts: a };
    if (tl.duration <= targetSec) break;
  }
  // tot prea lung → mai puțini itemi
  let n = items.length;
  while (best.tl.duration > targetSec && n > 1) {
    n--;
    const tl = buildTimeline(script, audio, { mode: 'grup', ...best.opts, maxItems: n });
    best = { tl, opts: { ...best.opts, maxItems: n } };
  }
  // prea scurtă → întrebările cresc (profesorul răspunde la chat), dar nu la infinit
  if (best.tl.duration < targetSec - 60) {
    const qnaCount = best.tl.scenes.filter((s) => s.type === 'intrebari').length || 1;
    const extra = Math.floor((targetSec - best.tl.duration) / qnaCount);
    const base = best.opts.qnaSec ?? QNA_SEC();
    const qnaSec = Math.min(base + extra, 20 * 60);
    const tl = buildTimeline(script, audio, { mode: 'grup', ...best.opts, qnaSec });
    best = { tl, opts: { ...best.opts, qnaSec } };
  }
  const covered = Math.min(items.length, best.opts.maxItems ?? items.length);
  return { ...best.tl, covered, total: items.length, fit: best.opts };
}

// Unde suntem în cronologie la secunda `pos`: { index, scene, offset }
function sceneAt(timeline, pos) {
  const sc = (timeline && timeline.scenes) || [];
  if (!sc.length) return { index: -1, scene: null, offset: 0 };
  if (pos <= 0) return { index: 0, scene: sc[0], offset: Math.max(0, pos) };
  for (let i = 0; i < sc.length; i++) {
    const s = sc[i];
    if (pos < s.t0 + s.dur || i === sc.length - 1) return { index: i, scene: s, offset: Math.max(0, pos - s.t0) };
  }
  return { index: sc.length - 1, scene: sc[sc.length - 1], offset: 0 };
}

// Coada vocii la întrebările din chat (grup): răspunsurile profesorului se
// rostesc în scenele „intrebari", în ordinea mesajelor. Programarea e
// DETERMINISTĂ — fiecare browser o calculează la fel, deci toți aud același
// răspuns în același moment, fără stare pe server.
// msgs = [{ id, createdSec (offset față de începutul ședinței), dur }]
// windows = [{ t0, t1 }] — ferestrele de întrebări
function qnaSchedule(msgs, windows) {
  const out = [];
  const ws = (windows || []).slice().sort((a, b) => a.t0 - b.t0);
  const queue = (msgs || []).filter((m) => m && m.dur > 0).slice().sort((a, b) => a.id - b.id);
  let wi = 0, cursor = ws.length ? ws[0].t0 : 0;
  for (const m of queue) {
    let placed = false;
    while (wi < ws.length && !placed) {
      const w = ws[wi];
      const start = Math.max(cursor, w.t0, (m.createdSec || 0) + 1.5);
      if (start + m.dur <= w.t1 + 0.01) {
        out.push({ id: m.id, at: Math.round(start * 1000) / 1000, dur: m.dur });
        cursor = start + m.dur + 0.8;
        placed = true;
      } else {
        wi++;
        cursor = wi < ws.length ? ws[wi].t0 : cursor;
      }
    }
    if (!placed) break; // nu mai încape nicăieri — rămâne doar în chat, ca text
  }
  return out;
}

// ═════════════════════════════════════════════════════════════════════════════
// 9. MIȘCAREA GURII — calculată o singură dată, din vocea generată
//
// Din sunetul PCM (16 biți, mono) scoatem, la 25 de cadre pe secundă:
//   · deschiderea (energia vocii, comprimată)                  → 0..15
//   · forma: rotunjită (o, u — energie joasă) … lată (i, e, s)  → 0..15
// Un octet pe cadru (deschidere << 4 | formă), în base64. Browserul mișcă
// gura exact după ceasul audio — fără analiză în timp real, fără CORS.
// ═════════════════════════════════════════════════════════════════════════════
const LIP_FPS = 25;
function lipFromPcm(samples, sampleRate = 24000) {
  const n = samples.length;
  const hop = Math.max(1, Math.round(sampleRate / LIP_FPS));
  const frames = Math.ceil(n / hop);
  const rms = new Float32Array(frames);
  const hi = new Float32Array(frames);
  const lo = new Float32Array(frames);
  // filtre de un pol: trece-jos ~900 Hz și trece-sus ~2,5 kHz
  const aLo = Math.exp(-2 * Math.PI * 900 / sampleRate);
  const aHi = Math.exp(-2 * Math.PI * 2500 / sampleRate);
  let yl = 0, yh = 0, xPrev = 0;
  for (let f = 0; f < frames; f++) {
    let e = 0, el = 0, eh = 0, cnt = 0;
    for (let i = f * hop; i < Math.min(n, (f + 1) * hop); i++) {
      const x = samples[i] / 32768;
      yl = (1 - aLo) * x + aLo * yl;
      yh = aHi * (yh + x - xPrev);
      xPrev = x;
      e += x * x; el += yl * yl; eh += yh * yh; cnt++;
    }
    rms[f] = cnt ? Math.sqrt(e / cnt) : 0;
    lo[f] = cnt ? Math.sqrt(el / cnt) : 0;
    hi[f] = cnt ? Math.sqrt(eh / cnt) : 0;
  }
  // normalizare robustă: percentila 95 a energiei = gura deschisă aproape complet
  const sorted = Array.from(rms).filter((v) => v > 0.004).sort((a, b) => a - b);
  const p95 = sorted.length ? sorted[Math.floor(sorted.length * 0.95)] : 0.1;
  const gate = Math.max(0.006, p95 * 0.12);
  const bytes = Buffer.alloc(frames);
  let prevOpen = 0;
  for (let f = 0; f < frames; f++) {
    let open = rms[f] <= gate ? 0 : Math.min(1, Math.pow((rms[f] - gate) / Math.max(1e-6, p95 - gate), 0.65));
    open = 0.6 * open + 0.4 * prevOpen;              // netezire (gura nu „sare")
    prevOpen = open;
    const tot = lo[f] + hi[f] + 1e-9;
    const shape = Math.max(0, Math.min(1, (hi[f] / tot - 0.12) / 0.6));   // 0 = rotund, 1 = lat
    bytes[f] = (Math.round(open * 15) << 4) | Math.round(shape * 15);
  }
  return bytes.toString('base64');
}

// decodificare (folosită la teste și de client: src/lib/live/lip.js e oglinda)
function lipAt(b64, sec) {
  if (!b64) return { open: 0, shape: 0.5 };
  const buf = Buffer.from(b64, 'base64');
  const i = Math.floor(sec * LIP_FPS);
  if (i < 0 || i >= buf.length) return { open: 0, shape: 0.5 };
  const v = buf[i];
  return { open: (v >> 4) / 15, shape: (v & 15) / 15 };
}

// Durata unui PCM 16-bit mono
const pcmDuration = (byteLength, sampleRate = 24000) => byteLength / 2 / sampleRate;

// ═════════════════════════════════════════════════════════════════════════════
// 10. ALTELE
// ═════════════════════════════════════════════════════════════════════════════
// „Evaluarea Națională", „BAC Mate-Info", „BAC Științele Naturii", „BAC Tehnologic"
const EXAM_LABEL = (exam, profile) => {
  if (exam === 'en') return 'Evaluarea Națională';
  const r = ROOMS.find((x) => x.exam === 'bac' && x.profile === profile);
  return r ? r.label : 'Bacalaureat';
};

// Id stabil pentru segmente/sondaje (scurt, fără caractere speciale)
const shortId = (s) => crypto.createHash('sha1').update(String(s)).digest('base64url').slice(0, 10);

module.exports = {
  TZ, TEACHER_DEFAULTS, teachers, teacherById, publicTeacher,
  roParts, roTime, dayKey, addDays, dayNumber, monthStart, parseDayKey,
  intervals, rooms, roomById, slots, slotById, slotTimes, examFor, plannedSessions, phaseOf, canJoinPhase, JOIN_EARLY_MIN, isFullSubject,
  BAREM_OK, hasBarem, subjectExam, pickSubject, PROFILE_LABELS, EXAM_LABEL,
  groupAccess, privateAccess, PRICE_GROUP_LEI, PRICE_PRIVATE_LEI, PRIVATE_INCLUDED, PRIVATE_MINUTES,
  displayName, moderate, isQuestion, foldRo,
  checkPollAnswer, pollResults, publicPoll,
  buildTimeline, fitTimeline, sceneAt, qnaSchedule, packSegments, segDuration, MODE_LABELS, ALT_MODES, GAP,
  lipFromPcm, lipAt, pcmDuration, LIP_FPS, shortId,
};
