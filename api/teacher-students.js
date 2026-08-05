const { createClient } = require('@supabase/supabase-js');
const { handledMethod, authUser, allRows, inBatches } = require('./_lib/http');

module.exports = async function handler(req, res) {
  if (handledMethod(req, res)) return;

  const supabase = createClient(
    process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY
  );

  let userId;
  try { userId = await authUser(req, supabase); }
  catch (e) { return res.status(e.status || 401).json({ error: e.message }); }

  // 1. Apelantul trebuie să fie profesor sau părinte
  const { data: caller, error: callerErr } = await supabase
    .from('profiles')
    .select('role')
    .eq('id', userId)
    .maybeSingle();

  if (callerErr) return res.status(500).json({ error: callerErr.message });
  if (!caller || (caller.role !== 'profesor' && caller.role !== 'parinte')) {
    return res.status(403).json({ error: 'Acces interzis' });
  }
  const role = caller.role;

  // 2. Grupele profesorului (părinții nu au grupe)
  let groups = [];
  if (role === 'profesor') {
    const { data: g, error: gErr } = await supabase
      .from('mentor_groups')
      .select('id, name, created_at')
      .eq('teacher_id', userId)
      .order('created_at', { ascending: true });
    if (gErr) return res.status(500).json({ error: gErr.message });
    groups = g || [];
  }

  // 3. Asocierile (elev + grupă) acestui mentor — PAGINAT (PostgREST
  //    întoarce max 1000 de rânduri per cerere; fără paginare, listele mari
  //    se trunchiază tăcut și elevi/rezultate „dispar" din dashboard).
  let links;
  try {
    links = await allRows((from, to) => supabase
      .from('mentor_students')
      .select('student_id, group_id')
      .eq('mentor_id', userId)
      .range(from, to));
  } catch (e) { return res.status(500).json({ error: e.message }); }

  // 3b. Elevii ȘTERȘI (conturi dezactivate/eliminate) — rezultatele lor rămân
  //     arhivate pentru acest mentor până când acesta le șterge definitiv.
  let archived = [];
  try {
    const { data: arch } = await supabase
      .from('archived_student_results')
      .select('id, student_id, student_name, student_email, student_role, reason, results, extras, deleted_at')
      .eq('mentor_id', userId)
      .order('deleted_at', { ascending: false });
    archived = arch || [];
  } catch { /* tabelul poate lipsi până se rulează supabase/inactive_accounts.sql */ }

  const linkList = links || [];
  if (linkList.length === 0) {
    return res.status(200).json({ role, students: [], results: [], groups, aiUsage: [], archived, meditatii: [] });
  }

  const studentIds = linkList.map((l) => l.student_id);
  const groupByStudent = {};
  linkList.forEach((l) => { groupByStudent[l.student_id] = l.group_id || null; });

  // 4. Profilurile elevilor (în loturi + paginat)
  let profiles;
  try {
    profiles = await inBatches(studentIds, (chunk, from, to) => supabase
      .from('profiles')
      .select('id, full_name, email')
      .in('id', chunk)
      .range(from, to));
  } catch (e) { return res.status(500).json({ error: e.message }); }

  const students = (profiles || [])
    .map((p) => ({
      id: p.id,
      full_name: p.full_name || 'Elev',
      email: p.email || '',
      group_id: groupByStudent[p.id] || null,
    }))
    .sort((a, b) => (a.full_name || '').localeCompare(b.full_name || '', 'ro'));

  // 5. Progresul elevilor (select * pentru a tolera coloane lipsă: attempts/time_spent).
  //    ATENȚIE — PAGINAT: ordonat descrescător după dată + limita implicită de
  //    1000 de rânduri însemna că REZULTATELE VECHI cădeau din listă imediat ce
  //    elevii activi (recent) umpleau primele 1000 — exact bug-ul „nu mai apar
  //    rezultatele de până acum ale grupei, apar doar elevii din ultima lună".
  let prog;
  try {
    prog = await inBatches(studentIds, (chunk, from, to) => supabase
      .from('progress')
      .select('*')
      .in('user_id', chunk)
      .order('completed_at', { ascending: false })
      .range(from, to));
  } catch (e) { return res.status(500).json({ error: e.message }); }

  // 6. Utilizarea Profesorului Virtual: câte întrebări a pus fiecare elev
  //    la fiecare material (conversațiile AI păstrează contentId în context).
  const aiQ = {}; // "userId|contentId" -> nr. întrebări
  try {
    const convs = await inBatches(studentIds, (chunk, from, to) => supabase
      .from('ai_conversations')
      .select('id, user_id, context')
      .in('user_id', chunk)
      .range(from, to));
    const convKey = {}; // conversationId -> "userId|contentId"
    convs.forEach((c) => {
      const cid = c.context && (c.context.contentId || c.context.content_id);
      if (cid) convKey[c.id] = `${c.user_id}|${cid}`;
    });
    const convIds = Object.keys(convKey);
    // loturi de 150 de conversații, fiecare citit PAGINAT (un lot poate avea
    // peste 1000 de mesaje — fără paginare numărătoarea ieșea trunchiată)
    const msgs = await inBatches(convIds, (chunk, from, to) => supabase
      .from('ai_messages')
      .select('conversation_id')
      .eq('role', 'user')
      .in('conversation_id', chunk)
      .range(from, to), { batchSize: 150 });
    msgs.forEach((m) => {
      const k = convKey[m.conversation_id];
      if (k) aiQ[k] = (aiQ[k] || 0) + 1;
    });
  } catch { /* raportul funcționează și fără datele AI */ }

  // 7. Titlurile testelor/exercițiilor (din progres + din conversațiile AI)
  const aiContentIds = Object.keys(aiQ).map((k) => k.split('|')[1]);
  const contentIds = [...new Set([...prog.map((p) => p.content_id), ...aiContentIds])].filter(Boolean);
  const contentMap = {};
  if (contentIds.length > 0) {
    try {
      const content = await inBatches(contentIds, (chunk, from, to) => supabase
        .from('content')
        .select('id, title, content_type, category')
        .in('id', chunk)
        .range(from, to));
      content.forEach((c) => { contentMap[c.id] = c; });
    } catch { /* titlurile lipsă cad pe „Test" */ }
  }

  const studentMap = {};
  students.forEach((s) => { studentMap[s.id] = s; });

  const results = prog.map((p) => {
    const c = contentMap[p.content_id] || {};
    const s = studentMap[p.user_id] || {};
    return {
      student_id: p.user_id,
      student_name: s.full_name || 'Elev',
      student_email: s.email || '',
      content_id: p.content_id,
      // materialul poate fi ȘTERS între timp — titlul rămâne din snapshotul
      // salvat în rezultat (supabase/pastreaza_rezultate.sql)
      test_title: c.title || p.test_title || 'Test (material șters)',
      content_type: c.content_type || p.content_type || 'interactive',
      category: c.category || p.category || '',
      score: p.score,
      max_score: p.max_score,
      attempts: p.attempts != null ? p.attempts : 1,
      time_spent: p.time_spent != null ? p.time_spent : 0,
      completed_at: p.completed_at,
      ai_questions: aiQ[`${p.user_id}|${p.content_id}`] || 0,
    };
  });

  // 7b. Temele de la „Meditații cu Profesorul Virtual" rezolvate de elevi
  //     (cele „din site" apar deja în progress; aici intră și cele GENERATE).
  let meditatii = [];
  try {
    const rows = await inBatches(studentIds, (chunk, from, to) => supabase
      .from('ai_meditatii_homework')
      .select('user_id, kind, title, chapter, topic, status, score, max_score, feedback, completed_at, assigned_at')
      .in('user_id', chunk)
      .order('assigned_at', { ascending: false })
      .range(from, to));
    meditatii = (rows || []).map((h) => ({
      student_id: h.user_id,
      title: h.title,
      topic: h.topic || h.chapter || '',
      kind: h.kind,
      status: h.status,
      score: h.score,
      max_score: h.max_score,
      grade: h.feedback?.grade ?? null,
      completed_at: h.completed_at,
      assigned_at: h.assigned_at,
    }));
  } catch { /* schema meditațiilor poate lipsi — raportul merge și fără */ }

  // 7c. Seturile LUCRATE cu profesorul (exerciții/recapitulări/simulări
  //     generate) — rezultatele lor apar și ele mentorilor (cerința 6,
  //     runda 5). Cele „din site" nu se dublează: sunt deja în rezultate.
  try {
    const rows = await inBatches(studentIds, (chunk, from, to) => supabase
      .from('ai_meditatii_sessions')
      .select('user_id, kind, chapter, topic, status, score, max_score, completed_at, created_at, cid:payload->>contentId')
      .in('user_id', chunk)
      .eq('status', 'finalizata')
      .order('created_at', { ascending: false })
      .range(from, to));
    const kindLabels = { exercitii: 'Exerciții', remediere: 'Remediere', recapitulare: 'Recapitulare', simulare: 'Simulare de examen', evaluare: 'Testul inițial' };
    (rows || []).forEach((s) => {
      if (!s.max_score || s.cid) return; // fără scor / test „din site" (deja în rezultate)
      meditatii.push({
        student_id: s.user_id,
        title: `${kindLabels[s.kind] || 'Set de lucru'}${s.topic ? ` · ${String(s.topic).replace(/_/g, ' ')}` : ''}`,
        topic: s.topic || s.chapter || '',
        kind: s.kind,
        status: 'rezolvata',
        score: s.score,
        max_score: s.max_score,
        grade: null,
        completed_at: s.completed_at,
        assigned_at: s.created_at,
      });
    });
    meditatii.sort((a, b) => new Date(b.completed_at || b.assigned_at || 0) - new Date(a.completed_at || a.assigned_at || 0));
  } catch { /* opțional */ }

  // 8. Materiale la care elevul a folosit Prof. Virtual dar nu are (încă) punctaj
  const covered = new Set(prog.map((p) => `${p.user_id}|${p.content_id}`));
  const aiUsage = Object.keys(aiQ)
    .filter((k) => !covered.has(k))
    .map((k) => {
      const [sid, cid] = k.split('|');
      const c = contentMap[cid] || {};
      return {
        student_id: sid,
        content_id: cid,
        test_title: c.title || 'Material',
        content_type: c.content_type || '',
        ai_questions: aiQ[k],
      };
    })
    // doar materiale reale din platformă (conversațiile fără material nu apar)
    .filter((r) => contentMap[r.content_id]);

  return res.status(200).json({ role, students, results, groups, aiUsage, archived, meditatii });
};
