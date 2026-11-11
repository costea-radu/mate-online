// =====================================================================
// api/ai-handwriting.js — „🎓 Cere corectarea" de pe „✍️ Foaia de lucru"
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
//            lizibil, itemi, spoken, model, nota, score, total, saved }
//
// 🔴 NOTA (11 nov. 2026 — „fă să se treacă nota cu roșu și pe PDF"): la un subiect
// de examen din platformă (Evaluare Națională / Bacalaureat, cu baremul oficial: 90 de
// puncte + 10 din oficiu) corectarea foii dă și NOTA TESTULUI, ca „✏️ Rezolvă pe PDF":
// ce nu e scris pe foaie are 0 puncte. Nota se salvează în rezultatele elevului
// (`progress`, ultima corectare contează; aceeași corectare repetată în 30 de minute nu
// mai numără o încercare) și vizualizatorul o scrie cu roșu pe prima pagină.
//
// Acces: DOAR Premium (sau admin) — corectarea face parte din abonament. Oprit
// în timpul unui test pe grupă (e ajutor de la AI). Cotă zilnică proprie
// („scris" în FEATURE_QUOTAS: elev 20/zi; AI_QUOTA_CORECTARI_SCRIS_ZI), plus
// limita orară și creditele, ca orice acțiune AI. Imaginile NU se salvează
// (doar miniatura, în conversație, ca la pozele din chat).
// =====================================================================
const ai = require('./_lib/ai');
const testlock = require('./_lib/testlock');
const pregatire = require('./_lib/pregatireZilnica'); // „🎯 Pregătește-mă de examen": exercițiile de pe foaie se numără
const corector = require('./_lib/corector');
const pdfContext = require('./ai-pdf-context');
const med = require('./_lib/meditatii');            // notaTest (cu cele 10 puncte din oficiu)
const correct = require('./ai-correct');            // saveProgress / saveUploadResult

const EXAMENE_OFICIALE = ['evaluare-nationala', 'bacalaureat'];
const PUNCTE_EXAMEN = 90;          // + 10 din oficiu = 100
const NESCHIMBAT_MIN = 30;         // aceeași corectare, din nou, în atâtea minute → nu mai e o încercare

