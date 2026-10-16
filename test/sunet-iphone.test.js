// Teste pentru SUNETUL sălii live pe iPhone (src/lib/live/audio.js → AudioEngine).
//
// Problema raportată (8 oct. 2026): la meditațiile live nu se auzea nimic pe
// iPhone, iar la demo se auzea o voce de femeie. Cauza: lecțiile au vocea generată
// pe server (MP3, redată prin Web Audio), iar iOS tratează Web Audio ca sunet
// „ambiental" — cu telefonul pe Silențios îl taie complet. Demo-ul vorbește cu
// vocea browserului („Ioana"), pe care Silențios n-o oprește.
//
// Ce verificăm (cu un browser simulat — window / document / navigator / AudioContext):
//   · „Participă acum" (unlock) cere sesiunea audio „playback" (iOS 16.4+), fără bucla <audio>;
//   · pe iOS mai vechi (fără navigator.audioSession) pornește bucla <audio> cu liniște,
//     la rata contextului audio; pe desktop / Android nu face nimic din toate astea;
//   · după o întrerupere (contextul „interrupted"/„suspended") sunetul se reia la
//     atingere și la revenirea paginii în față; cât pagina e ascunsă, bucla stă pe pauză;
//   · microfonul (dictarea) trece sesiunea pe „play-and-record" și înapoi;
//   · la ieșirea din sală sesiunea revine la „auto" și ascultătorii dispar.
const test = require('node:test');
const assert = require('node:assert');
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const { pathToFileURL } = require('node:url');

// audio.js importă fără extensie („./clock", ca în Vite) → o copie temporară cu „.mjs"
function importLive(names, main) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'live-sunet-'));
  for (const n of names) {
    const src = fs.readFileSync(path.join(__dirname, '..', 'src', 'lib', 'live', `${n}.js`), 'utf8')
      .replace(/from '\.\/([\w-]+)'/g, "from './$1.mjs'");
    fs.writeFileSync(path.join(dir, `${n}.mjs`), src);
  }
  return import(pathToFileURL(path.join(dir, `${main}.mjs`)).href);
}
let audioP = null;
const audio = () => (audioP || (audioP = importLive(['audio', 'clock', 'lip', 'voceServer'], 'audio')));

const IPHONE = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.5 Mobile/15E148 Safari/604.1';
const WINDOWS = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0 Safari/537.36';

// Un „browser" minimal: ce atinge AudioEngine
function browser({ ua = IPHONE, platform = 'iPhone', touch = 5, audioSession = true } = {}) {
  const bags = { window: {}, document: {} };
  const add = (bag) => (ev, fn) => { (bags[bag][ev] = bags[bag][ev] || new Set()).add(fn); };
  const rem = (bag) => (ev, fn) => { if (bags[bag][ev]) bags[bag][ev].delete(fn); };
  const made = { ctx: [], audio: [] };
  const param = () => ({ value: 0 });
  class FakeCtx {
    constructor() { this.state = 'suspended'; this.sampleRate = 48000; this.currentTime = 0; this.resumes = 0; this.destination = {}; made.ctx.push(this); }
    resume() { this.resumes += 1; if (this.state !== 'closed') this.state = 'running'; return Promise.resolve(); }
    close() { this.state = 'closed'; return Promise.resolve(); }
    createGain() { return { gain: param(), connect() {} }; }
    createBiquadFilter() { return { type: '', frequency: param(), Q: param(), gain: param(), connect() {} }; }
    createDynamicsCompressor() { return { threshold: param(), knee: param(), ratio: param(), attack: param(), release: param(), connect() {} }; }
    createConvolver() { return { buffer: null, connect() {} }; }
    createBuffer(ch, len, rate) { return { duration: len / rate, getChannelData: () => new Float32Array(len) }; }
    createBufferSource() { return { buffer: null, connect() {}, start() {}, stop() {} }; }
  }
  const session = audioSession ? { type: 'auto' } : null;
  globalThis.window = { AudioContext: FakeCtx, addEventListener: add('window'), removeEventListener: rem('window') };
  globalThis.document = {
    hidden: false,
    addEventListener: add('document'), removeEventListener: rem('document'),
    createElement(tag) {
      const el = {
        tag, attrs: {}, paused: true, plays: 0, loop: false, src: '',
        setAttribute(k, v) { this.attrs[k] = v; },
        removeAttribute(k) { delete this.attrs[k]; if (k === 'src') this.src = ''; },
        play() { this.plays += 1; this.paused = false; return Promise.resolve(); },
        pause() { this.paused = true; },
        load() {},
      };
      made.audio.push(el);
      return el;
    },
  };
  Object.defineProperty(globalThis, 'navigator', {
    configurable: true, writable: true,
    value: { userAgent: ua, platform, maxTouchPoints: touch, ...(session ? { audioSession: session } : {}) },
  });
  if (typeof globalThis.btoa !== 'function') globalThis.btoa = (s) => Buffer.from(s, 'binary').toString('base64');
  const fire = (bag, ev) => [...(bags[bag][ev] || [])].forEach((fn) => fn({ type: ev }));
  const count = (bag, ev) => (bags[bag][ev] ? bags[bag][ev].size : 0);
  return { made, session, fire, count };
}

