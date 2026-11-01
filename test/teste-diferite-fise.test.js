// Teste pentru cererea lui Radu din 1 nov. 2026:
//   „schimba numele din «test pe grupa (teste diferite)» in «test interactiv pe
//    grupa (teste diferite)»; muta continutul «genereaza acum testele» […] in
//    «genereaza exercitii/teste interactive/PDF» si pune un buton unde se poate
//    introduce «nr teste diferite / elev». fa sa poata alege pe langa continutul
//    examenelor si clasele 5-12; sa ia exercitiile din fisele cu exercitii clase
//    5-12 si sa poata fi selectate prin bifare «nivele» sau «tipuri», dupa cum
//    sunt scrise in fisiere. Pune sa pot folosi si varianta care schimba numerele
//    si notatiile […]; pune peste tot in loc de gpt 5.6 cu gpt 6.x"
//
//   1) api/_lib/fise.js — citirea unei fișe (o singură dată): schema strictă,
//      bucățile de pagini, îmbinarea grupelor, reîncercarea, citirea parțială;
//   2) api/fise.js — list / bank, cu o bază de date falsă: banca se citește o
//      dată (costul în contul platformei), apoi se servește fără AI; lacătul;
//      fișierul schimbat; doar profesorii; migrarea nerulată;
//   3) src/lib/fiseTeste.js — planul testelor diferite, testul ca „exam",
//      materialul pentru AI, filtrul examenelor cu numere schimbate;
//   4) src/lib/examPrint.js — mai multe teste într-un document;
//   5) legăturile din interfață (generatorul mutat, câmpul „Nr. teste diferite /
//      elev", clasele 5–12, numele filei, migrarea SQL cu RLS + GRANT).
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const Module = require('node:module');
const { pathToFileURL } = require('node:url');

const ROOT = path.join(__dirname, '..');
const read = (f) => fs.readFileSync(path.join(ROOT, ...f.split('/')), 'utf8');
let libP = null;
const lib = () => (libP || (libP = import('../src/lib/fiseTeste.js')));

const F = require('../api/_lib/fise');
const ai = require('../api/_lib/ai');

// un PDF real cu N pagini (pdf-lib) — pentru numărarea și extragerea paginilor
async function makePdf(nPages) {
  const { PDFDocument } = require('pdf-lib');
  const doc = await PDFDocument.create();
  for (let i = 0; i < nPages; i++) doc.addPage([300, 400]);
  return Buffer.from(await doc.save());
}
async function pageCount(buf) {
  const { PDFDocument } = require('pdf-lib');
  return (await PDFDocument.load(buf)).getPageCount();
}
const { extractPagesPdf } = require('../api/_lib/pdfpages');

// răspunsurile „modelului" pentru o fișă de 5 pagini (bucăți: 1–2, 3–4, 5)
function fakeModel(calls, { failFirst = false, failChunk = null } = {}) {
  let failed = false;
  return async ({ messages, model, reasoningEffort, schemaName, schema }) => {
    const text = messages[0].content[0].text;
    calls.push({ model, reasoningEffort, schemaName, text, part: messages[0].content[1], schema });
    if (failChunk && text.includes(failChunk)) { const e = new Error('gateway 502'); e.usage = { in: 10, out: 0 }; throw e; }
    if (failFirst && !failed) { failed = true; const e = new Error('timeout'); e.usage = { in: 50, out: 0 }; throw e; }
    const ex = (n, t, figure = false) => ({ n, text: t, figure });
    let groups;
    if (text.includes('Paginile 1–2')) {
      groups = [
        { title: 'Nivel 1: Radicali', kind: 'nivel', instruction: 'Calculați:', exercises: [ex('1', '$\\sqrt{4}$'), ex('2', '$\\sqrt{9}$')] },
        { title: 'Nivel 2', kind: 'nivel', instruction: null, exercises: [ex('1', '$\\sqrt{12}$')] },
      ];
    } else if (text.includes('Paginile 3–4')) {
      groups = [
        // continuarea „Nivelului 2" (fără titlu pe pagina asta)
        { title: null, kind: 'nivel', instruction: null, exercises: [ex('2', '$\\sqrt{18}$'), ex('3', 'Figura alăturată…', true)] },
        // modelul a repetat titlul grupei → tot lipită
        { title: 'Nivel 2', kind: 'nivel', instruction: null, exercises: [ex('4', '$\\sqrt{27}$')] },
        { title: 'Triunghiuri asemenea · MODEL 1', kind: 'tip', instruction: null, exercises: [ex('1', 'În triunghiul $ABC$ …')] },
      ];
    } else {
      groups = [
        { title: 'Exercițiul 2 — ecuații de forma $x^2+bx=0$', kind: 'tip', instruction: 'Rezolvați în $\\mathbb{R}$:', exercises: [ex('a)', '$x^2+3x=0$'), ex('b)', '$x^2-5x=0$')] },
        { title: 'Gol', kind: 'sectiune', instruction: null, exercises: [] },
      ];
    }
    return { data: { groups }, usage: { in: 1000, out: 400, model } };
  };
}

// ═════════════════════ 1) citirea fișei (api/_lib/fise.js) ══════════════════
test('schema citirii e STRICTĂ (Structured Outputs): fiecare obiect cu toate cheile obligatorii', () => {
  const schema = F.schemaFor(ai.S);
  const walk = (s, where) => {
    if (!s || typeof s !== 'object') return;
    if (s.type === 'object') {
      assert.strictEqual(s.additionalProperties, false, where);
      assert.deepStrictEqual([...s.required].sort(), Object.keys(s.properties).sort(), where);
      for (const [k, v] of Object.entries(s.properties)) walk(v, `${where}.${k}`);
    }
    if (s.items) walk(s.items, `${where}[]`);
    if (s.anyOf) s.anyOf.forEach((x, i) => walk(x, `${where}|${i}`));
  };
  walk(schema, 'root');
  const grp = schema.properties.groups.items;
  assert.deepStrictEqual(grp.properties.kind.enum, ['nivel', 'tip', 'sectiune', 'lista']);
  // promptul cere grupele EXACT după titlurile din fișă, cu LaTeX și fără rezolvări
  assert.match(F.SYSTEM, /Nivel 1/);
  assert.match(F.SYSTEM, /MODEL 1/);
  assert.match(F.SYSTEM, /NU rezolva/);
  assert.match(F.SYSTEM, /LaTeX/);
  assert.match(F.SYSTEM, /title null/);
});

