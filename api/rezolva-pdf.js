// =====================================================================
// api/rezolva-pdf.js — „✏️ Rezolvă pe PDF" → „✅ Corectează" (7 nov. 2026)
//
// Elevul a rezolvat un test de Evaluare Națională DIRECT PE PDF (stratul
// invizibil de scris de peste pagini — src/components/PdfInkLayer.jsx): a
// încercuit litera la grilele de la Subiectele I și II și a scris rezolvările la
// Subiectul al III-lea. Browserul a făcut harta testului (src/lib/pdfRezolvare.js)
// și a recunoscut variantele încercuite; aici:
//   1. GRILELE se punctează după tabelul BAREMULUI (de pe server — ai_pdf_text),
//      fără AI: 5p sau 0p.
//   2. SCRISUL DE MÂNĂ (imaginile zonelor din pagini, cu scrisul pe ele) îl citește
//      și îl punctează corectorul (api/_lib/corector.js — implicit Claude Opus 5.5),
//      strict după barem; aceeași cotă zilnică „✍️ Corectări de pe foaia de lucru"
//      și aceleași credite.
//   Corectarea e o funcție PREMIUM (8 nov. 2026, cererea lui Radu: „un singur buton,
//   care funcționează doar cu premium, dar utilizatorul are două corectări gratuite
//   a grilei, apoi îndemnul spre Premium"). Fără abonament: GRILA se corectează
//   gratuit de PDF_GRILA_GRATUITE ori (implicit 2) — numărate în ai_usage, sub
//   „rezolva-pdf:grila" (nu sunt cereri AI: nu consumă acțiunile AI gratuite, nici
//   limita orară — ai.NU_E_CERERE_AI) —, apoi 402 cu îndemnul spre Premium.
//   3. Testul ÎNTREG, corectat complet (toate trei subiectele atinse, totul
//      punctat), intră în `progress` — ca la „📝 Răspunde în chat": la profesor,
//      părinte, în „Rezultatele mele"; o corectare parțială doar se arată.
//   4. Corectarea intră în CONVERSAȚIA Profesorului Virtual (se poate întreba mai departe).
//
// Body: { context: { contentId | libraryId, title, category }, conversationId?,
//         grile: [{ key:'1.3', litere:['b'], cum }], nerecunoscute: [{ key, motiv }],
//         scris: ['3.1', …], images: [{ url, label }] (≤ 6), harta, structura:'6-6-6',
//         durationSec, thumb? }
// Răspuns: { items, score, total, nota, complete, pending, premiumNeeded, saved,
//            conversationId, messageId, text, aiError, gratuite: { folosite, total, ramase } | null }
// =====================================================================
const ai = require('./_lib/ai');
const B = require('./_lib/barem');
const R = require('./_lib/pdfRezolvare');
const corector = require('./_lib/corector');
const testlock = require('./_lib/testlock');
const med = require('./_lib/meditatii');
const xp = require('./_lib/xp');
const duel = require('./_lib/duel');
const turneu = require('./_lib/turneu');
const pdfContext = require('./ai-pdf-context');
const correct = require('./ai-correct');          // saveProgress / saveUploadResult
const aiPublic = require('./ai-public');           // recordPublicResult (Biblioteca utilizatorilor)

// corectările GRATUITE ale grilei, pentru un cont fără abonament (apoi: Premium)
const GRATUITE = Math.max(0, parseInt(process.env.PDF_GRILA_GRATUITE || '2', 10) || 0);
const EP_GRATUIT = 'rezolva-pdf:grila';
const MSG_PREMIUM_III = 'Corectarea rezolvării scrise de mână (Subiectul al III-lea) face parte din abonamentul Premium: profesorul virtual îți citește scrisul și îl punctează după barem.';
const msgGratuiteGata = (n) => `Ai folosit ${n === 1 ? 'corectarea gratuită a grilei' : `cele ${n} corectări gratuite ale grilei`}. Corectarea de pe PDF — grila după barem și Subiectul al III-lea, citit de profesorul virtual — face parte din abonamentul Premium.`;

