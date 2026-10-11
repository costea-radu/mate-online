// =====================================================================
// src/lib/live/voceServer.js — VOCEA DE BĂRBAT a lui Prof. Tudor, de pe server
//
// Pe dispozitivele fără o voce românească de bărbat — iPhone, iPad, Mac (Apple
// are doar „Ioana", voce de femeie), Android (de obicei tot de femeie) —
// frazele profesorului se rostesc cu vocea generată pe server (Azure „Emil" /
// OpenAI „ash"): fiecare frază se generează o singură dată, apoi vine din cache
// (api/live.js → voce). Unde browserul are vocea de bărbat (Edge „Emil Online",
// Windows „Andrei"), rămâne ea — gratuită.
//
// Folosit de: vocea din „Planul meu" (vorbire.js), sala live / Pregătirea de
// examen / demo-urile (audio.js), cititul răspunsurilor din widget (lib/voice.js).
// Fără voce pe server (cheie lipsă), după primul răspuns totul rămâne ca înainte.
// (Clientul API se încarcă leneș: modulul ăsta nu trage după el Supabase — îl
// importă direct vocea sălii, a Planului meu și a widgetului.)
// =====================================================================
const api = () => import('./api').then((m) => m.liveApi);

// vocile de bărbat pe care le știm (numele vocii din browser)
export const MALE_VOICE = /emil|andrei|mihai|nicolae|\bmale\b|masculin|b[aă]rbat/i;
export const isMaleVoice = (v) => !!(v && MALE_VOICE.test(String(v.name || '')));

let state = 'necunoscut';             // necunoscut | da | nu (serverul n-are voce configurată)
export const serverVoiceOff = () => state === 'nu';
// browserul nu are voce românească de bărbat → cerem vocea de pe server
export const wantsServerVoice = (browserVoice) => state !== 'nu' && typeof fetch === 'function' && !isMaleVoice(browserVoice);

// ─── URL-ul vocii pentru o frază (cereri grupate câte 4, cache în memorie) ────
const MAX = 600;
const urls = new Map();               // text → Promise<string|null>
let pending = [];
let timer = null;

async function flush() {
  timer = null;
  const items = pending; pending = [];
  for (let i = 0; i < items.length; i += 4) {
    const part = items.slice(i, i + 4);
    try {
      const r = await (await api()).voce(part.map((x) => x.text));
      if (r && r.provider === null) state = 'nu';
      else if (r) state = 'da';
      part.forEach((x, k) => {
        const url = (r && r.voices && r.voices[k] && r.voices[k].url) || null;
        if (!url) urls.delete(x.text);          // altă dată poate merge (ex. după logare)
        x.resolve(url);
      });
    } catch {
      part.forEach((x) => { urls.delete(x.text); x.resolve(null); });
    }
  }
}

export function serverVoiceUrl(text) {
  const t = String(text || '').replace(/\s+/g, ' ').trim().slice(0, MAX);
  if (!t || state === 'nu') return Promise.resolve(null);
  if (urls.has(t)) return urls.get(t);
  const p = new Promise((resolve) => {
    pending.push({ text: t, resolve });
    if (!timer) timer = setTimeout(flush, 30);
  });
  urls.set(t, p);
  if (urls.size > 500) urls.delete(urls.keys().next().value);
  return p;
}
// frazele următoare se cer din timp (cât se aude cea de acum)
export const prefetchVoices = (texts) => { (texts || []).forEach((t) => { if (t) serverVoiceUrl(t); }); };

// ─── Redarea: un singur <audio>, „deblocat" la primul gest (iPhone) ──────────
const SILENT = 'data:audio/wav;base64,UklGRsQAAABXQVZFZm10IBAAAAABAAEAQB8AAEAfAAABAAgAZGF0YaAAAACAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICA';   // 20 ms de liniște
let el = null;
let unlocked = false;
function audioEl() {
  if (!el && typeof window !== 'undefined' && typeof window.Audio === 'function') {
    el = new window.Audio();
    el.preload = 'auto';
  }
  return el;
}
// din gestul elevului (atingere / clic / tastă): iOS lasă apoi <audio>-ul să vorbească singur
export function unlockServerVoice() {
  const a = audioEl();
  if (!a || unlocked) return;
  try {
    a.src = SILENT;
    const p = a.play();
    if (p && typeof p.then === 'function') p.then(() => { unlocked = true; a.pause(); }).catch(() => {});
    else unlocked = true;
  } catch { /* ignore */ }
}
// (deblocarea se face doar din gesturile care pornesc vocea — Planul meu, butonul 🔊
// din widget —, nu la orice atingere pe site: pe iPhone, un <audio> pornit ar opri
// muzica din alte aplicații)

let playGen = 0;
// Redă fraza; întoarce { stop() }. onEnd la sfârșit; onError dacă nu poate porni.
export function playServerVoice(url, { onStart = null, onEnd = null, onError = null, volume = 1 } = {}) {
  const a = audioEl();
  const g = ++playGen;
  const mine = () => g === playGen;
  if (!a) { setTimeout(() => onError?.(new Error('fara-audio')), 0); return { stop() {} }; }
  try { a.pause(); } catch { /* ignore */ }
  a.onended = () => { if (mine()) onEnd?.(); };
  a.onerror = () => { if (mine()) onError?.(new Error('audio')); };
  a.onplaying = () => { if (mine()) onStart?.(); };
  a.volume = Math.max(0, Math.min(1, volume));
  a.src = url;
  try {
    const p = a.play();
    if (p && typeof p.catch === 'function') p.catch((e) => { if (mine()) onError?.(e); });
  } catch (e) { setTimeout(() => { if (mine()) onError?.(e); }, 0); }
  return { stop() { if (mine()) { playGen++; try { a.pause(); } catch { /* ignore */ } } } };
}
export function stopServerVoice() { playGen++; try { el?.pause(); } catch { /* ignore */ } }
