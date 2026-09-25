// =====================================================================
// src/lib/live/vorbire.js — VOCEA lui Prof. Tudor în „Planul meu"
//
// Profesorul are o singură gură, deci pagina are un singur „glas":
//   · rostește propoziție cu propoziție, cu vocea browserului (gratuită) —
//     aceeași alegere ca în sala live: Edge „Emil Online (Natural)", Windows
//     „Andrei", Android vocea Google românească;
//   · spune în fiecare clipă CE rostește (subtitrarea) și CÂT de deschisă e
//     gura (mouth() — o citește animația WebGL a profesorului);
//   · fără voce românească, cu sunetul oprit sau cu vocea blocată de browser
//     (Chrome cere un clic pe pagină înainte de prima rostire) lecția NU se
//     oprește: subtitrările curg în ritmul vorbirii, iar gura se mișcă;
//   · o replică nouă o întrerupe pe cea veche (`queue: true` = o pune la coadă).
// Preferințele (sunet, subtitrări) se țin minte în localStorage.
//
// Folosire:  prof.say(plan, { onProgress, onEnd, onStop, key, queue })
//   plan = text sau listă de propoziții { caption, spoken, board?, boardEnd? }
//   (vezi src/lib/tabla.js → speechPlan / talkPlan)
// =====================================================================
import { pickRomanianVoice } from './audio';
import { syntheticLip } from './lip';
import { talkPlan } from '../tabla';

const SOUND_KEY = 'prof_sunet';
const CC_KEY = 'prof_subtitrari';
const readPref = (k, def) => { try { const v = localStorage.getItem(k); return v == null ? def : v === '1'; } catch { return def; } };
const writePref = (k, v) => { try { localStorage.setItem(k, v ? '1' : '0'); } catch { /* fără stocare */ } };
const hasTTS = () => typeof window !== 'undefined' && 'speechSynthesis' in window && typeof window.SpeechSynthesisUtterance === 'function';
const now = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());

// cât durează o propoziție rostită (ca estimarea din sala live), în milisecunde
export function estimateMs(text) {
  const words = String(text || '').split(/\s+/).filter(Boolean).length;
  return Math.round(Math.max(1.3, words / 2.5 + 0.4) * 1000);
}

function toItems(input) {
  if (!input) return [];
  if (typeof input === 'string') return talkPlan(input);
  if (Array.isArray(input)) return input.flatMap((x) => (typeof x === 'string' ? talkPlan(x) : x && x.spoken ? [x] : []));
  return [];
}

class Speaker {
  constructor() {
    this.subs = new Set();
    this.state = {
      caption: null,          // propoziția care se aude / se afișează acum
      speaking: false,        // gura se mișcă
      paused: false,
      needsTap: false,        // browserul a blocat vocea → „🔊 Pornește sunetul"
      sound: readPref(SOUND_KEY, true),
      cc: readPref(CC_KEY, true),
      voice: 'necunoscut',    // ok | fara-ro | fara | nu-porneste | necunoscut
      key: null,              // cine vorbește acum (lecția, conversația, propunerea…)
      lastText: null,         // ultima replică întreagă (pentru „↺ Repetă")
    };
    this.job = null;
    this.queue = [];
    this.gen = 0;
    this.t0 = 0;
    this.voice = null;
    this.failures = 0;
    this.broken = false;
    this.warmed = false;
    this.cancelAt = 0;
    this.lingerT = null;
    this.lastPlan = null;
    if (hasTTS()) {
      this._pick();
      try { window.speechSynthesis.addEventListener('voiceschanged', () => this._pick()); } catch { /* ignore */ }
      // primul gest pe pagină „trezește" vocea (Chrome/iOS cer un gest)
      const onGesture = () => { if (!this.warmed || this.state.needsTap) this.unlock(); };
      try {
        window.addEventListener('pointerdown', onGesture, true);
        window.addEventListener('keydown', onGesture, true);
      } catch { /* ignore */ }
    }
  }

  // ── starea (pentru React) ─────────────────────────────────────────────────
  subscribe(fn) { this.subs.add(fn); fn(this.state); return () => { this.subs.delete(fn); }; }
  _emit(patch) {
    let changed = false;
    for (const k of Object.keys(patch)) if (this.state[k] !== patch[k]) { changed = true; break; }
    if (!changed) return;
    this.state = { ...this.state, ...patch };
    this.subs.forEach((f) => { try { f(this.state); } catch { /* un abonat stricat nu oprește vocea */ } });
  }

  _pick() {
    this.voice = pickRomanianVoice();
    this._emit({ voice: this.voiceStatus() });
    return this.voice;
  }
  voiceStatus() {
    if (!hasTTS()) return 'fara';
    if (this.broken) return 'nu-porneste';
    if (this.voice || pickRomanianVoice()) return 'ok';
    let n = 0;
    try { n = (window.speechSynthesis.getVoices() || []).length; } catch { /* ignore */ }
    return n ? 'fara-ro' : 'necunoscut';
  }
  _canSpeak() {
    return this.state.sound && hasTTS() && !this.broken && !this.state.needsTap && !!(this.voice || this._pick());
  }

