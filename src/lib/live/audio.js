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
// =====================================================================
import { clock } from './clock';
import { lipAt, syntheticLip } from './lip';

const MAX_CACHE = 36;

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
    if (hasTTS()) {
      this._pickVoice();
      try { window.speechSynthesis.addEventListener('voiceschanged', () => this._pickVoice()); } catch { /* ignore */ }
    }
  }

  _pickVoice() { this.tts.voice = pickRomanianVoice(); return this.tts.voice; }

  // Pentru interfață: „ok" (vorbește), „fara-ro" (nicio voce românească), „fara" (fără voce deloc)
  voiceStatus() {
    if (!hasTTS()) return { status: 'fara', name: null };
    const v = this.tts.voice || this._pickVoice();
    if (v) return { status: 'ok', name: v.name };
    let n = 0;
    try { n = (window.speechSynthesis.getVoices() || []).length; } catch { /* ignore */ }
    return { status: n ? 'fara-ro' : 'necunoscut', name: null };
  }

  // Trebuie chemată DIN apăsarea unui buton (gest al utilizatorului)
  unlock() {
    try {
      if (!this.ctx) {
        const AC = window.AudioContext || window.webkitAudioContext;
        if (!AC) return false;
        this.ctx = new AC({ latencyHint: 'interactive' });
        this._buildChain();
      }
      if (this.ctx.state === 'suspended') this.ctx.resume();
      const b = this.ctx.createBuffer(1, 1, 22050);
      const s = this.ctx.createBufferSource();
      s.buffer = b; s.connect(this.ctx.destination); s.start(0);
      this._warmTTS();
      return true;
    } catch { this._warmTTS(); return false; }
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
      try {
        const r = await fetch(url, { mode: 'cors' });
        if (!r.ok) return null;
        const ab = await r.arrayBuffer();
        return await new Promise((res) => {
          try {
            const pr = this.ctx.decodeAudioData(ab, (b) => res(b), () => res(null));
            if (pr && pr.then) pr.then(res, () => res(null));
          } catch { res(null); }
        });
      } catch { return null; }
    })();
    this.cache.set(url, p);
    if (this.cache.size > MAX_CACHE) this.cache.delete(this.cache.keys().next().value);
    return p;
  }

  // Pornește segmentul `id` astfel încât momentul lui 0 să cadă la `atServerMs`
  // (ceasul comun). Dacă a început deja, intră la poziția potrivită.
  async play(id, { url, atServerMs, dur, lip = null, text = '', onEnd = null }) {
    if (this.active.has(id)) return this.active.get(id);
    const buffer = await this.load(url);
    if (this.active.has(id)) return this.active.get(id);
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
    } else if (url) {
      // rezervă: <audio> (fără lanțul de efecte)
      const el = new Audio(url);
      el.crossOrigin = 'anonymous';
      el.volume = Math.min(1, this.muted ? 0 : this.volume);
      entry = { el, startServer: atServerMs, offset, dur, lip, endAtServer: atServerMs + (dur || 0) * 1000 };
      const go = () => {
        try { el.currentTime = Math.max(0, (clock.now() - atServerMs) / 1000); } catch { /* ignore */ }
        el.play().catch(() => { /* blocat de browser — rămâne subtitrarea */ });
      };
      if (delay > 0) entry.timer = setTimeout(go, delay * 1000); else go();
      el.onended = () => { if (this.active.get(id) === entry) this.active.delete(id); onEnd?.(); };
    } else {
      // fără fișier: vocea browserului, la coadă (vezi _say)
      entry = { synthetic: true, id, startServer: atServerMs, dur, text, endAtServer: atServerMs + (dur || 3) * 1000, started: null, ended: false };
      const sayNow = () => this._say(entry);
      if (delay > 0) entry.timer = setTimeout(sayNow, delay * 1000); else sayNow();
      entry.cleanup = setTimeout(() => { if (this.active.get(id) === entry) this.active.delete(id); onEnd?.(); }, Math.max(0, (entry.endAtServer - clock.now())));
    }
    this.active.set(id, entry);
    return entry;
  }

  // O frază pentru vocea browserului. Dacă cea de dinainte încă se aude, o lăsăm
  // să se termine (coadă) — dar nu rămânem în urmă cu mai mult de o frază.
  _say(entry) {
    const T = this.tts;
    const v = hasTTS() ? (T.voice || this._pickVoice()) : null;
    if (!v || !entry.text) { entry.silent = true; return; }       // fără voce românească: doar subtitrarea
    T.queue = T.queue.filter((e) => !e.dropped);
    while (T.queue.length >= 1) T.queue.shift().dropped = true;   // frazele rămase în urmă se sar
    T.queue.push(entry);
    // o frază „blocată" (nu s-a terminat de mult peste durata ei) → o oprim
    const cur = T.current;
    if (cur && cur.started && performance.now() - cur.started > ((cur.dur || 6) + 6) * 1000) this._silence(false);
    this._pump();
  }

  _pump() {
    const T = this.tts;
    if (T.current || !T.queue.length || !hasTTS()) return;
    const entry = T.queue.shift();
    if (entry.dropped) { this._pump(); return; }
    const v = T.voice || this._pickVoice();
    if (!v) { entry.silent = true; return; }
    try {
      const u = new window.SpeechSynthesisUtterance(speakable(entry.text));
      u.voice = v; u.lang = v.lang; u.rate = 1.05; u.volume = this.muted ? 0 : Math.min(1, this.volume);
      const done = () => {
        entry.ended = true;
        if (T.current === entry) T.current = null;
        this._pump();
      };
      u.onstart = () => { entry.started = performance.now(); };
      u.onend = done; u.onerror = done;
      entry.utter = u;                     // referință păstrată (Chrome „uită" altfel evenimentele)
      T.current = entry;
      window.speechSynthesis.speak(u);
      // n-a pornit deloc în 9 s → mergem mai departe
      entry.watch = setTimeout(() => { if (!entry.started && T.current === entry) { this._silence(false); } }, 9000);
    } catch { T.current = null; entry.silent = true; }
  }

  // Oprește vocea browserului (și coada). keepQueue=false golește și coada.
  _silence(clearQueue = true) {
    const T = this.tts;
    if (clearQueue) { T.queue.forEach((e) => { e.dropped = true; }); T.queue = []; }
    if (T.current) { T.current.ended = true; clearTimeout(T.current.watch); T.current = null; }
    try { if (hasTTS()) window.speechSynthesis.cancel(); } catch { /* ignore */ }
    // (Chrome: speak() imediat după cancel() se pierde uneori — lăsăm o clipă)
    if (!clearQueue) setTimeout(() => this._pump(), 150);
  }

  isPlaying(id) { return this.active.has(id); }

  // hard=false: la vocea browserului, fraza care se aude deja se termină firesc
  // (doar cele încă neîncepute se scot din coadă). hard=true: tăcere imediată.
  stop(id, { hard = false } = {}) {
    const a = this.active.get(id);
    if (!a) return;
    this.active.delete(id);
    try { a.src?.stop(); } catch { /* ignore */ }
    try { a.el?.pause(); } catch { /* ignore */ }
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
      if (a.synthetic) {
        if (!a.silent) continue;                       // vocea browserului: vezi mai jos
        t = (clock.now() - a.startServer) / 1000;       // fără voce: gura urmează subtitrarea
      } else if (a.src) t = this.ctx.currentTime - a.startCtx + a.offset;
      else if (a.el) t = a.el.paused ? -1 : a.el.currentTime;
      if (t < 0 || (a.dur && t > a.dur)) continue;
      const m = a.lip ? lipAt(a.lip, t) : syntheticLip(t, 1);
      if (!best || m.open > best.open) best = { ...m, t };
    }
    // vocea browserului: gura se mișcă exact cât se aude fraza
    const c = this.tts.current;
    if (c && c.started && !c.ended) {
      const t = (performance.now() - c.started) / 1000;
      const m = syntheticLip(t, 1);
      if (!best || m.open > best.open) best = { ...m, t };
    }
    return best ? { ...best, speaking: true } : { open: 0, shape: 0.5, speaking: false };
  }

  speaking() { return this.mouth().speaking; }

  close() {
    this.stopAll(null, { hard: true });
    try { this.ctx?.close(); } catch { /* ignore */ }
    this.ctx = null;
    this.cache.clear();
  }
}
