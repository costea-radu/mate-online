// =====================================================================
// test/indicii-test.test.js — 💡 indiciile exercițiilor fără indicii în fișier
// (26 nov. 2026: „Nu apar indicii la testele grilă de EN. Fă să apară ca la BAC")
//   api/_lib/indiciiTest.js (exercițiile din HTML, verificarea indiciilor, cache-ul),
//   api/indicii.js, src/lib/tutorBridge.js (MATE_HINTS_REQ / MATE_HINTS),
//   src/pages/InteractiveViewer.jsx, cronul din api/ai-ingest.js
// =====================================================================
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const IT = require('../api/_lib/indiciiTest');
const { createFakeSupabase } = require('./tools/fakeSupabase');

const read = (f) => fs.readFileSync(path.join(__dirname, '..', f), 'utf8');
const ID = '11111111-1111-4111-8111-111111111111';
const ID_PDF = '22222222-2222-4222-8222-222222222222';

// un test de EN în miniatură, cu forma celor de pe site: Subiectul I din EX1 (randat în
// #exList1), Subiectul II scris direct în pagină, Subiectul al III-lea în PROBS
const HTML_EN = `<!doctype html><html><head><style>.card{padding:1px}</style></head><body>
<div class="sec-title">Subiectul I <span>alegeți varianta corectă</span></div>
<div id="exList1"></div>
<div class="sec-title">Subiectul II <span>Geometrie</span></div>
<div class="card" data-correct="c" data-points="5">
  <div class="card-hdr"><div class="nr">1</div><div class="qbody">
    <div class="qtxt">Triunghiul DEF este dreptunghic în D. Proiecția punctului H pe DF este:</div>
    <div class="fig"><svg viewBox="0 0 10 10"><text>K</text></svg></div></div></div>
  <div class="opts"><div class="opt" data-opt="a"><div class="olbl">a</div><div class="otxt">D</div></div>
  <div class="opt" data-opt="b"><div class="olbl">b</div><div class="otxt">G</div></div>
  <div class="opt" data-opt="c"><div class="olbl">c</div><div class="otxt">K</div></div>
  <div class="opt" data-opt="d"><div class="olbl">d</div><div class="otxt">E</div></div></div>
  <div class="expl"><strong>Răspuns: c) K</strong><br>Perpendiculara din H pe DF e paralelă cu DE.</div>
</div>
<div class="card" data-correct="a" data-points="5">
  <div class="card-hdr"><div class="nr">2</div><div class="qbody"><div class="qtxt">Aria pătratului cu latura de 3 cm este:</div>
  <button class="btn-hint">💡 Arată indiciile</button></div></div>
  <div class="opts"><div class="opt" data-opt="a"><div class="otxt">9 cm²</div></div><div class="opt" data-opt="b"><div class="otxt">6 cm²</div></div></div>
  <div class="expl">Aria = latura².</div>
</div>
<div class="sec-title">Subiectul al III-lea</div>
<script>
const EX1 = [
  {q:'Rezultatul calculului \\\\(85 - 6 \\\\cdot 9\\\\) este egal cu:', a:'711', b:'31', c:'76', d:'85', ok:'b',
   e:'<strong>Răspuns: b) 31</strong><br>Înmulțirea se face înaintea scăderii.'},   // comentariu
  {q:"Opusul numărului \\\\(-17\\\\) este:", a:'17', b:'-17', ok:'a', e:'Opusul lui x este -x.',},
];
const list1 = document.getElementById('exList1');
EX1.forEach((ex, i) => { const div = document.createElement('div'); div.className = 'card'; list1.appendChild(div); });
(function(){
"use strict";
var PROBS=[
{"n": 1, "pa": 2, "pb": 3, "lead": "Ana are o sumă de bani.", "qa": "Ce sumă mai are?", "qb": "Ce sumă avea?", "steps": [
  {"p": "a", "t": "calc", "d": "Restul după prima zi", "c": ["15 : 3", "15 · 3"], "ci": 1, "a": 45, "u": "lei", "pts": 1},
  {"p": "b", "t": "mc", "d": "Ce fracție rămâne?", "o": ["5/6", "1/6"], "ci": 1, "pts": 1, "help": "Din întreg scazi partea cheltuită."}]},
{"n": 2, "pa": 2, "pb": 3, "lead": "E(x) = ( <span class=\\"frac\\"><span class=\\"num\\">5</span><span class=\\"den\\">x+4</span></span> )", "qa": "Arată că...", "qb": "Rezolvă.", "steps": [
  {"p": "a", "t": "tf", "d": "(x+4)(x−2) = x²+2x−8", "ok": true, "just": "Desfac parantezele.", "pts": 1},
  {"p": "b", "t": "num", "d": "x =", "a": 1, "pts": 1}]}
];
var ST={}, cur=null;
})();
</script></body></html>`;

