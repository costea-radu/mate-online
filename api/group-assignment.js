// =====================================================================
// api/group-assignment.js — TEST PE GRUPĂ cu teste DIFERITE per elev
//
// Profesorul creează un test pe grupă și primește UN SINGUR LINK
// (/tema-grupa?id=...). Fiecare elev care îl deschide primește ALT test din
// „bazinul" temei — teste generate de el, din Biblioteca utilizatorilor sau
// din site („Examene" / „Clase"). Repartizarea rămâne fixă per elev, iar la
// testele următoare din aceeași grupă elevul primește, pe cât posibil, un test
// pe care nu l-a mai primit (istoric în group_test_history) — până la
// epuizarea testelor, apoi se reia.
//
// (TEMELE cu exerciții bifate, aceleași pentru toți, sunt în api/homework.js.)
//
// POST { action, ... }
//   groups      (profesor): grupele + numărul de elevi
//   catalog     (profesor): testele disponibile pentru bifat { source, category, format }
//   create      (profesor): creează testul + bazinul → { id, url }
//   mine        (profesor): testele mele pe grupă (cu progres)
//   report      (profesor): { id } → cine ce test a primit și ce scor a luat
//   rename      (profesor): { id, title } → denumirea unui link deja trimis
//   leaderboard (profesor): clasament DOAR cu testele pe grupă primite
//   delete      (profesor): { id }
//   open        (elev):     { id } → repartizează/întoarce testul elevului
//   pick        (elev):     { pickId } → testul repartizat (reîncărcare viewer)
//   score       (elev):     { pickId, score, maxScore }
//   test_start  (elev):     { pickId } → oprește mesageria pe durata testului
//   test_end    (elev):     { pickId } → o repornește
//
// Tabele: supabase/teme_grupa.sql
// Catalogul de teste și „rezolvarea" lor: api/_lib/catalog.js (partajat cu temele).
// =====================================================================
const ai = require('./_lib/ai');
const cat = require('./_lib/catalog');

const SOURCES = cat.SOURCES;
const FORMATS = cat.FORMATS;
const MAX_POOL = 60;
// catalogul de teste și „rezolvarea" unui test către ce vede elevul — partajate
// cu api/homework.js (api/_lib/catalog.js)
const publicItem = cat.publicItem;
const resolveTarget = cat.resolveTarget;

module.exports = async function handler(req, res) {
  ai.applyCors(res);
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method Not Allowed' });

  const supa = ai.admin();
  try {
    const { action } = req.body || {};
    if (action === 'groups') return await groups(req, res, supa);
    if (action === 'catalog') return await catalog(req, res, supa);
    if (action === 'create') return await create(req, res, supa);
    if (action === 'mine') return await mine(req, res, supa);
    if (action === 'report') return await report(req, res, supa);
    if (action === 'rename') return await rename(req, res, supa);
    if (action === 'leaderboard') return await leaderboard(req, res, supa);
    if (action === 'delete') return await remove(req, res, supa);
    if (action === 'open') return await openForStudent(req, res, supa);
    if (action === 'pick') return await pickOne(req, res, supa);
    if (action === 'score') return await score(req, res, supa);
    if (action === 'test_start') return await testMode(req, res, supa, true);
    if (action === 'test_end') return await testMode(req, res, supa, false);
    return res.status(400).json({ error: 'action invalid' });
  } catch (err) {
    console.error('group-assignment error:', err);
    return res.status(err.status || 500).json({ error: err.message || 'Eroare server', code: err.code || null });
  }
};

// ─── Ajutoare ────────────────────────────────────────────────────────────────
async function requireTeacher(req, supa) {
  const userId = await ai.authUser(req, supa);
  const profile = await ai.requireUser(supa, userId);
  if (!(profile.role === 'profesor' || profile.is_admin)) {
    const e = new Error('Doar conturile de profesor pot trimite teste pe grupă.');
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
    // asocierile vechi (profiles.teacher_id) — doar când tema e pentru toți elevii
    const { data: legacy } = await supa.from('profiles').select('id').eq('teacher_id', teacherId);
    (legacy || []).forEach((p) => ids.add(p.id));
  }
  return [...ids];
}

const keyOf = (source, refId) => `${source}:${refId}`;

