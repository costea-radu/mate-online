// =====================================================================
// test/corectare-exercitiu.test.js — cererile din 4 noiembrie 2026:
//   „pune la testele interactive «corectează exercițiul» la fiecare exercițiu.
//    «Corectează» transformă-l în «corectează total», care să corecteze cu
//    punctajul total"
//   „pe telefon e prea mare bara de sus de la teste interactive. păstrează doar
//    icon-urile … «rezolvate», «scor» și «corecte» să apară după ce elevul
//    apasă «corectează»"
//   „la teste interactive, spațiul de lucru pe desktop este peste test. fă să
//    se alinieze testul în stânga și spațiul de lucru în dreapta"
//
// Bridge-ul (src/lib/tutorBridge.js) e injectat în HTML-ul fiecărui test:
//   · „✓ Corectează exercițiul" la fiecare exercițiu (pași, carduri-grilă);
//   · butonul de sus devine „✓ Corectează total";
//   · motorul ÎNCHIS într-o funcție (Subiectul al III-lea la EN) e făcut
//     vizibil prin window.__mtScope (exposeClosureEngine);
//   · pe telefon bara testului trece în bara paginii (MATE_COMPACT / MATE_TOOLBAR).
// Comportamentul în browser a fost verificat pe toate cele 44 de teste gratuite
// de pe site; aici: structura, sintaxa (ES5 — tablele vechi) și motorul închis.
// =====================================================================
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');
const { pathToFileURL } = require('node:url');

const read = (f) => fs.readFileSync(path.join(__dirname, '..', ...f.split('/')), 'utf8');
let bridgeP = null;
const B = () => (bridgeP || (bridgeP = import('../src/lib/tutorBridge.js')));
const bridgeScript = async () => {
  const { injectTutorBridge } = await B();
  const out = injectTutorBridge('<html><body><p>x</p></body></html>');
  return out.match(/<script>([\s\S]*)<\/script>/)[1];
};
let acorn = null;
try { acorn = require('acorn'); } catch { /* fără acorn → doar new Function */ }

// motorul Subiectului al III-lea, cum e scris în testele interactive de EN
const EN_ENGINE = `<!DOCTYPE html><html><body>
<div class="sbar"><button onclick="checkAll()">✓ Corectează</button></div>
<script>
/* ═══ SUBIECTUL AL III-lea — motor interactiv ═══ */
(function(){
"use strict";
var PROBS=[{"n":1,"pa":3,"pb":2,"steps":[{"p":"a","t":"num","a":2,"pts":3},{"p":"b","t":"num","a":3,"pts":2}]}];
var ST={}, GRADED=false, cur=null, redo=null;
function stOf(n){ if(!ST[n]) ST[n]={ans:[]}; return ST[n]; }
function isRight(s,a){ return !!a && Number(a.v)===s.a; }
function probScore(p){ var st=ST[p.n], sc=0; if(st&&st.ans) p.steps.forEach(function(s,i){ if(isRight(s,st.ans[i])) sc+=s.pts; }); return sc; }
function renderProb(){ return 'render:' + (GRADED ? 'corectat' : 'deschis'); }
function checkAll(){ GRADED=true; }
window.checkAll=checkAll;
window.testRender=function(){ return renderProb(); };
window.testGraded=function(){ return GRADED; };
})();

</script>
</body></html>`;

function runScripts(html) {
  const ctx = vm.createContext({});
  vm.runInContext('var window = this;', ctx);
  const re = /<script>([\s\S]*?)<\/script>/g;
  let m;
  while ((m = re.exec(html))) vm.runInContext(m[1], ctx);
  return ctx;
}

