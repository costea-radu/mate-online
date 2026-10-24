// =====================================================================
// api/_lib/tts.js — VOCEA profesorilor virtuali (meditațiile live)
//
// Vocea se generează o singură dată, pe server, și se păstrează în Storage:
// toți elevii dintr-o ședință aud exact același fișier, în același moment.
//
// Furnizori (în ordinea preferinței):
//   · Azure Speech — voci native românești (ro-RO-EmilNeural, ro-RO-AlinaNeural);
//     AZURE_SPEECH_KEY + AZURE_SPEECH_REGION (ex. westeurope). Recomandat:
//     accent românesc perfect; 0,5 milioane de caractere gratuite pe lună.
//   · OpenAI (gpt-4o-mini-tts) — merge cu cheia OpenAI existentă
//     (LIVE_TTS_API_KEY / OPENAI_API_KEY); română bună, cu ușor accent.
//   LIVE_TTS=azure|openai forțează unul dintre ei.
// REZERVELE (24 oct. 2026 — până atunci, la prima problemă, lecția trecea pe vocea
// browserului): o eroare trecătoare (limita pe minut, serverul ocupat, rețeaua) se
// reîncearcă; apoi, la OpenAI, alt model (tts-1, aceeași voce „ash"); apoi celălalt
// furnizor, dacă are cheie. Vocea browserului rămâne ultima rezervă, doar pentru
// frazele care tot n-au voce.
//
// Lanțul: text rostit → PCM 24 kHz (16 biți, mono) → { durata exactă,
// mișcarea gurii (live.lipFromPcm) } → MP3 48 kbps (ffmpeg-static) → Storage.
// Fără ffmpeg (sau dacă eșuează) se urcă WAV — mai mare, dar merge peste tot.
// =====================================================================
const fs = require('fs');
const { spawn } = require('child_process');
const live = require('./live');

const SR = 24000;
const BUCKET = 'live-media';

