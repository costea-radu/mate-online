// Teste pentru AGENTUL DE VERIFICARE a materialelor (Admin → 🔎 Verificare
// materiale): verificările automate (JavaScript, LaTeX cu un singur backslash,
// formule), aplicarea corecturilor pe HTML (cu toleranță, fără să strice
// testul), corectura PDF-urilor (pe loc + ERATĂ, textul corect citit o singură
// dată de AI-ul site-ului) și fluxul HTTP complet: verificare → ciornă →
// publicare → anulare, pe un Supabase în memorie, cu modelul simulat.
process.env.ANTHROPIC_API_KEY = 'test-key';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const V = require('../api/_lib/verificare');
const { createFakeSupabase, fakeRes } = require('./tools/fakeSupabase');

const TEMPLATE = fs.readFileSync(path.join(__dirname, '../api/_lib/template-standard.html'), 'utf8');

// ─── 1. verificările automate ────────────────────────────────────────────────
test('șablonul standard al testelor trece verificările automate (JS valid, LaTeX dublat, scor raportat)', () => {
  const c = V.staticChecks(TEMPLATE);
  assert.deepStrictEqual(c.syntax, []);
  assert.deepStrictEqual(c.latex, []);
  assert.deepStrictEqual(c.katex, []);
  assert.strictEqual(c.scoreReport, true);
});

test('LaTeX cu UN backslash într-un șir JavaScript e găsit și reparat (inclusiv delimitatorii \\( \\))', () => {
  const html = `<div>$\\frac{1}{2}$ e corect în HTML</div><script>
var EX=[{q:'Calculați \\frac{1}{2} + \\sqrt{4}', a:'\\(\\dfrac{3}{2}\\)', ok:'a'}, {q:"Corect: \\\\(\\\\frac{1}{3}\\\\)", ok:'b'}];
var linie = 'rand\\nnou'; var re = /\\d+\\.\\d/; // comentariu cu \\frac
</script>`;
  const issues = V.latexEscapeIssues(html);
  assert.strictEqual(issues.length, 2, 'doar cele două șiruri stricate (nu \\n, nu regex, nu comentariul, nu HTML-ul)');
  assert.deepStrictEqual(issues[0].commands, ['frac', 'sqrt']);
  assert.deepStrictEqual(issues[1].commands, ['(', 'dfrac', ')']);
  assert.strictEqual(V.fixLatexLiteral('\\(\\dfrac{3}{2}\\)'), '\\\\(\\\\dfrac{3}{2}\\\\)');
  // corectura automată (editare „all") face fișierul curat
  const st = V.staticIssues(V.staticChecks(html));
  const r = V.applyEdits(html, st.flatMap((i) => i.edits));
  assert.ok(r.results.every((x) => x.ok));
  assert.deepStrictEqual(V.latexEscapeIssues(r.text), []);
  assert.ok(r.text.includes("q:'Calculați \\\\frac{1}{2} + \\\\sqrt{4}'"));
});

test('lexerul JavaScript: comentarii, expresii regulate și șabloane `${…}` nu încurcă șirurile', () => {
  const code = 'var a = "x/y"; var r = /a"b\\/c/g; // "nu e șir"\nvar t = `text ${f("in")} mai ${`imbricat`} gata`; /* \'nici asta\' */ var b = \'z\';';
  const s = V.jsStrings(code).map((x) => `${x.q}${x.raw}`);
  assert.deepStrictEqual(s, ['"x/y', '`text ', '"in', '` mai ', '`imbricat', '` gata', "'z"]);
});

test('JavaScript stricat = problemă gravă; formula cu acoladă neînchisă = indiciu pentru model', () => {
  const html = '<p>$\\sqrt{2$</p><script>function f( { return 1 }</script>';
  const c = V.staticChecks(html);
  assert.strictEqual(c.syntax.length, 1);
  assert.strictEqual(c.katex.length, 1);
  const st = V.staticIssues(c);
  assert.strictEqual(st[0].severity, 'critica');
  assert.strictEqual(st[0].category, 'functionalitate');
});

