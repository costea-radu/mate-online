// =====================================================================
// api/ai-handwriting.js — „🎓 Cere corectarea" din „✍️ Spațiu de lucru"
//
// Elevul scrie rezolvarea cu degetul / creionul pe foaia albă (SpatiuDeLucru).
// La „Cere corectarea", clientul trimite CHIAR SCRISUL: imaginea foii (tăiată
// în câteva bucăți dacă s-a scris mult spre dreapta — exportSheet). Un model
// de vedere competent (api/_lib/corector.js — implicit Claude Opus 5.5) îl
// citește și îl corectează într-un singur pas, STRICT după barem, unde există:
//   · test PDF din platformă → testul + baremul asociat, citite DE PE SERVER
//     (cache-ul ai_pdf_text), nu din browser;
//   · material din Biblioteca utilizatorilor → textul lui + baremul, unde există
//     (rezolvările testului generat / baremul inclus în PDF), tot de pe server;
//   · exercițiu interactiv → enunțul cu pașii, răspunsurile corecte și
//     indicațiile oficiale (țin loc de barem; modelul nu le dezvăluie);
//   · altfel → doar enunțul (fără puncte, doar verdicte pe pași).
// Până pe 27 octombrie 2026 endpointul doar TRANSCRIA rândurile în LaTeX
// („✨ Transformă în text") — butonul a fost scos: citea greșit scrisul urât.
//
// Body: { action: 'correct', images: [dataUrl, …] (1–6), grid?: {cols, rows},
//         thumb?: dataUrl ≤ 16 KB, conversationId?, context?: { pdf, contentId,
//         libraryId, category, title, meditatii }, exerciseText? }
// Răspuns: { conversationId, messageId, text, puncte, puncteMax, hasBarem,
//            lizibil, itemi, spoken, model }
//
// Acces: DOAR Premium (sau admin) — corectarea face parte din abonament. Oprit
// în timpul unui test pe grupă (e ajutor de la AI). Cotă zilnică proprie
// („scris" în FEATURE_QUOTAS: elev 20/zi; AI_QUOTA_CORECTARI_SCRIS_ZI), plus
// limita orară și creditele, ca orice acțiune AI. Imaginile NU se salvează
// (doar miniatura, în conversație, ca la pozele din chat).
// =====================================================================
const ai = require('./_lib/ai');
const testlock = require('./_lib/testlock');
const corector = require('./_lib/corector');
const pdfContext = require('./ai-pdf-context');