test('bucățile de pagini: câte 2, cel mult 40 de pagini', () => {
  assert.deepStrictEqual(F.pageChunks(5), [[0, 1], [2, 3], [4]]);
  assert.deepStrictEqual(F.pageChunks(1), [[0]]);
  assert.deepStrictEqual(F.pageChunks(0), []);
  assert.strictEqual(F.pageChunks(100).flat().length, F.MAX_PAGES);
});

test('îmbinarea: grupul fără titlu și titlul repetat se lipesc de grupul anterior; grupele goale ies; cheile g1, g2…', () => {
  const g = F.mergeChunks([
    { groups: [{ title: 'Nivel 1', kind: 'nivel', instruction: 'Calculați:', exercises: [{ n: '1', text: ' a ' }] }] },
    { groups: [
      { title: null, kind: 'nivel', instruction: null, exercises: [{ n: '2', text: 'b' }, { n: '3', text: '   ' }] },
      { title: 'nivel  1', kind: 'nivel', instruction: null, exercises: [{ n: '4', text: 'c', figure: true }] },
      { title: 'Nivel 2', kind: 'ciudat', instruction: '', exercises: [] },
      { title: 'Nivel 3', kind: 'nivel', instruction: null, exercises: [{ n: '1', text: 'd' }] },
    ] },
  ]);
  assert.deepStrictEqual(g.map((x) => [x.key, x.title, x.exercises.map((e) => e.text)]), [
    ['g1', 'Nivel 1', ['a', 'b', 'c']],
    ['g2', 'Nivel 3', ['d']],
  ]);
  assert.strictEqual(g[0].instruction, 'Calculați:');
  assert.strictEqual(g[0].exercises[2].figure, true);
  assert.ok(!('figure' in g[0].exercises[0]));
  // un grup fără titlu la început de fișă primește un nume
  assert.strictEqual(F.mergeChunks([{ groups: [{ title: null, kind: 'lista', instruction: null, exercises: [{ n: '1', text: 'x' }] }] }])[0].title, 'Exerciții');
  assert.deepStrictEqual(F.summarize(g), [
    { key: 'g1', title: 'Nivel 1', kind: 'nivel', count: 3, figures: 1 },
    { key: 'g2', title: 'Nivel 3', kind: 'nivel', count: 1, figures: 0 },
  ]);
});

test('ordinea fișelor: cea din site, apoi ALGEBRĂ, GEOMETRIE și numărul fișei', () => {
  const t = F.sortSheets([
    { title: 'GEOMETRIE — Fișă 2', sort_order: 0 }, { title: 'ALGEBRĂ — Fișă 10', sort_order: 0 },
    { title: 'ALGEBRĂ — Fișă 2', sort_order: 0 }, { title: 'Recapitulare', sort_order: -1 },
  ]).map((x) => x.title);
  assert.deepStrictEqual(t, ['Recapitulare', 'ALGEBRĂ — Fișă 2', 'ALGEBRĂ — Fișă 10', 'GEOMETRIE — Fișă 2']);
});

test('transcribeSheet: modelul cu vedere (PDF_MODEL), câte 2 pagini, efort „low"; grupele îmbinate corect', async () => {
  const buf = await makePdf(5);
  const calls = [];
  const r = await F.transcribeSheet(buf, {
    title: 'ALGEBRĂ — Fișă 4 — Radicali', category: 'clasa-7', model: 'openai/gpt-6.1-terra',
    chatJson: fakeModel(calls), S: ai.S, extractPagesPdf, pageCount,
  });
  assert.strictEqual(calls.length, 3);
  assert.ok(calls.every((c) => c.model === 'openai/gpt-6.1-terra' && c.reasoningEffort === 'low' && c.schemaName === 'fisa_exercitii'));
  assert.ok(calls.every((c) => c.part && c.part.type === 'file' && /^data:application\/pdf;base64,/.test(c.part.file.file_data)));
  assert.ok(calls.some((c) => c.text.includes('Pagina 5 din 5')));
  assert.ok(calls[0].text.includes('clasa a VII-a'));
  assert.strictEqual(r.status, 'ok');
  assert.strictEqual(r.pages, 5);
  assert.deepStrictEqual(r.groups.map((g) => [g.title, g.kind, g.exercises.length]), [
    ['Nivel 1: Radicali', 'nivel', 2],
    ['Nivel 2', 'nivel', 4],          // 1 + 2 (continuare) + 1 (titlu repetat)
    ['Triunghiuri asemenea · MODEL 1', 'tip', 1],
    ['Exercițiul 2 — ecuații de forma $x^2+bx=0$', 'tip', 2],
  ]);
  assert.strictEqual(r.exercises, 9);
  assert.deepStrictEqual({ in: r.usage.in, out: r.usage.out }, { in: 3000, out: 1200 });
});

