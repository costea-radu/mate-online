// Teste pentru LECȚIA LIVE pe barem (api/_lib/liveLesson.js) și VOCE (api/_lib/tts.js):
// împărțirea pe Subiectul I/II/III, verificarea DETERMINISTĂ a literelor la grilele
// de EN (baremul are ultimul cuvânt, nu AI-ul), itemii fără explicație pe barem
// eliminați, id-urile stabile ale segmentelor, adaptarea la alt profesor și textul
// rostit (fără LaTeX), plus conversia vocii în MP3/WAV.
const test = require('node:test');
const assert = require('node:assert');
const LL = require('../api/_lib/liveLesson');
const tts = require('../api/_lib/tts');
const live = require('../api/_lib/live');

const SUBJECT = `
Evaluarea Națională pentru absolvenții clasei a VIII-a
Anul școlar 2023 – 2024
Matematică
Varianta 7
SUBIECTUL I (30 de puncte)
5p 1. Rezultatul calculului 2 + 3 · 4 este egal cu:
a) 20 b) 14 c) 24 d) 9
5p 2. Dacă a/3 = 4, atunci a este:
a) 7 b) 1 c) 12 d) 4/3
SUBIECTUL al II-lea (30 de puncte)
5p 1. În figura alăturată ABCD este un pătrat cu latura de 4 cm. Aria pătratului este:
a) 8 cm² b) 16 cm² c) 12 cm² d) 20 cm²
SUBIECTUL al III-lea (30 de puncte)
5p 1. Se consideră expresia E(x) = (x+1)² − x(x+2), unde x este număr real.
(2p) a) Arătați că E(0) = 1.
(3p) b) Arătați că E(x) = 1 pentru orice x real.
`;
const BAREM = `
BAREM DE EVALUARE ȘI DE NOTARE
Varianta 7
SUBIECTUL I (30 de puncte)
Nr. item 1. 2. 3. 4. 5. 6.
Rezultate b. c. a. d. c. b.
Punctaj 5p 5p 5p 5p 5p 5p
SUBIECTUL al II-lea (30 de puncte)
Nr. item 1. 2. 3. 4. 5. 6.
Rezultate b. a. c. d. a. b.
Punctaj 5p 5p 5p 5p 5p 5p
SUBIECTUL al III-lea (30 de puncte)
1. a) E(0) = (0+1)² − 0 = 1 2p
b) (x+1)² = x² + 2x + 1 2p ; E(x) = x² + 2x + 1 − x² − 2x = 1 1p
`;

const seg = (say, board = []) => ({ say, board });
function rawItem(ref, extra = {}) {
  return {
    ref, title: `Item ${ref}`, kind: 'grila', statement: 'Rezultatul calculului $2+3\\cdot 4$ este:',
    options: ['20', '14', '24', '9'], answer: 'a', points: 5, barem: 'b. 5p',
    intro: [seg('Trecem la primul exercițiu.')],
    tryPoll: { type: 'grila', question: 'Rezultatul calculului?', options: ['a) 20', 'b) 14', 'c) 24', 'd) 9'], answer: 'a', explain: 'Înmulțirea se face întâi.' },
    afterTry: [], modes: { barem: [seg('Întâi înmulțirea: trei ori patru egal doisprezece.', ['$3\\cdot 4 = 12$'])], intuitiv: [seg('Gândiți-vă la ordinea operațiilor.')], greseli: [], alta_metoda: null },
    check: null, afterCheck: [],
    ...extra,
  };
}

test('secțiunile: subiectul și baremul se taie pe SUBIECTUL I / II / III', () => {
  const s = LL.sectionMap(SUBJECT);
  const b = LL.sectionMap(BAREM);
  assert.deepStrictEqual(Object.keys(s).sort(), ['I', 'II', 'III']);
  assert.ok(s.III.includes('E(x)'));
  assert.ok(b.I.includes('Rezultate'));
  const plan = LL.callPlan('en', { subject: s, barem: b });
  assert.strictEqual(plan.length, 6, '3 secțiuni × 2 apeluri a câte 3 itemi');
  assert.deepStrictEqual(plan[0], { section: 'I', from: 1, to: 3 });
  // o secțiune fără barem NU se explică
  const plan2 = LL.callPlan('en', { subject: s, barem: { I: b.I } });
  assert.ok(plan2.every((p) => p.section === 'I'));
});

