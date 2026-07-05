// =====================================================================
// api/ai-chat.js — chat cu Profesorul Virtual (RAG + memorie)
// Body: { userId, message, mode?, conversationId?, context? }
//   mode: 'assistant' | 'tutor' | 'explain' | 'hint'   (default: 'tutor')
//   context: { category?, contentId?, exerciseText? }  (opțional)
// Răspuns: { reply, conversationId, sources }
// =====================================================================
const ai = require('./_lib/ai');

module.exports = async function handler(req, res) {
  ai.applyCors(res);
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method Not Allowed' });

  const supa = ai.admin();
  try {
    const userId = await ai.authUser(req, supa);
    const { message, mode = 'tutor', conversationId, context = {} } = req.body || {};
    if (!message || !message.trim()) return res.status(400).json({ error: 'message obligatoriu' });

    const profile = await ai.requireUser(supa, userId);
    await ai.enforceRateLimit(supa, userId);
    await ai.enforceFreeQuota(supa, profile);
    const premium = ai.isPremium(profile);

    // 1. Recuperare context relevant (RAG). Întrebarea + textul exercițiului (dacă există).
    const retrievalQuery = [message, context.exerciseText].filter(Boolean).join('\n');
    const docs = await ai.retrieve(supa, {
      query: retrievalQuery,
      category: context.category || null,
      allowPremium: premium,
      k: 6,
      prefer: 'solution', // la explicații, prioritizează baremele/rezolvările
    });
    const ctxBlock = ai.contextBlock(docs);
    const primaryMaterial = await ai.topMaterial(supa, docs);

    // 2. Conversație: o reluăm sau o creăm.
    let convId = conversationId || null;
    if (convId) {
      const { data } = await supa.from('ai_conversations').select('id, user_id').eq('id', convId).single();
      if (!data || data.user_id !== userId) convId = null; // nu e a lui → ignorăm
    }
    if (!convId) {
      const { data } = await supa.from('ai_conversations')
        .insert({ user_id: userId, title: message.slice(0, 60), context })
        .select('id').single();
      convId = data?.id;
    }

    // 3. Istoric recent (ultimele 10 mesaje) pentru context conversațional.
    const { data: history } = await supa.from('ai_messages')
      .select('role, content').eq('conversation_id', convId)
      .order('created_at', { ascending: false }).limit(10);
    const priorMsgs = (history || []).reverse().map((m) => ({ role: m.role, content: m.content }));

    const extra = context.exerciseText
      ? `\nElevul lucrează la acest exercițiu:\n"""${String(context.exerciseText).slice(0, 1500)}"""`
      : '';
    const system = ai.systemFor(mode, ctxBlock, extra);

    // 4. Apel LLM.
    const { text, usage } = await ai.chat({
      system,
      messages: [...priorMsgs, { role: 'user', content: message }],
      temperature: mode === 'hint' ? 0.3 : 0.5,
      maxTokens: 900,
    });

    // 5. Salvăm mesajele + actualizăm conversația.
    const sources = docs.map((d) => ({ type: d.source_type, title: d.title, topic: d.topic, category: d.category }));
    await supa.from('ai_messages').insert([
      { conversation_id: convId, role: 'user', content: message, mode },
      { conversation_id: convId, role: 'assistant', content: text, mode, metadata: { sources, primaryMaterial } },
    ]);
    await supa.from('ai_conversations').update({ updated_at: new Date().toISOString() }).eq('id', convId);
    await ai.logUsage(supa, userId, 'ai-chat', usage);

    return res.status(200).json({ reply: text, conversationId: convId, sources, primaryMaterial });
  } catch (err) {
    console.error('ai-chat error:', err);
    return res.status(err.status || 500).json({ error: err.message || 'Eroare server' });
  }
};
