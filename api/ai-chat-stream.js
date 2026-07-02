// =====================================================================
// api/ai-chat-stream.js — chat-tutor cu STREAMING (răspuns token cu token)
// Body: { userId, message, mode?, conversationId?, context? }
// Răspuns: flux NDJSON (câte un obiect JSON pe linie):
//   {"type":"meta","conversationId":"...","sources":[...]}
//   {"type":"delta","text":"..."}            (de mai multe ori)
//   {"type":"done","messageId":"..."}
//   {"type":"error","error":"..."}
// =====================================================================
const ai = require('./_lib/ai');

module.exports = async function handler(req, res) {
  ai.applyCors(res);
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method Not Allowed' });

  const supa = ai.admin();
  // Antete de streaming (fără buffering pe proxy)
  res.setHeader('Content-Type', 'application/x-ndjson; charset=utf-8');
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('X-Accel-Buffering', 'no');

  const send = (obj) => { try { res.write(JSON.stringify(obj) + '\n'); } catch { /* clientul a închis */ } };

  try {
    const { userId, message, mode = 'tutor', conversationId, context = {} } = req.body || {};
    if (!message || !message.trim()) { send({ type: 'error', error: 'message obligatoriu' }); return res.end(); }

    const profile = await ai.requireUser(supa, userId);
    await ai.enforceRateLimit(supa, userId);
    await ai.enforceFreeQuota(supa, profile);
    const premium = ai.isPremium(profile);

    // 1. RAG
    const retrievalQuery = [message, context.exerciseText].filter(Boolean).join('\n');
    const docs = await ai.retrieve(supa, { query: retrievalQuery, category: context.category || null, allowPremium: premium, k: 6, prefer: 'solution' });
    const ctxBlock = ai.contextBlock(docs);
    const primaryMaterial = await ai.topMaterial(supa, docs);

    // 2. Conversație (reluare/creare)
    let convId = conversationId || null;
    if (convId) {
      const { data } = await supa.from('ai_conversations').select('id, user_id').eq('id', convId).single();
      if (!data || data.user_id !== userId) convId = null;
    }
    if (!convId) {
      const { data } = await supa.from('ai_conversations')
        .insert({ user_id: userId, title: message.slice(0, 60), context }).select('id').single();
      convId = data?.id;
    }

    // 3. Istoric recent
    const { data: history } = await supa.from('ai_messages')
      .select('role, content').eq('conversation_id', convId)
      .order('created_at', { ascending: false }).limit(10);
    const priorMsgs = (history || []).reverse().map((m) => ({ role: m.role, content: m.content }));

    const sources = docs.map((d) => ({ type: d.source_type, title: d.title, topic: d.topic, category: d.category }));
    send({ type: 'meta', conversationId: convId, sources, primaryMaterial });

    const extra = context.exerciseText ? `\nElevul lucrează la acest exercițiu:\n"""${String(context.exerciseText).slice(0, 1500)}"""` : '';
    const system = ai.systemFor(mode, ctxBlock, extra);

    // 4. STREAMING LLM
    let full = '';
    for await (const delta of ai.chatStream({
      system,
      messages: [...priorMsgs, { role: 'user', content: message }],
      temperature: mode === 'hint' ? 0.3 : 0.5,
      maxTokens: 900,
    })) {
      full += delta;
      send({ type: 'delta', text: delta });
    }

    // 5. Salvăm după ce s-a terminat streamul
    await supa.from('ai_messages').insert({ conversation_id: convId, role: 'user', content: message, mode });
    const { data: saved } = await supa.from('ai_messages')
      .insert({ conversation_id: convId, role: 'assistant', content: full, mode, metadata: { sources, primaryMaterial } })
      .select('id').single();
    await supa.from('ai_conversations').update({ updated_at: new Date().toISOString() }).eq('id', convId);
    await ai.logUsage(supa, userId, 'ai-chat-stream', { in: 0, out: Math.ceil(full.length / 4) });

    send({ type: 'done', messageId: saved?.id || null });
    return res.end();
  } catch (err) {
    console.error('ai-chat-stream error:', err);
    send({ type: 'error', error: err.message || 'Eroare server', code: err.code || null });
    return res.end();
  }
};