test('grilele EN: litera din BAREM corectează răspunsul greșit al AI-ului', () => {
  const logs = [];
  const B = require('../api/_lib/barem');
  const grile = B.grilaAnswers(BAREM);
  assert.strictEqual(grile.I[1], 'b');
  const items = LL.normalizeItems([rawItem('I.1')], { section: 'I', exam: 'en', grile, baremText: BAREM, log: (m) => logs.push(m) });
  assert.strictEqual(items.length, 1);
  assert.strictEqual(items[0].tryPoll.answer, 'b', 'baremul spune b');
  assert.strictEqual(items[0].answer, 'b');
  assert.ok(logs.some((l) => /corectat/.test(l)));
  // prefixele „a) " din variante se curăță
  assert.deepStrictEqual(items[0].tryPoll.options, ['20', '14', '24', '9']);
  // un singur sondaj: tryPoll, fără check
  assert.strictEqual(items[0].check, null);
  // trecerea spre răspuns există chiar dacă AI-ul a omis-o
  assert.strictEqual(items[0].afterTry.length, 1);
});

test('itemii fără explicație pe barem, din altă secțiune sau dublați sunt eliminați', () => {
  const items = LL.normalizeItems([
    rawItem('I.1'),
    rawItem('I.1'),                                          // dublură
    rawItem('II.3'),                                         // altă secțiune
    rawItem('I.2', { modes: { barem: [], intuitiv: [], greseli: [], alta_metoda: null } }), // fără barem
    rawItem('ceva'),                                         // ref invalid
  ], { section: 'I', exam: 'en', grile: { I: { 1: 'b' } }, baremText: BAREM });
  assert.deepStrictEqual(items.map((i) => i.ref), ['I.1']);
});

test('BAC: itemii pe litere (II.1.a) și verificarea automată cu rezultatul final', () => {
  const it = rawItem('II.1.a', {
    kind: 'rezolvare', options: null, answer: '$f(1)=3$', tryPoll: null,
    modes: { barem: [seg('Calculăm f de unu.')], intuitiv: [], greseli: [], alta_metoda: null },
  });
  const [n] = LL.normalizeItems([it], { section: 'II', exam: 'bac', grile: {}, baremText: '' });
  assert.strictEqual(n.ref, 'II.1.a');
  assert.ok(n.check, 'item cu rezolvare → verificare');
  assert.strictEqual(n.check.type, 'completare');
  assert.strictEqual(n.check.answer, 'f(1)=3');
  assert.deepStrictEqual(LL.parseRef('III.2.c'), { subject: 'III', ex: 2, letter: 'c' });
  assert.deepStrictEqual(LL.parseRef('I.4'), { subject: 'I', ex: 4, letter: null });
  assert.strictEqual(LL.parseRef('x'), null);
});

test('grila fără literă confirmată de barem → fără sondaj (nu riscăm o cheie greșită)', () => {
  const [n] = LL.normalizeItems([rawItem('II.2')], { section: 'II', exam: 'en', grile: {}, baremText: 'SUBIECTUL al II-lea\n2. rezolvare lungă fără literă 5p' });
  assert.strictEqual(n.tryPoll, null);
});

test('scriptul: segmentele fixe, id-uri stabile, ordinea vocii, adaptarea la alt profesor', () => {
  const radu = live.teacherById('radu');
  // un eventual al doilea profesor (mecanismul rămâne general; implicit e unul singur)
  const ana = { id: 'ana', name: 'Prof. Ana', gender: 'f', color: '#b0417a', bio: '', voice: { openai: 'coral', azure: 'ro-RO-AlinaNeural' }, style: 'Vorbești energic.' };
  const items = LL.normalizeItems([rawItem('I.1')], { section: 'I', exam: 'en', grile: { I: { 1: 'b' } }, baremText: BAREM });
  const script = LL.assignIds({ title: 'EN 2024 Varianta 7', exam: 'en', teacher: 'radu', teacherName: radu.name, ...LL.templates(radu, { title: 'EN 2024 Varianta 7', exam: 'en' }), items });
  assert.ok(script.intro[0].say.includes('Prof. Tudor'));
  assert.ok(script.intro[0].say.includes('profesorul vostru virtual'));
  const ids = LL.segmentsInOrder(script).map((s) => s.id);
  assert.strictEqual(new Set(ids).size, ids.length, 'id-uri unice');
  assert.ok(ids[0].startsWith('in0-'), 'vocea începe cu introducerea');
  // același text → același id (vocea se refolosește la regenerare)
  const again = LL.assignIds(JSON.parse(JSON.stringify(script)));
  assert.deepStrictEqual(LL.segmentsInOrder(again).map((s) => s.id), ids);
  assert.ok(script.items[0].tryPoll.id);
  // profesoara Ana: segmentele fixe la feminin, explicațiile rămân
  const s2 = LL.adaptScript(script, ana);
  assert.ok(s2.intro[0].say.includes('profesoara voastră virtuală'));
  assert.strictEqual(s2.teacher, 'ana');
  assert.strictEqual(s2.items[0].modes.barem[0].say, script.items[0].modes.barem[0].say);
  // doar introducerea s-a schimbat → celelalte id-uri rămân
  assert.strictEqual(s2.items[0].modes.barem[0].id, script.items[0].modes.barem[0].id);
  assert.notStrictEqual(s2.intro[0].id, script.intro[0].id);
});

