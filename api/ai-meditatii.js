// =====================================================================
// api/ai-meditatii.js — „Meditații cu Profesorul Virtual"
// Un profesor virtual cu MEMORIE PEDAGOGICĂ: evaluare inițială → plan
// personalizat → teorie → exerciții → analiză greșeli → remediere („încă
// 10 de același fel") → teme → repetiție inteligentă (1 zi / 7 / 30) →
// simulări de examen → predicția notei → raport pentru mentori.
//
// MATERIALELE DIN SITE AU PRIORITATE (cerința B): temele și exersarea
// folosesc întâi exercițiile interactive/PDF existente; generarea (Claude
// Opus 5, după modelul din site) intervine doar în completare/epuizare.
//
// POST { userId, action, ... } — acces DOAR abonați (fără probă gratuită).
// GET  ?action=cron (header x-vercel-cron sau ?secret=) — scanarea zilnică.
// =====================================================================
const ai = require('./_lib/ai');
const med = require('./_lib/meditatii');

module.exports = async function handler(req, res) {
  ai.applyCors(res);
  if (req.method === 'OPTIONS') return res.status(204).end();

  const supa = ai.admin();

  // ── CRON zilnic: recapitulări scadente + teme restante + teme noi ──────────
  if (req.method === 'GET') {
    const cronOk = req.headers['x-vercel-cron'] || (process.env.AI_CRON_SECRET && req.query.secret === process.env.AI_CRON_SECRET);
    if (req.query.action === 'cron' && cronOk) {
      try { return res.status(200).json(await cronScan(supa)); }
      catch (e) { console.error('meditatii cron:', e); return res.status(500).json({ error: e.message }); }
    }
    return res.status(405).json({ error: 'Method Not Allowed' });
  }
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method Not Allowed' });

  try {
    const { action } = req.body || {};
    const handlers = {
      state, setup, assessment_submit: assessmentSubmit,
      lesson, exercises, submit_set: submitSet, remediation,
      homework_assign: homeworkAssign, homework_list: homeworkList,
      homework_start: homeworkStart, homework_submit: homeworkSubmit,
      review_start: reviewStart, simulare, set_style: setStyle,
      mentor_report: mentorReportAction, reset: resetProfile,
    };
    const fn = handlers[action];
    if (!fn) return res.status(400).json({ error: 'action invalid' });
    return await fn(req, res, supa);
  } catch (err) {
    console.error('ai-meditatii error:', err);
    return res.status(err.status || 500).json({ error: err.message || 'Eroare server', code: err.code || null });
  }
};

// ─── Acces: meditațiile sunt DOAR pentru abonați (fără probă gratuită) ───────
function requireMeditatii(profile) {
  if (profile.is_admin || ai.isPremium(profile)) return;
  const e = new Error('Meditațiile cu Profesorul Virtual fac parte din abonament. Abonează-te pentru meditații nelimitate: evaluare, plan personalizat, lecții, teme și simulări de examen.');
  e.status = 402; e.code = 'PREMIUM_REQUIRED';
  throw e;
}

const getMedProfile = (supa, userId) => med.getProfile(supa, userId);
const reconcileContentHomework = (supa, userId) => med.reconcileContentHomework(supa, userId);
async function savePlan(supa, userId, plan) {
  await supa.from('ai_meditatii_profile').update({ plan }).eq('user_id', userId);
}
async function saveMemory(supa, userId, memory) {
  await supa.from('ai_meditatii_profile').update({ memory }).eq('user_id', userId);
}

// întrebările trimise clientului NU conțin răspunsul/explicația
function sanitize(questions) {
  return (questions || []).map((q) => ({
    statement: q.statement,
    options: Array.isArray(q.options) ? q.options : undefined,
    answer_type: Array.isArray(q.options) ? 'choice' : 'open',
  }));
}

// corectare deterministă (grile pe index; răspuns liber normalizat + echivalență numerică)
function gradeAnswers(questions, answers) {
  const norm = (s) => String(s ?? '').trim().toLowerCase().replace(/,/g, '.').replace(/\s+/g, '');
  const results = (questions || []).map((q, i) => {
    const given = answers?.[i];
    let ok = false;
    if (Array.isArray(q.options)) {
      ok = Number(given) === Number(q.answer);
    } else {
      const a = norm(q.answer), g = norm(given);
      ok = !!g && (g === a || (isFinite(parseFloat(a)) && isFinite(parseFloat(g)) && Math.abs(parseFloat(a) - parseFloat(g)) < 1e-9));
    }
    return {
      index: i, correct: ok,
      statement: q.statement, options: q.options,
      given: given ?? null, answer: q.answer, explanation: q.explanation || '',
      chapter: q.chapter || null, topic: q.topic || null,
    };
  });
  const correct = results.filter((r) => r.correct).length;
  return { results, correct, total: results.length, pct: results.length ? correct / results.length : 0 };
}

// memoria pedagogică: linia de adaptare trimisă generatoarelor
function styleNoteOf(profile) {
  const m = profile?.memory || {};
  const bits = [];
  if (profile?.level) bits.push(`nivelul elevului: ${profile.level}`);
  if (m.styles?.preferred) bits.push(`stilul de explicație care funcționează cel mai bine: ${m.styles.preferred}`);
  const errs = Object.entries(m.errorTypes || {}).sort((a, b) => b[1] - a[1]).slice(0, 2).map(([k]) => k);
  if (errs.length) bits.push(`greșeli frecvente: ${errs.join(', ')} — include capcane care îl antrenează exact pe acestea`);
  return bits.join('; ');
}