// ─── 2. corecturile pe text ───────────────────────────────────────────────────
test('applyEdits: exact, fragment ambiguu refuzat, spații diferite, backslash-uri citate greșit', () => {
  const src = "var EX1 = [\n  {q:'2+2', a:'3', b:'4', ok:'a'},\n  {q:'3+3', a:'6', b:'5', ok:'a'}\n];\nvar f = '\\\\frac{1}{2}';";
  // exact
  let r = V.applyEdits(src, [{ find: "{q:'2+2', a:'3', b:'4', ok:'a'}", replace: "{q:'2+2', a:'3', b:'4', ok:'b'}" }]);
  assert.strictEqual(r.results[0].ok, true);
  assert.ok(r.text.includes("ok:'b'}"));
  // ambiguu: „ok:'a'" apare de două ori
  r = V.applyEdits(src, [{ find: "ok:'a'", replace: "ok:'b'" }]);
  assert.strictEqual(r.results[0].ok, false);
  assert.match(r.results[0].reason, /de 2 ori/);
  // spații/rânduri diferite
  r = V.applyEdits(src, [{ find: "{q:'3+3',   a:'6',\n b:'5', ok:'a'}", replace: "{q:'3+3', a:'6', b:'5', ok:'a', e:'6'}" }]);
  assert.strictEqual(r.results[0].ok, true);
  assert.strictEqual(r.results[0].how, 'spatii_flexibile');
  // modelul a citat „\frac" cu un backslash, fișierul are „\\frac"
  r = V.applyEdits(src, [{ find: "'\\frac{1}{2}'", replace: "'\\frac{1}{3}'" }]);
  assert.strictEqual(r.results[0].ok, true);
  assert.strictEqual(r.results[0].how, 'backslash_dublat');
  assert.ok(r.text.includes("'\\\\frac{1}{3}'"));
  // JSON-ul modelului a stricat „\frac" în form-feed + „rac"
  r = V.applyEdits("x = '$\\frac{1}{4}$'", [{ find: "'$\frac{1}{4}$'", replace: "'$\frac{1}{5}$'" }]);
  assert.strictEqual(r.results[0].ok, true);
  assert.ok(r.text.includes('\\frac{1}{5}'));
});

test('validatePatched: o corectură care strică JavaScript-ul nu trece', () => {
  const before = '<script>var EX=[{q:"a", ok:"b"}];</script>';
  assert.strictEqual(V.validatePatched(before, '<script>var EX=[{q:"a", ok:"c"}];</script>').ok, true);
  const bad = V.validatePatched(before, '<script>var EX=[{q:"a", ok:"c"];</script>');
  assert.strictEqual(bad.ok, false);
  assert.match(bad.problems[0], /JavaScript/);
});

test('lineDiff: zonele schimbate, cu context și numerele rândurilor', () => {
  const a = ['unu', 'doi', 'trei', 'patru', 'cinci', 'sase', 'sapte', 'opt'].join('\n');
  const b = ['unu', 'doi', 'TREI', 'patru', 'cinci', 'sase', 'sapte', 'opt', 'noua'].join('\n');
  const h = V.lineDiff(a, b, { context: 1 });
  assert.strictEqual(h.length, 2);
  assert.deepStrictEqual(h[0].lines, [[' ', 'doi'], ['-', 'trei'], ['+', 'TREI'], [' ', 'patru']]);
  assert.strictEqual(h[0].startA, 2);
  assert.deepStrictEqual(h[1].lines.slice(-1), [['+', 'noua']]);
});

test('normalizeReport: problemele ordonate după gravitate, id-uri stabile, „patch" fără editări → manual', () => {
  const r = V.normalizeReport({
    verdict: 'probleme_grave', summary: 'x', items_checked: 2, items: [{ ref: 'S. I, ex. 1', status: 'ok', answer: 'b' }],
    issues: [
      { severity: 'minora', category: 'scriere_diacritice', location: 'ex. 2', title: 'diacritice', description: '', evidence: 'sa', correct: 'să', confidence: 'sigur', fix_kind: 'patch', edits: [{ find: ' sa ', replace: ' să ' }], fix_note: '' },
      { severity: 'critica', category: 'cheie_gresita', location: 'ex. 1', title: 'cheia', description: '', evidence: "ok:'c'", correct: 'b', confidence: 'sigur', fix_kind: 'patch', edits: [], fix_note: '' },
    ],
  }, { kind: 'html' });
  assert.deepStrictEqual(r.issues.map((i) => [i.id, i.severity, i.fix_kind]), [['i1', 'critica', 'manual'], ['i2', 'minora', 'patch']]);
  assert.strictEqual(V.statusOf(r.issues), 'critic');
  assert.strictEqual(V.statusOf(r.issues.map((i) => ({ ...i, fixed: true }))), 'ok');
});

