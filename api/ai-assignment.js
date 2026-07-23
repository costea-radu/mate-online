// =====================================================================
// api/ai-assignment.js — teme profesor → elev
// POST { userId, action, ... }
//   action='create'  (profesor/abonat):
//       interactiv: { kind:'interactive', html, title, category?, topic? }
//       antrenament:{ kind:'practice', token, title }   (token de la ai-practice generate)
//     → { id, url }
//   action='get'     (elev logat): { id } → exercițiul de rezolvat (fără răspuns)
//   action='submit'  (elev logat): { id, answer?, work?, score?, maxScore? } → rezultat
//   action='results' (profesor): → { assignments:[{...aggregat}] }
//   action='mine'    (profesor): temele mele (listă scurtă)
// =====================================================================
const ai = require('./_lib/ai');

module.exports = async function handler(req, res) {
  ai.applyCors(res);
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method Not Allowed' });

  const supa = ai.admin();
  try {
    const { action } = req.body || {};
    if (action === 'create') return await create(req, res, supa);
    if (action === 'get') return await getOne(req, res, supa);
    if (action === 'submit') return await submit(req, res, supa);
    if (action === 'results') return await results(req, res, supa);
    if (action === 'mine') return await mine(req, res, supa);
    if (action === 'delete') return await remove(req, res, supa);
    if (action === 'send') return await sendToStudent(req, res, supa);
    if (action === 'students') return await students(req, res, supa);
    return res.status(400).json({ error: 'action invalid' });
  } catch (err) {
    console.error('ai-assignment error:', err);
    return res.status(err.status || 500).json({ error: err.message || 'Eroare server', code: err.code || null });
  }
};

// ─── Creare temă (profesor, PĂRINTE sau abonat) ──────────────────────────────
async function create(req, res, supa) {
  const userId = await ai.authUser(req, supa);
  const { kind, title = null, category = null, topic = null, fromPublicId = null } = req.body || {};
  const profile = await ai.requireUser(supa, userId);
  const creatorName = profile.full_name || profile.email || (profile.role === 'parinte' ? 'Părinte' : 'Profesor');
  const creatorRole = profile.role === 'parinte' ? 'parinte' : 'profesor';

  // Trimitere dintr-un exercițiu public (Biblioteca utilizatorilor) — orice utilizator autentificat.
  if (fromPublicId) {
    const { data: pub } = await supa.from('ai_public_library').select('*').eq('id', fromPublicId).single();
    if (!pub) return res.status(404).json({ error: 'Exercițiul public nu există.' });
    if (!['interactive', 'practice'].includes(pub.kind)) {
      return res.status(400).json({ error: 'Doar exercițiile interactive sau de antrenament pot fi trimise ca temă.' });
    }
    // Barieră: neabonații pot trimite doar exercițiile gratuite din bibliotecă.
    const premium = profile.subscription_status === 'active' || profile.is_admin;
    if (!(pub.is_free || premium || pub.created_by === userId)) {
      return res.status(402).json({ error: 'Acest exercițiu necesită abonament. Fără abonament poți trimite doar exercițiile gratuite.', code: 'PREMIUM_REQUIRED' });
    }
    const { data: row, error } = await supa.from('ai_assignments').insert({
      created_by: userId, creator_name: creatorName, creator_role: creatorRole, kind: pub.kind,
      title: pub.title, category: pub.category, topic: pub.topic, payload: pub.payload,
    }).select('id').single();
    if (error) return res.status(500).json({ error: error.message });
    return res.status(200).json({ id: row.id, url: `/tema?id=${row.id}`, title: pub.title });
  }

  const isMentor = profile.role === 'profesor' || profile.role === 'parinte' || profile.is_admin;
  if (!isMentor) ai.requirePremium(profile); // abonat obișnuit: ok; altfel blocat

  let payload = {};
  let t = title;

  if (kind === 'interactive') {
    const { html, questions } = req.body || {};
    if (Array.isArray(questions) && questions.length) {
      payload = { questions };
    } else if (html && /<html|<!doctype/i.test(html)) {
      payload = { html };
    } else {
      return res.status(400).json({ error: 'Exercițiul interactiv e gol (fără întrebări sau HTML).' });
    }
    t = t || `Exercițiu interactiv · ${topic || category || 'matematică'}`;
  } else if (kind === 'practice') {
    const { token, exercise } = req.body || {};
    // Prioritar: exercițiul editat de profesor (câmpuri explicite). Altfel: din token.
    if (exercise && exercise.statement) {
      payload = {
        statement: exercise.statement, options: exercise.options || [], answer: exercise.answer || '',
        answer_type: exercise.answer_type || 'text', solution: exercise.solution || '',
        topic: exercise.topic || topic, category: exercise.category || category,
      };
      t = t || `Exercițiu de antrenament · ${payload.topic || 'matematică'}`;
    } else {
      const data = ai.verifyToken(token);
      if (!data) return res.status(400).json({ error: 'Token invalid sau expirat. Regenerează exercițiul.' });
      payload = {
        statement: data.statement, options: data.options || [], answer: data.answer || '',
        answer_type: data.answer_type || 'text', solution: data.solution || '', topic: data.topic, category: data.category,
      };
      t = t || `Exercițiu de antrenament · ${data.topic || 'matematică'}`;
    }
  } else {
    return res.status(400).json({ error: "kind trebuie 'interactive' sau 'practice'." });
  }

  const { data: row, error } = await supa.from('ai_assignments').insert({
    created_by: userId, creator_name: creatorName, creator_role: creatorRole, kind, title: t,
    category: category || payload.category || null, topic: topic || payload.topic || null, payload,
  }).select('id').single();
  if (error) return res.status(500).json({ error: error.message });

  return res.status(200).json({ id: row.id, url: `/tema?id=${row.id}`, title: t });
}

