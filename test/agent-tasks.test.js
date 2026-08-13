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

test('agent-cron.isDue: potrivirea programului + garda anti-dublare + fereastra de recuperare', () => {
  // vineri, 31 iulie 2026, 07:00 ora României (vară, UTC+3) = 04:00Z
  const laOra = new Date('2026-07-31T04:00:00Z');
  assert.ok(cron.isDue({ enabled: true, schedule_kind: 'daily', run_hour: 7 }, laOra));
  assert.ok(!cron.isDue({ enabled: false, schedule_kind: 'daily', run_hour: 7 }, laOra), 'oprit → nu rulează');
  assert.ok(!cron.isDue({ enabled: true, schedule_kind: 'daily', run_hour: 8 }, laOra), 'altă oră');
  assert.ok(cron.isDue({ enabled: true, schedule_kind: 'weekly', run_hour: 7, run_weekday: 5 }, laOra), 'vineri, săptămânal');
  assert.ok(!cron.isDue({ enabled: true, schedule_kind: 'weekly', run_hour: 7, run_weekday: 1 }, laOra), 'luni ≠ vineri');
  assert.ok(!cron.isDue({ enabled: true, schedule_kind: 'monthly', run_hour: 7, run_monthday: 1 }, laOra), 'altă zi a lunii');
  // iarnă (UTC+2): 15 ianuarie, 05:00Z = 07:00 la București
  assert.ok(cron.isDue({ enabled: true, schedule_kind: 'daily', run_hour: 7 }, new Date('2026-01-15T05:00:00Z')));

  // FEREASTRA DE RECUPERARE: un task ratat la fix (tic aglomerat cu >3 task-uri,
  // tic pierdut, funcție întreruptă) mai e scadent și în orele următoare…
  const dupa2h = new Date('2026-07-31T06:30:00Z'); // 09:30 ora României
  assert.ok(cron.isDue({ enabled: true, schedule_kind: 'daily', run_hour: 7 }, dupa2h), 'recuperat la 2h după oră');
  assert.ok(cron.isDue({ enabled: true, schedule_kind: 'weekly', run_hour: 7, run_weekday: 5 }, dupa2h));
  // …dar nu la nesfârșit (fereastra e de 6 ore)
  assert.ok(!cron.isDue({ enabled: true, schedule_kind: 'daily', run_hour: 7 }, new Date('2026-07-31T10:30:00Z')), '7h mai târziu → expirat');
  // și nu în altă zi (sâmbătă nu recuperează task-ul de vineri)
  assert.ok(!cron.isDue({ enabled: true, schedule_kind: 'weekly', run_hour: 7, run_weekday: 5 }, new Date('2026-08-01T04:00:00Z')));

  // garda anti-dublare, pe ora PROGRAMATĂ: a rulat după ora programată → gata;
  // a rulat cu puțin înaintea ei („Rulează acum” la 06:50) → tot gata;
  // ultima rulare e de ieri → scadent
  const daily7 = { enabled: true, schedule_kind: 'daily', run_hour: 7 };
  assert.ok(!cron.isDue({ ...daily7, last_run_at: '2026-07-31T04:05:00Z' }, dupa2h), 'a rulat la 07:05 → nu iar');
  assert.ok(!cron.isDue({ ...daily7, last_run_at: '2026-07-31T03:50:00Z' }, dupa2h), 'manual la 06:50 → contează ca rularea zilei');
  assert.ok(cron.isDue({ ...daily7, last_run_at: '2026-07-30T04:05:00Z' }, dupa2h), 'rulat ieri → scadent azi');

  // dueAt întoarce chiar începutul orei programate
  assert.strictEqual(cron.dueAt(daily7, dupa2h), new Date('2026-07-31T04:00:00Z').getTime());
});

