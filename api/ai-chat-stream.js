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
const pregen = require('./_lib/pregen');
const pdfpages = require('./_lib/pdfpages'); // userContent: text + pagina PDF atașată (Etapa 2)

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
    const { message, mode = 'tutor', conversationId, context = {}, regenerate = false, images = null, imageThumb = null } = req.body || {};
    // Etapa 3 (4.4): miniatura pozei rămâne în conversație (metadata.image, ≤ 16 KB)
    const thumb = typeof imageThumb === 'string' && /^data:image\/(jpeg|png|webp);base64,/.test(imageThumb) && imageThumb.length <= 16_000 ? imageThumb : null;
    if (!message || !message.trim()) { send({ type: 'error', error: 'message obligatoriu' }); return res.end(); }

    const profile = await ai.requireUser(supa, userId);
    const lim = await ai.enforceRateLimit(supa, userId, profile); // limite orare + bugete (vezi GHID_LIMITE_AI.md)
    await ai.enforceFreeQuota(supa, profile);
    const premium = ai.isPremium(profile);

    // 1-3. RAG + conversație + istoric + system prompt (helper comun cu ai-chat)
    //      regenerate („Regenerează"): răspunsul anterior iese din istoric, iar
    //      întrebarea NU se mai salvează o dată (regenerated=true)
    const { convId, primaryMaterial, priorMsgs, system, sources, baremItem, regenerated, attachments = [], tools = null } =
      await ai.prepareChat(supa, { userId, message, mode, conversationId, context, premium, regenerate: !!regenerate, images });
    send({ type: 'meta', conversationId: convId, sources, primaryMaterial });
    // mesajul user trimis modelului: text (+ pagina PDF a exercițiului, Etapa 2)
    const userContent = pdfpages.userContent(message, attachments);

    // 3½. Explicație PRE-GENERATA (pasul 3): la prima cerere CANONICĂ despre
    // un material din site, trimitem răspunsul deja generat, în bucăți —
    // cost 0, latență ~0. Gard premium inclus.
    let full = '';
    let servedPregen = false;
    if (!baremItem && pregen.canServe({ mode, context, conversationId, message })) {
      const served = await pregen.getServable(supa, { contentId: context.contentId, mode, premium });
      if (served) {
        servedPregen = true;
        full = served.text;
        for (const chunk of full.match(/[\s\S]{1,160}/g) || []) send({ type: 'delta', text: chunk });
      }
    }

    // 4. Generare (dacă nu am servit din pre-generare).
    const stats = {}; // chatStream/verifiedPdfReply pun aici usage-ul + modelul real
    if (servedPregen) {
      // nimic de generat
    } else if (baremItem) {
      // AGENTUL PDF cu rezolvare din barem: generăm ÎNTREG răspunsul, îl
      // VERIFICĂM față de barem (numeric + semantic; reîncercare + fallback)
      // și abia apoi îl trimitem, în bucăți. Elevul nu vede niciodată un
      // răspuns care deviază de la barem.
      const r = await ai.verifiedPdfReply({
        system, baremItem, mode,
        messages: [...priorMsgs, { role: 'user', content: userContent }],
        model: ai.pickModel(ai.PDF_MODEL, lim), // peste bugetul zilnic soft → modelul standard
        tools, stats,
      });
      full = r.text;
      stats.usage = r.usage;
      for (const chunk of full.match(/[\s\S]{1,160}/g) || []) send({ type: 'delta', text: chunk });
    } else {
      // STREAMING LLM (comportamentul de până acum)
      for await (const delta of ai.chatStream({
        system,
        messages: [...priorMsgs, { role: 'user', content: userContent }],
        temperature: mode === 'hint' ? 0.3 : 0.5,
        maxTokens: 900,
        // pe un PDF deschis citește modelul PDF („terra") — și fără barem;
        // explicații pas-cu-pas (tutor/explain/hint) → AI_TUTOR_MODEL (1.4);
        // altfel modelul de chat; peste bugetul zilnic soft → unul mai ieftin
        model: ai.pickModel(ai.chatModelFor(mode, context), lim),
        stats, tools,
      })) {
        full += delta;
        send({ type: 'delta', text: delta });
      }
    }

    // 5. Salvăm după ce s-a terminat streamul. Textul a ajuns deja la client,
    // deci nu rupem streamul dacă persistarea eșuează — dar o logăm.
    if (!regenerated) {
      const { error: uErr } = await supa.from('ai_messages')
        .insert({ conversation_id: convId, role: 'user', content: message, mode, ...(thumb ? { metadata: { image: thumb } } : {}) });
      if (uErr) console.error('ai-chat-stream: salvare mesaj user eșuată:', uErr);
    }
    const { data: saved, error: aErr } = await supa.from('ai_messages')
      .insert({ conversation_id: convId, role: 'assistant', content: full, mode, metadata: { sources, primaryMaterial, ...(stats.tools ? { tools: stats.tools.map((t) => t.name) } : {}) } })
      .select('id').single();
    if (aErr) console.error('ai-chat-stream: salvare răspuns eșuată:', aErr);
    const { error: cErr } = await supa.from('ai_conversations')
      .update({ updated_at: new Date().toISOString() }).eq('id', convId);
    if (cErr) console.error('ai-chat-stream: update conversație eșuat:', cErr);
    // usage-ul REAL din stream (stream_options.include_usage); dacă providerul
    // nu l-a trimis, estimăm ieșirea din lungimea textului, ca înainte.
    // Servirea din pre-generare se loghează separat, cu cost 0.
    await ai.logUsage(supa, userId,
      servedPregen ? 'ai-chat-stream:pregen' : 'ai-chat-stream',
      servedPregen ? { in: 0, out: 0, model: null }
        : (stats.usage || { in: 0, out: Math.ceil(full.length / 4), model: stats.model }));

    send({ type: 'done', messageId: saved?.id || null });
    return res.end();
  } catch (err) {
    console.error('ai-chat-stream error:', err);
    send({ type: 'error', error: err.message || 'Eroare server', code: err.code || null });
    return res.end();
  }
};