test('iPhone (iOS 16.4+): „Participă acum" cere sesiunea audio „playback" — vocea generată se aude și pe Silențios', async () => {
  const { AudioEngine } = await audio();
  const b = browser();
  const e = new AudioEngine();
  assert.strictEqual(e.unlock(), true);
  assert.strictEqual(b.session.type, 'playback', 'sesiunea paginii trece pe „playback" (ca un video)');
  assert.strictEqual(b.made.ctx.length, 1, 'un singur context audio');
  assert.strictEqual(b.made.ctx[0].state, 'running', 'contextul pornit din gestul elevului');
  assert.strictEqual(b.made.audio.length, 0, 'cu Audio Session API nu mai e nevoie de bucla <audio>');
  assert.strictEqual(e.audioBlocked(), false);
  e.close();
});

test('iPhone vechi (fără navigator.audioSession): bucla <audio> cu liniște, la rata contextului audio', async () => {
  const { AudioEngine } = await audio();
  const b = browser({ audioSession: false });
  const e = new AudioEngine();
  e.unlock();
  assert.strictEqual(b.made.audio.length, 1, 'un <audio> pentru buclă');
  const el = b.made.audio[0];
  assert.strictEqual(el.loop, true);
  assert.ok(el.plays >= 1 && !el.paused, 'pornit din gest');
  assert.strictEqual(el.attrs['x-webkit-airplay'], 'deny', 'nu apare la AirPlay');
  assert.match(el.src, /^data:audio\/wav;base64,/);
  const wav = Buffer.from(el.src.split(',')[1], 'base64');
  assert.strictEqual(wav.toString('ascii', 0, 4), 'RIFF');
  assert.strictEqual(wav.toString('ascii', 8, 12), 'WAVE');
  assert.strictEqual(wav.readUInt32LE(24), 48000, 'aceeași rată ca a contextului (fără schimbarea ratei plăcii de sunet)');
  assert.ok(wav.subarray(44).every((x) => x === 128), 'doar liniște');
  // a doua apăsare nu mai face încă un <audio>
  e.unlock();
  assert.strictEqual(b.made.audio.length, 1);
  e.close();
  assert.ok(el.paused, 'la ieșire bucla se oprește');
});