// ═════════════════════════════════════════════════════════════════════════════
// STATE — tot ce vede dashboardul (permis și fără abonament, pentru upsell)
// ═════════════════════════════════════════════════════════════════════════════
async function state(req, res, supa) {
  const userId = await ai.authUser(req, supa);
  const profile = await ai.requireUser(supa, userId);
  const premium = profile.is_admin || ai.isPremium(profile);

  const medProfile = await getMedProfile(supa, userId);
  if (!medProfile) {
    return res.status(200).json({ premium, needsSetup: true });
  }

  await reconcileContentHomework(supa, userId);

  const [{ data: hw }, { data: reviews }, { data: sessions }, { data: mastery }, { data: mistakes }] = await Promise.all([
    supa.from('ai_meditatii_homework').select('id, kind, content_id, title, chapter, topic, difficulty, status, score, max_score, attempts, assigned_at, due_at, completed_at, feedback')
      .eq('user_id', userId).order('assigned_at', { ascending: false }).limit(30),
    supa.from('ai_meditatii_reviews').select('id, chapter, topic, stage, due_at, done_at')
      .eq('user_id', userId).order('due_at', { ascending: true }).limit(50),
    supa.from('ai_meditatii_sessions').select('id, kind, chapter, topic, status, score, max_score, duration_sec, created_at, completed_at')
      .eq('user_id', userId).order('created_at', { ascending: false }).limit(20),
    supa.from('ai_skill_mastery').select('category, topic, mastery, attempts').eq('user_id', userId),
    supa.from('ai_meditatii_mistakes').select('id, chapter, topic, error_type, statement, remediated, created_at')
      .eq('user_id', userId).eq('remediated', false).order('created_at', { ascending: false }).limit(12),
  ]);

  const now = Date.now();
  const dueReviews = (reviews || []).filter((r) => r.stage <= 2 && new Date(r.due_at).getTime() <= now);
  const pendingHw = (hw || []).filter((h) => h.status === 'data');
  const plan = medProfile.plan || {};
  const chapterTitles = {};
  (plan.chapters || []).forEach((c) => { chapterTitles[c.id] = c.title; });

  // predicția notei
  const masteryRows = mastery || [];
  const masteryAvg = masteryRows.length ? masteryRows.reduce((s, m) => s + Number(m.mastery), 0) / masteryRows.length : null;
  const hwDone = (hw || []).filter((h) => h.status === 'rezolvata' && h.max_score);
  const homeworkAvg = hwDone.length ? hwDone.reduce((s, h) => s + h.score / h.max_score, 0) / hwDone.length : null;
  const sims = (sessions || []).filter((s) => s.kind === 'simulare' && s.status === 'finalizata' && s.max_score);
  const simAvg = sims.length ? sims.reduce((s, x) => s + x.score / x.max_score, 0) / sims.length : null;
  const weakChapters = (plan.chapters || []).filter((c) => c.mastery != null && c.mastery < 0.5).map((c) => c.title);
  const prediction = med.predictGrade({ masteryAvg, homeworkAvg, simAvg, weakChapters });

  return res.status(200).json({
    premium,
    profile: {
      grade: medProfile.grade, examTarget: medProfile.exam_target, level: medProfile.level,
      streakDays: medProfile.streak_days, totalSeconds: medProfile.total_seconds,
      memory: { preferredStyle: medProfile.memory?.styles?.preferred || null },
      assessment: { score: medProfile.assessment?.score ?? null, maxScore: medProfile.assessment?.maxScore ?? null, gaps: medProfile.assessment?.gaps || [] },
    },
    plan: { ...plan, progress: med.planProgress(plan) },
    nextChapter: med.nextChapter(plan),
    dueReviews: dueReviews.map((r) => ({ ...r, chapterTitle: chapterTitles[r.chapter] || r.chapter })),
    homework: hw || [],
    pendingHomework: pendingHw.length,
    sessions: sessions || [],
    openMistakes: mistakes || [],
    prediction,
    examType: med.examTypeFor(medProfile),
  });
}

// ═════════════════════════════════════════════════════════════════════════════
// SETUP — înscrierea + TESTUL INIȚIAL ADAPTIV (funcția 1)
// ═════════════════════════════════════════════════════════════════════════════
async function setup(req, res, supa) {
  const userId = await ai.authUser(req, supa);
  const profile = await ai.requireUser(supa, userId);
  requireMeditatii(profile);
  await ai.enforceRateLimit(supa, userId);

  const grade = Math.min(12, Math.max(5, parseInt(req.body?.grade, 10) || 8));
  const rawTarget = String(req.body?.examTarget || '').trim();
  const examTarget = ['evaluare-nationala', 'bac-mate-info', 'bac-stiinte', 'bac-tehnologic'].includes(rawTarget) ? rawTarget : null;

  const { error: upErr } = await supa.from('ai_meditatii_profile').upsert({
    user_id: userId, grade, exam_target: examTarget, level: null,
    assessment: {}, plan: {}, memory: {},
  }, { onConflict: 'user_id' });
  if (upErr) return res.status(500).json({ error: upErr.message });

  const medProfile = { grade, exam_target: examTarget };
  const chapters = med.curriculumFor(medProfile);
  const chaptersSpec = chapters.map((c) => `- ${c.id}: ${c.title}`).join('\n');
  const category = med.categoryFor(medProfile);

  const { questions, provider, usage } = await med.genQuestions(supa, {
    category, purpose: 'evaluare', count: 12, chaptersSpec,
    topics: chapters.slice(0, 6).flatMap((c) => c.topics.slice(0, 2)),
  });
  await ai.logUsage(supa, userId, 'ai-meditatii:setup', usage || {});
  if (!questions.length) return res.status(502).json({ error: 'Testul inițial nu a putut fi generat. Mai încearcă o dată.' });

  // fiecare întrebare trebuie să aparțină unui capitol valid (altfel prima potrivire)
  const validIds = new Set(chapters.map((c) => c.id));
  questions.forEach((q, i) => { if (!validIds.has(q.chapter)) q.chapter = chapters[Math.floor(i / Math.max(1, questions.length / chapters.length)) % chapters.length].id; });

  const { data: sess, error: sErr } = await supa.from('ai_meditatii_sessions').insert({
    user_id: userId, kind: 'evaluare', status: 'activa',
    payload: { questions, provider },
  }).select('id').single();
  if (sErr) return res.status(500).json({ error: sErr.message });

  return res.status(200).json({ sessionId: sess.id, questions: sanitize(questions), count: questions.length });
}

