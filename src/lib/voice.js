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

// Alegerea vocii, în ordinea asta:
//   1. o voce ROMÂNEASCĂ instalată în sistem (ideal);
//   2. altă limbă ROMANICĂ — italiană, spaniolă, portugheză, franceză: citesc
//      româna mult mai inteligibil decât engleza (aceleași vocale curate);
//   3. vocea implicită a sistemului, orice ar fi ea.
// Pasul 2–3 contează: pe multe calculatoare cu Windows nu e instalată nicio
// voce românească, iar până acum lăsam `lang = 'ro-RO'` fără voce — motorul nu
// avea ce rosti și nu se auzea NIMIC, fără nicio eroare.
const ROMANCE = /^(it|es|pt|ca|gl|fr)(-|_|$)/i;

export function pickVoice() {
  const voices = (ttsSupported() && window.speechSynthesis.getVoices()) || [];
  if (!voices.length) return { voice: null, lang: 'ro-RO', female: false, fallback: 'niciuna' };

  const ro = voices.filter((v) => /ro(-|_)?RO/i.test(v.lang) || /romanian|română/i.test(v.name));
  if (ro.length) {
    const male = ro.find((v) => MALE_HINTS.test(v.name));
    if (male) return { voice: male, lang: male.lang || 'ro-RO', female: false, fallback: null };
    const neutral = ro.find((v) => !FEMALE_HINTS.test(v.name));
    const v = neutral || ro[0];
    return { voice: v, lang: v.lang || 'ro-RO', female: !neutral, fallback: null };
  }

  const romanic = voices.find((v) => ROMANCE.test(v.lang));
  if (romanic) return { voice: romanic, lang: romanic.lang, female: FEMALE_HINTS.test(romanic.name), fallback: 'romanica' };

  const def = voices.find((v) => v.default) || voices[0];
  return { voice: def, lang: def.lang, female: FEMALE_HINTS.test(def.name), fallback: 'implicita' };
}

// De ce nu se aude (pentru mesajul arătat elevului). null = totul e în regulă.
export function ttsProblem() {
  if (!ttsSupported()) return 'Browserul acesta nu știe să citească cu voce tare.';
  const voices = window.speechSynthesis.getVoices() || [];
  if (!voices.length) return 'Nu e instalată nicio voce în sistem, așa că nu am ce folosi ca să citesc.';
  return null;
}

// Profil „narator de documentar": ton grav, ritm calm și așezat.
const NARRATOR = { rate: 0.95, pitch: 0.7 };
const FEMALE_DEEPEN = 0.3; // dacă sistemul are doar voce feminină, o coborâm mult

// De ce NU punem „pastila" periodică `pause(); resume()` de prin forumuri:
// se dă ca leac pentru bugul Chrome care taie rostirile de peste ~15 secunde.
// Măsurat aici (Chrome, Windows): o rostire de 21 de secunde ajunge întreagă
// la capăt, iar noi oricum citim PROPOZIȚIE cu propoziție (câteva secunde
// fiecare), deci pragul nu poate fi atins. Un pause/resume la mijlocul vorbirii
// ar aduce doar sughițuri, fără să rezolve nimic.

// Se cheamă din chiar apăsarea butonului (sincron), înainte de orice await:
// deblochează sinteza pe browserele care cer un gest al utilizatorului și
// scoate motorul dintr-o eventuală stare „pauză" rămasă agățată — o cauză
// clasică de „nu se mai aude nimic, orice aș apăsa".
export function unlockSpeech() {
  if (!ttsSupported()) return;
  try { window.speechSynthesis.resume(); } catch { /* ignore */ }
  ensureVoices();
}