test('iPad (se prezintă ca Mac, dar are ecran tactil) e tratat ca iOS', async () => {
  const { AudioEngine } = await audio();
  const b = browser({ ua: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15', platform: 'MacIntel', touch: 5, audioSession: false });
  const e = new AudioEngine();
  e.unlock();
  assert.strictEqual(b.made.audio.length, 1, 'bucla pornește și pe iPad fără Audio Session API');
  e.close();
});

test('desktop / Android: nimic din toate astea (fără sesiune, fără buclă), sunetul pornește ca înainte', async () => {
  const { AudioEngine } = await audio();
  const b = browser({ ua: WINDOWS, platform: 'Win32', touch: 0, audioSession: false });
  const e = new AudioEngine();
  assert.strictEqual(e.unlock(), true);
  assert.strictEqual(b.made.audio.length, 0);
  assert.strictEqual(b.made.ctx[0].state, 'running');
  e.close();
});

test('după o întrerupere (apel, ecran blocat): sunetul se reia la atingere și la revenirea paginii', async () => {
  const { AudioEngine } = await audio();
  const b = browser();
  const e = new AudioEngine();
  e.unlock();
  const ctx = b.made.ctx[0];
  // iOS: un apel / Siri / ecranul blocat → „interrupted"
  ctx.state = 'interrupted';
  assert.strictEqual(e.audioBlocked(), true, 'sala arată „🔊 Pornește sunetul"');
  const before = ctx.resumes;
  b.fire('window', 'touchend');
  assert.strictEqual(ctx.resumes, before + 1, 'prima atingere reia contextul');
  assert.strictEqual(e.audioBlocked(), false);
  // pagina ascunsă și readusă în față
  ctx.state = 'suspended';
  b.session.type = 'auto';                       // (un alt tab / altă aplicație a schimbat-o)
  globalThis.document.hidden = false;
  b.fire('document', 'visibilitychange');
  assert.strictEqual(ctx.state, 'running', 'reluat la revenire');
  assert.strictEqual(b.session.type, 'playback', 'sesiunea „playback" e cerută din nou');
  // contextul își schimbă singur starea → încercăm să-l pornim
  ctx.state = 'suspended';
  ctx.onstatechange();
  assert.strictEqual(ctx.state, 'running');
  e.close();
});

test('iPhone vechi: cât pagina e ascunsă, bucla stă pe pauză (fără comenzi de redare pe ecranul blocat)', async () => {
  const { AudioEngine } = await audio();
  const b = browser({ audioSession: false });
  const e = new AudioEngine();
  e.unlock();
  const el = b.made.audio[0];
  globalThis.document.hidden = true;
  b.fire('document', 'visibilitychange');
  assert.ok(el.paused, 'pauză cât e ascunsă');
  globalThis.document.hidden = false;
  b.fire('document', 'visibilitychange');
  assert.ok(!el.paused, 'repornită la revenire');
  e.close();
});

test('microfonul (dictarea): sesiunea „play-and-record" cât ascultă, apoi înapoi la „playback"', async () => {
  const { AudioEngine } = await audio();
  const b = browser();
  const e = new AudioEngine();
  e.setRecording(true);                          // încă n-a intrat: doar ține minte
  assert.strictEqual(b.session.type, 'auto');
  e.unlock();
  assert.strictEqual(b.session.type, 'play-and-record', 'microfonul pornit din ecranul de intrare');
  e.setRecording(false);
  assert.strictEqual(b.session.type, 'playback');
  e.setRecording(true);
  assert.strictEqual(b.session.type, 'play-and-record');
  b.fire('window', 'touchend');
  assert.strictEqual(b.session.type, 'play-and-record', 'o atingere nu strică sesiunea microfonului');
  e.setRecording(false);
  assert.strictEqual(b.session.type, 'playback');
  e.close();
});

test('o atingere nu strică dictarea din chat (sesiunea „play-and-record" pusă de voice.js rămâne)', async () => {
  const { AudioEngine } = await audio();
  const b = browser();
  const e = new AudioEngine();
  e.unlock();
  b.session.type = 'play-and-record';           // 🎤 din chat: startDictation a schimbat-o
  b.made.ctx[0].state = 'interrupted';
  b.fire('window', 'touchend');
  assert.strictEqual(b.session.type, 'play-and-record');
  assert.strictEqual(b.made.ctx[0].state, 'running', 'sunetul se reia oricum');
  e.close();
});

// voice.js citește SpeechRecognition la import → o copie proaspătă, după ce „browserul" e gata
async function freshVoice() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'voice-'));
  // voice.js → ./live/voceServer (vocea de bărbat de pe server), ca în Vite, fără extensie
  fs.mkdirSync(path.join(dir, 'live'));
  fs.copyFileSync(path.join(__dirname, '..', 'src', 'lib', 'live', 'voceServer.js'), path.join(dir, 'live', 'voceServer.mjs'));
  const src = fs.readFileSync(path.join(__dirname, '..', 'src', 'lib', 'voice.js'), 'utf8').replace("from './live/voceServer.js'", "from './live/voceServer.mjs'");
  fs.writeFileSync(path.join(dir, 'voice.mjs'), src);
  return import(pathToFileURL(path.join(dir, 'voice.mjs')).href);
}
function fakeRecognition() {
  const made = [];
  class FakeRec { constructor() { made.push(this); } start() { this.started = true; } stop() { this.onend && this.onend(); } }
  globalThis.window.webkitSpeechRecognition = FakeRec;
  return made;
}

