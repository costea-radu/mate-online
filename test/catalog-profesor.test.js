// =====================================================================
// test/catalog-profesor.test.js — cererea din 11 noiembrie 2026 (4):
// „fă ca profesorii să poată da note elevilor, plusuri, minusuri, aprecieri".
//
//   · logica pură (api/_lib/noteProfesor.js): validarea, notificările, rezumatul;
//   · SQL-ul (supabase/catalog_profesor.sql): RLS, GRANT fără anon, politicile;
//   · api/teacher-manage.js: add_mark (doar profesorul elevului; notificare elevului
//     și părinților), delete_mark (doar ce a dat el), my_marks (elevul);
//   · api/teacher-students.js: profesorul vede ce a dat el, părintele tot;
//   · interfața: „📒 Notează" lângă elev, catalogul în rândul elevului, notele în
//     medii, „📒 De la profesori" la elev.
// =====================================================================
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { createFakeSupabase, fakeRes } = require('./tools/fakeSupabase');

const ROOT = path.join(__dirname, '..');
const read = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');
const NP = require('../api/_lib/noteProfesor');

// ── Supabase și autentificarea, simulate (înainte de require-ul handlerelor) ──
let fake = null;
let currentUser = null;
const sbPath = require.resolve('@supabase/supabase-js');
require.cache[sbPath] = { id: sbPath, filename: sbPath, loaded: true, exports: { createClient: () => fake } };
const http = require('../api/_lib/http');
http.authUser = async () => { if (!currentUser) { const e = new Error('Neautentificat.'); e.status = 401; throw e; } return currentUser; };
const manage = require('../api/teacher-manage.js');
const students = require('../api/teacher-students.js');

async function call(handler, user, body) {
  currentUser = user;
  const res = fakeRes();
  await handler({ method: 'POST', headers: { authorization: 'Bearer x' }, body }, res);
  return res;
}
function seed() {
  fake = createFakeSupabase({
    profiles: [
      { id: 'prof', role: 'profesor', full_name: 'Ion Ionescu' },
      { id: 'prof2', role: 'profesor', full_name: 'Maria Pop' },
      { id: 'mama', role: 'parinte', full_name: 'Elena Popescu' },
      { id: 'ana', role: 'elev', full_name: 'Ana Popescu' },
      { id: 'dan', role: 'elev', full_name: 'Dan Rusu' },
    ],
    mentor_students: [
      { mentor_id: 'prof', student_id: 'ana', mentor_role: 'profesor', group_id: 'g1' },
      { mentor_id: 'prof2', student_id: 'ana', mentor_role: 'profesor', group_id: null },
      { mentor_id: 'mama', student_id: 'ana', mentor_role: 'parinte', group_id: null },
    ],
    mentor_groups: [{ id: 'g1', name: 'Grupa 1', teacher_id: 'prof' }],
    teacher_marks: [],
    ai_notifications: [],
    progress: [],
  });
}

// ═══════════════════════════ 1) logica pură ═══════════════════════════
test('validarea: notă 1–10 (și cu virgulă), plus/minus cu „pentru ce" opțional, aprecierea cere text', () => {
  assert.deepStrictEqual(NP.validateMark({ kind: 'nota', value: 9, title: '  Lucrare  —  ecuații ' }), { ok: true, row: { kind: 'nota', value: 9, title: 'Lucrare — ecuații', comment: null } });
  assert.strictEqual(NP.validateMark({ kind: 'nota', value: '9,5' }).row.value, 9.5);
  assert.strictEqual(NP.validateMark({ kind: 'nota', value: 11 }).ok, false);
  assert.strictEqual(NP.validateMark({ kind: 'nota', value: 0 }).ok, false);
  assert.strictEqual(NP.validateMark({ kind: 'nota' }).ok, false, 'nota fără valoare');
  assert.deepStrictEqual(NP.validateMark({ kind: 'plus' }), { ok: true, row: { kind: 'plus', value: null, title: null, comment: null } });
  assert.strictEqual(NP.validateMark({ kind: 'minus', value: 3 }).row.value, null, 'plusul / minusul n-au valoare');
  assert.strictEqual(NP.validateMark({ kind: 'apreciere' }).ok, false);
  assert.strictEqual(NP.validateMark({ kind: 'apreciere', comment: 'Bravo!' }).row.comment, 'Bravo!');
  assert.strictEqual(NP.validateMark({ kind: 'zece' }).ok, false);
  assert.strictEqual(NP.validateMark({ kind: 'plus', title: 'x'.repeat(500) }).row.title.length, NP.MAX_TITLE);
});

