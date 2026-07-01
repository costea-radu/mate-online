// =====================================================================
// src/lib/aiClient.js — client front-end pentru Profesorul Virtual
// Atașează automat userId din sesiunea Supabase la fiecare cerere.
// =====================================================================
import { supabase } from './supabase';

async function uid() {
  const { data: { session } } = await supabase.auth.getSession();
  return session?.user?.id || null;
}

async function post(path, body) {
  const userId = await uid();
  if (!userId) throw new Error('Trebuie să fii autentificat pentru a folosi Profesorul Virtual.');
  const res = await fetch(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ userId, ...body }),
  });
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
    const userId = await uid();
    if (!userId) throw new Error('Trebuie să fii autentificat pentru a folosi Profesorul Virtual.');
    const res = await fetch('/api/ai-chat-stream', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userId, message, mode, conversationId, context }),
    });
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
  generateExam: ({ examType }) => post('/api/ai-exam', { examType }),

  // Generator de exerciții interactive (HTML) — admin sau abonat
  generateInteractive: ({ category = null, topic = '', difficulty = 'mediu' }) =>
    post('/api/ai-generate-interactive', { category, topic, difficulty }),

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
  notificationRead: ({ notificationId = null, all = false }) => post('/api/ai-notify', { action: 'read', notificationId, all }),

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
