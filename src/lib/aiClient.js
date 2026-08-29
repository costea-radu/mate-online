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
  chat: ({ message, mode = 'tutor', conversationId = null, context = {}, images = null, imageThumb = null }) =>
    post('/api/ai-chat', { message, mode, conversationId, context, ...(images ? { images, imageThumb } : {}) }),

  // Chat-tutor cu STREAMING. Apelează callback-urile pe măsură ce sosesc datele.
  // onMeta({conversationId, sources}), onDelta(textFragment), onDone({messageId})
  // `signal` (AbortSignal, opțional): butonul „Oprește" din chat întrerupe
  //   cererea — fetch/reader aruncă AbortError, pe care chatul îl tratează
  //   ca „răspuns oprit", nu ca eroare.
  // `regenerate` (opțional): „Regenerează" — serverul NU mai salvează încă o
  //   dată mesajul elevului și scoate răspunsul anterior din istoricul dat
  //   modelului (altfel l-ar repeta).
  // `images` (opțional, Etapa 3): pozele elevului (data URL) merg la model ca
  //   imagini; `imageThumb` = miniatura păstrată în conversație.
  async chatStream({ message, mode = 'tutor', conversationId = null, context = {}, regenerate = false, images = null, imageThumb = null }, { onMeta, onDelta, onDone, signal = null } = {}) {
    const session = await getValidSession();
    const userId = session?.user?.id || null;
    if (!userId) throw new Error('Trebuie să fii autentificat pentru a folosi Profesorul Virtual.');
    const payload = () => JSON.stringify({ userId, message, mode, conversationId, context, regenerate: !!regenerate, ...(images ? { images, imageThumb } : {}) });
    const opts = async () => ({ method: 'POST', headers: await authHeaders(), body: payload(), ...(signal ? { signal } : {}) });
    let res = await fetch('/api/ai-chat-stream', await opts());
    if (res.status === 401) { // token expirat → reîmprospătează și reîncearcă o dată
      await forceRefresh();
      res = await fetch('/api/ai-chat-stream', await opts());
    }
    if (!res.ok || !res.body) {
      const d = await res.json().catch(() => ({}));
      const e = new Error(d.error || `Eroare server (${res.status})`);
      // și pe ruta de streaming, un 402 trebuie să pornească bannerul de abonare
      if (res.status === 402 || d.code === 'PREMIUM_REQUIRED') e.premium = true;
      throw e;
    }
    const reader = res.body.getReader();
    const dec = new TextDecoder();
    let buf = '';
    const handle = (line) => {
      const t = line.trim();
      if (!t) return;
      let frame; try { frame = JSON.parse(t); } catch { return; }
      if (frame.type === 'meta') onMeta?.(frame);
      else if (frame.type === 'delta') onDelta?.(frame.text);
      else if (frame.type === 'done') onDone?.(frame);
      else if (frame.type === 'error') { const e = new Error(frame.error); if (frame.code === 'PREMIUM_REQUIRED') e.premium = true; e.code = frame.code || null; throw e; }
    };
    try {
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        buf += dec.decode(value, { stream: true });
        const lines = buf.split('\n');
        buf = lines.pop();
        for (const line of lines) handle(line);
      }
      // ultima linie, fără „\n" la final (ex. cadrul „done" trimis chiar înainte
      // de închiderea fluxului): fără flush, onDone nu se mai apela și mesajul
      // rămânea blocat în „streaming" (fără KaTeX, fără butoane)
      buf += dec.decode();
      if (buf.trim()) handle(buf);
    } finally {
      try { await reader.cancel(); } catch { /* fluxul e deja închis */ }
    }
  },

  // Antrenament (efemer)
  generate: ({ category = null, topic = '', difficulty = 'mediu' }) =>
    post('/api/ai-practice', { action: 'generate', category, topic, difficulty }),
  check: ({ token, studentAnswer = '', studentWork = '' }) =>
    post('/api/ai-practice', { action: 'check', token, studentAnswer, studentWork }),
  // Dezvăluie enunț+răspuns+rezolvare (pentru export PDF) — doar abonați
  reveal: ({ token }) => post('/api/ai-practice', { action: 'reveal', token }),

  // Generator de teste de examen (model oficial) — doar abonați.
  // chapters: liste de TITLURI de capitole — itemii vin doar din ele (opțional)
  generateExam: ({ examType, instructions = '', dataMode = 'modify', chapters = [] }) =>
    post('/api/ai-exam', { examType, instructions, dataMode, chapters }),

  // Generator de exerciții/teste interactive (HTML) — admin sau abonat.
  // kind: 'exercitiu' (implicit) | 'test' + count = numărul de itemi ai testului (4–24)
  // qtype: 'mixt' (implicit) | 'grila' (toate cu 4 variante) | 'redactare' (toate cu răspuns liber)
  generateInteractive: ({ category = null, topic = '', difficulty = 'mediu', dataMode = 'modify', chapters = [], kind = 'exercitiu', count = null, qtype = 'mixt' }) =>
    post('/api/ai-generate-interactive', { category, topic, difficulty, dataMode, chapters, kind, count, qtype }),

  // Agenți Claude (admin): generator exerciții + SEO/marketing
  exerciseAgent: (payload) => post('/api/ai-exercise-agent', payload),
  seoAgent: (payload) => post('/api/ai-seo-agent', payload),

  // Task-urile programate ale agentului de exerciții (admin):
  // list / create / update / toggle / delete / run_now / runs / run_result / post_run / delete_run
  agentTasks: (payload) => post('/api/agent-tasks', payload),

  // Coada de aprobare a agentului SEO (admin): list / approve / reject / revert
  seoActions: (payload) => post('/api/seo-actions', payload),

  // Rank-tracking (admin): evoluția pozițiilor din gsc_snapshots + efectul acțiunilor
  seoRank: (payload) => post('/api/seo-rank', payload),

  // Calendarul social (admin): list / publish_now / mark_posted / cancel / retry / refresh_metrics
  socialQueue: (payload) => post('/api/social-queue', payload),

  // Newsletter (admin): campanii scrise de agentul SEO, trimise pe email
  newsletter: (payload) => post('/api/newsletter', payload),

  // Meditații cu Profesorul Virtual (payload: { action, ... })
  // Acțiuni: state · setup · assessment_submit · lesson · exercises ·
  // submit_set · remediation · homework_assign/list/start/submit ·
  // review_start · simulare · set_style · mentor_report · reset
  meditatii: (payload) => post('/api/ai-meditatii', payload),
  // Scorul unui test interactiv, VERIFICAT pe server din răspunsuri (Etapa 3)
  scoreSubmit: ({ contentId, answers, score, maxScore, durationSec = 0, duelId = null }) =>
    post('/api/ai-score', { contentId, answers, score, maxScore, durationSec, ...(duelId ? { duelId } : {}) }),

  // Dueluri 1-la-1 (api/duel.js): list · optiuni · create · respond · set_open
  duel: (payload = {}) => post('/api/duel', { action: 'list', ...payload }),

  // Turnee de grupă (api/turneu.js): list · optiuni · create · close
  turneu: (payload = {}) => post('/api/turneu', { action: 'list', ...payload }),

  // Harta capitolelor (api/harta.js): state · unlock
  harta: (payload = {}) => post('/api/harta', { action: 'state', ...payload }),

  // Arena matematică — XP, streak, misiunea zilei, liga săptămânală
  // (supabase/gamificare_v2.sql · api/gamificare.js)
  gamificare: (payload = {}) => post('/api/gamificare', { action: 'state', ...payload }),

  // Progres + feedback
  progress: () => post('/api/ai-progress', {}),
  feedback: ({ messageId, value, note = null }) => post('/api/ai-feedback', { messageId, value, note }),

  // Pachet AI suplimentar (top-up de buget): întoarce { url } către Stripe Checkout
  topupCheckout: (pack) => post('/api/create-checkout', { type: 'topup', pack }),

  // Foto-rezolvare: transcrie exercițiul dintr-o imagine (data URL)
  visionExtract: ({ imageBase64, note = '' }) => post('/api/ai-vision', { imageBase64, note }),

  // ── Corectarea cu punctaj a testelor / exercițiilor PDF („Răspunde în chat") ──
  // Textul unui PDF încărcat de elev direct în chat (temă, fișă, variantă)
  correctPdfText: ({ fileBase64 }) => post('/api/ai-correct', { action: 'pdf_text', fileBase64 }),
  // Formularul de răspuns: câmpuri pe exerciții și subpuncte a), b), c) — din barem
  // (categoria activează punctajele oficiale: EN 5p/grilă + a)2p/b)3p; BAC 5p)
  // Pentru un test din platformă (contentId) serverul recitește SINGUR textul și
  // baremul (nu mai are încredere în cele din browser); răspunsul include un
  // `token` semnat care se trimite înapoi la corectare.
  correctForm: ({ testText, baremText = '', title = '', category = null, contentId = null }) =>
    post('/api/ai-correct', { action: 'form', testText, baremText, title, category, contentId }),
  // Corectarea: AI-ul primește testul + baremul + răspunsurile și dă punctajul
  correctGrade: (payload) => post('/api/ai-correct', { action: 'grade', ...payload }),

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

  // ── TEST pe GRUPĂ: un singur link, teste DIFERITE per elev ────────────────
  //    (api/group-assignment.js + supabase/teme_grupa.sql)
  groupAssignmentGroups: () => post('/api/group-assignment', { action: 'groups' }),
  groupAssignmentCatalog: ({ source, category = null, format = 'interactive', q = '' }) =>
    post('/api/group-assignment', { action: 'catalog', source, category, format, q }),
  groupAssignmentCreate: (payload) => post('/api/group-assignment', { action: 'create', ...payload }),
  groupAssignmentsMine: () => post('/api/group-assignment', { action: 'mine' }),
  groupAssignmentReport: ({ id }) => post('/api/group-assignment', { action: 'report', id }),
  groupAssignmentRename: ({ id, title }) => post('/api/group-assignment', { action: 'rename', id, title }),
  groupAssignmentLeaderboard: ({ groupId = null } = {}) =>
    post('/api/group-assignment', { action: 'leaderboard', groupId }),
  groupAssignmentDelete: ({ id }) => post('/api/group-assignment', { action: 'delete', id }),
  groupAssignmentOpen: ({ id }) => post('/api/group-assignment', { action: 'open', id }),
  groupAssignmentPick: ({ pickId }) => post('/api/group-assignment', { action: 'pick', pickId }),
  groupAssignmentScore: ({ pickId, score, maxScore }) =>
    post('/api/group-assignment', { action: 'score', pickId, score, maxScore }),
  // Testul pe grupă oprește mesageria cât timp e în desfășurare
  groupAssignmentTestStart: ({ pickId }) => post('/api/group-assignment', { action: 'test_start', pickId }),
  groupAssignmentTestEnd: ({ pickId }) => post('/api/group-assignment', { action: 'test_end', pickId }),

  // ── TEME: exercițiile bifate de profesor, aceleași pentru toți elevii vizați
  //    — pe grupă sau pe un singur elev (api/homework.js + supabase/teme_elevi.sql)
  homeworkCatalog: ({ sources = ['site'], category = null, format = null, q = '' } = {}) =>
    post('/api/homework', { action: 'catalog', sources, category, format, q }),
  homeworkCreate: (payload) => post('/api/homework', { action: 'create', ...payload }),
  homeworkMine: () => post('/api/homework', { action: 'mine' }),
  homeworkReport: ({ id }) => post('/api/homework', { action: 'report', id }),
  homeworkRename: ({ id, title }) => post('/api/homework', { action: 'rename', id, title }),
  homeworkDelete: ({ id }) => post('/api/homework', { action: 'delete', id }),
  homeworkStudentList: () => post('/api/homework', { action: 'student_list' }),
  homeworkOpen: ({ id }) => post('/api/homework', { action: 'open', id }),
  homeworkScore: ({ progressId, score = null, maxScore = null, done = true }) =>
    post('/api/homework', { action: 'score', progressId, score, maxScore, done }),

  // ── MESAGERIE (tip messenger) pe grupele profesorului ─────────────────────
  //    (api/messages.js + supabase/mesagerie.sql)
  chatThreads: () => post('/api/messages', { action: 'threads' }),
  chatMembers: ({ groupId }) => post('/api/messages', { action: 'members', groupId }),
  chatDirect: ({ otherId }) => post('/api/messages', { action: 'direct', otherId }),
  chatMessages: ({ threadId, limit = 80 }) => post('/api/messages', { action: 'messages', threadId, limit }),
  chatSend: ({ threadId, body = '', attachment = null }) =>
    post('/api/messages', { action: 'send', threadId, body, attachment }),
  chatRead: ({ threadId }) => post('/api/messages', { action: 'read', threadId }),
  chatUnread: () => post('/api/messages', { action: 'unread' }),
  chatAttachables: () => post('/api/messages', { action: 'attachables' }),

  // ── COLEGI (pe tot site-ul): oricine poate căuta pe oricine, pe CATEGORII ─
  //    profesor → colegi / elevi / părinți; elev → colegi / profesori /
  //    părinți; părinte → alți părinți / profesori / elevi (api/colegi.js).
  //    `role` = categoria în care caut; lipsă → categoria mea.
  colegiList: () => post('/api/colegi', { action: 'list' }),
  colegiSearch: ({ q, role = null }) => post('/api/colegi', { action: 'search', q, role }),
  colegiRequest: ({ otherId }) => post('/api/colegi', { action: 'request', otherId }),
  colegiRespond: ({ id, accept = true }) => post('/api/colegi', { action: 'respond', id, accept }),
  colegiRemove: ({ otherId }) => post('/api/colegi', { action: 'remove', otherId }),
  colegiSetVisible: ({ visible }) => post('/api/colegi', { action: 'set_visible', visible }),

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

  // Textul unui PDF deschis — ca Profesorul Virtual să „vadă" exercițiile din el
  pdfContext: ({ contentId }) => post('/api/ai-pdf-context', { contentId }),
  // Admin (Etapa 2, 3.1): asocierea test ↔ barem confirmată manual.
  //   candidates → { candidates:[{id,title,isBarem}], current:{barem,baremStatus,override} }
  //   set_barem  → baremId=null revine la potrivirea automată
  pdfBaremCandidates: ({ contentId }) => post('/api/ai-pdf-context', { contentId, action: 'candidates' }),
  pdfSetBarem: ({ contentId, baremId }) => post('/api/ai-pdf-context', { contentId, action: 'set_barem', baremId: baremId || null }),

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
    // răspunsurile înlocuite prin „Regenerează" rămân în DB (marcate), dar nu se mai afișează
    return (data || []).filter((m) => !(m.metadata && m.metadata.superseded === true));
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
  // Salvează un PDF (ex. subiect combinat exact) în bibliotecă: fișierul merge
  // în Storage (bucket privat 'personal-pdfs'), în tabel rămâne doar calea.
  // Base64 în payload NU merge pentru fișiere mari: API-ul Supabase respinge
  // cererile JSON de peste ~1 MB cu eroarea 413 — de aceea „nu se salvau”.
  async savePdfLibraryItem({ title, category = null, topic = null, blob, sources = [] }) {
    const userId = await uid();
    if (!userId) throw new Error('Trebuie să fii autentificat.');
    if (blob.size > 24 * 1024 * 1024) throw new Error('PDF-ul e prea mare pentru bibliotecă (max 24 MB).');
    const path = `${userId}/${Date.now()}_${Math.random().toString(36).slice(2, 8)}.pdf`;
    const { error: upErr } = await supabase.storage.from('personal-pdfs')
      .upload(path, blob, { contentType: 'application/pdf', upsert: false });
    if (upErr) {
      // instalări fără bucket: doar PDF-urile mici mai încap ca base64 în payload
      if (blob.size <= 700 * 1024) {
        const b64 = await new Promise((resolve, reject) => {
          const fr = new FileReader();
          fr.onload = () => resolve(String(fr.result).split(',')[1] || '');
          fr.onerror = reject; fr.readAsDataURL(blob);
        });
        return this.saveLibraryItem({ kind: 'pdf', title, category, topic, payload: { pdfBase64: b64, sources } });
      }
      throw new Error(`Storage indisponibil (${upErr.message}). Rulează scriptul supabase/personal_pdfs_bucket.sql în Supabase → SQL Editor.`);
    }
    try {
      return await this.saveLibraryItem({ kind: 'pdf', title, category, topic, payload: { pdfPath: path, bucket: 'personal-pdfs', sources } });
    } catch (e) {
      await supabase.storage.from('personal-pdfs').remove([path]).catch(() => {});
      const hint = /check|constraint|kind/i.test(e.message) ? ' — rulează scriptul supabase/personal_pdfs_bucket.sql (permite kind=pdf).' : '';
      throw new Error(e.message + hint);
    }
  },
  // Descarcă PDF-ul unui element din bibliotecă (Storage sau base64 vechi) ca Blob.
  async getLibraryPdfBlob(payload) {
    // PDF publicat: serverul a atașat un URL semnat (bucketul e privat,
    // descărcarea directă merge doar pentru proprietar)
    if (payload?.signedUrl) {
      const r = await fetch(payload.signedUrl);
      if (!r.ok) throw new Error('PDF-ul nu a putut fi descărcat.');
      return await r.blob();
    }
    if (payload?.pdfPath) {
      const { data, error } = await supabase.storage.from(payload.bucket || 'personal-pdfs').download(payload.pdfPath);
      if (error || !data) throw new Error(error?.message || 'PDF-ul nu a putut fi descărcat.');
      return data;
    }
    if (payload?.pdfBase64) {
      const bin = atob(payload.pdfBase64);
      const arr = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
      return new Blob([arr], { type: 'application/pdf' });
    }
    throw new Error('Elementul nu conține un PDF.');
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
    // dacă elementul are un PDF în Storage, îl ștergem și pe acela (best-effort)
    try {
      const { data } = await supabase.from('ai_personal_items').select('payload').eq('id', id).single();
      const p = data?.payload;
      if (p?.pdfPath) await supabase.storage.from(p.bucket || 'personal-pdfs').remove([p.pdfPath]);
    } catch { /* ignorăm — ștergem măcar rândul */ }
    await supabase.from('ai_personal_items').delete().eq('id', id);
  },
};