// testul + baremul, DE PE SERVER (cu verificarea accesului)
async function loadSource(supa, profile, ctx, userId) {
  const title = String(ctx.title || '').slice(0, 140);
  if (ctx.contentId) {
    const content = await pdfContext.loadContentForUser(supa, ctx.contentId, profile);
    const pc = await pdfContext.getPdfContext(supa, content);
    const barem = String(pc.baremText || '').trim();
    return {
      title: String(content.title || title).slice(0, 140), test: String(pc.text || '').trim(), barem: barem.length > 80 ? barem : '',
      hasBarem: barem.length > 80, category: content.category || ctx.category || null, contentId: content.id, libraryId: null,
      difficulty: content.difficulty || null,
    };
  }
  if (ctx.libraryId) {
    const row = await pdfContext.loadLibraryForUser(supa, ctx.libraryId, profile, userId);
    const lc = await pdfContext.libraryContext(supa, row);
    const barem = String(lc.baremText || '').trim();
    return {
      title: String(row.title || title).slice(0, 140), test: String(lc.text || '').trim(), barem: barem.length > 80 ? barem : '',
      hasBarem: barem.length > 80, category: row.category || ctx.category || null, contentId: null, libraryId: row.id,
    };
  }
  return null;
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
    const ctx = body.context && typeof body.context === 'object' ? body.context : {};
    const q = R.cleanBody(body);
    if (!q.grile.length && !q.nerecunoscute.length && !q.scris.length && !q.images.length) {
      return res.status(400).json({ error: 'Încercuiește răspunsurile sau scrie rezolvarea pe PDF, apoi apasă „✅ Corectează".' });
    }

    // Test pe grupă în desfășurare → corectarea e oprită (e ajutor)
    const testul = await testlock.activeTest(supa, userId);
    if (testul.locked) return res.status(423).json({ error: testlock.TEST_MSG_CHAT, code: 'TEST_MODE' });

    // Fără abonament: doar grila, de cel mult GRATUITE ori; apoi îndemnul spre Premium
    const premium = ai.isPremium(profile);
    let gratuite = null;
    if (!premium) {
      if (!q.grile.length) {
        if (q.nerecunoscute.length) {
          return res.status(400).json({ error: 'N-am văzut nicio literă încercuită clar la grile — încercuiește litera răspunsului ales, apoi apasă din nou „✅ Corectează".', code: 'GRILA_NERECUNOSCUTA' });
        }
        return res.status(402).json({ error: MSG_PREMIUM_III, code: 'PREMIUM_REQUIRED' });
      }
      const { count } = await supa.from('ai_usage').select('*', { count: 'exact', head: true }).eq('user_id', userId).eq('endpoint', EP_GRATUIT);
      const used = count || 0;
      if (used >= GRATUITE) {
        return res.status(402).json({ error: msgGratuiteGata(GRATUITE), code: 'PREMIUM_REQUIRED', gratuite: { folosite: used, total: GRATUITE, ramase: 0 } });
      }
      gratuite = { folosite: used + 1, total: GRATUITE, ramase: Math.max(0, GRATUITE - used - 1) };
    }

    const src = await loadSource(supa, profile, ctx, userId);
    if (!src) return res.status(400).json({ error: 'Nu știu ce test corectez — deschide din nou PDF-ul.' });
    const keyMap = src.barem ? B.grilaAnswers(src.barem) : {};

    // 1) grilele, după barem (fără AI)
    const g = R.gradeGrile(q.grile, q.nerecunoscute, src.barem);

    // 2) scrisul de mână → corectorul (Premium). Fără abonament, browserul nici nu
    //    trimite imaginile: itemii scriși rămân „⭐ Premium", grilele se corectează.
    const wantsAi = q.scris.length > 0 || q.images.length > 0 || (g.faraCheie.length > 0 && !!src.test);
    const premiumNeeded = wantsAi && !premium;
    const canAi = premium && (q.images.length > 0 || (g.faraCheie.length > 0 && !!src.test));
    let aiOut = null, aiError = null, model = null;
    if (premium && q.scris.length && !q.images.length) aiError = 'Nu am primit imaginea zonelor scrise de mână — mai apasă o dată „✅ Corectează".';
    if (canAi) {
      const lim = await ai.enforceRateLimit(supa, userId, profile);       // limita orară + creditele
      await ai.enforceFeatureQuota(supa, userId, profile, 'scris', lim);  // cota zilnică a corectărilor de scris
      try {
        const r = await corector.correctJson({
          system: R.SYSTEM,
          text: R.userText({ src, harta: q.harta, scris: q.images.length ? q.scris : [], faraCheie: g.faraCheie, nImages: q.images.length }),
          images: q.images, labels: q.images.length ? q.labels.map((l, i) => l || `Imaginea ${i + 1} din ${q.images.length}:`) : null,
          schema: R.schema(ai.S), schemaName: 'corectare_pdf', maxTokens: 9000, lim,
        });
        // doar corectarea reușită se numără în cota zilnică (ca în api/ai-handwriting.js)
        for (let i = 0; i < r.usages.length; i++) {
          await ai.logUsage(supa, userId, i === r.usages.length - 1 ? 'ai-handwriting:correct' : 'ai-handwriting:retry', r.usages[i]);
        }
        model = r.model;
        aiOut = R.normalizeAi(r.data, { want: q.harta ? (q.images.length ? q.scris : []) : null, faraCheie: g.faraCheie, hasBarem: src.hasBarem, structura: q.structura, keyMap });
      } catch (e) {
        for (const u of (e && e.usages) || []) await ai.logUsage(supa, userId, 'ai-handwriting:retry', u);
        console.error('rezolva-pdf: corectorul a eșuat:', e && e.message);
        if (e && e.status === 429) throw e;
        aiError = 'Scrisul de mână nu s-a putut corecta acum — mai apasă o dată „✅ Corectează" peste câteva secunde.';
      }
    }

    // 3) toate rezultatele (itemii la care s-a lucrat); ce n-a putut fi corectat
    //    rămâne „⭐ Premium" (fără abonament) sau „necorectat" (o pană) — nu „greșit"
    const items = [...g.results];
    if (aiOut) items.push(...aiOut.items.filter((it) => !items.some((x) => x.key === it.key)));
    const have = new Set(items.map((it) => it.key));
    for (const key of q.scris) {
      if (have.has(key)) continue;
      const [s, ex] = key.split('.').map(Number);
      items.push({
        key, s, ex, tip: s === 3 ? 'scris' : 'grila', eticheta: R.longName(key), sursa: 'corector', parti: [], transcriere: '',
        verdict: premiumNeeded ? 'blocat' : 'neclar', blocat: premiumNeeded, puncte: null, puncte_max: R.itemMax(key, q.structura),
        motiv: premiumNeeded ? '' : 'nu s-a putut corecta acum',
      });
    }
    for (const fk of g.faraCheie) {
      if (have.has(fk.key)) continue;
      const [s, ex] = fk.key.split('.').map(Number);
      items.push({ key: fk.key, s, ex, tip: 'grila', eticheta: R.longName(fk.key), litera: fk.litere[0], litere: fk.litere, verdict: premiumNeeded ? 'blocat' : 'neclar', blocat: premiumNeeded, puncte: null, puncte_max: 5, motiv: 'baremul nu dă litera acestui item' });
    }
    items.sort((a, b) => (a.s - b.s) || (a.ex - b.ex));
    const sum = R.summarize(items, { structura: q.structura });
    const nota = sum.complete && sum.total ? med.notaTest(sum.score, sum.total) : null;

    // 4) testul întreg, corectat complet → rezultatele elevului (ca la „Răspunde în chat")
    let saved = null;
    if (sum.complete) {
      try {
        if (src.contentId) {
          const r = await correct.saveProgress(supa, userId, { contentId: src.contentId, title: src.title, category: src.category, score: sum.score, maxScore: sum.total, sessionSeconds: q.durationSec });
          saved = { kind: 'progress', attempts: r.attempts };
          try {
            const pct = Math.round((sum.score / sum.total) * 100);
            const gami = await xp.award(supa, userId, {
              source: 'pdf', refId: src.contentId, content: { category: src.category, difficulty: src.difficulty },
              score: sum.score, maxScore: sum.total, attempts: r.attempts, meta: { titlu: src.title || null },
            });
            await duel.recordByContent(supa, userId, src.contentId, { score: sum.score, maxScore: sum.total });
            if (gami && gami.xpExercitiu > 0) await turneu.recordScore(supa, userId, src.contentId, { points: gami.xpExercitiu, pct });
          } catch (e) { console.warn('rezolva-pdf gamificare:', e.message); }
        } else if (src.libraryId) {
          const r = await correct.saveUploadResult(supa, userId, {
            title: src.title, category: src.category, score: sum.score, maxScore: sum.total, sessionSeconds: q.durationSec,
            breakdown: items.map((it) => ({ id: it.key, eticheta: it.eticheta, puncte: it.puncte, maxPuncte: it.puncte_max, verdict: it.verdict })),
            feedback: aiOut ? aiOut.feedback : '', testText: src.test,
          });
          saved = { kind: 'upload', attempts: r.attempts };
          try { await aiPublic.recordPublicResult(supa, { publicId: src.libraryId, userId, profile, score: sum.score, maxScore: sum.total }); }
          catch (e) { console.warn('rezolva-pdf: rezultatul din bibliotecă nu s-a salvat:', e.message); }
        }
      } catch (e) {
        console.error('rezolva-pdf: salvarea punctajului a eșuat:', e.message);
        saved = { kind: 'nesalvat' };
      }
    }

    // corectarea gratuită a grilei s-a făcut → se numără (nu e cerere AI: cost 0)
    if (gratuite) await ai.logUsage(supa, userId, EP_GRATUIT, { in: 0, out: 0, model: null });

    // 5) mesajul profesorului, în conversație
    const text = R.formatMessage({
      items, sum, structura: q.structura, title: src.title, hasBarem: src.hasBarem,
      feedback: aiOut ? aiOut.feedback : '', sfat: aiOut ? aiOut.sfat : '', nota, premiumNeeded, gratuite,
    }) + (aiError ? `\n\n⚠️ ${aiError}` : '');
    let convId = body.conversationId || null, messageId = null;
    try {
      if (convId) {
        const { data } = await supa.from('ai_conversations').select('id, user_id').eq('id', convId).maybeSingle();
        if (!data || data.user_id !== userId) convId = null;
      }
      if (!convId) {
        const { data } = await supa.from('ai_conversations')
          .insert({
            user_id: userId, title: `Rezolvare pe PDF: ${src.title || 'test'}`.slice(0, 60),
            context: { pdf: true, contentId: src.contentId || null, libraryId: src.libraryId || null, category: src.category || null, title: src.title || null },
          })
          .select('id').single();
        convId = data?.id || null;
      }
      if (convId) {
        await supa.from('ai_messages').insert({
          conversation_id: convId, role: 'user', mode: 'tutor',
          content: '✏️ Am rezolvat testul direct pe PDF și am apăsat „✅ Corectează".',
          ...(q.thumb ? { metadata: { image: q.thumb } } : {}),
        });
        const { data: m } = await supa.from('ai_messages')
          .insert({
            conversation_id: convId, role: 'assistant', mode: 'tutor', content: text,
            metadata: { pdfSolve: { score: sum.score, total: sum.total, complete: sum.complete, model } },
          })
          .select('id').single();
        messageId = m?.id || null;
        await supa.from('ai_conversations').update({ updated_at: new Date().toISOString() }).eq('id', convId);
      }
    } catch (e) { console.warn('rezolva-pdf: salvarea în conversație a eșuat:', e.message); }

    // pentru marcajele de pe PDF: fără pașii lungi
    const marks = items.map((it) => ({
      key: it.key, tip: it.tip, verdict: it.blocat ? 'blocat' : it.verdict, puncte: it.puncte, puncte_max: it.puncte_max,
      litera: it.litera || null, parti: (it.parti || []).map((p) => ({ l: p.l, verdict: p.verdict, puncte: p.puncte, puncte_max: p.puncte_max })),
    }));
    return res.status(200).json({
      items: marks, score: sum.score, total: sum.total, gradedMax: sum.gradedMax, nota, complete: sum.complete, pending: sum.pending,
      premiumNeeded, saved, conversationId: convId, messageId, text, aiError, hasBarem: src.hasBarem, model, gratuite,
    });
  } catch (err) {
    if (!err.status) console.error('rezolva-pdf error:', err);
    return res.status(err.status || 500).json({ error: err.message || 'Eroare server', code: err.code || null });
  }
};

module.exports.loadSource = loadSource;
module.exports.GRATUITE = GRATUITE;
module.exports.EP_GRATUIT = EP_GRATUIT;
