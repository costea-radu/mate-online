// =====================================================================
// test/plan-pregatire-pdf.test.js — testele PDF din harta pregătirii (13 nov. 2026):
//   „După terminarea testelor interactive, să se treacă la cele PDF. La testele PDF
//    să se poată trimite rezolvări: a) pe PDF, b) în chat, c) în foaia de lucru,
//    d) cu poza. (…) la corectarea cu AI în lipsa baremului să ai grijă la consum,
//    să pui limită sau taxă."
//
// · src/pages/PDFViewer.jsx: ?mod=pdf|chat|foaie|poza (de pe hartă); „✏️ Pe PDF" și la
//   BAC / clase (fără harta testului de EN): paginile scrise → imagini → formularul de
//   răspuns (api/ai-correct.js → progress, deci pasul se vede pe hartă);
// · src/components/AITutor.jsx: formularul se deschide cu imagini și cu un îndemn; foaia
//   de lucru se atașează la răspuns când formularul e deschis;
// · api/_lib/ai.js: cota zilnică „Corectări AI fără barem" (3/zi; pachetul AI o ridică),
//   aplicată în ai-correct, ai-handwriting și rezolva-pdf.
// Rulare: npm test
// =====================================================================
delete process.env.AI_QUOTA_FARA_BAREM_ZI;
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const ai = require('../api/_lib/ai');
const { createFakeSupabase } = require('./tools/fakeSupabase');

const read = (f) => fs.readFileSync(path.join(__dirname, '..', f), 'utf8');
const U = '77777777-7777-4777-8777-777777777777';
const ELEV = { id: U, role: 'elev', subscription_status: 'active', is_admin: false };

test('cota „Corectări AI fără barem": zilnică, 3 pe zi la fiecare rol, suprascrisă din AI_QUOTA_FARA_BAREM_ZI; nu e o cerere AI în plus', () => {
  const q = ai.FEATURE_QUOTAS.farabarem;
  assert.deepStrictEqual([q.endpoint, q.window, q.label], ['ai-correct:farabarem', 'day', 'Corectări AI fără barem']);
  for (const rol of ['elev', 'profesor', 'parinte']) assert.strictEqual(ai.quotasForRole(rol).farabarem, 3, rol);
  assert.ok(ai.NU_E_CERERE_AI.includes('ai-correct:farabarem'), 'rândul-numărătoare nu consumă acțiunile gratuite / limita orară');
  const src = read('api/_lib/ai.js');
  assert.match(src, /farabarem: process\.env\.AI_QUOTA_FARA_BAREM_ZI/);
});

