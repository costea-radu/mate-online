// Teste pentru cererea din 24 oct. 2026: „Sunetul vocii trece pe cea a browserului. Până acum
// cine făcea vocea, OpenAI?" — vocea generată (OpenAI gpt-4o-mini-tts; Azure, dacă are cheie)
// nu mai cade pe vocea browserului la prima problemă:
//   · reîncercări la erorile trecătoare (limita pe minut, serverul ocupat) — tts.synthesizePcm;
//   · alt model OpenAI (tts-1), apoi celălalt furnizor; cota sau cheia greșită → direct celălalt
//     furnizor (alt model al aceluiași cont n-ar ajuta);
//   · vocea deja generată rămâne în lecție chiar dacă restul nu se poate face acum
//     (computeTimeline), iar pregătirea se oprește după 8 eșecuri la rând;
//   · Admin arată motivul real („OpenAI TTS 429: … quota") și lanțul vocilor.
process.env.LIVE_TTS_PAUZA_MS = '0';
const test = require('node:test');
const assert = require('node:assert');
const { createFakeSupabase } = require('./tools/fakeSupabase');
const L = require('../api/_lib/live');
const LL = require('../api/_lib/liveLesson');
const tts = require('../api/_lib/tts');
const handler = require('../api/live');

const KEYS = ['OPENAI_API_KEY', 'LIVE_TTS_API_KEY', 'AZURE_SPEECH_KEY', 'AZURE_SPEECH_REGION', 'LIVE_TTS', 'LIVE_TTS_MODEL', 'LIVE_TTS_MODEL_REZERVA'];
function env(vars) {
  const before = Object.fromEntries(KEYS.map((k) => [k, process.env[k]]));
  for (const k of KEYS) delete process.env[k];
  Object.assign(process.env, vars);
  return () => { for (const k of KEYS) { if (before[k] === undefined) delete process.env[k]; else process.env[k] = before[k]; } };
}
// fetch înlocuit: plan(cine, a câta cerere a lui) → { status, text, retryAfter }
function fakeFetch(plan) {
  const calls = [];
  const real = globalThis.fetch;
  globalThis.fetch = async (url, init) => {
    const who = /openai/.test(String(url)) ? `openai:${JSON.parse(init.body).model}` : 'azure';
    calls.push({ who, body: init.body });
    const r = plan(who, calls.filter((c) => c.who === who).length);
    return {
      ok: r.status === 200, status: r.status,
      headers: { get: (h) => (String(h).toLowerCase() === 'retry-after' && r.retryAfter != null ? String(r.retryAfter) : null) },
      text: async () => r.text || '', arrayBuffer: async () => new ArrayBuffer(4800),
    };
  };
  return { calls, who: () => calls.map((c) => c.who), restore: () => { globalThis.fetch = real; } };
}
const teacher = L.teacherById('radu');
const QUOTA = '{"error":{"message":"You exceeded your current quota, please check your plan and billing details.","type":"insufficient_quota","code":"insufficient_quota"}}';

// ─── 1. Lanțul vocilor ───────────────────────────────────────────────────────
test('cine face vocea: OpenAI gpt-4o-mini-tts (cu cheia OpenAI); rezervele: tts-1, apoi Azure (dacă are cheie)', () => {
  let restore = env({ OPENAI_API_KEY: 'sk-test' });
  try {
    assert.strictEqual(tts.provider(), 'openai');
    assert.strictEqual(tts.chainLabel(), 'OpenAI gpt-4o-mini-tts → OpenAI tts-1');
    process.env.LIVE_TTS_MODEL_REZERVA = 'fara';
    assert.strictEqual(tts.chainLabel(), 'OpenAI gpt-4o-mini-tts', 'rezerva OpenAI se poate opri');
  } finally { restore(); }
  restore = env({ OPENAI_API_KEY: 'sk-test', AZURE_SPEECH_KEY: 'az', AZURE_SPEECH_REGION: 'westeurope' });
  try {
    assert.strictEqual(tts.provider(), 'azure', 'cu cheile Azure, Azure („Emil") are întâietate');
    assert.strictEqual(tts.chainLabel(), 'Azure → OpenAI gpt-4o-mini-tts → OpenAI tts-1');
  } finally { restore(); }
  restore = env({});
  try { assert.strictEqual(tts.chainLabel(), null); } finally { restore(); }
});