test('dictarea în sală (Safari): „play-and-record" cât ascultă, apoi înapoi la „playback"', async () => {
  const b = browser();
  const recs = fakeRecognition();
  const V = await freshVoice();
  b.session.type = 'playback';                   // ca în sala live, după „Participă acum"
  let ended = false;
  const d = V.startDictation({ onEnd: () => { ended = true; } });
  assert.ok(recs[0].started);
  assert.strictEqual(b.session.type, 'play-and-record');
  d.stop();
  assert.ok(ended);
  assert.strictEqual(b.session.type, 'playback', 'vocea profesorului se aude iar și pe Silențios');
});

test('dictarea în afara sălii (sesiunea „auto"): voice.js n-o atinge', async () => {
  const b = browser();
  fakeRecognition();
  const V = await freshVoice();
  const d = V.startDictation({});
  assert.strictEqual(b.session.type, 'auto');
  d.stop();
  assert.strictEqual(b.session.type, 'auto');
});

test('ieșirea din sală: sesiunea revine la „auto", ascultătorii dispar', async () => {
  const { AudioEngine } = await audio();
  const b = browser();
  const e = new AudioEngine();
  e.unlock();
  assert.ok(b.count('window', 'touchend') === 1 && b.count('document', 'visibilitychange') === 1);
  e.unlock();                                    // a doua deblocare nu dublează ascultătorii
  assert.strictEqual(b.count('window', 'touchend'), 1);
  e.close();
  assert.strictEqual(b.session.type, 'auto', 'restul site-ului (ex. sunetul de mesaj nou) ascultă iar de Silențios');
  assert.strictEqual(b.count('window', 'touchend'), 0);
  assert.strictEqual(b.count('document', 'visibilitychange'), 0);
  assert.strictEqual(e.audioBlocked(), false, 'fără context, nimic blocat');
});

// ─── 15 oct. 2026: „la lecția nouă (EN), pe iPhone nu se aude nimic" ───────────
// Lecția a rămas, cel mai probabil, „cu vocea browserului" (vocea generată a eșuat): pe
// iPhone fiecare frază aștepta vocea de pe server, iar rezerva — „Ioana" — nu pornea. Acum:
// vocea de pe server care lipsește se ocolește, „Ioana" vorbește și fără obiectul vocii, o
// voce care nu pornește aduce butonul „🔊 Pornește sunetul" (atingerea o rostește din gest),
// rezerva <audio> e un singur element deblocat la intrare, WAV-ul se citește direct, iar ce
// nu merge se raportează o dată (Admin → Debug).

