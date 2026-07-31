// =====================================================================
// test/agent-tasks.test.js — task-urile programate ale agentului de
// exerciții: randarea exercițiului JSON ca HTML interactiv (exgen),
// validarea (normalize), lista de modele permise (claude.resolveModel)
// și programarea din cron (bucharestNow — conversie corectă UTC→România
// vară/iarnă; isDue — potrivirea orei/zilei + garda anti-dublare).
// Rulare: npm test (node --test).
// =====================================================================
const test = require('node:test');
const assert = require('node:assert');

const exgen = require('../api/_lib/exgen');
const claude = require('../api/_lib/claude');
const cron = require('../api/agent-cron');
const tasksApi = require('../api/agent-tasks');

test('exgen.normalize validează grila și etapele', () => {
  const g = exgen.normalize({
    title: 'T', kind: 'grila',
    questions: [
      { statement: 'Cât face $2^3$?', options: ['6', '8', '9', '12'], answer: 1, points: 5 },
      { statement: 'x+1=3, x=?', answer: '2', points: 5 }, // răspuns liber
    ],
  });
  assert.ok(g && g.questions.length === 2);
  assert.strictEqual(g.questions[0].answer, 1);
  assert.strictEqual(g.questions[1].answer, '2');

  const e = exgen.normalize({ title: 'E', kind: 'etape', statement: 'Problema', steps: [{ prompt: 'p1', answer: '4', points: 10 }], final_answer: '4' });
  assert.ok(e && e.steps.length === 1);

  assert.strictEqual(exgen.normalize({ kind: 'grila', questions: [] }), null, 'grilă goală → null');
  assert.strictEqual(exgen.normalize({ kind: 'etape', steps: [{ prompt: 'x' }] }), null, 'etape fără enunț → null');
});

test('exgen.renderExerciseHtml produce HTML interactiv complet (scor + KaTeX + autoMath)', () => {
  const ex = exgen.normalize({
    title: 'Test', kind: 'grila',
    questions: [{ statement: 'Calculați \\frac{1}{2} din $10$', options: ['5', '2', '1', '10'], answer: 0, explanation: '10:2=5', points: 10 }],
  });
  const html = exgen.renderExerciseHtml(ex);
  assert.ok(html.startsWith('<!doctype html>'), 'document complet');
  assert.ok(html.includes('MATE_SCORE'), 'raportează scorul (postMessage)');
  assert.ok(html.includes('katex'), 'încarcă KaTeX');
  assert.ok(html.includes('$\\frac{1}{2}$'), 'autoMath încadrează LaTeX-ul fără delimitatori');
  assert.ok(html.includes('$10$'), 'nu atinge LaTeX-ul deja delimitat');

  const et = exgen.renderExerciseHtml(exgen.normalize({ title: 'E', kind: 'etape', statement: 'S', steps: [{ prompt: 'p', answer: '1', points: 10 }] }));
  assert.ok(et.includes('Etapa 1'), 'randare etape');
});

test('claude.resolveModel: modelele noi permise, necunoscutele cad pe implicit', () => {
  assert.strictEqual(claude.resolveModel('claude-opus-5'), 'claude-opus-5');
  assert.strictEqual(claude.resolveModel('claude-fable-5'), 'claude-fable-5');
  assert.strictEqual(claude.resolveModel('claude-haiku-4-5'), 'claude-haiku-4-5');
  assert.strictEqual(claude.resolveModel('model-inventat'), claude.MODEL);
  assert.strictEqual(claude.resolveModel(null), claude.MODEL);
});

test('agent-cron.bucharestNow: conversie corectă UTC → ora României (vară și iarnă)', () => {
  // 31 iulie 2026 (vineri): 04:00 UTC = 07:00 la București (UTC+3, ora de vară)
  assert.deepStrictEqual(cron.bucharestNow(new Date('2026-07-31T04:00:00Z')), { hour: 7, weekday: 5, monthday: 31 });
  // 15 ianuarie 2026 (joi): 05:00 UTC = 07:00 (UTC+2, ora de iarnă)
  assert.deepStrictEqual(cron.bucharestNow(new Date('2026-01-15T05:00:00Z')), { hour: 7, weekday: 4, monthday: 15 });
  // miezul nopții: 21:00 UTC (30 iulie) = 00:00 (31 iulie)
  const mid = cron.bucharestNow(new Date('2026-07-30T21:00:00Z'));
  assert.strictEqual(mid.hour, 0);
  assert.strictEqual(mid.monthday, 31);
});

test('agent-tasks.cleanTask: contextul suplimentar (extra_rubrics) e curățat și plafonat la 3', () => {
  const t = tasksApi.cleanTask({
    name: 'T', category: 'evaluare-nationala',
    extra_rubrics: [
      { category: 'evaluare-nationala', subcategory: 'bareme', ctype: 'pdf' },
      { category: 'clasa-7', ctype: 'interactive', profile: null },
      { category: '', subcategory: 'ignorat' },              // fără categorie → eliminat
      { category: 'clasa-8', ctype: 'altceva' },             // ctype invalid → interactive
      { category: 'clasa-5' },                               // peste plafonul de 3 → tăiat
    ],
  });
  assert.strictEqual(t.extra_rubrics.length, 3, 'max 3, intrările goale eliminate');
  assert.deepStrictEqual(t.extra_rubrics[0], { category: 'evaluare-nationala', subcategory: 'bareme', profile: null, ctype: 'pdf' });
  assert.strictEqual(t.extra_rubrics[2].ctype, 'interactive', 'ctype invalid cade pe interactive');

  const gol = tasksApi.cleanTask({ name: 'T', category: 'x', extra_rubrics: [] });
  assert.strictEqual(gol.extra_rubrics, null, 'listă goală → null');
});

