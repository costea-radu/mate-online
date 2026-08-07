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
    const lim = await ai.enforceRateLimit(supa, userId, profile); // limite orare + bugete (vezi GHID_LIMITE_AI.md)
    await ai.enforceFreeQuota(supa, profile);
    const premium = ai.isPremium(profile);

    // 1-3. RAG + conversație + istoric + system prompt (helper comun cu ai-chat-stream)
    const { convId, primaryMaterial, priorMsgs, system, sources, baremItem } =
      await ai.prepareChat(supa, { userId, message, mode, conversationId, context, premium });

    // 4. Apel LLM. Cu rezolvare din barem → generare VERIFICATĂ față de barem.
    const { text, usage } = baremItem
      ? await ai.verifiedPdfReply({
          system, baremItem, mode,
          messages: [...priorMsgs, { role: 'user', content: message }],
          model: ai.pickModel(ai.PDF_MODEL, lim), // peste bugetul zilnic soft → modelul standard
        })
      : await ai.chat({
          system,
          messages: [...priorMsgs, { role: 'user', content: message }],
          temperature: mode === 'hint' ? 0.3 : 0.5,
          maxTokens: 900,
          model: ai.pickModel(ai.CHAT_MODEL, lim), // peste bugetul zilnic soft → modelul economic
        });

    // 5. Salvăm mesajele + actualizăm conversația.
    // Răspunsul e deja generat — nu picăm cererea dacă persistarea eșuează,
    // dar o logăm (altfel istoricul dispare fără nicio urmă).
    const { error: msgErr } = await supa.from('ai_messages').insert([
      { conversation_id: convId, role: 'user', content: message, mode },
      { conversation_id: convId, role: 'assistant', content: text, mode, metadata: { sources, primaryMaterial } },
    ]);
    if (msgErr) console.error('ai-chat: salvare mesaje eșuată:', msgErr);
    const { error: convErr } = await supa.from('ai_conversations')
      .update({ updated_at: new Date().toISOString() }).eq('id', convId);
    if (convErr) console.error('ai-chat: update conversație eșuat:', convErr);
    await ai.logUsage(supa, userId, 'ai-chat', usage);

    return res.status(200).json({ reply: text, conversationId: convId, sources, primaryMaterial });
  } catch (err) {
    console.error('ai-chat error:', err);
    return res.status(err.status || 500).json({ error: err.message || 'Eroare server' });
  }
};
