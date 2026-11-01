// =====================================================================
// src/lib/fiseTeste.js — TESTE DIFERITE din fișele claselor 5–12 (1 nov. 2026)
//
// Banca de exerciții (api/fise.js → supabase/fise_banca.sql) dă grupele
// fiecărei fișe, exact cum sunt scrise în ea: { key, title, kind, instruction,
// exercises:[{ n, text, figure? }] } — „Nivel 3", „Triunghiuri asemenea ·
// MODEL 2", „Exercițiul 1 — ecuații de forma x² + bx = 0"…
// Profesorul bifează grupele și câte exerciții ia din fiecare, în fiecare test
// („alegerile" = picks). Aici, fără AI și fără cost:
//   • planFiseTests(picks, { tests, seed, withFigures }) → N teste; fiecare are,
//     din fiecare grupă bifată, câte exerciții s-au cerut — DIFERITE de la un
//     test la altul cât permite fișa: un exercițiu se repetă abia după ce s-au
//     folosit toate exercițiile grupei;
//   • maxDistinctFiseTests(picks) → câte teste ies fără nicio repetare;
//   • testToExam(test, opțiuni) → testul ca „exam" (src/lib/examPrint.js: PDF de
//     tipărit; în „Testele mele" kind 'exam' — merge și în testul pe grupă PDF);
//   • sourceTextOf(test) + topicFor(test) → materialul și cerința pentru AI, când
//     profesorul alege „🔢 Schimbă numerele și notațiile" sau formatul interactiv
//     (un apel AI pe test — aiClient.generateInteractive);
//   • aiExamFromQuestions(test, questions, opțiuni) → testul primit de la AI
//     (itemi cu redactare) ca „exam", cu barem.
// Testele: test/teste-diferite-fise.test.js.
// =====================================================================

export const CLASE = ['clasa-5', 'clasa-6', 'clasa-7', 'clasa-8', 'clasa-9', 'clasa-10', 'clasa-11', 'clasa-12'];
const ROMAN = { 5: 'a V-a', 6: 'a VI-a', 7: 'a VII-a', 8: 'a VIII-a', 9: 'a IX-a', 10: 'a X-a', 11: 'a XI-a', 12: 'a XII-a' };
export const clasaLabel = (cat) => {
  const n = Number(String(cat || '').replace('clasa-', ''));
  return ROMAN[n] ? `Clasa ${ROMAN[n]}` : '';
};
// la generarea cu AI: generatorul interactiv primește 4–24 de itemi pe test
export const AI_MIN_EX = 4;
export const AI_MAX_EX = 24;
// fără AI (PDF cu datele păstrate): cel mult atâtea exerciții pe test
export const MAX_EX = 40;

