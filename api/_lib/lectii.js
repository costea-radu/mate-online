// =====================================================================
// api/_lib/lectii.js — BIBLIOTECA DE LECȚII din „Planul meu"
//
// Teoria unui capitol e aceeași pentru toți elevii cu aceeași clasă (sau același
// examen), același nivel și același stil de explicație ales. O generăm O DATĂ,
// cu modelul de generare, o păstrăm și o servim apoi tuturor: cost 0, fără
// așteptare. Păstrarea folosește tabela cheie → valoare a setărilor
// (public.app_settings, supabase/setari_ordine_gratuite.sql), cu cheile
// „lectie:…" și „reexplicare:…" — fără SQL nou. Fără tabelă, totul merge ca
// înainte (lecția se generează la fiecare cerere).
//
// Personalizarea pe elev rămâne, dar se face în cod, fără model: greșeala lui
// cea mai frecventă (calcule, formule, neatenție…) devine o frază SPUSĂ de
// Prof. Tudor la etapa potrivită a lecției ([[SPUNE: …]]).
//
// Reexplicările de la „Nu am înțeles" se refolosesc la fel: o etapă dintr-o
// lecție din bibliotecă are același text la toți elevii, deci și reexplicarea
// ei (încercarea 1, 2 sau 3).
//
// În bibliotecă intră doar o lecție completă (toate etapele), scrisă de modelul
// de generare — nu de modelul de rezervă de peste bugetul zilnic: o lecție
// slabă s-ar fi dus la toți elevii.
//   PLAN_LECTII_REFOLOSITE=0  → biblioteca e oprită (fiecare lecție se generează)
//   PLAN_LECTII_VERSIUNE=2    → toate lecțiile se regenerează (cheile vechi nu se mai citesc)
// =====================================================================
const crypto = require('node:crypto');
const settings = require('./settings');

const enabled = () => process.env.PLAN_LECTII_REFOLOSITE !== '0';
const version = () => String(process.env.PLAN_LECTII_VERSIUNE || '1').replace(/[^\w.-]/g, '').slice(0, 12) || '1';
const sha1 = (s) => crypto.createHash('sha1').update(String(s)).digest('hex');

const LEVELS = ['incepator', 'mediu', 'avansat'];

// Cui i se predă: clasa elevului sau examenul pentru care se pregătește.
// (BAC: același text la toate profilurile — lecția de teorie nu ține de profil.)
function audienceOf(p = {}) {
  const grade = Math.min(12, Math.max(5, parseInt(p.grade, 10) || 8));
  if (p.exam_target === 'evaluare-nationala') {
    return { key: 'en', text: 'un elev care se pregătește pentru Evaluarea Națională' };
  }
  if (p.exam_target && String(p.exam_target).startsWith('bac')) {
    return { key: 'bac', text: 'un elev de liceu care se pregătește pentru Bacalaureat' };
  }
  return { key: `clasa-${grade}`, text: `un elev de clasa a ${grade}-a${grade > 8 ? ' (liceu)' : ''}` };
}

// Varianta de lecție a elevului: cheia din bibliotecă + ce intră în prompt.
// Tot ce schimbă textul lecției intră în cheie (titlul și subiectele
// capitolului, stilul ales, numele profesorului de la tablă).
function variantOf(p = {}, chapter = {}, teacher = '') {
  const audience = audienceOf(p);
  const level = LEVELS.includes(p.level) ? p.level : 'mediu';
  const style = String(p.memory?.styles?.preferred || '').trim().slice(0, 80);
  const topics = (chapter.topics || []).map(String);
  const hash = sha1(JSON.stringify([chapter.title || '', topics, style, teacher])).slice(0, 12);
  const chapterId = String(chapter.id || 'capitol').replace(/[^\w-]/g, '').slice(0, 60);
  const styleNote = [`nivelul elevului: ${level}`, style ? `stilul de explicație care funcționează cel mai bine: ${style}` : '']
    .filter(Boolean).join('; ');
  return {
    key: `lectie:v${version()}:${chapterId}:${audience.key}:${level}:${hash}`,
    audience, level, style, styleNote,
  };
}

// Cheia unei reexplicări: amprenta întregului prompt (orice diferență → altă
// cheie, deci un text trimis altfel de un client nu ajunge la alți elevi).
const simplifyKey = (system, attempt) => `reexplicare:v${version()}:${sha1(`${attempt}|${system}`).slice(0, 32)}`;

async function get(supa, key) {
  if (!enabled() || !key) return null;
  try {
    const r = await settings.readSetting(supa, key);
    const text = r && r.value && typeof r.value.text === 'string' ? r.value.text : '';
    return text.trim() ? text : null;
  } catch { return null; }
}

async function save(supa, key, { text, chapter = null, model = null } = {}) {
  if (!enabled() || !key || !String(text || '').trim()) return false;
  try {
    return await settings.insertSettingIfMissing(supa, key, {
      text: String(text), chapter, model, createdAt: new Date().toISOString(),
    });
  } catch { return false; }
}

// O lecție bună de păstrat: toate etapele obligatorii, de lungime normală.
const STAGES = [/^##\s*Pe scurt/im, /^##\s*No[țt]iunile esen[țt]iale/im, /^##\s*Formulele/im, /^##\s*Exemplu rezolvat/im];
function isComplete(text) {
  const t = String(text || '');
  return t.length >= 600 && t.length <= 20000 && STAGES.every((re) => re.test(t));
}
// o reexplicare: scurtă, dar nu goală
const isGoodSimplify = (text) => { const t = String(text || '').trim(); return t.length >= 80 && t.length <= 6000; };

// ─── Personalizarea, în cod: greșeala cea mai frecventă a elevului ───────────
// O frază spusă de profesor (nu scrisă pe tablă), la etapa unde contează.
const ERROR_SAY = {
  calcul: { stage: /exemplu/i, say: 'La tine, cele mai multe greșeli apar la calcule: urmărește fiecare pas și verifică semnele.' },
  formula: { stage: /formul/i, say: 'Fii atent aici: la formule ai greșit cel mai des. Scrie formula întreagă, apoi înlocuiește.' },
  regula: { stage: /no[țt]iun/i, say: 'Reține bine regulile de aici: la ele ai greșit cel mai des până acum.' },
  concept: { stage: /no[țt]iun/i, say: 'Citește atent definițiile: de la ele pornesc cele mai multe greșeli ale tale.' },
  neatentie: { stage: /exemplu/i, say: 'Multe greșeli de-ale tale vin din grabă: citește enunțul de două ori înainte să calculezi.' },
};
function topError(p = {}) {
  const [k, n] = Object.entries(p.memory?.errorTypes || {})
    .filter(([key]) => ERROR_SAY[key])
    .sort((a, b) => b[1] - a[1])[0] || [];
  return k && n >= 2 ? k : null;
}
function personalize(text, p = {}) {
  const t = String(text || '');
  const k = topError(p);
  if (!k || !t) return t;
  const { stage, say } = ERROR_SAY[k];
  const heads = [...t.matchAll(/^##[^\n]*$/gm)];
  if (!heads.length) return `[[SPUNE: ${say}]]\n${t}`;
  const h = heads.find((m) => stage.test(m[0])) || heads[0];
  const at = h.index + h[0].length;
  return `${t.slice(0, at)}\n[[SPUNE: ${say}]]${t.slice(at)}`;
}

module.exports = {
  enabled, version, audienceOf, variantOf, simplifyKey, get, save,
  isComplete, isGoodSimplify, personalize, topError, ERROR_SAY,
};