// ═══════════════════════════ 1) citirea testului ═══════════════════════════

test('parseJs: doar date — chei fără ghilimele, stringuri cu \', escape-uri, comentarii, virgule la final; expresiile sunt refuzate', () => {
  const src = "x = [ {q:'a\\\\(b\\\\)', 'k': \"c\\\"d\", n: -1.5e2, t: true, z: null, arr: [1, 2,], /* c */ }, // r\n ]";
  const { value } = IT.parseJs(src, src.indexOf('['));
  assert.deepStrictEqual(value, [{ q: 'a\\(b\\)', k: 'c"d', n: -150, t: true, z: null, arr: [1, 2] }]);
  assert.throws(() => IT.parseJs('[f(1)]', 0));
  assert.throws(() => IT.parseJs('[`a${b}`]', 0));
  assert.throws(() => IT.parseJs("['neînchis]", 0));
  assert.deepStrictEqual(IT.tablouDupa('<script>var PROBS = [{"n": 1}];</script>', 'PROBS'), [{ n: 1 }]);
  assert.strictEqual(IT.tablouDupa('<script>var PROBS = [{n: f()}];</script>', 'PROBS'), null);
});

test('exercițiile unui test de EN: cardurile în ordinea din pagină (EX1 din #exList1, apoi cele scrise direct) și pașii din PROBS', () => {
  const r = IT.itemiDinHtml(HTML_EN);
  assert.strictEqual(r.nc, 4, 'toate cardurile-grilă, și cel cu indiciu propriu');
  assert.deepStrictEqual(r.carduri.map((c) => [c.id, c.corect, c.propriu]), [['c1', 'b', false], ['c2', 'a', false], ['c3', 'c', false], ['c4', 'a', true]]);
  const [c1, c2, c3] = r.carduri;
  assert.strictEqual(c1.enunt, 'Rezultatul calculului \\(85 - 6 \\cdot 9\\) este egal cu:');
  assert.deepStrictEqual(c1.variante, { a: '711', b: '31', c: '76', d: '85' });
  assert.match(c1.explicatie, /^Răspuns: b\) 31 Înmulțirea/);
  assert.strictEqual(c1.fp, 'rezultatulcalculului', 'amprenta: literele de dinaintea primei formule');
  assert.deepStrictEqual(c2.variante, { a: '17', b: '-17' }, 'adevărat/fals: doar a) și b)');
  assert.strictEqual(c3.enunt, 'Triunghiul DEF este dreptunghic în D. Proiecția punctului H pe DF este:');
  assert.deepStrictEqual(c3.variante, { a: 'D', b: 'G', c: 'K', d: 'E' });
  assert.strictEqual(c3.fp, 'triunghiuldefestedreptun');
  assert.deepStrictEqual(r.pasi.map((p) => [p.id, p.propriu]), [['p0s0', false], ['p0s1', true], ['p1s0', false], ['p1s1', false]]);
  assert.strictEqual(r.pasi[0].cerinta, 'Ce sumă mai are?');
  assert.strictEqual(r.pasi[0].corect, '15 · 3 = 45 lei');
  assert.strictEqual(r.pasi[2].problema, 'E(x) = ( (5)/(x+4) )', 'fracțiile din șablon, ca text');
  assert.strictEqual(r.pasi[2].corect, 'ADEVĂRAT — Desfac parantezele.');
});