test('exgen.chatClaudeLong: continuă răspunsurile tăiate/neterminate și re-cere strict documentul', async () => {
  const orig = claude.chatClaude;
  const untilHtml = (t) => /<\/html>/i.test(t);
  try {
    // (a) tăiat la max_tokens → continuare cu prefill de asistent, textele se lipesc
    let calls = 0;
    claude.chatClaude = async ({ messages }) => {
      calls++;
      if (calls === 1) return { text: '<!doctype html><html><body>înc', usage: { prompt_tokens: 1, completion_tokens: 1 }, provider: 'stub', stopReason: 'max_tokens' };
      assert.strictEqual(messages[messages.length - 1].role, 'assistant', 'continuarea folosește prefill');
      return { text: 'eput</body></html>', usage: { prompt_tokens: 1, completion_tokens: 1 }, provider: 'stub', stopReason: 'end_turn' };
    };
    let r = await exgen.chatClaudeLong({ system: 's', blocks: [{ type: 'text', text: 'x' }], until: untilHtml });
    assert.strictEqual(r.text, '<!doctype html><html><body>început</body></html>');
    assert.strictEqual(r.continuations, 1);
    assert.strictEqual(r.usage.completion_tokens, 2, 'usage cumulat');

    // (b) oprit cu end_turn dar documentul NETERMINAT → tot continuă (până iese </html>)
    calls = 0;
    claude.chatClaude = async () => {
      calls++;
      return calls === 1
        ? { text: '<!doctype html><html><body>jumătate', usage: {}, provider: 'stub', stopReason: 'end_turn' }
        : { text: ' și restul</body></html>', usage: {}, provider: 'stub', stopReason: 'end_turn' };
    };
    r = await exgen.chatClaudeLong({ system: 's', blocks: [{ type: 'text', text: 'x' }], until: untilHtml });
    assert.ok(untilHtml(r.text), 'documentul e complet după continuare');

    // (c) modelul răspunde cu PROZĂ (fără doctype) → o re-cerere strictă aduce documentul
    calls = 0;
    claude.chatClaude = async ({ messages }) => {
      calls++;
      if (calls === 1) return { text: 'Nu pot clona fișierul, e prea mare.', usage: {}, provider: 'stub', stopReason: 'end_turn' };
      assert.match(messages[messages.length - 1].content, /EXCLUSIV cu documentul HTML complet/, 're-cererea strictă');
      return { text: '<!doctype html><html><body>doc</body></html>', usage: {}, provider: 'stub', stopReason: 'end_turn' };
    };
    r = await exgen.chatClaudeLong({ system: 's', blocks: [{ type: 'text', text: 'x' }], until: untilHtml });
    assert.ok(r.strictRetry, 'a făcut re-cererea strictă');
    assert.ok(untilHtml(r.text) && r.text.includes('doc'));
    assert.strictEqual(calls, 2, 'proza NU se continuă cu prefill — direct re-cererea strictă');

    // (d) providerul fallback (fără stopReason) → nicio continuare
    calls = 0;
    claude.chatClaude = async () => { calls++; return { text: 'text scurt', usage: {}, provider: 'fallback:gpt' }; };
    r = await exgen.chatClaudeLong({ system: 's', blocks: [{ type: 'text', text: 'x' }], until: untilHtml });
    assert.strictEqual(calls, 1);
    assert.strictEqual(r.continuations, 0);

    // (e) „prompt is too long” (PDF dens) → PDF-ul devine TEXT extras și cererea se reia
    calls = 0;
    claude.chatClaude = async ({ messages }) => {
      calls++;
      const blocks = messages[0].content;
      if (blocks.some((b) => b.type === 'document')) {
        const err = new Error('prompt is too long: 2120089 tokens > 1000000 maximum');
        err.status = 400;
        throw err;
      }
      assert.ok(blocks.every((b) => b.type === 'text'), 'după fallback nu mai există blocuri document');
      return { text: '<!doctype html><html><body>din text</body></html>', usage: {}, provider: 'stub', stopReason: 'end_turn' };
    };
    r = await exgen.chatClaudeLong({
      system: 's',
      blocks: [
        { type: 'text', text: 'MATERIALUL-SURSĂ (PDF): Culegere' },
        { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: Buffer.from('nu-e-pdf-adevărat').toString('base64') } },
        { type: 'text', text: 'restul cererii' },
      ],
      until: untilHtml,
    });
    assert.strictEqual(calls, 2, 'a doua încercare, cu PDF-ul ca text');
    assert.ok(untilHtml(r.text));
  } finally {
    claude.chatClaude = orig;
  }
});

test('exgen.figuresAllowed + stripFigures: figurile geometrice DOAR la Evaluare Națională', () => {
  assert.ok(exgen.figuresAllowed('evaluare-nationala'));
  assert.ok(!exgen.figuresAllowed('bacalaureat'));
  assert.ok(!exgen.figuresAllowed('clasa-7'));
  assert.ok(!exgen.figuresAllowed(null));

  // curățarea figurilor: SVG-urile mari și canvas dispar, pictogramele mici rămân
  const fig = `<div class="fig"><svg width="340" height="180">${'<line x1="0"/>'.repeat(40)}</svg></div>`;
  const icon = '<svg class="ic"><path d="M0 0"/></svg>';
  const out = exgen.stripFigures(`<body>${fig}${icon}<canvas id="c">x</canvas><p>enunț</p></body>`);
  assert.ok(!out.includes('class="fig"'), 'blocul de figură eliminat');
  assert.ok(!out.includes('<canvas'), 'canvas eliminat');
  assert.ok(out.includes('class="ic"'), 'pictograma mică rămâne');
  assert.ok(out.includes('<p>enunț</p>'), 'conținutul rămâne');
});

