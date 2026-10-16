// =====================================================================
// src/lib/live/audio.js — VOCEA profesorului în sală (Web Audio)
//
// Fiecare segment rostit e un fișier MP3 (generat o dată pe server). Aici:
//   · „deblocăm" sunetul la apăsarea „Participă acum" (iOS/Chrome cer un gest);
//   · descărcăm și decodăm segmentele din timp (următoarele 2–3);
//   · le programăm la momentul exact de pe ceasul comun (clock.js);
//   · trecem vocea printr-un lanț discret de „apel online" (microfon de
//     laptop într-o clasă: filtre + compresor + puțină cameră), ca să sune
//     ca într-o meditație pe Zoom, nu ca un fișier audio;
//   · spunem în orice moment cât de deschisă e gura (lip.js), după ceasul audio.
// Dacă Web Audio nu poate decoda (CORS, browser vechi) cădem pe <audio>.
//
// FĂRĂ fișiere (nicio cheie TTS pe server): vorbește VOCEA BROWSERULUI, gratuit.
// Alegem cea mai bună voce românească de pe calculator (Edge: „Emil Online
// (Natural)"; Windows: „Andrei"; Android: Google; Apple: „Ioana"), o „trezim" la
// apăsarea „Participă acum" (altfel prima frază întârzie secunde bune), iar
// frazele merg la COADĂ: una nu o mai taie pe cealaltă. Gura se mișcă doar cât
// se aude cu adevărat (evenimentele start/end ale vocii).
// Unde browserul n-are o voce românească de bărbat (iPhone/iPad/Mac — „Ioana";
// Android), frazele fără fișier vin cu VOCEA DE BĂRBAT de pe server (voceServer.js:
// o dată pe frază, apoi din cache), cerută din timp și redată tot la coadă, prin
// lanțul audio al sălii; dacă nu vine la timp, fraza o rostește browserul.
//
// iPHONE / iPAD: iOS tratează Web Audio ca sunet „ambiental" — cu telefonul pe
// Silențios (comutatorul de pe lateral sau butonul Action) îl taie complet, deși
// <audio>, video-urile și vocea sistemului se aud. De aceea lecțiile cu voce
// generată (MP3 prin Web Audio) tăceau pe iPhone, iar demo-ul (vocea browserului,
// „Ioana") se auzea. Acum, la „Participă acum":
//   · cerem sesiunea audio „playback" (navigator.audioSession, iOS 16.4+) — ca la
//     un video: se aude și pe Silențios (muzica din alte aplicații se oprește);
//   · pe iOS mai vechi pornim în buclă un <audio> cu liniște, care face același lucru;
//   · după o întrerupere (ecran blocat, apel, Siri, alt tab, microfonul) contextul
//     audio se reia când pagina revine în față și la primul gest (atingere, tastă).
// La ieșirea din sală (close) sesiunea revine la „auto" (restul site-ului — ex.
// sunetul de mesaj nou — ascultă iar de butonul Silențios).
//
// 15 OCT. 2026 — „la lecția nouă (EN), pe iPhone nu se aude nimic" (doar subtitrarea),
// deși celelalte lecții se aud. Cel mai probabil lecția a rămas „cu vocea browserului"
// (vocea generată a eșuat — Admin → Lecțiile recente arată eroarea): pe iPhone fiecare
// frază așteaptă atunci vocea de bărbat de pe server și, dacă nu vine, o rostește „Ioana".
// Ce s-a întărit:
//   · vocea de pe server care lipsește de 2 ori la rând (cotă, cheie, fără credite,
//     rețea) se ocolește 2 minute: frazele nu mai așteaptă câte 6 s (cele scurte se
//     pierdeau de tot — trecea timpul lor până venea rezerva);
//   · „Ioana" vorbește și fără obiectul vocii (lang „ro-RO" — iOS își alege singur vocea;
//     lista vocilor vine uneori goală sau târziu);
//   · o frază a browserului care nu pornește în 4 s, una refuzată („not-allowed") sau
//     3 fraze la rând fără niciun sunet → sala arată „🔊 Pornește sunetul", iar atingerea
//     rostește fraza din nou, chiar din gest (iOS poate cere gestul);
//   · rezerva <audio> (un fișier pe care Web Audio nu-l poate lua) folosește UN element,
//     deblocat la „Participă acum" — un <audio> nou, pornit mai târziu fără gest, e blocat
//     pe iPhone (rămânea doar subtitrarea);
//   · WAV-ul (vocea urcată fără ffmpeg) se citește direct, fără decodeAudioData;
//   · ce nu merge se raportează o dată pe sală (onProblem → Admin → Debug, „Erorile din
//     browserele vizitatorilor"): dispozitivul, starea sunetului, ce anume a eșuat.
// =====================================================================
import { clock } from './clock';
import { lipAt, syntheticLip } from './lip';
import { wantsServerVoice, serverVoiceUrl, serverVoiceState } from './voceServer';

const MAX_CACHE = 36;

// Timpii vocii (ms) — exportați, ca testele să-i poată scurta
export const TIMING = {
  serverWait: 6000,     // vocea de pe server n-a venit (sau nu se poate reda) → o rostește browserul
  serverPause: 120000,  // după 2 lipsuri la rând, vocea de pe server se ocolește atât
  ttsSlow: 4000,        // fraza browserului n-a pornit → sala arată „🔊 Pornește sunetul"
  ttsGiveUp: 9000,      // … iar după atât trecem la următoarea
  ctxRecent: 45000,     // lecția fără fișiere: contextul audio contează doar dacă a fost folosit de curând
};
const QUIET_LIMIT = 3;  // fraze la rând fără niciun sunet → „🔊 Pornește sunetul" (și raportul)
const perfNow = () => (typeof performance !== 'undefined' && performance.now ? performance.now() : Date.now());
// ultima parte a adresei unui fișier de voce (pentru raport: fără domeniu, fără parametri)
const fileOf = (url) => String(url || '').split('?')[0].split('/').slice(-2).join('/');