const MAX_IMAGES = 6;
const MAX_IMG_CHARS = 2_200_000;     // o bucată a foii (data URL)
const MAX_TOTAL_CHARS = 4_200_000;   // tot corpul cererii rămâne sub limita Vercel (4,5 MB)
const IMG_RE = /^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/;
const OFICIAL_RE = /\[răspuns corect|Indicația oficială|\[explicația oficială/i;

function cleanImages(list) {
  const out = [];
  let total = 0;
  for (const u of Array.isArray(list) ? list : []) {
    if (typeof u !== 'string' || u.length > MAX_IMG_CHARS || !IMG_RE.test(u)) continue;
    if (total + u.length > MAX_TOTAL_CHARS) break;
    total += u.length;
    out.push(u);
    if (out.length >= MAX_IMAGES) break;
  }
  return out;
}

// De unde vine „baremul" corectării (vezi antetul)
async function resolveSource(supa, profile, body, userId = null) {
  const ctx = body.context && typeof body.context === 'object' ? body.context : {};
  const title = String(ctx.title || '').slice(0, 140);
  const exercise = String(body.exerciseText || ctx.exerciseText || '').trim();
  if (ctx.pdf && ctx.contentId) {
    try {
      const content = await pdfContext.loadContentForUser(supa, ctx.contentId, profile);
      const pc = await pdfContext.getPdfContext(supa, content);
      const test = String(pc.text || '').trim();
      const barem = String(pc.baremText || '').trim();
      if (test.length > 40 || barem.length > 80) {
        return {
          kind: 'pdf', title: String(content.title || title).slice(0, 140), test, barem,
          hasBarem: barem.length > 80, category: content.category || ctx.category || null, contentId: content.id,
        };
      }
    } catch (e) {
      if (e && (e.status === 403 || e.status === 404)) throw e;
      console.warn('ai-handwriting: contextul PDF nu s-a putut citi:', e && e.message);
    }
  }
  // material din Biblioteca utilizatorilor: textul (și baremul — rezolvările testului
  // generat sau baremul inclus în PDF) tot DE PE SERVER, cu verificarea accesului
  if (ctx.libraryId && !ctx.contentId) {
    try {
      const row = await pdfContext.loadLibraryForUser(supa, ctx.libraryId, profile, userId);
      const lc = await pdfContext.libraryContext(supa, row);
      const test = String(lc.text || '').trim();
      const barem = String(lc.baremText || '').trim();
      if (test.length > 40 || barem.length > 80) {
        return {
          kind: 'pdf', title: String(row.title || title).slice(0, 140), test, barem,
          hasBarem: barem.length > 80, category: row.category || ctx.category || null, contentId: null, libraryId: row.id,
        };
      }
    } catch (e) {
      if (e && (e.status === 402 || e.status === 403 || e.status === 404)) throw e;
      console.warn('ai-handwriting: materialul din bibliotecă nu s-a putut citi:', e && e.message);
    }
  }
  if (exercise.length > 20) {
    const oficial = OFICIAL_RE.test(exercise);
    return { kind: oficial ? 'oficial' : 'enunt', title, exercise, hasBarem: oficial, category: ctx.category || null, contentId: ctx.contentId || null };
  }
  return { kind: 'nimic', title, hasBarem: false, category: ctx.category || null, contentId: ctx.contentId || null };
}

// Fiecare apel la model intră în credite; doar corectarea REUȘITĂ consumă din
// cota zilnică (încercarea eșuată, înainte de rezervă, se loghează separat).
async function logAll(supa, userId, usages, ok) {
  const list = Array.isArray(usages) ? usages : [];
  for (let i = 0; i < list.length; i++) {
    const last = i === list.length - 1;
    await ai.logUsage(supa, userId, ok && last ? 'ai-handwriting:correct' : 'ai-handwriting:retry', list[i]);
  }
}

module.exports = async function handler(req, res) {
  ai.applyCors(res);
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method Not Allowed' });

  const supa = ai.admin();
  let userId = null;
  try {
    userId = await ai.authUser(req, supa);
    const profile = await ai.requireUser(supa, userId);
    const body = req.body || {};
    if (body.action && body.action !== 'correct') {
      return res.status(400).json({ error: 'Transformarea în text a fost scoasă — spațiul de lucru trimite acum scrisul direct la corectare.', code: 'ACTION_REMOVED' });
    }

    // Test pe grupă în desfășurare → corectarea (ajutor de la AI) e oprită
    const testul = await testlock.activeTest(supa, userId);
    if (testul.locked) return res.status(423).json({ error: testlock.TEST_MSG_CHAT, code: 'TEST_MODE' });

    // Corectarea face parte din abonamentul Premium
    if (!ai.isPremium(profile)) {
      return res.status(402).json({
        error: 'Corectarea scrisului de mână face parte din abonamentul Premium: profesorul virtual îți citește rezolvarea și o punctează după barem.',
        code: 'PREMIUM_REQUIRED',
      });
    }

    const images = cleanImages(body.images);
    if (!images.length) return res.status(400).json({ error: 'Nu am primit foaia cu rezolvarea. Scrie pe foaie, apoi apasă din nou „🎓 Cere corectarea".' });

    const lim = await ai.enforceRateLimit(supa, userId, profile);      // limita orară + creditele
    await ai.enforceFeatureQuota(supa, userId, profile, 'scris', lim); // cota zilnică a corectărilor de pe foaie

    const src = await resolveSource(supa, profile, body, userId);
    let out;
    try {
      out = await corector.correctHandwriting({ images, grid: body.grid || null, src, lim });
    } catch (e) {
      await logAll(supa, userId, e && e.usages, false);
      console.error('ai-handwriting: corectorul a eșuat:', e && e.message);
      // elevul nu vede mesajul tehnic al furnizorului
      const fr = new Error('Corectarea nu a reușit acum — profesorul virtual nu a putut citi foaia. Mai încearcă o dată peste câteva secunde.');
      fr.status = e && e.status === 429 ? 429 : 502; fr.code = 'CORECTARE_ESUATA';
      throw fr;
    }
    await logAll(supa, userId, out.usages, true);
    const r = out.result;

    // ── corectarea intră în CONVERSAȚIE (istoricul chatului; profesorul o vede
    //    la întrebările următoare) ──
    const thumb = typeof body.thumb === 'string' && /^data:image\/(jpeg|png|webp);base64,/.test(body.thumb) && body.thumb.length <= 16000 ? body.thumb : null;
    const ctx = body.context && typeof body.context === 'object' ? body.context : {};
    let convId = body.conversationId || null, messageId = null;
    try {
      if (convId) {
        const { data } = await supa.from('ai_conversations').select('id, user_id').eq('id', convId).maybeSingle();
        if (!data || data.user_id !== userId) convId = null;
      }
      if (!convId) {
        const { data } = await supa.from('ai_conversations')
          .insert({
            user_id: userId,
            title: `Corectare: ${src.title || 'spațiul de lucru'}`.slice(0, 60),
            context: { pdf: !!ctx.pdf, meditatii: !!ctx.meditatii, contentId: src.contentId || null, libraryId: src.libraryId || null, category: src.category || null, title: src.title || null },
          })
          .select('id').single();
        convId = data?.id || null;
      }
      if (convId) {
        await supa.from('ai_messages').insert({
          conversation_id: convId, role: 'user', mode: 'tutor',
          content: '✍️ Am trimis la corectare rezolvarea scrisă de mână din spațiul de lucru.',
          ...(thumb ? { metadata: { image: thumb } } : {}),
        });
        const { data: saved } = await supa.from('ai_messages')
          .insert({
            conversation_id: convId, role: 'assistant', mode: 'tutor', content: out.text,
            metadata: { handwriting: { puncte: r.puncte, puncteMax: r.puncteMax, hasBarem: !!src.hasBarem, model: out.model } },
          })
          .select('id').single();
        messageId = saved?.id || null;
        await supa.from('ai_conversations').update({ updated_at: new Date().toISOString() }).eq('id', convId);
      }
    } catch (e) { console.warn('ai-handwriting: salvarea în conversație a eșuat:', e.message); }

    return res.status(200).json({
      conversationId: convId, messageId,
      text: out.text,
      puncte: r.puncte, puncteMax: r.puncteMax, hasBarem: !!src.hasBarem,
      lizibil: r.lizibil, itemi: r.itemi,
      spoken: r.feedback || '',
      model: out.model,
    });
  } catch (err) {
    if (!err.status) console.error('ai-handwriting error:', err);
    return res.status(err.status || 500).json({ error: err.message || 'Eroare server', code: err.code || null });
  }
};

// exportate pentru teste
module.exports.cleanImages = cleanImages;
module.exports.resolveSource = resolveSource;
