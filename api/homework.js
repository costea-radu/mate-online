// =====================================================================
// api/homework.js — TEME date de profesor: pe GRUPĂ sau pe ELEV, separat
//
// Butonul „📝 Dă temă" (lângă grupă și lângă fiecare elev, în „Contul meu" →
// Grupe / Rezultate elevi) deschide lista de exerciții cu bifare și căutare.
// Exercițiile bifate devin TEMA: toți elevii vizați primesc ACELAȘI set.
// (Diferă de „TEST pe grupă" — api/group-assignment.js — unde fiecare elev
// primește ALT test dintr-un bazin.)
//
// POST { action, ... }
//   catalog       (profesor): testele/exercițiile de bifat { sources, category, format, q }
//   create        (profesor): { groupId | studentId, items[], title, note, dueAt } → { id, url }
//   mine          (profesor): temele date, cu progresul elevilor
//   report        (profesor): { id } → elev × exercițiu → stare și scor
//   rename        (profesor): { id, title }
//   delete        (profesor): { id }
//   student_list  (elev):     temele lui — nefăcute și făcute (+ teste pe grupă
//                             nerezolvate + teme primite prin link /tema)
//   open          (elev):     { id } → tema + exercițiile ei, gata de deschis
//   score         (elev):     { progressId, score, maxScore } sau { done: true }
//
// Tabele: supabase/teme_elevi.sql
// =====================================================================
const ai = require('./_lib/ai');
const cat = require('./_lib/catalog');

const MAX_ITEMS = 40;

module.exports = async function handler(req, res) {
  ai.applyCors(res);
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method Not Allowed' });

  const supa = ai.admin();
  try {
    const { action } = req.body || {};
    if (action === 'catalog') return await catalog(req, res, supa);
    if (action === 'create') return await create(req, res, supa);
    if (action === 'mine') return await mine(req, res, supa);
    if (action === 'report') return await report(req, res, supa);
    if (action === 'rename') return await rename(req, res, supa);
    if (action === 'delete') return await remove(req, res, supa);
    if (action === 'student_list') return await studentList(req, res, supa);
    if (action === 'open') return await openOne(req, res, supa);
    if (action === 'score') return await score(req, res, supa);
    return res.status(400).json({ error: 'action invalid' });
  } catch (err) {
    console.error('homework error:', err);
    return res.status(err.status || 500).json({ error: err.message || 'Eroare server', code: err.code || null });
  }
};

// ─── Ajutoare ────────────────────────────────────────────────────────────────
async function requireTeacher(req, supa) {
  const userId = await ai.authUser(req, supa);
  const profile = await ai.requireUser(supa, userId);
  if (!(profile.role === 'profesor' || profile.is_admin)) {
    const e = new Error('Doar conturile de profesor pot da teme.');
    e.status = 403; throw e;
  }
  return { userId, profile };
}

// Elevii unei grupe (sau toți elevii profesorului, când groupId e null).
async function studentsOf(supa, teacherId, groupId) {
  let q = supa.from('mentor_students').select('student_id, group_id')
    .eq('mentor_id', teacherId).eq('mentor_role', 'profesor');
  if (groupId) q = q.eq('group_id', groupId);
  const { data } = await q;
  const ids = new Set((data || []).map((l) => l.student_id));
  if (!groupId) {
    const { data: legacy } = await supa.from('profiles').select('id').eq('teacher_id', teacherId);
    (legacy || []).forEach((p) => ids.add(p.id));
  }
  return [...ids];
}

// Aceleași asocieri, citite O SINGURĂ DATĂ (pentru listele cu multe teme).
async function rosterOf(supa, teacherId) {
  const { data } = await supa.from('mentor_students').select('student_id, group_id')
    .eq('mentor_id', teacherId).eq('mentor_role', 'profesor');
  const links = data || [];
  const { data: legacy } = await supa.from('profiles').select('id').eq('teacher_id', teacherId);
  const all = new Set(links.map((l) => l.student_id));
  (legacy || []).forEach((p) => all.add(p.id));
  return {
    all: [...all],
    inGroup: (gid) => links.filter((l) => l.group_id === gid).map((l) => l.student_id),
  };
}