const clean = (v) => String(v || '').trim().replace(/^["']|["']$/g, '').trim();
const AZ_KEY = () => clean(process.env.AZURE_SPEECH_KEY);
const AZ_REGION = () => clean(process.env.AZURE_SPEECH_REGION);
const OA_KEY = () => clean(process.env.LIVE_TTS_API_KEY || process.env.OPENAI_API_KEY);
const OA_BASE = () => clean(process.env.LIVE_TTS_BASE_URL) || 'https://api.openai.com/v1';
const OA_MODEL = () => clean(process.env.LIVE_TTS_MODEL) || 'gpt-4o-mini-tts';
// modelul de rezervă al OpenAI, când primul nu merge: tts-1 (mai vechi, aceeași voce);
// LIVE_TTS_MODEL_REZERVA îl schimbă, „fara" îl oprește
const OA_BACKUP = () => {
  const v = clean(process.env.LIVE_TTS_MODEL_REZERVA);
  if (/^(0|nu|fara|fără|none|off|false)$/i.test(v)) return null;
  const m = v || 'tts-1';
  return m === OA_MODEL() ? null : m;
};
// pauza dinaintea unei reîncercări (apoi dublu; „Retry-After" de la furnizor are întâietate)
const PAUSE_MS = () => Math.max(0, parseInt(process.env.LIVE_TTS_PAUZA_MS || '1500', 10) || 0);
const TRIES = 3;

function provider() {
  const forced = clean(process.env.LIVE_TTS).toLowerCase();
  if (forced === 'none' || forced === 'fara') return null;
  if (forced === 'azure') return AZ_KEY() && AZ_REGION() ? 'azure' : null;
  if (forced === 'openai') return OA_KEY() ? 'openai' : null;
  if (AZ_KEY() && AZ_REGION()) return 'azure';
  if (OA_KEY()) return 'openai';
  return null;
}
const available = () => !!provider();

// ─── Textul rostit: fără LaTeX, fără simboluri (plasă de siguranță) ──────────
// Modelul scrie deja „say" ca vorbire; aici prindem ce a scăpat.
function speakable(text) {
  // caracterele de control (ex. o comandă LaTeX „mâncată" de JSON: „\frac" → ␌rac) nu au
  // ce căuta în voce: Azure respinge SSML-ul cu ele (XML invalid → 400), iar vocea eșua
  let t = String(text || '').replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, ' ');
  t = t.replace(/\[([^\]\n]+)\]\(([^)]*)\)/g, '$1')
    .replace(/\*\*(.+?)\*\*/g, '$1').replace(/`([^`]+)`/g, '$1');
  for (let i = 0; i < 4; i++) {
    t = t.replace(/\\[dt]?frac\{([^{}]+)\}\{([^{}]+)\}/g, ' $1 supra $2 ')
      .replace(/\\sqrt\[3\]\{([^{}]+)\}/g, ' radical de ordinul trei din $1 ')
      .replace(/\\sqrt\{([^{}]+)\}/g, ' radical din $1 ');
  }
  t = t
    .replace(/\$\$?/g, ' ')
    .replace(/\\sqrt\s*(\d+)/g, ' radical din $1 ')
    .replace(/√\s*\(([^()]+)\)/g, ' radical din $1 ').replace(/√\s*(\w+)/g, ' radical din $1 ')
    .replace(/\^\{?2\}?|²/g, ' la pătrat ').replace(/\^\{?3\}?|³/g, ' la cub ')
    .replace(/\^\{?(-?[0-9a-z]+)\}?/gi, ' la puterea $1 ')
    .replace(/_\{?([0-9a-z]+)\}?/gi, ' $1 ')
    .replace(/\\cdot|\\times|·|×/g, ' ori ').replace(/\\div|÷/g, ' împărțit la ')
    .replace(/\\pm|±/g, ' plus sau minus ')
    .replace(/\\leq?|≤/g, ' mai mic sau egal cu ').replace(/\\geq?|≥/g, ' mai mare sau egal cu ')
    .replace(/\\neq|≠/g, ' diferit de ').replace(/\\approx|≈/g, ' aproximativ ')
    .replace(/\\pi|π/g, ' pi ').replace(/\\infty|∞/g, ' infinit ').replace(/\\Delta|Δ/g, ' delta ')
    .replace(/\\alpha/g, ' alfa ').replace(/\\beta/g, ' beta ').replace(/\\angle|∢/g, ' unghiul ')
    .replace(/\\in\b|∈/g, ' aparține lui ').replace(/\\mathbb\{R\}/g, ' R ').replace(/\\mathbb\{N\}/g, ' N ')
    .replace(/\\overline\{([^{}]+)\}/g, ' $1 ').replace(/\\text\{([^{}]*)\}/g, ' $1 ')
    .replace(/\\left|\\right/g, '').replace(/\\[a-zA-Z]+/g, ' ')
    .replace(/[{}]/g, ' ')
    .replace(/(\d)\s*=\s*(\d)/g, '$1 egal $2').replace(/\s=\s/g, ' egal ')
    .replace(/\s\+\s/g, ' plus ').replace(/(\s)-(\s)/g, ' minus ')
    .replace(/(\d)\s*\/\s*(\d)/g, '$1 supra $2')
    .replace(/[#>*_|]/g, ' ');
  return t.replace(/\s+/g, ' ').trim();
}

// ─── Furnizorii ──────────────────────────────────────────────────────────────
const xmlEsc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;');

// eroarea unui furnizor, cu codul HTTP, „Retry-After" și dacă e cota / creditul contului
async function ttsError(label, r) {
  const text = (await r.text().catch(() => '')).slice(0, 400);
  const e = new Error(`${label} ${r.status}: ${text.slice(0, 200)}`);
  e.status = r.status;
  const after = Number(r.headers?.get?.('retry-after'));
  if (after > 0) e.retryAfter = after;
  if (/insufficient_quota|exceeded your current quota|billing/i.test(text)) e.quota = true;
  return e;
}
// merită reîncercată: limita pe minut (429, nu cota), o eroare a serverului, timpul depășit, rețeaua
const transient = (e) => (e && e.status === 429 ? !e.quota
  : (e && e.status >= 500) || /timeout|timed out|aborted|fetch failed|ECONNRESET|socket hang up|network/i.test(String(e && `${e.name} ${e.message}`)));
const sleep = (ms) => new Promise((res) => setTimeout(res, ms));
async function withRetries(fn) {
  for (let k = 0; ; k++) {
    try { return await fn(); }
    catch (e) {
      if (k + 1 >= TRIES || !transient(e)) throw e;
      await sleep(e.retryAfter ? Math.min(20000, e.retryAfter * 1000) : PAUSE_MS() * (k + 1));
    }
  }
}

async function azurePcm(text, voiceName) {
  const url = `https://${AZ_REGION()}.tts.speech.microsoft.com/cognitiveservices/v1`;
  const rate = clean(process.env.LIVE_TTS_AZURE_RATE) || '-4%';
  const ssml = `<speak version="1.0" xmlns="http://www.w3.org/2001/10/synthesis" xml:lang="ro-RO"><voice name="${xmlEsc(voiceName)}"><prosody rate="${xmlEsc(rate)}">${xmlEsc(text)}</prosody></voice></speak>`;
  const r = await fetch(url, {
    method: 'POST',
    headers: {
      'Ocp-Apim-Subscription-Key': AZ_KEY(),
      'Content-Type': 'application/ssml+xml',
      'X-Microsoft-OutputFormat': 'raw-24khz-16bit-mono-pcm',
      'User-Agent': 'examenmate-live',
    },
    body: ssml,
    signal: AbortSignal.timeout(45000),
  });
  if (!r.ok) throw await ttsError('Azure TTS', r);
  return Buffer.from(await r.arrayBuffer());
}

