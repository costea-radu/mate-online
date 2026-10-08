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
const audio = () => (audioP || (audioP = importLive(['audio', 'clock', 'lip'], 'audio')));

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
  fs.copyFileSync(path.join(__dirname, '..', 'src', 'lib', 'voice.js'), path.join(dir, 'voice.mjs'));
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