  // ── preferințe ────────────────────────────────────────────────────────────
  setSound(on) {
    writePref(SOUND_KEY, !!on);
    this._emit({ sound: !!on });
    if (on) this.unlock();
    this._restartSentence();                 // propoziția curentă, în noul mod
  }
  setCc(on) { writePref(CC_KEY, !!on); this._emit({ cc: !!on }); }

  // Din gestul elevului (clic / tastă): deblochează vocea browserului
  unlock() {
    if (!hasTTS()) return;
    try { window.speechSynthesis.resume(); } catch { /* ignore */ }
    if (!this.warmed) {
      this.warmed = true;
      // prima rostire a sistemului pornește greu: o frază mută îl „încălzește"
      try {
        const u = new window.SpeechSynthesisUtterance(' ');
        u.volume = 0; u.lang = this.voice ? this.voice.lang : 'ro-RO';
        if (this.voice) u.voice = this.voice;
        if (!window.speechSynthesis.speaking) window.speechSynthesis.speak(u);
      } catch { /* ignore */ }
    }
    if (this.state.needsTap) {
      this._emit({ needsTap: false });
      this._restartSentence();
    }
  }

  // ── vorbirea ──────────────────────────────────────────────────────────────
  say(input, opts = {}) {
    const items = toItems(input);
    const job = { items, i: 0, opts, key: opts.key || null, done: false, silent: false, timer: null, watch: null };
    const ctl = {
      key: job.key,
      stop: () => this._stopJob(job),
      get active() { return !job.done; },
    };
    if (!items.length) { job.done = true; setTimeout(() => { try { opts.onEnd?.(); } catch { /* ignore */ } }, 0); return ctl; }
    if (opts.remember !== false) { this.lastPlan = items; this._emit({ lastText: items.map((x) => x.caption).join(' ') }); }
    if (opts.queue && this.job && !this.job.done) { this.queue.push(job); return ctl; }
    this._halt(true);
    this._start(job);
    return ctl;
  }

  // „↺ Repetă": ultima replică, încă o dată
  repeat() { if (this.lastPlan) this.say(this.lastPlan, { key: 'repeta', remember: false }); }

  isBusy(key = null) { return !!(this.job && !this.job.done && (key == null || this.job.key === key)); }

  pause() {
    const job = this.job;
    if (!job || job.done || this.state.paused) return;
    this.gen += 1;
    clearTimeout(job.timer); clearTimeout(job.watch);
    this._cancelTTS();
    this._emit({ paused: true, speaking: false });
  }
  resume() {
    const job = this.job;
    if (!this.state.paused) return;
    this._emit({ paused: false });
    if (job && !job.done) { this.unlock(); this._step(job); }        // propoziția curentă, de la început
  }

  // oprește tot (sau doar replica cu cheia dată)
  stop(key = null) {
    if (key != null) {
      this.queue = this.queue.filter((j) => j.key !== key);
      if (this.job && this.job.key === key) this._stopJob(this.job);
      return;
    }
    this._halt(true);
    this._emit({ caption: null, speaking: false, paused: false, key: null });
  }

  // Gura, ACUM (pentru animația profesorului)
  mouth() {
    if (!this.state.speaking || this.state.paused) return { open: 0, shape: 0.5, speaking: false };
    const m = syntheticLip((now() - this.t0) / 1000, 1);
    return { ...m, speaking: true };
  }
  speaking() { return this.state.speaking && !this.state.paused; }

  // ── interne ───────────────────────────────────────────────────────────────
  _cancelTTS() {
    if (!hasTTS()) return;
    try {
      const s = window.speechSynthesis;
      if (s.speaking || s.pending) { s.cancel(); this.cancelAt = now(); }
    } catch { /* ignore */ }
  }

  _stopJob(job) {
    if (job.done) return;
    const idx = this.queue.indexOf(job);
    if (idx >= 0) { this.queue.splice(idx, 1); job.done = true; return; }
    if (this.job !== job) { job.done = true; return; }
    this._halt(false);
    const nxt = this.queue.shift();
    if (nxt) this._start(nxt);
    else this._emit({ caption: null, speaking: false, paused: false, key: null });
  }

  // oprește replica curentă (onStop — n-a apucat să se termine); coada, opțional
  _halt(clearQueue) {
    const job = this.job;
    this.gen += 1;
    clearTimeout(this.lingerT);
    if (job && !job.done) {
      job.done = true;
      clearTimeout(job.timer); clearTimeout(job.watch);
      this._cancelTTS();
      try { job.opts.onStop?.(); } catch { /* ignore */ }
    }
    this.job = null;
    if (clearQueue) {
      const q = this.queue; this.queue = [];
      q.forEach((j) => { j.done = true; try { j.opts.onStop?.(); } catch { /* ignore */ } });
    }
  }

