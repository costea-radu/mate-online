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
  // Mediile încheiate — profesorii și părinții (părintele are un singur copil,
  // deci doar media „pe elev"; media pe grupă rămâne a profesorului).
  if ((action === 'close_average' || action === 'delete_average') && !isMentor) {
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

    // ─── MEDII ÎNCHEIATE ──────────────────────────────────────────────────
    // „Încheie media": notele elevului (sau ale întregii grupe) de până în acest
    // moment se închid într-o medie salvată. Notele care vin după intră singure
    // în perioada următoare, care își primește propriul buton — ca în catalog.
    //
    // Mediile se calculează în interfață, din exact notele pe care le vede
    // profesorul („Grupe / Rezultate elevi"), ca cifra salvată să fie aceeași cu
    // cea de pe ecran. Serverul verifică apartenența elevului, înlănțuie
    // perioadele (from_at = closed_at al mediei dinainte) și le numerotează.
    if (action === 'close_average') {
      const scope = req.body.scope === 'group' ? 'group' : 'student';
      const studentId = req.body.studentId || null;
      const groupId = req.body.groupId || null;
      const average = Number(req.body.average);
      const grades = Math.max(0, parseInt(req.body.grades, 10) || 0);

      if (!grades) return res.status(400).json({ error: 'Nu sunt note noi de încheiat.' });
      if (!Number.isFinite(average) || average < 1 || average > 10) {
        return res.status(400).json({ error: 'Media trebuie să fie între 1 și 10.' });
      }
      if (scope === 'group' && !isTeacher) {
        return res.status(403).json({ error: 'Doar profesorii pot încheia media unei grupe.' });
      }
      if (scope === 'student') {
        if (!studentId) return res.status(400).json({ error: 'studentId obligatoriu' });
        const { data: link } = await supabase.from('mentor_students')
          .select('student_id').eq('mentor_id', userId).eq('student_id', studentId).maybeSingle();
        if (!link) {
          // asocierea veche (profiles.teacher_id), de dinaintea grupelor
          const { data: legacy } = await supabase.from('profiles')
            .select('id').eq('id', studentId).eq('teacher_id', userId).maybeSingle();
          if (!legacy) return res.status(403).json({ error: 'Elevul nu este asociat contului tău.' });
        }
      }
      if (scope === 'group' && groupId) {
        const { data: g } = await supabase.from('mentor_groups')
          .select('id').eq('id', groupId).eq('teacher_id', userId).maybeSingle();
        if (!g) return res.status(403).json({ error: 'Grupa nu îți aparține.' });
      }

      // perioada dinainte → de unde începe cea nouă și ce număr primește
      let prevQ = supabase.from('mentor_grade_periods')
        .select('period_no, closed_at')
        .eq('teacher_id', userId).eq('scope', scope)
        .order('closed_at', { ascending: false }).limit(1);
      prevQ = scope === 'student'
        ? prevQ.eq('student_id', studentId)
        : (groupId ? prevQ.eq('group_id', groupId) : prevQ.is('group_id', null));
      const { data: prev, error: prevErr } = await prevQ;
      if (prevErr) {
        // cel mai des: tabela încă nu există pe instalarea asta
        const lipsa = /relation|does not exist|schema cache/i.test(prevErr.message || '');
        return res.status(500).json({
          error: lipsa
            ? 'Mediile au nevoie de tabela `mentor_grade_periods`. Rulează supabase/medii_si_timp.sql în Supabase → SQL Editor.'
            : prevErr.message,
        });
      }
      const last = (prev || [])[0] || null;

      const row = {
        teacher_id: userId,
        scope,
        student_id: scope === 'student' ? studentId : null,
        group_id: scope === 'group' ? groupId : null,
        group_name: scope === 'group' ? String(req.body.groupName || '').slice(0, 60) || null : null,
        period_no: (last?.period_no || 0) + 1,
        from_at: last?.closed_at || null,
        closed_at: new Date().toISOString(),
        average: Math.round(average * 100) / 100,
        grades,
        students: Math.max(0, parseInt(req.body.students, 10) || 0),
        details: req.body.details && typeof req.body.details === 'object' ? req.body.details : null,
      };
      const { data: saved, error } = await supabase
        .from('mentor_grade_periods').insert(row).select('*').single();
      if (error) throw error;
      return res.status(200).json({ ok: true, period: saved });
    }

    // Ștergerea unei medii încheiate: notele ei se întorc în perioada curentă.
    if (action === 'delete_average') {
      const { periodId } = req.body;
      if (!periodId) return res.status(400).json({ error: 'periodId obligatoriu' });
      const { data: gone, error } = await supabase
        .from('mentor_grade_periods').delete()
        .eq('id', periodId).eq('teacher_id', userId)
        .select('id');
      if (error) throw error;
      if (!gone || !gone.length) return res.status(404).json({ error: 'Media nu există (sau nu îți aparține).' });
      return res.status(200).json({ ok: true });
    }

    return res.status(400).json({ error: 'Acțiune necunoscută.' });
  } catch (e) {
    return res.status(500).json({ error: e.message || 'Eroare server.' });
  }
};
