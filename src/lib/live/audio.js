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
// =====================================================================
import { clock } from './clock';
import { lipAt, syntheticLip } from './lip';

const MAX_CACHE = 36;

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
      return true;
    } catch { return false; }
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
      // fără fișier: vocea browserului (nesincronizată perfect) + gură sintetică
      entry = { synthetic: true, startServer: atServerMs, dur, text, endAtServer: atServerMs + (dur || 3) * 1000 };
      const speakNow = () => this._speakBrowser(text);
      if (delay > 0) entry.timer = setTimeout(speakNow, delay * 1000); else speakNow();
      entry.cleanup = setTimeout(() => { if (this.active.get(id) === entry) this.active.delete(id); onEnd?.(); }, Math.max(0, (entry.endAtServer - clock.now())));
    }
    this.active.set(id, entry);
    return entry;
  }

  _speakBrowser(text) {
    try {
      if (!('speechSynthesis' in window) || !text) return;
      // fraza nouă o înlocuiește pe cea veche (cronologia merge mai departe)
      if (window.speechSynthesis.speaking || window.speechSynthesis.pending) window.speechSynthesis.cancel();
      const u = new SpeechSynthesisUtterance(text);
      u.lang = 'ro-RO'; u.rate = 1.02;
      const v = (window.speechSynthesis.getVoices() || []).find((x) => /ro(-|_)?RO/i.test(x.lang));
      if (v) u.voice = v;
      window.speechSynthesis.speak(u);
    } catch { /* ignore */ }
  }

  isPlaying(id) { return this.active.has(id); }

  stop(id) {
    const a = this.active.get(id);
    if (!a) return;
    this.active.delete(id);
    try { a.src?.stop(); } catch { /* ignore */ }
    try { a.el?.pause(); } catch { /* ignore */ }
    if (a.timer) clearTimeout(a.timer);
    if (a.cleanup) clearTimeout(a.cleanup);
    if (a.synthetic) { try { window.speechSynthesis.cancel(); } catch { /* ignore */ } }
  }
  stopAll(except = null) { [...this.active.keys()].forEach((id) => { if (id !== except) this.stop(id); }); }
  stopExcept(keep) { [...this.active.keys()].forEach((id) => { if (!keep.has(id)) this.stop(id); }); }

  // Gura, ACUM: segmentul care se aude (dacă sunt mai multe, cel mai recent)
  mouth() {
    let best = null;
    for (const a of this.active.values()) {
      let t;
      if (a.src) t = this.ctx.currentTime - a.startCtx + a.offset;
      else if (a.el) t = a.el.paused ? -1 : a.el.currentTime;
      else t = (clock.now() - a.startServer) / 1000;
      if (t < 0 || (a.dur && t > a.dur)) continue;
      const m = a.lip ? lipAt(a.lip, t) : syntheticLip(t, 1);
      if (!best || m.open > best.open) best = { ...m, t };
    }
    return best ? { ...best, speaking: true } : { open: 0, shape: 0.5, speaking: false };
  }

  speaking() { return this.mouth().speaking; }

  close() {
    this.stopAll();
    try { this.ctx?.close(); } catch { /* ignore */ }
    this.ctx = null;
    this.cache.clear();
  }
}