// requireUser întoarce doar rolul/abonamentul — numele afișat se ia separat.
async function displayName(supa, userId, fallback = 'Profesor') {
  try {
    const { data } = await supa.from('profiles').select('full_name, username, email').eq('id', userId).maybeSingle();
    return data?.full_name || data?.username || (data?.email ? data.email.split('@')[0] : null) || fallback;
  } catch { return fallback; }
}

// ─── Grupele profesorului (pentru butonul de alegere a grupei) ───────────────
async function groups(req, res, supa) {
  const { userId } = await requireTeacher(req, supa);
  const { data: gs } = await supa.from('mentor_groups')
    .select('id, name, created_at').eq('teacher_id', userId).order('created_at', { ascending: true });
  const { data: links } = await supa.from('mentor_students')
    .select('student_id, group_id').eq('mentor_id', userId).eq('mentor_role', 'profesor');
  const counts = {};
  (links || []).forEach((l) => { const k = l.group_id || '_'; counts[k] = (counts[k] || 0) + 1; });
  const all = await studentsOf(supa, userId, null);
  return res.status(200).json({
    groups: (gs || []).map((g) => ({ id: g.id, name: g.name, students: counts[g.id] || 0 })),
    ungrouped: counts._ || 0,
    total: all.length,
  });
}

// ─── Catalogul de teste pentru bifat ─────────────────────────────────────────
async function catalog(req, res, supa) {
  const { userId } = await requireTeacher(req, supa);
  const { source = 'site', category = null, format = 'interactive', q = '' } = req.body || {};
  if (!SOURCES.includes(source)) return res.status(400).json({ error: 'sursă invalidă' });
  const fmt = FORMATS.includes(format) ? format : 'interactive';
  const needle = String(q || '').trim().toLowerCase();
  let items = await cat.catalogList(supa, userId, { source, category, format: fmt });
  if (needle) items = items.filter((i) => (i.title || '').toLowerCase().includes(needle));
  return res.status(200).json({ items: items.slice(0, 200) });
}

// ─── Creare temă ─────────────────────────────────────────────────────────────
async function create(req, res, supa) {
  const { userId, profile } = await requireTeacher(req, supa);
  const {
    groupId = null, category = null, format = 'interactive',
    pickMode = 'auto', sources = ['site'], poolSize = 10,
    items = [], title = null, premiumFree = false, dueAt = null,
  } = req.body || {};

  const fmt = FORMATS.includes(format) ? format : 'interactive';
  const srcs = (Array.isArray(sources) ? sources : [sources]).filter((s) => SOURCES.includes(s));
  if (!srcs.length) return res.status(400).json({ error: 'Alege cel puțin o sursă a testelor.' });

  // grupa trebuie să fie a profesorului
  let groupName = null;
  if (groupId) {
    const { data: g } = await supa.from('mentor_groups').select('id, name, teacher_id').eq('id', groupId).maybeSingle();
    if (!g || (g.teacher_id !== userId && !profile.is_admin)) return res.status(403).json({ error: 'Grupa nu îți aparține.' });
    groupName = g.name;
  }

  // „teste premium trimise gratuit" — DOAR admin
  const freePremium = !!premiumFree && !!profile.is_admin;

  // Bazinul de teste
  let pool = [];
  if (pickMode === 'manual' && Array.isArray(items) && items.length) {
    pool = await cat.resolveChosen(supa, userId, items, fmt, MAX_POOL);
  } else {
    pool = await autoPool(supa, userId, { srcs, category, fmt, limit: Math.min(Math.max(parseInt(poolSize, 10) || 10, 1), MAX_POOL) });
  }
  if (!pool.length) {
    return res.status(400).json({ error: 'Nu am găsit teste pentru criteriile alese. Schimbă categoria, formatul sau sursa testelor.' });
  }
  pool = pool.slice(0, MAX_POOL);

  const t = String(title || '').trim().slice(0, 120)
    || `Temă${groupName ? ` · ${groupName}` : ''}${category ? ` · ${category}` : ''}`;

  const teacherName = await displayName(supa, userId);
  const { data: row, error } = await supa.from('group_assignments').insert({
    created_by: userId,
    creator_name: teacherName,
    group_id: groupId || null, group_name: groupName,
    title: t, category: category || null, format: fmt,
    pick_mode: pickMode === 'manual' ? 'manual' : 'auto',
    sources: srcs, pool_size: pool.length, premium_free: freePremium,
    due_at: dueAt || null,
  }).select('id').single();
  if (error) return res.status(500).json({ error: error.message });

  const { error: iErr } = await supa.from('group_assignment_items').insert(
    pool.map((p, i) => ({
      assignment_id: row.id, source: p.source, ref_id: p.refId, kind: p.kind,
      title: p.title, category: p.category, is_free: p.isFree !== false, position: i,
    }))
  );
  if (iErr) {
    await supa.from('group_assignments').delete().eq('id', row.id);
    return res.status(500).json({ error: iErr.message });
  }

  // notificare pentru elevii grupei (linkul e același pentru toți)
  try {
    const studentIds = await studentsOf(supa, userId, groupId);
    for (const sid of studentIds) {
      await ai.createNotification(supa, {
        recipientId: sid, type: 'assignment',
        title: `Ai un test nou de la profesorul ${teacherName}`.trim(),
        body: t,
        data: { url: `/tema-grupa?id=${row.id}`, groupAssignmentId: row.id },
        dedupeKey: `gassign:${row.id}:${sid}`, dedupeDays: 30,
      });
    }
  } catch (e) { console.warn('group-assignment notify:', e.message); }

  return res.status(200).json({ id: row.id, url: `/tema-grupa?id=${row.id}`, title: t, poolSize: pool.length });
}