async function openaiPcm(text, voice, { instructions = null, model = OA_MODEL() } = {}) {
  const body = {
    model,
    voice: voice || 'ash',
    input: text,
    response_format: 'pcm', // 24 kHz, 16 biți, mono, little-endian
  };
  // gpt-4o(-mini)-tts acceptă indicații de pronunție și ton
  if (/gpt-4o/.test(body.model)) {
    body.instructions = instructions || 'Vorbește în limba română, cu pronunție românească nativă și naturală, ca un profesor de matematică într-o oră online: calm, clar, prietenos, cu pauze scurte după fiecare idee. Citește numerele și formulele în română.';
  }
  const r = await fetch(`${OA_BASE()}/audio/speech`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${OA_KEY()}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(60000),
  });
  if (!r.ok) throw await ttsError('OpenAI TTS', r);
  return Buffer.from(await r.arrayBuffer());
}

// Încercările, în ordine: furnizorul ales, apoi — la OpenAI — modelul de rezervă, apoi
// celălalt furnizor (dacă are cheie). [{ provider, model }]
function attempts(p = provider()) {
  if (!p) return [];
  const openai = OA_KEY() ? [{ provider: 'openai', model: OA_MODEL() }, ...(OA_BACKUP() ? [{ provider: 'openai', model: OA_BACKUP() }] : [])] : [];
  const azure = AZ_KEY() && AZ_REGION() ? [{ provider: 'azure', model: 'ro-RO-EmilNeural' }] : [];
  return p === 'azure' ? [...azure, ...openai] : [...openai, ...azure];
}
// pentru Admin: „OpenAI gpt-4o-mini-tts → OpenAI tts-1 → Azure"
const chainLabel = () => attempts().map((a) => (a.provider === 'azure' ? 'Azure' : `OpenAI ${a.model}`)).join(' → ') || null;

// Vocea unui text pentru un profesor → { pcm (Buffer), dur, lip, provider, model, chars }
async function synthesizePcm(text, teacher) {
  const p = provider();
  if (!p) { const e = new Error('Nicio voce configurată (AZURE_SPEECH_KEY sau OPENAI_API_KEY).'); e.code = 'NO_TTS'; throw e; }
  const say = speakable(text).slice(0, 3800);
  if (!say) return null;
  let pcm = null, used = null, last = null;
  const dead = new Set();   // furnizorii cu cheia greșită sau fără credit: alt model al lor n-ar ajuta
  for (const a of attempts(p)) {
    if (dead.has(a.provider)) continue;
    try {
      pcm = await withRetries(() => (a.provider === 'azure'
        ? azurePcm(say, teacher?.voice?.azure || 'ro-RO-EmilNeural')
        : openaiPcm(say, teacher?.voice?.openai, { model: a.model })));
      used = a;
      break;
    } catch (e) {
      last = e;
      if (e.quota || e.status === 401) dead.add(a.provider);
    }
  }
  if (!pcm) throw last;
  if (pcm.length % 2) pcm = pcm.subarray(0, pcm.length - 1);
  const samples = new Int16Array(pcm.buffer, pcm.byteOffset, pcm.length / 2);
  return {
    pcm,
    dur: Math.round(live.pcmDuration(pcm.length, SR) * 1000) / 1000,
    lip: live.lipFromPcm(samples, SR),
    provider: used.provider,
    model: used.model,
    chars: say.length,
  };
}