// ═════════════════════════════════════════════════════════════════════════════
// ASSESSMENT_SUBMIT — corectează testul inițial, stabilește nivel + lacune,
// construiește PLANUL personalizat (funcțiile 1 + 2)
// ═════════════════════════════════════════════════════════════════════════════
async function assessmentSubmit(req, res, supa) {
  const userId = await ai.authUser(req, supa);
  const profile = await ai.requireUser(supa, userId);
  requireMeditatii(profile);
  const { sessionId, answers = [], durationSec = 0 } = req.body || {};

  const { data: sess } = await supa.from('ai_meditatii_sessions').select('*').eq('id', sessionId).eq('user_id', userId).single();
  if (!sess || sess.kind !== 'evaluare') return res.status(404).json({ error: 'Sesiunea de evaluare nu există.' });
  if (sess.status !== 'activa') return res.status(400).json({ error: 'Testul a fost deja corectat.' });

  const questions = sess.payload?.questions || [];
  const graded = gradeAnswers(questions, answers);

  // lacune pe capitole (sub 50% la capitol)
  const byChapter = {};
  graded.results.forEach((r) => {
    const c = r.chapter || 'general';
    (byChapter[c] ||= { correct: 0, total: 0 }).total += 1;
    if (r.correct) byChapter[c].correct += 1;
  });
  const medProfile0 = await getMedProfile(supa, userId);
  const chapters = med.curriculumFor(medProfile0);
  const titles = {}; chapters.forEach((c) => { titles[c.id] = c.title; });
  const gaps = Object.entries(byChapter)
    .filter(([, v]) => v.total > 0 && v.correct / v.total < 0.5)
    .map(([id, v]) => ({ chapter: id, title: titles[id] || id, correct: v.correct, total: v.total }));

  const level = graded.pct >= 0.75 ? 'avansat' : graded.pct >= 0.45 ? 'mediu' : 'incepator';
  const assessment = { score: graded.correct, maxScore: graded.total, pct: Math.round(graded.pct * 100), gaps, level, at: new Date().toISOString() };
  const plan = med.buildPlan({ ...medProfile0, level }, assessment);

  // memoria pedagogică + streak + timp
  const wrong = graded.results.filter((r) => !r.correct);
  const analysis = await med.classifyMistakes(wrong.map((r) => ({
    statement: r.statement, correct: Array.isArray(r.options) ? r.options[r.answer] : r.answer,
    given: Array.isArray(r.options) ? (r.given != null ? r.options[r.given] : null) : r.given, explanation: r.explanation,
  })));
  const errorTypes = {};
  analysis.forEach((a) => { errorTypes[a.errorType] = (errorTypes[a.errorType] || 0) + 1; });
  analysis.forEach((a) => { const r = wrong[a.index]; if (r) { r.errorType = a.errorType; r.analysis = a.analysis; } });

  const streak = med.bumpStreak(medProfile0);
  await supa.from('ai_meditatii_profile').update({
    level, assessment, plan,
    memory: { ...(medProfile0.memory || {}), errorTypes },
    streak_days: streak.streak_days, last_study_date: streak.last_study_date,
    total_seconds: (medProfile0.total_seconds || 0) + Math.max(0, parseInt(durationSec, 10) || 0),
  }).eq('user_id', userId);

  await supa.from('ai_meditatii_sessions').update({
    status: 'finalizata', score: graded.correct, max_score: graded.total,
    duration_sec: Math.max(0, parseInt(durationSec, 10) || 0),
    payload: { ...sess.payload, results: graded.results },
    completed_at: new Date().toISOString(),
  }).eq('id', sessionId);

  // stăpânirea inițială pe subiecte
  for (const r of graded.results) {
    try { await supa.rpc('bump_skill_mastery', { p_user: userId, p_category: med.categoryFor(medProfile0), p_topic: r.topic || titles[r.chapter] || 'general', p_correct: r.correct }); }
    catch { /* ignorăm */ }
  }

  return res.status(200).json({
    score: graded.correct, maxScore: graded.total, pct: assessment.pct,
    level, gaps, plan: { ...plan, progress: med.planProgress(plan) },
    results: graded.results,
  });
}

// ═════════════════════════════════════════════════════════════════════════════
// LESSON — teoria capitolului: ÎNTÂI materialele din site, apoi lecția AI
// (modelul de generare existent — „sol”), cu formule și schemă (funcția 14)
// ═════════════════════════════════════════════════════════════════════════════
async function lesson(req, res, supa) {
  const userId = await ai.authUser(req, supa);
  const profile = await ai.requireUser(supa, userId);
  requireMeditatii(profile);
  await ai.enforceRateLimit(supa, userId);

  const medProfile = await getMedProfile(supa, userId);
  if (!medProfile) return res.status(400).json({ error: 'Începe cu testul inițial.' });
  const plan = medProfile.plan || {};
  const chapterId = req.body?.chapterId || med.nextChapter(plan)?.id;
  const chapter = (plan.chapters || []).find((c) => c.id === chapterId);
  if (!chapter) return res.status(404).json({ error: 'Capitolul nu există în plan.' });

  const categories = [med.categoryFor(medProfile), med.classCategory(medProfile)];
  const materials = await med.siteTheoryFor(supa, {
    categories, topics: chapter.topics || [], chapterTitle: chapter.title, limit: 5,
  });

  // lecția: stil din materialele din site (RAG), generată cu modelul existent
  const docs = await ai.retrieve(supa, {
    query: `${chapter.title} ${chapter.topics?.join(' ') || ''} teorie explicație`,
    category: med.categoryFor(medProfile), allowPremium: true, k: 6, prefer: 'solution',
  });
  const ctx = ai.contextBlock(docs);
  const styleNote = styleNoteOf(medProfile);
  const system = `${ai.PERSONA}

Sarcină: predă TEORIA capitolului „${chapter.title}" pentru un elev de ${medProfile.grade <= 8 ? `clasa a ${medProfile.grade}-a` : `clasa a ${medProfile.grade}-a (liceu)`}${medProfile.exam_target ? `, care se pregătește pentru ${medProfile.exam_target === 'evaluare-nationala' ? 'Evaluarea Națională' : 'Bacalaureat'}` : ''}.
${styleNote ? `ADAPTARE LA ELEV: ${styleNote}.` : ''}

=== MATERIALE DIN SITE (folosește stilul și notațiile lor) ===
${ctx}
=== SFÂRȘIT ===

Structura OBLIGATORIE a lecției (formule LaTeX între $...$):
## Pe scurt
(2–3 fraze: despre ce e capitolul și la ce folosește în viața reală)
## Noțiunile esențiale
(definițiile și ideile cheie, pas cu pas, numerotate)
## Formulele de ținut minte
(listă scurtă, fiecare formulă cu o explicație de un rând)
## Exemplu rezolvat
(un exemplu complet, pas cu pas, cu justificarea fiecărui pas)
## Schema capitolului
(o schemă/hartă a noțiunilor: noțiune → subnoțiuni, ca listă indentată)
Subiectele capitolului: ${chapter.topics?.join('; ') || chapter.title}.`;

  const { text, usage } = await ai.chat({
    system,
    messages: [{ role: 'user', content: 'Scrie lecția acum, caldă și clară, potrivită nivelului meu.' }],
    temperature: 0.4, maxTokens: 2200, model: ai.GEN_MODEL,
  });
  await ai.logUsage(supa, userId, 'ai-meditatii:lesson', usage);

  // capitolul trece în starea „teorie" (dacă era neînceput)
  if (chapter.status === 'de_parcurs') chapter.status = 'teorie';
  const memory = { ...(medProfile.memory || {}), lastChapter: chapter.id };
  await savePlan(supa, userId, plan);
  await saveMemory(supa, userId, memory);
  await supa.from('ai_meditatii_sessions').insert({
    user_id: userId, kind: 'lectie', chapter: chapter.id, topic: chapter.title,
    status: 'finalizata', completed_at: new Date().toISOString(), payload: { materials },
  });

  return res.status(200).json({ chapter: { id: chapter.id, title: chapter.title }, lesson: text, materials });
}

