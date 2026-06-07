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

  const { userId, action } = req.body || {};
  if (!userId || !action) return res.status(400).json({ error: 'userId și action obligatorii' });

  const supabase = createClient(
    process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY
  );

  const { data: caller, error: callerErr } = await supabase
    .from('profiles')
    .select('role')
    .eq('id', userId)
    .maybeSingle();
  if (callerErr) return res.status(500).json({ error: callerErr.message });
  if (!caller) return res.status(404).json({ error: 'Profil inexistent.' });

  const role = caller.role;
  const isTeacher = role === 'profesor';
  const isMentor = role === 'profesor' || role === 'parinte';

  // Acțiuni cu grupe / mutare → doar profesor
  const teacherOnly = ['create_group', 'rename_group', 'delete_group', 'move_student'];
  if (teacherOnly.includes(action) && !isTeacher) {
    return res.status(403).json({ error: 'Doar profesorii pot gestiona grupe.' });
  }
  if (action === 'remove_student' && !isMentor) {
    return res.status(403).json({ error: 'Acces interzis.' });
  }

  try {
    if (action === 'create_group') {
      const name = String(req.body.name || '').trim().slice(0, 60) || 'Grupă nouă';
      const { data, error } = await supabase
        .from('mentor_groups')
        .insert({ teacher_id: userId, name })
        .select('id, name')
        .single();
      if (error) throw error;
      return res.status(200).json({ ok: true, group: data });
    }

    if (action === 'rename_group') {
      const { groupId } = req.body;
      const name = String(req.body.name || '').trim().slice(0, 60);
      if (!groupId || !name) return res.status(400).json({ error: 'groupId și name obligatorii' });
      const { data: g } = await supabase
        .from('mentor_groups').select('teacher_id').eq('id', groupId).maybeSingle();
      if (!g || g.teacher_id !== userId) return res.status(403).json({ error: 'Grupă inexistentă.' });
      const { error } = await supabase.from('mentor_groups').update({ name }).eq('id', groupId);
      if (error) throw error;
      return res.status(200).json({ ok: true });
    }

    if (action === 'delete_group') {
      const { groupId } = req.body;
      if (!groupId) return res.status(400).json({ error: 'groupId obligatoriu' });
      const { data: g } = await supabase
        .from('mentor_groups').select('teacher_id').eq('id', groupId).maybeSingle();
      if (!g || g.teacher_id !== userId) return res.status(403).json({ error: 'Grupă inexistentă.' });
      // Elevii rămân, doar fără grupă
      await supabase.from('mentor_students').update({ group_id: null })
        .eq('mentor_id', userId).eq('group_id', groupId);
      const { error } = await supabase.from('mentor_groups').delete().eq('id', groupId);
      if (error) throw error;
      return res.status(200).json({ ok: true });
    }

    if (action === 'move_student') {
      const { studentId } = req.body;
      const groupId = req.body.groupId || null;
      if (!studentId) return res.status(400).json({ error: 'studentId obligatoriu' });
      // verifică asocierea
      const { data: link } = await supabase
        .from('mentor_students').select('id').eq('mentor_id', userId).eq('student_id', studentId).maybeSingle();
      if (!link) return res.status(404).json({ error: 'Elevul nu este asociat contului tău.' });
      // dacă mută într-o grupă, grupa trebuie să fie a profesorului
      if (groupId) {
        const { data: g } = await supabase
          .from('mentor_groups').select('teacher_id').eq('id', groupId).maybeSingle();
        if (!g || g.teacher_id !== userId) return res.status(400).json({ error: 'Grupă invalidă.' });
      }
      const { error } = await supabase
        .from('mentor_students').update({ group_id: groupId })
        .eq('mentor_id', userId).eq('student_id', studentId);
      if (error) throw error;
      return res.status(200).json({ ok: true });
    }

    if (action === 'remove_student') {
      const { studentId } = req.body;
      if (!studentId) return res.status(400).json({ error: 'studentId obligatoriu' });
      const { error } = await supabase
        .from('mentor_students').delete()
        .eq('mentor_id', userId).eq('student_id', studentId);
      if (error) throw error;
      // curăță și asocierea legacy, dacă există
      await supabase.from('profiles')
        .update({ teacher_id: null, teacher_name: null })
        .eq('id', studentId).eq('teacher_id', userId);
      return res.status(200).json({ ok: true });
    }

    return res.status(400).json({ error: 'Acțiune necunoscută.' });
  } catch (e) {
    return res.status(500).json({ error: e.message || 'Eroare server.' });
  }
};
