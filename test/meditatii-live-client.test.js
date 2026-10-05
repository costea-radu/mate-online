// Teste pentru partea din BROWSER a sălii live (module ESM din src/lib/live):
//   · „camera" de pe telefon (framing.js): pe un ecran lat se văd tabla și
//     proiecția deodată; pe telefon camera se mută între explicație și exercițiu;
//   · playerul 1-la-1 (player.js): la un segment fără voce generată (elevul a
//     sărit înainte cu ⏭) profesorul NU mai rămâne blocat în „vocea se
//     pregătește" — după câteva secunde vorbește cu vocea browserului;
//   · ordinea vocii pe server (liveLesson.voiceOrder): întâi itemul la care e elevul.
const test = require('node:test');
const assert = require('node:assert');
const path = require('node:path');
const fs = require('node:fs');

let framingP = null, playerP = null;
const framing = () => (framingP || (framingP = import('../src/lib/live/framing.js')));
// player.js importă fără extensie („./clock", ca în Vite) → o copie temporară cu „.js"
function importLive(names, main) {
  const os = require('node:os');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'live-client-'));
  for (const n of names) {
    const src = fs.readFileSync(path.join(__dirname, '..', 'src', 'lib', 'live', `${n}.js`), 'utf8')
      .replace(/from '\.\/([\w-]+)'/g, "from './$1.mjs'");
    fs.writeFileSync(path.join(dir, `${n}.mjs`), src);
  }
  return import(require('node:url').pathToFileURL(path.join(dir, `${main}.mjs`)).href);
}
const player = () => (playerP || (playerP = importLive(['player', 'clock', 'timeline'], 'player')));
const RIG = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'public', 'live', 'radu', 'rig.json'), 'utf8'));

test('camera: pe desktop tabla și proiecția încap citibil (fără butonul explicație ↔ exercițiu)', async () => {
  const F = await framing();
  for (const size of [{ w: 1450, h: 710 }, { w: 1000, h: 640 }, { w: 1920, h: 950 }]) {
    assert.strictEqual(F.isNarrow(RIG, size), false, JSON.stringify(size));
    const f = F.frameScene(RIG, size, { focus: 'ecran' });
    assert.strictEqual(f.focus, null, 'pe ecran lat camera nu se mută');
  }
});

test('camera: pe telefon (vertical și culcat) camera se mută între tablă și exercițiu', async () => {
  const F = await framing();
  const W = RIG.width, H = RIG.height;
  const box = (q) => F.quadBox(q, W, H);
  for (const size of [{ w: 390, h: 690 }, { w: 830, h: 290 }, { w: 360, h: 600 }]) {
    assert.strictEqual(F.isNarrow(RIG, size), true, JSON.stringify(size));
    for (const focus of ['tabla', 'ecran']) {
      const f = F.frameScene(RIG, size, { focus, inset: F.sceneInset({ landscape: size.w > size.h }) });
      assert.strictEqual(f.focus, focus);
      // zona țintă e ÎNTREAGĂ în cadru, iar poza acoperă tot cadrul (fără margini goale)
      const b = box(focus === 'tabla' ? RIG.board : RIG.screen);
      assert.ok(b.x0 * f.sc + f.ox >= -1 && b.x1 * f.sc + f.ox <= size.w + 1, `${focus} ${JSON.stringify(size)} pe orizontală`);
      assert.ok(b.y0 * f.sc + f.oy >= -1 && b.y1 * f.sc + f.oy <= size.h + 1, `${focus} ${JSON.stringify(size)} pe verticală`);
      assert.ok(f.ox <= 0 && f.oy <= 0 && f.ox + f.dw >= size.w - 1 && f.oy + f.dh >= size.h - 1, 'poza acoperă cadrul');
      // scrisul iese citibil (≥ 12 px pe ecran)
      const px = focus === 'tabla' ? 64 * ((b.x1 - b.x0) / F.BOARD_W) * f.sc : 36 * ((b.x1 - b.x0) / F.SCREEN_W) * f.sc;
      assert.ok(px >= 12, `${focus} ${JSON.stringify(size)}: ${px.toFixed(1)} px`);
    }
  }
  // telefonul vertical: la explicație se vede și profesorul, lângă tablă
  const f = F.frameScene(RIG, { w: 390, h: 690 }, { focus: 'tabla', inset: F.sceneInset() });
  const actorLeft = RIG.actor.x * f.sc + f.ox;
  assert.ok(actorLeft < 390 - 20, 'profesorul intră în cadru');
});