test('numele fișierului corectat: același folder, sufix cu data (fără să se adune sufixe)', () => {
  const now = new Date(Date.UTC(2026, 9, 5, 9, 7, 3));
  assert.strictEqual(V.correctedPath('interactive/evaluare-nationala/171_test 3.html', now), 'interactive/evaluare-nationala/171_test 3__corectat-20261005-090703.html');
  assert.strictEqual(V.correctedPath('pdf/x/a__corectat-20261001-1010.pdf', now), 'pdf/x/a__corectat-20261005-090703.pdf');
});

// ─── 3. PDF: corectura pe loc + ERATĂ; AI-ul site-ului citește textul corect ─
async function samplePdf() {
  const { PDFDocument } = require('pdf-lib');
  const fontkit = require('@pdf-lib/fontkit');
  const doc = await PDFDocument.create();
  doc.registerFontkit(fontkit);
  const font = await doc.embedFont(fs.readFileSync(path.join(__dirname, '../api/_lib/fonts/LiberationSerif-Regular.ttf')), { subset: true });
  const page = doc.addPage([595, 842]);
  page.drawText('SUBIECTUL I – Încercuiește litera răspunsului corect.', { x: 50, y: 780, size: 12, font });
  page.drawText('1. Rezultatul calculului 2 + 3 · 4 este egal cu 20.', { x: 50, y: 750, size: 12, font });
  page.drawText('2. Soluția ecuației 2x − 6 = 0 este x = 4.', { x: 50, y: 730, size: 12, font });
  page.drawText('Răspuns: b) 14', { x: 300, y: 700, size: 11, font });
  return Buffer.from(await doc.save());
}

test('PDF: textul greșit se rescrie pe loc, restul intră în ERATĂ; AI-ul citește textul corect o singură dată', async () => {
  const buf = await samplePdf();
  const r = await V.patchPdf(buf, [
    { id: 'i1', page: 1, find: 'egal cu 20.', replace: 'egal cu 14.' },
    { id: 'i2', page: 1, find: 'este x = 4.', replace: 'este x = 3.' },
    { id: 'i3', page: 1, find: 'Răspuns: b) 14', replace: 'Răspuns: b) 14 (2 + 12 = 14)' },
    { id: 'i4', page: 1, find: 'nu există în pagină', replace: 'x' },
  ], { erratum: [{ id: 'i5', location: 'S. II, ex. 3 (figura)', text: 'AB = 6 cm, ∠ABC = 90°' }], title: 'Test', dateLabel: '5 octombrie 2026' });
  assert.deepStrictEqual(r.placed.map((p) => p.id), ['i1', 'i2', 'i3']);
  assert.deepStrictEqual(r.errata.map((e) => e.id), ['i5', 'i4']);
  const { pdfText } = require('../api/_lib/pdftext');
  const { pageTexts } = require('../api/_lib/pdfpages');
  const text = await pdfText(r.pdf, 5000);
  assert.ok(text.includes('egal cu 14.') && !text.includes('20.'), text);
  assert.ok(text.includes('este x = 3.') && !text.includes('x = 4'), text);
  assert.strictEqual(text.split('Răspuns: b) 14').length - 1, 1, 'textul suprapus nu se citește de două ori');
  const pages = await pageTexts(r.pdf);
  assert.strictEqual(pages.length, 2, 'pagina de ERATĂ e adăugată la final');
  assert.match(pages[1], /ERATĂ/);
  assert.match(pages[1], /∠ABC = 90°/);
  // a doua corectură pe același PDF: adnotarea se completează, nu se pierde prima
  const r2 = await V.patchPdf(r.pdf, [{ id: 'j1', page: 1, find: 'litera răspunsului', replace: 'litera răspunsului (o singură literă)' }], {});
  const t2 = await pdfText(r2.pdf, 5000);
  assert.ok(t2.includes('egal cu 14.') && t2.includes('(o singură literă)'), t2);
});