test('lecția poate porni când au voce introducerea și primii doi itemi', () => {
  const radu = live.teacherById('radu');
  const items = LL.normalizeItems([rawItem('I.1'), rawItem('I.2'), rawItem('I.3')], { section: 'I', exam: 'en', grile: { I: { 1: 'b', 2: 'c', 3: 'a' } }, baremText: BAREM });
  const script = LL.assignIds({ title: 't', exam: 'en', ...LL.templates(radu, { title: 't', exam: 'en' }), items });
  const audio = {};
  assert.strictEqual(LL.playableHead(script, audio), false);
  for (const s of script.intro) audio[s.id] = { dur: 1 };
  for (const it of script.items.slice(0, 2)) for (const s of [...it.intro, ...it.afterTry, ...it.modes.barem]) audio[s.id] = { dur: 1 };
  assert.strictEqual(LL.playableHead(script, audio), true);
});

test('textul rostit: fără LaTeX și fără simboluri', () => {
  assert.strictEqual(tts.speakable('$\\frac{3}{4}$ din $x^2$'), '3 supra 4 din x la pătrat');
  assert.strictEqual(tts.speakable('$\\sqrt{16} = 4$'), 'radical din 16 egal 4');
  assert.strictEqual(tts.speakable('$2\\cdot 3$'), '2 ori 3');
  assert.strictEqual(tts.speakable('**Atenție** la semn!'), 'Atenție la semn!');
  assert.ok(!/[\\$^{}]/.test(tts.speakable('$\\Delta = b^2 - 4ac$')));
});

test('vocea: PCM → WAV valid; PCM → MP3 (când ffmpeg există)', async () => {
  const pcm = Buffer.alloc(24000 * 2); // o secundă de liniște
  const wav = tts.pcmToWav(pcm);
  assert.strictEqual(wav.slice(0, 4).toString(), 'RIFF');
  assert.strictEqual(wav.readUInt32LE(24), 24000);
  assert.strictEqual(wav.length, 44 + pcm.length);
  if (tts.ffmpegPath()) {
    const mp3 = await tts.pcmToMp3(pcm);
    assert.ok(mp3 && mp3.length > 1000, 'MP3 generat');
    assert.ok(mp3.length < pcm.length / 4, 'mult mai mic decât PCM');
  }
  // cost: 1 minut OpenAI ≈ 0,015 $ · 4,6 = ~0,069 lei = 69.000 micro-lei
  assert.strictEqual(tts.costMicroLei({ provider: 'openai', dur: 60 }), 69000);
});

test('redenumirea profesorului: lecțiile deja scrise rostesc numele nou, id-urile rămân', () => {
  const tudor = live.teacherById('radu');
  assert.strictEqual(tudor.name, 'Prof. Tudor');
  const vechi = { ...tudor, name: 'Prof. Radu' };
  const items = LL.normalizeItems([rawItem('I.1')], { section: 'I', exam: 'en', grile: { I: { 1: 'b' } }, baremText: BAREM });
  const script = LL.assignIds({ title: 'EN 2024 Varianta 7', exam: 'en', teacher: 'radu', teacherName: vechi.name, ...LL.templates(vechi, { title: 'EN 2024 Varianta 7', exam: 'en' }), items });
  assert.ok(script.intro[0].say.includes('Prof. Radu'));
  const r = LL.renameTeacher(script, tudor);
  assert.ok(r.intro[0].say.includes('Prof. Tudor') && !r.intro[0].say.includes('Radu'));
  assert.strictEqual(r.teacherName, 'Prof. Tudor');
  assert.deepStrictEqual(LL.segmentsInOrder(r).map((s) => s.id), LL.segmentsInOrder(script).map((s) => s.id), 'id-urile nu se schimbă');
  assert.ok(script.intro[0].say.includes('Prof. Radu'), 'originalul rămâne neatins');
  assert.strictEqual(LL.renameTeacher(r, tudor), r, 'același nume → nimic de făcut');
});