async function displayName(supa, userId, fallback = 'Profesor') {
  try {
    const { data } = await supa.from('profiles').select('full_name, username, email').eq('id', userId).maybeSingle();
    return data?.full_name || data?.username || (data?.email ? data.email.split('@')[0] : null) || fallback;
  } catch { return fallback; }
}

// Elevii vizați de o temă (unul singur, sau toată grupa)
async function targetsOf(supa, hw, roster = null) {
  if (hw.student_id) return [hw.student_id];
  if (roster) return hw.group_id ? roster.inGroup(hw.group_id) : roster.all;
  return await studentsOf(supa, hw.teacher_id, hw.group_id);
}

// Tema îi este adresată acestui elev?
async function isTarget(supa, hw, studentId) {
  if (hw.student_id) return hw.student_id === studentId;
  const ids = await targetsOf(supa, hw);
  return ids.includes(studentId);
}

// ─── Catalogul de exerciții pentru bifare ────────────────────────────────────
async function catalog(req, res, supa) {
  const { userId } = await requireTeacher(req, supa);
  const {
    sources = ['site'], category = null, format = null, q = '',
  } = req.body || {};
  const srcs = (Array.isArray(sources) ? sources : [sources]).filter((s) => cat.SOURCES.includes(s));
  if (!srcs.length) return res.status(400).json({ error: 'Alege cel puțin o sursă.' });
  // format null → și interactive, și PDF (profesorul poate amesteca)
  const formats = format && cat.FORMATS.includes(format) ? [format] : cat.FORMATS;

  const lists = [];
  for (const s of srcs) {
    for (const f of formats) {
      lists.push(await cat.catalogList(supa, userId, { source: s, category, format: f }));
    }
  }
  let items = lists.flat();
  // fără dubluri (un PDF poate apărea în două treceri de format)
  const seen = new Set();
  items = items.filter((i) => {
    const k = `${i.source}:${i.refId}`;
    if (seen.has(k)) return false;
    seen.add(k); return true;
  });
  const needle = String(q || '').trim().toLowerCase();
  if (needle) items = items.filter((i) => (i.title || '').toLowerCase().includes(needle));
  return res.status(200).json({ items: items.slice(0, 300) });
}

// ─── Crearea temei ───────────────────────────────────────────────────────────
async function create(req, res, supa) {
  const { userId, profile } = await requireTeacher(req, supa);
  const {
    groupId = null, studentId = null, items = [],
    title = null, note = null, dueAt = null,
  } = req.body || {};

  if (!Array.isArray(items) || !items.length) {
    return res.status(400).json({ error: 'Bifează cel puțin un exercițiu.' });
  }

  // grupa trebuie să fie a profesorului
  let groupName = null;
  if (groupId) {
    const { data: g } = await supa.from('mentor_groups').select('id, name, teacher_id').eq('id', groupId).maybeSingle();
    if (!g || (g.teacher_id !== userId && !profile.is_admin)) return res.status(403).json({ error: 'Grupa nu îți aparține.' });
    groupName = g.name;
  }

  // elevul trebuie să fie asociat profesorului
  let studentName = null;
  if (studentId) {
    const { data: link } = await supa.from('mentor_students')
      .select('student_id, group_id').eq('mentor_id', userId).eq('student_id', studentId).maybeSingle();
    let linked = !!link;
    if (!linked) {
      const { data: p } = await supa.from('profiles').select('teacher_id').eq('id', studentId).maybeSingle();
      linked = p?.teacher_id === userId;
    }
    if (!linked && !profile.is_admin) return res.status(403).json({ error: 'Elevul nu este asociat contului tău.' });
    studentName = await displayName(supa, studentId, 'Elev');
  }

  const pool = await cat.resolveChosen(supa, userId, items, null, MAX_ITEMS);
  if (!pool.length) {
    return res.status(400).json({ error: 'Exercițiile bifate nu mai există sau nu îți sunt accesibile.' });
  }

  const teacherName = await displayName(supa, userId);
  const t = String(title || '').trim().slice(0, 120)
    || (studentName ? `Temă · ${studentName}` : `Temă${groupName ? ` · ${groupName}` : ''}`);

  const { data: row, error } = await supa.from('homework').insert({
    teacher_id: userId, teacher_name: teacherName,
    group_id: groupId || null, group_name: groupName,
    student_id: studentId || null, student_name: studentName,
    title: t, note: String(note || '').trim().slice(0, 500) || null,
    due_at: dueAt || null,
  }).select('id').single();
  if (error) return res.status(500).json({ error: error.message });

  const { error: iErr } = await supa.from('homework_items').insert(
    pool.map((p, i) => ({
      homework_id: row.id, source: p.source, ref_id: p.refId, kind: p.kind,
      title: p.title, category: p.category, is_free: p.isFree !== false, position: i,
    }))
  );
  if (iErr) {
    await supa.from('homework').delete().eq('id', row.id);
    return res.status(500).json({ error: iErr.message });
  }

  // notificare pentru elevii vizați
  const url = `/tema-elev?id=${row.id}`;
  let sentTo = 0;
  try {
    const ids = studentId ? [studentId] : await studentsOf(supa, userId, groupId);
    for (const sid of ids) {
      await ai.createNotification(supa, {
        recipientId: sid, type: 'assignment',
        title: `Ai o temă nouă de la profesorul ${teacherName}`.trim(),
        body: `${t} · ${pool.length} ${pool.length === 1 ? 'exercițiu' : 'exerciții'}`,
        data: { url, homeworkId: row.id },
        dedupeKey: `homework:${row.id}:${sid}`, dedupeDays: 30,
      });
      sentTo += 1;
    }
  } catch (e) { console.warn('homework notify:', e.message); }

  return res.status(200).json({
    id: row.id, url, title: t, items: pool.length, students: sentTo,
    groupId: groupId || null, groupName, studentId: studentId || null, studentName,
  });
}

