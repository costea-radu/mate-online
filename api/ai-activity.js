// =====================================================================
// api/ai-activity.js — activitatea unui elev cu Profesorul Virtual,
// vizibilă pentru PĂRINTELE (sau mentorul) asociat.
// POST { userId, action, studentId }
//   action='children' → { children:[{id,name}] }
//   action='detail'   → { library, mastery, chat, assignments }
// =====================================================================
const ai = require('./_lib/ai');

async function isLinked(supa, mentorId, studentId) {
  const { data } = await supa.from('mentor_students')
    .select('student_id').eq('mentor_id', mentorId).eq('student_id', studentId).limit(1);
  if (data && data.length) return true;
  const { data: p } = await supa.from('profiles').select('teacher_id').eq('id', studentId).single();
  return p?.teacher_id === mentorId;
}

module.exports = async function handler(req, res) {
  ai.applyCors(res);
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method Not Allowed' });

  const supa = ai.admin();
  try {
    const userId = await ai.authUser(req, supa);
    const { action = 'children', studentId } = req.body || {};
    const me = await ai.requireUser(supa, userId);
    if (!(me.is_admin || me.role === 'parinte' || me.role === 'profesor')) {
      return res.status(403).json({ error: 'Nu ai acces.' });
    }

    if (action === 'children') {
      const role = me.role === 'profesor' ? 'profesor' : 'parinte';
      const { data: links } = await supa.from('mentor_students')
        .select('student_id').eq('mentor_id', userId).eq('mentor_role', role);
      const ids = [...new Set((links || []).map((l) => l.student_id))];
      if (!ids.length) return res.status(200).json({ children: [] });
      const { data: profs } = await supa.from('profiles').select('id, full_name, email').in('id', ids);
      const children = (profs || []).map((p) => ({ id: p.id, name: p.full_name || p.email || 'Elev' }));
      return res.status(200).json({ children });
    }

    if (action === 'detail') {
      if (!studentId) return res.status(400).json({ error: 'studentId obligatoriu' });
      if (!(me.is_admin || await isLinked(supa, userId, studentId))) {
        return res.status(403).json({ error: 'Acest elev nu este asociat cu tine.' });
      }

      // Biblioteca personală (teste generate, interactive, antrenament, salvate)
      const { data: lib } = await supa.from('ai_personal_items')
        .select('id, kind, title, category, topic, score, max_score, created_at, completed_at')
        .eq('user_id', studentId).order('created_at', { ascending: false }).limit(100);
      const library = { exam: [], interactive: [], practice: [] };
      (lib || []).forEach((it) => { (library[it.kind] || (library[it.kind] = [])).push(it); });

      // Stăpânire pe subiecte (progres)
      const { data: mastery } = await supa.from('ai_skill_mastery')
        .select('category, topic, mastery, attempts, correct, last_interaction')
        .eq('user_id', studentId).order('mastery', { ascending: true });

      // Întrebări către profesor, pe tip (învață / indicii / etc.)
      const { data: convs } = await supa.from('ai_conversations').select('id').eq('user_id', studentId);
      const convIds = (convs || []).map((c) => c.id);
      const chat = { tutor: 0, explain: 0, hint: 0, assistant: 0, total: 0 };
      if (convIds.length) {
        const { data: msgs } = await supa.from('ai_messages')
          .select('mode').eq('role', 'user').in('conversation_id', convIds);
        (msgs || []).forEach((m) => { chat[m.mode] = (chat[m.mode] || 0) + 1; chat.total++; });
      }

      // Exerciții primite de la profesor și rezolvate (dacă subsistemul e instalat)
      let assignments = [];
      try {
        const { data: ar } = await supa.from('ai_assignment_results')
          .select('score, max_score, attempts, completed_at, ai_assignments(title, kind, creator_name, creator_role)')
          .eq('student_id', studentId).order('completed_at', { ascending: false }).limit(50);
        assignments = (ar || []).map((r) => ({
          title: r.ai_assignments?.title, kind: r.ai_assignments?.kind, creator: r.ai_assignments?.creator_name, creatorRole: r.ai_assignments?.creator_role,
          score: r.score, maxScore: r.max_score, attempts: r.attempts, completedAt: r.completed_at,
        }));
      } catch { assignments = []; }

      return res.status(200).json({ library, mastery: mastery || [], chat, assignments });
    }

    return res.status(400).json({ error: 'action invalid' });
  } catch (err) {
    console.error('ai-activity error:', err);
    return res.status(err.status || 500).json({ error: err.message || 'Eroare server' });
  }
};