  _start(job) {
    clearTimeout(this.lingerT);
    this.job = job;
    this._emit({ paused: false, key: job.key });
    this._step(job);
  }

  _restartSentence() {
    const job = this.job;
    if (!job || job.done || this.state.paused) return;
    this.gen += 1;
    clearTimeout(job.timer); clearTimeout(job.watch);
    this._cancelTTS();
    this._step(job);
  }

  _step(job) {
    if (this.job !== job || job.done || this.state.paused) return;
    if (job.i >= job.items.length) { this._finish(job); return; }
    const it = job.items[job.i];
    const g = ++this.gen;
    this.t0 = now();
    this._emit({ caption: it.caption || null, speaking: true });
    try { job.opts.onProgress?.({ i: job.i, n: job.items.length, item: it }); } catch { /* ignore */ }
    const next = () => {
      if (g !== this.gen || this.job !== job) return;
      clearTimeout(job.timer); clearTimeout(job.watch);
      job.i += 1;
      this._step(job);
    };
    if (this._canSpeak() && !job.silent) this._utter(job, it, g, next);
    else job.timer = setTimeout(next, estimateMs(it.spoken));
  }

  _utter(job, it, g, next) {
    const s = window.speechSynthesis;
    let u;
    try { u = new window.SpeechSynthesisUtterance(it.spoken); } catch { job.timer = setTimeout(next, estimateMs(it.spoken)); return; }
    u.voice = this.voice; u.lang = (this.voice && this.voice.lang) || 'ro-RO';
    u.rate = 1.05; u.pitch = 1; u.volume = 1;
    let started = false;
    u.onstart = () => { if (g !== this.gen) return; started = true; this.everStarted = true; this.t0 = now(); this.failures = 0; };
    u.onend = () => { if (g === this.gen) next(); };
    u.onerror = (e) => {
      if (g !== this.gen) return;                                // am oprit-o noi
      if (e && e.error === 'not-allowed') { this._blocked(job, g, next); return; }
      next();                                                    // altă eroare: mergem mai departe
    };
    job.utter = u;                     // referință păstrată (Chrome „uită" altfel evenimentele)
    const go = () => {
      if (g !== this.gen) return;
      try { s.resume(); s.speak(u); } catch { this._blocked(job, g, next); }
    };
    // Chrome: speak() imediat după cancel() se pierde uneori — lăsăm o clipă
    const since = now() - this.cancelAt;
    if (since < 180) setTimeout(go, 180 - since); else go();
    // n-a pornit în câteva secunde: vocea e blocată (fără gest) sau nu merge.
    // Prima rostire a sistemului pornește greu (Windows: câteva secunde) → o
    // așteptăm mai mult; dacă motorul zice că vorbește, îi mai dăm o șansă.
    const wait = this.everStarted ? 4000 : 7000;
    const watch = (extra) => {
      job.watch = setTimeout(() => {
        if (g !== this.gen || started) return;
        let busy = false;
        try { busy = !!s.speaking; } catch { /* ignore */ }
        if (busy && extra) { watch(false); return; }
        this._blocked(job, g, next);
      }, extra ? wait : 3000);
    };
    watch(true);
  }

  // Vocea nu pornește. Propoziția merge mai departe în subtitrare; dacă pagina
  // n-a primit încă un gest, cerem unul („🔊 Pornește sunetul"); dacă a primit
  // și tot nu merge, renunțăm la voce (subtitrările rămân).
  _blocked(job, g, next) {
    if (g !== this.gen) return;
    this._cancelTTS();
    const ua = typeof navigator !== 'undefined' ? navigator.userActivation : null;
    if (ua && ua.hasBeenActive) this.failures += 1;
    if (this.failures >= 2) { this.broken = true; this._emit({ voice: 'nu-porneste' }); }
    else this._emit({ needsTap: true });
    this.t0 = now();
    clearTimeout(job.timer);
    job.timer = setTimeout(next, estimateMs(job.items[job.i] && job.items[job.i].spoken));
  }

  _finish(job) {
    job.done = true;
    clearTimeout(job.timer); clearTimeout(job.watch);
    this.job = null;
    this._emit({ speaking: false });
    try { job.opts.onEnd?.(); } catch { /* ignore */ }
    if (this.job) return;                                   // onEnd a pornit deja altă replică
    const nxt = this.queue.shift();
    if (nxt) { this._start(nxt); return; }
    this._emit({ key: null });
    const linger = job.opts.linger ?? 1800;
    clearTimeout(this.lingerT);
    this.lingerT = setTimeout(() => { if (!this.job) this._emit({ caption: null }); }, linger);
  }
}

// Un singur glas pentru toată pagina (starea lui, în React: useProf din
// src/components/live/ProfCamera.jsx)
export const prof = new Speaker();
if (typeof window !== 'undefined' && import.meta.env && import.meta.env.DEV) window.__prof = prof;

export { Speaker };
