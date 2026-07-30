// =====================================================================
// api/_lib/inactivity.js — politica de conturi inactive (regulile pure)
//
// Regula: după 12 luni fără autentificare, contul primește un email de
// avertizare: „autentifică-te în 30 de zile, altfel contul se șterge".
// Cu 7 zile înainte de termen se trimite o ultimă reamintire. La expirare
// contul este șters, dar rezultatele elevului rămân arhivate la mentorii
// lui (profesor/părinte), care le pot șterge definitiv din dashboard.
//
// Orice autentificare (ping-ul din AuthContext actualizează last_active_at
// și golește deletion_*) anulează ștergerea programată.
//
// Excepții (nu se șterg niciodată automat): admin, abonații premium activi.
//
// Fișierul separă LOGICA (predicate pure, testate în test/inactivity.test.js)
// de EXECUȚIE (api/account-cleanup.js — interogări, emailuri, ștergeri).
// =====================================================================
const mailer = require('./mailer');
// citire paginată (PostgREST întoarce max 1000 de rânduri per cerere) — arhiva
// unui elev foarte activ NU trebuie trunchiată tăcut înainte de ștergerea contului
const { allRows, inBatches } = require('./http');

// ── Constante (zile) ─────────────────────────────────────────────────────────
const INACTIVITY_DAYS = 365;   // 12 luni fără autentificare → avertizare
const GRACE_DAYS = 30;         // termenul din emailul de avertizare
const REMIND_BEFORE_DAYS = 7;  // ultima reamintire, cu 7 zile înainte
const MIN_WARN_AGE_DAYS = 29;  // siguranță: nu ștergem la mai puțin de 29 de
                               // zile de la avertizare, orice ar zice datele
const DAY_MS = 86400 * 1000;

// Loturi per rulare zilnică (menajăm limita Gmail ~500 emailuri/zi)
const WARN_BATCH = 80;
const REMIND_BATCH = 80;
const DELETE_BATCH = 40;

const SITE = 'https://examenmate.com';

// ── Date utilitare ───────────────────────────────────────────────────────────
function inactivityCutoff(now = new Date()) {
  return new Date(now.getTime() - INACTIVITY_DAYS * DAY_MS);
}
function deletionDate(now = new Date()) {
  return new Date(now.getTime() + GRACE_DAYS * DAY_MS);
}
function fmtDateRo(d) {
  try {
    return new Date(d).toLocaleDateString('ro-RO', {
      day: 'numeric', month: 'long', year: 'numeric', timeZone: 'Europe/Bucharest',
    });
  } catch { return String(d).slice(0, 10); }
}

// ── Predicate pure (primesc rândul de profil, întorc true/false) ─────────────
// Conturi care nu se șterg NICIODATĂ automat.
function isProtected(p) {
  return !!p && (p.is_admin === true || p.subscription_status === 'active');
}

// Eligibil pentru emailul de avertizare (12 luni de inactivitate).
function eligibleForWarning(p, now = new Date()) {
  if (!p || !p.email || isProtected(p)) return false;
  if (p.deletion_scheduled_at) return false;      // deja avertizat
  if (!p.last_active_at) return false;            // fără date → nu riscăm
  return new Date(p.last_active_at) < inactivityCutoff(now);
}

// S-a autentificat după avertizare → ștergerea se anulează.
function shouldReactivate(p) {
  if (!p || !p.deletion_scheduled_at) return false;
  if (!p.deletion_warned_at) return true;         // stare inconsistentă → nu ștergem
  if (!p.last_active_at) return false;
  return new Date(p.last_active_at) > new Date(p.deletion_warned_at);
}

// Trebuie trimisă reamintirea de 7 zile.
function dueForReminder(p, now = new Date()) {
  if (!p || !p.email || !p.deletion_scheduled_at || p.deletion_reminded_at) return false;
  if (isProtected(p) || shouldReactivate(p)) return false;
  const sched = new Date(p.deletion_scheduled_at);
  return sched > now && sched.getTime() - now.getTime() <= REMIND_BEFORE_DAYS * DAY_MS;
}