test('camera: cu telefonul culcat camera nu se depărtează față de planul obișnuit; cardul din dreapta e ocolit', async () => {
  const F = await framing();
  const size = { w: 830, h: 290 };
  const over = F.frameOverview(RIG, size, 1);
  const t = F.frameScene(RIG, size, { focus: 'tabla', inset: F.sceneInset({ landscape: true }) });
  assert.ok(t.sc >= over.sc - 1e-9);
  const withCard = F.frameScene(RIG, size, { focus: 'ecran', inset: F.sceneInset({ landscape: true, card: true }) });
  const s = F.quadBox(RIG.screen, RIG.width, RIG.height);
  assert.ok(s.x1 * withCard.sc + withCard.ox <= size.w * 0.53 + 2, 'proiecția stă în stânga cardului');
});

test('camera: urmează lecția — enunțul și întrebarea pe proiecție, explicația pe tablă', async () => {
  const F = await framing();
  assert.strictEqual(F.autoFocus({ phase: 'live', scene: { type: 'item' } }), 'ecran');
  assert.strictEqual(F.autoFocus({ phase: 'live', scene: { type: 'sondaj' } }), 'ecran');
  assert.strictEqual(F.autoFocus({ phase: 'live', scene: { type: 'rezultate' } }), 'ecran');
  assert.strictEqual(F.autoFocus({ phase: 'live', scene: { type: 'explicatie' } }), 'tabla');
  assert.strictEqual(F.autoFocus({ phase: 'live', scene: { type: 'intrebare_intelegere' } }), 'tabla');
  assert.strictEqual(F.autoFocus({ phase: 'live', scene: { type: 'intro' } }), 'profesor');
  assert.strictEqual(F.autoFocus({ phase: 'live', inserted: 'raspuns', scene: { type: 'raspuns', answerBoard: ['$x=2$'] } }), 'tabla');
  assert.strictEqual(F.autoFocus(null), 'profesor');
});

test('rig.json: rama tablei (conturul de pe telefon) e în jurul zonei de scris și a proiecției', async () => {
  const F = await framing();
  assert.ok(Array.isArray(RIG.boardFrame) && RIG.boardFrame.length === 4);
  const fr = F.quadBox(RIG.boardFrame, 1, 1), b = F.quadBox(RIG.board, 1, 1), s = F.quadBox(RIG.screen, 1, 1);
  for (const z of [b, s]) assert.ok(fr.x0 <= z.x0 && fr.x1 >= z.x1 && fr.y0 <= z.y0 && fr.y1 >= z.y1);
});

// ─── playerul 1-la-1: vocea care întârzie nu mai blochează lecția ─────────────
function fakeEngine() {
  const played = [];
  return {
    played,
    play(id, o) { played.push({ id, url: o.url, text: o.text }); this.active.add(id); return Promise.resolve({}); },
    active: new Set(),
    isPlaying(id) { return this.active.has(id); },
    stopAll() { this.active.clear(); },
    stopExcept(keep) { for (const id of [...this.active]) if (!keep.has(id)) this.active.delete(id); },
    mouth() { return { open: 0, speaking: false }; },
  };
}
function voicedTimeline() {
  const seg = (id, t, audio) => ({ id, t, dur: 2, say: `fraza ${id}`, caption: `fraza ${id}`, board: [], audio, lip: null });
  return {
    duration: 40,
    scenes: [
      { type: 'intro', t0: 0, dur: 2.5, segs: [seg('in0', 0, 'https://x/in0.mp3')] },
      { type: 'item', item: 0, ref: 'I.1', t0: 2.5, dur: 2.5, segs: [seg('i0', 0, 'https://x/i0.mp3')], statement: 'A' },
      { type: 'item', item: 1, ref: 'III.1.a', t0: 5, dur: 4.5, segs: [seg('i1', 0, null), seg('i1b', 2.2, null)], statement: 'B' },
      { type: 'final', t0: 9.5, dur: 2.5, segs: [seg('fi', 0, null)] },
    ],
  };
}