// ─── Temele mele (profesor) ──────────────────────────────────────────────────
async function mine(req, res, supa) {
  const { userId } = await requireTeacher(req, supa);
  const { data: rows } = await supa.from('homework')
    .select('id, title, group_id, group_name, student_id, student_name, note, due_at, created_at')
    .eq('teacher_id', userId).order('created_at', { ascending: false }).limit(40);
  const list = rows || [];
  if (!list.length) return res.status(200).json({ homework: [] });

  const ids = list.map((h) => h.id);
  const { data: its } = await supa.from('homework_items')
    .select('id, homework_id, source, ref_id').in('homework_id', ids);
  const itemsByHw = {};
  (its || []).forEach((i) => { (itemsByHw[i.homework_id] || (itemsByHw[i.homework_id] = [])).push(i); });

  const { data: prog } = await supa.from('homework_progress')
    .select('homework_id, item_id, student_id, score, max_score, completed_at').in('homework_id', ids);

  // rezolvările testelor DIN SITE ajung în `progress`, nu în homework_progress
  const roster = await rosterOf(supa, userId);
  const siteRefs = [...new Set((its || []).filter((i) => i.source === 'site').map((i) => i.ref_id))];
  const allStudents = new Set();
  for (const h of list) (await targetsOf(supa, h, roster)).forEach((s) => allStudents.add(s));
  const siteDone = await siteProgressMap(supa, siteRefs, [...allStudents]);

  const out = [];
  for (const h of list) {
    const items = itemsByHw[h.id] || [];
    const students = await targetsOf(supa, h, roster);
    const need = items.length * students.length;
    let done = 0;
    const pr = (prog || []).filter((p) => p.homework_id === h.id);
    students.forEach((sid) => {
      items.forEach((it) => {
        const row = pr.find((p) => p.student_id === sid && p.item_id === it.id);
        if (row?.completed_at) { done += 1; return; }
        if (it.source === 'site' && siteDone[`${sid}:${it.ref_id}`]) done += 1;
      });
    });
    out.push({
      ...h, url: `/tema-elev?id=${h.id}`,
      items: items.length, students: students.length,
      done, need, percent: need ? Math.round((done / need) * 100) : 0,
    });
  }
  return res.status(200).json({ homework: out });
}

// Ce teste „din site" au rezolvat elevii (tabela `progress`)
async function siteProgressMap(supa, contentIds, studentIds) {
  const map = {};
  if (!contentIds.length || !studentIds.length) return map;
  const { data } = await supa.from('progress')
    .select('user_id, content_id, score, max_score, attempts, completed_at')
    .in('content_id', contentIds).in('user_id', studentIds);
  (data || []).forEach((p) => { map[`${p.user_id}:${p.content_id}`] = p; });
  return map;
}