// Termenul a expirat → contul poate fi șters.
function dueForDeletion(p, now = new Date()) {
  if (!p || !p.deletion_scheduled_at || !p.deletion_warned_at) return false;
  if (isProtected(p) || shouldReactivate(p)) return false;
  if (new Date(p.deletion_scheduled_at) > now) return false;
  return now.getTime() - new Date(p.deletion_warned_at).getTime() >= MIN_WARN_AGE_DAYS * DAY_MS;
}

// ── Emailuri ─────────────────────────────────────────────────────────────────
function firstName(p) {
  const n = String(p?.full_name || '').trim().split(/\s+/)[0];
  return n ? ', ' + mailer.escapeHtml(n) : '';
}
function loginButton(label = 'Autentifică-te și păstrează-ți contul') {
  return `<p style="margin:20px 0 6px"><a href="${SITE}/login" style="display:inline-block;background:#17233f;color:#fff;padding:12px 22px;border-radius:8px;text-decoration:none;font-weight:700">${label}</a></p>`;
}
function studentNote(p) {
  if (p?.role !== 'elev') return '';
  return `<p style="margin:12px 0;color:#5a6379;font-size:13.5px">Notă: dacă ești asociat unui profesor sau părinte pe ExamenMate, rezultatele tale la teste rămân vizibile în contul acestuia și după ștergere.</p>`;
}

// Emailul 1 — avertizare la 12 luni de inactivitate.
function buildWarningEmail(p, scheduledAt) {
  const date = fmtDateRo(scheduledAt);
  const subject = `Contul tău ExamenMate va fi șters pe ${date} (inactivitate)`;
  const html = mailer.template({
    title: 'Contul tău va fi șters în 30 de zile',
    preheader: `Autentifică-te până pe ${date} ca să-ți păstrezi contul.`,
    bodyHtml: `
      <p>Salut${firstName(p)}!</p>
      <p>Nu te-ai mai autentificat pe <strong>ExamenMate</strong> de peste 12 luni.
         Conform politicii noastre de păstrare a datelor, contul tău
         (<strong>${mailer.escapeHtml(p.email || '')}</strong>) și toate datele asociate
         vor fi <strong>șterse definitiv pe ${date}</strong>.</p>
      <p>Ca să-ți păstrezi contul, e suficient să te <strong>autentifici o singură dată</strong>
         până la această dată — nu trebuie să faci nimic altceva, ștergerea se anulează automat.</p>
      ${loginButton()}
      ${studentNote(p)}`,
    footerNote: 'Primești acest email fiindcă ai un cont pe ExamenMate. Dacă vrei ștergerea imediată a contului, o poți face din Contul meu → Setări după autentificare.',
  });
  return { subject, html };
}

// Emailul 2 — ultima reamintire, cu ~7 zile înainte de termen.
function buildReminderEmail(p, scheduledAt, now = new Date()) {
  const date = fmtDateRo(scheduledAt);
  const daysLeft = Math.max(1, Math.ceil((new Date(scheduledAt).getTime() - now.getTime()) / DAY_MS));
  const zile = daysLeft === 1 ? 'o zi' : `${daysLeft} zile`;
  const subject = `Ultima reamintire: contul tău ExamenMate se șterge în ${zile}`;
  const html = mailer.template({
    title: `Mai ai ${zile} ca să-ți păstrezi contul`,
    preheader: `Pe ${date} contul se șterge definitiv. O simplă autentificare îl salvează.`,
    bodyHtml: `
      <p>Salut${firstName(p)}!</p>
      <p>Ți-am scris acum câteva săptămâni: contul tău <strong>ExamenMate</strong>
         (<strong>${mailer.escapeHtml(p.email || '')}</strong>) este programat pentru
         <strong>ștergere definitivă pe ${date}</strong>, din cauza inactivității de peste 12 luni.</p>
      <p>După această dată, contul și datele lui nu mai pot fi recuperate.
         O simplă <strong>autentificare</strong> anulează ștergerea.</p>
      ${loginButton('Autentifică-te acum')}
      ${studentNote(p)}`,
    footerNote: 'Acesta este ultimul mesaj pe care ți-l trimitem despre acest cont.',
  });
  return { subject, html };
}