// ═════════════════════════════════════════════════════════════════════════════
// EXERCISES — set de exerciții la capitol (site-first + Opus 5) (funcția 5)
// ═════════════════════════════════════════════════════════════════════════════
async function exercises(req, res, supa) {
  const userId = await ai.authUser(req, supa);
  const profile = await ai.requireUser(supa, userId);
  requireMeditatii(profile);
  await ai.enforceRateLimit(supa, userId);

  const medProfile = await getMedProfile(supa, userId);
  if (!medProfile) return res.status(400).json({ error: 'Începe cu testul inițial.' });
  const plan = medProfile.plan || {};
  const chapterId = req.body?.chapterId || med.nextChapter(plan)?.id;
  const chapter = (plan.chapters || []).find((c) => c.id === chapterId);
  if (!chapter) return res.status(404).json({ error: 'Capitolul nu există în plan.' });

  const level = medProfile.level || 'mediu';
  const reqDiff = String(req.body?.difficulty || '').trim();
  const difficulty = ['ușor', 'mediu', 'greu'].includes(reqDiff)
    ? reqDiff
    : (level === 'incepator' ? 'ușor' : level === 'avansat' ? 'greu' : 'mediu');
  const count = Math.min(12, Math.max(5, parseInt(req.body?.count, 10) || 10));

  // 1) materialele din site — recomandate ca pas următor (interactive nefinalizate)
  const siteItems = await med.siteInteractiveFor(supa, {
    userId, categories: [med.categoryFor(medProfile), med.classCategory(medProfile)],
    topics: [chapter.title, ...(chapter.topics || [])], limit: 3,
  });

  // 2) setul generat după modelul din site (Claude Opus 5, fallback existent)
  const { questions, provider, usage } = await med.genQuestions(supa, {
    category: med.categoryFor(medProfile), chapter: chapter.title,
    topics: chapter.topics || [], difficulty, count,
    purpose: 'exersare', styleNote: styleNoteOf(medProfile),
  });
  await ai.logUsage(supa, userId, 'ai-meditatii:exercises', usage || {});
  if (!questions.length) return res.status(502).json({ error: 'Exercițiile nu au putut fi generate. Mai încearcă o dată.' });
  questions.forEach((q) => { q.chapter = chapter.id; q.topic = q.topic || chapter.title; });

  const { data: sess, error } = await supa.from('ai_meditatii_sessions').insert({
    user_id: userId, kind: 'exercitii', chapter: chapter.id, topic: chapter.title, difficulty,
    status: 'activa', payload: { questions, provider },
  }).select('id').single();
  if (error) return res.status(500).json({ error: error.message });

  if (chapter.status === 'de_parcurs' || chapter.status === 'teorie') chapter.status = 'in_lucru';
  chapter.sessions = (chapter.sessions || 0) + 1;
  await savePlan(supa, userId, plan);

  return res.status(200).json({
    sessionId: sess.id, chapter: { id: chapter.id, title: chapter.title },
    difficulty, questions: sanitize(questions),
    siteExercises: siteItems.map((s) => ({ id: s.id, title: s.title, url: `/exercitiu?id=${s.id}`, is_free: s.is_free })),
  });
}

