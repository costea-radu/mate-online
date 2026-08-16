// =====================================================================
// api/ai-chat.js — chat cu Profesorul Virtual (RAG + memorie)
// Body: { userId, message, mode?, conversationId?, context? }
//   mode: 'assistant' | 'tutor' | 'explain' | 'hint'   (default: 'tutor')
//   context: { category?, contentId?, exerciseText? }  (opțional)
// Răspuns: { reply, conversationId, sources }
// =====================================================================
const ai = require('./_lib/ai');
const pregen = require('./_lib/pregen');

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

    // 3½. Explicație PRE-GENERATA (pasul 3): la prima cerere CANONICĂ
    // („explică-mi” / „dă-mi un indiciu”) despre un material din site,
    // servim răspunsul deja generat — cost 0, latență ~0. Gard premium inclus.
    let served = null;
    if (!baremItem && pregen.canServe({ mode, context, conversationId, message })) {
      served = await pregen.getServable(supa, { contentId: context.contentId, mode, premium });
    }

    // 4. Apel LLM (dacă nu am servit din pre-generare).
    //    Cu rezolvare din barem → generare VERIFICATĂ față de barem.
    const { text, usage } = served
      ? { text: served.text, usage: { in: 0, out: 0, model: null } } // fără cost
      : baremItem
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
          // pe un PDF deschis citește modelul PDF („terra") — și fără barem;
          // altfel modelul de chat; peste bugetul zilnic soft → unul mai ieftin
          model: ai.pickModel(context.pdf ? ai.PDF_MODEL : ai.CHAT_MODEL, lim),
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
    // servirea din pre-generare se loghează separat (cost 0) — o vezi în ai_usage_daily
    await ai.logUsage(supa, userId, served ? 'ai-chat:pregen' : 'ai-chat', usage);

    return res.status(200).json({ reply: text, conversationId: convId, sources, primaryMaterial });
  } catch (err) {
    console.error('ai-chat error:', err);
    return res.status(err.status || 500).json({ error: err.message || 'Eroare server' });
  }
};
