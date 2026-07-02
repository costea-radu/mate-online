// =====================================================================
// api/ai-teacher.js — date AI pentru profesor
//
// action='student' (implicit dacă e dat studentId):
//    { userId, studentId } → { mastery[] }  (un singur elev)
//
// action='report':
//    { userId, groupId? } → raport agregat pe toți elevii (sau o grupă):
//    { groups[], topics[], students[], totals }
//
// Autorizare: elevii proprii din mentor_students (mentor_role='profesor')
// sau, retrocompatibil, profiles.teacher_id == userId.
// =====================================================================
const ai = require('./_lib/ai');

// Lista id-urilor elevilor/copiilor unui mentor (+ nume), opțional dintr-o grupă.
// role: 'profesor' (default) sau 'parinte' → filtrează legătura potrivită.
async function teacherStudents(supa, teacherId, groupId, role = 'profesor') {
  const ids = new Set();

  let q = supa.from('mentor_students').select('student_id, group_id')
    .eq('mentor_id', teacherId).eq('mentor_role', role);
  if (groupId) q = q.eq('group_id', groupId);
  const { data: links } = await q;
  (links || []).forEach((l) => ids.add(l.student_id));

  // Retrocompatibil (asocieri vechi pe profiles.teacher_id) — doar pentru profesori
  if (!groupId && role === 'profesor') {
    const { data: legacy } = await supa.from('profiles').select('id').eq('teacher_id', teacherId);
    (legacy || []).forEach((p) => ids.add(p.id));
  }

  const idList = [...ids];
  if (idList.length === 0) return { idList: [], names: {} };
  const { data: profs } = await supa.from('profiles').select('id, full_name, email').in('id', idList);
  const names = {};
  (profs || []).forEach((p) => { names[p.id] = p.full_name || p.email || 'Elev'; });
  return { idList, names };
}

module.exports = async function handler(req, res) {
  ai.applyCors(res);
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method Not Allowed' });

  const supa = ai.admin();
  try {
    const { userId, studentId, groupId } = req.body || {};
    const action = req.body?.action || (studentId ? 'student' : 'report');
    const teacher = await ai.requireUser(supa, userId);
    const callerRole = teacher.role === 'parinte' ? 'parinte' : 'profesor';
    if (!(teacher.is_admin || teacher.role === 'profesor' || teacher.role === 'parinte')) {
      return res.status(403).json({ error: 'Nu ai acces la aceste date.' });
    }

    // ── Un singur elev/copil ───────────────────────────────────────
    if (action === 'student') {
      if (!studentId) return res.status(400).json({ error: 'studentId obligatoriu' });
      const { idList } = await teacherStudents(supa, userId, null, callerRole);
      const allowed = teacher.is_admin || idList.includes(studentId);
      if (!allowed) return res.status(403).json({ error: 'Acest elev nu este asociat cu tine.' });
      const { data: mastery } = await supa.from('ai_skill_mastery')
        .select('category, topic, mastery, attempts, correct, last_interaction')
        .eq('user_id', studentId).order('mastery', { ascending: true });
      return res.status(200).json({ mastery: mastery || [] });
    }

    // ── Raport agregat ─────────────────────────────────────────────
    const { data: groups } = await supa.from('mentor_groups')
      .select('id, name').eq('teacher_id', userId).order('created_at');

    const { idList, names } = await teacherStudents(supa, userId, groupId || null, callerRole);
    if (idList.length === 0) {
      return res.status(200).json({ groups: groups || [], topics: [], students: [], totals: { students: 0, practiced: 0 } });
    }

    const { data: rows } = await supa.from('ai_skill_mastery')
      .select('user_id, category, topic, mastery, attempts, correct')
      .in('user_id', idList);

    // Agregare pe subiect
    const byTopic = {};
    const byStudent = {};
    (rows || []).forEach((r) => {
      const tk = r.topic;
      const t = (byTopic[tk] ||= { topic: tk, category: r.category, sum: 0, n: 0, students: new Set(), attempts: 0, correct: 0, struggling: 0 });
      t.sum += Number(r.mastery); t.n += 1; t.students.add(r.user_id);
      t.attempts += r.attempts; t.correct += r.correct;
      if (Number(r.mastery) < 0.5 && r.attempts >= 4) t.struggling += 1;

      const s = (byStudent[r.user_id] ||= { id: r.user_id, name: names[r.user_id] || 'Elev', sum: 0, n: 0, struggling: [], weakest: null, weakestM: 2 });
      s.sum += Number(r.mastery); s.n += 1;
      if (Number(r.mastery) < s.weakestM) { s.weakestM = Number(r.mastery); s.weakest = tk; }
      if (Number(r.mastery) < 0.5 && r.attempts >= 4) s.struggling.push(tk);
    });

    const topics = Object.values(byTopic).map((t) => ({
      topic: t.topic, category: t.category,
      avgMastery: Math.round((t.sum / t.n) * 100) / 100,
      studentsPracticed: t.students.size,
      attempts: t.attempts, correct: t.correct,
      strugglingStudents: t.struggling,
    })).sort((a, b) => a.avgMastery - b.avgMastery);

    const students = Object.values(byStudent).map((s) => ({
      id: s.id, name: s.name,
      avgMastery: Math.round((s.sum / s.n) * 100) / 100,
      topicsPracticed: s.n,
      weakestTopic: s.weakest,
      strugglingTopics: s.struggling,
      atRisk: s.struggling.length > 0 || (s.sum / s.n) < 0.4,
    })).sort((a, b) => a.avgMastery - b.avgMastery);

    const totals = {
      students: idList.length,
      practiced: students.length,
      avgMastery: students.length ? Math.round((students.reduce((a, s) => a + s.avgMastery, 0) / students.length) * 100) / 100 : null,
      atRisk: students.filter((s) => s.atRisk).length,
    };

    return res.status(200).json({ groups: groups || [], topics, students, totals });
  } catch (err) {
    console.error('ai-teacher error:', err);
    return res.status(err.status || 500).json({ error: err.message || 'Eroare server' });
  }
};