// ═════════════════════════════════════════════════════════════════════════════
// SUBMIT_SET — corectează un set (exerciții/remediere/recapitulare/simulare),
// detectează greșelile tipice, actualizează memoria, planul și repetițiile
// (funcțiile 4, 6, 11, 15)
// ═════════════════════════════════════════════════════════════════════════════
async function submitSet(req, res, supa) {
  const userId = await ai.authUser(req, supa);
  const profile = await ai.requireUser(supa, userId);
  requireMeditatii(profile);
  const { sessionId, answers = [], durationSec = 0 } = req.body || {};

  const { data: sess } = await supa.from('ai_meditatii_sessions').select('*').eq('id', sessionId).eq('user_id', userId).single();
  if (!sess) return res.status(404).json({ error: 'Sesiunea nu există.' });
  if (sess.status !== 'activa') return res.status(400).json({ error: 'Setul a fost deja corectat.' });
  if (sess.kind === 'evaluare') return assessmentSubmit(req, res, supa);

  const questions = sess.payload?.questions || [];
  const graded = gradeAnswers(questions, answers);
  const medProfile = await getMedProfile(supa, userId);

  // analiza greșelilor (funcția 4) + jurnalul de greșeli
  const wrong = graded.results.filter((r) => !r.correct);
  const analysis = await med.classifyMistakes(wrong.map((r) => ({
    statement: r.statement, correct: Array.isArray(r.options) ? r.options[r.answer] : r.answer,
    given: Array.isArray(r.options) ? (r.given != null ? r.options[r.given] : null) : r.given, explanation: r.explanation,
  })));
  const errorTypes = { ...(medProfile?.memory?.errorTypes || {}) };
  const mistakeRows = [];
  analysis.forEach((a) => {
    const r = wrong[a.index];
    if (!r) return;
    r.errorType = a.errorType; r.analysis = a.analysis;
    errorTypes[a.errorType] = (errorTypes[a.errorType] || 0) + 1;
    mistakeRows.push({
      user_id: userId, chapter: sess.chapter, topic: r.topic || sess.topic,
      error_type: a.errorType, statement: r.statement,
      student_answer: String(Array.isArray(r.options) ? (r.given != null ? r.options[r.given] : '') : (r.given ?? '')),
      correct_answer: String(Array.isArray(r.options) ? r.options[r.answer] : r.answer),
      analysis: a.analysis,
    });
  });
  let mistakeIds = [];
  if (mistakeRows.length) {
    const { data: ins } = await supa.from('ai_meditatii_mistakes').insert(mistakeRows).select('id');
    mistakeIds = (ins || []).map((m) => m.id);
  }

  // stăpânirea pe subiecte
  for (const r of graded.results) {
    try { await supa.rpc('bump_skill_mastery', { p_user: userId, p_category: med.categoryFor(medProfile || {}), p_topic: r.topic || sess.topic || 'general', p_correct: r.correct }); }
    catch { /* ignorăm */ }
  }

  // sesiunea + timpul + streak
  await supa.from('ai_meditatii_sessions').update({
    status: 'finalizata', score: graded.correct, max_score: graded.total,
    duration_sec: Math.max(0, parseInt(durationSec, 10) || 0),
    payload: { ...sess.payload, results: graded.results },
    completed_at: new Date().toISOString(),
  }).eq('id', sessionId);

  const streak = med.bumpStreak(medProfile || {});
  const profPatch = {
    memory: { ...(medProfile?.memory || {}), errorTypes },
    streak_days: streak.streak_days, last_study_date: streak.last_study_date,
    total_seconds: (medProfile?.total_seconds || 0) + Math.max(0, parseInt(durationSec, 10) || 0),
  };

  // planul: mastery pe capitol + finalizare + repetiție inteligentă (funcția 6)
  const plan = medProfile?.plan || {};
  let chapterDone = false;
  const chapter = (plan.chapters || []).find((c) => c.id === sess.chapter);
  if (chapter && (sess.kind === 'exercitii' || sess.kind === 'remediere' || sess.kind === 'tema')) {
    chapter.mastery = chapter.mastery == null ? graded.pct : Math.round((chapter.mastery * 0.5 + graded.pct * 0.5) * 100) / 100;
    if (graded.pct >= 0.8 && (chapter.sessions || 0) >= 1 && chapter.status !== 'finalizat') {
      chapter.status = 'finalizat';
      chapterDone = true;
      // programăm recapitulările: după 1 zi → 7 → 30
      await supa.from('ai_meditatii_reviews').upsert({
        user_id: userId, chapter: chapter.id, topic: chapter.title,
        stage: 0, due_at: med.nextReviewDue(0), done_at: null,
      }, { onConflict: 'user_id,chapter' });
    }
    profPatch.plan = plan;
  }

  // recapitulare reușită → avansează etapa repetiției (1 zi → 7 → 30)
  let reviewAdvanced = null;
  if (sess.kind === 'recapitulare' && sess.payload?.reviewId) {
    const { data: rev } = await supa.from('ai_meditatii_reviews').select('*').eq('id', sess.payload.reviewId).eq('user_id', userId).maybeSingle();
    if (rev) {
      if (graded.pct >= 0.6) {
        const newStage = Math.min(3, (rev.stage || 0) + 1);
        await supa.from('ai_meditatii_reviews').update({
          stage: newStage, done_at: new Date().toISOString(),
          due_at: newStage >= 3 ? rev.due_at : med.nextReviewDue(newStage),
        }).eq('id', rev.id);
        reviewAdvanced = { stage: newStage, done: newStage >= 3 };
      } else {
        await supa.from('ai_meditatii_reviews').update({ due_at: med.nextReviewDue(0) }).eq('id', rev.id);
        reviewAdvanced = { stage: rev.stage, retry: true };
        // capitolul redevine „în lucru" — simplificăm și revenim la bază (funcția 15)
        if (chapter) { chapter.status = 'in_lucru'; profPatch.plan = plan; }
      }
    }
  }

  // remediere reușită → greșeala e considerată remediată
  if (sess.kind === 'remediere' && sess.payload?.mistakeId && graded.pct >= 0.8) {
    await supa.from('ai_meditatii_mistakes').update({ remediated: true }).eq('id', sess.payload.mistakeId).eq('user_id', userId);
  }

  await supa.from('ai_meditatii_profile').update(profPatch).eq('user_id', userId);

  // adaptarea dificultății (funcția 15) — recomandarea pasului următor
  let nextStep = null;
  if (graded.pct >= 0.9) nextStep = { kind: 'harder', label: 'Excelent! Următorul set va fi puțin mai dificil.' };
  else if (graded.pct < 0.5) nextStep = { kind: 'easier', label: 'Simplificăm puțin și reluăm noțiunile de bază, pas cu pas.' };
  else nextStep = { kind: 'same', label: 'Bine! Mai exersăm o dată la același nivel ca să fixăm.' };

  return res.status(200).json({
    score: graded.correct, maxScore: graded.total, pct: Math.round(graded.pct * 100),
    results: graded.results, mistakeIds, chapterDone, reviewAdvanced, nextStep,
    streakDays: streak.streak_days,
  });
}

// ═════════════════════════════════════════════════════════════════════════════
// REMEDIATION — „încă 10 exerciții de același fel" (funcția 5)
// ═════════════════════════════════════════════════════════════════════════════
async function remediation(req, res, supa) {
  const userId = await ai.authUser(req, supa);
  const profile = await ai.requireUser(supa, userId);
  requireMeditatii(profile);
  await ai.enforceRateLimit(supa, userId);
  const { mistakeId } = req.body || {};

  const { data: mistake } = await supa.from('ai_meditatii_mistakes').select('*').eq('id', mistakeId).eq('user_id', userId).single();
  if (!mistake) return res.status(404).json({ error: 'Greșeala nu a fost găsită.' });

  const medProfile = await getMedProfile(supa, userId);
  const { questions, provider, usage } = await med.genQuestions(supa, {
    category: med.categoryFor(medProfile || {}), chapter: mistake.chapter,
    topics: [mistake.topic].filter(Boolean), difficulty: 'mediu', count: 10,
    purpose: 'remediere', mistake, styleNote: styleNoteOf(medProfile),
  });
  await ai.logUsage(supa, userId, 'ai-meditatii:remediation', usage || {});
  if (!questions.length) return res.status(502).json({ error: 'Exercițiile de remediere nu au putut fi generate. Mai încearcă.' });
  questions.forEach((q) => { q.chapter = mistake.chapter; q.topic = q.topic || mistake.topic; });

  const { data: sess, error } = await supa.from('ai_meditatii_sessions').insert({
    user_id: userId, kind: 'remediere', chapter: mistake.chapter, topic: mistake.topic,
    status: 'activa', payload: { questions, provider, mistakeId },
  }).select('id').single();
  if (error) return res.status(500).json({ error: error.message });

  return res.status(200).json({ sessionId: sess.id, questions: sanitize(questions), mistake: { statement: mistake.statement, analysis: mistake.analysis } });
}