// iPhone / iPad (iPadOS se prezintă ca Mac, dar are ecran tactil)
const isIOS = () => typeof navigator !== 'undefined'
  && (/iP(hone|ad|od)/.test(navigator.userAgent || '') || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1));

// Sesiunea audio a paginii (Audio Session API — doar Safari, 16.4+). Întoarce
// true dacă browserul o are (atunci nu mai e nevoie de bucla <audio>).
function setAudioSession(type) {
  try {
    const as = typeof navigator !== 'undefined' ? navigator.audioSession : null;
    if (!as || typeof as.type !== 'string') return false;
    if (as.type !== type) as.type = type;
    return true;
  } catch { return false; }
}
function sessionType() {
  try { const as = typeof navigator !== 'undefined' ? navigator.audioSession : null; return as && typeof as.type === 'string' ? as.type : null; } catch { return null; }
}

// 0,2 s de liniște (WAV 8 biți, mono) la rata contextului audio — o rată diferită
// ar putea face iOS să schimbe rata plăcii de sunet și vocea s-ar auzi stricat.
function silentWav(rate) {
  const sr = Math.round(rate) || 44100;
  const n = Math.max(64, Math.round(sr * 0.2));
  const buf = new ArrayBuffer(44 + n);
  const v = new DataView(buf);
  const str = (o, s) => { for (let i = 0; i < s.length; i++) v.setUint8(o + i, s.charCodeAt(i)); };
  str(0, 'RIFF'); v.setUint32(4, 36 + n, true); str(8, 'WAVE');
  str(12, 'fmt '); v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true);
  v.setUint32(24, sr, true); v.setUint32(28, sr, true); v.setUint16(32, 1, true); v.setUint16(34, 8, true);
  str(36, 'data'); v.setUint32(40, n, true);
  new Uint8Array(buf, 44).fill(128);                 // 8 biți: 128 = liniște
  const bytes = new Uint8Array(buf);
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  return `data:audio/wav;base64,${btoa(bin)}`;
}

// WAV PCM pe 16 biți (vocea urcată fără ffmpeg — api/_lib/tts.js → pcmToWav) → AudioBuffer,
// citit direct: nu depinde de decodeAudioData (Safari refuză uneori fișiere prin Web Audio).
// Altceva (MP3, alt fel de WAV) → null: se decodează ca înainte.
export function wavToBuffer(ctx, ab) {
  try {
    if (!ctx || !ab || ab.byteLength < 44) return null;
    const v = new DataView(ab);
    const tag = (o) => String.fromCharCode(v.getUint8(o), v.getUint8(o + 1), v.getUint8(o + 2), v.getUint8(o + 3));
    if (tag(0) !== 'RIFF' || tag(8) !== 'WAVE') return null;
    let fmt = null;
    for (let o = 12; o + 8 <= ab.byteLength;) {
      const id = tag(o), size = v.getUint32(o + 4, true), body = o + 8;
      if (id === 'fmt ' && size >= 16 && body + 16 <= ab.byteLength) {
        fmt = { format: v.getUint16(body, true), ch: v.getUint16(body + 2, true), rate: v.getUint32(body + 4, true), bits: v.getUint16(body + 14, true) };
      } else if (id === 'data') {
        if (!fmt || fmt.format !== 1 || fmt.bits !== 16 || fmt.ch < 1 || fmt.ch > 2 || fmt.rate < 8000 || fmt.rate > 96000) return null;
        const frames = Math.floor(Math.min(size, ab.byteLength - body) / (2 * fmt.ch));
        if (frames < 1) return null;
        const buf = ctx.createBuffer(fmt.ch, frames, fmt.rate);
        for (let c = 0; c < fmt.ch; c++) {
          const d = buf.getChannelData(c);
          for (let i = 0, p = body + c * 2; i < frames; i++, p += 2 * fmt.ch) d[i] = v.getInt16(p, true) / 32768;
        }
        return buf;
      }
      o = body + size + (size & 1);
    }
    return null;
  } catch { return null; }
}

const WAKE_EVENTS = ['pointerup', 'touchend', 'keydown', 'focus', 'pageshow'];
const GESTURES = new Set(['pointerup', 'touchend', 'keydown']);

const RO = /^ro([-_]|$)/i;
function voiceScore(v) {
  let s = 0;
  if (/natural|online|neural|premium|enhanced/i.test(v.name)) s += 8;   // Edge: „Microsoft Emil Online (Natural)"
  if (/emil|andrei|mihai|male|b[aă]rbat/i.test(v.name)) s += 3;         // profesorul e bărbat
  if (/google/i.test(v.name)) s += 2;
  if (v.localService) s += 1;                                            // pornește mai repede
  return s;
}
// cea mai bună voce românească disponibilă (sau null)
export function pickRomanianVoice() {
  try {
    const vs = window.speechSynthesis.getVoices() || [];
    return vs.filter((v) => RO.test(v.lang)).sort((a, b) => voiceScore(b) - voiceScore(a))[0] || null;
  } catch { return null; }
}
const hasTTS = () => typeof window !== 'undefined' && 'speechSynthesis' in window && typeof window.SpeechSynthesisUtterance === 'function';

