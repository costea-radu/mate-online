// =====================================================================
// src/lib/voice.js — voce: dictare (STT) + citire cu voce tare (TTS)
//   STT principal: Web Speech API (gratuit, în browser). Fallback: înregistrare → /api/ai-transcribe.
//   TTS: speechSynthesis (gratuit, în browser), voce română dacă există.
// =====================================================================

// ─── STT: recunoaștere vocală în browser ─────────────────────────────────────
const SR = typeof window !== 'undefined' && (window.SpeechRecognition || window.webkitSpeechRecognition);
export const speechRecognitionSupported = () => !!SR;

// Pornește dictarea. onResult(text, isFinal). Întoarce { stop }.
export function startDictation({ lang = 'ro-RO', onResult, onError, onEnd } = {}) {
  if (!SR) { onError?.(new Error('Recunoașterea vocală nu e suportată de acest browser.')); return { stop() {} }; }
  const rec = new SR();
  rec.lang = lang;
  rec.interimResults = true;
  rec.continuous = false;
  rec.onresult = (e) => {
    let interim = '', final = '';
    for (let i = e.resultIndex; i < e.results.length; i++) {
      const txt = e.results[i][0].transcript;
      if (e.results[i].isFinal) final += txt; else interim += txt;
    }
    onResult?.(final || interim, !!final);
  };
  rec.onerror = (e) => onError?.(new Error(e.error || 'Eroare la dictare'));
  rec.onend = () => onEnd?.();
  try { rec.start(); } catch (e) { onError?.(e); }
  return { stop() { try { rec.stop(); } catch { /* ignore */ } } };
}

// ─── STT fallback: înregistrare audio (MediaRecorder) ────────────────────────
export async function recordAudio() {
  const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
  const mime = MediaRecorder.isTypeSupported('audio/webm') ? 'audio/webm' : '';
  const rec = new MediaRecorder(stream, mime ? { mimeType: mime } : undefined);
  const chunks = [];
  rec.ondataavailable = (e) => { if (e.data.size > 0) chunks.push(e.data); };
  rec.start();
  return {
    stop: () => new Promise((resolve) => {
      rec.onstop = () => {
        stream.getTracks().forEach((t) => t.stop());
        resolve(new Blob(chunks, { type: rec.mimeType || 'audio/webm' }));
      };
      rec.stop();
    }),
  };
}

export function blobToBase64(blob) {
  return new Promise((resolve, reject) => {
    const fr = new FileReader();
    fr.onload = () => resolve(fr.result);
    fr.onerror = reject;
    fr.readAsDataURL(blob);
  });
}

// ─── TTS: citire cu voce tare ────────────────────────────────────────────────
export const ttsSupported = () => typeof window !== 'undefined' && 'speechSynthesis' in window;

// Numele vocilor din sistem, după gen (variază mult între Windows/Android/iOS)
const MALE_HINTS = /emil|nicolae|andrei|male|masculin|b[ăa]rbat/i;
const FEMALE_HINTS = /ioana|andreea|alina|elena|carmen|maria|femal|feminin|femeie/i;

// Pe mobil, getVoices() e gol la primul apel — așteptăm evenimentul voiceschanged.
let voicesPromise = null;
export function ensureVoices() {
  if (!ttsSupported()) return Promise.resolve([]);
  const list = window.speechSynthesis.getVoices();
  if (list && list.length) return Promise.resolve(list);
  if (voicesPromise) return voicesPromise;
  voicesPromise = new Promise((resolve) => {
    const done = () => resolve(window.speechSynthesis.getVoices() || []);
    try { window.speechSynthesis.addEventListener('voiceschanged', done, { once: true }); } catch { /* ignore */ }
    setTimeout(done, 1200); // plasă de siguranță
  });
  return voicesPromise;
}

function pickRoVoice() {
  const voices = window.speechSynthesis.getVoices() || [];
  const ro = voices.filter((v) => /ro(-|_)?RO/i.test(v.lang) || /romanian|română/i.test(v.name));
  const male = ro.find((v) => MALE_HINTS.test(v.name));
  if (male) return { voice: male, female: false };
  const neutral = ro.find((v) => !FEMALE_HINTS.test(v.name));
  if (neutral) return { voice: neutral, female: false };
  return { voice: ro[0] || null, female: !!ro[0] }; // doar voce feminină în sistem
}

// Profil „narator de documentar": ton grav, ritm calm și așezat.
const NARRATOR = { rate: 0.95, pitch: 0.7 };
const FEMALE_DEEPEN = 0.3; // dacă sistemul are doar voce feminină, o coborâm mult

