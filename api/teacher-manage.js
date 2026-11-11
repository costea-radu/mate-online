const { createClient } = require('@supabase/supabase-js');
const { handledMethod, authUser } = require('./_lib/http');
const NP = require('./_lib/noteProfesor');   // 📒 catalogul: note, plusuri, minusuri, aprecieri (11 nov. 2026)

// notificarea unei note / unui plus / minus / unei aprecieri (nu oprește salvarea)
async function notifyMark(supabase, mark, { teacherName, studentName }) {
  const send = async (recipientId, n, key) => {
    try {
      const { data: ex } = await supabase.from('ai_notifications').select('id')
        .eq('recipient_id', recipientId).eq('dedupe_key', key).limit(1);
      if (ex && ex.length) return;
      await supabase.from('ai_notifications').insert({
        recipient_id: recipientId, type: 'catalog', title: n.title.slice(0, 200), body: n.body ? String(n.body).slice(0, 600) : null,
        data: { url: '/profil?rezultate=1', markId: mark.id, kind: mark.kind }, dedupe_key: key,
      });
    } catch (e) { console.warn('catalog: notificarea nu a plecat:', e.message); }
  };
  const prof = teacherName ? `prof. ${teacherName}` : 'profesorul tău';
  await send(mark.student_id, NP.notificare(mark, { profesor: prof, cui: 'elev' }), `catalog:${mark.id}`);
  // părinții elevului (asociați cu rolul „parinte")
  try {
    const { data: parents } = await supabase.from('mentor_students').select('mentor_id')
      .eq('student_id', mark.student_id).eq('mentor_role', 'parinte');
    const elev = (studentName || 'Copilul tău').split(' ')[0];
    for (const p of parents || []) {
      // eslint-disable-next-line no-await-in-loop
      await send(p.mentor_id, NP.notificare(mark, { profesor: prof, elev, cui: 'parinte' }), `catalog:${mark.id}:p`);
    }
  } catch { /* fără părinți asociați */ }
}

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

  // 📒 Elevul: ce i-au dat profesorii (note, plusuri, minusuri, aprecieri) — oricine își
  // vede doar rândurile lui (src/pages/Profile.jsx → „Rezultatele mele", Home)
  if (action === 'my_marks') {
    const { data, error } = await supabase.from('teacher_marks')
      .select('id, teacher_id, teacher_name, kind, value, title, comment, created_at')
      .eq('student_id', userId).order('created_at', { ascending: false }).limit(200);
    if (error) {
      if (NP.lipsaTabela(error)) return res.status(200).json({ marks: [], setup: false });
      return res.status(500).json({ error: error.message });
    }
    return res.status(200).json({ marks: data || [], setup: true });
  }

  const { data: caller, error: callerErr } = await supabase
    .from('profiles')
    .select('role, full_name')
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
  // 📒 Catalogul (note, plusuri, minusuri, aprecieri) → doar profesorii
  if ((action === 'add_mark' || action === 'delete_mark') && !isTeacher) {
    return res.status(403).json({ error: 'Doar profesorii pot da note, plusuri, minusuri și aprecieri.' });
  }
  if ((action === 'close_average' || action === 'close_averages' || action === 'delete_average') && !isMentor) {
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
    // ── MEDIA FIECĂRUI ELEV, DINTR-UN SINGUR BUTON ────────────────────────
    // Profesorul nu mai deschide rândul fiecărui elev ca să-i încheie media:
    // apasă o dată, iar serverul închide media PERSONALĂ a fiecărui elev din
    // listă, cu notele lui de până în acel moment. Nu e media grupei — sunt
    // N medii de elev, fiecare cu propria numerotare și propriul interval.
    if (action === 'close_averages') {
      const items = Array.isArray(req.body.items) ? req.body.items.slice(0, 200) : [];
      if (!items.length) return res.status(400).json({ error: 'Nu sunt elevi cu note noi de încheiat.' });

      // o singură interogare pentru toate asocierile (nu una pe elev)
      const ids = [...new Set(items.map((it) => it && it.studentId).filter(Boolean))];
      if (!ids.length) return res.status(400).json({ error: 'studentId obligatoriu la fiecare elev.' });
      const { data: links } = await supabase.from('mentor_students')
        .select('student_id').eq('mentor_id', userId).in('student_id', ids);
      const asociati = new Set((links || []).map((l) => l.student_id));
      if (asociati.size < ids.length) { // asocierea veche (profiles.teacher_id)
        const { data: legacy } = await supabase.from('profiles')
          .select('id').eq('teacher_id', userId).in('id', ids.filter((i) => !asociati.has(i)));
        (legacy || []).forEach((r) => asociati.add(r.id));
      }

      // ultima medie a fiecărui elev → numărul și începutul perioadei noi
      const { data: prevAll, error: prevErr } = await supabase.from('mentor_grade_periods')
        .select('student_id, period_no, closed_at')
        .eq('teacher_id', userId).eq('scope', 'student').in('student_id', [...asociati])
        .order('closed_at', { ascending: true });
      if (prevErr) {
        const lipsa = /relation|does not exist|schema cache/i.test(prevErr.message || '');
        return res.status(500).json({
          error: lipsa
            ? 'Mediile au nevoie de tabela `mentor_grade_periods`. Rulează supabase/medii_si_timp.sql în Supabase → SQL Editor.'
            : prevErr.message,
        });
      }
      const ultima = {};
      (prevAll || []).forEach((r) => { ultima[r.student_id] = r; });   // ordonat crescător → rămâne ultima

      const acum = new Date().toISOString();
      const randuri = [];
      const sarite = [];
      for (const it of items) {
        const sid = it && it.studentId;
        const average = Number(it && it.average);
        const grades = Math.max(0, parseInt(it && it.grades, 10) || 0);
        if (!sid || !asociati.has(sid)) { sarite.push({ studentId: sid || null, motiv: 'neasociat' }); continue; }
        if (!grades) { sarite.push({ studentId: sid, motiv: 'fără note noi' }); continue; }
        if (!Number.isFinite(average) || average < 1 || average > 10) { sarite.push({ studentId: sid, motiv: 'medie invalidă' }); continue; }
        const last = ultima[sid] || null;
        randuri.push({
          teacher_id: userId, scope: 'student', student_id: sid, group_id: null, group_name: null,
          period_no: (last?.period_no || 0) + 1,
          from_at: last?.closed_at || null,
          closed_at: acum,
          average: Math.round(average * 100) / 100,
          grades,
          students: 1,
          details: it.details && typeof it.details === 'object' ? it.details : null,
        });
      }
      if (!randuri.length) {
        return res.status(400).json({ error: 'Niciun elev cu note noi de încheiat.', skipped: sarite });
      }
      const { data: saved, error } = await supabase
        .from('mentor_grade_periods').insert(randuri).select('*');
      if (error) throw error;
      return res.status(200).json({ ok: true, periods: saved || [], closed: (saved || []).length, skipped: sarite });
    }

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

    // ─── 📒 CATALOGUL: NOTĂ / PLUS / MINUS / APRECIERE (11 nov. 2026) ──────
    // Profesorul îi dă unui elev asociat lui o notă (1–10), un plus, un minus sau o
    // apreciere. Elevul și părinții lui primesc o notificare; notele intră în mediile
    // profesorului (src/components/TeacherResults.jsx → gradesOf).
    if (action === 'add_mark') {
      const studentId = req.body.studentId;
      if (!studentId) return res.status(400).json({ error: 'studentId obligatoriu' });
      const v = NP.validateMark(req.body);
      if (!v.ok) return res.status(400).json({ error: v.error });
      const { data: link } = await supabase.from('mentor_students')
        .select('student_id, group_id').eq('mentor_id', userId).eq('student_id', studentId).maybeSingle();
      let groupId = link ? (link.group_id || null) : null;
      if (!link) {
        const { data: legacy } = await supabase.from('profiles')
          .select('id').eq('id', studentId).eq('teacher_id', userId).maybeSingle();
        if (!legacy) return res.status(403).json({ error: 'Elevul nu este asociat contului tău.' });
        groupId = null;
      }
      const { data: stud } = await supabase.from('profiles').select('full_name').eq('id', studentId).maybeSingle();
      const teacherName = caller.full_name || null;
      const { data: saved, error } = await supabase.from('teacher_marks').insert({
        teacher_id: userId, teacher_name: teacherName, student_id: studentId, group_id: groupId, ...v.row,
      }).select('*').single();
      if (error) {
        if (NP.lipsaTabela(error)) {
          return res.status(500).json({ error: 'Catalogul are nevoie de tabela `teacher_marks`. Rulează supabase/catalog_profesor.sql în Supabase → SQL Editor.', code: 'SETUP' });
        }
        throw error;
      }
      await notifyMark(supabase, saved, { teacherName, studentName: stud?.full_name || null });
      return res.status(200).json({ ok: true, mark: saved });
    }

    if (action === 'delete_mark') {
      const { markId } = req.body;
      if (!markId) return res.status(400).json({ error: 'markId obligatoriu' });
      const { data: gone, error } = await supabase.from('teacher_marks').delete()
        .eq('id', markId).eq('teacher_id', userId).select('id');
      if (error) throw error;
      if (!gone || !gone.length) return res.status(404).json({ error: 'Rândul nu există (sau nu l-ai dat tu).' });
      return res.status(200).json({ ok: true });
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