test('transcribeSheet: o bucată căzută se reîncearcă o dată; căzută de două ori → fișa e „partial"; toate căzute → eroare 502', async () => {
  const buf = await makePdf(5);
  // a) o eroare trecătoare: reîncercarea o rezolvă, tokenii primei încercări se adună
  let calls = [];
  let r = await F.transcribeSheet(buf, { title: 'F', model: 'm', chatJson: fakeModel(calls, { failFirst: true }), S: ai.S, extractPagesPdf, pageCount });
  assert.strictEqual(r.status, 'ok');
  assert.strictEqual(calls.length, 4);
  assert.strictEqual(r.usage.in, 3050);
  // b) bucata 3–4 cade mereu → partial, celelalte grupe rămân
  calls = [];
  const logs = [];
  r = await F.transcribeSheet(buf, { title: 'F', model: 'm', chatJson: fakeModel(calls, { failChunk: 'Paginile 3–4' }), S: ai.S, extractPagesPdf, pageCount, log: (m) => logs.push(m) });
  assert.strictEqual(r.status, 'partial');
  assert.strictEqual(r.failed, 1);
  assert.ok(logs.some((m) => /paginile 3–4/.test(m)));
  assert.deepStrictEqual(r.groups.map((g) => g.title), ['Nivel 1: Radicali', 'Nivel 2', 'Exercițiul 2 — ecuații de forma $x^2+bx=0$']);
  // c) nimic citit → eroare, cu tokenii consumați (se loghează)
  await assert.rejects(
    F.transcribeSheet(buf, { title: 'F', model: 'm', chatJson: async () => { const e = new Error('x'); e.usage = { in: 5, out: 0 }; throw e; }, S: ai.S, extractPagesPdf, pageCount }),
    // 3 bucăți × 2 încercări × 5 tokeni
    (e) => e.status === 502 && e.usage && e.usage.in === 30,
  );
});

test('transcribeSheet: bucata prea mare (poze) se citește pagină cu pagină', async () => {
  const buf = await makePdf(2);
  const calls = [];
  let n = 0;
  const filePart = (b, name) => (++n === 1 ? null : { type: 'file', file: { filename: name, file_data: 'data:application/pdf;base64,AA==' } });
  const r = await F.transcribeSheet(buf, {
    title: 'F', model: 'm', S: ai.S, extractPagesPdf, pageCount, filePart,
    chatJson: async ({ messages }) => { calls.push(messages[0].content[0].text); return { data: { groups: [{ title: 'Nivel 1', kind: 'nivel', instruction: null, exercises: [{ n: String(calls.length), text: `e${calls.length}`, figure: false }] }] }, usage: { in: 1, out: 1 } }; },
  });
  assert.deepStrictEqual(calls.map((t) => /Pagina (\d)/.exec(t)[1]), ['1', '2']);
  assert.deepStrictEqual(r.groups.map((g) => g.exercises.length), [2]); // același titlu → o grupă
  assert.ok(F.sheetPart(Buffer.alloc(10), 'x.pdf'));
  assert.strictEqual(F.sheetPart(Buffer.alloc(F.MAX_SHEET_PART_BYTES + 1), 'x.pdf'), null);
});

// ═══════════════════ 2) endpoint-ul api/fise.js (bază falsă) ═══════════════
function fakeSupa(db) {
  return {
    from(table) {
      const st = { op: 'select', filters: [], payload: null, single: null, returning: false };
      const api = {
        select() { if (st.op !== 'select') st.returning = true; return api; },
        eq(c, v) { st.filters.push((r) => r[c] === v); return api; },
        neq(c, v) { st.filters.push((r) => r[c] !== v); return api; },
        in(c, vs) { st.filters.push((r) => vs.includes(r[c])); return api; },
        order() { return api; },
        limit() { return api; },
        insert(row) { st.op = 'insert'; st.payload = row; return api; },
        update(patch) { st.op = 'update'; st.payload = patch; return api; },
        maybeSingle() { st.single = 'maybe'; return api; },
        then(res, rej) { return Promise.resolve(exec()).then(res, rej); },
      };
      function exec() {
        if (db.__missing && db.__missing.includes(table)) return { data: null, error: { message: `relation "public.${table}" does not exist`, code: '42P01' } };
        const rows = (db[table] = db[table] || []);
        if (st.op === 'insert') {
          if (rows.some((x) => x.content_id === st.payload.content_id)) return { data: null, error: { code: '23505', message: 'duplicate key value' } };
          rows.push({ ...st.payload });
          return { data: null, error: null };
        }
        const match = rows.filter((r) => st.filters.every((f) => f(r)));
        if (st.op === 'update') {
          match.forEach((r) => Object.assign(r, st.payload));
          return { data: st.returning ? match.map((r) => ({ content_id: r.content_id })) : null, error: null };
        }
        if (st.single === 'maybe') return { data: match[0] || null, error: null };
        return { data: match, error: null };
      }
      return api;
    },
  };
}
function fakeRes() {
  const r = { code: 200, body: null };
  r.status = (c) => { r.code = c; return r; };
  r.json = (b) => { r.body = b; return r; };
  r.end = () => r;
  r.setHeader = () => {};
  return r;
}