test('OpenAI: limita pe minut (429) → reîncercare; modelul indisponibil → tts-1 (aceeași voce, fără „instructions")', async () => {
  const restore = env({ OPENAI_API_KEY: 'sk-test' });
  let f = fakeFetch((who, n) => (n === 1 ? { status: 429, text: '{"error":{"message":"Rate limit reached for requests"}}' } : { status: 200 }));
  try {
    const s = await tts.synthesizePcm('Bună ziua, începem.', teacher);
    assert.deepStrictEqual([s.provider, s.model], ['openai', 'gpt-4o-mini-tts']);
    assert.deepStrictEqual(f.who(), ['openai:gpt-4o-mini-tts', 'openai:gpt-4o-mini-tts'], 'a doua încercare a mers');
  } finally { f.restore(); }
  f = fakeFetch((who) => (who === 'openai:gpt-4o-mini-tts' ? { status: 404, text: '{"error":{"message":"The model `gpt-4o-mini-tts` does not exist or you do not have access to it."}}' } : { status: 200 }));
  try {
    const s = await tts.synthesizePcm('Bună ziua, începem.', teacher);
    assert.deepStrictEqual([s.provider, s.model], ['openai', 'tts-1']);
    assert.deepStrictEqual(f.who(), ['openai:gpt-4o-mini-tts', 'openai:tts-1'], '404 nu se reîncearcă: trece la tts-1');
    const [first, second] = f.calls.map((c) => JSON.parse(c.body));
    assert.ok(first.instructions && !second.instructions, 'tts-1 nu primește indicații de ton');
    assert.strictEqual(second.voice, 'ash');
  } finally { f.restore(); restore(); }
});

test('cota OpenAI epuizată sau cheia greșită: fără alt model OpenAI, direct Azure (dacă are cheie); fără Azure → eroarea, cu motivul', async () => {
  let restore = env({ OPENAI_API_KEY: 'sk-test', AZURE_SPEECH_KEY: 'az', AZURE_SPEECH_REGION: 'westeurope', LIVE_TTS: 'openai' });
  let f = fakeFetch((who) => (who === 'azure' ? { status: 200 } : { status: 429, text: QUOTA }));
  try {
    const s = await tts.synthesizePcm('Trecem la exercițiul următor.', teacher);
    assert.strictEqual(s.provider, 'azure');
    assert.deepStrictEqual(f.who(), ['openai:gpt-4o-mini-tts', 'azure'], 'cota nu se reîncearcă și nu încearcă tts-1');
  } finally { f.restore(); restore(); }
  restore = env({ OPENAI_API_KEY: 'sk-test' });
  f = fakeFetch(() => ({ status: 429, text: QUOTA }));
  try {
    await assert.rejects(tts.synthesizePcm('Trecem la exercițiul următor.', teacher), /OpenAI TTS 429: .*quota/);
    assert.deepStrictEqual(f.who(), ['openai:gpt-4o-mini-tts']);
  } finally { f.restore(); }
  f = fakeFetch(() => ({ status: 401, text: '{"error":{"message":"Incorrect API key provided"}}' }));
  try {
    await assert.rejects(tts.synthesizePcm('Trecem la exercițiul următor.', teacher), /OpenAI TTS 401/);
    assert.deepStrictEqual(f.who(), ['openai:gpt-4o-mini-tts'], 'cheia greșită: nici tts-1');
  } finally { f.restore(); restore(); }
});

test('Azure picat (serverul, de 3 ori) → OpenAI, ca înainte', async () => {
  const restore = env({ OPENAI_API_KEY: 'sk-test', AZURE_SPEECH_KEY: 'az', AZURE_SPEECH_REGION: 'westeurope' });
  const f = fakeFetch((who) => (who === 'azure' ? { status: 503, text: 'Service Unavailable' } : { status: 200 }));
  try {
    const s = await tts.synthesizePcm('Ne revedem după pauză.', teacher);
    assert.deepStrictEqual([s.provider, s.model], ['openai', 'gpt-4o-mini-tts']);
    assert.deepStrictEqual(f.who(), ['azure', 'azure', 'azure', 'openai:gpt-4o-mini-tts']);
  } finally { f.restore(); restore(); }
});