test('motorul închis într-o funcție (EN): bridge-ul îl vede prin window.__mtScope', async () => {
  const { exposeClosureEngine } = await B();
  const out = exposeClosureEngine(EN_ENGINE);
  assert.notStrictEqual(out, EN_ENGINE);
  // obiectul e pus ÎNĂUNTRUL funcției, chiar înainte de „})();"
  assert.match(out, /window\.__mtScope=window\.__mtScope\|\|\{\}\)\}catch\(e\)\{\}\n\}\)\(\);/);
  const ctx = runScripts(out);
  const S = ctx.window.__mtScope;
  assert.ok(S, '__mtScope există');
  assert.strictEqual(typeof ctx.window.PROBS, 'undefined', 'PROBS rămâne local, nu devine global');
  assert.strictEqual(S.PROBS.length, 1);
  assert.strictEqual(S.GRADED, false);
  assert.strictEqual(S.cur, null);
  assert.strictEqual(typeof S.renderProb, 'function');
  assert.strictEqual(S.gradeProb, undefined, 'numele care lipsesc din test rămân nedefinite');
  // setter-ele scriu în variabilele motorului
  S.GRADED = true;
  assert.strictEqual(ctx.window.testGraded(), true);
  assert.strictEqual(ctx.window.testRender(), 'render:corectat');
  S.GRADED = false;
  // înlocuirea unei funcții de redare schimbă și apelurile din interiorul motorului
  const orig = S.renderProb;
  S.renderProb = function () { return 'împachetat/' + orig(); };
  assert.strictEqual(ctx.window.testRender(), 'împachetat/render:deschis');
  // starea: ST / stOf / probScore — ca la șabloanele cu variabile globale
  S.stOf(1).ans[0] = { v: 2 };
  assert.strictEqual(S.probScore(S.PROBS[0]), 3);
  assert.strictEqual(S.ST[1].ans.length, 1);
});

test('exposeClosureEngine nu atinge motoarele globale, fișierele fără PROBS și nu se aplică de două ori', async () => {
  const { exposeClosureEngine } = await B();
  const global = '<html><body><script>\nvar PROBS=[{n:1,steps:[]}];\nvar ST={}, GRADED=false, cur=null;\nfunction renderProb(){}\n</script></body></html>';
  assert.strictEqual(exposeClosureEngine(global), global, 'variantele de BAC (variabile globale) rămân neschimbate');
  const fara = '<html><body><script>(function(){ var EX=[1]; })();</script></body></html>';
  assert.strictEqual(exposeClosureEngine(fara), fara, 'testele-grilă (fără PROBS) rămân neschimbate');
  const once = exposeClosureEngine(EN_ENGINE);
  assert.strictEqual(exposeClosureEngine(once), once, 'a doua aplicare nu mai schimbă nimic');
  assert.strictEqual(exposeClosureEngine(''), '');
  assert.strictEqual(exposeClosureEngine(null), null);
  // injectTutorBridge îl aplică singur, înainte de bridge
  const { injectTutorBridge } = await B();
  const inj = injectTutorBridge(EN_ENGINE);
  assert.ok(inj.indexOf('window.__mtScope=window.__mtScope') < inj.indexOf('__MATE_TUTOR_BRIDGE__'));
  assert.strictEqual(injectTutorBridge(inj), inj, 'deja injectat → neschimbat');
});