// Textul de chat (cu formule LaTeX) → text care se poate citi cu voce tare
export function speakable(t) {
  let s = String(t || '');
  if (!/[$\\^=+]/.test(s)) return s;
  s = s.replace(/\$\$?/g, ' ');
  for (let k = 0; k < 3; k++) {
    s = s.replace(/\\[dt]?frac\{([^{}]*)\}\{([^{}]*)\}/g, ' $1 supra $2 ')
      .replace(/\\sqrt\[(\d+)\]\{([^{}]*)\}/g, ' radical de ordinul $1 din $2 ')
      .replace(/\\sqrt\{([^{}]*)\}/g, ' radical din $1 ');
  }
  s = s.replace(/\^\{?2\}?/g, ' la pătrat ').replace(/\^\{?3\}?/g, ' la cub ')
    .replace(/\^\{([^{}]*)\}/g, ' la puterea $1 ').replace(/\^(\w)/g, ' la puterea $1 ')
    .replace(/_\{([^{}]*)\}/g, ' $1 ').replace(/_(\w)/g, ' $1 ');
  const words = [
    [/\\cdot|\\times/g, ' ori '], [/\\div/g, ' împărțit la '], [/\\leq?\b/g, ' mai mic sau egal cu '], [/\\geq?\b/g, ' mai mare sau egal cu '],
    [/\\neq?\b/g, ' diferit de '], [/\\approx/g, ' aproximativ '], [/\\pi\b/g, ' pi '], [/\\infty/g, ' infinit '], [/\\in\b/g, ' aparține lui '],
    [/\\Rightarrow|\\implies/g, ', deci '], [/\\Delta/g, ' delta '], [/\\angle/g, ' unghiul '], [/\\circ/g, ' grade '],
    [/\\(left|right)/g, ''], [/\\[a-zA-Z]+/g, ' '], [/[{}]/g, ' '],
    [/</g, ' mai mic decât '], [/>/g, ' mai mare decât '], [/=/g, ' egal '], [/\+/g, ' plus '], [/\s-\s/g, ' minus '],
  ];
  for (const [re, w] of words) s = s.replace(re, w);
  return s.replace(/\s+/g, ' ').trim();
}

function roomImpulse(ctx, seconds = 0.35, decay = 3.2) {
  const rate = ctx.sampleRate;
  const len = Math.floor(rate * seconds);
  const buf = ctx.createBuffer(2, len, rate);
  for (let ch = 0; ch < 2; ch++) {
    const d = buf.getChannelData(ch);
    for (let i = 0; i < len; i++) {
      // reflexii timpurii rare + coadă scurtă (o clasă mică, nu o catedrală)
      const early = (i === Math.floor(rate * (0.011 + ch * 0.004)) || i === Math.floor(rate * (0.023 + ch * 0.003))) ? 0.5 : 0;
      d[i] = early + (Math.random() * 2 - 1) * Math.pow(1 - i / len, decay) * 0.35;
    }
  }
  return buf;
}

export class AudioEngine {
  constructor() {
    this.ctx = null;
    this.cache = new Map();      // url → Promise<AudioBuffer|null>
    this.active = new Map();     // id → { src, el, startCtx, offset, dur, lip, synthetic, endAt }
    this.volume = 1;
    this.fx = true;
    this.muted = false;
    this.failedDecode = false;
    // vocea browserului: coada frazelor, fraza care se aude acum, vocea aleasă
    this.tts = { queue: [], current: null, voice: null, warmed: false };
    this.silentEl = null;        // iOS fără Audio Session API: <audio> cu liniște, în buclă
    this.recording = false;      // microfonul (dictarea) e pornit
    this._wake = null;           // ascultătorii care reiau sunetul după o întrerupere
    // rezerva <audio>: UN element, deblocat din gest, și segmentul care îl folosește acum
    this.mediaEl = null;
    this.mediaOwner = null;
    this.mediaUnlocked = false;
    this.mediaBlocked = false;   // browserul i-a refuzat pornirea (fără gest)
    // „nu se aude nimic": vocea browserului nu pornește / fraze la rând fără niciun sunet
    this.ttsStuck = false;
    this.quiet = 0;
    this.noSound = false;
    // vocea de pe server: lipsuri la rând; ocolită până la (performance.now)
    this.serverMiss = 0;
    this.serverOffUntil = 0;
    this.ctxUsedAt = -Infinity;  // ultima oară când a pornit ceva prin contextul audio
    this.onProblem = null;       // (tip, diag) → sala raportează (Admin → Debug)
    this._reported = new Set();
    this.stats = {
      fisiere: { ok: 0, wav: 0, http: 0, retea: 0, decodare: 0, ultima: null },
      rezerva: { porniri: 0, blocate: 0, ultima: null },
      server: { ok: 0, lipsa: 0, ocolit: 0 },
      browser: { fraze: 0, pornite: 0, nepornite: 0, erori: 0, ultima: null },
    };
    if (hasTTS()) {
      this._pickVoice();
      try { window.speechSynthesis.addEventListener('voiceschanged', () => this._pickVoice()); } catch { /* ignore */ }
    }
  }

  _pickVoice() { this.tts.voice = pickRomanianVoice(); return this.tts.voice; }
  // vocea de bărbat de pe server: browserul n-are una (iPhone, Android…), iar serverul n-a
  // lipsit de curând (atunci frazele merg direct la vocea browserului, fără așteptare)
  _serverVoice() { return perfNow() >= this.serverOffUntil && wantsServerVoice(this.tts.voice || this._pickVoice()); }
  // browserul poate rosti în română: are o voce românească — sau e iPhone / iPad, unde
  // sistemul își alege singur vocea după limbă („Ioana"; lista vocilor vine uneori goală)
  _browserCanSpeak() { return hasTTS() && (!!(this.tts.voice || this._pickVoice()) || isIOS()); }

  // Pentru interfață: „ok" (vorbește), „fara-ro" (nicio voce românească), „fara" (fără voce deloc)
  voiceStatus() {
    if (!hasTTS()) return { status: 'fara', name: null };
    const v = this.tts.voice || this._pickVoice();
    if (v) return { status: 'ok', name: v.name };
    if (isIOS()) return { status: 'ok', name: null };          // vocea sistemului, aleasă după limbă
    let n = 0;
    try { n = (window.speechSynthesis.getVoices() || []).length; } catch { /* ignore */ }
    return { status: n ? 'fara-ro' : 'necunoscut', name: null };
  }

