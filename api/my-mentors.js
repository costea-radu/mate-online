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

  const { data: links, error: linksErr } = await supabase
    .from('mentor_students')
    .select('mentor_id, mentor_role')
    .eq('student_id', userId);

  if (linksErr) return res.status(500).json({ error: linksErr.message });
  const linkList = links || [];
  if (linkList.length === 0) return res.status(200).json({ mentors: [] });

  const mentorIds = [...new Set(linkList.map((l) => l.mentor_id))];
  const { data: profiles, error: profErr } = await supabase
    .from('profiles')
    .select('id, full_name')
    .in('id', mentorIds);
  if (profErr) return res.status(500).json({ error: profErr.message });

  const nameMap = {};
  (profiles || []).forEach((p) => { nameMap[p.id] = p.full_name || ''; });

  const mentors = linkList.map((l) => ({
    id: l.mentor_id,
    name: nameMap[l.mentor_id] || (l.mentor_role === 'parinte' ? 'Părinte' : 'Profesor'),
    role: l.mentor_role,
  }));

  return res.status(200).json({ mentors });
};