test('agent-tasks.cleanTask + exgen.runAuto: rezultatul „format”', async () => {
  // result_kind 'format' e acceptat de validare
  const t = tasksApi.cleanTask({ name: 'T', category: 'x', result_kind: 'format' });
  assert.strictEqual(t.result_kind, 'format');
  // …dar rularea fără fișier de format eșuează devreme, cu mesaj clar
  await assert.rejects(
    () => exgen.runAuto({ supa: null, category: 'x', resultKind: 'format' }),
    /modelul de format lipsește/i,
  );
});

test('exgen.detectMode: metoda de lucru dedusă din instrucțiuni', () => {
  // „pe rând" — cu și fără diacritice, formulări diferite
  assert.ok(exgen.detectMode('generează exerciții interactive din rubrică, luând pe rând fișierele rubricii').sequential);
  assert.ok(exgen.detectMode('ia pe rand fisierele').sequential);
  assert.ok(exgen.detectMode('câte un fișier per rulare').sequential);
  assert.ok(exgen.detectMode('unul cate unul').sequential);
  assert.ok(exgen.detectMode('fiecare fișier din rubrică într-un test nou').sequential);
  // combinarea (implicit) — NU e secvențială
  assert.ok(!exgen.detectMode('generează test interactiv după modelele din rubrică, combinându-le').sequential);
  assert.ok(!exgen.detectMode('').sequential);
  assert.ok(!exgen.detectMode('dificultate medie, accent pe geometrie').sequential);
  // pair: cere „barem" în instrucțiuni SAU o rubrică extra cu „barem" în nume — și context prezent
  const bareme = [{ category: 'evaluare-nationala', subcategory: 'bareme', ctype: 'pdf' }];
  assert.ok(exgen.detectMode('folosește baremele corespondente', bareme).pair);
  assert.ok(exgen.detectMode('', bareme).pair, 'rubrica „bareme" la context → pair automat');
  assert.ok(!exgen.detectMode('folosește baremele', []).pair, 'fără rubrici extra → fără pair');
  assert.ok(!exgen.detectMode('', [{ category: 'clasa-7', subcategory: 'teste', ctype: 'pdf' }]).pair);
});

test('exgen.titleMatchScore: corespondența test ↔ barem după titlu', () => {
  const s = exgen.titleMatchScore;
  // numărul comun + cuvinte comune → scor mare
  assert.ok(s('Testul 3 · Evaluare Națională 2025', 'Barem Testul 3 Evaluare Națională 2025') > 0.5);
  // numere diferite → 0 (Testul 3 ≠ Testul 7)
  assert.strictEqual(s('Testul 3 EN', 'Barem Testul 7 EN'), 0);
  // potrivirea corectă câștigă dintre mai mulți candidați
  const candidates = ['Barem Testul 1', 'Barem Testul 2', 'Barem Testul 3'];
  const best = candidates.map((c) => [c, s('Testul 3', c)]).sort((a, b) => b[1] - a[1])[0][0];
  assert.strictEqual(best, 'Barem Testul 3');
  // fără nicio legătură → scor mic
  assert.ok(s('Simulare aprilie geometrie', 'Barem algebra decembrie') < 0.35);
});

test('exgen.runAuto „pe rând”: când toate fișierele au fost procesate → skipped', async () => {
  // supa fals: rubrica are 2 materiale, ambele deja în seq_done
  const rows = [{ id: 'a1', title: 'Testul 1' }, { id: 'a2', title: 'Testul 2' }];
  const fakeQ = {
    select() { return this; }, eq() { return this; }, in() { return this; },
    order() { return this; },
    limit: async () => ({ data: rows }),
  };
  const fakeSupa = { from: () => fakeQ };
  const r = await exgen.runAuto({
    supa: fakeSupa, category: 'clasa-7', ctype: 'pdf',
    instructions: 'ia pe rând fișierele rubricii',
    seqDone: ['a1', 'a2'],
  });
  assert.strictEqual(r.skipped, true);
  assert.match(r.reason, /procesate/);
});

test('agent-cron.isDue: potrivirea programului + garda anti-dublare', () => {
  const now = { hour: 7, weekday: 5, monthday: 31 }; // vineri 31, ora 7
  assert.ok(cron.isDue({ enabled: true, schedule_kind: 'daily', run_hour: 7 }, now));
  assert.ok(!cron.isDue({ enabled: false, schedule_kind: 'daily', run_hour: 7 }, now), 'oprit → nu rulează');
  assert.ok(!cron.isDue({ enabled: true, schedule_kind: 'daily', run_hour: 8 }, now), 'altă oră');
  assert.ok(cron.isDue({ enabled: true, schedule_kind: 'weekly', run_hour: 7, run_weekday: 5 }, now), 'vineri, săptămânal');
  assert.ok(!cron.isDue({ enabled: true, schedule_kind: 'weekly', run_hour: 7, run_weekday: 1 }, now), 'luni ≠ vineri');
  assert.ok(!cron.isDue({ enabled: true, schedule_kind: 'monthly', run_hour: 7, run_monthday: 1 }, now), 'altă zi a lunii');
  // garda: a rulat acum 30 min → nu iar; a rulat ieri → da
  assert.ok(!cron.isDue({ enabled: true, schedule_kind: 'daily', run_hour: 7, last_run_at: new Date(Date.now() - 30 * 60000).toISOString() }, now));
  assert.ok(cron.isDue({ enabled: true, schedule_kind: 'daily', run_hour: 7, last_run_at: new Date(Date.now() - 25 * 3600 * 1000).toISOString() }, now));
});