// Alegerea automată a bazinului din categoria/sursele cerute.
async function autoPool(supa, userId, { srcs, category, fmt, limit }) {
  const buckets = [];
  for (const s of srcs) {
    buckets.push(await cat.catalogList(supa, userId, { source: s, category, format: fmt }));
  }
  // amestecăm sursele „în evantai", ca bazinul să nu vină doar dintr-una
  const out = [];
  let i = 0;
  while (out.length < limit && buckets.some((b) => b.length > i)) {
    for (const b of buckets) {
      if (b[i]) out.push(b[i]);
      if (out.length >= limit) break;
    }
    i += 1;
  }
  return out;
}

// ─── Testele mele pe grupă ───────────────────────────────────────────────────
async function mine(req, res, supa) {
  const { userId } = await requireTeacher(req, supa);
  const { data: rows } = await supa.from('group_assignments')
    .select('id, title, group_id, group_name, category, format, pick_mode, pool_size, premium_free, created_at')
    .eq('created_by', userId).order('created_at', { ascending: false }).limit(30);
  const list = rows || [];
  if (!list.length) return res.status(200).json({ assignments: [] });

  const ids = list.map((a) => a.id);
  const { data: picks } = await supa.from('group_assignment_picks')
    .select('assignment_id, item_id, student_id, score, max_score, completed_at').in('assignment_id', ids);

  // Testele DIN SITE (interactive și PDF corectate de Prof. Virtual) își scriu
  // scorul în `progress`, nu în repartizare — le luăm de acolo, ca numărul de
  // „rezolvate" să fie corect și pentru temele în format PDF.
  const { data: its } = await supa.from('group_assignment_items')
    .select('id, source, ref_id').in('assignment_id', ids);
  const itemById = {};
  (its || []).forEach((i) => { itemById[i.id] = i; });
  const siteRefs = [...new Set((its || []).filter((i) => i.source === 'site').map((i) => i.ref_id))];
  const studentIds = [...new Set((picks || []).map((p) => p.student_id))];
  const progMap = {};
  if (siteRefs.length && studentIds.length) {
    const { data: prog } = await supa.from('progress')
      .select('user_id, content_id, score, max_score, completed_at')
      .in('content_id', siteRefs).in('user_id', studentIds);
    (prog || []).forEach((p) => { progMap[`${p.user_id}:${p.content_id}`] = p; });
  }

  const agg = {};
  (picks || []).forEach((p) => {
    const a = (agg[p.assignment_id] || (agg[p.assignment_id] = { opened: 0, done: 0, sum: 0, n: 0 }));
    a.opened += 1;
    const it = itemById[p.item_id];
    const pr = it && it.source === 'site' ? progMap[`${p.student_id}:${it.ref_id}`] : null;
    const sc = p.score != null ? p.score : (pr ? pr.score : null);
    const mx = p.max_score != null ? p.max_score : (pr ? pr.max_score : null);
    const done = !!(p.completed_at || pr?.completed_at);
    if (done && mx) { a.done += 1; a.sum += (sc / mx) * 100; a.n += 1; }
  });
  return res.status(200).json({
    assignments: list.map((a) => ({
      ...a, url: `/tema-grupa?id=${a.id}`,
      opened: agg[a.id]?.opened || 0, solved: agg[a.id]?.done || 0,
      avgPercent: agg[a.id]?.n ? Math.round(agg[a.id].sum / agg[a.id].n) : null,
    })),
  });
}