test('player 1-la-1: după ⏭ la un item fără voce generată, profesorul vorbește cu vocea browserului (nu rămâne în „vocea se pregătește")', async () => {
  const { PrivatePlayer, VOICE_WAIT_MS } = await player();
  const realNow = Date.now;
  let now = 1_000_000;
  Date.now = () => now;
  try {
    const engine = fakeEngine();
    const states = [];
    let asked = 0;
    const p = new PrivatePlayer({ engine, onState: (s) => states.push(s), onNeedAudio: () => { asked++; } });
    p.setTimeline(voicedTimeline());
    p.start(); clearInterval(p.timer); p.timer = null;          // bătăile le dăm noi
    p.nextItem();                                               // intro → I.1
    p.nextItem();                                               // I.1 → III.1.a (fără voce generată)
    const t0 = now;
    now += 300; p.tick();
    assert.strictEqual(p.status, 'incarca', 'întâi așteaptă puțin vocea generată');
    assert.strictEqual(asked, 1);
    while (now - t0 < VOICE_WAIT_MS - 600) { now += 500; p.tick(); }
    assert.strictEqual(p.status, 'incarca');
    assert.ok(asked >= 3, 'cât așteaptă, reîntreabă serverul');
    now = t0 + VOICE_WAIT_MS + 50; p.tick();
    assert.strictEqual(p.status, 'ruleaza', 'după așteptare, lecția merge mai departe');
    assert.strictEqual(p.voiceFallback, true);
    now += 400; p.tick();
    const spoke = engine.played.find((x) => x.id === 'i1');
    assert.ok(spoke && spoke.url === null && spoke.text === 'fraza i1', 'fraza e rostită de vocea browserului');
    // alt salt: nu mai așteaptă deloc
    p.prevItem(); now += 5000; p.tick();
    p.nextItem(); now += 300; p.tick();
    assert.notStrictEqual(p.status, 'incarca');
    assert.ok(states.length > 0);
  } finally { Date.now = realNow; }
});

test('player 1-la-1: dacă vocea generată sosește cât așteaptă, o folosește pe ea', async () => {
  const { PrivatePlayer } = await player();
  const realNow = Date.now;
  let now = 5_000_000;
  Date.now = () => now;
  try {
    const engine = fakeEngine();
    const tl = voicedTimeline();
    const p = new PrivatePlayer({ engine, onState: () => {}, onNeedAudio: () => {} });
    p.setTimeline(tl);
    p.start(); clearInterval(p.timer); p.timer = null;
    p.gotoItem(1); now += 300; p.tick();
    assert.strictEqual(p.status, 'incarca');
    // serverul a generat între timp vocea itemului
    const tl2 = JSON.parse(JSON.stringify(tl));
    tl2.scenes[2].segs.forEach((g) => { g.audio = `https://x/${g.id}.mp3`; });
    p.setTimeline(tl2);
    now += 1000; p.tick();
    assert.strictEqual(p.status, 'ruleaza');
    assert.strictEqual(p.voiceFallback, false);
    now += 400; p.tick();
    assert.ok(engine.played.some((x) => x.id === 'i1' && x.url === 'https://x/i1.mp3'));
  } finally { Date.now = realNow; }
});

test('vocea pe server: întâi itemul la care a sărit elevul, apoi restul (fără dubluri)', () => {
  const LL = require('../api/_lib/liveLesson');
  const seg = (id) => ({ id, say: id });
  const script = {
    intro: [seg('in')], qna: [seg('qa')], breakSay: [], outro: [seg('fi')],
    items: [
      { ref: 'I.1', intro: [seg('a1')], afterTry: [], modes: { barem: [seg('a2')] }, afterCheck: [] },
      { ref: 'II.1', intro: [seg('b1')], afterTry: [], modes: { barem: [seg('b2')], intuitiv: [seg('b3')] }, afterCheck: [] },
      { ref: 'III.1.a', intro: [seg('c1')], afterTry: [], modes: { barem: [seg('c2')] }, afterCheck: [] },
    ],
  };
  assert.deepStrictEqual(LL.voiceOrder(script).map((s) => s.id), ['in', 'a1', 'a2', 'b1', 'b2', 'b3', 'c1', 'c2', 'qa', 'fi']);
  assert.deepStrictEqual(LL.voiceOrder(script, 'III.1.a').map((s) => s.id), ['c1', 'c2', 'in', 'a1', 'a2', 'b1', 'b2', 'b3', 'qa', 'fi']);
  assert.deepStrictEqual(LL.voiceOrder(script, 'II.1').map((s) => s.id), ['b1', 'b2', 'b3', 'c1', 'c2', 'in', 'a1', 'a2', 'qa', 'fi']);
  assert.deepStrictEqual(LL.voiceOrder(script, 'X.9').map((s) => s.id), LL.voiceOrder(script).map((s) => s.id));
});

// ─── „📋 Exerciții": elevul alege ce exercițiu lucrează, nu neapărat la rând ───
const itemsLib = () => import('../src/lib/live/items.js');