test('rezolvările complete pe tablă: până la 4 rânduri pe segment, regula pentru „Arătați că…"', () => {
  const it = rawItem('II.4');
  it.kind = 'rezolvare';
  it.modes.barem = [{ say: 'Pornim de la definiție.', board: ['$E(x) = (x+1)^2 - (x-1)^2$', '$= x^2 + 2x + 1 - (x^2 - 2x + 1)$', '$= 4x$', '$\\Rightarrow E(x) = 4x$ (ceea ce trebuia demonstrat)', 'un al cincilea rând'] }];
  const [item] = LL.normalizeItems([it], { section: 'II', exam: 'en', baremText: BAREM });
  assert.strictEqual(item.modes.barem[0].board.length, 4, 'patru pași pe tablă într-un segment');
  const sp = LL.systemPrompt(live.teacherById('radu'), 'bac', 'tehnologic');
  assert.match(sp, /Arătați că/);
  assert.match(sp, /TOATĂ rezolvarea/);
  assert.match(sp, /BAC Tehnologic \(programa M_tehnologic\)/);
});

test('„Arătați că…": elevii încearcă pe „Calculați…" (fără rezultat); dacă reformularea scapă rezultatul → fără sondaj', () => {
  const mk = (over) => ({ ...rawItem('II.4'), kind: 'rezolvare', statement: 'Se consideră $E(x) = (x+1)^2 - (x-1)^2$. Arătați că $E(x) = 4x$, pentru orice număr real $x$.', ...over });
  // 1) reformulare curată → sondaj de completare pe „Calculați E(x)", enunțul original rămâne
  const good = mk({ statementTry: 'Se consideră $E(x) = (x+1)^2 - (x-1)^2$. Calculați $E(x)$, pentru orice număr real $x$.', tryPoll: { type: 'completare', question: 'Calculați $E(x)$.', options: null, answer: '4x', explain: 'Diferență de pătrate.' } });
  const [a] = LL.normalizeItems([good], { section: 'II', exam: 'en', baremText: BAREM });
  assert.ok(a.statementTry && !/Arătați/.test(a.statementTry));
  assert.strictEqual(a.tryPoll.type, 'completare');
  assert.strictEqual(a.tryPoll.answer, '4x');
  assert.match(a.statement, /Arătați că/);
  // cronologia: scena enunțului poartă cerința reformulată
  const tl = live.buildTimeline(LL.assignIds({ title: 'T', exam: 'en', teacher: 'radu', teacherName: 'Prof. Tudor', intro: [], qna: [], breakSay: [], outro: [], items: [a] }), {}, { mode: 'privat' });
  const head = tl.scenes.find((x) => x.type === 'item');
  assert.ok(head.statementTry && head.statement !== head.statementTry);
  // 2) reformularea „scapă" rezultatul → fără reformulare și fără sondaj
  const leak = mk({ statementTry: 'Calculați $E(x) = 4x$.', tryPoll: { type: 'completare', question: 'Calculați $E(x)$.', options: null, answer: '4x', explain: '' } });
  const [b] = LL.normalizeItems([leak], { section: 'II', exam: 'en', baremText: BAREM });
  assert.strictEqual(b.statementTry, null);
  assert.strictEqual(b.tryPoll, null);
  assert.strictEqual(b.check, null, 'fără „Care e rezultatul final?" — rezultatul e în enunț');
  // 3) „Arătați că" fără reformulare (demonstrație) → fără sondaj înainte
  const proof = mk({ statement: 'Arătați că triunghiul $ABC$ este dreptunghic.', statementTry: null, tryPoll: { type: 'completare', question: 'Arătați că triunghiul ABC este dreptunghic', options: null, answer: 'da', explain: '' } });
  const [c] = LL.normalizeItems([proof], { section: 'II', exam: 'en', baremText: BAREM });
  assert.strictEqual(c.tryPoll, null);
  // 4) un item obișnuit nu primește statementTry
  const [d] = LL.normalizeItems([{ ...rawItem('I.2'), statementTry: 'ceva' }], { section: 'I', exam: 'en', grile: { I: { 2: 'b' } }, baremText: BAREM });
  assert.strictEqual(d.statementTry, null);
});

