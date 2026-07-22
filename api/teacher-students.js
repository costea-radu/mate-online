const { createClient } = require('@supabase/supabase-js');
const { handledMethod, authUser } = require('./_lib/http');

module.exports = async function handler(req, res) {
  if (handledMethod(req, res)) return;

  const supabase = createClient(
    process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY
  );

  let userId;
  try { userId = await authUser(req, supabase); }
  catch (e) { return res.status(e.status || 401).json({ error: e.message }); }

  // 1. Apelantul trebuie să fie profesor sau părinte
  const { data: caller, error: callerErr } = await supabase
    .from('profiles')
    .select('role')
    .eq('id', userId)
    .maybeSingle();

  if (callerErr) return res.status(500).json({ error: callerErr.message });
  if (!caller || (caller.role !== 'profesor' && caller.role !== 'parinte')) {
    return res.status(403).json({ error: 'Acces interzis' });
  }
  const role = caller.role;

  // 2. Grupele profesorului (părinții nu au grupe)
  let groups = [];
  if (role === 'profesor') {
    const { data: g, error: gErr } = await supabase
      .from('mentor_groups')
      .select('id, name, created_at')
      .eq('teacher_id', userId)
      .order('created_at', { ascending: true });
    if (gErr) return res.status(500).json({ error: gErr.message });
    groups = g || [];
  }

  // 3. Asocierile (elev + grupă) acestui mentor
  const { data: links, error: linksErr } = await supabase
    .from('mentor_students')
    .select('student_id, group_id')
    .eq('mentor_id', userId);

  if (linksErr) return res.status(500).json({ error: linksErr.message });

  const linkList = links || [];
  if (linkList.length === 0) {
    return res.status(200).json({ role, students: [], results: [], groups });
  }

  const studentIds = linkList.map((l) => l.student_id);
  const groupByStudent = {};
  linkList.forEach((l) => { groupByStudent[l.student_id] = l.group_id || null; });

  // 4. Profilurile elevilor
  const { data: profiles, error: profErr } = await supabase
    .from('profiles')
    .select('id, full_name, email')
    .in('id', studentIds);
  if (profErr) return res.status(500).json({ error: profErr.message });

  const students = (profiles || [])
    .map((p) => ({
      id: p.id,
      full_name: p.full_name || 'Elev',
      email: p.email || '',
      group_id: groupByStudent[p.id] || null,
    }))
    .sort((a, b) => (a.full_name || '').localeCompare(b.full_name || '', 'ro'));

  // 5. Progresul elevilor (select * pentru a tolera coloane lipsă: attempts/time_spent)
  const { data: progress, error: progressErr } = await supabase
    .from('progress')
    .select('*')
    .in('user_id', studentIds)
    .order('completed_at', { ascending: false });

  if (progressErr) return res.status(500).json({ error: progressErr.message });
  const prog = progress || [];

  // 6. Utilizarea Profesorului Virtual: câte întrebări a pus fiecare elev
  //    la fiecare material (conversațiile AI păstrează contentId în context).
  const aiQ = {}; // "userId|contentId" -> nr. întrebări
  try {
    const { data: convs } = await supabase
      .from('ai_conversations')
      .select('id, user_id, context')
      .in('user_id', studentIds);
    const convKey = {}; // conversationId -> "userId|contentId"
    (convs || []).forEach((c) => {
      const cid = c.context && (c.context.contentId || c.context.content_id);
      if (cid) convKey[c.id] = `${c.user_id}|${cid}`;
    });
    const convIds = Object.keys(convKey);
    for (let i = 0; i < convIds.length; i += 150) {
      const chunk = convIds.slice(i, i + 150);
      const { data: msgs } = await supabase
        .from('ai_messages')
        .select('conversation_id')
        .eq('role', 'user')
        .in('conversation_id', chunk);
      (msgs || []).forEach((m) => {
        const k = convKey[m.conversation_id];
        if (k) aiQ[k] = (aiQ[k] || 0) + 1;
      });
    }
  } catch { /* raportul funcționează și fără datele AI */ }

  // 7. Titlurile testelor/exercițiilor (din progres + din conversațiile AI)
  const aiContentIds = Object.keys(aiQ).map((k) => k.split('|')[1]);
  const contentIds = [...new Set([...prog.map((p) => p.content_id), ...aiContentIds])];
  const contentMap = {};
  if (contentIds.length > 0) {
    const { data: content } = await supabase
      .from('content')
      .select('id, title, content_type, category')
      .in('id', contentIds);
    (content || []).forEach((c) => { contentMap[c.id] = c; });
  }

  const studentMap = {};
  students.forEach((s) => { studentMap[s.id] = s; });

  const results = prog.map((p) => {
    const c = contentMap[p.content_id] || {};
    const s = studentMap[p.user_id] || {};
    return {
      student_id: p.user_id,
      student_name: s.full_name || 'Elev',
      student_email: s.email || '',
      content_id: p.content_id,
      test_title: c.title || 'Test',
      content_type: c.content_type || 'interactive',
      category: c.category || '',
      score: p.score,
      max_score: p.max_score,
      attempts: p.attempts != null ? p.attempts : 1,
      time_spent: p.time_spent != null ? p.time_spent : 0,
      completed_at: p.completed_at,
      ai_questions: aiQ[`${p.user_id}|${p.content_id}`] || 0,
    };
  });

  // 8. Materiale la care elevul a folosit Prof. Virtual dar nu are (încă) punctaj
  const covered = new Set(prog.map((p) => `${p.user_id}|${p.content_id}`));
  const aiUsage = Object.keys(aiQ)
    .filter((k) => !covered.has(k))
    .map((k) => {
      const [sid, cid] = k.split('|');
      const c = contentMap[cid] || {};
      return {
        student_id: sid,
        content_id: cid,
        test_title: c.title || 'Material',
        content_type: c.content_type || '',
        ai_questions: aiQ[k],
      };
    })
    // doar materiale reale din platformă (conversațiile fără material nu apar)
    .filter((r) => contentMap[r.content_id]);

  return res.status(200).json({ role, students, results, groups, aiUsage });
};
