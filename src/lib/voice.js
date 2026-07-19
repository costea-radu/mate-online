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

function pickRoVoice() {
  const voices = window.speechSynthesis.getVoices() || [];
  const ro = voices.filter((v) => /ro(-|_)?RO/i.test(v.lang) || /romanian|română/i.test(v.name));
  // profil „narator": preferăm o voce masculină românească, dacă sistemul are una
  return ro.find((v) => /emil|male|masculin|bărbat|barbat/i.test(v.name)) || ro[0] || null;
}

// Profil „narator de documentar": ton mai jos, ritm calm și așezat.
const NARRATOR = { rate: 0.95, pitch: 0.7 };

export function speak(text, { lang = 'ro-RO', onEnd, rate, pitch } = {}) {
  if (!ttsSupported()) { onEnd?.(); return; }
  window.speechSynthesis.cancel();
  const u = new SpeechSynthesisUtterance(speakableText(text));
  u.lang = lang;
  const v = pickRoVoice();
  if (v) u.voice = v;
  u.rate = rate ?? NARRATOR.rate; u.pitch = pitch ?? NARRATOR.pitch;
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
