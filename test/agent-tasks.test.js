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