// Costul estimat (micro-lei): Azure neural ~16 $/1M caractere; gpt-4o-mini-tts
// ~0,015 $/minut de audio. Curs fix din ai.USD_RON (4,6).
function costMicroLei({ provider: p, chars = 0, dur = 0 }, usdRon = 4.6) {
  const usd = p === 'azure' ? (chars / 1e6) * 16 : (dur / 60) * 0.015;
  return Math.round(usd * usdRon * 1e6);
}

// ─── PCM → MP3 (ffmpeg-static) ───────────────────────────────────────────────
function ffmpegPath() {
  try {
    const p = require('ffmpeg-static');
    if (p && fs.existsSync(p)) return p;
  } catch { /* lipsă */ }
  return null;
}

function pcmToMp3(pcm) {
  const bin = ffmpegPath();
  if (!bin) return Promise.resolve(null);
  return new Promise((resolve) => {
    const ff = spawn(bin, ['-hide_banner', '-loglevel', 'error', '-f', 's16le', '-ar', String(SR), '-ac', '1', '-i', 'pipe:0',
      '-codec:a', 'libmp3lame', '-b:a', '48k', '-f', 'mp3', 'pipe:1']);
    const chunks = [];
    let done = false;
    const finish = (v) => { if (!done) { done = true; resolve(v); } };
    const timer = setTimeout(() => { try { ff.kill('SIGKILL'); } catch { /* ignore */ } finish(null); }, 30000);
    ff.stdout.on('data', (c) => chunks.push(c));
    ff.on('error', () => { clearTimeout(timer); finish(null); });
    ff.on('close', (code) => { clearTimeout(timer); finish(code === 0 && chunks.length ? Buffer.concat(chunks) : null); });
    ff.stdin.on('error', () => { /* ffmpeg a închis intrarea */ });
    ff.stdin.end(pcm);
  });
}

// WAV (rezervă fără ffmpeg)
function pcmToWav(pcm) {
  const h = Buffer.alloc(44);
  h.write('RIFF', 0); h.writeUInt32LE(36 + pcm.length, 4); h.write('WAVE', 8);
  h.write('fmt ', 12); h.writeUInt32LE(16, 16); h.writeUInt16LE(1, 20); h.writeUInt16LE(1, 22);
  h.writeUInt32LE(SR, 24); h.writeUInt32LE(SR * 2, 28); h.writeUInt16LE(2, 32); h.writeUInt16LE(16, 34);
  h.write('data', 36); h.writeUInt32LE(pcm.length, 40);
  return Buffer.concat([h, pcm]);
}

// Urcă vocea în Storage și întoarce URL-ul public. `path` fără extensie.
async function uploadVoice(supa, path, pcm) {
  let body = await pcmToMp3(pcm);
  let ext = 'mp3', type = 'audio/mpeg';
  if (!body) { body = pcmToWav(pcm); ext = 'wav'; type = 'audio/wav'; }
  const full = `${path}.${ext}`;
  const { error } = await supa.storage.from(BUCKET).upload(full, body, { contentType: type, upsert: true, cacheControl: '31536000' });
  if (error) throw new Error(`Storage (${BUCKET}): ${error.message} — rulează supabase/meditatii_live.sql (creează bucketul).`);
  const { data } = supa.storage.from(BUCKET).getPublicUrl(full);
  return data.publicUrl;
}

// Tot lanțul pentru un segment: voce → Storage → { url, dur, lip, provider, cost }
async function voiceSegment(supa, { text, teacher, path }) {
  const s = await synthesizePcm(text, teacher);
  if (!s) return null;
  const url = await uploadVoice(supa, path, s.pcm);
  return { url, dur: s.dur, lip: s.lip, provider: s.provider, cost: costMicroLei(s) };
}

module.exports = {
  provider, available, speakable, synthesizePcm, voiceSegment, uploadVoice,
  pcmToMp3, pcmToWav, costMicroLei, ffmpegPath, BUCKET, SR,
  attempts, chainLabel, transient,
};