// ─── Raport: cine ce test a primit și ce scor a luat ─────────────────────────
async function report(req, res, supa) {
  const { userId, profile } = await requireTeacher(req, supa);
  const { id } = req.body || {};
  if (!id) return res.status(400).json({ error: 'id obligatoriu' });
  const { data: a } = await supa.from('group_assignments').select('*').eq('id', id).maybeSingle();
  if (!a) return res.status(404).json({ error: 'Testul nu există.' });
  if (a.created_by !== userId && !profile.is_admin) return res.status(403).json({ error: 'Nu e testul tău.' });

  const { data: items } = await supa.from('group_assignment_items')
    .select('id, source, ref_id, kind, title, category, is_free, position')
    .eq('assignment_id', id).order('position', { ascending: true });
  const itemById = {};
  (items || []).forEach((i) => { itemById[i.id] = i; });

  const { data: picks } = await supa.from('group_assignment_picks')
    .select('id, item_id, student_id, score, max_score, attempts, assigned_at, opened_at, completed_at')
    .eq('assignment_id', id);

  const studentIds = await studentsOf(supa, a.created_by, a.group_id);
  const allIds = [...new Set([...studentIds, ...(picks || []).map((p) => p.student_id)])];
  const names = {};
  if (allIds.length) {
    const { data: profs } = await supa.from('profiles').select('id, full_name, email').in('id', allIds);
    (profs || []).forEach((p) => { names[p.id] = p.full_name || p.email || 'Elev'; });
  }

  // scoruri din `progress` pentru testele din site (interactiv + PDF corectat de AI)
  const siteRefs = (picks || []).map((p) => itemById[p.item_id]).filter((i) => i && i.source === 'site').map((i) => i.ref_id);
  const progMap = {};
  if (siteRefs.length && allIds.length) {
    const { data: prog } = await supa.from('progress')
      .select('user_id, content_id, score, max_score, attempts, completed_at')
      .in('content_id', [...new Set(siteRefs)]).in('user_id', allIds);
    (prog || []).forEach((p) => { progMap[`${p.user_id}:${p.content_id}`] = p; });
  }

  const byStudent = {};
  (picks || []).forEach((p) => {
    const it = itemById[p.item_id] || {};
    const pr = it.source === 'site' ? progMap[`${p.student_id}:${it.ref_id}`] : null;
    const sc = p.score != null ? p.score : (pr ? pr.score : null);
    const mx = p.max_score != null ? p.max_score : (pr ? pr.max_score : null);
    byStudent[p.student_id] = {
      studentId: p.student_id, name: names[p.student_id] || 'Elev',
      test: it.title || '(test șters)', source: it.source, kind: it.kind,
      assignedAt: p.assigned_at, openedAt: p.opened_at,
      completedAt: p.completed_at || pr?.completed_at || null,
      attempts: Math.max(p.attempts || 0, pr?.attempts || 0),
      score: sc, maxScore: mx,
      percent: sc != null && mx ? Math.round((sc / mx) * 100) : null,
    };
  });

  const rows = studentIds.map((sid) => byStudent[sid] || {
    studentId: sid, name: names[sid] || 'Elev', test: null, score: null, maxScore: null, percent: null,
  });
  // elevi care au deschis linkul fără să fie (încă) în grupă
  Object.values(byStudent).forEach((r) => { if (!studentIds.includes(r.studentId)) rows.push({ ...r, outsideGroup: true }); });

  return res.status(200).json({
    assignment: { ...a, url: `/tema-grupa?id=${a.id}` },
    items: items || [],
    rows,
  });
}

