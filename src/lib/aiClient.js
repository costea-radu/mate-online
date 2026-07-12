// =====================================================================
// src/lib/aiClient.js — client front-end pentru Profesorul Virtual
// Atașează automat userId din sesiunea Supabase la fiecare cerere.
// =====================================================================
import { supabase } from './supabase';
import { authHeaders, getValidSession, forceRefresh } from './api';

async function uid() {
  const { data: { session } } = await supabase.auth.getSession();
  return session?.user?.id || null;
}

async function post(path, body) {
  const session = await getValidSession();
  const userId = session?.user?.id || null;
  if (!userId) throw new Error('Trebuie să fii autentificat pentru a folosi Profesorul Virtual.');
  let res = await fetch(path, {
    method: 'POST',
    headers: await authHeaders(),
    body: JSON.stringify({ userId, ...body }),
  });
  if (res.status === 401) { // token expirat între timp → reîmprospătează și reîncearcă o dată
    await forceRefresh();
    res = await fetch(path, { method: 'POST', headers: await authHeaders(), body: JSON.stringify({ userId, ...body }) });
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const e = new Error(data.error || `Eroare server (${res.status})`);
    if (data.code === 'PREMIUM_REQUIRED' || res.status === 402) e.premium = true;
    throw e;
  }
  return data;
}