// ─── Raport: elev × exercițiu ────────────────────────────────────────────────
async function report(req, res, supa) {
  const { userId, profile } = await requireTeacher(req, supa);
  const { id } = req.body || {};
  if (!id) return res.status(400).json({ error: 'id obligatoriu' });
  const { data: h } = await supa.from('homework').select('*').eq('id', id).maybeSingle();
  if (!h) return res.status(404).json({ error: 'Tema nu există.' });
  if (h.teacher_id !== userId && !profile.is_admin) return res.status(403).json({ error: 'Nu e tema ta.' });

  const { data: items } = await supa.from('homework_items')
    .select('id, source, ref_id, kind, title, category, is_free, position')
    .eq('homework_id', id).order('position', { ascending: true });
  const { data: prog } = await supa.from('homework_progress')
    .select('item_id, student_id, score, max_score, attempts, opened_at, completed_at')
    .eq('homework_id', id);

  const students = await targetsOf(supa, h, await rosterOf(supa, h.teacher_id));
  const names = {};
  if (students.length) {
    const { data: profs } = await supa.from('profiles').select('id, full_name, email').in('id', students);
    (profs || []).forEach((p) => { names[p.id] = p.full_name || p.email || 'Elev'; });
  }
  const siteRefs = [...new Set((items || []).filter((i) => i.source === 'site').map((i) => i.ref_id))];
  const siteDone = await siteProgressMap(supa, siteRefs, students);

  const rows = students.map((sid) => {
    const cells = (items || []).map((it) => {
      const p = (prog || []).find((x) => x.student_id === sid && x.item_id === it.id);
      const sp = it.source === 'site' ? siteDone[`${sid}:${it.ref_id}`] : null;
      const sc = p?.score != null ? p.score : (sp ? sp.score : null);
      const mx = p?.max_score != null ? p.max_score : (sp ? sp.max_score : null);
      return {
        itemId: it.id, title: it.title,
        done: !!(p?.completed_at || sp?.completed_at),
        opened: !!(p?.opened_at || sp),
        score: sc, maxScore: mx,
        percent: sc != null && mx ? Math.round((sc / mx) * 100) : null,
      };
    });
    const done = cells.filter((c) => c.done).length;
    const scored = cells.filter((c) => c.percent != null);
    return {
      studentId: sid, name: names[sid] || 'Elev',
      cells, done, total: cells.length,
      avg: scored.length ? Math.round(scored.reduce((a, c) => a + c.percent, 0) / scored.length) : null,
    };
  });

  return res.status(200).json({ homework: { ...h, url: `/tema-elev?id=${h.id}` }, items: items || [], rows });
}

// ─── Redenumire ──────────────────────────────────────────────────────────────
async function rename(req, res, supa) {
  const { userId, profile } = await requireTeacher(req, supa);
  const { id, title } = req.body || {};
  const t = String(title || '').trim().slice(0, 120);
  if (!id || !t) return res.status(400).json({ error: 'id și title obligatorii' });
  const { data: h } = await supa.from('homework').select('teacher_id').eq('id', id).maybeSingle();
  if (!h) return res.status(404).json({ error: 'Tema nu există.' });
  if (h.teacher_id !== userId && !profile.is_admin) return res.status(403).json({ error: 'Nu e tema ta.' });
  const { error } = await supa.from('homework').update({ title: t }).eq('id', id);
  if (error) return res.status(500).json({ error: error.message });
  return res.status(200).json({ ok: true, title: t });
}

// ─── Ștergere ────────────────────────────────────────────────────────────────
async function remove(req, res, supa) {
  const { userId, profile } = await requireTeacher(req, supa);
  const { id } = req.body || {};
  if (!id) return res.status(400).json({ error: 'id obligatoriu' });
  const { data: h } = await supa.from('homework').select('teacher_id').eq('id', id).maybeSingle();
  if (!h) return res.status(404).json({ error: 'Tema nu există.' });
  if (h.teacher_id !== userId && !profile.is_admin) return res.status(403).json({ error: 'Nu poți șterge tema altcuiva.' });
  await supa.from('homework').delete().eq('id', id); // exercițiile și progresul cad în cascadă
  return res.status(200).json({ ok: true });
}

