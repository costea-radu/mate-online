// Teste pentru regulile politicii de conturi inactive (api/_lib/inactivity.js)
// Rulează: node --test test/inactivity.test.js
const test = require('node:test');
const assert = require('node:assert');
const inact = require('../api/_lib/inactivity');

const DAY = inact.DAY_MS;
const NOW = new Date('2026-07-27T10:00:00Z');
const daysAgo = (n) => new Date(NOW.getTime() - n * DAY).toISOString();
const inDays = (n) => new Date(NOW.getTime() + n * DAY).toISOString();

const base = {
  id: 'u1', email: 'elev@example.com', full_name: 'Ion Popescu', role: 'elev',
  is_admin: false, subscription_status: 'inactive',
  last_active_at: daysAgo(400),
  deletion_warned_at: null, deletion_reminded_at: null, deletion_scheduled_at: null,
};

// ── eligibleForWarning ───────────────────────────────────────────────────────
test('avertizare: cont inactiv de peste 12 luni → eligibil', () => {
  assert.equal(inact.eligibleForWarning({ ...base }, NOW), true);
});

test('avertizare: activ acum 11 luni → NU', () => {
  assert.equal(inact.eligibleForWarning({ ...base, last_active_at: daysAgo(330) }, NOW), false);
});

test('avertizare: adminii și abonații premium sunt protejați', () => {
  assert.equal(inact.eligibleForWarning({ ...base, is_admin: true }, NOW), false);
  assert.equal(inact.eligibleForWarning({ ...base, subscription_status: 'active' }, NOW), false);
});

test('avertizare: fără email sau fără last_active_at → NU (nu riscăm)', () => {
  assert.equal(inact.eligibleForWarning({ ...base, email: null }, NOW), false);
  assert.equal(inact.eligibleForWarning({ ...base, last_active_at: null }, NOW), false);
});

test('avertizare: deja programat pentru ștergere → NU se reavertizează', () => {
  assert.equal(inact.eligibleForWarning({ ...base, deletion_scheduled_at: inDays(10) }, NOW), false);
});

// ── shouldReactivate ─────────────────────────────────────────────────────────
test('reactivare: autentificare DUPĂ avertizare → ștergerea se anulează', () => {
  const p = { ...base, deletion_warned_at: daysAgo(10), deletion_scheduled_at: inDays(20), last_active_at: daysAgo(2) };
  assert.equal(inact.shouldReactivate(p), true);
});

test('reactivare: fără autentificare după avertizare → rămâne programat', () => {
  const p = { ...base, deletion_warned_at: daysAgo(10), deletion_scheduled_at: inDays(20), last_active_at: daysAgo(400) };
  assert.equal(inact.shouldReactivate(p), false);
});

test('reactivare: programat dar fără deletion_warned_at (stare coruptă) → se anulează defensiv', () => {
  const p = { ...base, deletion_scheduled_at: inDays(20) };
  assert.equal(inact.shouldReactivate(p), true);
});

// ── dueForReminder ───────────────────────────────────────────────────────────
test('reamintire: cu 7 zile înainte de termen → DA, o singură dată', () => {
  const p = { ...base, deletion_warned_at: daysAgo(24), deletion_scheduled_at: inDays(6) };
  assert.equal(inact.dueForReminder(p, NOW), true);
  assert.equal(inact.dueForReminder({ ...p, deletion_reminded_at: daysAgo(1) }, NOW), false);
});

test('reamintire: mai sunt 10 zile → încă NU', () => {
  const p = { ...base, deletion_warned_at: daysAgo(20), deletion_scheduled_at: inDays(10) };
  assert.equal(inact.dueForReminder(p, NOW), false);
});

test('reamintire: termen deja expirat → NU (urmează ștergerea, nu reamintirea)', () => {
  const p = { ...base, deletion_warned_at: daysAgo(31), deletion_scheduled_at: daysAgo(1) };
  assert.equal(inact.dueForReminder(p, NOW), false);
});

// ── dueForDeletion ───────────────────────────────────────────────────────────
test('ștergere: termen expirat + avertizat acum 30 de zile → DA', () => {
  const p = { ...base, deletion_warned_at: daysAgo(30), deletion_scheduled_at: daysAgo(0.01) };
  assert.equal(inact.dueForDeletion(p, NOW), true);
});