// ─── 2. Lecția: vocea deja generată rămâne, motivul ajunge în Admin ──────────
function lessonRow() {
  const seg = (say, board = []) => ({ say, board });
  const raw = (n) => ({
    ref: `I.${n}`, title: `Subiectul I, exercițiul ${n}`, kind: 'grila', statement: `Rezultatul calculului $${n} + 3 \\cdot 4$ este:`,
    options: ['1', String(n + 12), '3', '4'], answer: 'b', points: 5, barem: 'b 5p',
    intro: [seg(`Exercițiul ${n}.`)], tryPoll: { type: 'grila', question: 'Rezultatul?', options: ['1', String(n + 12), '3', '4'], answer: 'b', explain: '' },
    afterTry: [seg('Să vedem răspunsul corect.')],
    modes: { barem: [seg(`Întâi înmulțirea, apoi adunarea: ${n + 12}.`, [`$${n} + 12 = ${n + 12}$`])], intuitiv: [seg('Înmulțirea leagă mai tare.')], greseli: [seg('Nu adunați întâi.')], alta_metoda: null },
    check: null, afterCheck: [],
  });
  const items = LL.normalizeItems([1, 2, 3, 4, 5, 6].map(raw), { section: 'I', exam: 'en', grile: { I: { 1: 'b', 2: 'b', 3: 'b', 4: 'b', 5: 'b', 6: 'b' } }, baremText: '' });
  const script = LL.assignIds({ title: 'EN test', exam: 'en', teacher: 'radu', teacherName: teacher.name, pasi: LL.PASI_V, ...LL.templates(teacher, { title: 'EN test', exam: 'en' }), items });
  const segs = LL.segmentsInOrder(script);
  // jumătate din fraze au deja vocea generată (o pregătire anterioară)
  const audio = Object.fromEntries(segs.slice(0, 10).map((s) => [s.id, { url: `https://x/${s.id}.mp3`, dur: 2.5, lip: null }]));
  return { id: 'dddddddd-0000-4000-8000-0000000000a5', subject_id: 'aaaaaaaa-0000-4000-8000-0000000000a5', teacher: 'radu', version: 1, status: 'audio', title: 'EN test', exam: 'en', script,
    progress: { audio, total: segs.length, done: 10, phase: 'voce' }, cost_micro: 0, created_at: new Date().toISOString(), updated_at: new Date().toISOString(), segs };
}

test('pregătirea vocii: OpenAI fără credit → lecția pornește, cu vocea generată acolo unde există; motivul real în Admin; fără sute de cereri degeaba', async () => {
  const row = lessonRow();
  const { segs } = row; delete row.segs;
  const fake = createFakeSupabase({ live_lessons: [row] });
  const orig = { provider: tts.provider, voiceSegment: tts.voiceSegment };
  let n = 0;
  tts.provider = () => 'openai';
  tts.voiceSegment = async () => { n++; throw Object.assign(new Error('OpenAI TTS 429: You exceeded your current quota, please check your plan and billing details.'), { status: 429, quota: true }); };
  try {
    await handler._internals.prepareLesson(fake, row.id, { figures: false, budgetMs: 20000, log: () => {} });
    const saved = fake.db.tables.live_lessons[0];
    assert.strictEqual(saved.status, 'gata');
    assert.strictEqual(saved.progress.noVoice, true);
    assert.match(saved.error, /^vocea generată a eșuat de \d+ ori \(OpenAI TTS 429: You exceeded your current quota/);
    assert.match(saved.error, new RegExp(`10 din ${segs.length} fraze au vocea generată, restul le rostește vocea browserului`));
    assert.ok(n <= 8 + 6 && n < segs.length - 10, `${n} cereri pentru ${segs.length - 10} fraze fără voce`);
    assert.strictEqual(Object.keys(saved.progress.audio).length, 10, 'vocea deja generată rămâne');
    // în sală: frazele cu voce generată își păstrează fișierul, doar celelalte merg cu vocea browserului
    const tl = handler._internals.computeTimeline({ kind: 'privat', state: {} }, saved);
    assert.strictEqual(tl.noVoice, true, 'playerul nu așteaptă vocea care lipsește');
    const played = tl.scenes.flatMap((s) => s.segs || []);
    const voiced = new Set(Object.keys(saved.progress.audio));
    assert.ok(played.some((g) => voiced.has(g.id)));
    assert.ok(played.every((g) => (voiced.has(g.id) ? g.audio === `https://x/${g.id}.mp3` : g.audio === null)));
  } finally { Object.assign(tts, orig); }
});