// ─── ELEV: „Teme nefăcute" ───────────────────────────────────────────────────
// Adună tot ce are elevul de făcut:
//   1. teme date cu butonul „dă temă" (tabelele homework*);
//   2. teste pe grupă nerezolvate (group_assignments — un link, alt test/elev);
//   3. teme trimise individual prin link (/tema?id=…, ai_assignments).
async function studentList(req, res, supa) {
  const userId = await ai.authUser(req, supa);
  await ai.requireUser(supa, userId);

  const pending = [];
  const done = [];

  // grupele / profesorii elevului
  const { data: links } = await supa.from('mentor_students')
    .select('mentor_id, mentor_role, group_id').eq('student_id', userId);
  const teacherLinks = (links || []).filter((l) => l.mentor_role === 'profesor');
  const teacherIds = [...new Set(teacherLinks.map((l) => l.mentor_id))];
  const groupIds = [...new Set(teacherLinks.map((l) => l.group_id).filter(Boolean))];
  const { data: me } = await supa.from('profiles').select('teacher_id').eq('id', userId).maybeSingle();
  if (me?.teacher_id && !teacherIds.includes(me.teacher_id)) teacherIds.push(me.teacher_id);

  if (!teacherIds.length) return res.status(200).json({ pending, done, hasTeacher: false });

  // ── 1. Teme (homework) ────────────────────────────────────────────────────
  // Îi revin: temele adresate LUI, cele date grupei lui și cele date „tuturor
  // elevilor" profesorului (fără grupă și fără elev).
  let hwRows = [];
  try {
    const { data } = await supa.from('homework')
      .select('id, title, teacher_id, teacher_name, group_id, group_name, student_id, note, due_at, created_at')
      .in('teacher_id', teacherIds)
      .order('created_at', { ascending: false }).limit(80);
    hwRows = (data || []).filter((h) => {
      if (h.student_id) return h.student_id === userId;
      if (h.group_id) return groupIds.includes(h.group_id);
      return true;
    });
  } catch { /* tabelele apar după rularea supabase/teme_elevi.sql */ }

  if (hwRows.length) {
    const ids = hwRows.map((h) => h.id);
    const { data: its } = await supa.from('homework_items')
      .select('id, homework_id, source, ref_id, title').in('homework_id', ids);
    const { data: prog } = await supa.from('homework_progress')
      .select('homework_id, item_id, score, max_score, completed_at')
      .in('homework_id', ids).eq('student_id', userId);
    const siteRefs = [...new Set((its || []).filter((i) => i.source === 'site').map((i) => i.ref_id))];
    const siteDone = await siteProgressMap(supa, siteRefs, [userId]);

    hwRows.forEach((h) => {
      const items = (its || []).filter((i) => i.homework_id === h.id);
      if (!items.length) return;
      const doneCount = items.filter((it) => {
        const p = (prog || []).find((x) => x.item_id === it.id);
        if (p?.completed_at) return true;
        return it.source === 'site' && !!siteDone[`${userId}:${it.ref_id}`];
      }).length;
      const entry = {
        kind: 'tema', id: h.id, url: `/tema-elev?id=${h.id}`,
        title: h.title, teacher: h.teacher_name, group: h.group_name,
        note: h.note, dueAt: h.due_at, at: h.created_at,
        items: items.length, doneItems: doneCount,
      };
      (doneCount >= items.length ? done : pending).push(entry);
    });
  }

  // ── 2. Teste pe grupă ─────────────────────────────────────────────────────
  try {
    const { data: gas } = await supa.from('group_assignments')
      .select('id, title, creator_name, group_id, group_name, format, due_at, created_at')
      .in('created_by', teacherIds).order('created_at', { ascending: false }).limit(40);
    const forMe = (gas || []).filter((a) => !a.group_id || groupIds.includes(a.group_id));
    if (forMe.length) {
      const ids = forMe.map((a) => a.id);
      const { data: picks } = await supa.from('group_assignment_picks')
        .select('assignment_id, item_id, score, max_score, completed_at')
        .in('assignment_id', ids).eq('student_id', userId);
      const { data: its } = await supa.from('group_assignment_items')
        .select('id, assignment_id, source, ref_id, title').in('assignment_id', ids);
      const siteRefs = [...new Set((its || []).filter((i) => i.source === 'site').map((i) => i.ref_id))];
      const siteDone = await siteProgressMap(supa, siteRefs, [userId]);
      forMe.forEach((a) => {
        const p = (picks || []).find((x) => x.assignment_id === a.id);
        const it = p ? (its || []).find((x) => x.id === p.item_id) : null;
        const isDone = !!(p?.completed_at) || !!(it && it.source === 'site' && siteDone[`${userId}:${it.ref_id}`]);
        const entry = {
          kind: 'test', id: a.id, url: `/tema-grupa?id=${a.id}`,
          title: a.title, teacher: a.creator_name, group: a.group_name,
          dueAt: a.due_at, at: a.created_at,
          items: 1, doneItems: isDone ? 1 : 0,
          test: it?.title || null, opened: !!p,
        };
        (isDone ? done : pending).push(entry);
      });
    }
  } catch { /* fără teme pe grupă */ }

  // ── 3. Teme trimise individual prin link (/tema?id=…) ─────────────────────
  try {
    const { data: notifs } = await supa.from('ai_notifications')
      .select('data, created_at').eq('recipient_id', userId).eq('type', 'assignment')
      .order('created_at', { ascending: false }).limit(40);
    const aIds = [...new Set((notifs || []).map((n) => n.data?.assignmentId).filter(Boolean))];
    if (aIds.length) {
      const { data: assigns } = await supa.from('ai_assignments')
        .select('id, title, creator_name, created_at').in('id', aIds);
      const { data: results } = await supa.from('ai_assignment_results')
        .select('assignment_id, score, max_score, completed_at').in('assignment_id', aIds).eq('student_id', userId);
      (assigns || []).forEach((a) => {
        const r = (results || []).find((x) => x.assignment_id === a.id);
        const entry = {
          kind: 'tema-link', id: a.id, url: `/tema?id=${a.id}`,
          title: a.title || 'Temă', teacher: a.creator_name, group: null,
          at: a.created_at, items: 1, doneItems: r?.completed_at ? 1 : 0,
        };
        (r?.completed_at ? done : pending).push(entry);
      });
    }
  } catch { /* opțional */ }

  const byDate = (a, b) => new Date(b.at || 0) - new Date(a.at || 0);
  pending.sort(byDate); done.sort(byDate);
  return res.status(200).json({ pending, done: done.slice(0, 30), hasTeacher: true });
}