test('ordinea nesigură (o listă al cărei tablou nu se poate citi) → fără indicii la carduri; testele fără carduri/PROBS → nimic', () => {
  const r = IT.itemiDinHtml(HTML_EN.replace('const EX1 = [', 'const ALTCEVA = ['));
  assert.strictEqual(r.nc, null);
  assert.deepStrictEqual(r.carduri, []);
  assert.strictEqual(r.pasi.length, 4, 'pașii rămân');
  // listele pot sta și după cardurile scrise direct (Subiectul II din EX2)
  const s = '<div class="card" data-correct="a"><div class="qtxt">Primul</div><div class="opt" data-opt="a"><div class="otxt">1</div></div></div>'
    + '<div id="exList2"></div><script>var EX2 = [{q:\'Al doilea\', a:\'1\', b:\'2\', ok:\'b\'}];</script>';
  assert.deepStrictEqual(IT.itemiDinHtml(s).carduri.map((c) => [c.id, c.enunt]), [['c1', 'Primul'], ['c2', 'Al doilea']]);
  assert.deepStrictEqual(IT.itemiDinHtml('<html><body>nimic</body></html>'), { carduri: [], pasi: [], nc: 0 });
  // un card scris într-un <script> nu e card din pagină
  assert.strictEqual(IT.itemiDinHtml('<script>x=\'<div class="card"><div class="opt">\'</script>').nc, 0);
});

// ═══════════════════════════ 2) verificarea indiciilor ═══════════════════════════

test('indiciul nu dă nimic din răspuns: nici litera, nici varianta corectă, nici rezultatul pasului', () => {
  const { carduri, pasi } = IT.itemiDinHtml(HTML_EN);
  const [c1, , c3] = carduri;
  assert.ok(IT.curataIndiciu('Ordinea operațiilor: întâi înmulțirea \\(6 \\cdot 9\\), apoi scăderea. Cât rămâne?', c1));
  assert.strictEqual(IT.curataIndiciu('Răspunsul corect este b.', c1), null);
  assert.strictEqual(IT.curataIndiciu('Gândește-te bine: litera b se potrivește.', c1), null);
  assert.strictEqual(IT.curataIndiciu('Calculează: 85 − 54 = 31, deci ai rezultatul.', c1), null, 'rezultatul (31) nu apare în enunț');
  assert.strictEqual(IT.curataIndiciu('scurt', c1), null);
  assert.strictEqual(IT.curataIndiciu('x'.repeat(500), c1), null);
  assert.ok(IT.curataIndiciu('Proiecția unui punct pe o dreaptă e piciorul perpendicularei; ce dreaptă e perpendiculară pe DF?', c3), 'varianta „K" are o literă — nu o căutăm în text');
  assert.strictEqual(IT.curataIndiciu('Restul e 15 · 3 = 45 de lei, adică triplul.', pasi[0]), null, 'rezultatul pasului (45)');
  assert.ok(IT.curataIndiciu('15 lei reprezintă o treime din rest: ce operație îți dă întregul?', pasi[0]), '15 apare în enunț — e voie');
  assert.strictEqual(IT.curataIndiciu('Afirmația este adevărată, verifică desfăcând.', pasi[2]), null, 'adevărat/fals: fără verdict');
  assert.strictEqual(IT.curataIndiciu('<b>Desfă</b> parantezele și compară termenii.', pasi[2]), 'Desfă parantezele și compară termenii.', 'fără HTML');
});

// ═══════════════════════════ 3) cache-ul și generarea ═══════════════════════════

function seed(fileUrl = 'https://x/storage/v1/object/public/content-files/interactive/t1.html') {
  return {
    content: [
      { id: ID, title: 'Test 61 · Evaluare Națională', category: 'evaluare-nationala', content_type: 'interactive', file_url: fileUrl, created_at: '2026-10-07T00:00:00Z' },
      { id: ID_PDF, title: 'Varianta 1', category: 'evaluare-nationala', content_type: 'pdf', file_url: 'https://x/a.pdf', created_at: '2026-10-01T00:00:00Z' },
    ],
    app_settings: [],
  };
}
// modelul de probă: câte un indiciu pentru fiecare exercițiu primit; c1 „scapă" rezultatul
function fakeChat(calls) {
  return async ({ messages, schemaName, reasoningEffort }) => {
    calls.push({ schemaName, reasoningEffort });
    const lot = JSON.parse(messages[0].content.slice(messages[0].content.indexOf('[')));
    return {
      data: { indicii: lot.map((it) => ({ id: it.id, indiciu: it.id === 'c1' ? 'Rezultatul este 31, verifică.' : `Pornește de la ce știi despre ${it.tip} (${it.id}).` })) },
      usage: { in: 100, out: 50 },
    };
  };
}

