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

  // 1. Găsește mentorul (profesor sau părinte) după cod
  const { data: mentor, error: mentorErr } = await supabase
    .from('profiles')
    .select('id, full_name, role')
    .eq('teacher_code', normCode)
    .maybeSingle();

  if (mentorErr) return res.status(500).json({ error: mentorErr.message });
  if (!mentor) {
    return res.status(404).json({ error: 'Codul nu corespunde niciunui cont.' });
  }
  const mentorRole = mentor.role === 'parinte' ? 'parinte' : 'profesor';
  if (mentor.role && mentor.role !== 'profesor' && mentor.role !== 'parinte') {
    return res.status(400).json({ error: 'Cod invalid.' });
  }
  if (mentor.id === userId) {
    return res.status(400).json({ error: 'Nu te poți asocia cu propriul cont.' });
  }

  // 2. Citește profilul elevului (pentru a seta role='elev' dacă lipsește)
  const { data: student, error: studentErr } = await supabase
    .from('profiles')
    .select('role')
    .eq('id', userId)
    .maybeSingle();

  if (studentErr) return res.status(500).json({ error: studentErr.message });
  if (!student) return res.status(404).json({ error: 'Profil inexistent.' });

  // 3. Asociere multiplă (un elev poate avea mai mulți profesori și părinți)
  const { error: insertErr } = await supabase
    .from('mentor_students')
    .upsert(
      { mentor_id: mentor.id, student_id: userId, mentor_role: mentorRole },
      { onConflict: 'mentor_id,student_id', ignoreDuplicates: true }
    );

  if (insertErr) return res.status(500).json({ error: insertErr.message });

  // 4. Dacă elevul nu avea rol, îl marcăm ca 'elev'
  if (!student.role) {
    await supabase.from('profiles').update({ role: 'elev' }).eq('id', userId);
  }

  return res.status(200).json({
    mentor_id: mentor.id,
    mentor_name: mentor.full_name || (mentorRole === 'parinte' ? 'Părinte' : 'Profesor'),
    mentor_role: mentorRole,
    // compat
    teacher_name: mentor.full_name || (mentorRole === 'parinte' ? 'Părinte' : 'Profesor'),
  });
};