// ═════════════════════════════════════════════════════════════════════════════
// TEMELE (funcția 10 — „cea mai importantă"): întâi din site, apoi generate
// ═════════════════════════════════════════════════════════════════════════════
async function pickAndAssignHomework(supa, userId, medProfile, { notify = true } = {}) {
  const plan = medProfile.plan || {};
  const chapter = med.nextChapter(plan) || (plan.chapters || [])[0] || null;
  const level = medProfile.level || 'mediu';
  const difficulty = level === 'incepator' ? 'ușor' : level === 'avansat' ? 'greu' : 'mediu';
  const dueAt = new Date(Date.now() + 3 * 86400000).toISOString();

  // temele „data" existente nu se dublează
  const { data: pending } = await supa.from('ai_meditatii_homework')
    .select('id').eq('user_id', userId).eq('status', 'data').limit(3);
  if ((pending || []).length >= 2) return { skipped: 'are deja teme nefăcute' };

  // 1) ÎNTÂI: un exercițiu interactiv EXISTENT în site, nefinalizat
  const site = await med.siteInteractiveFor(supa, {
    userId, categories: [med.categoryFor(medProfile), med.classCategory(medProfile)],
    topics: chapter ? [chapter.title, ...(chapter.topics || [])] : [], limit: 1,
  });
  let hwRow = null;
  if (site.length) {
    const s = site[0];
    const { data } = await supa.from('ai_meditatii_homework').insert({
      user_id: userId, kind: 'content', content_id: s.id, title: s.title,
      chapter: chapter?.id || null, topic: chapter?.title || null, difficulty,
      status: 'data', assigned_at: new Date().toISOString(),
      payload: { url: `/exercitiu?id=${s.id}` }, due_at: dueAt,
    }).select('id, title').single();
    hwRow = data ? { ...data, kind: 'content' } : null;
  } else if (chapter) {
    // 2) site epuizat → generăm după modelul din site (Opus 5 / fallback)
    const { questions } = await med.genQuestions(supa, {
      category: med.categoryFor(medProfile), chapter: chapter.title,
      topics: chapter.topics || [], difficulty, count: 8,
      purpose: 'tema', styleNote: styleNoteOf(medProfile),
    });
    if (questions.length) {
      questions.forEach((q) => { q.chapter = chapter.id; q.topic = q.topic || chapter.title; });
      const { data } = await supa.from('ai_meditatii_homework').insert({
        user_id: userId, kind: 'interactive', title: `Temă · ${chapter.title}`,
        chapter: chapter.id, topic: chapter.title, difficulty,
        status: 'data', assigned_at: new Date().toISOString(),
        payload: { questions }, due_at: dueAt,
      }).select('id, title').single();
      hwRow = data ? { ...data, kind: 'interactive' } : null;
    }
  }
  if (hwRow && notify) {
    await ai.createNotification(supa, {
      recipientId: userId, type: 'meditatii_homework',
      title: '📚 Ai o temă nouă de la Profesorul Virtual',
      body: hwRow.title,
      data: { url: '/meditatii?tab=teme' },
      dedupeKey: `med_hw:${hwRow.id}`, dedupeDays: 30,
    });
  }
  return hwRow ? { assigned: hwRow } : { skipped: 'fără materiale potrivite' };
}

async function homeworkAssign(req, res, supa) {
  const userId = await ai.authUser(req, supa);
  const profile = await ai.requireUser(supa, userId);
  requireMeditatii(profile);
  await ai.enforceRateLimit(supa, userId);
  const medProfile = await getMedProfile(supa, userId);
  if (!medProfile) return res.status(400).json({ error: 'Începe cu testul inițial.' });
  const out = await pickAndAssignHomework(supa, userId, medProfile, { notify: false });
  return res.status(200).json(out);
}

async function homeworkList(req, res, supa) {
  const userId = await ai.authUser(req, supa);
  await ai.requireUser(supa, userId);
  await reconcileContentHomework(supa, userId);
  const { data } = await supa.from('ai_meditatii_homework')
    .select('id, kind, content_id, title, chapter, topic, difficulty, status, score, max_score, attempts, feedback, assigned_at, due_at, completed_at')
    .eq('user_id', userId).order('assigned_at', { ascending: false }).limit(40);
  return res.status(200).json({ homework: data || [] });
}

async function homeworkStart(req, res, supa) {
  const userId = await ai.authUser(req, supa);
  const profile = await ai.requireUser(supa, userId);
  requireMeditatii(profile);
  const { id } = req.body || {};
  const { data: hw } = await supa.from('ai_meditatii_homework').select('*').eq('id', id).eq('user_id', userId).single();
  if (!hw) return res.status(404).json({ error: 'Tema nu există.' });
  if (hw.kind === 'content') {
    return res.status(200).json({ kind: 'content', url: hw.payload?.url || `/exercitiu?id=${hw.content_id}`, title: hw.title });
  }
  return res.status(200).json({ kind: hw.kind, homeworkId: hw.id, title: hw.title, questions: sanitize(hw.payload?.questions || []) });
}