test('peste 3 corectări fără barem pe zi → 429 cu îndemnul spre pachetul AI; cu pachet plătit activ → merge mai departe', async () => {
  const azi = new Date().toISOString();
  const rand = () => ({ user_id: U, endpoint: 'ai-correct:farabarem', tokens_in: 0, tokens_out: 0, created_at: azi });
  const supa = createFakeSupabase({ ai_usage: [rand(), rand()] });
  await ai.enforceFeatureQuota(supa, U, ELEV, 'farabarem', null);          // 2 din 3 → încă una
  await ai.logFaraBarem(supa, U);
  assert.strictEqual(supa.db.tables.ai_usage.length, 3);
  supa.db.tables.ai_usage[2].created_at = azi;   // în Postgres: default now()
  assert.deepStrictEqual([supa.db.tables.ai_usage[2].endpoint, supa.db.tables.ai_usage[2].cost_micro], ['ai-correct:farabarem', 0]);
  await assert.rejects(() => ai.enforceFeatureQuota(supa, U, ELEV, 'farabarem', null), (e) => {
    assert.strictEqual(e.status, 429);
    assert.strictEqual(e.code, 'QUOTA_FEATURE');
    assert.strictEqual(e.feature, 'farabarem');
    assert.match(e.message, /cele 3 „corectări ai fără barem" incluse azi/);
    return true;
  });
  await ai.enforceFeatureQuota(supa, U, ELEV, 'farabarem', { topupActive: true });   // „taxa": pachetul AI
});

test('cota se aplică doar FĂRĂ barem și se numără doar la corectarea reușită: formular (ai-correct), foaia de lucru (ai-handwriting), „Rezolvă pe PDF"', () => {
  const ac = read('api/ai-correct.js');
  const gi = ac.indexOf('async function grade(');
  const g = ac.slice(gi, ac.indexOf('// ── punctajele, validate pe server', gi));
  const iCota = g.indexOf("if (!hasBarem) await ai.enforceFeatureQuota(supa, userId, profile, 'farabarem', lim);");
  const iModel = g.indexOf('corector.correctJson(');
  const iLog = g.indexOf('if (!hasBarem) await ai.logFaraBarem(supa, userId);');
  assert.ok(iCota > 0 && iCota < iModel, 'cota, înainte de apelul modelului');
  assert.ok(iLog > iModel, 'numărătoarea, după corectarea reușită');
  const hw = read('api/ai-handwriting.js');
  assert.match(hw, /if \(!src\.hasBarem\) await ai\.enforceFeatureQuota\(supa, userId, profile, 'farabarem', lim\);\s+let out;/);
  assert.ok(hw.indexOf('if (!src.hasBarem) await ai.logFaraBarem(supa, userId);') > hw.indexOf('await logAll(supa, userId, out.usages, true);'));
  const rp = read('api/rezolva-pdf.js');
  assert.match(rp, /if \(!src\.hasBarem\) await ai\.enforceFeatureQuota\(supa, userId, profile, 'farabarem', lim\);/);
  assert.match(rp, /model = r\.model;\s+if \(!src\.hasBarem\) await ai\.logFaraBarem\(supa, userId\);/);
});

test('vizualizatorul PDF: ?mod= de pe hartă — chat / poza → formularul (cu îndemn), foaie → foaia de lucru, pdf → scrisul pe test', () => {
  const v = read('src/pages/PDFViewer.jsx');
  assert.match(v, /const modPlan = dinPregatire && \['pdf', 'chat', 'foaie', 'poza'\]\.includes\(searchParams\.get\('mod'\)\)/);
  assert.match(v, /if \(modPlan === 'chat' \|\| modPlan === 'poza'\) \{/);
  assert.match(v, /📷 Fotografiază rezolvarea de pe caiet și adaug-o cu „📷 Poze cu rezolvarea"/);
  assert.match(v, /if \(modPlan === 'foaie'\) \{[\s\S]{0,400}setWork\(true\);/);
  // fișele claselor: foaia intră în rezultate prin formular
  assert.match(v, /„📎 Atașează la răspuns" și „✅ Corectează" aici/);
  assert.match(v, /if \(\(canSolve \|\| \(modPlan === 'pdf' && solveGeneric\)\) && !solveOn\) \{/);
  // formularul cerut se deschide abia după ce chatul a citit testul
  assert.match(v, /if \(cmd && cmd\.canAnswer && cmd\.canAnswer\(\) && cmd\.answerForm\) \{\s+cmd\.answerForm\(\{ imagini: formaCeruta\.imagini \|\| \[\], indemn: formaCeruta\.indemn \|\| null, mare: narrow && formaCeruta\.mod !== 'foaie' \}\);/);
});

test('„✏️ Pe PDF" la BAC și la clase: scrisul oriunde pe pagini, la „✅ Corectează" paginile scrise (cel mult 3) pleacă în formularul de răspuns; Premium', () => {
  const v = read('src/pages/PDFViewer.jsx');
  assert.match(v, /const solveGeneric = !isEnPdf && !modTest && !examHtml && !!pdfData && !isBaremItem && baremStatus !== 'este_barem';/);
  assert.match(v, /const solveActive = solveOn && \(canSolve \|\| solveGeneric\);/);
  assert.match(v, /useRezolvarePdf\(\{ on: solveActive, data: pdfData, draftKey: inkKey, generic: !canSolve \}\)/);
  assert.match(v, /async function corecteazaPePdf\(\) \{\s+if \(!canSolve\) \{ await corecteazaGeneric\(\); return; \}/);
  const g = v.slice(v.indexOf('async function corecteazaGeneric()'), v.indexOf('async function corecteazaPePdf()'));
  assert.match(g, /if \(!\(isPremium \|\| isAdmin\)\)/);
  assert.match(g, /const r = await solve\.renderImages\(solve\.request\(\)\);/);
  assert.match(g, /imagini: toate\.slice\(0, 3\)/);
  assert.match(v, /rezolvareToolbar\(\{[^}]*generic: !canSolve \}\)/);
  assert.match(v, /<RezolvareFooter [^>]*generic=\{!canSolve\} \/>/);
  // testele de EN rămân pe drumul lor (harta testului, grilele după barem)
  assert.match(v, /const canSolve = isEnPdf && !modTest && !examHtml && !!pdfData;/);
  const rz = read('src/components/RezolvarePdf.jsx');
  assert.match(rz, /export function useRezolvarePdf\(\{ on, data, draftKey, generic = false \}\)/);
  assert.match(rz, /if \(generic\) \{ setMap\(null\); setMapState\('generic'\); return undefined; \}/);
  assert.match(rz, /La „✅ Corectează", ce ai scris pe PDF ajunge în formularul de răspuns al profesorului virtual, ca imagini \(până la 3\)/);
});

test('formularul de răspuns: se deschide cu imaginile atașate și cu un îndemn; foaia de lucru se atașează la răspuns când formularul e deschis', () => {
  const t = read('src/components/AITutor.jsx');
  assert.match(t, /async function openAnswerForm\(\{ imagini = \[\], indemn = null, mare = false \} = \{\}\) \{/);
  assert.match(t, /setFormAnswers\(\{\}\); setFormImages\(imgs\); setFormHint\(indemn \|\| null\);/);
  assert.match(t, /answerForm: \(opts\) => openAnswerForm\(opts \|\| \{\}\),/);
  assert.match(t, /\{formHint && \(/);
  assert.match(t, /attachLabel=\{form \? '📎 Atașează la răspuns' : '📎 Pune în întrebare'\}/);
  // imaginile: doar data:image/…, cel mult 3
  assert.match(t, /\.filter\(\(u\) => typeof u === 'string' && u\.startsWith\('data:image\/'\)\)\.slice\(0, 3\)/);
});

test('harta: pașii PDF au cele patru moduri (✏️ Pe PDF · 💬 În chat · ✍️ Foaia de lucru · 📷 Cu poza); interactivele deschid vizualizatorul cu insigna hărții', () => {
  const pg = read('src/pages/PregatesteMa.jsx');
  for (const m of ["mod: 'pdf'", "mod: 'chat'", "mod: 'foaie'", "mod: 'poza'"]) assert.ok(pg.includes(m), m);
  assert.match(pg, /onClick=\{\(\) => onDeschide\(urlPas\(n, m\.mod\), n\)\}/);
  const h = read('src/components/HartaPlan.jsx');
  assert.match(h, /return `\/pdf-viewer\?id=\$\{id\}&pregatire=1&plan=1\$\{mod \? `&mod=\$\{encodeURIComponent\(mod\)\}` : ''\}`;/);
  const iv = read('src/pages/InteractiveViewer.jsx');
  assert.match(iv, /const dinPlan = dinPregatire && searchParams\.get\('plan'\) === '1';/);
  assert.match(iv, /'🗺️ HARTA PREGĂTIRII'/);
});