// ─── Denumirea linkului (se poate schimba oricând, linkul rămâne valabil) ────
async function rename(req, res, supa) {
  const { userId, profile } = await requireTeacher(req, supa);
  const { id, title } = req.body || {};
  const t = String(title || '').trim().slice(0, 120);
  if (!id || !t) return res.status(400).json({ error: 'id și title obligatorii' });
  const { data: a } = await supa.from('group_assignments').select('created_by').eq('id', id).maybeSingle();
  if (!a) return res.status(404).json({ error: 'Testul nu există.' });
  if (a.created_by !== userId && !profile.is_admin) return res.status(403).json({ error: 'Nu e testul tău.' });
  const patch = { title: t };
  const { error } = await supa.from('group_assignments').update({ ...patch, renamed_at: new Date().toISOString() }).eq('id', id);
  if (error) {
    // instalări fără coloana `renamed_at` (supabase/teme_elevi.sql nerulat încă)
    const { error: e2 } = await supa.from('group_assignments').update(patch).eq('id', id);
    if (e2) return res.status(500).json({ error: e2.message });
  }
  return res.status(200).json({ ok: true, title: t });
}

// ─── Clasament DOAR cu testele pe grupă primite ──────────────────────────────
// Diferă de clasamentul general din „Grupe / Rezultate elevi", care numără tot
// ce a rezolvat elevul pe platformă. Aici intră exclusiv testele repartizate
// prin linkurile de „Test pe grupă" ale acestui profesor.
async function leaderboard(req, res, supa) {
  const { userId } = await requireTeacher(req, supa);
  const { groupId = null } = req.body || {};

  let q = supa.from('group_assignments')
    .select('id, group_id, group_name, title').eq('created_by', userId);
  if (groupId) q = q.eq('group_id', groupId);
  const { data: assigns } = await q;
  const list = assigns || [];
  if (!list.length) return res.status(200).json({ rows: [], tests: 0 });

  const ids = list.map((a) => a.id);
  const { data: picks } = await supa.from('group_assignment_picks')
    .select('assignment_id, item_id, student_id, score, max_score, completed_at').in('assignment_id', ids);
  const { data: its } = await supa.from('group_assignment_items')
    .select('id, source, ref_id, title').in('assignment_id', ids);
  const itemById = {};
  (its || []).forEach((i) => { itemById[i.id] = i; });

  const studentIds = [...new Set((picks || []).map((p) => p.student_id))];
  const siteRefs = [...new Set((its || []).filter((i) => i.source === 'site').map((i) => i.ref_id))];
  const progMap = {};
  if (siteRefs.length && studentIds.length) {
    const { data: prog } = await supa.from('progress')
      .select('user_id, content_id, score, max_score, completed_at')
      .in('content_id', siteRefs).in('user_id', studentIds);
    (prog || []).forEach((p) => { progMap[`${p.user_id}:${p.content_id}`] = p; });
  }

  const names = {};
  if (studentIds.length) {
    const { data: profs } = await supa.from('profiles').select('id, full_name, email').in('id', studentIds);
    (profs || []).forEach((p) => { names[p.id] = p.full_name || p.email || 'Elev'; });
  }

  const agg = {};
  (picks || []).forEach((p) => {
    const a = (agg[p.student_id] || (agg[p.student_id] = { received: 0, solved: 0, sum: 0, n: 0 }));
    a.received += 1;
    const it = itemById[p.item_id];
    const pr = it && it.source === 'site' ? progMap[`${p.student_id}:${it.ref_id}`] : null;
    const sc = p.score != null ? p.score : (pr ? pr.score : null);
    const mx = p.max_score != null ? p.max_score : (pr ? pr.max_score : null);
    if ((p.completed_at || pr?.completed_at)) {
      a.solved += 1;
      if (sc != null && mx) { a.sum += (sc / mx) * 100; a.n += 1; }
    }
  });

  const rows = Object.entries(agg).map(([sid, a]) => ({
    studentId: sid, name: names[sid] || 'Elev',
    received: a.received, solved: a.solved,
    avg: a.n ? Math.round(a.sum / a.n) : null,
  })).sort((x, y) => (y.avg ?? -1) - (x.avg ?? -1) || y.solved - x.solved || x.name.localeCompare(y.name, 'ro'));

  return res.status(200).json({ rows, tests: list.length });
}

