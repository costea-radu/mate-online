// Teste pentru „🗑 Șterge versiunile vechi" (Admin → Meditații live → Lecțiile recente):
// după „Regenerează", versiunea veche a lecției nu mai e folosită nicăieri (sălile, Pregătirea
// de examen și simulările iau cea mai nouă versiune) — se șterge rândul ei și fișierele ei din
// Storage (vocea, desenele: live-media/lessons/<id>/). Cât versiunea nouă nu e gata (se
// scrie / a eșuat), cea veche rămâne; la fel una „în lucru" (lacăt). Fără rețea.
const test = require('node:test');
const assert = require('node:assert');
const { createFakeSupabase, fakeRes } = require('./tools/fakeSupabase');
const ai = require('../api/_lib/ai');
const handler = require('../api/live');

delete process.env.AZURE_SPEECH_KEY; delete process.env.OPENAI_API_KEY; delete process.env.LIVE_TTS_API_KEY;
delete process.env.SUPABASE_URL; delete process.env.VITE_SUPABASE_URL;

const U = { elev: '22222222-2222-4222-8222-222222222222', admin: '33333333-3333-4333-8333-333333333333' };
const S = { a: 'aaaaaaaa-0000-4000-8000-000000000001', b: 'aaaaaaaa-0000-4000-8000-000000000002', c: 'aaaaaaaa-0000-4000-8000-000000000003' };
const id = (n) => `dddddddd-0000-4000-8000-${String(n).padStart(12, '0')}`;
const iso = (ms) => new Date(ms).toISOString();
const now = Date.now();
let fake = null;
ai.admin = () => fake;
ai.authUser = async (req) => { const u = req.headers['x-user']; if (!u) { const e = new Error('Neautentificat.'); e.status = 401; throw e; } return u; };
ai.logUsage = async () => {};

async function call(action, body = {}, user = U.admin) {
  const res = fakeRes();
  await handler({ method: 'POST', headers: user ? { 'x-user': user } : {}, query: {}, body: { action, ...body } }, res);
  return res;
}
const lesson = (n, subject, version, status, extra = {}) => ({
  id: id(n), subject_id: subject, teacher: 'radu', version, status, title: `Subiect ${subject.slice(-1)} v${version}`, exam: 'en', profile: null,
  script: status === 'nou' ? null : { title: 'T', items: [] }, progress: {}, cost_micro: 0, locked_until: null,
  created_at: iso(now - 86400000 + n * 1000), updated_at: iso(now - 3600000 + n * 1000), ...extra,
});
function world(lessons) {
  const content = (sid) => ({ id: sid, title: `EN 2024 Varianta ${sid.slice(-1)}`, category: 'evaluare-nationala', subcategory: null, profile: null, content_type: 'pdf', file_url: `https://x/${sid}.pdf`, is_free: true, created_at: '2026-01-01T00:00:00Z' });
  fake = createFakeSupabase({
    profiles: [
      { id: U.elev, full_name: 'Andrei Ionescu', email: 'andrei@example.com', subscription_status: 'active', role: 'elev', is_admin: false },
      { id: U.admin, full_name: 'Radu Costea', email: 'radu@example.com', subscription_status: null, role: 'admin', is_admin: true },
    ],
    content: [content(S.a), content(S.b), content(S.c)],
    ai_pdf_text: [S.a, S.b, S.c].map((sid) => ({ content_id: sid, barem_status: 'ok', barem: { title: 'Barem' }, barem_text: 'BAREM', text: 'SUBIECTUL I' })),
    app_settings: [{ key: 'live_free_lessons', value: { subjects: [] } }],
    live_lessons: lessons,
  });
  // fișierele fiecărei lecții: vocea (3 fraze) + un desen
  for (const l of lessons) {
    for (const f of ['s1.mp3', 's2.mp3', 's3.mp3', 'fig-III6.png']) fake.db.files.set(`live-media/lessons/${l.id}/${f}`, Buffer.from('x'));
  }
}
const files = (lessonId) => [...fake.db.files.keys()].filter((k) => k.startsWith(`live-media/lessons/${lessonId}/`));