// corectează + notează + explică greșelile + propune exerciții suplimentare
async function homeworkSubmit(req, res, supa) {
  const userId = await ai.authUser(req, supa);
  const profile = await ai.requireUser(supa, userId);
  requireMeditatii(profile);
  const { id, answers = [], durationSec = 0 } = req.body || {};
  const { data: hw } = await supa.from('ai_meditatii_homework').select('*').eq('id', id).eq('user_id', userId).single();
  if (!hw) return res.status(404).json({ error: 'Tema nu există.' });
  if (hw.kind === 'content') return res.status(400).json({ error: 'Tema din site se rezolvă în pagina exercițiului — scorul se preia automat.' });

  const questions = hw.payload?.questions || [];
  const graded = gradeAnswers(questions, answers);
  const medProfile = await getMedProfile(supa, userId);

  const wrong = graded.results.filter((r) => !r.correct);
  const analysis = await med.classifyMistakes(wrong.map((r) => ({
    statement: r.statement, correct: Array.isArray(r.options) ? r.options[r.answer] : r.answer,
    given: Array.isArray(r.options) ? (r.given != null ? r.options[r.given] : null) : r.given, explanation: r.explanation,
  })));
  analysis.forEach((a) => { const r = wrong[a.index]; if (r) { r.errorType = a.errorType; r.analysis = a.analysis; } });
  const mistakeRows = wrong.filter((r) => r.analysis != null).map((r) => ({
    user_id: userId, chapter: hw.chapter, topic: r.topic || hw.topic, error_type: r.errorType || 'necunoscut',
    statement: r.statement,
    student_answer: String(Array.isArray(r.options) ? (r.given != null ? r.options[r.given] : '') : (r.given ?? '')),
    correct_answer: String(Array.isArray(r.options) ? r.options[r.answer] : r.answer),
    analysis: r.analysis,
  }));
  let mistakeIds = [];
  if (mistakeRows.length) {
    const { data: ins } = await supa.from('ai_meditatii_mistakes').insert(mistakeRows).select('id');
    mistakeIds = (ins || []).map((m) => m.id);
  }

  const grade = Math.max(1, Math.min(10, Math.round((1 + 9 * graded.pct) * 10) / 10));
  const feedback = {
    grade,
    message: graded.pct >= 0.9 ? 'Temă excelentă! Felicitări! 🎉'
      : graded.pct >= 0.7 ? 'Temă bună — mai avem de șlefuit câteva detalii.'
      : graded.pct >= 0.5 ? 'Ai lucrat, dar mai exersăm: uită-te la explicațiile de mai jos.'
      : 'Reluăm împreună noțiunile de bază — nu-i nimic, de aici se învață!',
  };
  await supa.from('ai_meditatii_homework').update({
    status: 'rezolvata', score: graded.correct, max_score: graded.total,
    attempts: (hw.attempts || 0) + 1, completed_at: new Date().toISOString(), feedback,
  }).eq('id', id);

  for (const r of graded.results) {
    try { await supa.rpc('bump_skill_mastery', { p_user: userId, p_category: med.categoryFor(medProfile || {}), p_topic: r.topic || hw.topic || 'general', p_correct: r.correct }); }
    catch { /* ignorăm */ }
  }
  const streak = med.bumpStreak(medProfile || {});
  await supa.from('ai_meditatii_profile').update({
    streak_days: streak.streak_days, last_study_date: streak.last_study_date,
    total_seconds: (medProfile?.total_seconds || 0) + Math.max(0, parseInt(durationSec, 10) || 0),
  }).eq('user_id', userId);

  return res.status(200).json({
    score: graded.correct, maxScore: graded.total, pct: Math.round(graded.pct * 100),
    grade, feedback: feedback.message, results: graded.results, mistakeIds,
  });
}

// ═════════════════════════════════════════════════════════════════════════════
// RECAPITULĂRILE (funcția 6): pornește o recapitulare scadentă
// ═════════════════════════════════════════════════════════════════════════════
async function reviewStart(req, res, supa) {
  const userId = await ai.authUser(req, supa);
  const profile = await ai.requireUser(supa, userId);
  requireMeditatii(profile);
  await ai.enforceRateLimit(supa, userId);
  const { reviewId } = req.body || {};
  const { data: rev } = await supa.from('ai_meditatii_reviews').select('*').eq('id', reviewId).eq('user_id', userId).single();
  if (!rev) return res.status(404).json({ error: 'Recapitularea nu există.' });

  const medProfile = await getMedProfile(supa, userId);
  const plan = medProfile?.plan || {};
  const chapter = (plan.chapters || []).find((c) => c.id === rev.chapter) || { title: rev.topic || rev.chapter, topics: [] };

  const { questions, provider, usage } = await med.genQuestions(supa, {
    category: med.categoryFor(medProfile || {}), chapter: chapter.title,
    topics: chapter.topics || [], difficulty: 'mediu', count: 5,
    purpose: 'recapitulare', styleNote: styleNoteOf(medProfile),
  });
  await ai.logUsage(supa, userId, 'ai-meditatii:review', usage || {});
  if (!questions.length) return res.status(502).json({ error: 'Recapitularea nu a putut fi generată. Mai încearcă.' });
  questions.forEach((q) => { q.chapter = rev.chapter; q.topic = q.topic || chapter.title; });

  const { data: sess, error } = await supa.from('ai_meditatii_sessions').insert({
    user_id: userId, kind: 'recapitulare', chapter: rev.chapter, topic: chapter.title,
    status: 'activa', payload: { questions, provider, reviewId },
  }).select('id').single();
  if (error) return res.status(500).json({ error: error.message });
  return res.status(200).json({ sessionId: sess.id, chapterTitle: chapter.title, stage: rev.stage, questions: sanitize(questions) });
}

// ═════════════════════════════════════════════════════════════════════════════
// SIMULARE DE EXAMEN interactivă (funcția 7) — Claude Opus 5, model din site
// (varianta PDF folosește generatorul existent /api/ai-exam, ca până acum)
// ═════════════════════════════════════════════════════════════════════════════
async function simulare(req, res, supa) {
  const userId = await ai.authUser(req, supa);
  const profile = await ai.requireUser(supa, userId);
  requireMeditatii(profile);
  await ai.enforceRateLimit(supa, userId);

  const medProfile = await getMedProfile(supa, userId);
  if (!medProfile) return res.status(400).json({ error: 'Începe cu testul inițial.' });
  const examType = ['evaluare-nationala', 'bac-mate-info', 'bac-stiinte', 'bac-tehnologic'].includes(req.body?.examType)
    ? req.body.examType : med.examTypeFor(medProfile);
  const isEN = examType === 'evaluare-nationala';
  const category = isEN ? 'evaluare-nationala' : 'bacalaureat';

  // punctele slabe intră în test (teste personalizate după punctele slabe)
  const { data: weak } = await supa.from('ai_skill_mastery')
    .select('topic, mastery').eq('user_id', userId).lt('mastery', 0.6)
    .order('mastery', { ascending: true }).limit(4);
  const weakLine = (weak || []).map((w) => w.topic).filter(Boolean).join(', ');

  const { questions, provider, usage } = await med.genQuestions(supa, {
    category, chapter: isEN ? 'Simulare Evaluare Națională' : `Simulare Bacalaureat (${examType.replace('bac-', '')})`,
    topics: [], difficulty: 'mediu', count: isEN ? 12 : 9,
    purpose: 'simulare',
    styleNote: [
      isEN
        ? 'structura: primele 6 întrebări de algebră (stil Subiectul I), următoarele 6 de geometrie (stil Subiectul al II-lea), toate grilă cu 4 variante'
        : 'itemi reprezentativi pentru toate cele trei subiecte ale probei, de la accesibil la dificil',
      weakLine ? `include obligatoriu itemi din punctele slabe ale elevului: ${weakLine}` : '',
      styleNoteOf(medProfile),
    ].filter(Boolean).join('; '),
  });
  await ai.logUsage(supa, userId, 'ai-meditatii:simulare', usage || {});
  if (!questions.length) return res.status(502).json({ error: 'Simularea nu a putut fi generată. Mai încearcă o dată.' });

  const { data: sess, error } = await supa.from('ai_meditatii_sessions').insert({
    user_id: userId, kind: 'simulare', topic: examType, status: 'activa',
    payload: { questions, provider, examType },
  }).select('id').single();
  if (error) return res.status(500).json({ error: error.message });
  return res.status(200).json({ sessionId: sess.id, examType, questions: sanitize(questions) });
}