// ─── 4. fluxul HTTP: verificare → ciornă → publicare → anulare ──────────────
const ai = require('../api/_lib/ai');
const handler = require('../api/content-check');
const ADMIN = '33333333-3333-4333-8333-333333333333';
const C_HTML = 'cccccccc-0000-4000-8000-000000000001';
const C_PDF = 'cccccccc-0000-4000-8000-000000000002';
let fake = null;
ai.admin = () => fake;
ai.authUser = async (req) => { const u = req.headers['x-user']; if (!u) { const e = new Error('Neautentificat.'); e.status = 401; throw e; } return u; };
ai.logUsage = async () => {};
async function call(action, body = {}, user = ADMIN) {
  const res = fakeRes();
  await handler({ method: 'POST', headers: user ? { 'x-user': user } : {}, query: {}, body: { action, ...body } }, res);
  return res;
}
const TEST_HTML = `<!doctype html><html><body><div id="l"></div><script>
var EX1 = [
  {q:'Rezultatul calculului \\\\(2+3\\\\cdot 4\\\\) este:', a:'20', b:'14', c:'24', d:'9', ok:'a', e:'Răspuns: b) 14'},
  {q:'Calculați \\frac{1}{2} + 1', a:'1,5', b:'2', c:'3', d:'0', ok:'a', e:'1,5'}
];
document.getElementById('l').textContent = EX1.length;
parent.postMessage({type:'MATE_SCORE', score: 100, maxScore: 100}, '*');
</script></body></html>`;

function seed() {
  return {
    profiles: [{ id: ADMIN, full_name: 'Radu', is_admin: true }],
    content: [
      { id: C_HTML, title: 'Test EN 7', category: 'evaluare-nationala', subcategory: 'teste-interactive', content_type: 'interactive', is_free: true, file_url: 'https://fake.supabase/storage/v1/object/public/content-files-free/interactive/evaluare-nationala/1_test.html', created_at: '2026-09-01T00:00:00Z' },
      { id: C_PDF, title: 'Fișă 8', category: 'clasa-8', content_type: 'pdf', is_free: false, file_url: 'https://fake.supabase/storage/v1/object/public/content-files/pdf/clasa-8/2_fisa.pdf', created_at: '2026-09-02T00:00:00Z' },
    ],
    content_checks: [],
  };
}
// răspunsul „modelului" (JSON pe schemă), ca de la API-ul Anthropic
let modelReply = null;
const sent = [];
global.fetch = async (url, opts) => {
  assert.match(String(url), /api\.anthropic\.com/);
  const body = JSON.parse(opts.body);
  sent.push(body);
  return { ok: true, status: 200, json: async () => ({ content: [{ type: 'text', text: JSON.stringify(modelReply) }], stop_reason: 'end_turn', usage: { input_tokens: 12000, output_tokens: 3000 } }) };
};