export const aiClient = {
  // Chat-tutor (non-streaming, fallback). mode: 'assistant' | 'tutor' | 'explain' | 'hint'
  chat: ({ message, mode = 'tutor', conversationId = null, context = {} }) =>
    post('/api/ai-chat', { message, mode, conversationId, context }),

  // Chat-tutor cu STREAMING. Apelează callback-urile pe măsură ce sosesc datele.
  // onMeta({conversationId, sources}), onDelta(textFragment), onDone({messageId})
  async chatStream({ message, mode = 'tutor', conversationId = null, context = {} }, { onMeta, onDelta, onDone } = {}) {
    const session = await getValidSession();
    const userId = session?.user?.id || null;
    if (!userId) throw new Error('Trebuie să fii autentificat pentru a folosi Profesorul Virtual.');
    const payload = () => JSON.stringify({ userId, message, mode, conversationId, context });
    let res = await fetch('/api/ai-chat-stream', { method: 'POST', headers: await authHeaders(), body: payload() });
    if (res.status === 401) { // token expirat → reîmprospătează și reîncearcă o dată
      await forceRefresh();
      res = await fetch('/api/ai-chat-stream', { method: 'POST', headers: await authHeaders(), body: payload() });
    }
    if (!res.ok || !res.body) {
      const d = await res.json().catch(() => ({}));
      throw new Error(d.error || `Eroare server (${res.status})`);
    }
    const reader = res.body.getReader();
    const dec = new TextDecoder();
    let buf = '';
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buf += dec.decode(value, { stream: true });
      const lines = buf.split('\n');
      buf = lines.pop();
      for (const line of lines) {
        const t = line.trim();
        if (!t) continue;
        let frame; try { frame = JSON.parse(t); } catch { continue; }
        if (frame.type === 'meta') onMeta?.(frame);
        else if (frame.type === 'delta') onDelta?.(frame.text);
        else if (frame.type === 'done') onDone?.(frame);
        else if (frame.type === 'error') { const e = new Error(frame.error); if (frame.code === 'PREMIUM_REQUIRED') e.premium = true; throw e; }
      }
    }
  },

  // Antrenament (efemer)
  generate: ({ category = null, topic = '', difficulty = 'mediu' }) =>
    post('/api/ai-practice', { action: 'generate', category, topic, difficulty }),
  check: ({ token, studentAnswer = '', studentWork = '' }) =>
    post('/api/ai-practice', { action: 'check', token, studentAnswer, studentWork }),
  // Dezvăluie enunț+răspuns+rezolvare (pentru export PDF) — doar abonați
  reveal: ({ token }) => post('/api/ai-practice', { action: 'reveal', token }),

  // Generator de teste de examen (model oficial) — doar abonați
  generateExam: ({ examType, instructions = '', dataMode = 'modify' }) => post('/api/ai-exam', { examType, instructions, dataMode }),

  // Generator de exerciții interactive (HTML) — admin sau abonat
  generateInteractive: ({ category = null, topic = '', difficulty = 'mediu', dataMode = 'modify' }) =>
    post('/api/ai-generate-interactive', { category, topic, difficulty, dataMode }),

  // Agenți Claude (admin): generator exerciții + SEO/marketing
  exerciseAgent: (payload) => post('/api/ai-exercise-agent', payload),
  seoAgent: (payload) => post('/api/ai-seo-agent', payload),

  // Progres + feedback
  progress: () => post('/api/ai-progress', {}),
  feedback: ({ messageId, value, note = null }) => post('/api/ai-feedback', { messageId, value, note }),

  // Foto-rezolvare: transcrie exercițiul dintr-o imagine (data URL)
  visionExtract: ({ imageBase64, note = '' }) => post('/api/ai-vision', { imageBase64, note }),

  // Profesor: stăpânirea AI a unui elev al său + raport agregat
  teacherStudentMastery: (studentId) => post('/api/ai-teacher', { action: 'student', studentId }),
  teacherReport: ({ groupId = null } = {}) => post('/api/ai-teacher', { action: 'report', groupId }),

  // Notificări
  notifications: () => post('/api/ai-notify', { action: 'list' }),
  notificationsUnread: () => post('/api/ai-notify', { action: 'unread_count' }),
  notificationRead: ({ id = null, kind = null, all = false }) => post('/api/ai-notify', { action: 'read', id, kind, all }),
  sendBroadcast: ({ title, body = null, url = null, type = 'update' }) => post('/api/ai-notify', { action: 'broadcast', title, body, url, type }),

  // Activitatea unui copil (pentru părinte)
  activityChildren: () => post('/api/ai-activity', { action: 'children' }),
  activityDetail: ({ studentId }) => post('/api/ai-activity', { action: 'detail', studentId }),

  // Teme profesor → elev
  assignmentCreateInteractive: ({ html = null, questions = null, title = null, category = null, topic = null }) =>
    post('/api/ai-assignment', { action: 'create', kind: 'interactive', html, questions, title, category, topic }),
  assignmentCreatePractice: ({ token, title = null }) =>
    post('/api/ai-assignment', { action: 'create', kind: 'practice', token, title }),
  assignmentGet: ({ id }) => post('/api/ai-assignment', { action: 'get', id }),
  assignmentCreateFromPublic: ({ publicId }) => post('/api/ai-assignment', { action: 'create', fromPublicId: publicId }),
  assignmentSubmit: ({ id, answer = '', work = '', score = null, maxScore = null }) =>
    post('/api/ai-assignment', { action: 'submit', id, answer, work, score, maxScore }),
  assignmentResults: () => post('/api/ai-assignment', { action: 'results' }),
  assignmentsMine: () => post('/api/ai-assignment', { action: 'mine' }),
  assignmentDelete: ({ id }) => post('/api/ai-assignment', { action: 'delete', id }),
  assignmentStudents: () => post('/api/ai-assignment', { action: 'students' }),
  assignmentSend: ({ assignmentId, studentId }) => post('/api/ai-assignment', { action: 'send', assignmentId, studentId }),

  // Anunțuri admin (listă + ștergere)
  broadcastList: () => post('/api/ai-notify', { action: 'broadcast_list' }),
  broadcastDelete: ({ id }) => post('/api/ai-notify', { action: 'broadcast_delete', id }),
  broadcastDeleteByContent: ({ contentId }) => post('/api/ai-notify', { action: 'broadcast_delete_by_content', contentId }),

  // Biblioteca utilizatorilor (teste publice)
  publicPublish: ({ kind, title, category = null, topic = null, payload }) =>
    post('/api/ai-public', { action: 'publish', kind, title, category, topic, payload }),
  publicList: ({ q = '', category = null } = {}) => post('/api/ai-public', { action: 'list', q, category }),
  publicGet: ({ id }) => post('/api/ai-public', { action: 'get', id }),
  publicSetFree: ({ id, isFree }) => post('/api/ai-public', { action: 'set_free', id, isFree }),

  // Cont
  accountDelete: () => post('/api/ai-account', { action: 'delete' }),
  accountCheckUsername: ({ username }) => post('/api/ai-account', { action: 'check_username', username }),
  publicDelete: ({ id }) => post('/api/ai-public', { action: 'delete', id }),
  publicRecord: ({ id, score, maxScore }) => post('/api/ai-public', { action: 'record', id, score, maxScore }),

  // Voce: transcriere audio (fallback STT)
  transcribe: ({ audioBase64, mime = 'audio/webm' }) => post('/api/ai-transcribe', { audioBase64, mime }),

  // Conversații (citite direct din Supabase, protejate de RLS)
  async listConversations(limit = 20) {
    const userId = await uid();
    if (!userId) return [];
    const { data } = await supabase.from('ai_conversations')
      .select('id, title, updated_at').eq('user_id', userId)
      .order('updated_at', { ascending: false }).limit(limit);
    return data || [];
  },
  async getMessages(conversationId) {
    const { data } = await supabase.from('ai_messages')
      .select('id, role, content, mode, metadata, created_at')
      .eq('conversation_id', conversationId).order('created_at', { ascending: true });
    return data || [];
  },

  // Admin: indexare bază de cunoștințe
  ingest: (action) => post('/api/ai-ingest', { action }),

  // ── Biblioteca personală (privată, RLS proprietar): teste/exerciții generate ──
  async saveLibraryItem(item) {
    const userId = await uid();
    if (!userId) throw new Error('Trebuie să fii autentificat.');
    const { data, error } = await supabase.from('ai_personal_items')
      .insert({ user_id: userId, ...item }).select('id').single();
    if (error) throw new Error(error.message);
    return data?.id || null;
  },
  async updateLibraryScore(id, score, maxScore) {
    const { error } = await supabase.from('ai_personal_items')
      .update({ score, max_score: maxScore, completed_at: new Date().toISOString() }).eq('id', id);
    if (error) throw new Error(error.message);
  },
  async updateLibraryItem(id, patch) {
    // salvează peste itemul privat (ex: payload editat). RLS permite doar proprietarului.
    const { error } = await supabase.from('ai_personal_items').update(patch).eq('id', id);
    if (error) throw new Error(error.message);
  },
  async listLibrary(kind = null) {
    const userId = await uid();
    if (!userId) return [];
    let q = supabase.from('ai_personal_items')
      .select('id, kind, title, category, topic, score, max_score, completed_at, created_at')
      .eq('user_id', userId).order('created_at', { ascending: false }).limit(60);
    if (kind) q = q.eq('kind', kind);
    const { data } = await q;
    return data || [];
  },
  async getLibraryItem(id) {
    const { data } = await supabase.from('ai_personal_items').select('*').eq('id', id).single();
    return data;
  },
  async deleteLibraryItem(id) {
    await supabase.from('ai_personal_items').delete().eq('id', id);
  },
};