// vocea browserului (simulată): speak() → start/end, după `mode`
function fakeSpeech(win, { voices = [], mode = 'ok' } = {}) {
  const said = [];
  let cancels = 0;
  const ss = {
    mode,
    getVoices: () => voices,
    addEventListener() {},
    speak(u) {
      said.push(u);
      const m = ss.mode;
      if (m === 'ok') setTimeout(() => { if (u.onstart) u.onstart({ type: 'start' }); setTimeout(() => { if (u.onend) u.onend({ type: 'end' }); }, 5); }, 1);
      else if (m === 'refuz') setTimeout(() => { if (u.onerror) u.onerror({ type: 'error', error: 'not-allowed' }); }, 1);
      else if (m === 'mut') setTimeout(() => { if (u.onend) u.onend({ type: 'end' }); }, 1);   // se termină fără să pornească
      // 'blocat': nimic (iOS, fără gest)
    },
    cancel() { cancels += 1; },
  };
  win.speechSynthesis = ss;
  win.SpeechSynthesisUtterance = class { constructor(text) { this.text = text; } };
  return { ss, said, spoken: () => said.filter((u) => String(u.text).trim()), cancels: () => cancels };
}
// <audio> simulat (window.Audio): play() pornește sau e refuzat (NotAllowedError)
function fakeAudio(win) {
  const els = [];
  const ctl = { refuse: false };
  win.Audio = class {
    constructor() { this.paused = true; this.plays = 0; this.src = ''; this.attrs = {}; this.currentTime = 0; els.push(this); }
    setAttribute(k, v) { this.attrs[k] = v; }
    removeAttribute(k) { if (k === 'src') this.src = ''; }
    load() {}
    pause() { this.paused = true; }
    play() {
      this.plays += 1;
      if (ctl.refuse) { const e = new Error('The request is not allowed by the user agent'); e.name = 'NotAllowedError'; return Promise.reject(e); }
      this.paused = false;
      setTimeout(() => { if (this.onplaying) this.onplaying(); }, 1);
      return Promise.resolve();
    }
  };
  return { els, ctl };
}
const tick = (ms = 0) => new Promise((r) => setTimeout(r, ms));

test('iPhone: rezerva <audio> e UN element, deblocat la „Participă acum"; refuzată → „🔊 Pornește sunetul" o pornește din gest', async () => {
  const { AudioEngine } = await audio();
  const b = browser();
  const A = fakeAudio(globalThis.window);
  const realFetch = globalThis.fetch;
  globalThis.fetch = async () => { throw new TypeError('Load failed'); };   // fișierul nu vine prin fetch
  try {
    const e = new AudioEngine();
    const problems = [];
    e.onProblem = (kind, d) => problems.push({ kind, d });
    e.unlock();
    assert.strictEqual(A.els.length, 1, 'un <audio> de rezervă, creat din gest');
    assert.strictEqual(A.els[0].plays, 1, 'pornit (cu liniște) chiar în gest — iOS îl lasă apoi să pornească singur');
    assert.strictEqual(b.made.audio.length, 0, 'fără bucla cu liniște (iOS 16.4+)');
    await tick(5);
    A.ctl.refuse = true;                        // ex. deblocarea n-a apucat să se facă
    await e.play('s1', { url: 'https://x.supabase.co/storage/v1/object/public/live-media/lessons/L1/s1.mp3', atServerMs: Date.now(), dur: 4 });
    await tick(10);
    assert.strictEqual(A.els.length, 1, 'același element — un <audio> nou, pornit fără gest, e blocat pe iPhone');
    assert.ok(A.els[0].src.endsWith('/lessons/L1/s1.mp3'));
    assert.strictEqual(e.blockReason(), 'rezerva');
    assert.strictEqual(e.audioBlocked(), true, 'sala arată „🔊 Pornește sunetul"');
    assert.deepStrictEqual(problems.map((p) => p.kind), ['rezerva-blocata']);
    const d = problems[0].d;
    assert.strictEqual(d.ios, true);
    assert.strictEqual(d.rezerva.blocate, 1);
    assert.match(d.fisiere.ultima, /Load failed · L1\/s1\.mp3/, 'ce fișier, fără domeniu');
    assert.match(d.ctx, /^running 48000 Hz$/);
    // atingerea butonului (gest): fraza pornește de unde a ajuns
    A.ctl.refuse = false;
    e.unlock();
    await tick(5);
    assert.strictEqual(e.audioBlocked(), false);
    assert.strictEqual(A.els[0].paused, false, 'se aude');
    assert.strictEqual(e.stats.rezerva.porniri, 1);
    e.stop('s1');
    assert.strictEqual(A.els[0].paused, true);
    e.close();
  } finally { globalThis.fetch = realFetch; }
});

