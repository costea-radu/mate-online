// =====================================================================
// src/lib/live/api.js — clientul pentru /api/live (meditațiile live)
// Erorile păstrează tot corpul răspunsului (e.data): prețul biletului,
// codul LIVE_PAYMENT etc. sunt necesare interfeței.
// Fiecare răspuns care aduce `now` sincronizează ceasul cu serverul (clock.js).
// =====================================================================
import { authHeaders, forceRefresh, getValidSession } from '../api';
import { clock } from './clock';

async function call(body, { auth = true, keepalive = false } = {}) {
  const t0 = Date.now();
  const headers = auth ? await authHeaders() : { 'Content-Type': 'application/json' };
  const opts = () => ({ method: 'POST', headers, body: JSON.stringify(body), ...(keepalive ? { keepalive: true } : {}) });
  let res = await fetch('/api/live', opts());
  if (res.status === 401 && auth) {
    await forceRefresh();
    Object.assign(headers, await authHeaders());
    res = await fetch('/api/live', opts());
  }
  const data = await res.json().catch(() => ({}));
  if (data && data.now) clock.sample(data.now, t0, Date.now());
  if (!res.ok) {
    const e = new Error(data.error || `Eroare server (${res.status})`);
    e.status = res.status; e.code = data.code || null; e.data = data;
    throw e;
  }
  return data;
}

export const liveApi = {
  // programul se vede și fără cont (fără drepturile personale)
  async program() {
    const session = await getValidSession().catch(() => null);
    return call({ action: 'program' }, { auth: !!session });
  },
  join: (sessionId) => call({ action: 'join', sessionId }),
  // opts: un număr (bugetul în ms, ca înainte) sau { budgetMs, fromRef } — fromRef = itemul la
  // care e elevul (1-la-1 pornit): vocea care lipsește se generează întâi de acolo
  prepare: (sessionId, opts = null) => call({ action: 'prepare', sessionId, ...(typeof opts === 'number' ? { budgetMs: opts } : (opts || {})) }),
  timeline: (sessionId) => call({ action: 'timeline', sessionId }),
  heartbeat: (sessionId, seconds) => call({ action: 'heartbeat', sessionId, seconds }),
  chat: (sessionId, text, { toTeacher = false, item = null } = {}) => call({ action: 'chat', sessionId, text, toTeacher, item }),
  messages: (sessionId, afterId = 0) => call({ action: 'messages', sessionId, afterId }),
  pollAnswer: (sessionId, pollId, answer) => call({ action: 'poll_answer', sessionId, pollId, answer }),
  pollResults: (sessionId, pollId, type) => call({ action: 'poll_results', sessionId, pollId, type }),
  privateSubjects: (exam, teacher, profile = null) => call({ action: 'private_subjects', exam, teacher, profile }),
  privateStart: (teacher, subjectId) => call({ action: 'private_start', teacher, subjectId }),
  privateBegin: (sessionId) => call({ action: 'private_begin', sessionId }),
  privateState: (sessionId, player) => call({ action: 'private_state', sessionId, player }),
  leave: (sessionId, { seconds = 0, end = false } = {}) => call({ action: 'leave', sessionId, seconds, end }, { keepalive: true }),
  // Pregătirea de examen („Planul meu", ca o meditație live) — api/live.js → prep_*
  prepState: () => call({ action: 'prep_state' }),
  prepExercise: (pos, { skip = null } = {}) => call({ action: 'prep_exercise', pos, ...(skip ? { skip } : {}) }),
  prepPrefetch: (pos, current = null) => call({ action: 'prep_prefetch', pos, current }),
  prepAnswer: (rowId, pollId, answer) => call({ action: 'prep_answer', rowId, pollId, answer }),
  prepDone: (rowId, sid, seconds = 0) => call({ action: 'prep_done', rowId, sid, seconds }),
  prepTest: (pos) => call({ action: 'prep_test', pos }),
  prepTestFinish: (rowId, seconds = 0) => call({ action: 'prep_test_finish', rowId, seconds }),
  prepChat: ({ text, sid = null, ref = null, pos = null, history = [] }) => call({ action: 'prep_chat', text, sid, ref, pos, history }),
  // admin
  adminOverview: (day, fresh = false) => call({ action: 'admin_overview', day, fresh }),
  adminSetSubject: (sessionId, patch) => call({ action: 'admin_set_subject', sessionId, ...patch }),
  adminPrepare: (args) => call({ action: 'admin_prepare', ...args }),
  adminLesson: (lessonId) => call({ action: 'admin_lesson', lessonId }),
};

// Plata unui bilet (Stripe Checkout) — întoarce URL-ul paginii de plată
export async function buyTicket({ kind, sessionId = null, teacher = null, returnTo = '/meditatii' }) {
  let res = await fetch('/api/create-checkout', {
    method: 'POST', headers: await authHeaders(),
    body: JSON.stringify({ type: 'live', kind, sessionId, teacher, returnTo }),
  });
  if (res.status === 401) {
    await forceRefresh();
    res = await fetch('/api/create-checkout', { method: 'POST', headers: await authHeaders(), body: JSON.stringify({ type: 'live', kind, sessionId, teacher, returnTo }) });
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data.url) {
    const e = new Error(data.error || 'Plata nu a putut porni.');
    e.code = data.code || null;
    throw e;
  }
  return data.url;
}