  // Trebuie chemată DIN apăsarea unui buton (gest al utilizatorului)
  unlock() {
    // iPhone: sesiunea „playback" ÎNAINTE de primul sunet — altfel Silențios taie vocea
    const session = this.recording ? setAudioSession('play-and-record') : setAudioSession('playback');
    let ok = false;
    try {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (AC) {
        if (!this.ctx) {
          this.ctx = new AC({ latencyHint: 'interactive' });
          this._buildChain();
        }
        this._resumeCtx();
        const b = this.ctx.createBuffer(1, 1, 22050);
        const s = this.ctx.createBufferSource();
        s.buffer = b; s.connect(this.ctx.destination); s.start(0);
        if (!session && isIOS()) this._silentLoop();      // iOS < 16.4
        this._watch();
        ok = true;
      }
    } catch { ok = false; }
    // tot din gest: <audio>-ul de rezervă și vocea browserului (fraza care nu pornea — din nou)
    this._unlockMedia();
    if (this.ttsStuck || this.noSound) this._kickTTS(); else this._warmTTS();
    this.noSound = false;
    this.quiet = 0;
    return ok;
  }

  // Prima frază a vocii din sistem (ex. Windows) pornește cu câteva secunde de
  // întârziere: o frază mută, rostită din gestul elevului, pornește motorul acum.
  _warmTTS() {
    if (!hasTTS() || this.tts.warmed) return;
    this.tts.warmed = true;
    try {
      const v = this.tts.voice || this._pickVoice();
      const u = new window.SpeechSynthesisUtterance(' ');
      u.volume = 0; u.lang = v ? v.lang : 'ro-RO';
      if (v) u.voice = v;
      window.speechSynthesis.speak(u);
    } catch { /* ignore */ }
  }

  // Din gestul elevului („🔊 Pornește sunetul" sau orice atingere): vocea browserului nu
  // pornea (pe iPhone, speechSynthesis poate cere un gest) → o oprim, o „trezim" și rostim
  // fraza de acum din nou, chiar din gest
  _kickTTS() {
    this.ttsStuck = false;
    if (!hasTTS()) return;
    // (același gest ajunge aici de două ori: atingerea — _watch — și clicul pe buton — unlock)
    if (perfNow() - (this._kickedAt || -Infinity) < 400) return;
    this._kickedAt = perfNow();
    const T = this.tts;
    const cur = T.current;
    if (cur && cur.utter && cur.started && !cur.ended) return;      // vorbește deja
    const redo = cur && cur.utter && !cur.ended ? cur : null;
    if (redo) { this._retire(redo); T.current = null; }
    try { window.speechSynthesis.cancel(); } catch { /* ignore */ }
    T.warmed = false;
    this._warmTTS();
    if (redo && !redo.dropped) this._speakBrowser(redo);
    else if (!T.current) this._pump();
  }
  // o frază scoasă din joc: evenimentele ei întârziate (ex. după cancel) nu mai contează
  _retire(entry) {
    entry.gen = (entry.gen || 0) + 1;
    clearTimeout(entry.watch);
    clearTimeout(entry.slow);
  }

  // Contextul audio oprit („suspended", iar pe iOS și „interrupted") → îl pornim.
  _resumeCtx() {
    const c = this.ctx;
    if (!c || c.state === 'running' || c.state === 'closed') return;
    try { const p = c.resume(); if (p && typeof p.catch === 'function') p.catch(() => {}); } catch { /* ignore */ }
  }

  // Ce oprește sunetul acum (sala arată „🔊 Pornește sunetul"; primul gest îl reia — vezi
  // _watch): 'ctx' — contextul audio e oprit de browser; 'rezerva' — <audio>-ul de rezervă
  // a fost refuzat; 'voce' — vocea browserului nu pornește; 'liniste' — fraze la rând fără
  // niciun sunet. null = nimic.
  // lazyCtx (lecțiile fără fișiere): contextul contează doar dacă a trecut ceva prin el de
  // curând (vocea de pe server da; vocea browserului nu trece prin el).
  blockReason({ lazyCtx = false } = {}) {
    const c = this.ctx;
    if (c && c.state !== 'running' && c.state !== 'closed' && (!lazyCtx || perfNow() - this.ctxUsedAt < TIMING.ctxRecent)) return 'ctx';
    if (this.mediaBlocked) return 'rezerva';
    if (this.ttsStuck) return 'voce';
    if (this.noSound) return 'liniste';
    return null;
  }
  audioBlocked(opts) { return !!this.blockReason(opts); }

  // iOS < 16.4 (fără navigator.audioSession): un <audio> cu liniște, în buclă, mută
  // pagina pe canalul „media" — Web Audio se aude atunci și pe Silențios.
  _silentLoop() {
    try {
      if (!this.silentEl) {
        const el = document.createElement('audio');
        el.setAttribute('x-webkit-airplay', 'deny');      // să nu apară la AirPlay
        el.setAttribute('playsinline', '');
        try { el.disableRemotePlayback = true; } catch { /* ignore */ }
        el.preload = 'auto';
        el.loop = true;
        el.src = silentWav((this.ctx && this.ctx.sampleRate) || 44100);
        this.silentEl = el;
      }
      const p = this.silentEl.play();
      if (p && typeof p.catch === 'function') p.catch(() => {});
    } catch { /* ignore */ }
  }