// Nota testului din corectarea foii: doar la subiectele de examen cu barem oficial
// (EN / BAC: „Se acordă 10 puncte din oficiu"). → { nota, score, total } | null
function notaDinFoaie(src, r) {
  if (!src || src.kind !== 'pdf' || !src.hasBarem) return null;
  if (!EXAMENE_OFICIALE.includes(src.category)) return null;
  if (!/oficiu/i.test(String(src.barem || ''))) return null;
  const p = r ? Number(r.puncte) : NaN;
  if (!r || r.puncte == null || !Number.isFinite(p)) return null;
  const score = Math.round(Math.max(0, Math.min(PUNCTE_EXAMEN, p)) * 100) / 100;
  return { nota: med.notaTest(score, PUNCTE_EXAMEN), score, total: PUNCTE_EXAMEN };
}
const fmtNota = (n) => Number(n).toFixed(2).replace('.', ',');

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
      return res.status(400).json({ error: 'Transformarea în text a fost scoasă — foaia de lucru trimite acum scrisul direct la corectare.', code: 'ACTION_REMOVED' });
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

    // 🔴 nota testului (subiect de examen cu barem) — în chat, în rezultate și pe PDF
    const notaT = notaDinFoaie(src, r);
    if (notaT) {
      out.text = `${out.text}\n\n📝 **Nota pe test: ${fmtNota(notaT.nota)}** (${notaT.score}/${notaT.total} puncte + 10 din oficiu) — e scrisă cu roșu sus, pe prima pagină a testului. Ce nu ai scris încă pe foaie are 0 puncte: continuă și cere din nou corectarea, iar nota se actualizează.`;
    }
    let saved = null;
    if (notaT) {
      try {
        if (src.contentId) {
          let vechi = null;
          try {
            const { data } = await supa.from('progress').select('score, max_score, completed_at')
              .eq('user_id', userId).eq('content_id', src.contentId).maybeSingle();
            vechi = data || null;
          } catch { vechi = null; }
          const recent = vechi && vechi.completed_at && (Date.now() - Date.parse(vechi.completed_at)) < NESCHIMBAT_MIN * 60000;
          if (vechi && recent && Number(vechi.score) === Math.round(notaT.score) && Number(vechi.max_score) === notaT.total) {
            saved = { kind: 'progress', neschimbat: true };
          } else {
            const pr = await correct.saveProgress(supa, userId, { contentId: src.contentId, title: src.title, category: src.category, score: notaT.score, maxScore: notaT.total, sessionSeconds: 0 });
            saved = { kind: 'progress', attempts: pr.attempts, partial: true };
          }
        } else if (src.libraryId) {
          const pr = await correct.saveUploadResult(supa, userId, {
            title: src.title, category: src.category, score: notaT.score, maxScore: notaT.total, sessionSeconds: 0,
            breakdown: (r.itemi || []).map((it, i) => ({ id: `foaie-${i + 1}`, eticheta: it.eticheta, puncte: it.puncte, maxPuncte: it.puncte_max, verdict: it.verdict })),
            feedback: r.feedback || '', testText: src.test,
          });
          saved = { kind: 'upload', attempts: pr.attempts };
        }
      } catch (e) {
        console.error('ai-handwriting: salvarea notei a eșuat:', e.message);
        saved = { kind: 'nesalvat' };
      }
    }

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
            title: `Corectare: ${src.title || 'foaia de lucru'}`.slice(0, 60),
            context: { pdf: !!ctx.pdf, meditatii: !!ctx.meditatii, contentId: src.contentId || null, libraryId: src.libraryId || null, category: src.category || null, title: src.title || null },
          })
          .select('id').single();
        convId = data?.id || null;
      }
      if (convId) {
        await supa.from('ai_messages').insert({
          conversation_id: convId, role: 'user', mode: 'tutor',
          content: '✍️ Am trimis la corectare rezolvarea scrisă de mână de pe foaia de lucru.',
          ...(thumb ? { metadata: { image: thumb } } : {}),
        });
        const { data: saved } = await supa.from('ai_messages')
          .insert({
            conversation_id: convId, role: 'assistant', mode: 'tutor', content: out.text,
            metadata: { handwriting: { puncte: r.puncte, puncteMax: r.puncteMax, hasBarem: !!src.hasBarem, model: out.model, ...(notaT ? { nota: notaT.nota } : {}) } },
          })
          .select('id').single();
        messageId = saved?.id || null;
        await supa.from('ai_conversations').update({ updated_at: new Date().toISOString() }).eq('id', convId);
      }
    } catch (e) { console.warn('ai-handwriting: salvarea în conversație a eșuat:', e.message); }

    // „🎯 Pregătește-mă de examen": exercițiile rezolvate pe foaie, la un test de examen
    const pregatireRez = src.category ? await pregatire.inregistreaza(supa, userId, {
      content: { id: src.contentId || null, title: src.title || null, category: src.category, content_type: 'pdf' },
      itemi: (r.itemi || []).filter((it) => it && it.verdict !== 'necompletat').length,
      pct: r.puncteMax ? Math.round((Number(r.puncte || 0) / Number(r.puncteMax)) * 100) : null,
      nota: notaT ? notaT.nota : null,
      verificat: true,
    }) : null;

    return res.status(200).json({
      conversationId: convId, messageId,
      text: out.text,
      puncte: r.puncte, puncteMax: r.puncteMax, hasBarem: !!src.hasBarem,
      pregatire: pregatireRez,
      lizibil: r.lizibil, itemi: r.itemi,
      spoken: r.feedback || '',
      model: out.model,
      nota: notaT ? notaT.nota : null, score: notaT ? notaT.score : null, total: notaT ? notaT.total : null,
      saved,
    });
  } catch (err) {
    if (!err.status) console.error('ai-handwriting error:', err);
    return res.status(err.status || 500).json({ error: err.message || 'Eroare server', code: err.code || null });
  }
};

// exportate pentru teste
module.exports.cleanImages = cleanImages;
module.exports.resolveSource = resolveSource;

// exportată pentru teste (test/nota-pe-pdf.test.js)
module.exports.notaDinFoaie = notaDinFoaie;
