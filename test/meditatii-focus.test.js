// Teste pentru PREGĂTIREA PENTRU LUCRARE/TEST („focus") din meditații
// (node --test, fără dependențe): validarea formularului, aplicarea pe plan
// (capitole lipsă adăugate, „test inițial" = anul trecut, „lucrare" fără
// selecție = toată clasa), prioritatea în nextChapter și detaliile pentru UI.
const test = require('node:test');
const assert = require('node:assert');
const med = require('../api/_lib/meditatii');

const iso = (d) => d.toISOString().slice(0, 10);
const inDays = (n) => { const d = new Date(); d.setDate(d.getDate() + n); return iso(d); };

const PROF7 = { grade: 7, exam_target: null };
const PLAN7 = {
  chapters: [
    { id: 'c7-reale', title: 'Numere reale: radicali', status: 'finalizat', mastery: 0.9 },
    { id: 'c7-ecuatii', title: 'Ecuații și sisteme de ecuații liniare', status: 'de_parcurs', mastery: null },
    { id: 'c7-patrulatere', title: 'Patrulatere', status: 'in_lucru', mastery: 0.4 },
  ],
};

test('cleanFocus: validează tipul, capitolele, textul liber și data limită', () => {
  const f = med.cleanFocus({ kind: 'lucrare', chapterIds: ['c7-ecuatii', '', 'c7-patrulatere'], custom: '  Ecuații cu modul  ', deadline: inDays(10) });
  assert.strictEqual(f.kind, 'lucrare');
  assert.deepStrictEqual(f.chapter_ids, ['c7-ecuatii', 'c7-patrulatere']);
  assert.strictEqual(f.custom, 'Ecuații cu modul');
  assert.strictEqual(f.deadline, inDays(10));
  // examenul final / tip lipsă → null (fără focus — toată materia, ca acum)
  assert.strictEqual(med.cleanFocus({ kind: 'examen' }), null);
  assert.strictEqual(med.cleanFocus({}), null);
  assert.strictEqual(med.cleanFocus(null), null);
  // data din trecut sau invalidă se ignoră (focusul rămâne, fără termen)
  assert.strictEqual(med.cleanFocus({ kind: 'lucrare', deadline: '2020-01-01' }).deadline, null);
  assert.strictEqual(med.cleanFocus({ kind: 'lucrare', deadline: 'mâine' }).deadline, null);
});

test('applyFocus: capitolele alese intră în plan, cu anul trecut și capitolul scris liber', () => {
  const f = med.cleanFocus({
    kind: 'lucrare',
    chapterIds: ['c7-ecuatii', 'c6-rapoarte', 'id-inexistent'],
    custom: 'Ecuații cu modul',
  });
  const { plan, focus } = med.applyFocus({ profile: PROF7, plan: PLAN7, focus: f });
  // id-ul necunoscut a fost eliminat; capitolul din clasa a 6-a (anul trecut)
  // și cel scris liber au fost ADĂUGATE în plan ca „de parcurs"
  assert.deepStrictEqual(focus.chapter_ids, ['c7-ecuatii', 'c6-rapoarte', 'custom-ecuatii-cu-modul']);
  const ids = plan.chapters.map((c) => c.id);
  assert.ok(ids.includes('c6-rapoarte') && ids.includes('custom-ecuatii-cu-modul'));
  assert.strictEqual(plan.chapters.find((c) => c.id === 'c6-rapoarte').status, 'de_parcurs');
  // planul vechi nu pierde nimic
  assert.ok(ids.includes('c7-reale') && ids.includes('c7-patrulatere'));
});

test('applyFocus: „test inițial" fără selecție = toată materia anului trecut', () => {
  const f = med.cleanFocus({ kind: 'test-initial' });
  const { focus } = med.applyFocus({ profile: PROF7, plan: PLAN7, focus: f });
  const c6 = (med.CURRICULUM[6] || []).map((c) => c.id);
  assert.deepStrictEqual(focus.chapter_ids, c6);
});

test('applyFocus: „lucrare" fără selecție și fără text = toată clasa', () => {
  const f = med.cleanFocus({ kind: 'lucrare' });
  const { focus } = med.applyFocus({ profile: PROF7, plan: PLAN7, focus: f });
  assert.deepStrictEqual(focus.chapter_ids, (med.CURRICULUM[7] || []).map((c) => c.id));
});

test('nextChapter: capitolele lucrării au prioritate; la final revine la plan', () => {
  const focus = { chapter_ids: ['c7-ecuatii'] };
  // c7-patrulatere e „in_lucru", dar focusul cere întâi c7-ecuatii
  assert.strictEqual(med.nextChapter(PLAN7, focus).id, 'c7-ecuatii');
  // fără focus: comportamentul vechi (întâi in_lucru)
  assert.strictEqual(med.nextChapter(PLAN7).id, 'c7-patrulatere');
  // focus terminat → cade pe planul normal
  const donePlan = { chapters: PLAN7.chapters.map((c) => (c.id === 'c7-ecuatii' ? { ...c, status: 'finalizat' } : c)) };
  assert.strictEqual(med.nextChapter(donePlan, focus).id, 'c7-patrulatere');
});

test('focusInfo: progres, zile rămase și ritmul necesar pentru data limită', () => {
  const f = med.cleanFocus({ kind: 'lucrare', chapterIds: ['c7-reale', 'c7-ecuatii', 'c7-patrulatere'], deadline: inDays(14) });
  const { plan, focus } = med.applyFocus({ profile: PROF7, plan: PLAN7, focus: f });
  const info = med.focusInfo({ focus }, plan);
  assert.strictEqual(info.total, 3);
  assert.strictEqual(info.done, 1);                    // c7-reale e finalizat
  assert.ok(info.daysLeft >= 13 && info.daysLeft <= 14);
  assert.strictEqual(info.perWeek, 1);                 // 2 rămase / 2 săptămâni
  assert.strictEqual(info.overdue, false);
  assert.ok(info.kindLabel.includes('ucrare'));
  // fără focus pe profil → null (nimic de afișat)
  assert.strictEqual(med.focusInfo({ focus: null }, plan), null);
  assert.strictEqual(med.focusInfo({}, plan), null);
});

test('focusPool: planul + programa + materia anului trecut, fără dubluri', () => {
  const pool = med.focusPool(PROF7, PLAN7);
  const ids = pool.map((c) => c.id);
  assert.ok(ids.includes('c7-ecuatii'));               // din plan/programă
  assert.ok(ids.includes('c6-rapoarte'));              // anul trecut (clasa 6)
  assert.strictEqual(new Set(ids).size, ids.length);   // fără dubluri
  const prev = pool.find((c) => c.id === 'c6-rapoarte');
  assert.ok(/anul trecut/.test(prev.group));
});