test('📋 exercițiile: referințe, etichete, structura examenului (EN / BAC), grupate pe subiecte și pe subpuncte', async () => {
  const I = await itemsLib();
  assert.deepStrictEqual(I.parseRef('II.2.b'), { section: 'II', ex: 2, letter: 'b' });
  assert.deepStrictEqual(I.parseRef('III.1'), { section: 'III', ex: 1, letter: null });
  assert.deepStrictEqual(I.parseRef('I.5'), { section: 'I', ex: 5, letter: null });
  assert.strictEqual(I.parseRef('Subiect'), null);
  assert.strictEqual(I.refLabel('II.2.b'), 'S. II · ex. 2 b)');
  assert.strictEqual(I.refLabel('III.1.c', { long: true }), 'Subiectul al III-lea, exercițiul 1 c)');
  assert.strictEqual(I.refLabel('I.5', { long: true }), 'Subiectul I, exercițiul 5');
  // înainte să fie gata lecția: structura obișnuită a examenului
  const bac = I.defaultRefs('bac');
  assert.strictEqual(bac.length, 6 + 2 * 3 + 2 * 3);
  assert.ok(bac.some((x) => x.ref === 'II.2.b') && bac.some((x) => x.ref === 'III.1.c'));
  const en = I.defaultRefs('en');
  assert.strictEqual(en.length, 18);
  assert.ok(en.every((x) => !I.parseRef(x.ref).letter), 'la EN, exercițiile sunt întregi');
  const g = I.groupItems(bac);
  assert.deepStrictEqual(g.map((s) => s.label), ['Subiectul I', 'Subiectul al II-lea', 'Subiectul al III-lea']);
  assert.deepStrictEqual(g[0].groups.map((x) => x.ex), [1, 2, 3, 4, 5, 6]);
  assert.deepStrictEqual(g[1].groups.map((x) => [x.ex, x.items.map((i) => i.letter).join('')]), [[1, 'abc'], [2, 'abc']]);
  // ordinea din lecție nu contează: grupele ies în ordinea din examen
  const shuffled = I.groupItems([{ ref: 'III.1.b' }, { ref: 'I.2' }, { ref: 'III.1.a' }, { ref: 'II.4' }]);
  assert.deepStrictEqual(shuffled.map((s) => s.section), ['I', 'II', 'III']);
  assert.deepStrictEqual(shuffled[2].groups[0].items.map((i) => i.ref), ['III.1.a', 'III.1.b']);
});

test('📋 exercițiul ales: scena lui de început (exact, problemă ↔ subpunct, lipsă → următorul din lecție); starea fiecăruia', async () => {
  const I = await itemsLib();
  const tl = { scenes: [
    { type: 'intro' },
    { type: 'item', item: 0, ref: 'I.5', title: 'Subiectul I, exercițiul 5' }, { type: 'sondaj', item: 0, poll: { id: 'p0' } },
    { type: 'item', item: 1, ref: 'II.2.a' }, { type: 'sondaj', item: 1, poll: { id: 'p1' } },
    { type: 'item', item: 2, ref: 'II.2.b' },
    { type: 'item', item: 3, ref: 'III.1' }, { type: 'sondaj', item: 3, poll: { id: 'p3' } },
  ] };
  assert.deepStrictEqual(I.sceneIndexForRef(tl, 'II.2.b'), { index: 5, exact: true, ref: 'II.2.b' });
  assert.deepStrictEqual(I.sceneIndexForRef(tl, 'II.2'), { index: 3, exact: true, ref: 'II.2.a' }, 'problema întreagă → primul subpunct');
  assert.deepStrictEqual(I.sceneIndexForRef(tl, 'III.1.c'), { index: 6, exact: true, ref: 'III.1' }, 'subpunct ales, lecția are problema întreagă');
  assert.deepStrictEqual(I.sceneIndexForRef(tl, 'I.6'), { index: 3, exact: false, ref: 'II.2.a' }, 'lipsește → următorul din lecție');
  assert.deepStrictEqual(I.sceneIndexForRef(tl, 'III.6'), { index: -1, exact: false });
  assert.deepStrictEqual(I.sceneIndexForRef(tl, null), { index: -1, exact: false });
  assert.deepStrictEqual(I.itemsFromTimeline(tl).map((x) => x.ref), ['I.5', 'II.2.a', 'II.2.b', 'III.1']);
  const st = I.itemStatus(tl, { p0: { correct: true }, p1: { correct: false }, p3: { correct: true } }, new Set([2, 3]));
  assert.deepStrictEqual(st, { 0: 'corect', 1: 'gresit', 3: 'corect', 2: 'vazut' });
});