// ─── Ștergere ────────────────────────────────────────────────────────────────
async function remove(req, res, supa) {
  const { userId, profile } = await requireTeacher(req, supa);
  const { id } = req.body || {};
  if (!id) return res.status(400).json({ error: 'id obligatoriu' });
  const { data: a } = await supa.from('group_assignments').select('created_by').eq('id', id).maybeSingle();
  if (!a) return res.status(404).json({ error: 'Testul nu există.' });
  if (a.created_by !== userId && !profile.is_admin) return res.status(403).json({ error: 'Nu poți șterge testul altcuiva.' });
  await supa.from('group_assignments').delete().eq('id', id); // itemii și repartizările cad în cascadă
  return res.status(200).json({ ok: true });
}

// ─── Elevul deschide linkul: repartizarea testului ───────────────────────────
async function openForStudent(req, res, supa) {
  const userId = await ai.authUser(req, supa);
  const { id } = req.body || {};
  if (!id) return res.status(400).json({ error: 'id obligatoriu' });
  const profile = await ai.requireUser(supa, userId);

  const { data: a } = await supa.from('group_assignments').select('*').eq('id', id).maybeSingle();
  if (!a) return res.status(404).json({ error: 'Testul nu a fost găsit (poate a fost șters).' });

  const { data: items } = await supa.from('group_assignment_items')
    .select('id, source, ref_id, kind, title, category, is_free, position')
    .eq('assignment_id', id).order('position', { ascending: true });
  if (!items || !items.length) return res.status(404).json({ error: 'Testul pe grupă nu conține niciun test în bazin.' });

  const base = {
    assignmentId: a.id, title: a.title, teacher: a.creator_name, group: a.group_name,
    format: a.format, dueAt: a.due_at, poolSize: items.length,
  };

  // Profesorul-creator (sau adminul) își vede propriul link ca PREVIZUALIZARE,
  // fără să consume o repartizare din grupă.
  if (a.created_by === userId) {
    const target = await resolveTarget(supa, items[0], { userId, profile, premiumFree: a.premium_free });
    return res.status(200).json({ ...base, preview: true, pickId: null, item: publicItem(items[0]), target });
  }

  // Accesul: doar elevii grupei alese (adminul poate testa oricând).
  if (!profile.is_admin) {
    const ok = await isInGroup(supa, a, userId);
    if (!ok) {
      return res.status(403).json({
        error: a.group_name
          ? `Acest test e trimis grupei „${a.group_name}". Cere-i profesorului să te adauge în grupă.`
          : 'Acest test e pentru elevii asociați profesorului care a trimis-o.',
        code: 'NOT_IN_GROUP',
      });
    }
  }

  // repartizare existentă → aceeași, mereu
  let { data: pick } = await supa.from('group_assignment_picks')
    .select('id, item_id, score, max_score, attempts, completed_at')
    .eq('assignment_id', id).eq('student_id', userId).maybeSingle();

  if (!pick) {
    const chosen = await chooseItem(supa, a, items, { userId, profile });
    const ins = await supa.from('group_assignment_picks').insert({
      assignment_id: id, item_id: chosen.id, student_id: userId, opened_at: new Date().toISOString(),
    }).select('id, item_id, score, max_score, attempts, completed_at').single();
    if (ins.error) {
      // două deschideri simultane → luăm rândul deja scris
      const { data: again } = await supa.from('group_assignment_picks')
        .select('id, item_id, score, max_score, attempts, completed_at')
        .eq('assignment_id', id).eq('student_id', userId).maybeSingle();
      if (!again) return res.status(500).json({ error: ins.error.message });
      pick = again;
    } else {
      pick = ins.data;
      await supa.from('group_test_history').insert({
        teacher_id: a.created_by, group_id: a.group_id, student_id: userId,
        source: chosen.source, ref_id: chosen.ref_id,
      }).then(() => {}, () => {});
    }
  } else if (!pick.opened_at) {
    await supa.from('group_assignment_picks').update({ opened_at: new Date().toISOString() }).eq('id', pick.id);
  }

  const item = items.find((i) => i.id === pick.item_id) || items[0];
  const target = await resolveTarget(supa, item, { userId, profile, premiumFree: a.premium_free });
  return res.status(200).json({
    ...base, pickId: pick.id, item: publicItem(item), target,
    result: pick.completed_at ? { score: pick.score, maxScore: pick.max_score, attempts: pick.attempts } : null,
  });
}

