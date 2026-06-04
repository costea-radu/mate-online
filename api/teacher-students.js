const { createClient } = require('@supabase/supabase-js');

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Content-Type': 'application/json',
};

module.exports = async function handler(req, res) {
  Object.entries(CORS_HEADERS).forEach(([key, val]) => res.setHeader(key, val));

  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method Not Allowed' });

  const { userId } = req.body || {};
  if (!userId) return res.status(400).json({ error: 'userId obligatoriu' });

  const supabase = createClient(
    process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY
  );

  // 1. Verifică faptul că apelantul este profesor
  const { data: caller, error: callerErr } = await supabase
    .from('profiles')
    .select('role')
    .eq('id', userId)
    .maybeSingle();

  if (callerErr) return res.status(500).json({ error: callerErr.message });
  if (!caller || caller.role !== 'profesor') {
    return res.status(403).json({ error: 'Acces interzis' });
  }

  // 2. Elevii asociați acestui profesor
  const { data: students, error: studentsErr } = await supabase
    .from('profiles')
    .select('id, full_name, email')
    .eq('teacher_id', userId)
    .order('full_name', { ascending: true });

  if (studentsErr) return res.status(500).json({ error: studentsErr.message });

  const studentList = students || [];
  if (studentList.length === 0) {
    return res.status(200).json({ students: [], results: [] });
  }

  const studentIds = studentList.map((s) => s.id);

  // 3. Rezultatele (progresul) elevilor la exercițiile/testele interactive
  const { data: progress, error: progressErr } = await supabase
    .from('progress')
    .select('user_id, content_id, score, max_score, completed_at')
    .in('user_id', studentIds)
    .order('completed_at', { ascending: false });

  if (progressErr) return res.status(500).json({ error: progressErr.message });

  const prog = progress || [];

  // 4. Titlurile testelor/exercițiilor
  const contentIds = [...new Set(prog.map((p) => p.content_id))];
  const contentMap = {};
  if (contentIds.length > 0) {
    const { data: content } = await supabase
      .from('content')
      .select('id, title, content_type, category')
      .in('id', contentIds);
    (content || []).forEach((c) => { contentMap[c.id] = c; });
  }

  const studentMap = {};
  studentList.forEach((s) => { studentMap[s.id] = s; });

  // 5. Construiește rândurile: nume elev / test sau exercițiu / punctaj
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
      completed_at: p.completed_at,
    };
  });

  return res.status(200).json({ students: studentList, results });
};
