// =====================================================================
// api/ai-progress.js — dashboardul de progres al elevului
// Body: { userId }
// Răspuns: { mastery[], interactive{...}, recommendations[] }
// =====================================================================
const ai = require('./_lib/ai');

module.exports = async function handler(req, res) {
  ai.applyCors(res);
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method Not Allowed' });

  const supa = ai.admin();
  try {
    const { userId } = req.body || {};
    await ai.requireUser(supa, userId);

    // 1. Stăpânirea competențelor (din antrenamentele cu AI).
    const { data: mastery } = await supa.from('ai_skill_mastery')
      .select('category, topic, mastery, attempts, correct, last_interaction')
      .eq('user_id', userId)
      .order('mastery', { ascending: true });

    // 2. Progresul la exercițiile interactive (tabela existentă `progress`).
    const { data: prog } = await supa.from('progress')
      .select('content_id, score, max_score, attempts, completed_at')
      .eq('user_id', userId);

    let totalScore = 0, totalMax = 0, completedIds = [];
    (prog || []).forEach((p) => {
      totalScore += p.score || 0; totalMax += p.max_score || 0;
      completedIds.push(p.content_id);
    });
    const interactive = {
      completed: (prog || []).length,
      avgPercent: totalMax ? Math.round((totalScore / totalMax) * 100) : null,
    };

    // 3. Recomandări:
    //    a) subiectele cu cea mai slabă stăpânire (din antrenamente)
    const weakTopics = (mastery || [])
      .filter((m) => m.attempts >= 1 && m.mastery < 0.7)
      .slice(0, 4)
      .map((m) => ({ kind: 'practice', topic: m.topic, category: m.category, mastery: m.mastery }));

    //    b) exerciții interactive nerezolvate încă
    let nextExercises = [];
    const { data: candidates } = await supa.from('content')
      .select('id, title, category, content_type, is_free')
      .eq('content_type', 'interactive')
      .order('created_at', { ascending: false })
      .limit(40);
    nextExercises = (candidates || [])
      .filter((c) => !completedIds.includes(c.id))
      .slice(0, 5)
      .map((c) => ({ kind: 'exercise', id: c.id, title: c.title, category: c.category, is_free: c.is_free }));

    const recommendations = [...weakTopics, ...nextExercises];

    return res.status(200).json({ mastery: mastery || [], interactive, recommendations });
  } catch (err) {
    console.error('ai-progress error:', err);
    return res.status(err.status || 500).json({ error: err.message || 'Eroare server' });
  }
};