function pickTimeline() {
  const seg = (id, t) => ({ id, t, dur: 1.5, say: `fraza ${id}`, caption: `fraza ${id}`, board: [], audio: null, lip: null });
  return {
    duration: 12, noVoice: true,
    scenes: [
      { type: 'intro', t0: 0, dur: 2, segs: [seg('in', 0)] },
      { type: 'item', item: 0, ref: 'I.5', t0: 2, dur: 2, segs: [seg('a', 0)], statement: 'A' },
      { type: 'explicatie', item: 0, ref: 'I.5', t0: 4, dur: 2, segs: [seg('a2', 0)] },
      { type: 'item', item: 1, ref: 'III.1.c', t0: 6, dur: 2, segs: [seg('b', 0)], statement: 'B' },
      { type: 'final', t0: 8, dur: 2, segs: [seg('fi', 0)] },
    ],
  };
}

test('player 1-la-1, „📋 aleg eu": la sfârșitul fiecărui exercițiu profesorul se oprește și întreabă ce urmează', async () => {
  const { PrivatePlayer } = await player();
  const realNow = Date.now;
  let now = 9_000_000;
  Date.now = () => now;
  try {
    const engine = fakeEngine();
    let last = null;
    const p = new PrivatePlayer({ engine, onState: (s) => { last = s; } });
    p.setTimeline(pickTimeline());
    p.setPickMode(true);
    p.start(); clearInterval(p.timer); p.timer = null;
    p.gotoItem(0);                                   // elevul a ales S. I ex. 5
    const run = (sec) => { for (let k = 0; k < sec * 4; k++) { now += 250; p.tick(); } };
    run(2.5);
    assert.strictEqual(p.status, 'ruleaza', 'în mijlocul exercițiului (enunț → explicație) merge singur');
    assert.strictEqual(p.scene.type, 'explicatie');
    run(2.5);
    assert.strictEqual(p.status, 'alege', 'exercițiul s-a terminat → întrebăm ce urmează');
    assert.strictEqual(last.nextHead.ref, 'III.1.c', '„Mai departe: S. III ex. 1 c)"');
    assert.strictEqual(last.caption, null);
    assert.strictEqual(last.pickMode, true);
    run(60);
    assert.strictEqual(p.status, 'alege', 'nu trece singur la următorul, oricât ar aștepta');
    // „Mai departe" → exercițiul următor din lecție
    p.continueNext();
    assert.strictEqual(p.scene.ref, 'III.1.c');
    run(2.5);
    assert.strictEqual(p.status, 'alege');
    assert.strictEqual(last.nextHead, null, 'după ultimul exercițiu nu mai urmează altul');
    // „Alt exercițiu" → înapoi la S. I ex. 5 (oricare, nu neapărat la rând)
    p.gotoItem(0);
    assert.strictEqual(p.status, 'ruleaza');
    assert.strictEqual(p.scene.ref, 'I.5');
    assert.strictEqual(p.pendingNext, null);
    // fără „aleg eu": lecția curge singură, ca înainte
    p.setPickMode(false);
    run(4.5);
    assert.strictEqual(p.scene.ref, 'III.1.c');
    assert.notStrictEqual(p.status, 'alege');
    run(6);
    assert.strictEqual(p.status, 'final');
  } finally { Date.now = realNow; }
});

test('player 1-la-1, „📋 aleg eu": „Mai departe" după ultimul exercițiu încheie lecția (fraza de final)', async () => {
  const { PrivatePlayer } = await player();
  const realNow = Date.now;
  let now = 12_000_000;
  Date.now = () => now;
  try {
    const p = new PrivatePlayer({ engine: fakeEngine(), onState: () => {} });
    p.setTimeline(pickTimeline());
    p.setPickMode(true);
    p.start(); clearInterval(p.timer); p.timer = null;
    p.gotoItem(1);
    for (let k = 0; k < 12; k++) { now += 250; p.tick(); }
    assert.strictEqual(p.status, 'alege');
    p.continueNext();
    assert.strictEqual(p.scene.type, 'final', 'încheierea profesorului');
    for (let k = 0; k < 12; k++) { now += 250; p.tick(); }
    assert.strictEqual(p.status, 'final');
    p.continueNext();                                // fără efect după final
    assert.strictEqual(p.status, 'final');
  } finally { Date.now = realNow; }
});