  // După o întrerupere (ecran blocat, apel, Siri, alt tab, microfonul pornit),
  // iOS lasă contextul audio oprit și nu-l mai pornește singur: îl reluăm când
  // pagina revine în față și la primul gest. Bucla mută stă pe pauză cât pagina e
  // ascunsă (fără comenzi de redare pe ecranul blocat). Tot la un gest pornesc și
  // rezerva <audio> refuzată și vocea browserului care nu pornea.
  _watch() {
    if (this._wake || typeof window === 'undefined') return;
    this._wake = (ev) => {
      if (!this.ctx) return;
      // „playback" din nou (un alt tab / o altă aplicație o poate schimba) — dar nu
      // peste microfonul care ascultă acum („play-and-record", vezi setRecording / voice.js)
      const cur = sessionType();
      if (this.recording) setAudioSession('play-and-record');
      else if (cur && cur !== 'playback' && cur !== 'play-and-record') setAudioSession('playback');
      this._resumeCtx();
      if (this.silentEl && this.silentEl.paused && !document.hidden) {
        try { const p = this.silentEl.play(); if (p && typeof p.catch === 'function') p.catch(() => {}); } catch { /* ignore */ }
      }
      if (ev && GESTURES.has(ev.type)) {
        if (this.mediaBlocked) this._unlockMedia();
        if (this.ttsStuck) this._kickTTS();
      }
    };
    this._onVis = () => {
      if (document.hidden) { try { this.silentEl?.pause(); } catch { /* ignore */ } }
      else this._wake();
    };
    WAKE_EVENTS.forEach((ev) => window.addEventListener(ev, this._wake, true));
    document.addEventListener('visibilitychange', this._onVis);
    try {
      this.ctx.onstatechange = () => {
        if (this.ctx && this.ctx.state !== 'running' && this.ctx.state !== 'closed' && !document.hidden) this._resumeCtx();
      };
    } catch { /* ignore */ }
  }

  _unwatch() {
    if (this._wake && typeof window !== 'undefined') {
      WAKE_EVENTS.forEach((ev) => window.removeEventListener(ev, this._wake, true));
      document.removeEventListener('visibilitychange', this._onVis);
    }
    this._wake = null; this._onVis = null;
    if (this.silentEl) {
      try { this.silentEl.pause(); this.silentEl.removeAttribute('src'); this.silentEl.load(); } catch { /* ignore */ }
      this.silentEl = null;
    }
  }

  // ─── rezerva <audio>: un fișier pe care Web Audio nu-l poate lua (rețea, decodare) ───
  // UN singur element, creat și „deblocat" din gest: iOS îl lasă apoi să pornească singur;
  // un <audio> nou, creat mai târziu, ar fi blocat (se vedea doar subtitrarea)
  _mediaElement() {
    if (!this.mediaEl && typeof window !== 'undefined' && typeof window.Audio === 'function') {
      try {
        const el = new window.Audio();
        el.preload = 'auto';
        try { el.setAttribute('playsinline', ''); el.setAttribute('x-webkit-airplay', 'deny'); el.disableRemotePlayback = true; } catch { /* ignore */ }
        this.mediaEl = el;
      } catch { this.mediaEl = null; }
    }
    return this.mediaEl;
  }

  _unlockMedia() {
    const el = this._mediaElement();
    if (!el) return;
    const owner = this.mediaOwner;
    // fraza de rezervă refuzată de browser: pornește acum, din gest, de unde a ajuns
    if (owner && this.mediaBlocked) {
      this.mediaBlocked = false;
      this._seekMedia(owner);
      this._mediaStart(owner);
      return;
    }
    if (this.mediaUnlocked || owner) return;
    try {
      el.src = silentWav((this.ctx && this.ctx.sampleRate) || 44100);
      const p = el.play();
      const done = () => { this.mediaUnlocked = true; if (!this.mediaOwner) { try { el.pause(); } catch { /* ignore */ } } };
      if (p && typeof p.then === 'function') p.then(done, () => {});
      else done();
    } catch { /* ignore */ }
  }

  _mediaPlay(entry) {
    if (this.active.get(entry.id) !== entry) return;
    const el = entry.el;
    this.mediaOwner = entry;            // (un segment de rezervă de dinainte se oprește aici)
    this.mediaBlocked = false;
    el.onended = () => {
      if (this.mediaOwner !== entry) return;
      this.mediaOwner = null;
      if (this.active.get(entry.id) === entry) this.active.delete(entry.id);
      entry.onEnd?.();
    };
    el.onplaying = () => { if (this.mediaOwner === entry) { this.stats.rezerva.porniri++; this._audible(); } };
    el.onloadedmetadata = () => { if (this.mediaOwner === entry) this._seekMedia(entry); };
    el.volume = Math.min(1, this.muted ? 0 : this.volume);
    try { el.src = entry.url; } catch { /* ignore */ }
    this._attempt();
    this._mediaStart(entry);
  }

  // intrăm la poziția potrivită (segmentul a început deja, pe ceasul comun)
  _seekMedia(entry) {
    const t = (clock.now() - entry.startServer) / 1000;
    if (t > 0.3) { try { entry.el.currentTime = t; } catch { /* încă fără metadate */ } }
  }

  _mediaStart(entry) {
    const R = this.stats.rezerva;
    try {
      const p = entry.el.play();
      if (p && typeof p.catch === 'function') {
        p.catch((e) => {
          if (this.mediaOwner !== entry) return;
          const why = String((e && (e.name || e.message)) || e).slice(0, 60);
          R.ultima = why;
          if (/NotAllowed/i.test(why)) {
            // fără gest: sala arată „🔊 Pornește sunetul" (atingerea o pornește de unde a ajuns)
            this.mediaBlocked = true;
            R.blocate++;
            this._problem('rezerva-blocata');
          } else this._problem('rezerva-eroare');
        });
      }
    } catch (e) { R.ultima = String((e && e.message) || e).slice(0, 60); }
  }

  // Microfonul elevului (dictarea întrebării): pe Safari, cât ascultă, sesiunea
  // trebuie să fie „play-and-record"; după, revine la „playback" și reluăm sunetul.
  setRecording(on) {
    this.recording = !!on;
    if (!this.ctx) return;                         // încă n-a intrat în sală: unlock() alege
    setAudioSession(on ? 'play-and-record' : 'playback');
    if (!on) this._resumeCtx();
  }

