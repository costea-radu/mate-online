const { createClient } = require('@supabase/supabase-js');
const { handledMethod, authUser } = require('./_lib/http');

module.exports = async function handler(req, res) {
  if (handledMethod(req, res)) return;

  const { action } = req.body || {};
  if (!action) return res.status(400).json({ error: 'action obligatoriu' });

  const supabase = createClient(
    process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY
  );

  let userId;
  try { userId = await authUser(req, supabase); }
  catch (e) { return res.status(e.status || 401).json({ error: e.message }); }

  // Listă de mentori (profesori/părinți) ai elevului curent — fără restricție de rol
  if (action === 'my_mentors') {
    const { data: links, error: linksErr } = await supabase
      .from('mentor_students')
      .select('mentor_id, mentor_role')
      .eq('student_id', userId);
    if (linksErr) return res.status(500).json({ error: linksErr.message });
    const linkList = links || [];
    if (linkList.length === 0) return res.status(200).json({ mentors: [] });
    const mentorIds = [...new Set(linkList.map((l) => l.mentor_id))];
    const { data: profiles, error: profErr } = await supabase
      .from('profiles').select('id, full_name').in('id', mentorIds);
    if (profErr) return res.status(500).json({ error: profErr.message });
    const nameMap = {};
    (profiles || []).forEach((p) => { nameMap[p.id] = p.full_name || ''; });
    const mentors = linkList.map((l) => ({
      id: l.mentor_id,
      name: nameMap[l.mentor_id] || (l.mentor_role === 'parinte' ? 'Părinte' : 'Profesor'),
      role: l.mentor_role,
    }));
    return res.status(200).json({ mentors });
  }

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
  if ((action === 'remove_student' || action === 'delete_archived') && !isMentor) {
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

    // Șterge DEFINITIV arhiva unui elev șters (rezultatele păstrate pentru
    // acest mentor). Doar mentorul proprietar își poate șterge arhiva.
    if (action === 'delete_archived') {
      const { archiveId } = req.body;
      if (!archiveId) return res.status(400).json({ error: 'archiveId obligatoriu' });
      const { data: gone, error } = await supabase
        .from('archived_student_results').delete()
        .eq('id', archiveId).eq('mentor_id', userId)
        .select('id');
      if (error) throw error;
      if (!gone || !gone.length) return res.status(404).json({ error: 'Arhiva nu există (sau nu îți aparține).' });
      return res.status(200).json({ ok: true });
    }

    return res.status(400).json({ error: 'Acțiune necunoscută.' });
  } catch (e) {
    return res.status(500).json({ error: e.message || 'Eroare server.' });
  }
};