// Elevul e în grupa temei? (asociere mentor_students + grupă)
async function isInGroup(supa, a, studentId) {
  const { data: link } = await supa.from('mentor_students')
    .select('group_id').eq('mentor_id', a.created_by).eq('student_id', studentId).maybeSingle();
  if (link) {
    if (!a.group_id) return true;                 // temă pentru toți elevii
    return link.group_id === a.group_id;
  }
  if (a.group_id) return false;
  const { data: p } = await supa.from('profiles').select('teacher_id').eq('id', studentId).maybeSingle();
  return p?.teacher_id === a.created_by;          // asociere veche
}

// ─── Alegerea testului: diferit de colegi ȘI diferit de data trecută ─────────
async function chooseItem(supa, a, items, { userId, profile }) {
  // 1) ce a primit acest elev înainte, de la același profesor, în aceeași grupă
  let hq = supa.from('group_test_history').select('source, ref_id, assigned_at')
    .eq('teacher_id', a.created_by).eq('student_id', userId)
    .order('assigned_at', { ascending: false }).limit(300);
  hq = a.group_id ? hq.eq('group_id', a.group_id) : hq.is('group_id', null);
  const { data: hist } = await hq;
  const seenAt = new Map();   // cheie → cel mai recent moment în care l-a primit
  (hist || []).forEach((h) => {
    const k = keyOf(h.source, h.ref_id);
    if (!seenAt.has(k)) seenAt.set(k, new Date(h.assigned_at || 0).getTime());
  });

  // 2) ce au primit colegii în ACEASTĂ temă (ca elevii să nu aibă același test)
  const { data: taken } = await supa.from('group_assignment_picks')
    .select('item_id').eq('assignment_id', a.id);
  const used = {};
  (taken || []).forEach((t) => { used[t.item_id] = (used[t.item_id] || 0) + 1; });

  // 3) testele premium pe care elevul NU le poate deschide (dacă profesorul nu
  //    e admin cu „premium gratis") se lasă la urmă
  const canPremium = a.premium_free || profile.subscription_status === 'active' || profile.is_admin;

  const scored = items.map((it, idx) => {
    const k = keyOf(it.source, it.ref_id);
    return {
      it,
      blocked: (!it.is_free && !canPremium) ? 1 : 0,
      seen: seenAt.has(k) ? 1 : 0,
      seenAt: seenAt.get(k) || 0,
      used: used[it.id] || 0,
      // dispersie stabilă per elev: același elev nu primește mereu primul test
      jitter: hashInt(`${userId}:${it.id}`) % 1000,
      idx,
    };
  });

  scored.sort((x, y) =>
    x.blocked - y.blocked           // întâi ce poate deschide
    || x.seen - y.seen              // apoi ce n-a mai primit (până la epuizare)
    || x.used - y.used              // apoi ce n-au primit colegii
    || x.seenAt - y.seenAt          // la reluare: cel primit cel mai demult
    || x.jitter - y.jitter
    || x.idx - y.idx
  );
  return scored[0].it;
}

function hashInt(s) {
  let h = 0;
  for (let i = 0; i < s.length; i++) { h = ((h << 5) - h + s.charCodeAt(i)) | 0; }
  return Math.abs(h);
}

// ─── Reîncărcarea unui viewer (F5): testul repartizat, după pickId ───────────
async function pickOne(req, res, supa) {
  const userId = await ai.authUser(req, supa);
  const { pickId } = req.body || {};
  if (!pickId) return res.status(400).json({ error: 'pickId obligatoriu' });
  const profile = await ai.requireUser(supa, userId);
  const { data: p } = await supa.from('group_assignment_picks')
    .select('id, assignment_id, item_id, student_id').eq('id', pickId).maybeSingle();
  if (!p) return res.status(404).json({ error: 'Repartizarea nu există.' });
  if (p.student_id !== userId) return res.status(403).json({ error: 'Nu e testul tău.' });
  const { data: a } = await supa.from('group_assignments').select('*').eq('id', p.assignment_id).maybeSingle();
  const { data: item } = await supa.from('group_assignment_items').select('*').eq('id', p.item_id).maybeSingle();
  if (!a || !item) return res.status(404).json({ error: 'Testul nu mai există.' });
  const target = await resolveTarget(supa, item, { userId, profile, premiumFree: a.premium_free });
  return res.status(200).json({
    assignmentId: a.id, title: a.title, teacher: a.creator_name,
    pickId: p.id, item: publicItem(item), target,
  });
}

