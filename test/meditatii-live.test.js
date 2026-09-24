// Teste pentru MEDITAȚIILE LIVE (sala de tip Zoom cu profesorii virtuali):
// programul pe ora României (inclusiv schimbarea orei), împărțirea EN/BAC între
// profesori, fazele ședinței, alegerea subiectului, drepturile de acces
// (abonament / bilet 10 lei / 1-la-1 cu 8 incluse pe lună), moderarea chatului,
// verificarea răspunsurilor, cronologia comună și mișcarea gurii din voce.
const test = require('node:test');
const assert = require('node:assert');
const L = require('../api/_lib/live');
const mathcheck = require('../api/_lib/mathcheck');

test('ora României: 15:00 în septembrie = 12:00 UTC, în ianuarie = 13:00 UTC', () => {
  assert.strictEqual(L.roTime(2026, 9, 23, 15, 0).toISOString(), '2026-09-23T12:00:00.000Z');
  assert.strictEqual(L.roTime(2026, 1, 15, 15, 0).toISOString(), '2026-01-15T13:00:00.000Z');
  // ziua schimbării orei (25 octombrie 2026): după 04:00 suntem pe UTC+2
  assert.strictEqual(L.roTime(2026, 10, 25, 15, 0).toISOString(), '2026-10-25T13:00:00.000Z');
  assert.strictEqual(L.roTime(2026, 3, 29, 17, 0).toISOString(), '2026-03-29T14:00:00.000Z');
});

test('dayKey: ziua se schimbă la miezul nopții României, nu la UTC', () => {
  assert.strictEqual(L.dayKey(new Date('2026-09-23T21:30:00Z')), '2026-09-24'); // 00:30 în România
  assert.strictEqual(L.dayKey(new Date('2026-09-23T20:30:00Z')), '2026-09-23');
  assert.strictEqual(L.addDays('2026-12-31', 1), '2027-01-01');
  assert.strictEqual(L.addDays('2026-03-01', -1), '2026-02-28');
});

test('programul implicit: zilnic 17–19, patru săli la aceeași oră (EN, BAC Mate-Info, Șt. Naturii, Tehnologic)', () => {
  assert.deepStrictEqual(L.intervals().map((x) => x.label), ['17:00–19:00']);
  const s = L.slots();
  assert.deepStrictEqual(s.map((x) => x.id), ['17-en', '17-mi', '17-sn', '17-teh']);
  assert.deepStrictEqual(s.map((x) => x.roomLabel), ['Evaluarea Națională', 'BAC Mate-Info', 'BAC Științele Naturii', 'BAC Tehnologic']);
  assert.deepStrictEqual(s.map((x) => `${x.exam}/${x.profile}`), ['en/null', 'bac/mate-info', 'bac/stiinte-naturii', 'bac/tehnologic']);
  assert.ok(!L.rooms().some((r) => r.profile === 'pedagogic'), 'fără BAC pedagogic');
  const t = L.slotTimes('2026-09-23', s[3]);
  assert.strictEqual(t.startsAt, '2026-09-23T14:00:00.000Z');          // 17:00 în România (vara)
  assert.strictEqual(t.endsAt, '2026-09-23T16:00:00.000Z');
  assert.strictEqual(L.EXAM_LABEL('bac', 'tehnologic'), 'BAC Tehnologic');
  assert.strictEqual(L.EXAM_LABEL('en', null), 'Evaluarea Națională');
  // ora și sălile se schimbă din env, fără cod
  process.env.LIVE_INTERVALE = '18-20, 18:30-20:30, prost';
  process.env.LIVE_SALI = 'bac-tehnologic, EN, pedagogic';
  try {
    assert.deepStrictEqual(L.intervals().map((x) => x.label), ['18:00–20:00', '18:30–20:30']);
    assert.deepStrictEqual(L.rooms().map((r) => r.id), ['teh', 'en']);
    assert.deepStrictEqual(L.slots().map((x) => x.id), ['18-teh', '18-en', '1830-teh', '1830-en']);
    process.env.LIVE_SALI = 'nimic-valid';
    assert.deepStrictEqual(L.rooms().map((r) => r.id), ['en', 'mi', 'sn', 'teh'], 'o valoare greșită → sălile implicite');
  } finally { delete process.env.LIVE_INTERVALE; delete process.env.LIVE_SALI; }
});