export function speak(text, { lang = 'ro-RO', onEnd, rate, pitch } = {}) {
  if (!ttsSupported()) { onEnd?.(); return; }
  window.speechSynthesis.cancel();
  const u = new SpeechSynthesisUtterance(speakableText(text));
  u.lang = lang;
  const { voice, female } = pickRoVoice();
  if (voice) u.voice = voice;
  u.rate = rate ?? NARRATOR.rate;
  u.pitch = pitch ?? (female ? FEMALE_DEEPEN : NARRATOR.pitch);
  u.onend = () => onEnd?.();
  u.onerror = () => onEnd?.();
  window.speechSynthesis.speak(u);
}
export function stopSpeaking() { if (ttsSupported()) window.speechSynthesis.cancel(); }
export function pauseSpeaking() { if (ttsSupported()) { try { window.speechSynthesis.pause(); } catch { /* ignore */ } } }
export function resumeSpeaking() { if (ttsSupported()) { try { window.speechSynthesis.resume(); } catch { /* ignore */ } } }

// ─── Împarte un mesaj în „propoziții" (segmente de citit), conștient de LaTeX ─
// Returnează [{ text, p }] unde p = indexul paragrafului. Aceeași împărțire e
// folosită și la afișare (evidențierea părții citite) și la redarea vocală,
// ca să rămână perfect sincronizate.
export function sentencesOf(text = '') {
  const out = [];
  const push = (cur, p) => {
    const t = cur.replace(/^[ \t]+/, '').replace(/\s+$/, '');
    if (t) out.push({ text: t, p });
  };
  String(text).split(/\n{2,}/).forEach((para, p) => {
    let cur = '', inD = false, inS = false; // în $$...$$ / $...$
    for (let i = 0; i < para.length; i++) {
      const ch = para[i];
      if (ch === '$') {
        if (para[i + 1] === '$') { inD = !inD; cur += '$$'; i++; continue; }
        if (!inD) inS = !inS;
      }
      cur += ch;
      if (!inD && !inS && /[.!?…:;]/.test(ch)) {
        const nxt = para[i + 1];
        if (nxt === undefined || /\s/.test(nxt)) {
          push(cur, p); cur = '';
          while (i + 1 < para.length && (para[i + 1] === ' ' || para[i + 1] === '\t')) i++;
        }
      }
    }
    push(cur, p);
  });
  return out;
}

// ─── Player pentru un răspuns întreg ─────────────────────────────────────────
// Glasul vine de pe SERVER (identic pe orice dispozitiv: masculin, grav). Dacă
// serverul nu e disponibil (fără cheie, offline, cotă atinsă), revine automat
// la sinteza din browser. API: { pause, resume, seek(frac), stop, paused }.
//
// onProgress({ frac, sent, total }) — pentru bara de derulare și evidențierea
// propoziției citite; onEnd() la final.
// `audioEl` (opțional): element <audio> creat în handlerul de click, ca iOS să
// permită redarea (politica „user gesture").
export async function playAnswer(text, { onProgress, onEnd, audioEl = null } = {}) {
  const sents = sentencesOf(text).map((s) => s.text).filter((t) => t.trim());
  if (!sents.length) { onEnd?.(); return null; }
  const spoken = sents.map(speakableText).filter(Boolean);

  // 1) Voce de pe server — aceeași pe desktop și pe telefon
  try {
    const { aiClient } = await import('./aiClient');
    const { audioBase64, mime } = await aiClient.tts({ text: spoken.join(' ') });
    if (audioBase64) {
      const bin = atob(audioBase64);
      const arr = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
      const url = URL.createObjectURL(new Blob([arr], { type: mime || 'audio/mpeg' }));
      const ctl = await audioController(url, spoken, { onProgress, onEnd, audioEl });
      if (ctl) return ctl;
    }
  } catch { /* fără voce de server → sinteza din browser */ }

  // 2) Rezervă: sinteza din browser (voce masculină dacă sistemul are una)
  await ensureVoices();
  return synthController(sents, { onProgress, onEnd });
}