test('HTML: verificare (automat + AI) → ciornă → previzualizare → publicare → anulare', async () => {
  fake = createFakeSupabase(seed());
  fake.db.files.set('content-files-free/interactive/evaluare-nationala/1_test.html', Buffer.from(TEST_HTML));
  modelReply = {
    document_kind: 'test_interactiv', official: false, items_checked: 2,
    items: [{ ref: 'item 1', status: 'problema', answer: 'b' }, { ref: 'item 2', status: 'ok', answer: 'a' }],
    verdict: 'probleme_grave', summary: 'Cheia itemului 1 e greșită.',
    issues: [{
      severity: 'critica', category: 'cheie_gresita', location: 'itemul 1', page: null, title: 'Cheia indică 20, corect e 14',
      description: '2 + 3·4 = 14, deci varianta b.', evidence: "ok:'a', e:'Răspuns: b) 14'", correct: 'b) 14', confidence: 'sigur',
      fix_kind: 'patch', edits: [{ find: "d:'9', ok:'a', e:'Răspuns: b) 14'", replace: "d:'9', ok:'b', e:'Răspuns: b) 14'" }], fix_note: 'cheia devine b',
    }],
    previous_review: [],
  };
  const r = await call('check', { contentId: C_HTML, model: 'claude-opus-5-5', effort: 'high' });
  assert.strictEqual(r.statusCode, 200, JSON.stringify(r.body));
  const chk = r.body.check;
  // cererea către model: Opus 5.5, gândire adaptivă, effort, schema JSON, fără CSS
  const req = sent[sent.length - 1];
  assert.strictEqual(req.model, 'claude-opus-5-5');
  assert.deepStrictEqual(req.thinking, { type: 'adaptive' });
  assert.strictEqual(req.output_config.effort, 'high');
  assert.strictEqual(req.output_config.format.type, 'json_schema');
  assert.strictEqual(req.stream, true);
  // problemele: cea automată (LaTeX cu un backslash) + cea a modelului
  assert.deepStrictEqual(chk.issues.map((i) => [i.id, i.source, i.severity]), [['s1', 'automat', 'majora'], ['i1', 'ai', 'critica']]);
  assert.ok(chk.issues.every((i) => i.fixable === true));
  assert.strictEqual(chk.status, 'critic');
  assert.ok(chk.cost_micro > 0);

  // ciorna: ambele corecturi într-un fișier NOU; materialul de pe site încă neatins
  const p = await call('prepare_fix', { checkId: chk.id, issueIds: ['s1', 'i1'] });
  assert.strictEqual(p.statusCode, 200, JSON.stringify(p.body));
  assert.ok(p.body.preview.edits.every((e) => e.ok));
  const draft = p.body.check.draft;
  assert.match(draft.path, /1_test__corectat-\d{8}-\d{6}\.html$/);
  const fixed = fake.db.files.get(`content-files-free/${draft.path}`).toString('utf8');
  assert.ok(fixed.includes("ok:'b', e:'Răspuns: b) 14'"));
  assert.ok(fixed.includes("q:'Calculați \\\\frac{1}{2} + 1'"));
  assert.strictEqual(fake.db.tables.content[0].file_url, seed().content[0].file_url, 'nepublicat încă');
  const pv = await call('preview', { checkId: chk.id, which: 'draft' });
  assert.ok(pv.body.html.includes("ok:'b'"));

  // publicare
  const pub = await call('publish_fix', { checkId: chk.id });
  assert.strictEqual(pub.statusCode, 200, JSON.stringify(pub.body));
  assert.strictEqual(fake.db.tables.content[0].file_url, draft.url);
  assert.strictEqual(pub.body.check.status, 'reparat');
  assert.ok(fake.db.files.has('content-files-free/interactive/evaluare-nationala/1_test.html'), 'originalul rămâne');

  // anulare: înapoi la original, fișierul corectat se șterge
  const u = await call('undo_fix', { checkId: chk.id });
  assert.strictEqual(u.statusCode, 200, JSON.stringify(u.body));
  assert.strictEqual(fake.db.tables.content[0].file_url, seed().content[0].file_url);
  assert.ok(!fake.db.files.has(`content-files-free/${draft.path}`));
  assert.strictEqual(u.body.check.status, 'critic');
});

test('HTML: o corectură care ar strica testul e refuzată; fișierul schimbat după verificare → „verifică din nou"', async () => {
  fake = createFakeSupabase(seed());
  fake.db.files.set('content-files-free/interactive/evaluare-nationala/1_test.html', Buffer.from(TEST_HTML));
  modelReply = { document_kind: 'test_interactiv', official: false, items_checked: 2, items: [], verdict: 'probleme_grave', summary: 's', previous_review: [],
    issues: [{ severity: 'critica', category: 'cheie_gresita', location: 'itemul 1', page: null, title: 't', description: 'd', evidence: '', correct: '', confidence: 'sigur', fix_kind: 'patch', edits: [{ find: "d:'9', ok:'a',", replace: "d:'9', ok:'b'" }], fix_note: '' }] };
  const r = await call('check', { contentId: C_HTML });
  const p = await call('prepare_fix', { checkId: r.body.check.id, issueIds: ['i1'] });
  assert.strictEqual(p.statusCode, 422, 'virgula lipsă ar strica JavaScript-ul');
  assert.match(p.body.error, /nu e sigură/);
  // adminul re-încarcă fișierul între timp
  fake.db.tables.content[0].file_url = 'https://fake.supabase/storage/v1/object/public/content-files-free/interactive/evaluare-nationala/9_nou.html';
  const p2 = await call('prepare_fix', { checkId: r.body.check.id, issueIds: ['s1'] });
  assert.strictEqual(p2.statusCode, 409);
  const ov = await call('overview');
  assert.strictEqual(ov.body.latest[C_HTML].stale, true);
});