test('programul: un profesor, câte o ședință pe zi în fiecare sală, cu examenul sălii în fiecare zi', () => {
  assert.deepStrictEqual(L.teachers().map((t) => t.id), ['radu']);
  const plan = L.plannedSessions('2026-09-23');
  assert.strictEqual(plan.length, 4);
  assert.ok(plan.every((p) => p.kind === 'grup' && p.teacher === 'radu' && p.starts_at === plan[0].starts_at), 'toate la aceeași oră');
  assert.deepStrictEqual(plan.map((p) => p.profile), [null, 'mate-info', 'stiinte-naturii', 'tehnologic']);
  for (const day of ['2026-09-23', '2026-09-24']) {
    assert.deepStrictEqual(L.examFor(day, '17-teh'), { exam: 'bac', profile: 'tehnologic' });
    assert.deepStrictEqual(L.examFor(day, '17-en'), { exam: 'en', profile: null });
  }
  // cu doi profesori: fiecare are sălile lui (4 × 2)
  const two = L.plannedSessions('2026-09-23', [{ id: 'radu' }, { id: 'ana' }]);
  assert.strictEqual(two.length, 8);
  assert.strictEqual(new Set(two.map((p) => `${p.slot}|${p.teacher}`)).size, 8, 'unic pe zi + sală + profesor');
});

test('fazele: viitoare → sala de așteptare (15 min înainte) → live → încheiată', () => {
  const s = { starts_at: '2026-09-23T14:00:00Z', ends_at: '2026-09-23T16:00:00Z', status: 'programata' };
  assert.strictEqual(L.phaseOf(s, new Date('2026-09-23T13:30:00Z')), 'viitoare');
  assert.strictEqual(L.phaseOf(s, new Date('2026-09-23T13:50:00Z')), 'sala_asteptare');
  assert.strictEqual(L.phaseOf(s, new Date('2026-09-23T14:00:00Z')), 'live');
  assert.strictEqual(L.phaseOf(s, new Date('2026-09-23T15:59:59Z')), 'live');
  assert.strictEqual(L.phaseOf(s, new Date('2026-09-23T16:00:00Z')), 'incheiata');
  assert.strictEqual(L.phaseOf({ ...s, status: 'anulata' }, new Date('2026-09-23T14:30:00Z')), 'anulata');
  assert.ok(L.canJoinPhase('live') && L.canJoinPhase('sala_asteptare') && !L.canJoinPhase('viitoare'));
});

test('alegerea subiectului: întâi lecțiile deja pregătite, apoi subiectele noi, apoi cel mai vechi', () => {
  const now = new Date('2026-09-23T10:00:00Z');
  const recent = '2026-09-20T10:00:00Z', old = '2026-07-01T10:00:00Z';
  const c = [
    { id: 'a', ready: true, lastUsed: recent },   // pregătită, dar folosită de curând
    { id: 'b', ready: false, lastUsed: null },    // nouă
    { id: 'c', ready: true, lastUsed: old },      // pregătită, folosită demult → câștigă
  ];
  assert.strictEqual(L.pickSubject(c, { now, seed: 'x' }).id, 'c');
  assert.strictEqual(L.pickSubject(c.filter((x) => x.id !== 'c'), { now, seed: 'x' }).id, 'b');
  assert.strictEqual(L.pickSubject([{ id: 'a', lastUsed: recent }, { id: 'd', lastUsed: old }], { now }).id, 'd');
  assert.strictEqual(L.pickSubject([], {}), null);
  // determinist: același seed → același rezultat
  const many = Array.from({ length: 20 }, (_, i) => ({ id: 's' + i, ready: false, lastUsed: null }));
  assert.strictEqual(L.pickSubject(many, { seed: 'zi-15-radu' }).id, L.pickSubject(many, { seed: 'zi-15-radu' }).id);
  assert.ok(!L.pickSubject(many, { seed: 'q', exclude: ['s1', 's2'] }).id.match(/^s[12]$/));
});

test('acces la grup: abonament / admin gratuit, altfel bilet de 10 lei', () => {
  assert.deepStrictEqual(L.groupAccess({ profile: { subscription_status: 'active' } }), { ok: true, via: 'abonament', price: 0 });
  assert.strictEqual(L.groupAccess({ profile: { is_admin: true } }).via, 'admin');
  const no = L.groupAccess({ profile: { subscription_status: 'inactive' } });
  assert.strictEqual(no.ok, false);
  assert.strictEqual(no.price, 10);
  assert.strictEqual(L.groupAccess({ profile: {}, ticket: { status: 'platit' } }).via, 'bilet');
  assert.strictEqual(L.groupAccess({ profile: {}, ticket: { status: 'rambursat' } }).ok, false);
});