test('obtine: scrie o dată, apoi servește din cache; testul înlocuit (alt file_url) → indicii noi', async () => {
  const supa = createFakeSupabase(seed());
  const calls = [];
  let citiri = 0;
  const incarcaHtml = async () => { citiri++; return HTML_EN; };
  const r1 = await IT.obtine(supa, ID, { incarcaHtml, chat: fakeChat(calls) });
  assert.strictEqual(r1.stare, 'gata');
  assert.strictEqual(r1.nc, 4);
  // c4 are indiciu propriu, p0s1 are `help`, c1 a „scăpat" rezultatul → fără indiciu
  assert.deepStrictEqual(Object.keys(r1.h).sort(), ['c2', 'c3', 'p0s0', 'p1s0', 'p1s1']);
  assert.deepStrictEqual(r1.fp, { c2: 'opusulnumarului', c3: 'triunghiuldefestedreptun' });
  assert.deepStrictEqual(calls, [{ schemaName: 'indicii', reasoningEffort: 'low' }], 'un singur apel pentru 6 exerciții');
  const row = supa.db.tables.app_settings.find((x) => x.key === `indicii:${ID}`);
  assert.strictEqual(row.value.stare, 'gata');
  assert.strictEqual(row.value.file_url, seed().content[0].file_url);
  // a doua oară: din cache, fără model și fără fișier
  const r2 = await IT.obtine(supa, ID, { incarcaHtml, chat: fakeChat(calls) });
  assert.deepStrictEqual(r2, r1);
  assert.strictEqual(calls.length, 1);
  assert.strictEqual(citiri, 1);
  // testul înlocuit (procedura 9) → se refac
  supa.db.tables.content[0].file_url = 'https://x/storage/v1/object/public/content-files/interactive/t2.html';
  const r3 = await IT.obtine(supa, ID, { incarcaHtml, chat: fakeChat(calls) });
  assert.strictEqual(r3.stare, 'gata');
  assert.strictEqual(calls.length, 2);
});

test('obtine: o singură generare odată („generare"), testele fără exerciții de completat → „nimic", eșecul se reîncearcă după o pauză', async () => {
  const supa = createFakeSupabase(seed());
  const calls = [];
  supa.db.tables.app_settings.push({ key: `indicii:${ID}`, value: { v: 1, stare: 'generare', at: new Date().toISOString() }, updated_at: new Date().toISOString() });
  assert.deepStrictEqual(await IT.obtine(supa, ID, { incarcaHtml: async () => HTML_EN, chat: fakeChat(calls) }), { ok: true, stare: 'generare' });
  assert.strictEqual(calls.length, 0);
  // marcajul vechi (generare întreruptă) → se generează din nou
  supa.db.tables.app_settings[0].value.at = new Date(Date.now() - 10 * 60 * 1000).toISOString();
  assert.strictEqual((await IT.obtine(supa, ID, { incarcaHtml: async () => HTML_EN, chat: fakeChat(calls) })).stare, 'gata');

  // toate exercițiile au indicii proprii → „nimic", fără model
  const s2 = createFakeSupabase(seed());
  const c2 = [];
  assert.deepStrictEqual(await IT.obtine(s2, ID, { incarcaHtml: async () => '<html><body><p>fără exerciții</p></body></html>', chat: fakeChat(c2) }), { ok: true, stare: 'nimic' });
  assert.strictEqual(c2.length, 0);
  assert.strictEqual(s2.db.tables.app_settings[0].value.stare, 'nimic');

  // modelul cade → „esuat" (elevul vede testul fără indicii), nu se reîncearcă imediat
  const s3 = createFakeSupabase(seed());
  let n = 0;
  const pica = async () => { n++; throw new Error('timeout la model'); };
  assert.deepStrictEqual(await IT.obtine(s3, ID, { incarcaHtml: async () => HTML_EN, chat: pica }), { ok: true, stare: 'nimic' });
  assert.strictEqual(s3.db.tables.app_settings[0].value.stare, 'esuat');
  assert.deepStrictEqual(await IT.obtine(s3, ID, { incarcaHtml: async () => HTML_EN, chat: pica }), { ok: true, stare: 'nimic' });
  assert.strictEqual(n, 1);

  // doar testele interactive din `content`
  await assert.rejects(IT.obtine(s3, ID_PDF, { incarcaHtml: async () => HTML_EN }), (e) => e.status === 404);
  await assert.rejects(IT.obtine(s3, 'nu-e-uuid'), (e) => e.status === 400);
  // fără app_settings (scriptul SQL nerulat) → testul merge fără indicii
  const s4 = createFakeSupabase(seed());
  s4.db.failTables.add('app_settings');
  assert.deepStrictEqual(await IT.obtine(s4, ID, { incarcaHtml: async () => HTML_EN, chat: fakeChat([]) }), { ok: true, stare: 'nimic' });
});