test('PDF: verificarea trimite PDF-ul ca document; corectura merge pe loc + ERATĂ; „nu e o greșeală" ajunge în promptul următor', async () => {
  fake = createFakeSupabase(seed());
  fake.db.files.set('content-files/pdf/clasa-8/2_fisa.pdf', await samplePdf());
  modelReply = { document_kind: 'fisa_pdf', official: false, items_checked: 2, items: [], verdict: 'probleme_grave', summary: 's', previous_review: [],
    issues: [
      { severity: 'critica', category: 'rezultat_gresit', location: 'ex. 1', page: 1, title: 'Rezultat greșit', description: '2+12=14', evidence: 'egal cu 20.', correct: '14', confidence: 'sigur', fix_kind: 'patch', edits: [{ find: 'egal cu 20.', replace: 'egal cu 14.' }], fix_note: '' },
      { severity: 'majora', category: 'figura', location: 'ex. 2 (figura)', page: 1, title: 'Figura are AB = 8', description: '', evidence: '', correct: 'AB = 6 cm', confidence: 'probabil', fix_kind: 'manual', edits: [], fix_note: 'refă figura' },
      { severity: 'info', category: 'altceva', location: 'tot', page: null, title: 'sugestie', description: '', evidence: '', correct: '', confidence: 'probabil', fix_kind: 'none', edits: [], fix_note: '' },
    ] };
  const r = await call('check', { contentId: C_PDF });
  assert.strictEqual(r.statusCode, 200, JSON.stringify(r.body));
  const req = sent[sent.length - 1];
  const doc = req.messages[0].content.find((b) => b.type === 'document');
  assert.strictEqual(doc.source.media_type, 'application/pdf');
  const chk = r.body.check;
  assert.strictEqual(chk.issues[0].fix_mode, 'pe_loc');
  const p = await call('prepare_fix', { checkId: chk.id, issueIds: ['i1', 'i2'] });
  assert.strictEqual(p.statusCode, 200, JSON.stringify(p.body));
  assert.deepStrictEqual(p.body.preview.placed.map((x) => x.id), ['i1']);
  assert.deepStrictEqual(p.body.preview.errata.map((x) => x.id), ['i2']);
  assert.match(p.body.preview.url, /\/sign\/content-files\//);
  // „nu e o greșeală" → la verificarea următoare, modelul află
  await call('dismiss', { checkId: chk.id, issueId: 'i3', note: 'e doar o sugestie' });
  await call('check', { contentId: C_PDF });
  const last = sent[sent.length - 1].messages[0].content.map((b) => b.text || '').join('\n');
  assert.match(last, /NE-probleme/);
  assert.match(last, /sugestie \(adminul: e doar o sugestie\)/);
});

test('doar adminul are acces; fără SQL → mesaj clar', async () => {
  fake = createFakeSupabase({ ...seed(), profiles: [{ id: 'u1', is_admin: false }, { id: ADMIN, is_admin: true }] });
  const r = await call('overview', {}, 'u1');
  assert.strictEqual(r.statusCode, 403);
  fake.db.failTables.add('content_checks');
  const ov = await call('overview');
  assert.strictEqual(ov.statusCode, 200);
  assert.strictEqual(ov.body.setup, false);
  const c = await call('check', { contentId: C_HTML });
  assert.ok([502, 503].includes(c.statusCode));
});