// preferința de stil de explicație (funcția 3 — memorie pedagogică)
async function setStyle(req, res, supa) {
  const userId = await ai.authUser(req, supa);
  const profile = await ai.requireUser(supa, userId);
  requireMeditatii(profile);
  const style = String(req.body?.style || '').slice(0, 80) || null;
  const medProfile = await getMedProfile(supa, userId);
  if (!medProfile) return res.status(400).json({ error: 'Începe cu testul inițial.' });
  const memory = { ...(medProfile.memory || {}), styles: { ...(medProfile.memory?.styles || {}), preferred: style } };
  await saveMemory(supa, userId, memory);
  return res.status(200).json({ ok: true, preferred: style });
}

// resetul profilului (reia evaluarea de la zero)
async function resetProfile(req, res, supa) {
  const userId = await ai.authUser(req, supa);
  const profile = await ai.requireUser(supa, userId);
  requireMeditatii(profile);
  await supa.from('ai_meditatii_profile').delete().eq('user_id', userId);
  return res.status(200).json({ ok: true });
}

// ═════════════════════════════════════════════════════════════════════════════
// RAPORT PENTRU MENTORI (funcția 18) — profesorii/părinții asociați
// ═════════════════════════════════════════════════════════════════════════════
async function isLinkedMentor(supa, mentorId, studentId) {
  const { data } = await supa.from('mentor_students')
    .select('student_id').eq('mentor_id', mentorId).eq('student_id', studentId).limit(1);
  if (data && data.length) return true;
  const { data: p } = await supa.from('profiles').select('teacher_id').eq('id', studentId).single();
  return p?.teacher_id === mentorId;
}

async function mentorReportAction(req, res, supa) {
  const userId = await ai.authUser(req, supa);
  const me = await ai.requireUser(supa, userId);
  const { studentId } = req.body || {};
  if (!studentId) return res.status(400).json({ error: 'studentId obligatoriu' });
  if (!(me.is_admin || me.role === 'profesor' || me.role === 'parinte')) return res.status(403).json({ error: 'Nu ai acces.' });
  if (!(me.is_admin || await isLinkedMentor(supa, userId, studentId))) {
    return res.status(403).json({ error: 'Acest elev nu este asociat cu tine.' });
  }
  const report = await med.buildMentorReport(supa, studentId);
  return res.status(200).json({ report }); // null = elevul nu folosește meditațiile
}

// ═════════════════════════════════════════════════════════════════════════════
// CRON zilnic: recapitulări scadente + teme restante + teme noi + clopoțel
// ═════════════════════════════════════════════════════════════════════════════
async function cronScan(supa) {
  const out = { reviewsNotified: 0, homeworkReminded: 0, homeworkAssigned: 0 };
  const nowIso = new Date().toISOString();

  // 1) recapitulări scadente → notificare (dedup 1/zi per elev)
  const { data: due } = await supa.from('ai_meditatii_reviews')
    .select('user_id, chapter, topic').lte('due_at', nowIso).lte('stage', 2).limit(400);
  const byUser = {};
  (due || []).forEach((r) => { (byUser[r.user_id] ||= []).push(r); });
  for (const [uid, list] of Object.entries(byUser)) {
    const ok = await ai.createNotification(supa, {
      recipientId: uid, type: 'meditatii_review',
      title: `🔁 ${list.length === 1 ? 'O recapitulare te așteaptă' : list.length + ' recapitulări te așteaptă'}`,
      body: `Ca să nu uiți materia: ${list.slice(0, 2).map((r) => r.topic || r.chapter).join(', ')}${list.length > 2 ? '…' : ''}`,
      data: { url: '/meditatii?tab=recapitulari' },
      dedupeKey: `med_rev:${uid}`, dedupeDays: 1,
    });
    if (ok) out.reviewsNotified++;
  }

  // 2) teme restante (trecute de termen) → reamintire (dedup 2 zile)
  const { data: late } = await supa.from('ai_meditatii_homework')
    .select('id, user_id, title').eq('status', 'data').lte('due_at', nowIso).limit(300);
  for (const h of late || []) {
    const ok = await ai.createNotification(supa, {
      recipientId: h.user_id, type: 'meditatii_homework',
      title: '⏰ Ai o temă nefăcută de la Profesorul Virtual',
      body: h.title, data: { url: '/meditatii?tab=teme' },
      dedupeKey: `med_hw_late:${h.id}`, dedupeDays: 2,
    });
    if (ok) out.homeworkReminded++;
  }

  // 3) elevi activi fără teme în lucru și fără activitate de 3+ zile → temă nouă
  const threeDaysAgo = new Date(Date.now() - 3 * 86400000).toISOString().slice(0, 10);
  const { data: profiles } = await supa.from('ai_meditatii_profile')
    .select('*').not('level', 'is', null).lte('last_study_date', threeDaysAgo).limit(200);
  for (const p of profiles || []) {
    try {
      // doar abonații primesc teme generate automat
      const { data: acc } = await supa.from('profiles').select('subscription_status, is_admin').eq('id', p.user_id).single();
      if (!acc || !(acc.is_admin || acc.subscription_status === 'active')) continue;
      const r = await pickAndAssignHomework(supa, p.user_id, p, { notify: true });
      if (r.assigned) out.homeworkAssigned++;
    } catch (e) { console.warn('cron homework:', e.message); }
  }

  return out;
}
