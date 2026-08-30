// =====================================================================
// api/ai-score.js — salvarea scorului unui test interactiv, VERIFICAT pe server
// (Etapa 3 din AUDIT_AGENTI_AI.md — restanța 2.1)
// Body: { contentId, answers?: [...], score, maxScore, durationSec? }
//   answers[i] = indexul ales (grilă) sau textul scris (răspuns liber), în
//   ordinea itemilor — trimis de HTML-urile generate (exgen / quizRender).
// Răspuns: { ok, score, maxScore, verified, attempts, timeSpent, correct?, total? }
//   verified=true  → scorul a fost RECALCULAT din cheile materialului;
//   verified=false → materialul nu are chei citibile (test încărcat manual) —
//                    se salvează scorul trimis, plafonat (ca înainte).
// Scrierea în `progress` se face cu rolul de serviciu (snapshot + time_spent,
// cu reluare progresivă dacă migrările nu sunt rulate — ca în InteractiveViewer).
// =====================================================================
const ai = require('./_lib/ai');
const score = require('./_lib/score');
const xp = require('./_lib/xp');
const duel = require('./_lib/duel');
const turneu = require('./_lib/turneu');

module.exports = async function handler(req, res) {
  ai.applyCors(res);
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method Not Allowed' });

  const supa = ai.admin();
  try {
    const userId = await ai.authUser(req, supa);
    const profile = await ai.requireUser(supa, userId);
    const { contentId, answers = null, score: sc0 = 0, maxScore: mx0 = 100, durationSec = 0, duelId = null, partial = false } = req.body || {};
    if (!contentId) return res.status(400).json({ error: 'contentId obligatoriu' });

    const { data: content } = await supa.from('content').select('*').eq('id', contentId).maybeSingle();
    if (!content) return res.status(404).json({ error: 'Material negăsit' });
    if (!content.is_free && !ai.isPremium(profile) && !profile.is_admin) {
      return res.status(403).json({ error: 'Acces interzis. Necesită abonament.' });
    }

    const v = await score.verifiedScore(supa, content, {
      answers: Array.isArray(answers) ? answers.slice(0, 60) : null, score: sc0, maxScore: mx0,
      loadHtml: (c) => score.loadContentHtml(supa, c),
    });
    // Materialul ARE chei, dar nu am primit răspunsuri → nu salvăm un scor „pe
    // încredere" (asta era gaura din 2.1). Se întâmplă doar cu o pagină veche
    // rămasă în cache: elevul reîncarcă și rezolvă din nou.
    if (v.hasKeys && !v.verified) {
      return res.status(400).json({
        error: 'Nu am putut verifica răspunsurile. Reîncarcă pagina exercițiului (Ctrl+R) și rezolvă-l din nou — scorul se salvează după verificare.',
        code: 'ANSWERS_REQUIRED',
      });
    }

    // progress: încercări + timp cumulate, best-of NU (ultima încercare contează, ca până acum)
    const sessionSeconds = Math.max(0, Math.min(6 * 3600, Math.round(Number(durationSec) || 0)));
    let existing = null;
    try {
      const { data } = await supa.from('progress').select('attempts, time_spent, score, max_score').eq('user_id', userId).eq('content_id', content.id).maybeSingle();
      existing = data || null;
    } catch { /* prima încercare */ }

    // ── SALVARE PARȚIALĂ (elevul e la jumătatea exercițiului) ────────────────
    // Trimisă automat de InteractiveViewer, nu de un buton. Reguli stricte, ca
    // să nu strice nimic din ce s-a câștigat deja:
    //   · fără chei verificabile → o ignorăm (n-avem cum să o credem);
    //   · NU coboară un scor mai bun deja salvat;
    //   · NU numără o încercare și NU dă XP (altfel s-ar putea „fermenta" XP
    //     lăsând pagina deschisă);
    //   · duelul o reține ca rezultat provizoriu, turneul păstrează maximul.
    if (partial) {
      if (!v.verified) return res.status(200).json({ ok: false, partial: true, ignorat: 'neverificat' });
      const vechi = existing && existing.max_score > 0 ? existing.score / existing.max_score : -1;
      const nou = v.maxScore > 0 ? v.score / v.maxScore : 0;
      let salvat = false;
      if (nou > vechi) {
        const bazaP = {
          user_id: userId, content_id: content.id, score: v.score, max_score: v.maxScore,
          completed_at: new Date().toISOString(), attempts: existing?.attempts || 0,
        };
        const snapP = { test_title: content.title || null, content_type: content.content_type || null, category: content.category || null };
        let { error: eP } = await supa.from('progress').upsert({ ...bazaP, ...snapP }, { onConflict: 'user_id,content_id' });
        if (eP) ({ error: eP } = await supa.from('progress').upsert(bazaP, { onConflict: 'user_id,content_id' }));
        salvat = !eP;
      }
      const puncte = xp.computeXp({
        score: v.score, maxScore: v.maxScore, correct: v.correct ?? null, total: v.total ?? null,
        attempts: 1, difficulty: xp.difficultyOf(content), verified: true,
      }).xp;
      const dP = duelId
        ? await duel.recordScore(supa, userId, duelId, { contentId: content.id, score: v.score, maxScore: v.maxScore, verified: true, partial: true })
        : await duel.recordByContent(supa, userId, content.id, { score: v.score, maxScore: v.maxScore, partial: true });
      const tP = puncte > 0
        ? await turneu.recordScore(supa, userId, content.id, { points: puncte, pct: v.maxScore > 0 ? Math.round((v.score / v.maxScore) * 100) : 0 })
        : null;
      return res.status(200).json({
        ok: true, partial: true, salvat, score: v.score, maxScore: v.maxScore,
        duel: dP, turneu: tP,
      });
    }
    const attempts = (existing?.attempts || 0) + 1;
    const timeSpent = (existing?.time_spent || 0) + sessionSeconds;
    const base = { user_id: userId, content_id: content.id, score: v.score, max_score: v.maxScore, completed_at: new Date().toISOString(), attempts };
    const snapshot = { test_title: content.title || null, content_type: content.content_type || null, category: content.category || null };
    let { error } = await supa.from('progress').upsert({ ...base, ...snapshot, time_spent: timeSpent }, { onConflict: 'user_id,content_id' });
    if (error) ({ error } = await supa.from('progress').upsert({ ...base, time_spent: timeSpent }, { onConflict: 'user_id,content_id' }));
    if (error) ({ error } = await supa.from('progress').upsert(base, { onConflict: 'user_id,content_id' }));
    if (error) return res.status(500).json({ error: `Scorul nu s-a putut salva (${error.message}).` });

    // GAMIFICARE (supabase/gamificare_v2.sql): XP ponderat, streak, misiunea
    // zilei și punctele de ligă. Nu aruncă niciodată — dacă tabelele nu sunt
    // create încă, `award` întoarce null și salvarea scorului rămâne intactă.
    const prevPct = existing && existing.max_score > 0
      ? Math.round((existing.score / existing.max_score) * 100)
      : null;
    const gami = await xp.award(supa, userId, {
      source: 'interactive', refId: content.id, content,
      score: v.score, maxScore: v.maxScore,
      correct: v.correct ?? null, total: v.total ?? null,
      attempts, prevPct, verified: !!v.verified,
      meta: { titlu: content.title || null },
    });

    // TURNEU DE GRUPĂ (pasul 4): dacă materialul e într-un turneu activ al unei
    // grupe din care face parte elevul, punctajul intră automat — fără înscriere.
    let turneuRez = null;
    if (gami && gami.xpExercitiu > 0) {
      turneuRez = await turneu.recordScore(supa, userId, content.id, {
        points: gami.xpExercitiu,
        pct: v.maxScore > 0 ? Math.round((v.score / v.maxScore) * 100) : 0,
      });
    }

    // DUEL (pasul 3): rezultatul intră în duel DOAR pe drumul ăsta, cu scorul
    // recalculat pe server — browserul nu poate scrie direct un rezultat.
    let duelRez = null;
    if (duelId) {
      duelRez = await duel.recordScore(supa, userId, duelId, {
        contentId: content.id, score: v.score, maxScore: v.maxScore, verified: !!v.verified,
      });
    }

    return res.status(200).json({ ok: true, score: v.score, maxScore: v.maxScore, verified: v.verified, attempts, timeSpent, correct: v.correct ?? null, total: v.total ?? null, xp: gami, duel: duelRez, turneu: turneuRez });
  } catch (err) {
    console.error('ai-score error:', err);
    return res.status(err.status || 500).json({ error: err.message || 'Eroare server', code: err.code || null });
  }
};