test('ștergere: termenul nu a expirat încă → NU', () => {
  const p = { ...base, deletion_warned_at: daysAgo(20), deletion_scheduled_at: inDays(10) };
  assert.equal(inact.dueForDeletion(p, NOW), false);
});

test('ștergere: siguranță — avertizat acum doar 5 zile (date corupte) → NU', () => {
  const p = { ...base, deletion_warned_at: daysAgo(5), deletion_scheduled_at: daysAgo(1) };
  assert.equal(inact.dueForDeletion(p, NOW), false);
});

test('ștergere: reactivat sau protejat între timp → NU', () => {
  const gone = { ...base, deletion_warned_at: daysAgo(31), deletion_scheduled_at: daysAgo(1) };
  assert.equal(inact.dueForDeletion({ ...gone, last_active_at: daysAgo(2) }, NOW), false);
  assert.equal(inact.dueForDeletion({ ...gone, subscription_status: 'active' }, NOW), false);
  assert.equal(inact.dueForDeletion({ ...gone, is_admin: true }, NOW), false);
});

// ── ciclul complet: avertizare → reamintire → ștergere ───────────────────────
test('ciclu complet pe zile: avertizat azi → reamintit în ziua 24 → șters în ziua 31', () => {
  // ziua 0: contul e eligibil și primește avertizarea
  const warnedAt = NOW;
  const schedAt = inact.deletionDate(NOW); // +30 zile
  const p = { ...base, deletion_warned_at: warnedAt.toISOString(), deletion_scheduled_at: schedAt.toISOString() };

  // ziua 10: nici reamintire, nici ștergere
  const d10 = new Date(NOW.getTime() + 10 * DAY);
  assert.equal(inact.dueForReminder(p, d10), false);
  assert.equal(inact.dueForDeletion(p, d10), false);

  // ziua 24: intră în fereastra de 7 zile → reamintire
  const d24 = new Date(NOW.getTime() + 24 * DAY);
  assert.equal(inact.dueForReminder(p, d24), true);
  assert.equal(inact.dueForDeletion(p, d24), false);

  // ziua 31: termen depășit → ștergere
  const d31 = new Date(NOW.getTime() + 31 * DAY);
  assert.equal(inact.dueForDeletion({ ...p, deletion_reminded_at: d24.toISOString() }, d31), true);
});

// ── emailuri ─────────────────────────────────────────────────────────────────
test('emailul de avertizare conține data limită, adresa și linkul de login', () => {
  const sched = inact.deletionDate(NOW);
  const { subject, html } = inact.buildWarningEmail(base, sched);
  const dateRo = inact.fmtDateRo(sched);
  assert.ok(subject.includes(dateRo), 'subiectul conține data');
  assert.ok(html.includes(dateRo), 'corpul conține data');
  assert.ok(html.includes('elev@example.com'), 'corpul conține emailul contului');
  assert.ok(html.includes('/login'), 'corpul conține linkul de autentificare');
  assert.ok(html.includes('30 de zile'), 'corpul explică termenul');
  assert.ok(html.includes('profesor'), 'nota pentru elevi este inclusă');
});

test('nota despre păstrarea rezultatelor apare doar la elevi', () => {
  const sched = inact.deletionDate(NOW);
  const prof = { ...base, role: 'profesor', email: 'prof@example.com' };
  const { html } = inact.buildWarningEmail(prof, sched);
  assert.ok(!html.includes('rezultatele tale la teste rămân'), 'profesorul nu primește nota de elev');
});

test('emailul de reamintire numără corect zilele rămase', () => {
  const sched = new Date(NOW.getTime() + 6 * DAY);
  const { subject } = inact.buildReminderEmail(base, sched, NOW);
  assert.ok(subject.includes('6 zile'), `subiect: ${subject}`);
  const schedTomorrow = new Date(NOW.getTime() + 0.5 * DAY);
  const { subject: s2 } = inact.buildReminderEmail(base, schedTomorrow, NOW);
  assert.ok(s2.includes('o zi'), `subiect: ${s2}`);
});

test('numele din email este escapat (fără HTML injectat)', () => {
  const evil = { ...base, full_name: '<script>alert(1)</script> Ion' };
  const { html } = inact.buildWarningEmail(evil, inact.deletionDate(NOW));
  assert.ok(!html.includes('<script>'), 'HTML-ul din nume este escapat');
});