// ─── Testul a început / s-a terminat → mesageria se oprește / repornește ─────
// „În timpul unui test pe grupă, toate mesageriile sunt oprite automat."
// Elevul apasă „▶ Începe testul" → `active_until` = acum + 3 ore. Se șterge
// când trimite rezultatul (`score`) sau când apasă „Am terminat testul";
// oricum expiră singură, ca un test abandonat să nu blocheze mesageria.
const TEST_WINDOW_MS = 3 * 3600 * 1000;

async function testMode(req, res, supa, start) {
  const userId = await ai.authUser(req, supa);
  const { pickId } = req.body || {};
  if (!pickId) return res.status(400).json({ error: 'pickId obligatoriu' });
  const { data: p } = await supa.from('group_assignment_picks')
    .select('id, student_id').eq('id', pickId).maybeSingle();
  if (!p) return res.status(404).json({ error: 'Repartizarea nu există.' });
  if (p.student_id !== userId) return res.status(403).json({ error: 'Nu e testul tău.' });

  const active_until = start ? new Date(Date.now() + TEST_WINDOW_MS).toISOString() : null;
  const { error } = await supa.from('group_assignment_picks').update({ active_until }).eq('id', p.id);
  if (error) {
    // fără coloana `active_until` (supabase/mesagerie.sql nerulat) mergem mai
    // departe: testul funcționează, doar blocarea mesageriei nu se aplică
    console.warn('group-assignment testMode:', error.message);
    return res.status(200).json({ ok: true, testMode: false, note: 'Rulează supabase/mesagerie.sql pentru oprirea mesageriei în timpul testelor.' });
  }
  return res.status(200).json({ ok: true, testMode: !!start });
}

// ─── Rezultatul elevului ─────────────────────────────────────────────────────
async function score(req, res, supa) {
  const userId = await ai.authUser(req, supa);
  const { pickId, score: sc, maxScore: mx } = req.body || {};
  if (!pickId) return res.status(400).json({ error: 'pickId obligatoriu' });
  const s = Math.max(0, parseInt(sc, 10) || 0);
  const m = Math.max(1, parseInt(mx, 10) || 100);
  const { data: p } = await supa.from('group_assignment_picks')
    .select('id, assignment_id, student_id, score, attempts').eq('id', pickId).maybeSingle();
  if (!p) return res.status(404).json({ error: 'Repartizarea nu există.' });
  if (p.student_id !== userId) return res.status(403).json({ error: 'Nu e testul tău.' });

  const patch = {
    score: Math.max(p.score || 0, s), max_score: m,
    attempts: (p.attempts || 0) + 1, completed_at: new Date().toISOString(),
  };
  // testul s-a încheiat → mesageria elevului se deblochează
  let { error } = await supa.from('group_assignment_picks').update({ ...patch, active_until: null }).eq('id', p.id);
  if (error) {
    // instalări fără coloana `active_until` (supabase/mesagerie.sql nerulat încă)
    ({ error } = await supa.from('group_assignment_picks').update(patch).eq('id', p.id));
  }
  if (error) return res.status(500).json({ error: error.message });

  // anunță profesorul
  try {
    const { data: a } = await supa.from('group_assignments').select('created_by, title').eq('id', p.assignment_id).maybeSingle();
    const { data: me } = await supa.from('profiles').select('full_name, email').eq('id', userId).maybeSingle();
    if (a) {
      await ai.createNotification(supa, {
        recipientId: a.created_by, type: 'assignment_done',
        title: `${me?.full_name || me?.email || 'Un elev'} a rezolvat testul „${a.title}"`,
        body: `Scor: ${s}/${m}.`,
        data: { url: '/profil', groupAssignmentId: p.assignment_id, studentId: userId },
        dedupeKey: `gassign_done:${p.id}`, dedupeDays: 1,
      });
    }
  } catch { /* notificarea nu blochează salvarea */ }

  return res.status(200).json({ ok: true, score: Math.max(p.score || 0, s), maxScore: m });
}