async function withEndpoint(fn) {
  const saved = {};
  const patch = (k, v) => { saved[k] = ai[k]; ai[k] = v; };
  const state = { pdf: await makePdf(5), usage: [], calls: [], profile: { id: 'u1', role: 'profesor', is_admin: false, subscription_status: 'active' }, premiumChecked: 0, rate: [] };
  const db = {
    content: [
      { id: 'c1', title: 'ALGEBRĂ — Fișă 4 — Radicali', category: 'clasa-7', content_type: 'pdf', file_url: 'https://x/f4.pdf', is_free: true, sort_order: 0 },
      { id: 'c2', title: 'ALGEBRĂ — Fișă 2 — Mulțimi', category: 'clasa-7', content_type: 'pdf', file_url: 'https://x/f2.pdf', is_free: true, sort_order: 0 },
      { id: 'c3', title: 'Barem fișa 4', category: 'clasa-7', content_type: 'pdf', file_url: 'https://x/b.pdf', is_free: true, sort_order: 0 },
      { id: 'c4', title: 'Test EN', category: 'evaluare-nationala', content_type: 'pdf', file_url: 'https://x/en.pdf', is_free: true, sort_order: 0 },
    ],
    fise_banca: [],
  };
  const supa = fakeSupa(db);
  patch('applyCors', () => {});
  patch('admin', () => supa);
  patch('authUser', async () => 'u1');
  patch('requireUser', async () => state.profile);
  patch('requirePremium', (p) => { state.premiumChecked++; if (p.subscription_status !== 'active') { const e = new Error('abonament'); e.status = 402; throw e; } });
  patch('enforceRateLimit', async (s, uid, p, opts) => { state.rate.push(opts); return null; });
  patch('hasChat', () => true);
  patch('chatJson', fakeModel(state.calls));
  patch('logUsage', async (s, userId, endpoint, usage) => { state.usage.push({ userId, endpoint, usage }); });
  // descărcarea fișei (api/ai-pdf-context.js) — o fișă de 5 pagini
  const p = require.resolve('../api/ai-pdf-context.js');
  const prev = require.cache[p];
  const m = new Module(p); m.filename = p; m.loaded = true;
  m.exports = { downloadContentPdf: async () => state.pdf };
  require.cache[p] = m;
  delete require.cache[require.resolve('../api/fise.js')];
  const handler = require('../api/fise.js');
  const call = async (body) => { const res = fakeRes(); await handler({ method: 'POST', body, headers: {} }, res); return res; };
  try { await fn({ call, db, state, handler }); } finally {
    for (const [k, v] of Object.entries(saved)) ai[k] = v;
    if (prev) require.cache[p] = prev; else delete require.cache[p];
  }
}

test('api/fise.js: prima deschidere CITEȘTE fișa (o dată, plătită de platformă), a doua o servește din bancă fără AI', async () => {
  await withEndpoint(async ({ call, db, state }) => {
    let r = await call({ action: 'bank', contentId: 'c1' });
    assert.strictEqual(r.code, 200, JSON.stringify(r.body));
    assert.strictEqual(r.body.sheet.title, 'ALGEBRĂ — Fișă 4 — Radicali');
    assert.strictEqual(r.body.bank.status, 'ok');
    assert.strictEqual(r.body.bank.exercises, 9);
    assert.deepStrictEqual(r.body.bank.groups.map((g) => g.key), ['g1', 'g2', 'g3', 'g4']);
    assert.strictEqual(state.calls.length, 3);
    // costul: în ai_usage FĂRĂ utilizator (nu din creditele profesorului)
    assert.deepStrictEqual(state.usage.map((u) => [u.userId, u.endpoint]), [[null, 'fise:transcriere']]);
    assert.deepStrictEqual(state.rate, [{ budgets: false }], 'doar limita orară, fără bugetele profesorului');
    const row = db.fise_banca[0];
    assert.strictEqual(row.status, 'ok');
    assert.strictEqual(row.reading_since, null, 'lacătul s-a eliberat');
    assert.strictEqual(row.file_url, 'https://x/f4.pdf');
    assert.ok(row.cost_micro > 0);
    assert.deepStrictEqual(row.summary.map((g) => g.count), [2, 4, 1, 2]);
    // a doua oară: din bancă, fără niciun apel AI și fără abonament verificat
    state.calls.length = 0; state.premiumChecked = 0;
    r = await call({ action: 'bank', contentId: 'c1' });
    assert.strictEqual(r.code, 200);
    assert.strictEqual(r.body.bank.exercises, 9);
    assert.strictEqual(state.calls.length, 0);
    assert.strictEqual(state.premiumChecked, 0);
    assert.strictEqual(state.usage.length, 1);
  });
});

test('api/fise.js: list — fișele clasei (fără bareme), cu starea băncii; fișierul schimbat = necitită', async () => {
  await withEndpoint(async ({ call, db }) => {
    await call({ action: 'bank', contentId: 'c1' });
    let r = await call({ action: 'list', category: 'clasa-7' });
    assert.strictEqual(r.code, 200);
    assert.deepStrictEqual(r.body.sheets.map((s) => s.title), ['ALGEBRĂ — Fișă 2 — Mulțimi', 'ALGEBRĂ — Fișă 4 — Radicali']);
    const f4 = r.body.sheets.find((s) => s.id === 'c1');
    assert.strictEqual(f4.bank.exercises, 9);
    assert.deepStrictEqual(f4.bank.groups.map((g) => g.title), ['Nivel 1: Radicali', 'Nivel 2', 'Triunghiuri asemenea · MODEL 1', 'Exercițiul 2 — ecuații de forma $x^2+bx=0$']);
    assert.ok(!('exercises' in f4.bank.groups[0]) || typeof f4.bank.groups[0].exercises !== 'object', 'lista nu trimite enunțurile');
    assert.strictEqual(r.body.sheets.find((s) => s.id === 'c2').bank, null);
    // fișierul fișei s-a schimbat → banca veche nu mai e a ei
    db.content[0].file_url = 'https://x/f4-nou.pdf';
    r = await call({ action: 'list', category: 'clasa-7' });
    const f4b = r.body.sheets.find((s) => s.id === 'c1');
    assert.strictEqual(f4b.bank, null);
    assert.strictEqual(f4b.stale, true);
    // … și se citește din nou la următoarea deschidere
    r = await call({ action: 'bank', contentId: 'c1' });
    assert.strictEqual(r.code, 200);
    assert.strictEqual(db.fise_banca[0].file_url, 'https://x/f4-nou.pdf');
    // altă categorie decât clasele 5–12 → refuz
    r = await call({ action: 'list', category: 'evaluare-nationala' });
    assert.strictEqual(r.code, 400);
  });
});

