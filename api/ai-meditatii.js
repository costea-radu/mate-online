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
const mathcheck = require('./_lib/mathcheck'); // echivalența matematică a răspunsurilor (Etapa 2)

module.exports = async function handler(req, res) {
  ai.applyCors(res);
  if (req.method === 'OPTIONS') return res.status(204).end();

  const supa = ai.admin();

  // ── CRON zilnic: recapitulări scadente + teme restante + teme noi ──────────
  if (req.method === 'GET') {
    const cronOk = ai.isCronRequest(req); // x-vercel-cron(-schedule) / vercel-cron UA / Bearer CRON_SECRET / ?secret=
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
      coach, homework_check: homeworkCheck, homework_score: homeworkScore,
      homework_draft: homeworkDraft, homework_finalize: homeworkFinalize,
      session_score: sessionScore, set_focus: setFocus, set_exam_scope: setExamScope,
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

// PRIORITATEA din plan a unui elev: întâi pregătirea pentru LUCRARE (focus),
// altfel capitolele SUBIECTELOR alese la pregătirea de examen (exam_scope) —
// obiect în forma { chapter_ids } acceptată de med.nextChapter.
function planPriority(medProfile) {
  if (medProfile?.focus?.chapter_ids?.length) return medProfile.focus;
  const ids = med.examScopeIds(medProfile, medProfile?.plan || {}, medProfile?.memory?.exam_scope);
  return ids ? { chapter_ids: ids } : null;
}
const reconcileContentHomework = (supa, userId) => med.reconcileContentHomework(supa, userId);
async function savePlan(supa, userId, plan) {
  await supa.from('ai_meditatii_profile').update({ plan }).eq('user_id', userId);
}
async function saveMemory(supa, userId, memory) {
  await supa.from('ai_meditatii_profile').update({ memory }).eq('user_id', userId);
}

// Scorul raportat de browser pentru un test interactiv din site: întregi,
// 0 ≤ scor ≤ maxim, maximul între 1 și 1000 (testele raportează „din 100"
// sau punctaje brute de zeci de puncte — 5000/5000 nu e un rezultat real).
function clampScore(score, maxScore) {
  const mx = Math.min(1000, Math.max(1, parseInt(maxScore, 10) || 100));
  const sc = Math.min(mx, Math.max(0, parseInt(score, 10) || 0));
  return { sc, mx };
}

// întrebările trimise clientului NU conțin răspunsul/explicația
function sanitize(questions) {
  return (questions || []).map((q) => ({
    statement: q.statement,
    options: Array.isArray(q.options) ? q.options : undefined,
    answer_type: Array.isArray(q.options) ? 'choice' : 'open',
  }));
}

// corectare deterministă (grile pe index; răspuns liber prin ECHIVALENȚĂ
// MATEMATICĂ — api/_lib/mathcheck.js: „1/2" = „0,5", „x=3" = „3", „2√3" =
// „2\sqrt{3}", „24 cm²" = „24", mulțimi de soluții în orice ordine)
function gradeAnswers(questions, answers) {
  const norm = (s) => String(s ?? '').trim().toLowerCase().replace(/,/g, '.').replace(/\s+/g, '');
  const results = (questions || []).map((q, i) => {
    const given = answers?.[i];
    let ok = false;
    if (Array.isArray(q.options)) {
      ok = Number(given) === Number(q.answer);
    } else {
      const a = norm(q.answer), g = norm(given);
      const eq = g ? mathcheck.answersEquivalent(given, q.answer) : false;
      ok = eq === true || (eq == null && !!g && (g === a || (isFinite(parseFloat(a)) && isFinite(parseFloat(g)) && Math.abs(parseFloat(a) - parseFloat(g)) < 1e-9)));
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

// stăpânirea pe subiecte, actualizată în PARALEL (bucla secvențială făcea
// corectarea vizibil de lentă la seturi de 10–12 întrebări)
async function bumpMasteryAll(supa, userId, category, rows, fallbackTopic = 'general') {
  await Promise.allSettled(rows.map((r) =>
    supa.rpc('bump_skill_mastery', {
      p_user: userId, p_category: category, p_topic: r.topic || fallbackTopic, p_correct: r.correct,
    })
  ));
}

// Părinții asociați află când copilul a lucrat (dedup: o notificare pe zi).
async function notifyParents(supa, studentId, body) {
  try {
    const [{ data: links }, { data: prof }] = await Promise.all([
      supa.from('mentor_students').select('mentor_id').eq('student_id', studentId).eq('mentor_role', 'parinte'),
      supa.from('profiles').select('full_name, email').eq('id', studentId).single(),
    ]);
    const parents = [...new Set((links || []).map((l) => l.mentor_id))];
    if (!parents.length) return;
    const who = prof?.full_name || prof?.email || 'Copilul tău';
    const today = new Date().toISOString().slice(0, 10);
    await Promise.allSettled(parents.map((pid) => ai.createNotification(supa, {
      recipientId: pid, type: 'meditatii_parent',
      title: `🎓 ${who} a lucrat azi cu Profesorul Virtual`,
      body, data: { url: '/profil', studentId },
      dedupeKey: `med_parent:${studentId}:${today}`, dedupeDays: 1,
    })));
  } catch (e) { console.warn('notifyParents:', e.message); }
}

// Materialele din site deja FOLOSITE la meditații (date ca temă sau deschise
// ca sesiune site-first) — nu se dau de două ori (cerința: „teste din site
// care nu s-au dat temă sau nu au fost înregistrate").
async function usedContentIds(supa, userId) {
  const [{ data: hw }, { data: sess }] = await Promise.all([
    supa.from('ai_meditatii_homework').select('content_id').eq('user_id', userId).limit(300),
    supa.from('ai_meditatii_sessions').select('cid:payload->>contentId').eq('user_id', userId).limit(300),
  ]);
  const ids = [];
  (hw || []).forEach((h) => { if (h.content_id) ids.push(h.content_id); });
  (sess || []).forEach((s) => { const cid = s.cid ?? s.payload?.contentId; if (cid) ids.push(cid); });
  return ids;
}

// Bifarea unei sesiuni „din site" (exerciții/simulare deschise ca TEST
// INTERACTIV existent): viewerul trimite scorul imediat după „Corectează" —
// rezultatul intră în sesiuni (predicția notei, rapoarte, „Progresul meu"),
// planul avansează, iar părinții sunt anunțați (cerințele 6–7, runda 5).
async function sessionScore(req, res, supa) {
  const userId = await ai.authUser(req, supa);
  await ai.requireUser(supa, userId);
  const { id, score = 0, maxScore = 0 } = req.body || {};
  if (!id) return res.status(400).json({ error: 'id obligatoriu' });
  const { data: sess } = await supa.from('ai_meditatii_sessions').select('*').eq('id', id).eq('user_id', userId).single();
  if (!sess) return res.status(404).json({ error: 'Sesiunea nu există.' });
  if (!sess.payload?.contentId) return res.status(400).json({ error: 'Doar sesiunile din site se bifează pe această cale.' });

  // scorul vine din browser — validat (0 ≤ scor ≤ maxim plauzibil); recalculul
  // pe server al testelor interactive: Etapa 2 (AUDIT_AGENTI_AI.md, 2.1)
  const { sc, mx } = clampScore(score, maxScore);
  const best = sess.max_score ? Math.max(sess.score || 0, sc) : sc; // păstrăm cel mai bun scor
  const pct = best / mx;
  await supa.from('ai_meditatii_sessions').update({
    status: 'finalizata', score: best, max_score: mx, completed_at: new Date().toISOString(),
  }).eq('id', sess.id);

  const medProfile = await getMedProfile(supa, userId);
  try {
    await supa.rpc('bump_skill_mastery', {
      p_user: userId, p_category: med.categoryFor(medProfile || {}),
      p_topic: nice(sess.topic || sess.payload?.siteTitle || 'general'), p_correct: pct >= 0.6,
    });
  } catch { /* ignorăm */ }

  let chapterDone = false;
  if (medProfile) {
    const streak = med.bumpStreak(medProfile);
    const patch = { streak_days: streak.streak_days, last_study_date: streak.last_study_date };
    const plan = medProfile.plan || {};
    const chapter = (plan.chapters || []).find((c) => c.id === sess.chapter);
    if (chapter && sess.kind === 'exercitii') {
      chapter.mastery = chapter.mastery == null ? pct : Math.round((chapter.mastery * 0.5 + pct * 0.5) * 100) / 100;
      if (pct >= 0.8 && chapter.status !== 'finalizat') {
        chapter.status = 'finalizat';
        chapterDone = true;
        // programăm recapitulările: după 1 zi → 7 → 30
        await supa.from('ai_meditatii_reviews').upsert({
          user_id: userId, chapter: chapter.id, topic: chapter.title,
          stage: 0, due_at: med.nextReviewDue(0), done_at: null,
        }, { onConflict: 'user_id,chapter' });
      }
      patch.plan = plan;
    }
    await supa.from('ai_meditatii_profile').update(patch).eq('user_id', userId);
  }

  const what = sess.kind === 'simulare'
    ? `o simulare de examen (test din site${sess.payload?.siteTitle ? `: „${sess.payload.siteTitle}"` : ''})`
    : `un test din site${sess.topic ? ` la „${nice(sess.topic)}"` : ''}`;
  await notifyParents(supa, userId, `A rezolvat ${what}: ${best}/${mx} (${Math.round(pct * 100)}%).`);
  return res.status(200).json({ ok: true, chapterDone, pct: Math.round(pct * 100) });
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
// COACH — mesajele automate ale profesorului prin widget (cerința: comunicarea
// cu elevul prin widget, cu gpt-4o-mini pentru economie de tokeni; generarea
// de exerciții rămâne pe modelele stabilite: sol / terra / Opus 5).
// event: { type: 'set_done'|'homework_done'|'lesson_done', ... }
// Răspuns: { message, suggestions[] } — widgetul le afișează ca butoane.
// ═════════════════════════════════════════════════════════════════════════════
const COACH_MODEL = process.env.AI_COACH_MODEL || 'gpt-4o-mini';
// slug-urile de subiecte (ex. „raportul_de_asemanare") devin text lizibil în
// mesajele către elev — altfel underscorele se citeau ca indici LaTeX în chat
const nice = (t) => String(t || '').replace(/_/g, ' ').trim();

async function coachBits(supa, userId, medProfile) {
  const [{ data: hw }, { data: reviews }, { data: mistakes }, { data: acc }] = await Promise.all([
    supa.from('ai_meditatii_homework').select('id, title, status').eq('user_id', userId).eq('status', 'data').limit(3),
    supa.from('ai_meditatii_reviews').select('id, chapter, topic, stage, due_at').eq('user_id', userId)
      .lte('due_at', new Date().toISOString()).lte('stage', 2).limit(3),
    supa.from('ai_meditatii_mistakes').select('id, topic').eq('user_id', userId).eq('remediated', false)
      .order('created_at', { ascending: false }).limit(3),
    supa.from('profiles').select('full_name').eq('id', userId).single(),
  ]);
  const plan = medProfile.plan || {};
  const titles = {}; (plan.chapters || []).forEach((c) => { titles[c.id] = c.title; });
  return {
    plan,
    firstName: (acc?.full_name || '').trim().split(/\s+/)[0] || null,
    pendingHw: hw || [],
    dueReviews: (reviews || []).map((r) => ({ ...r, chapterTitle: titles[r.chapter] || nice(r.topic || r.chapter) })),
    openMistakes: mistakes || [],
  };
}

// pașii următori (butoane) — aceeași ordine pedagogică precum briefingul
const EXAM_RO = { 'evaluare-nationala': 'Evaluarea Națională', 'bac-mate-info': 'BAC Mate-Info', 'bac-stiinte': 'BAC Științe', 'bac-tehnologic': 'BAC Tehnologic' };
function coachSuggestions({ plan, dueReviews, pendingHw, openMistakes, medProfile }) {
  const out = [];
  if (dueReviews[0]) out.push({ kind: 'recapitulare', label: `🔁 Recapitulare: ${dueReviews[0].chapterTitle}`, reviewId: dueReviews[0].id, chapterTitle: dueReviews[0].chapterTitle });
  if (openMistakes[0]) out.push({ kind: 'remediere', label: '🩹 10 exerciții ca acela greșit', mistakeId: openMistakes[0].id });
  if (pendingHw[0]) out.push({ kind: 'tema', label: `📚 Tema: ${pendingHw[0].title}`, homeworkId: pendingHw[0].id });
  const next = med.nextChapter(plan, planPriority(medProfile));
  if (next) {
    if (next.status === 'de_parcurs') {
      out.push({ kind: 'lectie', label: `📖 Teoria: ${next.title}`, chapterId: next.id });
      // elevul poate ști deja teoria → sare direct la exerciții (cerința 2, runda 5)
      out.push({ kind: 'exercitii', label: '✍️ Știu teoria — direct la exerciții', chapterId: next.id });
    } else {
      out.push({ kind: 'exercitii', label: `✍️ Exerciții: ${next.title}`, chapterId: next.id });
      out.push({ kind: 'plan', label: '📋 Alege alt capitol' });
    }
  }
  // pregătirea pentru lucrare activă → test de verificare din capitolele ei
  if (medProfile?.focus?.chapter_ids?.length) {
    out.push({ kind: 'simulare', focus: true, label: '🧩 Test de verificare · capitolele lucrării' });
  }
  // elevii cu examen: un TEST INTERACTIV din site (cerința 1, runda 5) —
  // acțiunea „simulare" deschide întâi testele din site, apoi generează
  if (medProfile && (medProfile.exam_target || !next)) {
    const ex = med.examTypeFor(medProfile);
    out.push({ kind: 'simulare', label: `🧩 Test din site · ${EXAM_RO[ex] || 'examen'}` });
  }
  // oricând: încheie sesiunea cu temă pentru acasă (cerința 3, runda 5)
  out.push({ kind: 'end', label: '🏁 Încheie meditația și dă-mi tema' });
  return out;
}

async function coach(req, res, supa) {
  const userId = await ai.authUser(req, supa);
  const profile = await ai.requireUser(supa, userId);
  requireMeditatii(profile);
  const event = req.body?.event || {};
  const medProfile = await getMedProfile(supa, userId);
  if (!medProfile) return res.status(400).json({ error: 'Începe cu testul inițial.' });

  const bits = await coachBits(supa, userId, medProfile);
  let suggestions = coachSuggestions({ ...bits, medProfile });
  // la încheierea meditației nu mai propunem pași noi — doar tema primită
  if (event.type === 'session_end') suggestions = suggestions.filter((s) => s.kind === 'tema');

  // faptele evenimentului (deterministe) — mini-modelul doar le „încălzește"
  const facts = [];
  const pct = event.maxScore ? Math.round(((event.score || 0) / event.maxScore) * 100) : null;
  const kindLabels = { evaluare: 'testul inițial', exercitii: 'setul de exerciții', remediere: 'exercițiile de remediere', recapitulare: 'recapitularea', simulare: 'simularea de examen', tema: 'tema' };
  if (event.type === 'set_done') {
    facts.push(`Elevul tocmai a terminat ${kindLabels[event.kind] || 'un set'}${event.topic ? ` la „${nice(event.topic)}"` : ''} cu scorul ${event.score}/${event.maxScore} (${pct}%).`);
    if (event.chapterDone) facts.push('A FINALIZAT capitolul (≥80%) — felicită-l și amintește-i că recapitularea vine mâine, ca să fixeze.');
    else if (pct != null && pct < 50) facts.push('Scorul e mic — încurajează-l cald, fără reproșuri; propune-i să simplificați și să reia noțiunile de bază.');
    if (event.wrongCount) facts.push(`A greșit ${event.wrongCount} exerciții; îi poți propune remedierea („încă 10 la fel").`);
  } else if (event.type === 'homework_done') {
    if (event.complete === false) {
      // finalizată INCOMPLET (cerință): apreciem ce a lucrat, fără reproșuri,
      // și îi amintim că poate relua tema oricând — restul o așteaptă
      facts.push(`Elevul a finalizat INCOMPLET tema „${event.title || ''}": a rezolvat ${event.answered ?? '?'} din ${event.total ?? '?'} probleme, nota ${event.grade}. Apreciază ce a lucrat, fără reproșuri, și amintește-i blând că poate relua tema oricând din rubrica Teme (problemele rămase îl așteaptă acolo).`);
    } else {
      facts.push(`Elevul a terminat tema „${event.title || ''}" cu nota ${event.grade}.`);
    }
  } else if (event.type === 'lesson_done') {
    facts.push(`Elevul tocmai a citit teoria la „${event.chapterTitle || 'capitolul curent'}" — propune-i să treacă la exerciții.`);
  } else if (event.type === 'session_end') {
    facts.push(event.title
      ? `Elevul încheie meditația de azi și tocmai a primit tema „${event.title}". Încheie cald: spune-i tema pe scurt și că data viitoare reluați de unde ați rămas (sau alege alt capitol, cum preferă).`
      : `Elevul încheie meditația de azi${event.skipped ? ' — are deja teme nefăcute, reamintește-i-le blând' : ''}. Încheie cald și spune-i că data viitoare reluați de unde ați rămas.`);
  } else {
    facts.push('Elevul a revenit la meditații.');
  }
  if (suggestions[0]) facts.push(`PASUL URMĂTOR pe care îl anunți: ${suggestions[0].label.replace(/^[^\s]+\s/, '')}.`);

  const fallback = event.type === 'session_end'
    ? `${bits.firstName ? bits.firstName + ', ' : ''}bravo pentru azi! ${event.title ? `Tema ta: „${event.title}" — o găsești la rubrica Teme. ` : ''}Data viitoare reluăm de unde am rămas. Spor!`
    : `${bits.firstName ? bits.firstName + ', ' : ''}${event.type === 'set_done' && pct != null ? (pct >= 80 ? 'bravo, ai lucrat foarte bine! ' : 'bine că ai lucrat — mai șlefuim împreună. ') : ''}${suggestions[0] ? `Următorul pas pe care ți-l propun: ${suggestions[0].label.replace(/^[^\s]+\s/, '')}.` : 'Continuăm când ești gata.'}`;

  let message = fallback;
  try {
    // Cost bounded: peste limita orară / buget, enforceRateLimit aruncă → prindem
    // mai jos și rămânem pe mesajul determinist. Coach e cosmetic, deci NU blocăm
    // elevul cu 429 — dar nici nu permitem apeluri LLM nelimitate per abonat.
    await ai.enforceRateLimit(supa, userId, profile);
    const { text, usage } = await ai.chat({
      system: `Ești „Profesorul Virtual" de pe ExamenMate — meditatorul personal al unui elev român${bits.firstName ? ` pe nume ${bits.firstName}` : ''}. Scrie-i un mesaj scurt (2–3 fraze, sub 55 de cuvinte), cald și concret, în română, pe baza faptelor de mai jos: apreciezi ce a făcut (concret, nu generic) și anunți natural pasul următor. Notele, scorurile și procentele le redai EXACT cum apar în fapte (cu partea zecimală — „nota 8.33", nu „nota 8"). Fără liste, fără markdown, fără emoji-uri multe (maximum unul).`,
      messages: [{ role: 'user', content: facts.join('\n') }],
      temperature: 0.7, maxTokens: 160, model: COACH_MODEL,
    });
    if (text && text.trim().length > 10) message = text.trim();
    await ai.logUsage(supa, userId, 'ai-meditatii:coach', usage);
  } catch (e) { console.warn('coach LLM:', e.message); }

  return res.status(200).json({ message, suggestions });
}

// reconciliere „la cerere" — apelată de viewerul de exerciții imediat după
// salvarea scorului, ca tema din site să se bifeze PE LOC (cerința 2)
async function homeworkCheck(req, res, supa) {
  const userId = await ai.authUser(req, supa);
  await ai.requireUser(supa, userId);
  await reconcileContentHomework(supa, userId);
  const { data: left } = await supa.from('ai_meditatii_homework')
    .select('id').eq('user_id', userId).eq('status', 'data').limit(5);
  return res.status(200).json({ ok: true, pending: (left || []).length });
}

// ─── BRIEFINGUL PROFESORULUI (inițiativa lui — cerința 10) ───────────────────
// Mesaj de întâmpinare construit determinist din stare (fără LLM = instant):
// continuitate („au trecut X zile"), ce s-a lucrat data trecută, unde a
// greșit, și PAȘII propuși în ordine — elevul poate da „Mai departe".
function buildBriefing({ firstName, medProfile, plan, dueReviews, pendingHw, openMistakes, sessions, focus = null }) {
  const bits = [];
  const suggestions = [];
  const hello = firstName ? `Bun venit, ${firstName}!` : 'Bun venit!';

  // PREGĂTIREA PENTRU LUCRARE/TEST (focus) — profesorul o pune pe primul loc:
  // numără zilele până la data limită și ține recapitularea pe capitolele alese
  if (focus && focus.total) {
    const ce = focus.kind === 'test-initial' ? 'testul inițial' : focus.kind === 'lectii' ? 'testul din lecții' : 'lucrare';
    const timp = focus.deadline
      ? (focus.overdue ? ' (data testului a trecut — o poți încheia din „Planul meu")'
        : focus.daysLeft === 0 ? ' — TESTUL E AZI! Repetăm esențialul, fără panică'
        : ` — mai sunt ${focus.daysLeft} ${focus.daysLeft === 1 ? 'zi' : 'zile'}`)
      : '';
    bits.push(`Ne pregătim pentru ${ce}${timp}: ${focus.done}/${focus.total} capitole recapitulate${focus.perWeek ? ` (ritmul necesar: ~${focus.perWeek} capitole/săptămână)` : ''}.`);
  }

  // continuitatea: câte zile au trecut de la ultima activitate
  const last = medProfile.last_study_date ? new Date(medProfile.last_study_date + 'T00:00:00') : null;
  const days = last ? Math.floor((Date.now() - last.getTime()) / 86400000) : null;
  if (days != null && days >= 2) bits.push(`Au trecut ${days} zile de la ultima noastră meditație — hai să reintrăm în ritm.`);
  else if (medProfile.streak_days >= 3) bits.push(`Ești la a ${medProfile.streak_days}-a zi de studiu la rând — bravo, așa se construiește o notă mare! 🔥`);

  // ce s-a întâmplat data trecută
  const lastDone = (sessions || []).find((s) => s.status === 'finalizata' && s.max_score);
  if (lastDone) {
    const p = Math.round((lastDone.score / lastDone.max_score) * 100);
    const what = nice(lastDone.topic || lastDone.chapter || 'setul de exerciții');
    if (p >= 80) bits.push(`Data trecută te-ai descurcat foarte bine la „${what}" (${p}%).`);
    else bits.push(`Data trecută am lucrat la „${what}" și a mai rămas de șlefuit (${p}%).`);
  }

  // pașii propuși, în ordinea priorității pedagogice
  for (const r of (dueReviews || []).slice(0, 1)) {
    bits.push('Înainte să mergem mai departe, verificăm ce ai învățat — o recapitulare scurtă, să nu se aștearnă praful.');
    suggestions.push({ kind: 'recapitulare', label: `🔁 Recapitulare: ${r.chapterTitle || r.chapter}`, reviewId: r.id, chapterTitle: r.chapterTitle });
  }
  if ((openMistakes || []).length) {
    const m = openMistakes[0];
    bits.push(`Observ că ai greșeli nevindecate${m.topic ? ` la „${nice(m.topic)}"` : ''} — îți propun 10 exerciții de exact același fel, până îl stăpânești.`);
    suggestions.push({ kind: 'remediere', label: '🩹 10 exerciții ca acela greșit', mistakeId: m.id });
  }
  if ((pendingHw || []).length) {
    suggestions.push({ kind: 'tema', label: `📚 Tema: ${pendingHw[0].title}`, homeworkId: pendingHw[0].id });
    bits.push(`Ai și ${pendingHw.length === 1 ? 'o temă care te așteaptă' : pendingHw.length + ' teme care te așteaptă'}.`);
  }
  // pregătirea pe SUBIECTELE examenului (doar Subiectul I / II / I+II)
  const scope = medProfile.memory?.exam_scope || null;
  if (!focus && scope && med.EXAM_SCOPES[scope] && medProfile.exam_target) {
    bits.push(`Ne pregătim țintit: ${med.EXAM_SCOPES[scope]} — planul, simulările și explicațiile țin cont de asta (poți schimba oricând din „Astăzi").`);
  }
  const focusActive = focus && focus.total > 0;
  const next = med.nextChapter(plan, planPriority(medProfile));
  const inFocus = focusActive && next && (medProfile.focus?.chapter_ids || []).includes(next.id);
  if (next) {
    if (next.status === 'de_parcurs') {
      bits.push(`${inFocus ? 'Din capitolele lucrării urmează' : 'În plan urmează'} „${next.title}" — începem cu teoria, apoi exersăm.`);
      suggestions.push({ kind: 'lectie', label: `📖 Teoria: ${next.title}`, chapterId: next.id });
      // sare peste teorie dacă o știe deja (cerința 2, runda 5)
      suggestions.push({ kind: 'exercitii', label: '✍️ Știu teoria — direct la exerciții', chapterId: next.id });
    } else {
      // RELUARE de unde a rămas — sau alt capitol, la alegere (cerința 3, runda 5)
      bits.push(`Reluăm de unde am rămas: „${next.title}" — continuăm exercițiile până îl stăpânești. Dacă preferi, alegem alt capitol din plan.`);
      suggestions.push({ kind: 'exercitii', label: `✍️ Continuă: ${next.title}`, chapterId: next.id });
      suggestions.push({ kind: 'plan', label: '📋 Alege alt capitol' });
    }
  } else {
    bits.push('Ai parcurs tot planul — acum ne antrenăm pentru examen cu simulări.');
    suggestions.push({ kind: 'simulare', label: '🎯 Simulare de examen' });
  }
  // cu pregătire de lucrare activă: un TEST DE VERIFICARE doar din capitolele ei
  if (focusActive) {
    suggestions.push({ kind: 'simulare', focus: true, label: '🧩 Test de verificare · capitolele lucrării' });
  }
  // elevii cu examen au mereu la îndemână un TEST din site (cerința 1, runda 5)
  if (medProfile.exam_target && next) {
    suggestions.push({ kind: 'simulare', label: `🧩 Test din site · ${EXAM_RO[med.examTypeFor(medProfile)] || 'examen'}` });
  }
  // ultimul buton din listă: alegerea unui TEST PDF din site — lista (filtrată
  // pe nivelul elevului) se deschide chiar în chat; kind gestionat de ChatPanel.
  suggestions.push({ kind: 'pdf_site', label: '📄 Alege un test PDF din site' });

  return { message: `${hello} ${bits.join(' ')}`.trim(), suggestions };
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

  const [{ data: hwRaw }, { data: reviews }, { data: sessions }, { data: mastery }, { data: mistakes }] = await Promise.all([
    // `draft` = răspunsurile PROPRII salvate (ciornă / finalizare incompletă) —
    // doar numărul lor ajunge la client („▶ Continuă (3/8)"), nu întrebările
    supa.from('ai_meditatii_homework').select('id, kind, content_id, title, chapter, topic, difficulty, status, score, max_score, attempts, assigned_at, due_at, completed_at, feedback, draft:payload->answers')
      .eq('user_id', userId).order('assigned_at', { ascending: false }).limit(30),
    supa.from('ai_meditatii_reviews').select('id, chapter, topic, stage, due_at, done_at')
      .eq('user_id', userId).order('due_at', { ascending: true }).limit(50),
    supa.from('ai_meditatii_sessions').select('id, kind, chapter, topic, status, score, max_score, duration_sec, created_at, completed_at, site:payload->>contentId, siteTitle:payload->>siteTitle')
      .eq('user_id', userId).order('created_at', { ascending: false }).limit(30),
    supa.from('ai_skill_mastery').select('category, topic, mastery, attempts').eq('user_id', userId),
    supa.from('ai_meditatii_mistakes').select('id, chapter, topic, error_type, statement, remediated, created_at')
      .eq('user_id', userId).eq('remediated', false).order('created_at', { ascending: false }).limit(12),
  ]);

  const now = Date.now();
  const dueReviews = (reviews || []).filter((r) => r.stage <= 2 && new Date(r.due_at).getTime() <= now);
  // starea temelor pentru UI: finalizată / INCOMPLETĂ (citește ambele forme —
  // status „incompleta" sau, fără migrare, feedback.complete=false) + ciorna
  const hw = (hwRaw || []).map(({ draft, ...h }) => ({
    ...h,
    incomplete: med.isHomeworkIncomplete(h),
    draftAnswered: Array.isArray(draft) ? med.answeredCount(draft) : 0,
  }));
  const pendingHw = hw.filter((h) => h.status === 'data');
  const plan = medProfile.plan || {};
  const chapterTitles = {};
  (plan.chapters || []).forEach((c) => { chapterTitles[c.id] = c.title; });

  // predicția notei
  const masteryRows = mastery || [];
  const masteryAvg = masteryRows.length ? masteryRows.reduce((s, m) => s + Number(m.mastery), 0) / masteryRows.length : null;
  // temele FINALIZATE cu scor (complet sau incomplet — problemele nerezolvate
  // contează ca 0, exact ca la o temă predată pe jumătate)
  const hwDone = hw.filter((h) => med.isHomeworkFinal(h) && h.max_score);
  const homeworkAvg = hwDone.length ? hwDone.reduce((s, h) => s + h.score / h.max_score, 0) / hwDone.length : null;
  const sims = (sessions || []).filter((s) => s.kind === 'simulare' && s.status === 'finalizata' && s.max_score);
  const simAvg = sims.length ? sims.reduce((s, x) => s + x.score / x.max_score, 0) / sims.length : null;
  const weakChapters = (plan.chapters || []).filter((c) => c.mastery != null && c.mastery < 0.5).map((c) => c.title);
  const prediction = med.predictGrade({ masteryAvg, homeworkAvg, simAvg, weakChapters });

  // briefingul profesorului (inițiativa lui) — determinist, instant
  const dueWithTitles = dueReviews.map((r) => ({ ...r, chapterTitle: chapterTitles[r.chapter] || r.chapter }));
  let firstName = null;
  try {
    const { data: acc } = await supa.from('profiles').select('full_name').eq('id', userId).single();
    firstName = (acc?.full_name || '').trim().split(/\s+/)[0] || null;
  } catch { /* fără nume */ }
  // pregătirea pentru lucrare/test (focus) + lista de capitole a formularului
  const focus = med.focusInfo(medProfile, plan);
  const briefing = buildBriefing({
    firstName, medProfile, plan, focus,
    dueReviews: dueWithTitles, pendingHw, openMistakes: mistakes || [], sessions: sessions || [],
  });

  return res.status(200).json({
    premium,
    briefing,
    profile: {
      grade: medProfile.grade, examTarget: medProfile.exam_target, level: medProfile.level,
      streakDays: medProfile.streak_days, totalSeconds: medProfile.total_seconds,
      memory: { preferredStyle: medProfile.memory?.styles?.preferred || null },
      assessment: { score: medProfile.assessment?.score ?? null, maxScore: medProfile.assessment?.maxScore ?? null, gaps: medProfile.assessment?.gaps || [] },
    },
    plan: { ...plan, progress: med.planProgress(plan) },
    nextChapter: med.nextChapter(plan, planPriority(medProfile)),
    focus,
    examScope: medProfile.memory?.exam_scope || null,
    focusOptions: med.focusPool(medProfile, plan).map(({ id, title, group }) => ({ id, title, group })),
    dueReviews: dueReviews.map((r) => ({ ...r, chapterTitle: chapterTitles[r.chapter] || r.chapter })),
    homework: hw,
    pendingHomework: pendingHw.length,
    incompleteHomework: hw.filter((h) => h.incomplete).length,
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
  // pregătirea pentru lucrare/test (opțională, aleasă din formularul de înscriere)
  const focus = med.cleanFocus(req.body?.focus);

  const row = {
    user_id: userId, grade, exam_target: examTarget, level: null,
    assessment: {}, plan: {}, memory: {}, focus,
  };
  let { error: upErr } = await supa.from('ai_meditatii_profile').upsert(row, { onConflict: 'user_id' });
  if (upErr && /focus/i.test(upErr.message || '')) {
    // instalare fără coloana `focus` (migrarea meditatii_focus.sql nerulată):
    // înscrierea NU se blochează — doar pregătirea de lucrare rămâne inactivă
    delete row.focus;
    ({ error: upErr } = await supa.from('ai_meditatii_profile').upsert(row, { onConflict: 'user_id' }));
    console.warn('meditatii setup: coloana focus lipsește — rulează supabase/meditatii_focus.sql');
  }
  if (upErr) return res.status(500).json({ error: upErr.message });

  const medProfile = { grade, exam_target: examTarget };
  const chapters = med.curriculumFor(medProfile);
  // cu pregătire pentru lucrare/test: TESTUL INIȚIAL se dă din capitolele alese
  // (planul complet se construiește oricum după corectare)
  const pool = med.focusPool(medProfile, { chapters: [] });
  const focusIds = new Set(focus?.chapter_ids || []);
  let assessChapters = focusIds.size ? pool.filter((c) => focusIds.has(c.id)) : [];
  if (!assessChapters.length && focus?.kind === 'test-initial' && grade > 5) {
    assessChapters = med.CURRICULUM[grade - 1] || [];
  }
  if (!assessChapters.length) assessChapters = chapters;
  const chaptersSpec = assessChapters.map((c) => `- ${c.id}: ${c.title}`).join('\n');
  const category = med.categoryFor(medProfile);

  const { questions, provider, usage } = await med.genQuestions(supa, {
    category, purpose: 'evaluare', count: 12, chaptersSpec,
    topics: assessChapters.slice(0, 6).flatMap((c) => (c.topics || [c.title]).slice(0, 2)),
    styleNote: focus?.custom ? `elevul se pregătește pentru: ${focus.custom.slice(0, 200)}` : null,
  });
  await ai.logUsage(supa, userId, 'ai-meditatii:setup', usage || {});
  if (!questions.length) return res.status(502).json({ error: 'Testul inițial nu a putut fi generat. Mai încearcă o dată.' });

  // fiecare întrebare trebuie să aparțină unui capitol valid (altfel prima potrivire)
  const validIds = new Set(assessChapters.map((c) => c.id));
  questions.forEach((q, i) => { if (!validIds.has(q.chapter)) q.chapter = assessChapters[Math.floor(i / Math.max(1, questions.length / assessChapters.length)) % assessChapters.length].id; });

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
  // titlurile capitolelor din afara programei planului (ex. „test inițial” pe
  // materia anului trecut) vin din pool-ul de focus
  med.focusPool(medProfile0, medProfile0.plan || { chapters: [] }).forEach((c) => { if (!titles[c.id]) titles[c.id] = c.title; });
  const gaps = Object.entries(byChapter)
    .filter(([, v]) => v.total > 0 && v.correct / v.total < 0.5)
    .map(([id, v]) => ({ chapter: id, title: titles[id] || id, correct: v.correct, total: v.total }));

  const level = graded.pct >= 0.75 ? 'avansat' : graded.pct >= 0.45 ? 'mediu' : 'incepator';
  const assessment = { score: graded.correct, maxScore: graded.total, pct: Math.round(graded.pct * 100), gaps, level, at: new Date().toISOString() };
  // TOATĂ teoria din site intră în plan: rubricile „Capitole" de la
  // Evaluare Națională / BAC + capitolele claselor acoperite de plan
  const siteRows = await med.siteChaptersFor(supa, med.siteChapterCategoriesFor(medProfile0));
  let plan = med.buildPlan({ ...medProfile0, level }, assessment, siteRows);
  // pregătirea pentru lucrare/test aleasă la înscriere: capitolele ei intră în
  // plan (inclusiv materia anului trecut / capitolul scris liber) și primesc
  // prioritate prin nextChapter(plan, focus)
  let focusPatch = {};
  if (medProfile0.focus) {
    const applied = med.applyFocus({ profile: medProfile0, plan, focus: medProfile0.focus });
    plan = applied.plan;
    focusPatch = { focus: applied.focus };
  }

  // memoria pedagogică + streak + timp
  const wrong = graded.results.filter((r) => !r.correct);
  const analysis = await med.classifyMistakes(wrong.map((r) => ({
    statement: r.statement, correct: Array.isArray(r.options) ? r.options[r.answer] : r.answer,
    given: Array.isArray(r.options) ? (r.given != null ? r.options[r.given] : null) : r.given, explanation: r.explanation,
  })), { supa, userId });
  const errorTypes = {};
  analysis.forEach((a) => { errorTypes[a.errorType] = (errorTypes[a.errorType] || 0) + 1; });
  analysis.forEach((a) => { const r = wrong[a.index]; if (r) { r.errorType = a.errorType; r.analysis = a.analysis; } });

  const streak = med.bumpStreak(medProfile0);
  await supa.from('ai_meditatii_profile').update({
    level, assessment, plan, ...focusPatch,
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

  // stăpânirea inițială pe subiecte (în paralel) + anunțul pentru părinți
  await bumpMasteryAll(supa, userId, med.categoryFor(medProfile0),
    graded.results.map((r) => ({ ...r, topic: r.topic || titles[r.chapter] })));
  await notifyParents(supa, userId, `A făcut testul inițial la meditații: ${graded.correct}/${graded.total} — nivel ${level}.`);

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
  const lim = await ai.enforceRateLimit(supa, userId, profile); // limite orare + bugete

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
  // capitol venit din rubrica „Capitole" a site-ului → materialul lui e primul
  if (chapter.siteContentId) {
    materials.unshift({
      kind: chapter.siteContentType || 'pdf', title: chapter.title,
      url: chapter.siteContentType === 'interactive' ? `/exercitiu?id=${chapter.siteContentId}` : `/pdf-viewer?id=${chapter.siteContentId}`,
      is_free: true,
    });
  }

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
    temperature: 0.4, maxTokens: 2200,
    model: ai.pickModel(ai.GEN_MODEL, lim), // peste bugetul zilnic → model standard
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

  // 1) SITE-FIRST (cerința 1, runda 5): dacă există un exercițiu interactiv în
  //    site potrivit capitolului, nefolosit încă, îl deschidem pe ACELA.
  //    Generăm doar după epuizare (sau la cerere explicită: forceGenerate).
  if (!req.body?.forceGenerate) {
    const used = await usedContentIds(supa, userId);
    const site = await med.siteInteractiveFor(supa, {
      userId, categories: [med.categoryFor(medProfile), med.classCategory(medProfile)],
      topics: [chapter.title, ...(chapter.topics || [])], limit: 1,
      minMatch: true, excludeIds: used,
    });
    if (site.length) {
      const s = site[0];
      const { data: sess, error: sErr } = await supa.from('ai_meditatii_sessions').insert({
        user_id: userId, kind: 'exercitii', chapter: chapter.id, topic: chapter.title, difficulty,
        status: 'activa', payload: { contentId: s.id, siteTitle: s.title, site: true },
      }).select('id').single();
      if (!sErr && sess) {
        if (chapter.status === 'de_parcurs' || chapter.status === 'teorie') chapter.status = 'in_lucru';
        chapter.sessions = (chapter.sessions || 0) + 1;
        await savePlan(supa, userId, plan);
        return res.status(200).json({
          sessionId: sess.id, chapter: { id: chapter.id, title: chapter.title }, difficulty,
          siteTest: { id: s.id, title: s.title, url: `/exercitiu?id=${s.id}&medSesId=${sess.id}`, is_free: s.is_free },
        });
      }
    }
  }

  // 2) recomandările din site rămase (nefinalizate) — afișate lângă set
  const siteItems = await med.siteInteractiveFor(supa, {
    userId, categories: [med.categoryFor(medProfile), med.classCategory(medProfile)],
    topics: [chapter.title, ...(chapter.topics || [])], limit: 3,
  });

  // 3) setul generat după modelul din site (Claude Opus 5, fallback existent)
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
  })), { supa, userId });
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

  // stăpânirea pe subiecte (în paralel — corectarea era lentă la 10+ itemi)
  await bumpMasteryAll(supa, userId, med.categoryFor(medProfile || {}), graded.results, sess.topic || 'general');

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

  // părinții asociați află că s-a lucrat azi (dedup: o dată pe zi)
  const kindLabels = { exercitii: 'exerciții', remediere: 'exerciții de remediere', recapitulare: 'o recapitulare', simulare: 'o simulare de examen', tema: 'o temă' };
  const setLabel = sess.kind === 'simulare' && (sess.topic === 'lucrare' || sess.payload?.focusTest)
    ? 'un test de verificare pentru lucrare' : (kindLabels[sess.kind] || 'un set');
  await notifyParents(supa, userId, `A rezolvat ${setLabel}${sess.topic && sess.topic !== 'lucrare' ? ` la „${sess.topic}"` : ''}: ${graded.correct}/${graded.total} (${Math.round(graded.pct * 100)}%).`);

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
async function pickAndAssignHomework(supa, userId, medProfile, { notify = true, auto = false } = {}) {
  const plan = medProfile.plan || {};
  // tema urmează prioritatea elevului: capitolele lucrării (focus) sau ale
  // subiectelor alese la pregătirea de examen (exam_scope)
  const chapter = med.nextChapter(plan, planPriority(medProfile)) || (plan.chapters || [])[0] || null;
  const level = medProfile.level || 'mediu';
  const difficulty = level === 'incepator' ? 'ușor' : level === 'avansat' ? 'greu' : 'mediu';
  const dueAt = new Date(Date.now() + 3 * 86400000).toISOString();

  // NU dăm de două ori același material ca temă (indiferent de status) — cerința 8
  const { data: allHw } = await supa.from('ai_meditatii_homework')
    .select('id, status, content_id').eq('user_id', userId).limit(200);
  const pending = (allHw || []).filter((h) => h.status === 'data');
  // O temă neterminată NU blochează alte teme (cerință): la cererea elevului
  // („➕ Dă-mi o temă acum", „🏁 Încheie meditația și dă-mi tema") tema se dă
  // mereu. Doar temele AUTOMATE (cronul, pentru elevii inactivi) se opresc la
  // 2 teme nefăcute — altfel s-ar aduna câte una pe zi la un elev care nu intră.
  if (auto && pending.length >= 2) return { skipped: 'are deja teme nefăcute' };
  const alreadyAssigned = (allHw || []).map((h) => h.content_id).filter(Boolean);

  // 1) ÎNTÂI: un exercițiu interactiv EXISTENT în site, nefinalizat și NEDAT încă
  const site = await med.siteInteractiveFor(supa, {
    userId, categories: [med.categoryFor(medProfile), med.classCategory(medProfile)],
    topics: chapter ? [chapter.title, ...(chapter.topics || [])] : [], limit: 1,
    excludeIds: alreadyAssigned,
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
    const { questions, usage } = await med.genQuestions(supa, {
      category: med.categoryFor(medProfile), chapter: chapter.title,
      topics: chapter.topics || [], difficulty, count: 8,
      purpose: 'tema', styleNote: styleNoteOf(medProfile),
    });
    // generarea temei (on-demand SAU din cron) se contorizează la elev, ca
    // orice altă generare — până acum nu se loga deloc (cost invizibil)
    await ai.logUsage(supa, userId, auto ? 'ai-meditatii:homework:auto' : 'ai-meditatii:homework', usage || {});
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
  return res.status(200).json({ homework: (data || []).map((h) => ({ ...h, incomplete: med.isHomeworkIncomplete(h) })) });
}

async function homeworkStart(req, res, supa) {
  const userId = await ai.authUser(req, supa);
  const profile = await ai.requireUser(supa, userId);
  requireMeditatii(profile);
  const { id } = req.body || {};
  const { data: hw } = await supa.from('ai_meditatii_homework').select('*').eq('id', id).eq('user_id', userId).single();
  if (!hw) return res.status(404).json({ error: 'Tema nu există.' });
  if (hw.kind === 'content') {
    // temaId în URL → viewerul bifează tema DIRECT pe server la salvarea
    // scorului (nu mai depinde de reconcilierea prin tabela progress)
    const base = hw.payload?.url || `/exercitiu?id=${hw.content_id}`;
    const url = `${base}${base.includes('?') ? '&' : '?'}temaId=${hw.id}`;
    return res.status(200).json({ kind: 'content', url, title: hw.title, status: hw.status, incomplete: med.isHomeworkIncomplete(hw) });
  }
  // RELUARE (cerință: „temele pot fi reluate oricând"): răspunsurile salvate
  // — ciorna („Las-o pe mai târziu") sau cele de la o finalizare INCOMPLETĂ —
  // revin în formular, elevul continuă de unde a rămas. O temă finalizată
  // COMPLET se reia de la zero (încercare nouă).
  const questions = hw.payload?.questions || [];
  const completeDone = hw.status === 'rezolvata' && !med.isHomeworkIncomplete(hw);
  const saved = !completeDone && Array.isArray(hw.payload?.answers) ? hw.payload.answers.slice(0, questions.length) : null;
  const answered = saved ? med.answeredCount(saved) : 0;
  return res.status(200).json({
    kind: hw.kind, homeworkId: hw.id, title: hw.title, questions: sanitize(questions),
    answers: answered ? saved : null, answered, total: questions.length,
    status: hw.status, incomplete: med.isHomeworkIncomplete(hw), resumed: answered > 0,
  });
}

// răspunsurile elevului, curățate pentru salvare: index (grilă) sau text scurt;
// gol / spații = fără răspuns (null)
function cleanAnswers(answers, count) {
  return (Array.isArray(answers) ? answers : []).slice(0, count).map((a) => {
    if (a == null) return null;
    if (typeof a === 'number') return Number.isFinite(a) ? a : null;
    const s = String(a).slice(0, 300);
    return s.trim() === '' ? null : s;
  });
}

// Scrie finalizarea unei teme. Fără migrarea `supabase/meditatii_teme_finalizare.sql`
// constrângerea CHECK a coloanei `status` respinge „incompleta" (cod 23514) →
// cădem pe „rezolvata" + feedback.complete=false (UI-ul citește ambele forme).
async function saveHomeworkFinal(supa, id, patch) {
  const { error } = await supa.from('ai_meditatii_homework').update(patch).eq('id', id);
  if (!error) return patch.status;
  const checkViolation = error.code === '23514' || /check constraint/i.test(error.message || '');
  if (patch.status === 'incompleta' && checkViolation) {
    const { error: e2 } = await supa.from('ai_meditatii_homework').update({ ...patch, status: 'rezolvata' }).eq('id', id);
    if (e2) throw new Error(e2.message);
    console.warn('ai_meditatii_homework: statusul „incompleta" nu e acceptat încă — rulează supabase/meditatii_teme_finalizare.sql');
    return 'rezolvata';
  }
  throw new Error(error.message);
}

// „✕ Las-o pe mai târziu": salvează răspunsurile date PÂNĂ ACUM, fără corectare.
// Tema rămâne de rezolvat (statusul nu se schimbă); la reluare, răspunsurile
// revin în formular („▶ Continuă (3/8)").
async function homeworkDraft(req, res, supa) {
  const userId = await ai.authUser(req, supa);
  await ai.requireUser(supa, userId);
  const { id, answers = [] } = req.body || {};
  if (!id) return res.status(400).json({ error: 'id obligatoriu' });
  const { data: hw } = await supa.from('ai_meditatii_homework').select('id, kind, payload').eq('id', id).eq('user_id', userId).single();
  if (!hw) return res.status(404).json({ error: 'Tema nu există.' });
  if (hw.kind === 'content') return res.status(400).json({ error: 'Tema din site nu are ciornă — se rezolvă în pagina exercițiului.' });
  const n = (hw.payload?.questions || []).length;
  const clean = cleanAnswers(answers, n);
  const { error } = await supa.from('ai_meditatii_homework')
    .update({ payload: { ...(hw.payload || {}), answers: clean } }).eq('id', hw.id);
  if (error) return res.status(500).json({ error: error.message });
  return res.status(200).json({ ok: true, answered: med.answeredCount(clean), total: n });
}

// „🏁 Finalizează tema" la o temă DIN SITE (exercițiu interactiv) închisă FĂRĂ
// scor (elevul nu a apăsat „Corectează" / nu a terminat): se înregistrează ca
// temă INCOMPLETĂ — nu mai e „nefăcută", nu blochează alte teme și poate fi
// reluată oricând; un scor ulterior (homework_score / reconciliere) o trece pe
// „rezolvată". Temele din site CU scor sunt deja rezolvate — nimic de schimbat.
async function homeworkFinalize(req, res, supa) {
  const userId = await ai.authUser(req, supa);
  await ai.requireUser(supa, userId);
  const { id } = req.body || {};
  if (!id) return res.status(400).json({ error: 'id obligatoriu' });
  const { data: hw } = await supa.from('ai_meditatii_homework').select('*').eq('id', id).eq('user_id', userId).single();
  if (!hw) return res.status(404).json({ error: 'Tema nu există.' });
  if (hw.kind !== 'content') return res.status(400).json({ error: 'Setul pregătit de profesor se finalizează din pagina temei.' });
  const solved = (row) => row && row.status === 'rezolvata' && row.max_score;
  if (solved(hw)) return res.status(200).json({ ok: true, status: 'rezolvata', complete: true, grade: hw.feedback?.grade ?? null });
  // poate există deja un rezultat în `progress` (scorul s-a salvat, dar bifarea nu)
  await reconcileContentHomework(supa, userId);
  const { data: fresh } = await supa.from('ai_meditatii_homework').select('status, max_score, feedback').eq('id', hw.id).single();
  if (solved(fresh)) return res.status(200).json({ ok: true, status: 'rezolvata', complete: true, grade: fresh.feedback?.grade ?? null });
  const status = await saveHomeworkFinal(supa, hw.id, {
    status: 'incompleta', completed_at: new Date().toISOString(),
    feedback: { ...(hw.feedback || {}), grade: null, complete: false, auto: true, noScore: true },
  });
  await med.clearHomeworkNotifications(supa, userId, hw.id); // nu mai e „nefăcută"
  return res.status(200).json({ ok: true, status, complete: false });
}

// Bifarea DIRECTĂ a unei teme „din site": viewerul de exerciții trimite
// scorul imediat ce elevul apasă „Corectează" — drumul sigur (cerința 1).
async function homeworkScore(req, res, supa) {
  const userId = await ai.authUser(req, supa);
  await ai.requireUser(supa, userId);
  const { id, score = 0, maxScore = 0 } = req.body || {};
  if (!id) return res.status(400).json({ error: 'id obligatoriu' });
  const { data: hw } = await supa.from('ai_meditatii_homework').select('*').eq('id', id).eq('user_id', userId).single();
  if (!hw) return res.status(404).json({ error: 'Tema nu există.' });
  if (hw.kind !== 'content') return res.status(400).json({ error: 'Doar temele din site se bifează pe această cale.' });

  // scorul vine din browser (testul HTML îl calculează singur) — îl validăm
  // (0 ≤ scor ≤ maxim, maxim plauzibil); recalculul pe server al testelor
  // interactive e planificat în Etapa 2 (vezi AUDIT_AGENTI_AI.md, 2.1)
  const { sc, mx } = clampScore(score, maxScore);
  const best = hw.max_score ? Math.max(hw.score || 0, sc) : sc; // păstrăm cel mai bun scor
  const pct = best / mx;
  // nota cu 10 p din oficiu, 2 zecimale; testele „din 100" îl au deja inclus (med.notaTest)
  const grade = med.notaTest(best, mx) ?? 1;
  // un scor din site = temă REZOLVATĂ (și dacă fusese finalizată incomplet)
  await supa.from('ai_meditatii_homework').update({
    status: 'rezolvata', score: best, max_score: mx,
    attempts: (hw.attempts || 0) + 1, completed_at: new Date().toISOString(),
    feedback: { grade, auto: true, complete: true },
  }).eq('id', hw.id);
  await med.clearHomeworkNotifications(supa, userId, hw.id);

  // REZULTATUL SE ÎNREGISTREAZĂ ȘI ÎN `progress` PE SERVER (service role):
  // așa profesorii și părinții îl văd GARANTAT în „Rezultate elevi" / rapoarte,
  // chiar dacă salvarea din browser a eșuat din orice motiv.
  let content = null;
  try {
    const { data: c } = await supa.from('content')
      .select('id, title, category, content_type').eq('id', hw.content_id).single();
    content = c || null;
    const { data: existing } = await supa.from('progress')
      .select('id, score, max_score, attempts, time_spent').eq('user_id', userId).eq('content_id', hw.content_id).maybeSingle();
    const row = {
      user_id: userId, content_id: hw.content_id,
      score: existing ? Math.max(existing.score || 0, sc) : sc, max_score: mx,
      attempts: (existing?.attempts || 0) + 1, completed_at: new Date().toISOString(),
    };
    const snapshot = content ? { test_title: content.title, content_type: content.content_type, category: content.category } : {};
    let { error: pErr } = await supa.from('progress').upsert({ ...row, ...snapshot }, { onConflict: 'user_id,content_id' });
    if (pErr) ({ error: pErr } = await supa.from('progress').upsert(row, { onConflict: 'user_id,content_id' }));
    if (pErr) console.warn('homework_score progress:', pErr.message);
  } catch (e) { console.warn('homework_score progress:', e.message); }

  try {
    await supa.rpc('bump_skill_mastery', {
      p_user: userId, p_category: content?.category || 'general',
      p_topic: (hw.topic || hw.title || 'general').replace(/_/g, ' '), p_correct: pct >= 0.6,
    });
  } catch { /* ignorăm */ }
  const medProfile = await getMedProfile(supa, userId);
  if (medProfile) {
    const streak = med.bumpStreak(medProfile);
    await supa.from('ai_meditatii_profile').update({
      streak_days: streak.streak_days, last_study_date: streak.last_study_date,
    }).eq('user_id', userId);
  }
  await notifyParents(supa, userId, `A rezolvat tema „${hw.title}": ${best}/${mx} — nota ${grade}.`);
  return res.status(200).json({ ok: true, grade, score: best, maxScore: mx });
}

// corectează + notează + explică greșelile + propune exerciții suplimentare.
// FINALIZAREA (cerință): tema se poate încheia și FĂRĂ toate problemele
// rezolvate („🏁 Finalizează tema") — se înregistrează „rezolvata" (toate
// rezolvate) sau „incompleta" (restul rămân NEREZOLVATE: nu li se dezvăluie
// răspunsul și nu intră în jurnalul greșelilor). Răspunsurile date se păstrează
// (payload.answers), ca tema să poată fi RELUATĂ oricând de unde a rămas.
async function homeworkSubmit(req, res, supa) {
  const userId = await ai.authUser(req, supa);
  const profile = await ai.requireUser(supa, userId);
  requireMeditatii(profile);
  const { id, answers = [], durationSec = 0 } = req.body || {};
  const { data: hw } = await supa.from('ai_meditatii_homework').select('*').eq('id', id).eq('user_id', userId).single();
  if (!hw) return res.status(404).json({ error: 'Tema nu există.' });
  if (hw.kind === 'content') return res.status(400).json({ error: 'Tema din site se rezolvă în pagina exercițiului — scorul se preia automat.' });

  const questions = hw.payload?.questions || [];
  const given = cleanAnswers(answers, questions.length);
  const outcome = med.homeworkOutcome(questions, given);
  const graded = gradeAnswers(questions, given);
  // problemele fără răspuns = NEREZOLVATE (nu greșeli): rămân de făcut la
  // reluare, deci nu primesc răspunsul corect / rezolvarea acum
  graded.results.forEach((r) => {
    if (r.given == null || String(r.given).trim() === '') {
      r.skipped = true; r.correct = false; r.answer = null; r.explanation = '';
    }
  });
  const medProfile = await getMedProfile(supa, userId);

  const wrong = graded.results.filter((r) => !r.correct && !r.skipped);
  const analysis = await med.classifyMistakes(wrong.map((r) => ({
    statement: r.statement, correct: Array.isArray(r.options) ? r.options[r.answer] : r.answer,
    given: Array.isArray(r.options) ? (r.given != null ? r.options[r.given] : null) : r.given, explanation: r.explanation,
  })), { supa, userId });
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

  // nota păstrează partea zecimală (2 zecimale) — nu se rotunjește la întreg;
  // la tema incompletă problemele nerezolvate contează 0 (ca o temă predată pe jumătate)
  const grade = Math.max(1, Math.min(10, Math.round((1 + 9 * graded.pct) * 100) / 100));
  const feedback = {
    grade, complete: outcome.complete, answered: outcome.answered, total: outcome.total,
    message: !outcome.complete
      ? `Temă finalizată incomplet: ai rezolvat ${outcome.answered} din ${outcome.total} probleme. O poți relua oricând din rubrica Teme — restul te așteaptă acolo.`
      : graded.pct >= 0.9 ? 'Temă excelentă! Felicitări! 🎉'
      : graded.pct >= 0.7 ? 'Temă bună — mai avem de șlefuit câteva detalii.'
      : graded.pct >= 0.5 ? 'Ai lucrat, dar mai exersăm: uită-te la explicațiile de mai jos.'
      : 'Reluăm împreună noțiunile de bază — nu-i nimic, de aici se învață!',
  };
  const status = await saveHomeworkFinal(supa, id, {
    status: outcome.status, score: graded.correct, max_score: graded.total,
    attempts: (hw.attempts || 0) + 1, completed_at: new Date().toISOString(), feedback,
    payload: { ...(hw.payload || {}), answers: given },   // pentru reluare
  });

  // stăpânirea se actualizează doar din problemele efectiv rezolvate
  await bumpMasteryAll(supa, userId, med.categoryFor(medProfile || {}), graded.results.filter((r) => !r.skipped), hw.topic || 'general');
  await med.clearHomeworkNotifications(supa, userId, hw.id); // „temă nefăcută" dispare din clopoțel
  const streak = med.bumpStreak(medProfile || {});
  await supa.from('ai_meditatii_profile').update({
    streak_days: streak.streak_days, last_study_date: streak.last_study_date,
    total_seconds: (medProfile?.total_seconds || 0) + Math.max(0, parseInt(durationSec, 10) || 0),
  }).eq('user_id', userId);
  await notifyParents(supa, userId, outcome.complete
    ? `A rezolvat tema „${hw.title}": ${graded.correct}/${graded.total} — nota ${grade}.`
    : `A finalizat incomplet tema „${hw.title}" (${outcome.answered}/${outcome.total} probleme rezolvate): ${graded.correct}/${graded.total} — nota ${grade}. O poate relua oricând.`);

  return res.status(200).json({
    score: graded.correct, maxScore: graded.total, pct: Math.round(graded.pct * 100),
    grade, feedback: feedback.message, results: graded.results, mistakeIds,
    complete: outcome.complete, answered: outcome.answered, total: outcome.total, status,
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

  // ── TEST DE VERIFICARE din capitolele PREGĂTIRII PENTRU LUCRARE (focus) ────
  // (nu simulare de examen): întrebările vin DOAR din capitolele alese de elev;
  // site-first pe materialele care se potrivesc capitolelor, apoi generare.
  const focus = medProfile.focus;
  if (req.body?.focus && focus?.chapter_ids?.length) {
    const fInfo = med.focusInfo(medProfile, medProfile.plan || {});
    const fTopics = (fInfo?.chapters || []).map((c) => c.title).slice(0, 24);
    const classCat = med.classCategory(medProfile);
    if (!req.body?.forceGenerate) {
      const used = await usedContentIds(supa, userId);
      const site = await med.siteInteractiveFor(supa, {
        userId, categories: [classCat, med.categoryFor(medProfile)],
        topics: fTopics, limit: 1, minMatch: true, excludeIds: used,
      });
      if (site.length) {
        const s = site[0];
        const { data: sess, error: sErr } = await supa.from('ai_meditatii_sessions').insert({
          user_id: userId, kind: 'simulare', topic: 'lucrare', status: 'activa',
          payload: { contentId: s.id, siteTitle: s.title, focusTest: true, site: true },
        }).select('id').single();
        if (!sErr && sess) {
          return res.status(200).json({
            sessionId: sess.id, examType: 'lucrare', focusTest: true,
            siteTest: { id: s.id, title: s.title, url: `/exercitiu?id=${s.id}&medSesId=${sess.id}`, is_free: s.is_free },
          });
        }
      }
    }
    // punctele slabe DIN capitolele lucrării intră obligatoriu în test
    const { data: weakF } = await supa.from('ai_skill_mastery')
      .select('topic, mastery').eq('user_id', userId).lt('mastery', 0.6)
      .order('mastery', { ascending: true }).limit(6);
    const weakLine = (weakF || []).map((w) => w.topic).filter(Boolean).slice(0, 4).join(', ');
    const { questions, provider, usage } = await med.genQuestions(supa, {
      category: classCat, chapter: 'Lucrare de verificare',
      topics: fTopics, difficulty: 'mediu', count: 10, purpose: 'simulare',
      styleNote: [
        `test de verificare (lucrare la clasă) STRICT din capitolele: ${fTopics.join('; ')} — nicio întrebare din alte capitole`,
        focus.custom ? `indicațiile elevului: ${focus.custom.slice(0, 300)}` : '',
        weakLine ? `dacă se potrivesc capitolelor, include itemi din punctele slabe: ${weakLine}` : '',
        styleNoteOf(medProfile),
      ].filter(Boolean).join('; '),
    });
    await ai.logUsage(supa, userId, 'ai-meditatii:simulare', usage || {});
    if (!questions.length) return res.status(502).json({ error: 'Testul de verificare nu a putut fi generat. Mai încearcă o dată.' });
    const { data: sess, error } = await supa.from('ai_meditatii_sessions').insert({
      user_id: userId, kind: 'simulare', topic: 'lucrare', status: 'activa',
      payload: { questions, provider, focusTest: true },
    }).select('id').single();
    if (error) return res.status(500).json({ error: error.message });
    return res.status(200).json({ sessionId: sess.id, examType: 'lucrare', focusTest: true, questions: sanitize(questions) });
  }

  const examType = ['evaluare-nationala', 'bac-mate-info', 'bac-stiinte', 'bac-tehnologic'].includes(req.body?.examType)
    ? req.body.examType : med.examTypeFor(medProfile);
  const isEN = examType === 'evaluare-nationala';
  const category = isEN ? 'evaluare-nationala' : 'bacalaureat';

  // Elevul a ALES un anumit test din baza de date a site-ului (rubrica
  // Simulări → „Alege din baza de date a site-ului"): îl deschidem exact pe
  // acela, înregistrat ca sesiune de simulare — rezultatul intră în plan,
  // predicția notei și rapoartele mentorilor, ca la site-first.
  if (req.body?.contentId) {
    const { data: chosen } = await supa.from('content')
      .select('id, title, is_free, content_type')
      .eq('id', req.body.contentId).eq('content_type', 'interactive').single();
    if (!chosen) return res.status(404).json({ error: 'Testul ales nu mai există în baza de date a site-ului.' });
    const { data: sess, error: sErr } = await supa.from('ai_meditatii_sessions').insert({
      user_id: userId, kind: 'simulare', topic: examType, status: 'activa',
      payload: { contentId: chosen.id, siteTitle: chosen.title, examType, site: true },
    }).select('id').single();
    if (sErr) return res.status(500).json({ error: sErr.message });
    return res.status(200).json({
      sessionId: sess.id, examType,
      siteTest: { id: chosen.id, title: chosen.title, url: `/exercitiu?id=${chosen.id}&medSesId=${sess.id}`, is_free: chosen.is_free },
    });
  }

  // SITE-FIRST (cerința 1, runda 5): întâi TESTELE din site din categoria
  // examenului, care nu s-au dat ca temă și nu au fost înregistrate.
  // Generăm după modelul din site DOAR după epuizare (sau forceGenerate).
  if (!req.body?.forceGenerate) {
    const used = await usedContentIds(supa, userId);
    const site = await med.siteInteractiveFor(supa, {
      userId, categories: [category], topics: [], limit: 1, excludeIds: used,
    });
    if (site.length) {
      const s = site[0];
      const { data: sess, error: sErr } = await supa.from('ai_meditatii_sessions').insert({
        user_id: userId, kind: 'simulare', topic: examType, status: 'activa',
        payload: { contentId: s.id, siteTitle: s.title, examType, site: true },
      }).select('id').single();
      if (!sErr && sess) {
        return res.status(200).json({
          sessionId: sess.id, examType,
          siteTest: { id: s.id, title: s.title, url: `/exercitiu?id=${s.id}&medSesId=${sess.id}`, is_free: s.is_free },
        });
      }
    }
  }

  // punctele slabe intră în test (teste personalizate după punctele slabe)
  const { data: weak } = await supa.from('ai_skill_mastery')
    .select('topic, mastery').eq('user_id', userId).lt('mastery', 0.6)
    .order('mastery', { ascending: true }).limit(4);
  const weakLine = (weak || []).map((w) => w.topic).filter(Boolean).join(', ');

  // pregătirea pe SUBIECTELE alese (doar Subiectul I / II / I+II): simularea
  // conține DOAR itemii subiectelor alese (nota de conținut din examScopeNote)
  const scope = medProfile.memory?.exam_scope || null;
  const scopeNote = scope ? med.examScopeNote(medProfile.exam_target, scope) : null;
  const structura = scopeNote
    ? `TOATE întrebările acoperă ${scopeNote} — nu include itemi din alte subiecte ale examenului`
    : (isEN
      ? 'structura: primele 6 întrebări de algebră (stil Subiectul I), următoarele 6 de geometrie (stil Subiectul al II-lea), toate grilă cu 4 variante'
      : 'itemi reprezentativi pentru toate cele trei subiecte ale probei, de la accesibil la dificil');
  const { questions, provider, usage } = await med.genQuestions(supa, {
    category, chapter: isEN ? 'Simulare Evaluare Națională' : `Simulare Bacalaureat (${examType.replace('bac-', '')})`,
    topics: [], difficulty: 'mediu', count: isEN ? 12 : 9,
    purpose: 'simulare',
    styleNote: [
      structura,
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

// ─── PREGĂTIREA PE SUBIECTELE EXAMENULUI: doar Subiectul I / II / I+II ───────
// Body: { scope: 's1' | 's2' | 's1s2' | null }  (null/'toate' = tot examenul)
// Se ține în memory.exam_scope (fără migrare SQL). Meditatorul adaptează:
// planul (capitolele subiectelor alese au prioritate), simulările (doar
// itemii subiectelor alese) și chatul (nota intră în context).
async function setExamScope(req, res, supa) {
  const userId = await ai.authUser(req, supa);
  const profile = await ai.requireUser(supa, userId);
  requireMeditatii(profile);
  const medProfile = await getMedProfile(supa, userId);
  if (!medProfile) return res.status(400).json({ error: 'Începe cu testul inițial.' });
  if (!medProfile.exam_target) return res.status(400).json({ error: 'Alegerea subiectelor e pentru pregătirea de examen (Evaluarea Națională / BAC).' });
  const raw = String(req.body?.scope || '').trim();
  const scope = med.EXAM_SCOPES[raw] ? raw : null; // orice altceva = tot examenul
  const memory = { ...(medProfile.memory || {}), exam_scope: scope };
  await saveMemory(supa, userId, memory);
  return res.status(200).json({ ok: true, examScope: scope, label: scope ? med.EXAM_SCOPES[scope] : 'tot examenul' });
}

// ─── PREGĂTIREA PENTRU LUCRARE/TEST (focus) — setare/renunțare oricând ───────
// Body: { kind: 'lucrare'|'lectii'|'test-initial'|'examen'|null,
//         chapterIds: [..], custom, deadline: 'YYYY-MM-DD' }
// kind='examen' sau null → focusul se ȘTERGE (examenul final = toată materia,
// ca până acum). Capitolele alese care nu sunt în plan (materia anului trecut,
// capitolul scris liber) se ADAUGĂ în plan; nu se șterge nimic din plan.
async function setFocus(req, res, supa) {
  const userId = await ai.authUser(req, supa);
  const profile = await ai.requireUser(supa, userId);
  requireMeditatii(profile);
  const medProfile = await getMedProfile(supa, userId);
  if (!medProfile) return res.status(400).json({ error: 'Începe cu testul inițial.' });
  if (!('focus' in medProfile)) {
    return res.status(400).json({ error: 'Pregătirea pentru lucrări cere o mică actualizare a bazei de date: rulează supabase/meditatii_focus.sql în Supabase → SQL Editor (o singură dată).' });
  }

  const cleaned = med.cleanFocus(req.body || {});
  if (!cleaned) {
    // renunțare / examen final → fără focus (planul întreg rămâne neatins)
    const { error } = await supa.from('ai_meditatii_profile').update({ focus: null }).eq('user_id', userId);
    if (error) return res.status(500).json({ error: error.message });
    return res.status(200).json({ ok: true, focus: null });
  }

  const plan0 = medProfile.plan || { chapters: [] };
  const { plan, focus } = med.applyFocus({ profile: medProfile, plan: plan0, focus: cleaned });
  if (!focus.chapter_ids.length && focus.kind !== 'lucrare') {
    return res.status(400).json({ error: 'Alege cel puțin un capitol din listă sau scrie capitolul în câmpul liber.' });
  }
  const { error } = await supa.from('ai_meditatii_profile').update({ plan, focus }).eq('user_id', userId);
  if (error) return res.status(500).json({ error: error.message });
  return res.status(200).json({
    ok: true,
    focus: med.focusInfo({ ...medProfile, focus }, plan),
    plan: { ...plan, progress: med.planProgress(plan) },
  });
}

// resetul profilului (reia evaluarea de la zero) — șterge TOT ce ține de
// meditații: plan, teme, sesiuni, greșeli, recapitulări + stinge notificările
// (altfel temele vechi rămâneau „nefăcute" după reset — cauza erorii raportate)
async function resetProfile(req, res, supa) {
  const userId = await ai.authUser(req, supa);
  const profile = await ai.requireUser(supa, userId);
  requireMeditatii(profile);
  await Promise.allSettled([
    supa.from('ai_meditatii_homework').delete().eq('user_id', userId),
    supa.from('ai_meditatii_sessions').delete().eq('user_id', userId),
    supa.from('ai_meditatii_mistakes').delete().eq('user_id', userId),
    supa.from('ai_meditatii_reviews').delete().eq('user_id', userId),
  ]);
  await supa.from('ai_meditatii_profile').delete().eq('user_id', userId);
  try {
    await supa.from('ai_notifications').update({ read: true })
      .eq('recipient_id', userId)
      .in('type', ['meditatii_homework', 'meditatii_review']);
  } catch { /* best-effort */ }
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

  // 2) teme restante (trecute de termen) → reamintire (dedup 2 zile).
  //    ÎNTÂI reconciliem temele „din site" cu tabela progress — altfel elevul
  //    care A REZOLVAT exercițiul primea în continuare „ai o temă nefăcută".
  const { data: lateRaw } = await supa.from('ai_meditatii_homework')
    .select('id, user_id, title, kind').eq('status', 'data').lte('due_at', nowIso).limit(300);
  const lateUsers = [...new Set((lateRaw || []).filter((h) => h.kind === 'content').map((h) => h.user_id))];
  await Promise.allSettled(lateUsers.slice(0, 150).map((uid) => med.reconcileContentHomework(supa, uid)));
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
      const r = await pickAndAssignHomework(supa, p.user_id, p, { notify: true, auto: true });
      if (r.assigned) out.homeworkAssigned++;
    } catch (e) { console.warn('cron homework:', e.message); }
  }

  return out;
}

// exportat pentru teste
module.exports.clampScore = clampScore;