// ── aleatoriu reproductibil (același „seed" → aceleași teste) ───────────────
export function rng(seed) {
  let a = (Number(seed) >>> 0) || 1;
  return () => {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function shuffle(arr, rnd) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// exercițiile unei grupe care pot intra în test (cele cu figură doar la cerere —
// figura din fișă nu se copiază în test)
export const usableExercises = (group, withFigures = false) =>
  (group?.exercises || []).map((e, idx) => ({ ...e, idx })).filter((e) => e && e.text && (withFigures || !e.figure));

// alegerile valide: grupe cu exerciții, câte cel mult câte are grupa
export function normPicks(picks, withFigures = false) {
  return (picks || []).map((p) => {
    const pool = usableExercises(p, withFigures);
    const count = Math.max(0, Math.min(pool.length, parseInt(p.count, 10) || 0));
    return { ...p, pool, count };
  }).filter((p) => p.count > 0);
}

export const exercisesPerTest = (picks, withFigures = false) =>
  normPicks(picks, withFigures).reduce((n, p) => n + p.count, 0);

// Câte teste ies fără ca vreun exercițiu să se repete (cea mai „strâmtă" grupă decide).
export function maxDistinctFiseTests(picks, withFigures = false) {
  const ps = normPicks(picks, withFigures);
  if (!ps.length) return 0;
  return Math.min(...ps.map((p) => Math.floor(p.pool.length / p.count)));
}

// Planul celor N teste. Fiecare grupă își amestecă exercițiile o dată și le dă
// pe rând testelor; când se termină, se amestecă din nou (de aici încep
// repetările) — dar niciodată același exercițiu de două ori în ACELAȘI test.
// În test, exercițiile unei grupe stau în ordinea din fișă (dificultatea crește
// ca în fișă), iar grupele în ordinea bifelor.
export function planFiseTests(picks, { tests = 1, seed = Date.now(), withFigures = false } = {}) {
  const rnd = rng(seed);
  const ps = normPicks(picks, withFigures).map((p) => ({ ...p, order: shuffle(p.pool, rnd), next: 0, used: new Set() }));
  const n = Math.max(1, Math.min(60, parseInt(tests, 10) || 1));
  const out = [];
  for (let t = 0; t < n; t++) {
    let repeats = 0;
    const groups = ps.map((p) => {
      const chosen = [];
      const inTest = new Set();
      while (chosen.length < p.count) {
        if (p.next >= p.order.length) {
          // o nouă trecere prin grupă: întâi cele care nu sunt deja în acest test
          const rest = shuffle(p.pool.filter((e) => !inTest.has(e.idx)), rnd);
          const deja = p.pool.filter((e) => inTest.has(e.idx));
          p.order = [...rest, ...deja]; p.next = 0;
        }
        const e = p.order[p.next++];
        if (inTest.has(e.idx)) continue;
        inTest.add(e.idx);
        if (p.used.has(e.idx)) repeats++;
        p.used.add(e.idx);
        chosen.push(e);
      }
      chosen.sort((a, b) => a.idx - b.idx);
      return {
        sheetId: p.sheetId || null, sheetTitle: p.sheetTitle || '', key: p.key, title: p.title,
        kind: p.kind || null, instruction: p.instruction || null,
        exercises: chosen.map(({ n: nr, text, figure }) => ({ n: nr, text, ...(figure ? { figure: true } : {}) })),
      };
    });
    out.push({ index: t + 1, groups, repeats });
  }
  return out;
}

// Titlul scurt al unei fișe: fără „ALGEBRĂ — Fișă 4 —" din față.
export function shortSheetTitle(t) {
  const s = String(t || '').trim();
  const cut = s
    .replace(/^\s*(algebr[aă]|geometrie|analiz[aă](\s+matematic[aă])?|trigonometrie)\s*[—–\-:·|]*\s*/i, '')
    .replace(/^\s*fi[sș][aă]\s*(nr\.?\s*)?\d+\s*[—–\-:·|.]*\s*/i, '')
    .trim();
  return cut || s;
}

// Punctajul împărțit egal (numere întregi): primii itemi primesc restul.
export function distributePoints(n, pool) {
  const k = Math.max(0, n | 0);
  if (!k) return [];
  const total = Math.max(0, Math.round(pool));
  const base = Math.floor(total / k);
  const extra = total - base * k;
  return Array.from({ length: k }, (_, i) => base + (i < extra ? 1 : 0));
}

const sheetsOf = (test) => [...new Map((test.groups || []).map((g) => [g.sheetId || g.sheetTitle, g.sheetTitle])).values()].filter(Boolean);
// eticheta grupei în test: cu fișa în față, când testul are exerciții din mai multe fișe
const groupLabel = (g, multi) => (multi && g.sheetTitle ? `${shortSheetTitle(g.sheetTitle)} · ${g.title}` : g.title);

// Testul ca „exam" (src/lib/examPrint.js) — fiecare grupă e o secțiune, cu cerința
// ei comună; exercițiile se numerotează 1, 2, 3… în tot testul.
export function testToExam(test, { title = 'Test', subtitle = null, durationMin = 50, oficiu = 10, workSpace = true, category = null } = {}) {
  const multi = sheetsOf(test).length > 1;
  const all = (test.groups || []).flatMap((g) => g.exercises);
  const of = Math.max(0, Math.min(30, parseInt(oficiu, 10) || 0));
  const pts = distributePoints(all.length, 100 - of);
  let nr = 0;
  const subjects = (test.groups || []).filter((g) => g.exercises.length).map((g) => {
    const items = g.exercises.map((e) => {
      const i = nr++;
      return { number: String(i + 1), statement: e.text, points: pts[i] };
    });
    return {
      label: groupLabel(g, multi),
      ...(g.instruction ? { instructions: g.instruction } : {}),
      points: items.reduce((s, it) => s + it.points, 0),
      items,
    };
  });
  const sheets = sheetsOf(test);
  return {
    title,
    subtitle: subtitle || (sheets.length ? `Exerciții din ${sheets.length > 1 ? 'fișele' : 'fișa'} ${sheets.map((s) => `„${s}"`).join(', ')}` : null),
    nameLine: true,
    durationMin: Math.max(5, Math.min(180, parseInt(durationMin, 10) || 50)),
    oficiu: of,
    totalPoints: 100,
    ...(workSpace ? {} : { workSpace: false }),
    footNote: 'Exerciții din fișele ExamenMate, alese pentru acest test.',
    subjects,
    source: {
      kind: 'fise', category, testNr: test.index || null,
      sheets: [...new Set((test.groups || []).map((g) => g.sheetId).filter(Boolean))],
      groups: (test.groups || []).map((g) => g.key),
    },
  };
}

// Materialul trimis AI-ului: exercițiile testului, numerotate în ordine, cu
// grupa (și cerința ei comună) deasupra.
export function sourceTextOf(test, { category = null } = {}) {
  const sheets = sheetsOf(test);
  const lines = [
    `Exercițiile testului — copiate din ${sheets.length > 1 ? 'fișele' : 'fișa'} ${sheets.map((s) => `„${s}"`).join(', ')}${category && clasaLabel(category) ? ` (${clasaLabel(category).replace(/^Clasa/, 'clasa')})` : ''}, în ordinea din test:`,
  ];
  let nr = 0;
  const multi = sheets.length > 1;
  for (const g of test.groups || []) {
    if (!g.exercises.length) continue;
    lines.push('', `[${groupLabel(g, multi)}]${g.instruction ? ` Cerința: ${g.instruction}` : ''}`);
    for (const e of g.exercises) { nr++; lines.push(`${nr}) ${e.text}`); }
  }
  return lines.join('\n').slice(0, 14000);
}

// Cerința (câmpul „subiect + instrucțiuni" al generatorului — are prioritate).
// Primul rând devine subiectul scurt (căutare, titlu).
export function topicFor(test, { dataMode = 'keep' } = {}) {
  const sheets = sheetsOf(test).map(shortSheetTitle);
  const groups = (test.groups || []).filter((g) => g.exercises.length).map((g) => g.title);
  const n = (test.groups || []).reduce((s, g) => s + g.exercises.length, 0);
  const head = `${sheets.join(' + ') || 'Fișa de exerciții'} — ${groups.join(', ')}`.slice(0, 118);
  return [
    head,
    `Itemii testului sunt EXACT cele ${n} exerciții din material, în aceeași ordine: itemul 1 = exercițiul 1, itemul 2 = exercițiul 2 … itemul ${n} = exercițiul ${n}. Nu adăuga, nu scoate și nu uni exerciții.`,
    dataMode === 'modify'
      ? 'Fiecare item păstrează tipul, cerința și dificultatea exercițiului lui, dar cu ALTE numere și ALTE notații (alte litere pentru puncte, segmente, variabile, funcții, mulțimi). Recalculează totul.'
      : 'Păstrează EXACT enunțurile, numerele și notațiile exercițiilor — doar le aduci în forma cerută (grilă sau redactare) și le adaugi răspunsul.',
  ].join('\n');
}

const LIT = 'abcdefghij';
// Testul primit de la AI (itemi „cu redactarea răspunsului") ca „exam", cu barem.
// Itemul k vine din exercițiul k (așa e cerut) — deci se așază în grupa lui;
// dacă AI-ul a întors alt număr de itemi, testul are o singură secțiune.
export function aiExamFromQuestions(test, questions, { title = 'Test', durationMin = 50, oficiu = 10, workSpace = true, category = null } = {}) {
  const qs = (questions || []).filter((q) => q && q.statement);
  const of = Math.max(0, Math.min(30, parseInt(oficiu, 10) || 0));
  const pts = distributePoints(qs.length, 100 - of);
  const item = (q, i) => {
    const hasOpts = Array.isArray(q.options) && q.options.length;
    return {
      number: String(i + 1), statement: q.statement, points: pts[i],
      ...(hasOpts ? { options: q.options, answer: LIT[Number(q.answer) || 0] || 'a' } : { answer: String(q.answer ?? '') }),
      solution: q.explanation || '',
    };
  };
  const groups = (test.groups || []).filter((g) => g.exercises.length);
  const total = groups.reduce((s, g) => s + g.exercises.length, 0);
  const multi = sheetsOf(test).length > 1;
  let subjects;
  if (total === qs.length && groups.length) {
    let i = 0;
    subjects = groups.map((g) => {
      const items = g.exercises.map(() => { const it = item(qs[i], i); i++; return it; });
      return { label: groupLabel(g, multi), points: items.reduce((s, it) => s + it.points, 0), items };
    });
  } else {
    const items = qs.map(item);
    subjects = [{ label: 'Exerciții', points: items.reduce((s, it) => s + it.points, 0), items }];
  }
  const sheets = sheetsOf(test);
  return {
    title,
    subtitle: sheets.length ? `După ${sheets.length > 1 ? 'fișele' : 'fișa'} ${sheets.map((s) => `„${s}"`).join(', ')} — cu alte numere și notații` : null,
    nameLine: true,
    durationMin: Math.max(5, Math.min(180, parseInt(durationMin, 10) || 50)),
    oficiu: of,
    totalPoints: 100,
    ...(workSpace ? {} : { workSpace: false }),
    subjects,
    source: {
      kind: 'fise', ai: true, category, testNr: test.index || null,
      sheets: [...new Set(groups.map((g) => g.sheetId).filter(Boolean))],
      groups: groups.map((g) => g.key),
    },
  };
}

// „2 din Nivel 3 · 1 din Nivel 4" — compoziția unui test, pentru interfață
export function compositionLabel(picks, withFigures = false) {
  return normPicks(picks, withFigures).map((p) => `${p.count} din ${p.title}`).join(' · ');
}

// Filtrul subiectelor unui test de examen generat cu AI („🔢 Schimbă numerele")
// după bifele profesorului (aceeași selecție ca la combinarea exactă —
// src/lib/pdfCombine.js: { items:{1:[…],2:[…],3:[…]}, parts:{'2.1':['a','b']} }).
// Exercițiile se păstrează pe poziția lor (numărul din subiect rămâne), la BAC
// problemele II/III doar cu subpunctele bifate. Punctajul: suma celor rămase;
// testul parțial nu mai are puncte din oficiu.
export function filterExamBySelection(exam, selection, { complete = false } = {}) {
  if (!exam || !Array.isArray(exam.subjects)) return exam;
  if (complete || !selection) return exam;
  const label = (l) => String(l || '').replace(/[^a-z]/gi, '').toLowerCase();
  const subjects = [];
  exam.subjects.forEach((s, si) => {
    const sNo = si + 1;
    const want = (selection.items && selection.items[sNo]) || [];
    if (!want.length) return;
    const items = (s.items || []).map((it, ii) => ({ it, no: ii + 1 })).filter(({ no }) => want.includes(no)).map(({ it, no }) => {
      const parts = Array.isArray(it.parts) ? it.parts : null;
      const wp = selection.parts ? selection.parts[`${sNo}.${no}`] : null;
      if (!parts || !parts.length || !Array.isArray(wp)) return it;
      const kept = parts.filter((p) => wp.includes(label(p.label)));
      const points = kept.reduce((n, p) => n + (Number(p.points) || 0), 0);
      return { ...it, parts: kept, ...(points ? { points } : {}) };
    }).filter((it) => !Array.isArray(it.parts) || it.parts.length);
    if (!items.length) return;
    const points = items.reduce((n, it) => n + (Number(it.points) || 0), 0);
    subjects.push({ ...s, items, points: points || s.points });
  });
  const total = subjects.reduce((n, s) => n + (Number(s.points) || 0), 0);
  // timpul de lucru, pe măsura punctelor rămase (din cele 90 ale testului întreg)
  const dur = Number(exam.durationMin) || 120;
  const durationMin = total ? Math.max(10, Math.round((dur * total) / 90 / 5) * 5) : dur;
  return { ...exam, subjects, oficiu: 0, totalPoints: total || exam.totalPoints, durationMin };
}

// Un test interactiv (întrebările generatorului) ca „exam" — pentru „📄 PDF",
// „📝 Barem" și „🖨 Tipărește toate" (aceeași împărțire a punctajului ca la
// „🧩 Generează exerciții/teste interactive/PDF" → export PDF).
export function quizToExam(title, questions, { durationMin = 50, oficiu = 10, workSpace = true } = {}) {
  const qs = (questions || []).filter((q) => q && q.statement);
  const of = Math.max(0, Math.min(30, parseInt(oficiu, 10) || 0));
  const pts = distributePoints(qs.length, 100 - of);
  const items = qs.map((q, i) => {
    const hasOpts = Array.isArray(q.options) && q.options.length;
    return {
      number: String(i + 1), statement: q.statement, points: pts[i],
      ...(hasOpts ? { options: q.options, answer: LIT[Number(q.answer) || 0] || 'a' } : { answer: String(q.answer ?? '') }),
      solution: q.explanation || '',
    };
  });
  return {
    title, nameLine: true,
    durationMin: Math.max(5, Math.min(180, parseInt(durationMin, 10) || 50)),
    oficiu: of, totalPoints: 100,
    ...(workSpace ? {} : { workSpace: false }),
    subjects: [{ label: 'Test', points: 100 - of, items }],
  };
}