// ─── Ștergere temă (doar creatorul) ──────────────────────────────────────────
async function remove(req, res, supa) {
  const userId = await ai.authUser(req, supa);
  const { id } = req.body || {};
  const profile = await ai.requireUser(supa, userId);
  if (!id) return res.status(400).json({ error: 'id obligatoriu' });
  const { data: a } = await supa.from('ai_assignments').select('created_by').eq('id', id).single();
  if (!a) return res.status(404).json({ error: 'Tema nu există.' });
  if (a.created_by !== userId && !profile.is_admin) return res.status(403).json({ error: 'Nu poți șterge tema altcuiva.' });
  await supa.from('ai_assignments').delete().eq('id', id); // rezultatele se șterg în cascadă
  return res.status(200).json({ ok: true });
}

// ─── Lista elevilor mentorului (pentru trimitere directă) ─────────────────────
async function students(req, res, supa) {
  const userId = await ai.authUser(req, supa);
  const profile = await ai.requireUser(supa, userId);
  const role = profile.role === 'parinte' ? 'parinte' : 'profesor';
  const { data: links } = await supa.from('mentor_students').select('student_id').eq('mentor_id', userId).eq('mentor_role', role);
  const ids = [...new Set((links || []).map((l) => l.student_id))];
  if (role === 'profesor') {
    const { data: legacy } = await supa.from('profiles').select('id').eq('teacher_id', userId);
    (legacy || []).forEach((p) => ids.push(p.id));
  }
  const uniq = [...new Set(ids)];
  if (!uniq.length) return res.status(200).json({ students: [] });
  const { data: profs } = await supa.from('profiles').select('id, full_name, email').in('id', uniq);
  return res.status(200).json({ students: (profs || []).map((p) => ({ id: p.id, name: p.full_name || p.email || 'Elev' })) });
}

// ─── Trimite tema direct unui elev (notificare cu link) ───────────────────────
async function sendToStudent(req, res, supa) {
  const userId = await ai.authUser(req, supa);
  const { assignmentId, studentId } = req.body || {};
  const profile = await ai.requireUser(supa, userId);
  if (!assignmentId || !studentId) return res.status(400).json({ error: 'assignmentId și studentId obligatorii' });
  const { data: a } = await supa.from('ai_assignments').select('created_by, title').eq('id', assignmentId).single();
  if (!a) return res.status(404).json({ error: 'Tema nu există.' });
  if (a.created_by !== userId && !profile.is_admin) return res.status(403).json({ error: 'Nu e tema ta.' });
  // verifică legătura mentor-elev
  const { data: link } = await supa.from('mentor_students').select('student_id').eq('mentor_id', userId).eq('student_id', studentId).limit(1);
  const linked = (link && link.length) || (await (async () => { const { data: p } = await supa.from('profiles').select('teacher_id').eq('id', studentId).single(); return p?.teacher_id === userId; })());
  if (!linked && !profile.is_admin) return res.status(403).json({ error: 'Elevul nu este asociat cu tine.' });

  const who = profile.role === 'parinte' ? `părintele ${profile.full_name || ''}`.trim() : `profesorul ${profile.full_name || ''}`.trim();
  await ai.createNotification(supa, {
    recipientId: studentId, type: 'assignment',
    title: `Ai o temă nouă de la ${who || 'profesor'}`,
    body: a.title,
    data: { url: `/tema?id=${assignmentId}`, assignmentId },
    dedupeKey: `assignment:${assignmentId}:${studentId}`, dedupeDays: 30,
  });
  return res.status(200).json({ ok: true });
}