test('acces 1-la-1: 8 incluse pe lună pentru abonați, apoi bilet de 20 lei', () => {
  const sub = { subscription_status: 'active' };
  let a = L.privateAccess({ profile: sub, includedUsed: 3 });
  assert.strictEqual(a.via, 'inclus'); assert.strictEqual(a.includedLeft, 5);
  a = L.privateAccess({ profile: sub, includedUsed: 8 });
  assert.strictEqual(a.ok, false); assert.strictEqual(a.price, 20);
  a = L.privateAccess({ profile: sub, includedUsed: 8, unusedTickets: 1 });
  assert.strictEqual(a.via, 'bilet');
  a = L.privateAccess({ profile: {}, includedUsed: 0 });
  assert.strictEqual(a.ok, false, 'fără abonament nu există ședințe incluse');
  assert.strictEqual(L.privateAccess({ profile: { is_admin: true }, includedUsed: 99 }).via, 'admin');
  process.env.LIVE_PRIVAT_INCLUSE = '2';
  try { assert.strictEqual(L.privateAccess({ profile: sub, includedUsed: 2 }).ok, false); }
  finally { delete process.env.LIVE_PRIVAT_INCLUSE; }
});

test('numele afișat: prenume + inițiala (fără numele complet al unui minor)', () => {
  assert.strictEqual(L.displayName('andrei mihai POPESCU'), 'Andrei P.');
  assert.strictEqual(L.displayName('Ioana'), 'Ioana');
  assert.strictEqual(L.displayName('Ștefan Țurcanu'), 'Ștefan Ț.');
  assert.match(L.displayName('', 'ab12cd34-0000'), /^Elev AB12$/);
});

test('moderarea: linkuri, emailuri, telefoane, conturi și înjurături nu ajung la ceilalți', () => {
  let m = L.moderate('scrie-mi pe 0722 123 456 sau pe andrei@gmail.com, vezi www.site.ro');
  assert.ok(m.flagged);
  assert.ok(!/0722|gmail|www/.test(m.text), m.text);
  m = L.moderate('ești un prost');
  assert.ok(m.flagged); assert.ok(m.text.includes('***'));
  m = L.moderate('insta: andrei.mate123');
  assert.ok(m.flagged && !m.text.includes('andrei.mate123'));
  m = L.moderate('De ce delta e 16?');
  assert.ok(!m.flagged); assert.strictEqual(m.text, 'De ce delta e 16?');
  assert.strictEqual(L.moderate('x'.repeat(500)).text.length, 300);
});

test('întrebările pentru profesor sunt recunoscute', () => {
  assert.ok(L.isQuestion('De ce se împarte la 2'));
  assert.ok(L.isQuestion('nu am înțeles pasul 3'));
  assert.ok(L.isQuestion('cât dă la b?'));
  assert.ok(!L.isQuestion('salut tuturor'));
  assert.ok(!L.isQuestion('bravo'));
});

test('răspunsurile la sondaje: grilă pe literă, completare cu echivalență matematică', () => {
  const g = { id: 'p1', type: 'grila', options: ['1', '2', '3', '4'], answer: 'c' };
  assert.strictEqual(L.checkPollAnswer(g, 'c'), true);
  assert.strictEqual(L.checkPollAnswer(g, 'C)'), true);
  assert.strictEqual(L.checkPollAnswer(g, 'b'), false);
  assert.strictEqual(L.checkPollAnswer(g, ''), false);
  const c = { id: 'p2', type: 'completare', answer: '0,5' };
  assert.strictEqual(L.checkPollAnswer(c, '1/2', mathcheck.answersEquivalent), true);
  assert.strictEqual(L.checkPollAnswer(c, '0.5', mathcheck.answersEquivalent), true);
  assert.strictEqual(L.checkPollAnswer(c, '2', mathcheck.answersEquivalent), false);
  const u = { id: 'p3', type: 'completare', answer: '24 cm', accept: ['24'] };
  assert.strictEqual(L.checkPollAnswer(u, '24'), true);
  const r = L.pollResults(g, [{ answer: 'c', correct: true }, { answer: 'b', correct: false }, { answer: 'c', correct: true }, { answer: 'a', correct: false }]);
  assert.strictEqual(r.total, 4); assert.strictEqual(r.correct, 2); assert.strictEqual(r.correctPct, 50);
  assert.strictEqual(r.pct.c, 50); assert.strictEqual(r.byOption.b, 1);
  // răspunsul corect NU pleacă în browser cât timp sondajul e deschis
  assert.strictEqual(L.publicPoll(g).answer, undefined);
  assert.strictEqual(L.publicPoll(g, true).answer, 'c');
});

