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
    const userId = await ai.authUser(req, supa);
    const { message, mode = 'tutor', conversationId, context = {} } = req.body || {};
    if (!message || !message.trim()) { send({ type: 'error', error: 'message obligatoriu' }); return res.end(); }

    const profile = await ai.requireUser(supa, userId);
    await ai.enforceRateLimit(supa, userId);
    await ai.enforceFreeQuota(supa, profile);
    const premium = ai.isPremium(profile);

    // 1-3. RAG + conversație + istoric + system prompt (helper comun cu ai-chat)
    const { convId, primaryMaterial, priorMsgs, system, sources, baremItem } =
      await ai.prepareChat(supa, { userId, message, mode, conversationId, context, premium });
    send({ type: 'meta', conversationId: convId, sources, primaryMaterial });

    // 4. Generare.
    let full = '';
    if (baremItem) {
      // AGENTUL PDF cu rezolvare din barem: generăm ÎNTREG răspunsul, îl
      // VERIFICĂM față de barem (numeric + semantic; reîncercare + fallback)
      // și abia apoi îl trimitem, în bucăți. Elevul nu vede niciodată un
      // răspuns care deviază de la barem.
      const r = await ai.verifiedPdfReply({
        system, baremItem, mode,
        messages: [...priorMsgs, { role: 'user', content: message }],
      });
      full = r.text;
      for (const chunk of full.match(/[\s\S]{1,160}/g) || []) send({ type: 'delta', text: chunk });
    } else {
      // STREAMING LLM (comportamentul de până acum)
      for await (const delta of ai.chatStream({
        system,
        messages: [...priorMsgs, { role: 'user', content: message }],
        temperature: mode === 'hint' ? 0.3 : 0.5,
        maxTokens: 900,
      })) {
        full += delta;
        send({ type: 'delta', text: delta });
      }
    }

    // 5. Salvăm după ce s-a terminat streamul. Textul a ajuns deja la client,
    // deci nu rupem streamul dacă persistarea eșuează — dar o logăm.
    const { error: uErr } = await supa.from('ai_messages')
      .insert({ conversation_id: convId, role: 'user', content: message, mode });
    if (uErr) console.error('ai-chat-stream: salvare mesaj user eșuată:', uErr);
    const { data: saved, error: aErr } = await supa.from('ai_messages')
      .insert({ conversation_id: convId, role: 'assistant', content: full, mode, metadata: { sources, primaryMaterial } })
      .select('id').single();
    if (aErr) console.error('ai-chat-stream: salvare răspuns eșuată:', aErr);
    const { error: cErr } = await supa.from('ai_conversations')
      .update({ updated_at: new Date().toISOString() }).eq('id', convId);
    if (cErr) console.error('ai-chat-stream: update conversație eșuat:', cErr);
    await ai.logUsage(supa, userId, 'ai-chat-stream', { in: 0, out: Math.ceil(full.length / 4) });

    send({ type: 'done', messageId: saved?.id || null });
    return res.end();
  } catch (err) {
    console.error('ai-chat-stream error:', err);
    send({ type: 'error', error: err.message || 'Eroare server', code: err.code || null });
    return res.end();
  }
};