  _buildChain() {
    const c = this.ctx;
    this.out = c.createGain();
    this.out.gain.value = this.volume;
    this.out.connect(c.destination);
    // lanțul „microfon de profesor într-un apel": HP 110 Hz → prezență +2,5 dB
    // → LP 7,8 kHz → compresor blând → (uscat + 10% cameră)
    const hp = c.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 110;
    const pres = c.createBiquadFilter(); pres.type = 'peaking'; pres.frequency.value = 2600; pres.Q.value = 0.9; pres.gain.value = 2.5;
    const lp = c.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 7800;
    const comp = c.createDynamicsCompressor();
    comp.threshold.value = -20; comp.knee.value = 12; comp.ratio.value = 3; comp.attack.value = 0.005; comp.release.value = 0.18;
    const dry = c.createGain(); dry.gain.value = 1;
    const wet = c.createGain(); wet.gain.value = 0.1;
    let conv = null;
    try { conv = c.createConvolver(); conv.buffer = roomImpulse(c); } catch { conv = null; }
    hp.connect(pres); pres.connect(lp); lp.connect(comp);
    comp.connect(dry); dry.connect(this.out);
    if (conv) { comp.connect(conv); conv.connect(wet); wet.connect(this.out); }
    this.fxIn = hp;
    this.plainIn = c.createGain();
    this.plainIn.connect(this.out);
  }

  get input() { return this.fx ? this.fxIn : this.plainIn; }
  setVolume(v) { this.volume = Math.max(0, Math.min(1.5, v)); if (this.out) this.out.gain.value = this.muted ? 0 : this.volume; this.active.forEach((a) => { if (a.el) a.el.volume = Math.min(1, this.muted ? 0 : this.volume); }); }
  setMuted(m) { this.muted = !!m; this.setVolume(this.volume); }
  setFx(on) { this.fx = !!on; }
  ctxTime() { return this.ctx ? this.ctx.currentTime : 0; }

  load(url) {
    if (!url) return Promise.resolve(null);
    if (this.cache.has(url)) return this.cache.get(url);
    const p = (async () => {
      if (!this.ctx || this.failedDecode) return null;
      const F = this.stats.fisiere;
      const fail = (kind, what) => {
        F[kind]++;
        F.ultima = `${what} · ${fileOf(url)}`;
        if (F.http + F.retea + F.decodare >= 2) this._problem('fisierele-vocii');
        return null;
      };
      let ab;
      try {
        const r = await fetch(url, { mode: 'cors' });
        if (!r.ok) return fail('http', `HTTP ${r.status}`);
        ab = await r.arrayBuffer();
      } catch (e) { return fail('retea', String((e && e.message) || e).slice(0, 60)); }
      // WAV (vocea urcată fără ffmpeg): citit direct, fără decodeAudioData
      const wav = wavToBuffer(this.ctx, ab);
      if (wav) { F.ok++; F.wav++; return wav; }
      const buf = await new Promise((res) => {
        try {
          const pr = this.ctx.decodeAudioData(ab, (b) => res(b), () => res(null));
          if (pr && pr.then) pr.then(res, () => res(null));
        } catch { res(null); }
      });
      if (!buf) return fail('decodare', 'nu se decodează');
      F.ok++;
      return buf;
    })();
    this.cache.set(url, p);
    // un fișier care n-a venit (rețeaua) se mai încearcă data viitoare
    p.then((b) => { if (!b && this.cache.get(url) === p) this.cache.delete(url); });
    if (this.cache.size > MAX_CACHE) this.cache.delete(this.cache.keys().next().value);
    return p;
  }

  // Pornește segmentul `id` astfel încât momentul lui 0 să cadă la `atServerMs`
  // (ceasul comun). Dacă a început deja, intră la poziția potrivită.
  async play(id, { url, atServerMs, dur, lip = null, text = '', onEnd = null }) {
    if (this.active.has(id)) return this.active.get(id);
    const buffer = await this.load(url);
    if (this.active.has(id)) return this.active.get(id);
    if (buffer) this._resumeCtx();                          // oprit între timp (iOS): încercăm să-l pornim
    const delay = (atServerMs - clock.now()) / 1000;
    const offset = Math.max(0, -delay);
    if (dur && offset >= dur - 0.05) return null;          // s-a terminat deja
    let entry;
    if (buffer && this.ctx) {
      const src = this.ctx.createBufferSource();
      src.buffer = buffer;
      src.connect(this.input);
      const startCtx = this.ctx.currentTime + Math.max(0, delay);
      src.start(startCtx, offset);
      entry = { src, startCtx, offset, dur: dur || buffer.duration, lip, endAtServer: atServerMs + (dur || buffer.duration) * 1000 };
      src.onended = () => { if (this.active.get(id) === entry) this.active.delete(id); onEnd?.(); };
      this._ctxPlayed();
    } else if (url) {
      // rezervă: <audio>-ul sălii, deblocat la „Participă acum" (fără lanțul de efecte)
      const el = this._mediaElement();
      entry = { el, media: true, id, url, onEnd, startServer: atServerMs, offset, dur, lip, endAtServer: atServerMs + (dur || 0) * 1000 };
      if (el) entry.timer = setTimeout(() => this._mediaPlay(entry), Math.max(0, delay * 1000));
      else entry.silent = true;
    } else {
      // fără fișier: vocea browserului (sau cea de bărbat de pe server), la coadă (vezi _say)
      entry = { synthetic: true, id, startServer: atServerMs, dur, text, endAtServer: atServerMs + (dur || 3) * 1000, started: null, ended: false };
      // cerută din timp (și cât e ocolită: când revine, frazele sunt deja gata)
      if (text && wantsServerVoice(this.tts.voice || this._pickVoice())) serverVoiceUrl(speakable(text));
      const sayNow = () => this._say(entry);
      if (delay > 0) entry.timer = setTimeout(sayNow, delay * 1000); else sayNow();
      entry.cleanup = setTimeout(() => { if (this.active.get(id) === entry) this.active.delete(id); onEnd?.(); }, Math.max(0, (entry.endAtServer - clock.now())));
    }
    this.active.set(id, entry);
    return entry;
  }

  // ceva a pornit prin contextul audio: dacă rulează, se aude
  _ctxPlayed() {
    this.ctxUsedAt = perfNow();
    if (this.ctx && this.ctx.state === 'running') this._audible();
  }