test('versiunile vechi: marcate în „Lecțiile recente", șterse cu fișierele lor; cea nouă rămâne neatinsă', async () => {
  handler._internals.resetFree();
  world([
    lesson(1, S.a, 1, 'gata'), lesson(2, S.a, 2, 'gata'),                    // A: v1 înlocuită de v2 (gata)
    lesson(3, S.b, 1, 'gata'), lesson(4, S.b, 2, 'nou'),                     // B: v2 se scrie încă → v1 rămâne
    lesson(5, S.c, 1, 'gata'),                                               // C: o singură versiune
    lesson(6, S.a, 3, 'gata', { subject_id: S.c, version: 0 }),              // C: v0, în lucru acum (lacăt)
  ]);
  fake.db.tables.live_lessons[5].locked_until = iso(now + 10 * 60000);
  const ov = await call('admin_overview');
  assert.strictEqual(ov.statusCode, 200, JSON.stringify(ov.body));
  const by = Object.fromEntries(ov.body.lessons.map((l) => [l.id, l.superseded]));
  assert.deepStrictEqual(by[id(1)], { by: 2, deletable: true });
  assert.deepStrictEqual(by[id(3)], { by: 2, deletable: false }, 'versiunea nouă nu e gata: rămâne cea veche');
  assert.strictEqual(by[id(2)], null);
  assert.strictEqual(by[id(5)], null);
  assert.deepStrictEqual(by[id(6)], { by: 1, deletable: true });
  assert.deepStrictEqual(ov.body.oldVersions, { count: 2, waiting: 1 });

  // doar numărul (fără lecția în lucru)
  const dry = await call('admin_delete_old', { dry: true });
  assert.deepStrictEqual(dry.body, { count: 1, waiting: 1 });
  // doar adminul
  assert.strictEqual((await call('admin_delete_old', {}, U.elev)).statusCode, 403);

  const r = await call('admin_delete_old');
  assert.strictEqual(r.statusCode, 200, JSON.stringify(r.body));
  assert.deepStrictEqual([r.body.deleted, r.body.files, r.body.left, r.body.waiting], [1, 4, 0, 1]);
  const ids = fake.db.tables.live_lessons.map((l) => l.id).sort();
  assert.deepStrictEqual(ids, [id(2), id(3), id(4), id(5), id(6)]);
  assert.deepStrictEqual(files(id(1)), [], 'vocea și desenul versiunii vechi s-au șters');
  assert.strictEqual(files(id(2)).length, 4, 'fișierele versiunii noi rămân');
  assert.strictEqual(files(id(3)).length, 4);

  // una anume: doar o versiune veche, cu versiunea nouă gata
  assert.strictEqual((await call('admin_delete_old', { lessonId: id(3) })).statusCode, 409);
  assert.strictEqual((await call('admin_delete_old', { lessonId: id(2) })).statusCode, 409, 'cea mai nouă versiune nu se șterge');
  fake.db.tables.live_lessons.find((l) => l.id === id(4)).status = 'gata';   // B v2 e acum gata
  fake.db.tables.live_lessons.find((l) => l.id === id(4)).script = { title: 'T', items: [] };
  const one = await call('admin_delete_old', { lessonId: id(3) });
  assert.strictEqual(one.statusCode, 200, JSON.stringify(one.body));
  assert.strictEqual(one.body.deleted, 1);
  assert.ok(!fake.db.tables.live_lessons.some((l) => l.id === id(3)));
  assert.deepStrictEqual(files(id(3)), []);
});

test('multe versiuni vechi: câte 40 pe cerere (Admin repetă cât mai rămân)', async () => {
  handler._internals.resetFree();
  const many = [];
  for (let v = 1; v <= 46; v++) many.push(lesson(v, S.a, v, 'gata'));
  world(many);
  const a = await call('admin_delete_old');
  assert.deepStrictEqual([a.body.deleted, a.body.left], [40, 5]);
  const b = await call('admin_delete_old');
  assert.deepStrictEqual([b.body.deleted, b.body.left], [5, 0]);
  assert.deepStrictEqual(fake.db.tables.live_lessons.map((l) => l.version), [46]);
  assert.strictEqual([...fake.db.files.keys()].length, 4, 'doar fișierele versiunii păstrate');
  const c = await call('admin_delete_old');
  assert.deepStrictEqual([c.body.deleted, c.body.left], [0, 0]);
});