// un script mic: 2 itemi de grilă (Subiectul I) + 2 cu rezolvare (Subiectul III)
function miniScript() {
  const seg = (id, say, board = []) => ({ id, say, board });
  const item = (i, section, grila) => ({
    ref: `${section}.${i}`, section, title: `Subiectul ${section}, exercițiul ${i}`,
    statement: `Enunț ${i}`, options: grila ? ['1', '2', '3', '4'] : null,
    intro: [seg(`i${section}${i}`, 'Citesc enunțul exercițiului.')],
    tryPoll: grila ? { id: `t${section}${i}`, type: 'grila', question: 'Ce variantă?', options: ['1', '2', '3', '4'], answer: 'b' } : null,
    afterTry: grila ? [seg(`r${section}${i}`, 'Să vedem rezultatele.')] : [],
    modes: {
      barem: [seg(`b${section}${i}`, 'Pe barem calculăm pas cu pas.', ['$x=2$'])],
      intuitiv: [seg(`n${section}${i}`, 'Pe înțelesul tuturor, gândiți așa.')],
      greseli: [seg(`g${section}${i}`, 'Greșeala frecventă este semnul.')],
    },
    check: grila ? null : { id: `c${section}${i}`, type: 'completare', question: 'Cât este x?', answer: '2' },
    afterCheck: grila ? [] : [seg(`k${section}${i}`, 'Corect este 2.')],
  });
  return {
    intro: [seg('in1', 'Bună seara tuturor! Astăzi rezolvăm un subiect de examen.')],
    items: [item(1, 'I', true), item(2, 'I', true), item(1, 'III', false), item(2, 'III', false)],
    qna: [seg('q1', 'Aveți întrebări? Scrieți-le în chat.')],
    breakSay: [seg('p1', 'Facem o pauză de cinci minute.')],
    outro: [seg('o1', 'Mulțumesc tuturor, ne vedem la următoarea ședință!')],
  };
}

test('cronologia de grup: intro → enunț → sondaj → rezultate → explicații → întrebări → final', () => {
  const audio = { in1: { url: 'u', dur: 4, lip: null }, bI1: { url: 'b', dur: 10, lip: 'AA==' } };
  const tl = L.buildTimeline(miniScript(), audio, { mode: 'grup', qnaSec: 60 });
  const types = tl.scenes.map((s) => s.type);
  assert.strictEqual(types[0], 'intro');
  assert.strictEqual(types[types.length - 1], 'final');
  assert.deepStrictEqual(types.slice(1, 6), ['item', 'sondaj', 'rezultate', 'explicatie', 'explicatie']);
  assert.ok(types.includes('intrebari'), 'întrebări la schimbarea subiectului');
  // scenele se succed fără goluri
  for (let i = 1; i < tl.scenes.length; i++) {
    const p = tl.scenes[i - 1];
    assert.ok(Math.abs(tl.scenes[i].t0 - (p.t0 + p.dur)) < 1e-6, `gol la scena ${i}`);
  }
  // durata măsurată din audio e folosită
  const expl = tl.scenes.find((s) => s.type === 'explicatie');
  assert.strictEqual(expl.segs[0].dur, 10);
  assert.strictEqual(expl.segs[0].audio, 'b');
  // sondajul nu dezvăluie răspunsul, rezultatele da
  const poll = tl.scenes.find((s) => s.type === 'sondaj');
  assert.strictEqual(poll.poll.answer, undefined);
  assert.strictEqual(tl.scenes.find((s) => s.type === 'rezultate').poll.answer, 'b');
  // itemii cu rezolvare au verificare după explicație
  const iii = tl.scenes.filter((s) => s.section === 'III' && s.type === 'sondaj');
  assert.ok(iii.length >= 2 && iii.every((s) => s.verificare));
});