  // O frază pentru vocea browserului. Dacă cea de dinainte încă se aude, o lăsăm
  // să se termine (coadă) — dar nu rămânem în urmă cu mai mult de o frază.
  _say(entry) {
    const T = this.tts;
    if (!entry.text || !(this._serverVoice() || this._browserCanSpeak())) { entry.silent = true; return; }   // fără voce: doar subtitrarea
    T.queue = T.queue.filter((e) => !e.dropped);
    while (T.queue.length >= 1) T.queue.shift().dropped = true;   // frazele rămase în urmă se sar
    T.queue.push(entry);
    // o frază „blocată" (nu s-a terminat de mult peste durata ei) → o oprim
    const cur = T.current;
    if (cur && cur.started && perfNow() - cur.started > ((cur.dur || 6) + 6) * 1000) this._silence(false);
    this._pump();
  }

  _pump() {
    const T = this.tts;
    if (T.current || !T.queue.length) return;
    const server = this._serverVoice();
    if (!server && !this._browserCanSpeak()) {
      T.queue.forEach((e) => { e.silent = true; });                // fără voce: doar subtitrarea
      T.queue = [];
      return;
    }
    const entry = T.queue.shift();
    if (entry.dropped) { this._pump(); return; }
    if (server) this._speakServer(entry);
    else this._speakBrowser(entry);
  }

  // Fraza cu vocea de bărbat de pe server, prin lanțul audio al sălii. Nu vine în
  // câteva secunde (sau nu se poate reda) → o rostește browserul (sau doar subtitrarea).
  // Lipsește de 2 ori la rând → o vreme frazele merg direct la browser (TIMING.serverPause).
  _speakServer(entry) {
    const T = this.tts;
    const S = this.stats.server;
    T.current = entry;
    let settled = false;
    const miss = () => {
      if (settled) return;
      settled = true;
      S.lipsa++;
      if (++this.serverMiss >= 2) {
        this.serverMiss = 0;
        S.ocolit++;
        this.serverOffUntil = perfNow() + TIMING.serverPause;
        this._problem('vocea-de-pe-server-lipseste');
      }
    };
    const fallback = () => {
      miss();
      if (T.current !== entry || entry.ended) return;
      clearTimeout(entry.watch);
      T.current = null;
      if (entry.dropped) { this._pump(); return; }
      if (this._browserCanSpeak()) this._speakBrowser(entry);
      else { entry.silent = true; this._pump(); }
    };
    entry.watch = setTimeout(fallback, TIMING.serverWait);
    serverVoiceUrl(speakable(entry.text))
      .then((url) => (url ? this.load(url) : null))
      .then((buf) => {
        if (buf && !settled) { settled = true; this.serverMiss = 0; S.ok++; }
        if (T.current !== entry || entry.ended) return;
        if (entry.dropped) { clearTimeout(entry.watch); T.current = null; this._pump(); return; }
        if (!buf || !this.ctx || !this.input) { fallback(); return; }
        clearTimeout(entry.watch);
        this._resumeCtx();
        const src = this.ctx.createBufferSource();
        src.buffer = buf;
        src.connect(this.input);
        src.onended = () => {
          entry.ended = true;
          if (T.current === entry) T.current = null;
          this._pump();
        };
        entry.node = src;
        src.start();
        entry.started = perfNow();
        this._ctxPlayed();
      })
      .catch(fallback);
  }

  _speakBrowser(entry) {
    const T = this.tts;
    if (!this._browserCanSpeak()) { entry.silent = true; if (T.current === entry) T.current = null; this._pump(); return; }
    const B = this.stats.browser;
    const v = T.voice || this._pickVoice();
    const gen = (entry.gen || 0) + 1;
    entry.gen = gen;
    const mine = () => entry.gen === gen;
    try {
      const u = new window.SpeechSynthesisUtterance(speakable(entry.text));
      // fără obiectul vocii (iPhone, lista încă goală): limba alege vocea sistemului („Ioana")
      if (v) { u.voice = v; u.lang = v.lang; } else u.lang = 'ro-RO';
      u.rate = 1.05; u.volume = this.muted ? 0 : Math.min(1, this.volume);
      const t0 = perfNow();
      const done = (ev) => {
        if (!mine()) return;
        clearTimeout(entry.watch); clearTimeout(entry.slow);
        if (ev && ev.type === 'error') {
          const why = String(ev.error || 'error');
          if (/not-allowed/i.test(why)) {
            // browserul cere un gest: „🔊 Pornește sunetul" (atingerea o rostește din nou)
            this.ttsStuck = true;
            this._problem('vocea-browserului-refuzata');
          }
          if (!/interrupted|cancel/i.test(why)) { B.erori++; B.ultima = why.slice(0, 40); }
        } else if (!entry.started && perfNow() - t0 > 400) this._audible();   // a vorbit, deși „start" n-a venit
        entry.ended = true;
        if (T.current === entry) T.current = null;
        this._pump();
      };
      u.onstart = () => {
        if (!mine()) return;
        entry.started = perfNow();
        clearTimeout(entry.slow);
        B.pornite++;
        this.ttsStuck = false;
        this._audible();
      };
      u.onend = done; u.onerror = done;
      entry.utter = u;                     // referință păstrată (Chrome „uită" altfel evenimentele)
      T.current = entry;
      B.fraze++;
      this._attempt();
      window.speechSynthesis.speak(u);
      // n-a pornit în 4 s → „🔊 Pornește sunetul" (atingerea o rostește din gest); în 9 s → mai departe
      entry.slow = setTimeout(() => {
        if (!mine() || entry.started || T.current !== entry) return;
        B.nepornite++;
        this.ttsStuck = true;
        this._problem('vocea-browserului-nu-porneste');
      }, TIMING.ttsSlow);
      entry.watch = setTimeout(() => { if (mine() && !entry.started && T.current === entry) this._silence(false); }, TIMING.ttsGiveUp);
    } catch (e) {
      if (T.current === entry) T.current = null;
      entry.silent = true;
      B.ultima = String((e && e.message) || e).slice(0, 60);
    }
  }