test('formulele: paginile PDF ale secțiunii merg la model; enunțurile stricate („[formula nu e lizibilă]") nu se predau', async () => {
  const { PDFDocument, StandardFonts } = require('pdf-lib');
  // un PDF de 3 pagini: I pe p.1, II începe pe p.2, III pe p.3
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  for (const lines of [['SUBIECTUL I (30 de puncte)', '1. Rezultatul calculului'], ['5. ceva', 'SUBIECTUL al II-lea (30 de puncte)', '1. Figura'], ['SUBIECTUL al III-lea (30 de puncte)', '1. Se considera']]) {
    const pg = doc.addPage([400, 400]);
    lines.forEach((l, i) => pg.drawText(l, { x: 20, y: 360 - i * 30, size: 12, font }));
  }
  const buf = Buffer.from(await doc.save());
  const pdfpages = require('../api/_lib/pdfpages');
  const texts = await pdfpages.pageTexts(buf);
  assert.strictEqual(texts.length, 3);
  assert.deepStrictEqual(LL.sectionPages(texts), { I: [0, 1], II: [1, 2], III: [2] });
  // atașamentele pe secțiuni (subiectul; fără barem separat)
  const fakeSupa = { from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: null }) }) }) }) };
  const att = await LL.pdfAttachments({ supa: fakeSupa, content: { id: 'c1', file_url: 'https://x/c1.pdf' }, ctx: { pageTexts: texts }, pdfCtx: { downloadContentPdf: async () => buf } });
  for (const S of ['I', 'II', 'III']) {
    assert.strictEqual(att[S].length, 1, `secțiunea ${S}`);
    assert.strictEqual(att[S][0].type, 'file');
    assert.match(att[S][0].file.file_data, /^data:application\/pdf;base64,/);
  }
  const pagesOf = async (part) => (await PDFDocument.load(Buffer.from(part.file.file_data.split(',')[1], 'base64'))).getPageCount();
  assert.strictEqual(await pagesOf(att.I[0]), 2);
  assert.strictEqual(await pagesOf(att.III[0]), 1);
  // LIVE_PDF_PAGINI=0 → doar textul
  process.env.LIVE_PDF_PAGINI = '0';
  try {
    const none = await LL.pdfAttachments({ supa: fakeSupa, content: { id: 'c1', file_url: 'x' }, ctx: {}, pdfCtx: { downloadContentPdf: async () => buf } });
    assert.deepStrictEqual(none, { I: [], II: [], III: [] });
  } finally { delete process.env.LIVE_PDF_PAGINI; }

  // modelul primește paginile secțiunii în mesaj (text + fișier)
  const ai = require('../api/_lib/ai');
  const orig = ai.chatJson;
  const seen = [];
  ai.chatJson = async ({ messages }) => {
    seen.push(messages[0].content);
    const sec = /SUBIECTUL (I{1,3})\b/.exec(typeof messages[0].content === 'string' ? messages[0].content : messages[0].content[0].text)[1];
    const items = sec === 'I' ? [rawItem('I.1'), rawItem('I.2'), rawItem('I.4'), { ...rawItem('I.3'), statement: 'Rezultatul calculului „2 2 6 2 3 2” este egal cu: [formula și variantele de răspuns nu sunt lizibile în textul extras din PDF]' }] : [];
    return { data: { items }, usage: { in: 10, out: 10 } };
  };
  try {
    const r = await LL.generateScript({ ctx: { text: SUBJECT, baremText: BAREM, baremStatus: 'ok' }, content: { id: 'c1', title: 'EN 2024 Varianta 7' }, teacher: live.teacherById('radu'), exam: 'en', profile: null, log: () => {}, attachments: att });
    assert.ok(seen.length >= 3);
    assert.ok(seen.every((c) => Array.isArray(c) && c[0].type === 'text' && c[1].type === 'file'), 'text + paginile PDF');
    assert.match(seen[0][0].text, /PAGINILE PDF/);
    const refs = r.script.items.map((it) => it.ref);
    assert.deepStrictEqual(refs, ['I.1', 'I.2', 'I.4'], 'itemul cu formula pierdută (I.3) nu se predă');
    assert.strictEqual(r.script.v, 2, 'lecție scrisă cu paginile PDF');
  } finally { ai.chatJson = orig; }

  // lecțiile scrise înainte: itemul stricat dispare din sală, restul rămâne
  const old = { items: [{ ref: 'I.1', statement: 'Calculați $\\sqrt{2}$.' }, { ref: 'I.2', statement: 'Rezultatul: [formula nu e lizibilă]' }] };
  assert.deepStrictEqual(LL.dropUnreadable(old).items.map((i) => i.ref), ['I.1']);
});