test('WAV-ul vocii (urcat fără ffmpeg) se citește direct, fără decodeAudioData', async () => {
  const { wavToBuffer } = await audio();
  const tts = require('../api/_lib/tts');
  const pcm = Buffer.alloc(10);
  [0, 16384, -16384, 32767, -32768].forEach((v, i) => pcm.writeInt16LE(v, i * 2));
  const wav = tts.pcmToWav(pcm);
  const ab = wav.buffer.slice(wav.byteOffset, wav.byteOffset + wav.length);
  const ctx = { createBuffer(ch, len, rate) { const data = Array.from({ length: ch }, () => new Float32Array(len)); return { numberOfChannels: ch, length: len, sampleRate: rate, getChannelData: (c) => data[c] }; } };
  const buf = wavToBuffer(ctx, ab);
  assert.ok(buf, 'citit');
  assert.strictEqual(buf.sampleRate, tts.SR);
  assert.strictEqual(buf.length, 5);
  assert.deepStrictEqual(Array.from(buf.getChannelData(0)).map((x) => Math.round(x * 1000) / 1000), [0, 0.5, -0.5, 1, -1]);
  // MP3 (și orice altceva) → null: se decodează ca înainte
  assert.strictEqual(wavToBuffer(ctx, new Uint8Array([0x49, 0x44, 0x33, 4, 0, 0, 0, 0, 0, 0, 0, 0]).buffer), null);
  assert.strictEqual(wavToBuffer(ctx, ab.slice(0, 30)), null, 'trunchiat');
  const w8 = Buffer.from(wav); w8.writeUInt16LE(8, 34);
  assert.strictEqual(wavToBuffer(ctx, w8.buffer.slice(w8.byteOffset, w8.byteOffset + w8.length)), null, '8 biți: nu e vocea noastră');
});

test('load(): WAV citit direct; fișierele care nu vin se raportează o dată (Admin → Debug) și se mai cer o dată', async () => {
  const { AudioEngine } = await audio();
  browser();
  const tts = require('../api/_lib/tts');
  const wav = tts.pcmToWav(Buffer.alloc(4800));
  const realFetch = globalThis.fetch;
  const asked = [];
  globalThis.fetch = async (url) => {
    asked.push(url);
    if (url.endsWith('.wav')) return { ok: true, status: 200, arrayBuffer: async () => wav.buffer.slice(wav.byteOffset, wav.byteOffset + wav.length) };
    return { ok: false, status: 404, arrayBuffer: async () => new ArrayBuffer(0) };
  };
  try {
    const e = new AudioEngine();
    const problems = [];
    e.onProblem = (kind, d) => problems.push({ kind, d });
    e.unlock();
    assert.ok(await e.load('https://x/live-media/lessons/L2/a.wav'), 'WAV-ul vine ca AudioBuffer');
    assert.strictEqual(e.stats.fisiere.wav, 1);
    assert.strictEqual(await e.load('https://x/live-media/lessons/L2/b.mp3'), null);
    assert.strictEqual(problems.length, 0, 'o singură lipsă nu se raportează (rețeaua)');
    assert.strictEqual(await e.load('https://x/live-media/lessons/L2/c.mp3'), null);
    assert.deepStrictEqual(problems.map((p) => p.kind), ['fisierele-vocii']);
    assert.strictEqual(problems[0].d.fisiere.http, 2);
    assert.match(problems[0].d.fisiere.ultima, /HTTP 404 · L2\/c\.mp3/);
    await e.load('https://x/live-media/lessons/L2/d.mp3');
    assert.strictEqual(problems.length, 1, 'o singură dată pe sală');
    await e.load('https://x/live-media/lessons/L2/b.mp3');
    assert.strictEqual(asked.filter((u) => u.endsWith('/b.mp3')).length, 2, 'un fișier care n-a venit se mai cere');
    e.close();
  } finally { globalThis.fetch = realFetch; }
});