// ─── ELEV: deschiderea unei teme ─────────────────────────────────────────────
async function openOne(req, res, supa) {
  const userId = await ai.authUser(req, supa);
  const profile = await ai.requireUser(supa, userId);
  const { id } = req.body || {};
  if (!id) return res.status(400).json({ error: 'id obligatoriu' });

  const { data: h } = await supa.from('homework').select('*').eq('id', id).maybeSingle();
  if (!h) return res.status(404).json({ error: 'Tema nu a fost găsită (poate a fost ștearsă).' });

  const isTeacher = h.teacher_id === userId;
  if (!isTeacher && !profile.is_admin) {
    const ok = await isTarget(supa, h, userId);
    if (!ok) return res.status(403).json({ error: 'Această temă nu îți este adresată.', code: 'NOT_TARGET' });
  }

  const { data: items } = await supa.from('homework_items')
    .select('id, source, ref_id, kind, title, category, is_free, position')
    .eq('homework_id', id).order('position', { ascending: true });
  if (!items || !items.length) return res.status(404).json({ error: 'Tema nu conține niciun exercițiu.' });

  // rândurile de progres se creează la prima deschidere (profesorul doar previzualizează)
  let progRows = [];
  if (!isTeacher) {
    const { data: existing } = await supa.from('homework_progress')
      .select('id, item_id, score, max_score, attempts, opened_at, completed_at')
      .eq('homework_id', id).eq('student_id', userId);
    progRows = existing || [];
    const missing = items.filter((it) => !progRows.some((p) => p.item_id === it.id));
    if (missing.length) {
      await supa.from('homework_progress').insert(
        missing.map((it) => ({ homework_id: id, item_id: it.id, student_id: userId, opened_at: new Date().toISOString() }))
      ).then(() => {}, () => {});
      const { data: again } = await supa.from('homework_progress')
        .select('id, item_id, score, max_score, attempts, opened_at, completed_at')
        .eq('homework_id', id).eq('student_id', userId);
      progRows = again || progRows;
    }
  }

  const siteRefs = [...new Set(items.filter((i) => i.source === 'site').map((i) => i.ref_id))];
  const siteDone = await siteProgressMap(supa, siteRefs, [userId]);

  const out = [];
  for (const it of items) {
    const target = await cat.resolveTarget(supa, it, { userId, profile, premiumFree: false });
    const p = progRows.find((x) => x.item_id === it.id) || null;
    const sp = it.source === 'site' ? siteDone[`${userId}:${it.ref_id}`] : null;
    const sc = p?.score != null ? p.score : (sp ? sp.score : null);
    const mx = p?.max_score != null ? p.max_score : (sp ? sp.max_score : null);
    out.push({
      ...cat.publicItem(it), progressId: p?.id || null, target,
      done: !!(p?.completed_at || sp?.completed_at),
      score: sc, maxScore: mx,
      percent: sc != null && mx ? Math.round((sc / mx) * 100) : null,
    });
  }

  return res.status(200).json({
    homework: {
      id: h.id, title: h.title, teacher: h.teacher_name, group: h.group_name,
      note: h.note, dueAt: h.due_at, createdAt: h.created_at,
      forStudent: !!h.student_id,
    },
    preview: isTeacher,
    items: out,
  });
}