test('api/fise.js: o citire în curs (lacăt) → 202 „se citește"; lacătul vechi (funcție oprită) se reia', async () => {
  await withEndpoint(async ({ call, db, state }) => {
    db.fise_banca.push({ content_id: 'c1', file_url: 'https://x/f4.pdf', status: 'pending', groups: [], summary: [], reading_since: new Date().toISOString(), updated_at: '2026-11-01T09:00:00.000Z', cost_micro: 0 });
    let r = await call({ action: 'bank', contentId: 'c1' });
    assert.strictEqual(r.code, 202);
    assert.strictEqual(r.body.reading, true);
    assert.strictEqual(r.body.bank, null);
    assert.strictEqual(state.calls.length, 0);
    // lacăt de acum 20 de minute → citirea pornește din nou
    db.fise_banca[0].reading_since = new Date(Date.now() - 20 * 60 * 1000).toISOString();
    r = await call({ action: 'bank', contentId: 'c1' });
    assert.strictEqual(r.code, 200);
    assert.strictEqual(db.fise_banca[0].status, 'ok');
    assert.strictEqual(db.fise_banca[0].reading_since, null);
  });
});

test('api/fise.js: doar profesorii; citirea cere abonament (adminul e scutit); „Citește din nou" doar adminul; migrarea nerulată → mesaj clar', async () => {
  await withEndpoint(async ({ call, db, state }) => {
    state.profile = { id: 'u1', role: 'elev', is_admin: false, subscription_status: 'active' };
    let r = await call({ action: 'list', category: 'clasa-7' });
    assert.strictEqual(r.code, 403);
    // profesor fără abonament: nu poate porni citirea unei fișe necitite
    state.profile = { id: 'u1', role: 'profesor', is_admin: false, subscription_status: 'none' };
    r = await call({ action: 'bank', contentId: 'c1' });
    assert.strictEqual(r.code, 402);
    assert.strictEqual(db.fise_banca.length, 0, 'fără lacăt rămas în urmă');
    // adminul citește fără abonament și poate cere recitirea
    state.profile = { id: 'a1', role: 'admin', is_admin: true, subscription_status: 'none' };
    r = await call({ action: 'bank', contentId: 'c1' });
    assert.strictEqual(r.code, 200);
    assert.strictEqual(state.calls.length, 3);
    r = await call({ action: 'bank', contentId: 'c1', refresh: true });
    assert.strictEqual(r.code, 200);
    assert.strictEqual(state.calls.length, 6, 'recitită');
    // profesorul cu refresh: ignorat (banca existentă)
    state.profile = { id: 'u1', role: 'profesor', is_admin: false, subscription_status: 'active' };
    r = await call({ action: 'bank', contentId: 'c1', refresh: true });
    assert.strictEqual(state.calls.length, 6);
    // o fișă care nu e a claselor 5–12
    r = await call({ action: 'bank', contentId: 'c4' });
    assert.strictEqual(r.code, 404);
    // o fișă ⭐ premium: banca ei doar cu abonament (și când e deja citită)
    db.content[0].is_free = false;
    state.profile = { id: 'u1', role: 'profesor', is_admin: false, subscription_status: 'none' };
    r = await call({ action: 'bank', contentId: 'c1' });
    assert.strictEqual(r.code, 402);
    state.profile = { id: 'u1', role: 'profesor', is_admin: false, subscription_status: 'active' };
    r = await call({ action: 'bank', contentId: 'c1' });
    assert.strictEqual(r.code, 200);
    db.content[0].is_free = true;
    // tabela lipsă → 503 cu numele fișierului SQL
    db.__missing = ['fise_banca'];
    r = await call({ action: 'bank', contentId: 'c2' });
    assert.strictEqual(r.code, 503);
    assert.strictEqual(r.body.code, 'FISE_SQL');
    assert.match(r.body.error, /supabase\/fise_banca\.sql/);
    // lista rămâne folosibilă, cu avertisment
    r = await call({ action: 'list', category: 'clasa-7' });
    assert.strictEqual(r.code, 200);
    assert.match(r.body.bankError, /fise_banca\.sql/);
    assert.strictEqual(r.body.sheets.length, 2);
  });
});

// ═══════════════ 3) testele diferite (src/lib/fiseTeste.js) ═════════════════
const G1 = { key: 'g1', title: 'Nivel 1', kind: 'nivel', instruction: 'Calculați:', exercises: Array.from({ length: 6 }, (_, i) => ({ n: String(i + 1), text: `$${i + 1}$` })) };
const G2 = { key: 'g2', title: 'Nivel 2', kind: 'nivel', instruction: null, exercises: [{ n: '1', text: 'a' }, { n: '2', text: 'b', figure: true }, { n: '3', text: 'c' }, { n: '4', text: 'd' }] };
const S1 = { sheetId: 's1', sheetTitle: 'ALGEBRĂ — Fișă 4 — Radicali' };
const S2 = { sheetId: 's2', sheetTitle: 'GEOMETRIE — Fișă 1 — Asemănarea' };