test('vocea browserului pe iPhone vorbește și fără obiectul vocii (lang „ro-RO"); pe Windows fără voce română — doar subtitrarea', async () => {
  const { AudioEngine } = await audio();
  browser();
  const S = fakeSpeech(globalThis.window, { voices: [] });          // iOS: lista vocilor vine uneori goală
  const e = new AudioEngine();
  assert.strictEqual(e.voiceStatus().status, 'ok', 'pe iPhone nu mai apare „browserul n-are voce românească"');
  e.unlock();
  await e.play('f1', { url: null, atServerMs: Date.now(), dur: 3, text: 'Bună ziua! Începem cu primul exercițiu.' });
  await tick(150);                              // vocea de pe server nu vine → o rostește browserul
  const said = S.spoken();
  assert.strictEqual(said.length, 1);
  assert.strictEqual(said[0].lang, 'ro-RO');
  assert.strictEqual(said[0].voice, undefined, 'fără obiectul vocii: iOS alege vocea română după limbă');
  assert.strictEqual(e.stats.browser.pornite, 1);
  assert.strictEqual(e.stats.server.lipsa, 1);
  e.close();

  browser({ ua: WINDOWS, platform: 'Win32', touch: 0, audioSession: false });
  const W = fakeSpeech(globalThis.window, { voices: [{ name: 'Microsoft David', lang: 'en-US' }] });
  const w = new AudioEngine();
  w.unlock();
  await w.play('f1', { url: null, atServerMs: Date.now(), dur: 3, text: 'Bună ziua! Începem cu primul exercițiu.' });
  await tick(150);
  assert.strictEqual(W.spoken().length, 0, 'o voce engleză nu citește textul românesc');
  assert.strictEqual(w.audioBlocked({ lazyCtx: true }), false, 'nici „Pornește sunetul" (n-ar ajuta) — acolo e îndemnul despre voce');
  w.close();
});

test('vocea de pe server lipsește de 2 ori la rând → o vreme frazele merg direct la vocea browserului (fără așteptare)', async () => {
  const { AudioEngine } = await audio();
  browser();
  const S = fakeSpeech(globalThis.window, { voices: [{ name: 'Ioana', lang: 'ro-RO', localService: true }] });
  const e = new AudioEngine();
  const problems = [];
  e.onProblem = (kind, d) => problems.push({ kind, d });
  e.unlock();
  for (const [i, text] of ['Prima frază din lecție.', 'A doua frază din lecție.'].entries()) {
    await e.play(`p${i}`, { url: null, atServerMs: Date.now(), dur: 2, text });
    await tick(150);
  }
  assert.strictEqual(S.spoken().length, 2, 'amândouă rostite de „Ioana"');
  assert.strictEqual(e.stats.server.lipsa, 2);
  assert.strictEqual(e.stats.server.ocolit, 1);
  assert.deepStrictEqual(problems.map((p) => p.kind), ['vocea-de-pe-server-lipseste']);
  assert.strictEqual(problems[0].d.serverOcolit, true);
  await e.play('p2', { url: null, atServerMs: Date.now(), dur: 2, text: 'A treia frază, imediat.' });
  assert.strictEqual(S.spoken().length, 3, 'rostită pe loc, fără cele 6 s de așteptare');
  assert.strictEqual(e.stats.server.lipsa, 2, 'vocea de pe server nici n-a mai fost așteptată');
  e.close();
});

test('fraza browserului nu pornește (iPhone, fără gest) → „🔊 Pornește sunetul"; atingerea o rostește din nou, din gest', async () => {
  const { AudioEngine, TIMING } = await audio();
  const saved = { ...TIMING };
  TIMING.ttsSlow = 30;
  try {
    const b = browser();
    // (o voce de bărbat în browser: fără vocea de pe server — aici contează doar vocea browserului)
    const S = fakeSpeech(globalThis.window, { voices: [{ name: 'Emil', lang: 'ro-RO' }], mode: 'blocat' });
    const e = new AudioEngine();
    const problems = [];
    e.onProblem = (kind) => problems.push(kind);
    e.unlock();
    await e.play('q1', { url: null, atServerMs: Date.now(), dur: 5, text: 'Care este semnul derivatei?' });
    assert.strictEqual(S.spoken().length, 1);
    await tick(80);
    assert.strictEqual(e.blockReason(), 'voce');
    assert.strictEqual(e.audioBlocked({ lazyCtx: true }), true, 'și la lecțiile cu vocea browserului');
    assert.deepStrictEqual(problems, ['vocea-browserului-nu-porneste']);
    // o atingere oriunde (gest): aceeași frază, rostită din nou chiar în gest
    S.ss.mode = 'ok';
    const cancels = S.cancels();
    b.fire('window', 'touchend');
    assert.strictEqual(S.cancels(), cancels + 1, 'vocea înțepenită se oprește');
    const again = S.spoken();
    assert.strictEqual(again.length, 2);
    assert.strictEqual(again[1].text, again[0].text, 'fraza de acum, din nou');
    await tick(5);
    assert.strictEqual(e.blockReason(), null, 'a pornit — butonul dispare');
    assert.strictEqual(e.stats.browser.nepornite, 1);
    // refuzată de browser („not-allowed", ex. Chrome fără gest) → tot butonul
    await tick(20);
    S.ss.mode = 'refuz';
    await e.play('q2', { url: null, atServerMs: Date.now(), dur: 3, text: 'A doua întrebare.' });
    await tick(10);
    assert.strictEqual(e.blockReason(), 'voce');
    assert.ok(problems.includes('vocea-browserului-refuzata'));
    e.close();
  } finally { Object.assign(TIMING, saved); }
});

