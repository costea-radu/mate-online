const { createClient } = require('@supabase/supabase-js');

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Content-Type': 'application/json',
};

function normalizeCode(code) {
  return String(code || '').trim().toUpperCase().replace(/[^A-Z0-9]/g, '');
}

module.exports = async function handler(req, res) {
  Object.entries(CORS_HEADERS).forEach(([key, val]) => res.setHeader(key, val));

  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method Not Allowed' });

  const { userId, code } = req.body || {};
  if (!userId) return res.status(400).json({ error: 'userId obligatoriu' });

  const normCode = normalizeCode(code);
  if (!normCode) return res.status(400).json({ error: 'Cod invalid.' });

  const supabase = createClient(
    process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY
  );

  // 1. Găsește profesorul după cod
  const { data: teacher, error: teacherErr } = await supabase
    .from('profiles')
    .select('id, full_name, role')
    .eq('teacher_code', normCode)
    .maybeSingle();

  if (teacherErr) return res.status(500).json({ error: teacherErr.message });
  if (!teacher) {
    return res.status(404).json({ error: 'Codul nu corespunde niciunui profesor.' });
  }
  if (teacher.role && teacher.role !== 'profesor') {
    return res.status(400).json({ error: 'Cod invalid.' });
  }
  if (teacher.id === userId) {
    return res.status(400).json({ error: 'Nu te poți asocia cu propriul cont.' });
  }

  // 2. Citește profilul elevului (pentru a nu suprascrie un role deja setat)
  const { data: student, error: studentErr } = await supabase
    .from('profiles')
    .select('role, teacher_id')
    .eq('id', userId)
    .maybeSingle();

  if (studentErr) return res.status(500).json({ error: studentErr.message });
  if (!student) return res.status(404).json({ error: 'Profil inexistent.' });

  // 3. Asociază elevul cu profesorul
  const update = {
    teacher_id: teacher.id,
    teacher_name: teacher.full_name || 'Profesor',
  };
  if (!student.role) update.role = 'elev';

  const { error: updateErr } = await supabase
    .from('profiles')
    .update(update)
    .eq('id', userId);

  if (updateErr) return res.status(500).json({ error: updateErr.message });

  return res.status(200).json({
    teacher_id: teacher.id,
    teacher_name: teacher.full_name || 'Profesor',
  });
};