test('planul: fiecare test ia din fiecare grupă câte s-au cerut; fără repetări până se termină grupa, niciodată de două ori în același test', async () => {
  const L = await lib();
  const picks = [{ ...G1, ...S1, count: 2 }, { ...G2, ...S1, count: 1 }];
  assert.strictEqual(L.exercisesPerTest(picks), 3);
  // G1: 6/2 = 3 teste; G2: 3 (fără figură)/1 = 3 teste → 3 fără repetări
  assert.strictEqual(L.maxDistinctFiseTests(picks), 3);
  assert.strictEqual(L.maxDistinctFiseTests(picks, true), 3);
  const plan = L.planFiseTests(picks, { tests: 7, seed: 42 });
  assert.strictEqual(plan.length, 7);
  const seen = { g1: new Set(), g2: new Set() };
  plan.forEach((t, i) => {
    assert.deepStrictEqual(t.groups.map((g) => g.exercises.length), [2, 1]);
    for (const g of t.groups) {
      const ns = g.exercises.map((e) => e.n);
      assert.strictEqual(new Set(ns).size, ns.length, 'fără dubluri în același test');
      assert.deepStrictEqual([...ns].sort((a, b) => a - b), ns, 'în ordinea din fișă');
      if (i < 3) { ns.forEach((x) => assert.ok(!seen[g.key].has(x), `repetat prea devreme: ${g.key} ${x}`)); }
      ns.forEach((x) => seen[g.key].add(x));
    }
    if (i < 3) assert.strictEqual(t.repeats, 0);
  });
  assert.ok(plan.slice(3).every((t) => t.repeats > 0));
  // exercițiul cu figură nu intră (decât la cerere)
  assert.ok(plan.every((t) => t.groups[1].exercises.every((e) => e.n !== '2')));
  const cuFig = L.planFiseTests(picks, { tests: 4, seed: 1, withFigures: true });
  assert.ok(cuFig.some((t) => t.groups[1].exercises.some((e) => e.n === '2')));
  // același seed → aceleași teste
  assert.deepStrictEqual(L.planFiseTests(picks, { tests: 3, seed: 9 }), L.planFiseTests(picks, { tests: 3, seed: 9 }));
  // un număr cerut peste câte are grupa se limitează
  assert.strictEqual(L.exercisesPerTest([{ ...G2, ...S1, count: 99 }]), 3);
  assert.strictEqual(L.maxDistinctFiseTests([]), 0);
});

test('testul ca „exam": grupele = secțiuni cu cerința lor, numerotare continuă, punctaj întreg care face 100 cu oficiul', async () => {
  const L = await lib();
  const plan = L.planFiseTests([{ ...G1, ...S1, count: 4 }, { ...G2, ...S2, count: 3 }], { tests: 1, seed: 3 });
  const ex = L.testToExam(plan[0], { title: 'Test din fișe nr. 1', durationMin: 40, oficiu: 10, workSpace: false, category: 'clasa-7' });
  assert.strictEqual(ex.title, 'Test din fișe nr. 1');
  assert.strictEqual(ex.nameLine, true);
  assert.strictEqual(ex.workSpace, false);
  assert.strictEqual(ex.durationMin, 40);
  assert.match(ex.subtitle, /fișele „ALGEBRĂ — Fișă 4 — Radicali", „GEOMETRIE — Fișă 1 — Asemănarea"/);
  // două fișe → eticheta secțiunii are fișa în față
  assert.deepStrictEqual(ex.subjects.map((s) => s.label), ['Radicali · Nivel 1', 'Asemănarea · Nivel 2']);
  assert.strictEqual(ex.subjects[0].instructions, 'Calculați:');
  const items = ex.subjects.flatMap((s) => s.items);
  assert.deepStrictEqual(items.map((i) => i.number), ['1', '2', '3', '4', '5', '6', '7']);
  assert.strictEqual(items.reduce((s, i) => s + i.points, 0) + ex.oficiu, 100);
  assert.ok(items.every((i) => Number.isInteger(i.points)));
  assert.strictEqual(ex.subjects.reduce((s, x) => s + x.points, 0), 90);
  assert.deepStrictEqual(ex.source.sheets, ['s1', 's2']);
  assert.deepStrictEqual(L.distributePoints(7, 90), [13, 13, 13, 13, 13, 13, 12]);
  assert.strictEqual(L.shortSheetTitle('GEOMETRIE - Fisa 12: Asemănarea'), 'Asemănarea');
  assert.strictEqual(L.shortSheetTitle('Recapitulare finală'), 'Recapitulare finală');
});

test('materialul pentru AI: exercițiile testului în ordine, 1:1; cerința spune „păstrează" sau „schimbă numerele și notațiile"', async () => {
  const L = await lib();
  const [t] = L.planFiseTests([{ ...G1, ...S1, count: 2 }, { ...G2, ...S1, count: 2 }], { tests: 1, seed: 5 });
  const src = L.sourceTextOf(t, { category: 'clasa-7' });
  assert.match(src, /fișa „ALGEBRĂ — Fișă 4 — Radicali" \(clasa a VII-a\)/);
  assert.match(src, /\[Nivel 1\] Cerința: Calculați:/);
  assert.deepStrictEqual(src.split('\n').filter((l) => /^\d+\) /.test(l)).map((l) => l.split(')')[0]), ['1', '2', '3', '4']);
  const keep = L.topicFor(t, { dataMode: 'keep' });
  const mod = L.topicFor(t, { dataMode: 'modify' });
  assert.match(keep.split('\n')[0], /^Radicali — Nivel 1, Nivel 2$/);
  assert.match(keep, /EXACT cele 4 exerciții/);
  assert.match(keep, /Păstrează EXACT enunțurile, numerele și notațiile/);
  assert.match(mod, /ALTE numere și ALTE notații/);
});

