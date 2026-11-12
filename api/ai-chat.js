// =====================================================================
// api/ai-chat.js — chat cu Profesorul Virtual (RAG + memorie)
// Body: { userId, message, mode?, conversationId?, context? }
//   mode: 'assistant' | 'tutor' | 'explain' | 'hint'   (default: 'tutor')
//   context: { category?, contentId?, exerciseText? }  (opțional)
// Răspuns: { reply, conversationId, sources }
// =====================================================================
const ai = require('./_lib/ai');
const testlock = require('./_lib/testlock');
const pregen = require('./_lib/pregen');
const pdfpages = require('./_lib/pdfpages'); // userContent: text + pagina PDF atașată (Etapa 2)
const siteGuide = require('./_lib/siteGuide'); // întrebările care nu-s de matematică → ghidul site-ului (fără model)

module.exports = async function handler(req, res) {
  ai.applyCors(res);
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method Not Allowed' });

  const supa = ai.admin();
  try {
    const userId = await ai.authUser(req, supa);
    const { message, mode = 'tutor', conversationId, context = {}, regenerate = false, images = null, imageThumb = null } = req.body || {};
    // Etapa 3 (4.4): miniatura pozei rămâne în conversație (metadata.image, ≤ 16 KB)
    const thumb = typeof imageThumb === 'string' && /^data:image\/(jpeg|png|webp);base64,/.test(imageThumb) && imageThumb.length <= 16_000 ? imageThumb : null;
    if (!message || !message.trim()) return res.status(400).json({ error: 'message obligatoriu' });

    const profile = await ai.requireUser(supa, userId);

    // În timpul unui TEST PE GRUPĂ, Profesorul Virtual e oprit: elevul nu poate
    // cere ajutor. Corectarea („Răspunde în chat", api/ai-correct.js) rămâne
    // pornită — la testele PDF ea duce punctajul la profesor.
    const testul = await testlock.activeTest(supa, userId);
    if (testul.locked) return res.status(423).json({ error: testlock.TEST_MSG_CHAT, code: 'TEST_MODE' });

    // 0. GHIDUL SITE-ULUI (fără model, cost 0) — vezi api/ai-chat-stream.js și api/_lib/siteGuide.js
    const ghid = siteGuide.route({ message, mode, context, conversationId, images, regenerate: !!regenerate });
    if (ghid) {
      const reply = siteGuide.answer(ghid);
      const convId = await ai.openConversation(supa, { userId, conversationId, message, context });
      const { error: gErr } = await supa.from('ai_messages').insert([
        { conversation_id: convId, role: 'user', content: message, mode },
        { conversation_id: convId, role: 'assistant', content: reply, mode, metadata: { sources: [], ghid: ghid.kind } },
      ]);
      if (gErr) console.error('ai-chat (ghid): salvare mesaje eșuată:', gErr);
      await supa.from('ai_conversations').update({ updated_at: new Date().toISOString() }).eq('id', convId);
      return res.status(200).json({ reply, conversationId: convId, sources: [], primaryMaterial: null, aiBudget: null });
    }

    // 0½. Explicație PRE-GENERATĂ (pasul 3 din GHID_LIMITE_AI.md): la prima cerere
    // CANONICĂ („explică-mi" / „dă-mi un indiciu") despre un material din site,
    // servim răspunsul deja generat — cost 0, latență ~0, gard premium inclus.
    // ÎNAINTEA limitelor și a RAG-ului: nu consumă acțiunile AI gratuite și nu
    // mai calculează embeddings pentru un răspuns care există deja.
    const gata = await pregen.serveFirst(supa, { userId, profile, message, mode, conversationId, context, images, regenerate: !!regenerate, endpoint: 'ai-chat' });
    if (gata) return res.status(200).json({ reply: gata.text, conversationId: gata.convId, sources: gata.sources, primaryMaterial: null, aiBudget: null });

    const lim0 = await ai.enforceRateLimit(supa, userId, profile); // limite orare + bugete (vezi GHID_LIMITE_AI.md)
    // după acțiunile de probă: întrebările gratuite ale zilei (dacă sunt pornite) → modelul economic
    const lim = ai.limitsFor(lim0, await ai.enforceFreeQuota(supa, profile, { chat: true }));
    const premium = ai.isPremium(profile);

    // 1-3. RAG + conversație + istoric + system prompt (helper comun cu ai-chat-stream)
    const { convId, primaryMaterial, priorMsgs, system, sources, baremItem, regenerated, attachments = [], tools = null } =
      await ai.prepareChat(supa, { userId, message, mode, conversationId, context, premium, regenerate: !!regenerate, images });
    const userContent = pdfpages.userContent(message, attachments); // text (+ pagina PDF, Etapa 2)

    // 4. Apel LLM. Cu rezolvare din barem → generare VERIFICATĂ față de barem.
    const stats = {}; // uneltele folosite (tool calling, Etapa 3) — pentru jurnal
    const { text: reply, usage } = baremItem
      ? await ai.verifiedPdfReply({
          system, baremItem, mode,
          messages: [...priorMsgs, { role: 'user', content: userContent }],
          model: ai.pickModel(ai.PDF_MODEL, lim), // peste bugetul zilnic soft → modelul standard
          tools, stats,
        })
      : await ai.chat({
          system,
          messages: [...priorMsgs, { role: 'user', content: userContent }],
          temperature: mode === 'hint' ? 0.3 : 0.5,
          maxTokens: 900,
          tools, stats,
          // pe un PDF deschis citește modelul PDF („terra") — și fără barem;
          // explicații pas-cu-pas (tutor/explain/hint) → AI_TUTOR_MODEL (1.4);
          // altfel modelul de chat; peste bugetul zilnic soft → unul mai ieftin
          model: ai.pickModel(ai.chatModelFor(mode, context), lim),
        });
    // sub o explicație de matematică (în widgetul general): unde exersează pe site
    const text = baremItem ? reply
      : reply + siteGuide.footer({ message, context, mode, priorCount: priorMsgs.length, reply });

    // 5. Salvăm mesajele + actualizăm conversația.
    // Răspunsul e deja generat — nu picăm cererea dacă persistarea eșuează,
    // dar o logăm (altfel istoricul dispare fără nicio urmă).
    const { error: msgErr } = await supa.from('ai_messages').insert([
      // la „Regenerează" întrebarea e deja salvată — doar răspunsul nou
      ...(regenerated ? [] : [{ conversation_id: convId, role: 'user', content: message, mode, ...(thumb ? { metadata: { image: thumb } } : {}) }]),
      { conversation_id: convId, role: 'assistant', content: text, mode, metadata: { sources, primaryMaterial, ...(stats.tools ? { tools: stats.tools.map((t) => t.name) } : {}) } },
    ]);
    if (msgErr) console.error('ai-chat: salvare mesaje eșuată:', msgErr);
    const { error: convErr } = await supa.from('ai_conversations')
      .update({ updated_at: new Date().toISOString() }).eq('id', convId);
    if (convErr) console.error('ai-chat: update conversație eșuat:', convErr);
    await ai.logUsage(supa, userId, 'ai-chat', usage);

    // `aiBudget`: cât din creditele lunii s-au dus (praguri 50/75/90/95%).
    // Vine gratis, odată cu răspunsul — interfața avertizează exact în clipa
    // în care elevul consumă, fără nicio cerere în plus.
    return res.status(200).json({ reply: text, conversationId: convId, sources, primaryMaterial, aiBudget: ai.budgetNotice(lim) });
  } catch (err) {
    console.error('ai-chat error:', err);
    // `code` ajunge la client (BUDGET_MONTH → banda „creditele s-au terminat")
    return res.status(err.status || 500).json({ error: err.message || 'Eroare server', code: err.code || null });
  }
};