export function speak(text, { lang, onEnd, rate, pitch } = {}) {
  if (!ttsSupported()) { onEnd?.(); return; }
  const synth = window.speechSynthesis;
  const say = () => {
    const spoken = speakableText(text);
    if (!spoken) { onEnd?.(); return; }
    const u = new SpeechSynthesisUtterance(spoken);
    const { voice, lang: vlang, female } = pickVoice();
    if (voice) u.voice = voice;
    // limba trebuie să fie a VOCII alese, nu 'ro-RO' pe o voce care nu există:
    // altfel motorul primește o limbă fără voce și tace.
    u.lang = lang || vlang || 'ro-RO';
    u.rate = rate ?? NARRATOR.rate;
    u.pitch = pitch ?? (female ? FEMALE_DEEPEN : NARRATOR.pitch);
    const done = () => { onEnd?.(); };
    u.onend = done;
    u.onerror = done;
    try { synth.resume(); } catch { /* ignore */ }
    synth.speak(u);
  };
  // `cancel()` urmat IMEDIAT de `speak()` blochează coada în Chrome: rostirea
  // nouă nu mai pornește niciodată. Anulăm doar dacă chiar vorbește ceva și
  // lăsăm o clipă între ele.
  if (synth.speaking || synth.pending) { synth.cancel(); setTimeout(say, 60); }
  else say();
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

// ─── Player pentru un răspuns întreg (vocile instalate în sistem) ────────────
// Citește propoziție cu propoziție, ca pauza, derularea și evidențierea din
// text să fie exacte. API: { pause, resume, seek(frac), stop, paused }.
// onProgress({ frac, sent, total }); onEnd() la final.
//
// Un singur player poate vorbi la un moment dat: fiecare redare nouă
// invalidează redările anterioare (altfel vocile se suprapun la apăsări dese).
let PLAY_TOKEN = 0;

export function playAnswer(text, { onProgress, onEnd, onSilent } = {}) {
  const sents = sentencesOf(text).map((s) => s.text).filter((t) => t.trim());
  if (!sents.length) { onEnd?.(); return null; }

  const token = ++PLAY_TOKEN;
  const st = { i: 0, gen: 0, paused: false, dead: false };
  const mine = () => token === PLAY_TOKEN && !st.dead;
  stopSpeaking(); // taie orice se aude acum

  const step = () => {
    if (!mine()) return;
    while (st.i < sents.length && !sents[st.i].trim()) st.i++;
    if (st.i >= sents.length) { st.dead = true; onEnd?.(); return; }
    onProgress?.({ frac: (st.i + 1) / sents.length, sent: st.i, total: sents.length });
    const g = ++st.gen;
    speak(sents[st.i], { onEnd: () => { if (mine() && !st.paused && st.gen === g) { st.i++; step(); } } });
  };
  // pe mobil lista de voci se încarcă asincron — o așteptăm o singură dată
  ensureVoices().then(() => {
    if (!mine()) return;
    if (!(window.speechSynthesis.getVoices() || []).length) {
      // nicio voce în sistem: spunem pe față, nu lăsăm interfața să pretindă
      st.dead = true;
      onSilent?.(ttsProblem() || 'Nu am găsit nicio voce de folosit.');
      onEnd?.();
      return;
    }
    step();
    // dacă în 4 secunde nu s-a auzit nimic, rostirea nu a pornit
    setTimeout(() => {
      if (!mine() || st.paused) return;
      let talking = false;
      try { talking = !!(window.speechSynthesis.speaking || window.speechSynthesis.pending); } catch { /* ignore */ }
      if (!talking && st.i === 0) onSilent?.('Vocea nu pornește în acest browser.');
    }, 4000);
  });

  return {
    get paused() { return st.paused; },
    pause() { st.paused = true; st.gen++; stopSpeaking(); },
    resume() { if (st.paused && mine()) { st.paused = false; step(); } },
    seek(frac) {
      if (!mine()) return;
      st.gen++; st.paused = false;
      st.i = Math.max(0, Math.min(sents.length - 1, Math.floor(frac * sents.length)));
      stopSpeaking(); step();
    },
    stop() { st.dead = true; st.gen++; if (token === PLAY_TOKEN) stopSpeaking(); },
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