test('3 fraze la rând fără niciun sunet → butonul (și raportul „fara-sunet"); un sunet îl ascunde', async () => {
  const { AudioEngine } = await audio();
  browser();
  const S = fakeSpeech(globalThis.window, { voices: [{ name: 'Emil', lang: 'ro-RO' }], mode: 'mut' });
  const e = new AudioEngine();
  const problems = [];
  e.onProblem = (kind, d) => problems.push({ kind, d });
  e.unlock();
  for (let i = 0; i < 3; i++) {
    await e.play(`m${i}`, { url: null, atServerMs: Date.now(), dur: 2, text: `Fraza ${i + 1}.` });
    await tick(15);
  }
  assert.strictEqual(S.spoken().length, 3);
  assert.strictEqual(e.blockReason(), 'liniste');
  assert.deepStrictEqual(problems.map((p) => p.kind), ['fara-sunet']);
  assert.strictEqual(problems[0].d.browser.fraze, 3);
  assert.strictEqual(problems[0].d.browser.pornite, 0);
  S.ss.mode = 'ok';
  await e.play('m3', { url: null, atServerMs: Date.now(), dur: 2, text: 'Acum se aude.' });
  await tick(15);
  assert.strictEqual(e.blockReason(), null);
  e.close();
});

test('sala și Pregătirea de examen: butonul și la lecțiile cu vocea browserului, problemele raportate; Admin: „🔊 Generează vocea"', () => {
  const room = fs.readFileSync(path.join(__dirname, '..', 'src', 'pages', 'LiveRoom.jsx'), 'utf8');
  assert.match(room, /engine\.blockReason\(\{ lazyCtx: tlNoVoice \}\)/);
  assert.doesNotMatch(room, /if \(!joined \|\| !hasTimeline \|\| tlNoVoice\)/, 'nu mai lipsește la lecțiile fără voce generată');
  assert.match(room, /engine\.onProblem = \(kind, d\) => reportError\(new Error\(`Sala live — sunet: \$\{kind\}`\)/);
  const prep = fs.readFileSync(path.join(__dirname, '..', 'src', 'pages', 'PregatireExamen.jsx'), 'utf8');
  assert.match(prep, /engine\.blockReason\(\{ lazyCtx: true \}\)/);
  assert.match(prep, /className="lv-sound-on"/);
  const admin = fs.readFileSync(path.join(__dirname, '..', 'src', 'components', 'LiveAdmin.jsx'), 'utf8');
  assert.match(admin, /l\.status === 'gata' && l\.noVoice && data\.tts && \(/, 'în Lecțiile recente');
  assert.match(admin, /prepareLoop\(`voce-\$\{l\.id\}`, \{ lessonId: l\.id, revoice: true \}, 'Vocea'\)/);
  assert.match(admin, /vocea generată a eșuat din nou/);
});

test('vocea de pe server: caracterele de control nu ajung la furnizor (Azure respinge SSML-ul cu ele)', () => {
  const tts = require('../api/_lib/tts');
  const t = tts.speakable('Calculăm \u000crac{1}{2} și\u0008 apoi\u0000 gata.');
  assert.doesNotMatch(t, /[\u0000-\u0008\u000b\u000c\u000e-\u001f]/);
  assert.match(t, /gata\.$/);
});