  // Oprește vocea browserului (și coada). keepQueue=false golește și coada.
  _silence(clearQueue = true) {
    const T = this.tts;
    if (clearQueue) { T.queue.forEach((e) => { e.dropped = true; }); T.queue = []; }
    if (T.current) {
      T.current.ended = true;
      this._retire(T.current);
      try { T.current.node?.stop(); } catch { /* ignore */ }     // vocea de pe server
      T.current = null;
    }
    try { if (hasTTS()) window.speechSynthesis.cancel(); } catch { /* ignore */ }
    // (Chrome: speak() imediat după cancel() se pierde uneori — lăsăm o clipă)
    if (!clearQueue) setTimeout(() => this._pump(), 150);
  }

  // „Nu se aude nimic": o frază care ar trebui să se audă (vocea browserului, rezerva
  // <audio>) — dacă QUIET_LIMIT la rând trec fără niciun sunet, sala arată butonul
  _attempt() {
    this.quiet++;
    if (this.quiet >= QUIET_LIMIT && !this.noSound) {
      this.noSound = true;
      this._problem('fara-sunet');
    }
  }
  _audible() { this.quiet = 0; this.noSound = false; }

  // Ce știm despre sunet, pentru raportul din Admin → Debug (fără date personale)
  diag() {
    let voices = -1;
    try { if (hasTTS()) voices = (window.speechSynthesis.getVoices() || []).length; } catch { /* ignore */ }
    return {
      ua: typeof navigator !== 'undefined' ? String(navigator.userAgent || '').slice(0, 180) : '',
      ios: isIOS(),
      ctx: this.ctx ? `${this.ctx.state} ${this.ctx.sampleRate} Hz` : 'fără',
      sesiune: sessionType(),
      vocea: this.tts.voice ? `${this.tts.voice.name} (${this.tts.voice.lang})` : null,
      voci: voices,
      server: serverVoiceState(),
      serverOcolit: perfNow() < this.serverOffUntil,
      blocat: this.blockReason(),
      ...JSON.parse(JSON.stringify(this.stats)),
    };
  }

  // o singură dată pe sală, pentru fiecare fel de problemă
  _problem(kind) {
    if (this._reported.has(kind)) return;
    this._reported.add(kind);
    try { this.onProblem?.(kind, this.diag()); } catch { /* raportul nu are voie să strice sunetul */ }
  }

  isPlaying(id) { return this.active.has(id); }

  // hard=false: la vocea browserului, fraza care se aude deja se termină firesc
  // (doar cele încă neîncepute se scot din coadă). hard=true: tăcere imediată.
  stop(id, { hard = false } = {}) {
    const a = this.active.get(id);
    if (!a) return;
    this.active.delete(id);
    try { a.src?.stop(); } catch { /* ignore */ }
    // <audio>-ul de rezervă e comun: îl oprim doar dacă e (încă) al acestui segment
    if (a.el && (!a.media || this.mediaOwner === a)) {
      try { a.el.pause(); } catch { /* ignore */ }
      if (a.media) { this.mediaOwner = null; this.mediaBlocked = false; }
    }
    if (a.timer) clearTimeout(a.timer);
    if (a.cleanup) clearTimeout(a.cleanup);
    if (a.synthetic) {
      a.dropped = true;
      this.tts.queue = this.tts.queue.filter((e) => e !== a);
      if (hard && this.tts.current === a) this._silence(false);
    }
  }
  stopAll(except = null, { hard = false } = {}) {
    [...this.active.keys()].forEach((id) => { if (id !== except) this.stop(id, { hard }); });
    if (hard) this._silence(true);
  }
  stopExcept(keep, { hard = false } = {}) { [...this.active.keys()].forEach((id) => { if (!keep.has(id)) this.stop(id, { hard }); }); }

  // Gura, ACUM: segmentul care se aude (dacă sunt mai multe, cel mai recent)
  mouth() {
    let best = null;
    for (const a of this.active.values()) {
      let t;
      if (a.synthetic || (a.media && !a.el)) {
        if (!a.silent) continue;                       // vocea browserului: vezi mai jos
        t = (clock.now() - a.startServer) / 1000;       // fără voce: gura urmează subtitrarea
      } else if (a.src) t = this.ctx.currentTime - a.startCtx + a.offset;
      else if (a.el) t = a.el.paused || (a.media && this.mediaOwner !== a) ? -1 : a.el.currentTime;
      else continue;
      if (t < 0 || (a.dur && t > a.dur)) continue;
      const m = a.lip ? lipAt(a.lip, t) : syntheticLip(t, 1);
      if (!best || m.open > best.open) best = { ...m, t };
    }
    // vocea browserului: gura se mișcă exact cât se aude fraza
    const c = this.tts.current;
    if (c && c.started && !c.ended) {
      const t = (perfNow() - c.started) / 1000;
      const m = syntheticLip(t, 1);
      if (!best || m.open > best.open) best = { ...m, t };
    }
    return best ? { ...best, speaking: true } : { open: 0, shape: 0.5, speaking: false };
  }

  speaking() { return this.mouth().speaking; }

  close() {
    this.stopAll(null, { hard: true });
    this._unwatch();
    if (this.mediaEl) {
      try { this.mediaEl.pause(); this.mediaEl.removeAttribute('src'); this.mediaEl.load(); } catch { /* ignore */ }
      this.mediaEl = null;
    }
    this.mediaOwner = null; this.mediaUnlocked = false; this.mediaBlocked = false;
    this.ttsStuck = false; this.noSound = false; this.quiet = 0;
    try { this.ctx?.close(); } catch { /* ignore */ }
    this.ctx = null;
    this.cache.clear();
    // în afara sălii, sunetele site-ului ascultă iar de butonul Silențios
    if (this.recording) this.recording = false;
    setAudioSession('auto');
  }
}