// ─── Deschidere temă de către elev (fără a dezvălui răspunsul) ────────────────
async function getOne(req, res, supa) {
  const userId = await ai.authUser(req, supa);
  const { id } = req.body || {};
  await ai.requireUser(supa, userId);
  if (!id) return res.status(400).json({ error: 'id obligatoriu' });
  const { data: a } = await supa.from('ai_assignments').select('*').eq('id', id).single();
  if (!a) return res.status(404).json({ error: 'Tema nu a fost găsită.' });

  const base = { id: a.id, kind: a.kind, title: a.title, creator: a.creator_name, creatorRole: a.creator_role || 'profesor', topic: a.topic, category: a.category };
  if (a.kind === 'interactive') return res.status(200).json({ ...base, questions: a.payload?.questions || null, html: a.payload?.html || '' });
  // practice: fără answer/solution
  return res.status(200).json({
    ...base,
    statement: a.payload?.statement || '',
    options: a.payload?.options || [],
    answer_type: a.payload?.answer_type || 'text',
  });
}

// ─── Trimitere rezultat de către elev ────────────────────────────────────────
async function submit(req, res, supa) {
  const userId = await ai.authUser(req, supa);
  const { id, answer = '', work = '', score = null, maxScore = null } = req.body || {};
  const profile = await ai.requireUser(supa, userId);
  if (!id) return res.status(400).json({ error: 'id obligatoriu' });
  const { data: a } = await supa.from('ai_assignments').select('*').eq('id', id).single();
  if (!a) return res.status(404).json({ error: 'Tema nu a fost găsită.' });

  let outScore = 0, outMax = 100, correct = null, feedback = null, solution = null;

  if (a.kind === 'interactive') {
    outScore = Math.max(0, parseInt(score, 10) || 0);
    outMax = Math.max(1, parseInt(maxScore, 10) || 100);
    // Alimentează stăpânirea pe materie: interactiv rezolvat cu ≥60% = însușit.
    try {
      const ratio = outScore / outMax;
      await supa.rpc('bump_skill_mastery', {
        p_user: userId, p_category: a.category || 'general', p_topic: a.topic || 'general', p_correct: ratio >= 0.6,
      });
    } catch { /* ignoră */ }
  } else {
    // practice: corectare cu AI față de răspunsul stocat
    await ai.enforceRateLimit(supa, userId);
    const p = a.payload || {};
    const system = `${ai.PERSONA}

Ești profesor și corectezi răspunsul unui elev la un exercițiu.
ENUNȚ: ${p.statement}
RĂSPUNS CORECT (referință): ${p.answer}
REZOLVARE (referință): ${p.solution}
RĂSPUNSUL ELEVULUI: ${answer || '(fără răspuns)'}
LUCRAREA ELEVULUI: ${work || '(fără pași)'}
Evaluează matematic (echivalențe acceptate, ex: 1/2 = 0,5). Fii încurajator dar corect.
Răspunde STRICT cu JSON: {"correct":true/false,"score":0-100,"feedback":"...","solution":"rezolvarea corectă pe scurt"}`;
    const { text, usage } = await ai.chat({
      system, messages: [{ role: 'user', content: 'Corectează și răspunde JSON.' }],
      temperature: 0.2, maxTokens: 800, json: true, model: ai.GEN_MODEL,
    });
    await ai.logUsage(supa, userId, 'ai-assignment:check', usage);
    let parsed = {};
    try { parsed = JSON.parse(text); } catch { /* ignora */ }
    correct = !!parsed.correct;
    outScore = Math.max(0, Math.min(100, parseInt(parsed.score, 10) || 0));
    outMax = 100;
    feedback = parsed.feedback || null;
    solution = parsed.solution || p.solution || null;

    // actualizează și stăpânirea competenței elevului
    try { await supa.rpc('bump_skill_mastery', { p_user: userId, p_category: p.category || 'general', p_topic: p.topic || 'general', p_correct: correct }); } catch { /* ignora */ }
  }

  // upsert rezultat: păstrăm cel mai bun scor, incrementăm încercările
  const { data: existing } = await supa.from('ai_assignment_results')
    .select('id, attempts, score').eq('assignment_id', id).eq('student_id', userId).maybeSingle();
  // Eroarea de scriere NU se ignoră: altfel profesorul primește notificarea
  // „elevul a rezolvat tema" fără ca scorul să existe în baza de date.
  const wr = existing
    ? await supa.from('ai_assignment_results').update({
        score: Math.max(existing.score || 0, outScore), max_score: outMax,
        attempts: (existing.attempts || 1) + 1, completed_at: new Date().toISOString(),
      }).eq('id', existing.id)
    : await supa.from('ai_assignment_results').insert({
        assignment_id: id, student_id: userId, score: outScore, max_score: outMax, attempts: 1,
      });
  if (wr.error) {
    console.error('ai-assignment: salvare rezultat eșuată:', wr.error);
    const e = new Error('Rezultatul nu a putut fi salvat.');
    e.status = 500; throw e;
  }

  // notifică profesorul-creator că elevul a rezolvat tema
  try {
    const who = profile.full_name || profile.email || 'Un elev';
    await ai.createNotification(supa, {
      recipientId: a.created_by, type: 'assignment_done',
      title: `${who} a rezolvat tema „${a.title}"`,
      body: `Scor: ${outScore}/${outMax}.`,
      data: { url: '/profil', assignmentId: id, studentId: userId },
      dedupeKey: `assignment_done:${id}:${userId}`, dedupeDays: 1,
    });
  } catch { /* ignora */ }

  return res.status(200).json({ ok: true, score: outScore, maxScore: outMax, correct, feedback, solution });
}