// Rezumat pentru admin după o rulare cu acțiuni.
function buildAdminSummaryEmail(stats) {
  const row = (label, val) =>
    `<tr><td style="padding:8px 12px;border-bottom:1px solid #eef1f6;color:#5a6379">${label}</td><td style="padding:8px 12px;border-bottom:1px solid #eef1f6;text-align:right;font-weight:700;color:#17233f">${val}</td></tr>`;
  const subject = `🧹 Conturi inactive azi: ${stats.warned} avertizate, ${stats.deleted} șterse`;
  const html = mailer.template({
    title: 'Curățarea conturilor inactive — rezumat',
    bodyHtml: `
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border:1px solid #eef1f6;border-radius:10px;border-collapse:separate;overflow:hidden">
        ${row('Conturi reactivate (autentificare după avertizare)', stats.reactivated)}
        ${row('Avertizări trimise (12 luni inactivitate)', stats.warned)}
        ${row('Avertizări eșuate (se reîncearcă mâine)', stats.warnFailed)}
        ${row('Reamintiri trimise (7 zile înainte)', stats.reminded)}
        ${row('Conturi șterse (termen expirat)', stats.deleted)}
        ${row('Arhive create pentru mentori', stats.archivedFor)}
        ${row('Ștergeri eșuate (se reîncearcă mâine)', stats.deleteFailed)}
      </table>
      <p style="margin-top:14px"><a href="${SITE}/admin" style="color:#1d4ed8">Deschide panoul de admin →</a></p>`,
  });
  return { subject, html };
}

// ── Arhivarea datelor elevului la mentori (înainte de ștergere) ──────────────
// Construiește snapshotul cu tot ce vedea mentorul în dashboard.
async function buildSnapshot(supa, userId) {
  const snap = { results: [], aiOnly: [], mastery: [], assignments: [], stats: {} };

  // 1) Rezultatele la teste (progress) + titlurile materialelor — PAGINAT
  let prog = [];
  try {
    prog = await allRows((from, to) => supa.from('progress').select('*')
      .eq('user_id', userId).order('completed_at', { ascending: false }).range(from, to));
  } catch { /* tabelul poate lipsi */ }

  // 2) Întrebările puse Profesorului Virtual, per material
  const aiQ = {}; // contentId -> nr. întrebări
  try {
    const convs = await allRows((from, to) => supa.from('ai_conversations')
      .select('id, context').eq('user_id', userId).range(from, to));
    const convKey = {};
    convs.forEach((c) => {
      const cid = c.context && (c.context.contentId || c.context.content_id);
      if (cid) convKey[c.id] = String(cid);
    });
    const convIds = Object.keys(convKey);
    const msgs = await inBatches(convIds, (chunk, from, to) => supa.from('ai_messages')
      .select('conversation_id').eq('role', 'user').in('conversation_id', chunk)
      .range(from, to), { batchSize: 150 });
    msgs.forEach((m) => {
      const cid = convKey[m.conversation_id];
      if (cid) aiQ[cid] = (aiQ[cid] || 0) + 1;
    });
  } catch { /* raportul merge și fără datele AI */ }

  // 3) Titlurile materialelor (din progres + din conversațiile AI)
  const contentIds = [...new Set([...prog.map((p) => p.content_id), ...Object.keys(aiQ)])].filter(Boolean);
  const contentMap = {};
  if (contentIds.length) {
    try {
      const content = await inBatches(contentIds, (chunk, from, to) => supa.from('content')
        .select('id, title, content_type, category').in('id', chunk).range(from, to));
      content.forEach((c) => { contentMap[c.id] = c; });
    } catch { /* ignore */ }
  }

  // Rândurile de rezultate — EXACT în forma folosită de dashboardul mentorului
  snap.results = prog.map((p) => {
    const c = contentMap[p.content_id] || {};
    return {
      content_id: p.content_id,
      // materialul poate fi șters — titlul rămâne din snapshotul salvat în rezultat
      test_title: c.title || p.test_title || 'Test (material șters)',
      content_type: c.content_type || p.content_type || 'interactive',
      category: c.category || p.category || '',
      score: p.score,
      max_score: p.max_score,
      attempts: p.attempts != null ? p.attempts : 1,
      time_spent: p.time_spent != null ? p.time_spent : 0,
      completed_at: p.completed_at,
      ai_questions: aiQ[String(p.content_id)] || 0,
    };
  });

  // Materiale cu întrebări AI dar fără punctaj
  const covered = new Set(prog.map((p) => String(p.content_id)));
  snap.aiOnly = Object.keys(aiQ)
    .filter((cid) => !covered.has(cid) && contentMap[cid])
    .map((cid) => ({
      content_id: cid,
      test_title: contentMap[cid].title || 'Material',
      content_type: contentMap[cid].content_type || '',
      ai_questions: aiQ[cid],
    }));

  // 4) Stăpânirea subiectelor (AI)
  try {
    const { data } = await supa.from('ai_skill_mastery')
      .select('category, topic, mastery, attempts, correct, last_interaction')
      .eq('user_id', userId).order('mastery', { ascending: false });
    snap.mastery = data || [];
  } catch { /* ignore */ }

  // 5) Temele primite de la mentori (rezultatele lor)
  try {
    const { data: ar } = await supa.from('ai_assignment_results')
      .select('assignment_id, score, max_score, attempts, completed_at')
      .eq('student_id', userId);
    const aIds = [...new Set((ar || []).map((r) => r.assignment_id))].filter(Boolean);
    const aMap = {};
    if (aIds.length) {
      const { data: as } = await supa.from('ai_assignments')
        .select('id, title, kind').in('id', aIds);
      (as || []).forEach((a) => { aMap[a.id] = a; });
    }
    snap.assignments = (ar || []).map((r) => ({
      title: (aMap[r.assignment_id] && aMap[r.assignment_id].title) || 'Temă',
      kind: (aMap[r.assignment_id] && aMap[r.assignment_id].kind) || null,
      score: r.score, max_score: r.max_score,
      attempts: r.attempts, completed_at: r.completed_at,
    }));
  } catch { /* ignore */ }

  // 6) Statistici agregate
  const pct = (s, m) => (m ? Math.round((s / m) * 100) : 0);
  snap.stats = {
    count: snap.results.length,
    avg: snap.results.length
      ? Math.round(snap.results.reduce((a, r) => a + pct(r.score, r.max_score), 0) / snap.results.length)
      : null,
    attemptsTotal: snap.results.reduce((a, r) => a + (r.attempts || 0), 0),
    timeTotal: snap.results.reduce((a, r) => a + (r.time_spent || 0), 0),
    aiQuestionsTotal: Object.values(aiQ).reduce((a, n) => a + n, 0),
  };
  return snap;
}