test('testul de la AI (redactare) ca „exam", cu barem: itemul k în grupa exercițiului k; alt număr de itemi → o singură secțiune', async () => {
  const L = await lib();
  const [t] = L.planFiseTests([{ ...G1, ...S1, count: 2 }, { ...G2, ...S1, count: 2 }], { tests: 1, seed: 5 });
  const qs = [1, 2, 3, 4].map((i) => ({ statement: `E${i}`, answer: String(i * 10), explanation: `R${i}` }));
  let ex = L.aiExamFromQuestions(t, qs, { title: 'T', oficiu: 10 });
  assert.deepStrictEqual(ex.subjects.map((s) => [s.label, s.items.map((i) => i.statement)]), [['Nivel 1', ['E1', 'E2']], ['Nivel 2', ['E3', 'E4']]]);
  assert.strictEqual(ex.subjects[0].items[0].answer, '10');
  assert.strictEqual(ex.subjects[0].items[0].solution, 'R1');
  assert.match(ex.subtitle, /cu alte numere și notații/);
  ex = L.aiExamFromQuestions(t, qs.slice(0, 3).concat([{ statement: 'G', options: ['1', '2', '3', '4'], answer: 2 }, { statement: 'H', answer: 'x' }]), { title: 'T' });
  assert.strictEqual(ex.subjects.length, 1);
  assert.strictEqual(ex.subjects[0].items[3].answer, 'c');
  assert.strictEqual(ex.subjects[0].items.reduce((s, i) => s + i.points, 0), 90);
  // testul interactiv → „exam" pentru PDF / barem
  const q = L.quizToExam('Q', [{ statement: 'a', options: ['1', '2', '3', '4'], answer: 1, explanation: 'x' }, { statement: 'b', answer: '7' }], { oficiu: 20 });
  assert.deepStrictEqual(q.subjects[0].items.map((i) => [i.answer, i.points]), [['b', 40], ['7', 40]]);
});

test('„🔢 Schimbă numerele" la subiectele de examen: rămân doar exercițiile bifate (la BAC, subpunctele), cu punctajul lor', async () => {
  const L = await lib();
  const item = (n, extra = {}) => ({ number: String(n), statement: `I${n}`, points: 5, ...extra });
  const part = (l) => ({ label: l, text: `p${l}`, points: 5 });
  const bac = {
    title: 'BAC', durationMin: 180, oficiu: 10, totalPoints: 100,
    subjects: [
      { label: 'SUBIECTUL I', points: 30, items: [1, 2, 3, 4, 5, 6].map((n) => item(n)) },
      { label: 'SUBIECTUL al II-lea', points: 30, items: [1, 2].map((n) => item(n, { points: 15, parts: ['a', 'b', 'c'].map(part) })) },
      { label: 'SUBIECTUL al III-lea', points: 30, items: [1, 2].map((n) => item(n, { points: 15, parts: ['a)', 'b)', 'c)'].map(part) })) },
    ],
  };
  const sel = { items: { 1: [2, 5], 2: [1], 3: [] }, parts: { '2.1': ['a', 'c'] } };
  const f = L.filterExamBySelection(bac, sel);
  assert.deepStrictEqual(f.subjects.map((s) => s.label), ['SUBIECTUL I', 'SUBIECTUL al II-lea']);
  assert.deepStrictEqual(f.subjects[0].items.map((i) => i.number), ['2', '5']);
  assert.deepStrictEqual(f.subjects[1].items[0].parts.map((p) => p.label), ['a', 'c']);
  assert.strictEqual(f.subjects[1].items[0].points, 10);
  assert.deepStrictEqual(f.subjects.map((s) => s.points), [10, 10]);
  assert.strictEqual(f.oficiu, 0);
  assert.strictEqual(f.totalPoints, 20);
  assert.strictEqual(f.durationMin, 40); // 180 min × 20/90, rotunjit la 5
  // testul întreg rămâne neatins
  assert.strictEqual(L.filterExamBySelection(bac, sel, { complete: true }), bac);
});

// ═══════════════ 4) tipărirea: mai multe teste într-un document ═════════════
let printP = null;
function examPrint() {
  if (printP) return printP;
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'exam-print-'));
  fs.writeFileSync(path.join(dir, 'katex.mjs'), 'export const autoMath = (s) => String(s);\n');
  fs.writeFileSync(path.join(dir, 'figureRender.mjs'), 'export const renderFigure = () => null;\n');
  const src = read('src/lib/examPrint.js')
    .replace("from './katex'", "from './katex.mjs'")
    .replace("from './figureRender'", "from './figureRender.mjs'");
  fs.writeFileSync(path.join(dir, 'examPrint.mjs'), src);
  printP = import(pathToFileURL(path.join(dir, 'examPrint.mjs')).href);
  return printP;
}