// ─── Rezultate agregate pentru profesor (pentru raport) ──────────────────────
async function results(req, res, supa) {
  const userId = await ai.authUser(req, supa);
  const profile = await ai.requireUser(supa, userId);
  if (!(profile.role === 'profesor' || profile.is_admin)) return res.status(403).json({ error: 'Doar profesorii.' });

  const { data: assigns } = await supa.from('ai_assignments')
    .select('id, kind, title, topic, category, created_at').eq('created_by', userId).order('created_at', { ascending: false }).limit(50);
  if (!assigns || !assigns.length) return res.status(200).json({ assignments: [] });

  const ids = assigns.map((a) => a.id);
  const { data: resu } = await supa.from('ai_assignment_results')
    .select('assignment_id, student_id, score, max_score, attempts, completed_at').in('assignment_id', ids);

  // nume elevi
  const studentIds = [...new Set((resu || []).map((r) => r.student_id))];
  const names = {};
  if (studentIds.length) {
    const { data: profs } = await supa.from('profiles').select('id, full_name, email').in('id', studentIds);
    (profs || []).forEach((p) => { names[p.id] = p.full_name || p.email || 'Elev'; });
  }

  const byAssign = {};
  (resu || []).forEach((r) => {
    (byAssign[r.assignment_id] || (byAssign[r.assignment_id] = [])).push({
      studentId: r.student_id, name: names[r.student_id] || 'Elev',
      score: r.score, maxScore: r.max_score, attempts: r.attempts, completedAt: r.completed_at,
    });
  });

  const assignments = assigns.map((a) => {
    const rs = byAssign[a.id] || [];
    const avg = rs.length ? Math.round(rs.reduce((s, x) => s + (x.maxScore ? (x.score / x.maxScore) * 100 : 0), 0) / rs.length) : null;
    return { id: a.id, kind: a.kind, title: a.title, topic: a.topic, createdAt: a.created_at, solvedCount: rs.length, avgPercent: avg, results: rs };
  });
  return res.status(200).json({ assignments });
}

// ─── Temele mele (listă scurtă) ──────────────────────────────────────────────
async function mine(req, res, supa) {
  const userId = await ai.authUser(req, supa);
  const profile = await ai.requireUser(supa, userId);
  if (!(profile.role === 'profesor' || profile.is_admin)) return res.status(403).json({ error: 'Doar profesorii.' });
  const { data } = await supa.from('ai_assignments')
    .select('id, kind, title, created_at').eq('created_by', userId).order('created_at', { ascending: false }).limit(30);
  return res.status(200).json({ assignments: data || [] });
}