// Redare a unui fișier audio; poziția propoziției se estimează din durata
// consumată, proporțional cu lungimea fiecărei propoziții.
async function audioController(url, spoken, { onProgress, onEnd, audioEl }) {
  const audio = audioEl || new Audio();
  audio.src = url;
  audio.preload = 'auto';
  const lens = spoken.map((s) => s.length);
  const total = lens.reduce((a, b) => a + b, 0) || 1;
  const cum = []; lens.reduce((a, l, i) => (cum[i] = a + l), 0);
  const sentAt = (frac) => {
    const pos = frac * total;
    for (let i = 0; i < cum.length; i++) if (pos <= cum[i]) return i;
    return cum.length - 1;
  };
  audio.ontimeupdate = () => {
    const d = audio.duration;
    if (!d || !isFinite(d)) return;
    const frac = Math.min(1, audio.currentTime / d);
    onProgress?.({ frac, sent: sentAt(frac), total: spoken.length });
  };
  audio.onended = () => { URL.revokeObjectURL(url); onEnd?.(); };
  audio.onerror = () => { URL.revokeObjectURL(url); onEnd?.(); };
  try { await audio.play(); } catch { URL.revokeObjectURL(url); return null; } // iOS fără gest → rezervă
  return {
    engine: 'server',
    get paused() { return audio.paused; },
    pause() { audio.pause(); },
    resume() { audio.play().catch(() => {}); },
    seek(frac) {
      const d = audio.duration;
      if (d && isFinite(d)) { audio.currentTime = Math.max(0, Math.min(0.999, frac)) * d; audio.play().catch(() => {}); }
    },
    stop() { try { audio.pause(); } catch { /* ignore */ } audio.src = ''; URL.revokeObjectURL(url); },
  };
}

// Sinteza din browser: citește propoziție cu propoziție (pauza și derularea
// funcționează exact pe propoziții).
function synthController(sents, { onProgress, onEnd }) {
  const st = { i: 0, gen: 0, paused: false, dead: false };
  const step = () => {
    if (st.dead) return;
    while (st.i < sents.length && !sents[st.i].trim()) st.i++;
    if (st.i >= sents.length) { st.dead = true; onEnd?.(); return; }
    onProgress?.({ frac: (st.i + 1) / sents.length, sent: st.i, total: sents.length });
    const g = ++st.gen;
    speak(sents[st.i], { onEnd: () => { if (!st.dead && !st.paused && st.gen === g) { st.i++; step(); } } });
  };
  step();
  return {
    engine: 'browser',
    get paused() { return st.paused; },
    pause() { st.paused = true; st.gen++; stopSpeaking(); },
    resume() { if (st.paused) { st.paused = false; step(); } },
    seek(frac) { st.gen++; st.paused = false; st.i = Math.max(0, Math.min(sents.length - 1, Math.floor(frac * sents.length))); stopSpeaking(); step(); },
    stop() { st.dead = true; st.gen++; stopSpeaking(); },
  };
}

// ─── Transformă LaTeX/markdown în text citibil în română ─────────────────────
export function speakableText(text = '') {
  let t = text;
  // marcaje de acțiune (nu se citesc) + linkuri markdown → doar titlul
  t = t.replace(/\[\[\s*ACTIUNE[\s\S]*?\]\]/gi, ' ');
  t = t.replace(/\[([^\]\n]+)\]\(([^)]*)\)/g, '$1');
  // markdown
  t = t.replace(/\*\*(.+?)\*\*/g, '$1').replace(/`([^`]+)`/g, '$1').replace(/[#>*_]/g, ' ');
  // LaTeX uzual
  t = t
    .replace(/\$\$?/g, ' ')
    .replace(/\\frac\{([^{}]+)\}\{([^{}]+)\}/g, ' $1 supra $2 ')
    .replace(/\\sqrt\{([^{}]+)\}/g, ' radical din $1 ')
    .replace(/\\sqrt/g, ' radical ')
    .replace(/\^\{?2\}?/g, ' la pătrat ')
    .replace(/\^\{?3\}?/g, ' la cub ')
    .replace(/\^\{?([0-9]+)\}?/g, ' la puterea $1 ')
    .replace(/_\{?([0-9]+)\}?/g, ' indice $1 ')
    .replace(/\\times/g, ' ori ').replace(/\\cdot/g, ' ori ')
    .replace(/\\div/g, ' împărțit la ')
    .replace(/\\pm/g, ' plus sau minus ')
    .replace(/\\leq/g, ' mai mic sau egal ').replace(/\\geq/g, ' mai mare sau egal ')
    .replace(/\\neq/g, ' diferit de ').replace(/\\approx/g, ' aproximativ ')
    .replace(/\\pi/g, ' pi ').replace(/\\infty/g, ' infinit ')
    .replace(/\\left|\\right/g, '')
    .replace(/\\[a-zA-Z]+/g, ' ') // alte comenzi rămase
    .replace(/[{}]/g, ' ');
  return t.replace(/\s+/g, ' ').trim();
}