test('tipărirea: fiecare test într-o secțiune de la pagină nouă; subtitlul fișei, rândul pentru nume, nota de subsol', async () => {
  const P = await examPrint();
  const L = await lib();
  const plan = L.planFiseTests([{ ...G1, ...S1, count: 2 }], { tests: 3, seed: 2 });
  const exams = plan.map((t, i) => L.testToExam(t, { title: `Test din fișe nr. ${i + 1}` }));
  const html = P.examsBodyHtml(exams);
  assert.strictEqual((html.match(/<section class="exam-doc">/g) || []).length, 3);
  assert.match(html, /Numele și prenumele/);
  assert.match(html, /Exerciții din fișa „ALGEBRĂ — Fișă 4 — Radicali"/);
  assert.match(html, /Exerciții din fișele ExamenMate/);
  assert.doesNotMatch(html, /generat de Profesorul Virtual/);
  // baremul nu are rândul pentru nume
  assert.doesNotMatch(P.examBodyHtml(exams[0], { withSolutions: true }), /Numele și prenumele/);
  // pagina nouă la tipărire
  const doc = P.printDocumentHtml('x', html);
  assert.match(doc, /\.exam-doc \+ \.exam-doc \{[^}]*break-before: page/);
  // testele vechi arată ca înainte
  assert.match(P.examBodyHtml({ title: 'Vechi', subjects: [] }), /Model de pregătire · generat de Profesorul Virtual/);
});

// ═══════════════════ 5) interfața și migrarea ═══════════════════════════════
test('fila se numește „👥 Test interactiv pe grupă (teste diferite)"; „Generează acum testele" a plecat din testul pe grupă', () => {
  const pv = read('src/pages/ProfesorVirtual.jsx');
  assert.match(pv, /label: '👥 Test interactiv pe grupă \(teste diferite\)'/);
  assert.doesNotMatch(pv, /label: '👥 Test pe grupă \(teste diferite\)'/);
  const ga = read('src/components/GroupAssignment.jsx');
  assert.doesNotMatch(ga, /genNow|SRC_GEN|toggleGenNow|<VariantGenerator|<CombinedPdfGenerator/);
  assert.doesNotMatch(ga, /import VariantGenerator|import\('\.\/CombinedPdfGenerator'\)/);
  // în locul lui: trimiterea spre generator + testele aduse de acolo, bifate
  assert.match(ga, /navigate\('\/profesor-virtual\?tab=interactive&mod=elevi'\)/);
  assert.match(ga, /takePreset\(\)/);
  assert.match(ga, /setSources\(\['personal'\]\)/);
  assert.match(ga, /setPick\('manual'\)/);
});

test('„🧩 Generează exerciții/teste interactive/PDF" are modul „👥 Teste diferite / elev", cu câmpul „Nr. teste diferite / elev"', () => {
  const pv = read('src/pages/ProfesorVirtual.jsx');
  assert.match(pv, /import TesteDiferite from '\.\.\/components\/TesteDiferite'/);
  assert.match(pv, /👥 Teste diferite \/ elev/);
  assert.match(pv, /params\.get\('mod'\) === 'elevi'/);
  assert.match(pv, /\{mod === 'elevi' \? <TesteDiferite \/> : <InteractiveSingle \/>\}/);
  const td = read('src/components/TesteDiferite.jsx');
  assert.match(td, /Nr\. teste diferite \/ elev/);
  assert.match(td, /type="number" min=\{1\} max=\{MAX_TESTE\}/);
  // examenele ȘI clasele 5–12
  assert.match(td, /EXAM_CATS\.includes\(c\.value\)/);
  assert.match(td, /c\.value\.startsWith\('clasa-'\)/);
  // cele trei surse: subiectele de examen, fișele claselor, variantele unui test AI
  assert.match(td, /<CombinedPdfGenerator[^>]*dataMode=\{dataMode\}/);
  assert.match(td, /<FiseTestGenerator n=\{n\}/);
  assert.match(td, /<VariantGenerator poolSize=\{n\}/);
  // varianta care schimbă numerele și notațiile
  assert.match(td, /🔢 Schimbă numerele și notațiile/);
  assert.match(td, /setDataMode\('modify'\)/);
  // spre testul pe grupă
  assert.match(td, /👥 Folosește-le în testul interactiv pe grupă/);
  assert.match(td, /savePreset\(gata\)/);
  assert.match(td, /navigate\('\/profesor-virtual\?tab=grupa'\)/);
});

test('fișele: bifele pe nivele / tipuri, cu numărul de exerciții pe test; generarea fără AI la PDF cu datele păstrate', () => {
  const g = read('src/components/FiseTestGenerator.jsx');
  assert.match(g, /aiClient\.fiseList\(\{ category \}\)/);
  assert.match(g, /aiClient\.fiseBank\(\{ contentId: id, refresh: ref \}\)/);
  assert.match(g, /type="checkbox" checked=\{c > 0\}/);
  assert.match(g, /\/ test/);
  assert.match(g, /const aiNeeded = dataMode === 'modify' \|\| output === 'interactive';/);
  assert.match(g, /if \(!aiNeeded\) \{[\s\S]*?testToExam\(t,/);
  assert.match(g, /aiClient\.generateInteractive\(\{[\s\S]*?sourceText: sourceTextOf\(t, \{ category \}\)/);
  assert.match(g, /nextNumberedTitle\('Test din fișe nr\.'\)/);
  const c = read('src/lib/aiClient.js');
  assert.match(c, /fiseList: \(\{ category \}\) => post\('\/api\/fise', \{ action: 'list', category \}\)/);
  assert.match(c, /\.in\('kind', \['pdf', 'exam', 'interactive'\]\)/);
  const cp = read('src/components/CombinedPdfGenerator.jsx');
  assert.match(cp, /aiClient\.generateExam\(\{ examType, dataMode: 'modify'/);
  assert.match(cp, /filterExamBySelection\(res\.exam, selectie/);
  assert.match(cp, /kind: 'exam', title: titlu, category: cfg\.category/);
});

test('migrarea supabase/fise_banca.sql: RLS + GRANT în același fișier, fără acces anonim (CLAUDE.md)', () => {
  const sql = read('supabase/fise_banca.sql');
  assert.match(sql, /create table if not exists public\.fise_banca/);
  assert.match(sql, /alter table public\.fise_banca enable row level security;/);
  assert.match(sql, /grant select, insert, update, delete on public\.fise_banca to authenticated;/);
  assert.match(sql, /grant select, insert, update, delete on public\.fise_banca to service_role;/);
  assert.doesNotMatch(sql, /to anon/);
  assert.match(sql, /create policy fise_banca_service on public\.fise_banca for all to service_role/);
  assert.match(sql, /reading_since/);
  assert.match(sql, /summary/);
  assert.match(sql, /check \(status in \('pending', 'ok', 'partial'\)\)/);
});

test('GPT-6.x peste tot în locul lui GPT-5.6: implicitele serverului și descrierile din site', () => {
  assert.match(ai.PDF_MODEL, /gpt-6\.1-terra$/);
  assert.match(ai.VISION_MODEL, /gpt-6\.1-terra$/);
  assert.match(ai.GEN_MODEL, /gpt-6\.1-sol$/);
  const m = read('src/lib/aiModels.js');
  assert.match(m, /'GPT-6\.1 Terra', 'GPT-6\.1 Sol'/);
  assert.doesNotMatch(m, /GPT-5\.6/);
});