test('notificările: elevului la persoana a II-a, părintelui cu prenumele copilului', () => {
  const n = NP.notificare({ kind: 'nota', value: 9, title: 'Lucrare' }, { profesor: 'prof. Ion Ionescu' });
  assert.strictEqual(n.title, '📝 Ai primit nota 9 de la prof. Ion Ionescu');
  assert.strictEqual(n.body, 'Pentru: Lucrare');
  const p = NP.notificare({ kind: 'nota', value: 9.5 }, { profesor: 'prof. Ion Ionescu', elev: 'Ana', cui: 'parinte' });
  assert.strictEqual(p.title, '📝 Ana a primit nota 9,50 de la prof. Ion Ionescu');
  assert.match(NP.notificare({ kind: 'plus' }).title, /^➕ Ai primit un plus/);
  assert.match(NP.notificare({ kind: 'minus', title: 'Temă nefăcută' }).body, /Temă nefăcută/);
  const a = NP.notificare({ kind: 'apreciere', comment: 'Bravo!' }, { profesor: 'prof. Ion', elev: 'Ana', cui: 'parinte' });
  assert.strictEqual(a.title, '👏 prof. Ion îl apreciază pe Ana');
  assert.strictEqual(a.body, 'Bravo!');
});

test('rezumatul: media notelor, plusurile, minusurile, aprecierile', () => {
  const r = NP.rezumat([{ kind: 'nota', value: 9 }, { kind: 'nota', value: '10' }, { kind: 'plus' }, { kind: 'plus' }, { kind: 'minus' }, { kind: 'apreciere', comment: 'x' }]);
  assert.strictEqual(r.media, 9.5);
  assert.deepStrictEqual([r.plusuri, r.minusuri, r.aprecieri, r.note.length], [2, 1, 1, 2]);
  assert.strictEqual(NP.rezumat([]).media, null);
});

// ═══════════════════════════ 2) SQL ═══════════════════════════
test('SQL: tabela teacher_marks cu RLS, GRANT pentru authenticated și service_role (fără anon), politicile de citire', () => {
  const sql = read('supabase/catalog_profesor.sql');
  assert.match(sql, /create table if not exists public\.teacher_marks/);
  assert.match(sql, /kind\s+text not null check \(kind in \('nota', 'plus', 'minus', 'apreciere'\)\)/);
  assert.match(sql, /value\s+numeric\(4,2\) check \(value is null or \(value >= 1 and value <= 10\)\)/);
  assert.match(sql, /alter table public\.teacher_marks enable row level security;/);
  assert.match(sql, /grant select, insert, update, delete on public\.teacher_marks to authenticated;/);
  assert.match(sql, /grant select, insert, update, delete on public\.teacher_marks to service_role;/);
  assert.ok(!/to anon/i.test(sql), 'vizitatorii fără cont nu au acces');
  // citirea: profesorul, elevul, părinții elevului; scrierile doar prin API (rolul de serviciu)
  const pol = sql.slice(sql.indexOf('teacher_marks_read'), sql.indexOf('teacher_marks_service'));
  assert.match(pol, /for select to authenticated/);
  assert.match(pol, /\(select auth\.uid\(\)\) = teacher_id/);
  assert.match(pol, /\(select auth\.uid\(\)\) = student_id/);
  assert.match(pol, /ms\.mentor_role = 'parinte'/);
  assert.ok(!/for (insert|update|delete|all) to authenticated/.test(sql), 'browserul nu scrie în catalog');
});