// ─── ELEV: rezultatul unui exercițiu din temă ────────────────────────────────
async function score(req, res, supa) {
  const userId = await ai.authUser(req, supa);
  const { progressId, score: sc = null, maxScore: mx = null, done = true } = req.body || {};
  if (!progressId) return res.status(400).json({ error: 'progressId obligatoriu' });

  const { data: p } = await supa.from('homework_progress')
    .select('id, homework_id, item_id, student_id, score, attempts').eq('id', progressId).maybeSingle();
  if (!p) return res.status(404).json({ error: 'Exercițiul nu e din temele tale.' });
  if (p.student_id !== userId) return res.status(403).json({ error: 'Nu e tema ta.' });

  const patch = { attempts: (p.attempts || 0) + 1 };
  if (sc != null) {
    const s = Math.max(0, parseInt(sc, 10) || 0);
    const m = Math.max(1, parseInt(mx, 10) || 100);
    patch.score = Math.max(p.score || 0, s);
    patch.max_score = m;
  }
  if (done) patch.completed_at = new Date().toISOString();

  const { error } = await supa.from('homework_progress').update(patch).eq('id', p.id);
  if (error) return res.status(500).json({ error: error.message });

  // anunță profesorul când tema e gata de tot
  try {
    const { data: h } = await supa.from('homework').select('teacher_id, title').eq('id', p.homework_id).maybeSingle();
    const { data: items } = await supa.from('homework_items').select('id, source, ref_id').eq('homework_id', p.homework_id);
    const { data: rows } = await supa.from('homework_progress')
      .select('item_id, completed_at').eq('homework_id', p.homework_id).eq('student_id', userId);
    const siteRefs = [...new Set((items || []).filter((i) => i.source === 'site').map((i) => i.ref_id))];
    const siteDone = await siteProgressMap(supa, siteRefs, [userId]);
    const allDone = (items || []).every((it) => {
      const r = (rows || []).find((x) => x.item_id === it.id);
      return r?.completed_at || (it.source === 'site' && siteDone[`${userId}:${it.ref_id}`]);
    });
    if (allDone && h) {
      const { data: mep } = await supa.from('profiles').select('full_name, email').eq('id', userId).maybeSingle();
      await ai.createNotification(supa, {
        recipientId: h.teacher_id, type: 'assignment_done',
        title: `${mep?.full_name || mep?.email || 'Un elev'} a terminat tema „${h.title}"`,
        body: `${(items || []).length} ${(items || []).length === 1 ? 'exercițiu' : 'exerciții'} rezolvate.`,
        data: { url: '/profil', homeworkId: p.homework_id, studentId: userId },
        dedupeKey: `homework_done:${p.homework_id}:${userId}`, dedupeDays: 3,
      });
    }
  } catch { /* notificarea nu blochează salvarea */ }

  return res.status(200).json({ ok: true });
}