// ═══════════════════════════ 4) puntea, pagina, ruta, cronul ═══════════════════════════

test('puntea: cere indiciile doar când are exerciții fără indicații și le pune „ca la BAC" (carduri + pasul deschis)', () => {
  const b = read('src/lib/tutorBridge.js');
  assert.match(b, /post\('MATE_HINTS_REQ', \{ n: n \}\);/);
  assert.match(b, /if \(d\.type === 'MATE_HINTS'\) \{/);
  assert.match(b, /function refreshUI\(\)\{ rewireHintButtons\(\); ensureStepHelpers\(\); decorateExercises\(\); placeHints\(\); \}/);
  assert.match(b, /post\('MATE_TUTOR_READY', \{ title: document\.title \|\| '' \}\);\n\s+askHints\(\);/);
  assert.match(b, /b\.textContent = '💡 Arată indiciile';/, 'același buton ca la BAC');
  assert.match(b, /if \(HINTS\.nc != null && cards\.length !== HINTS\.nc\) return;/, 'alt număr de carduri → nimic');
  assert.match(b, /letters\(txt\(c\.querySelector\('\.qtxt'\)\)\)\.indexOf\(fp\) !== 0/, 'amprenta enunțului');
  assert.match(b, /function ownHint\(el\)\{ return !!\(el && el\.querySelector\('\.btn-hint, \.hintBtn, \.hint, \.mt-indicatie'\)\); \}/, 'indiciile proprii ale testului rămân');
  assert.match(b, /\/Pasul\\s\+\(\\d\+\)\\s\+din\/i/, 'pasul deschis din „Pasul X din N"');
  assert.match(b, /box\.innerHTML = escH\(text\);/, 'textul indiciului e scăpat (fără HTML)');
});

test('pagina testului: MATE_HINTS_REQ → /api/indicii, cu reîncercare cât se scriu; ruta și cronul', () => {
  const v = read('src/pages/InteractiveViewer.jsx');
  assert.match(v, /if \(d\.type === 'MATE_HINTS_REQ' && fromTest\) \{ if \(cereIndiciiRef\.current\) cereIndiciiRef\.current\(0\); return; \}/);
  assert.match(v, /fetch\('\/api\/indicii', \{ method: 'POST', headers: await authHeaders\(\), body: JSON\.stringify\(\{ contentId: id \}\) \}\)/);
  assert.match(v, /postMessage\(\{ type: 'MATE_HINTS', payload \}, '\*'\)/);
  assert.match(v, /d\.stare === 'generare' && incercare < 12/);
  const r = read('api/indicii.js');
  assert.match(r, /IT\.obtine\(supa, body\.contentId\)/);
  const c = read('api/ai-ingest.js');
  assert.match(c, /q\.indicii = await indiciiTest\.processBatch\(supa\);/);
});