// ═══════════════════════════ 3) API ═══════════════════════════
test('add_mark: profesorul elevului dă notă / plus / minus / apreciere; elevul și părinții primesc notificarea', async () => {
  seed();
  let r = await call(manage, 'prof', { action: 'add_mark', studentId: 'ana', kind: 'nota', value: 9, title: 'Lucrare' });
  assert.strictEqual(r.statusCode, 200, JSON.stringify(r.body));
  assert.strictEqual(r.body.mark.kind, 'nota');
  assert.strictEqual(Number(r.body.mark.value), 9);
  assert.strictEqual(r.body.mark.teacher_name, 'Ion Ionescu');
  assert.strictEqual(r.body.mark.group_id, 'g1', 'grupa elevului, la momentul notei');
  const notif = fake.db.tables.ai_notifications;
  assert.ok(notif.some((n) => n.recipient_id === 'ana' && n.type === 'catalog' && n.title === '📝 Ai primit nota 9 de la prof. Ion Ionescu' && n.data.url === '/profil?rezultate=1'));
  assert.ok(notif.some((n) => n.recipient_id === 'mama' && n.title === '📝 Ana a primit nota 9 de la prof. Ion Ionescu'), 'părintele e anunțat');
  for (const kind of ['plus', 'minus']) {
    r = await call(manage, 'prof', { action: 'add_mark', studentId: 'ana', kind, title: 'Activitate' });
    assert.strictEqual(r.statusCode, 200);
  }
  r = await call(manage, 'prof', { action: 'add_mark', studentId: 'ana', kind: 'apreciere', comment: 'Bravo, Ana!' });
  assert.strictEqual(r.statusCode, 200);
  assert.strictEqual(fake.db.tables.teacher_marks.length, 4);
  // validarea și accesul
  r = await call(manage, 'prof', { action: 'add_mark', studentId: 'ana', kind: 'nota', value: 12 });
  assert.strictEqual(r.statusCode, 400);
  r = await call(manage, 'prof', { action: 'add_mark', studentId: 'dan', kind: 'plus' });
  assert.strictEqual(r.statusCode, 403, 'elevul altui profesor');
  r = await call(manage, 'mama', { action: 'add_mark', studentId: 'ana', kind: 'plus' });
  assert.strictEqual(r.statusCode, 403, 'părinții nu dau note');
  r = await call(manage, 'ana', { action: 'add_mark', studentId: 'ana', kind: 'nota', value: 10 });
  assert.strictEqual(r.statusCode, 403, 'elevul nu-și dă singur note');
  assert.strictEqual(fake.db.tables.teacher_marks.length, 4);
});

test('add_mark: asocierea veche (profiles.teacher_id) contează; fără tabelă → mesaj clar cu SQL-ul de rulat', async () => {
  seed();
  fake.db.tables.profiles.find((p) => p.id === 'dan').teacher_id = 'prof';
  let r = await call(manage, 'prof', { action: 'add_mark', studentId: 'dan', kind: 'plus' });
  assert.strictEqual(r.statusCode, 200);
  assert.strictEqual(r.body.mark.group_id, null);
  fake.db.failTables.add('teacher_marks');
  r = await call(manage, 'prof', { action: 'add_mark', studentId: 'ana', kind: 'plus' });
  assert.strictEqual(r.statusCode, 500);
  assert.match(r.body.error, /supabase\/catalog_profesor\.sql/);
  r = await call(manage, 'ana', { action: 'my_marks' });
  assert.deepStrictEqual(r.body, { marks: [], setup: false }, 'elevul: catalog gol, fără eroare');
});

test('delete_mark: doar profesorul care a dat-o; my_marks: elevul își vede rândurile, cele mai noi primele', async () => {
  seed();
  // (în Postgres, created_at = now(); aici îl punem noi)
  const cuData = (m, iso) => { fake.db.tables.teacher_marks.find((x) => x.id === m.id).created_at = iso; return m; };
  const a = cuData((await call(manage, 'prof', { action: 'add_mark', studentId: 'ana', kind: 'nota', value: 8 })).body.mark, '2026-11-10T08:00:00.000Z');
  const b = cuData((await call(manage, 'prof2', { action: 'add_mark', studentId: 'ana', kind: 'apreciere', comment: 'Foarte bine' })).body.mark, '2026-11-11T08:00:00.000Z');
  let r = await call(manage, 'prof2', { action: 'delete_mark', markId: a.id });
  assert.strictEqual(r.statusCode, 404, 'nota altui profesor nu se poate șterge');
  r = await call(manage, 'ana', { action: 'my_marks' });
  assert.deepStrictEqual(r.body.marks.map((m) => m.id), [b.id, a.id]);
  assert.strictEqual(r.body.setup, true);
  r = await call(manage, 'dan', { action: 'my_marks' });
  assert.deepStrictEqual(r.body.marks, [], 'fiecare elev își vede doar rândurile lui');
  r = await call(manage, 'prof', { action: 'delete_mark', markId: a.id });
  assert.strictEqual(r.statusCode, 200);
  assert.deepStrictEqual(fake.db.tables.teacher_marks.map((m) => m.id), [b.id]);
});