test('cronologia 1-la-1: sondajele așteaptă răspunsul, iar după explicație vine „Ai înțeles?"', () => {
  const tl = L.buildTimeline(miniScript(), {}, { mode: 'privat' });
  const types = tl.scenes.map((s) => s.type);
  assert.ok(!types.includes('intrebari') && !types.includes('pauza'));
  const polls = tl.scenes.filter((s) => s.type === 'sondaj');
  assert.ok(polls.every((p) => p.wait === true && p.dur === 0));
  const chk = tl.scenes.filter((s) => s.type === 'intrebare_intelegere');
  assert.strictEqual(chk.length, 4);
  assert.deepStrictEqual(chk[0].modes, ['intuitiv', 'greseli']);
  // la 1-la-1 al doilea mod NU se pune automat (se cere cu „Explică altfel")
  assert.strictEqual(tl.scenes.filter((s) => s.type === 'explicatie').length, 4);
});

test('încadrarea în 2 ore: taie întâi al doilea mod, apoi itemi; lecția scurtă lungește întrebările', () => {
  const s = miniScript();
  const long = {};
  for (const it of s.items) for (const m of Object.values(it.modes)) for (const g of m) long[g.id] = { dur: 900 };
  const fit = L.fitTimeline(s, long, 7200);
  assert.ok(fit.duration <= 7200, `durata ${fit.duration}`);
  assert.ok(fit.covered < fit.total || fit.fit.dropAlt, 'a tăiat ceva');
  const plain = L.buildTimeline(s, {}, { mode: 'grup' });
  const short = L.fitTimeline(s, {}, 7200);
  assert.ok(short.duration > plain.duration + 1000, 'întrebările au crescut spre țintă');
  assert.ok(short.duration <= 7200 + 60);
  assert.ok(short.scenes.filter((x) => x.type === 'intrebari').every((x) => x.dur <= 20 * 60 + 30), 'dar nu peste 20 de minute o sesiune de întrebări');
  assert.strictEqual(short.covered, 4);
});

test('sceneAt: găsește scena și poziția în ea', () => {
  const tl = L.buildTimeline(miniScript(), {}, { mode: 'grup', qnaSec: 30 });
  const s2 = tl.scenes[2];
  const at = L.sceneAt(tl, s2.t0 + 1);
  assert.strictEqual(at.index, 2);
  assert.ok(Math.abs(at.offset - 1) < 1e-6);
  assert.strictEqual(L.sceneAt(tl, -5).index, 0);
  assert.strictEqual(L.sceneAt(tl, 1e9).index, tl.scenes.length - 1);
});

test('coada vocii la întrebări: deterministă, în ferestrele de întrebări, fără suprapuneri', () => {
  const windows = [{ t0: 100, t1: 160 }, { t0: 500, t1: 540 }];
  const msgs = [
    { id: 3, createdSec: 20, dur: 20 },
    { id: 5, createdSec: 110, dur: 25 },
    { id: 9, createdSec: 120, dur: 30 },   // nu mai încape în prima fereastră → a doua
    { id: 12, createdSec: 130, dur: 60 },  // nu încape nicăieri → doar text
  ];
  const s = L.qnaSchedule(msgs, windows);
  assert.deepStrictEqual(s.map((x) => x.id), [3, 5, 9]);
  assert.strictEqual(s[0].at, 100);
  assert.ok(s[1].at >= s[0].at + s[0].dur);
  assert.ok(s[2].at >= 500);
  assert.deepStrictEqual(L.qnaSchedule(msgs, windows), s, 'același calcul în fiecare browser');
});

test('mișcarea gurii: liniște → gura închisă; vocea → gura se deschide; 25 cadre/s', () => {
  const sr = 24000;
  const pcm = new Int16Array(sr * 2); // 2 s: prima secundă liniște, a doua un „a" (200 Hz)
  for (let i = sr; i < 2 * sr; i++) pcm[i] = Math.round(12000 * Math.sin(2 * Math.PI * 200 * i / sr) * (0.6 + 0.4 * Math.sin(2 * Math.PI * 4 * i / sr)));
  const b64 = L.lipFromPcm(pcm, sr);
  const frames = Buffer.from(b64, 'base64');
  assert.strictEqual(frames.length, 50);
  assert.strictEqual(L.lipAt(b64, 0.5).open, 0);
  const speaking = [1.2, 1.4, 1.6, 1.8].map((t) => L.lipAt(b64, t).open);
  assert.ok(Math.max(...speaking) > 0.5, `deschidere ${speaking}`);
  assert.ok(L.lipAt(b64, 1.5).shape < 0.5, 'sunet grav → formă rotunjită');
  assert.strictEqual(L.pcmDuration(48000, 24000), 1);
});