test('exgen.cutHtml: documentele trunchiate NU mai trec drept valide', () => {
  // complet (și cu ```fence) → extras
  const ok = exgen.cutHtml('text ```html\n<!doctype html><html><body>x</body></html>\n``` rest');
  assert.ok(ok && ok.startsWith('<!doctype html') && ok.endsWith('</html>'));
  // trunchiat (fără </html>) → null — înainte ajungea publicat pe site
  assert.strictEqual(exgen.cutHtml('<!doctype html><html><body>tăiat la max_tokens...'), null);
  // continuare în care modelul a luat-o de la capăt → păstrăm ULTIMUL document
  const dbl = exgen.cutHtml('<!doctype html><html><body>parțial <!doctype html><html><body>întreg</body></html>');
  assert.ok(dbl.includes('întreg') && !dbl.startsWith('<!doctype html><html><body>parțial'));
});

test('exgen.itemSignals + missingSections: garda „testul chiar are exerciții și toate subiectele”', () => {
  // carcasă fără itemi (cazul „0 pași, nimic generat”) → aproape zero semnale
  const shell = '<!doctype html><html><body><h1>Test</h1><div class="pill">Rezolvate: 0/10</div><div id="exList"></div><script>var EX=[]</script></body></html>';
  const full = '<div class="card" data-correct="c" data-points="5"><div class="opt" data-opt="a">a</div><div class="opt" data-opt="b">b</div></div>'.repeat(6)
    + '<script>var D=[{"ok":"a","answer":"5"}]</script>';
  assert.ok(exgen.itemSignals(shell) < 2, 'carcasa goală nu are semnale de itemi');
  assert.ok(exgen.itemSignals(full) >= 12, 'testul adevărat are multe semnale');

  // secțiunile din sursă trebuie să apară și în rezultat (inclusiv „Subiectele I, II și III”)
  assert.deepStrictEqual(
    exgen.missingSections('Subiectul I … Subiectul II … SUBIECTUL al III-lea', 'aici doar Subiectul I'),
    ['Subiectul II', 'Subiectul III'],
  );
  assert.deepStrictEqual(
    exgen.missingSections('Subiectele I, II și III · 10 exerciții', 'Subiectul I și Subiectul II'),
    ['Subiectul III'],
  );
  assert.deepStrictEqual(exgen.missingSections('Subiectul I & Subiectul II', 'Subiectul I, Subiectul II'), []);
  assert.deepStrictEqual(exgen.missingSections('fără subiecte numerotate', 'orice'), []);
});

test('exgen.visibleSubcategory: postarea automată ajunge într-o rubrică VIZIBILĂ pe site', () => {
  const v = exgen.visibleSubcategory;
  // EN/BAC: subcategoriile doar-PDF și mixurile „a+b” cad pe teste-interactive
  assert.strictEqual(v('evaluare-nationala', 'variante'), 'teste-interactive');
  assert.strictEqual(v('evaluare-nationala', 'simulari'), 'teste-interactive');
  assert.strictEqual(v('evaluare-nationala', 'simulari+variante'), 'teste-interactive');
  assert.strictEqual(v('bacalaureat', 'teste-antrenament'), 'teste-interactive');
  assert.strictEqual(v('bacalaureat', 'variante'), 'teste-interactive');
  // subcategoriile cu afișare interactivă proprie rămân neschimbate
  assert.strictEqual(v('evaluare-nationala', 'capitole'), 'capitole');
  assert.strictEqual(v('evaluare-nationala', 'exercitii-subiecte'), 'exercitii-subiecte');
  assert.strictEqual(v('evaluare-nationala', 'teste-interactive'), 'teste-interactive');
  assert.strictEqual(v('bacalaureat', 'exercitii'), 'exercitii');
  assert.strictEqual(v('bacalaureat', 'capitole'), 'capitole');
  // clasele nu filtrează după subcategorie → rămân cum au fost
  assert.strictEqual(v('clasa-7', null), null);
  assert.strictEqual(v('clasa-7', 'algebra'), 'algebra');
});