test('teacher-students: profesorul primește doar ce a dat el; părintele — tot ce a primit copilul', async () => {
  seed();
  await call(manage, 'prof', { action: 'add_mark', studentId: 'ana', kind: 'nota', value: 7 });
  await call(manage, 'prof2', { action: 'add_mark', studentId: 'ana', kind: 'plus' });
  let r = await call(students, 'prof', { userId: 'prof' });
  assert.strictEqual(r.statusCode, 200, JSON.stringify(r.body));
  assert.deepStrictEqual(r.body.marks.map((m) => [m.teacher_id, m.kind]), [['prof', 'nota']]);
  r = await call(students, 'mama', { userId: 'mama' });
  assert.deepStrictEqual(r.body.marks.map((m) => m.kind).sort(), ['nota', 'plus']);
  fake.db.failTables.add('teacher_marks');
  r = await call(students, 'prof', { userId: 'prof' });
  assert.strictEqual(r.statusCode, 200, 'fără tabelă, restul rezultatelor merg');
  assert.deepStrictEqual(r.body.marks, []);
});

// ═══════════════════════════ 4) interfața ═══════════════════════════
test('„Grupe / Rezultate elevi": „📒 Notează" lângă elev (profesor), catalogul în rândul lui, notele în medii', () => {
  const tr = read('src/components/TeacherResults.jsx');
  assert.match(tr, /import \{ CatalogDialog, CatalogSumar, CatalogList \} from '\.\/CatalogNote';/);
  assert.match(tr, /isTeacher && !student\.archived && onCatalog && \(\s*\n\s*<button[^>]*onClick=\{\(e\) => \{ e\.stopPropagation\(\); onCatalog\(student\); \}\}/);
  assert.match(tr, /📒 Notează/);
  assert.match(tr, /<CatalogList marks=\{student\.marks \|\| \[\]\} onDelete=\{isTeacher \? onDeleteMark : null\} showTeacher=\{isParent\}/);
  assert.match(tr, /\{catalogFor && <CatalogDialog student=\{catalogFor\} onClose=\{\(\) => setCatalogFor\(null\)\} onSaved=\{catalogSaved\} \/>\}/);
  // notele din catalog intră în medii (gradesOf)
  const g = tr.slice(tr.indexOf('function gradesOf'), tr.indexOf('function medieDin'));
  assert.match(g, /\(student\.marks \|\| \[\]\)\.forEach\(\(m\) => \{\s*\n\s*if \(m\.kind !== 'nota' \|\| m\.value == null\) return;/);
  // datele vin cu restul rezultatelor
  assert.match(tr, /marks: json\.marks \|\| \[\]/);
});

test('fereastra „📒 Notează": notă 1–10, plus, minus, apreciere (cu propuneri), „pentru ce"; elevul: „📒 De la profesori"', () => {
  const c = read('src/components/CatalogNote.jsx');
  assert.match(c, /\[1, 2, 3, 4, 5, 6, 7, 8, 9, 10\]\.map\(\(n\) =>/);
  for (const k of ["nota: { icon: '📝', label: 'Notă'", "plus: { icon: '➕', label: 'Plus'", "minus: { icon: '➖', label: 'Minus'", "apreciere: { icon: '👏', label: 'Apreciere'"]) assert.ok(c.includes(k), k);
  assert.match(c, /aiClient\.catalogAdd\(\{/);
  assert.match(c, /export function MyCatalog\(\{ marks \}\)/);
  assert.match(c, /📒 De la profesori — note, plusuri, minusuri, aprecieri/);
  const prof = read('src/pages/Profile.jsx');
  assert.match(prof, /import \{ MyCatalog, useMyCatalog \} from '\.\.\/components\/CatalogNote';/);
  assert.match(prof, /<MyCatalog marks=\{marks\} \/>/);
  const cli = read('src/lib/aiClient.js');
  assert.match(cli, /catalogMine: \(\) => post\('\/api\/teacher-manage', \{ action: 'my_marks' \}\),/);
  assert.match(read('src/components/AINotifications.jsx'), /catalog: '📒'/);
});
