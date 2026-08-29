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

module.exports = async function handler(req, res) {
  ai.applyCors(res);
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method Not Allowed' });

  const supa = ai.admin();
  try {
    const userId = await ai.authUser(req, supa);
    const profile = await ai.requireUser(supa, userId);
    const { contentId, answers = null, score: sc0 = 0, maxScore: mx0 = 100, durationSec = 0 } = req.body || {};
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

    return res.status(200).json({ ok: true, score: v.score, maxScore: v.maxScore, verified: v.verified, attempts, timeSpent, correct: v.correct ?? null, total: v.total ?? null, xp: gami });
  } catch (err) {
    console.error('ai-score error:', err);
    return res.status(err.status || 500).json({ error: err.message || 'Eroare server', code: err.code || null });
  }
};