// Arhivează datele elevului la TOȚI mentorii lui (profesori + părinți).
// Întoarce numărul de arhive create/actualizate. Aruncă doar la erori de scriere.
async function archiveStudentData(supa, profile, reason = 'inactivity') {
  const userId = profile.id;
  let mentorIds = [];
  try {
    const { data } = await supa.from('mentor_students')
      .select('mentor_id').eq('student_id', userId);
    mentorIds = [...new Set((data || []).map((l) => l.mentor_id))];
  } catch { return 0; } // fără sistemul de mentori → nimic de arhivat
  if (!mentorIds.length) return 0;

  const snap = await buildSnapshot(supa, userId);
  const nowIso = new Date().toISOString();
  const rows = mentorIds.map((mId) => ({
    mentor_id: mId,
    student_id: userId,
    student_name: profile.full_name || null,
    student_email: profile.email || null,
    student_role: profile.role || null,
    reason,
    results: snap.results,
    extras: { stats: snap.stats, mastery: snap.mastery, aiOnly: snap.aiOnly, assignments: snap.assignments },
    deleted_at: nowIso,
  }));
  const { error } = await supa.from('archived_student_results')
    .upsert(rows, { onConflict: 'mentor_id,student_id' });
  if (error) throw new Error('Arhivarea rezultatelor a eșuat: ' + error.message);
  return rows.length;
}

module.exports = {
  INACTIVITY_DAYS, GRACE_DAYS, REMIND_BEFORE_DAYS, MIN_WARN_AGE_DAYS, DAY_MS,
  WARN_BATCH, REMIND_BATCH, DELETE_BATCH, SITE,
  inactivityCutoff, deletionDate, fmtDateRo,
  isProtected, eligibleForWarning, shouldReactivate, dueForReminder, dueForDeletion,
  buildWarningEmail, buildReminderEmail, buildAdminSummaryEmail,
  buildSnapshot, archiveStudentData,
};