test('bridge-ul: JavaScript valid și ES5 (rulează și pe browserele vechi ale tablelor)', async () => {
  const src = await bridgeScript();
  assert.doesNotThrow(() => new Function(src));
  if (acorn) assert.doesNotThrow(() => acorn.parse(src, { ecmaVersion: 5 }), 'bridge-ul trebuie să rămână ES5');
  const { exposeClosureEngine } = await B();
  const snippet = exposeClosureEngine(EN_ENGINE).match(/;try\{\(function\(S\)[\s\S]*?\}catch\(e\)\{\}\n/)[0];
  if (acorn) assert.doesNotThrow(() => acorn.parse(snippet, { ecmaVersion: 5 }), 'obiectul __mtScope e ES5');
});

test('„✓ Corectează exercițiul" la fiecare exercițiu, „✓ Corectează total" sus — fără scor trimis la corectarea unui exercițiu', async () => {
  const src = await bridgeScript();
  // butonul per exercițiu (pași: sus + la final; carduri-grilă)
  assert.match(src, /setAttribute\('data-mt-ex', kind\)/);
  assert.match(src, /'✓ Corectează exercițiul'/);
  assert.match(src, /makeExBtn\('top'/);
  assert.match(src, /makeExBtn\('done'/);
  assert.match(src, /makeExBtn\('card'/);
  // exercițiul corectat separat: ST[n].mtg, afișat cu GRADED = true doar pentru el
  assert.match(src, /\.mtg = 1/);
  assert.match(src, /gset\('GRADED', true\)/);
  // cardul fără răspuns ales
  assert.match(src, /Alege întâi un răspuns\./);
  // butonul de sus
  assert.match(src, /Corectează total/);
  assert.match(src, /data-mt-total/);
  // la „Corectează total", cardurile corectate separat se numără din nou în total
  assert.match(src, /\.card\[data-mt-checked\]/);
  // clicurile pe butoanele per exercițiu NU declanșează raportarea scorului
  assert.match(src, /getAttribute\('data-mt-ex'\)\)\) return;|getAttribute\('data-mt-ex'\)\) return;/);
  // motorul închis: bridge-ul caută întâi în __mtScope
  assert.match(src, /function inScope\(n\)/);
  assert.match(src, /window\.__mtScope\[n\]/);
  // nota Subiectului al III-lea la EN
  assert.match(src, /Fiecare problemă se poate corecta separat/);
});

test('telefon: bara testului se mută în bara paginii (MATE_COMPACT / MATE_TOOLBAR / MATE_TOOLBAR_CMD)', async () => {
  const src = await bridgeScript();
  assert.match(src, /t\.type === 'MATE_COMPACT'|d\.type === 'MATE_COMPACT'|type === 'MATE_COMPACT'/);
  assert.match(src, /MATE_TOOLBAR_CMD/);
  assert.match(src, /post\('MATE_TOOLBAR'/);
  // pastilele „Rezolvate / Scor / Corecte" se văd doar după prima corectare
  assert.match(src, /html\.mt-compact \.sbar \.pill\{display:none!important\}/);
  assert.match(src, /html\.mt-compact\.mt-graded \.sbar \.pill\{display:inline-block!important/);

  const v = read('src/pages/InteractiveViewer.jsx');
  assert.match(v, /role="toolbar" aria-label="Bara testului"/);
  for (const label of ['Înapoi', 'Profesorul virtual', 'Spațiu de lucru', 'Resetează testul', 'Toate exercițiile']) {
    assert.ok(v.includes(`aria-label="${label}"`) || v.includes(`: '${label}'}`), `bara de pe telefon are butonul „${label}"`);
  }
  assert.match(v, /type: 'MATE_COMPACT'/);
  assert.match(v, /type: 'MATE_TOOLBAR_CMD'/);
  assert.match(v, /Corectează total/);
});

test('desktop: testul în stânga, spațiul de lucru în dreapta (coloană lângă test, cu lățime reglabilă)', () => {
  const v = read('src/pages/InteractiveViewer.jsx');
  assert.match(v, /<SpatiuDeLucru docked/);
  assert.match(v, /label="Lățimea spațiului de lucru"/);
  const s = read('src/components/SpatiuDeLucru.jsx');
  assert.match(s, /const dock = docked && !narrow && !maxi;/);
  const m = read('src/components/ManerLatime.jsx');
  assert.match(m, /label/);
});

test('testele AI (renderQuiz): „✓ Corectează exercițiul" la fiecare întrebare, „✓ Corectează total" jos', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'quiz-render-'));
  fs.writeFileSync(path.join(dir, 'katex.mjs'), 'export const autoMath = (s) => String(s);\n');
  fs.writeFileSync(path.join(dir, 'ansEq.mjs'), read('src/lib/ansEq.js'));
  const src = read('src/lib/quizRender.js')
    .replace("from './katex'", "from './katex.mjs'")
    .replace("from './ansEq'", "from './ansEq.mjs'");
  fs.writeFileSync(path.join(dir, 'quizRender.mjs'), src);
  const { renderQuiz } = await import(pathToFileURL(path.join(dir, 'quizRender.mjs')).href);
  const html = renderQuiz('Test AI', [
    { statement: '2+2=?', options: ['3', '4'], answer: 1, explanation: '2+2=4' },
    { statement: '5-3=?', answer: '2', explanation: '5-3=2' },
    { statement: '3·3=?', options: ['6', '9'], answer: 1 },
  ]);
  assert.strictEqual((html.match(/class="qchk" data-mt-ex="quiz"/g) || []).length, 3);
  assert.match(html, /<button id="check"[^>]*>✓ Corectează total<\/button>/);
  const scripts = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map((m) => m[1]);
  assert.ok(scripts.length);
  scripts.forEach((s) => assert.doesNotThrow(() => new Function(s)));
});
