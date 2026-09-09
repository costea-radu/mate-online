// =====================================================================
// src/lib/testVariante.js — UN test → mai multe VARIANTE ale lui
//
// Profesorul generează un singur test, iar elevii primesc „variante": exact
// aceleași probleme, dar
//   • în ALTĂ ORDINE — problema de la punctul 1 la o variantă poate fi la
//     punctul 4 la alta;
//   • cu ALTĂ VARIANTĂ CORECTĂ la grilă — o problemă cu răspunsul corect a)
//     are, la alt test, răspunsul corect b), c) sau d).
// Așa nu se mai poate copia de la coleg, deși toți dau „același" test.
//
// Formatul întrebărilor e cel din generator (api/ai-generate-interactive.js):
//   { statement, options?: string[], answer: number|string, explanation? }
//   - cu `options` → grilă, `answer` = indexul variantei corecte (0..n-1)
//   - fără `options` → răspuns liber, `answer` = textul corect
//
// Folosit de: src/components/VariantGenerator.jsx („Test pe grupă").
// =====================================================================

// generator pseudo-aleator cu sămânță — aceeași sămânță dă aceeași variantă
// (mulberry32); avem nevoie de el ca variantele să fie stabile și diferite
// între ele, nu doar „aleatoare".
export function rngFrom(seed) {
  let a = (seed >>> 0) || 1;
  return function next() {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Fisher–Yates cu generatorul de mai sus (nu modifică lista primită)
function shuffled(list, rnd) {
  const a = [...list];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

const LITERE = 'abcdefghij';
// variante care trebuie să rămână ULTIMELE, oricât amestecăm („toate cele de
// mai sus", „niciuna dintre variante") — altfel enunțul devine fals.
const FIXA_LA_FINAL = /^\s*[(\[]?\s*(toate|niciun|nici\s*un|niciuna|nici\s*una|nimic|alt[ăa]\s*variant|nu\s*se\s*poate)/i;

const isGrila = (q) => Array.isArray(q?.options) && q.options.length > 1;
const idxCorect = (q) => {
  const n = Number(q?.answer);
  return Number.isInteger(n) && n >= 0 && n < q.options.length ? n : 0;
};

// Explicația poate trimite la literă („varianta b"). După amestec litera se
// schimbă, așa că o rescriem — doar acolo unde e limpede că e o literă de
// variantă, nu o notație matematică.
function rescrieLitere(text, harta) {
  if (!text || !harta.size) return text || '';
  return String(text).replace(
    /\b(variantele|varianta|răspunsul|raspunsul|opțiunea|optiunea|litera)(\s+(?:corect[ăa]?|corecte))?(\s*(?:este|e|:|=)?\s*)([(\[]?)([a-j])([)\].,;: ]|$)/gi,
    (m, cuvant, corect, leg, desch, litera, dupa) => {
      const vechi = LITERE.indexOf(litera.toLowerCase());
      const nou = harta.get(vechi);
      if (nou == null) return m;
      return `${cuvant}${corect || ''}${leg}${desch}${LITERE[nou]}${dupa}`;
    },
  );
}

// ── Amestecul variantelor unei singure întrebări grilă ─────────────────────
// Răspunsul corect ajunge la poziția (corect + k + j) % n — adică la fiecare
// variantă a testului aceeași problemă are altă literă corectă; distractorii
// se amestecă între ei, ca varianta să nu semene cu originalul.
function amestecaVariante(q, k, j, rnd) {
  const opts = q.options;
  const corect = idxCorect(q);
  const toate = opts.map((_, i) => i);
  const fixe = toate.filter((i) => FIXA_LA_FINAL.test(String(opts[i] ?? '')));
  const mobile = toate.filter((i) => !fixe.includes(i));

  let ordine;
  if (fixe.includes(corect) || mobile.length < 2) {
    ordine = [...shuffled(mobile, rnd), ...fixe];
  } else {
    const rest = shuffled(mobile.filter((i) => i !== corect), rnd);
    const tinta = (corect + k + j) % (rest.length + 1);
    rest.splice(tinta, 0, corect);
    ordine = [...rest, ...fixe];
  }

  const harta = new Map(ordine.map((vechi, nou) => [vechi, nou]));
  return {
    ...q,
    options: ordine.map((i) => opts[i]),
    answer: ordine.indexOf(corect),
    explanation: rescrieLitere(q.explanation, harta),
  };
}

// „amprenta" unei variante: ordinea itemilor + litera corectă la fiecare —
// două variante cu aceeași amprentă ar fi identice pentru elev.
function amprenta(ordine, intrebari) {
  return `${ordine.join(',')}|${intrebari.map((q) => (isGrila(q) ? q.answer : 'x')).join('')}`;
}

/**
 * Din întrebările unui test face `count` variante diferite între ele.
 * @param {Array} questions întrebările testului (formatul generatorului)
 * @param {number} count câte variante (1..60)
 * @param {object} opts { shuffleItems, shuffleOptions, seed }
 * @returns {Array<{ index, questions, ordine }>}
 */
export function makeVariants(questions, count, opts = {}) {
  const { shuffleItems = true, shuffleOptions = true, seed = 1 } = opts;
  const baza = Array.isArray(questions) ? questions.filter((q) => q && q.statement) : [];
  const n = Math.max(1, Math.min(60, parseInt(count, 10) || 1));
  if (!baza.length) return [];

  const variante = [];
  const vazute = new Set();

  for (let k = 1; k <= n; k++) {
    let ales = null;
    // până la 12 încercări ca varianta să nu iasă identică cu una deja făcută
    for (let incercare = 0; incercare < 12 && !ales; incercare++) {
      const rnd = rngFrom((seed * 7919) + (k * 104729) + (incercare * 15485863) + baza.length);
      const ordine = shuffleItems && baza.length > 1
        ? shuffled(baza.map((_, i) => i), rnd)
        : baza.map((_, i) => i);
      const intrebari = ordine.map((idxVechi) => {
        const q = baza[idxVechi];
        if (!shuffleOptions || !isGrila(q)) return { ...q };
        // `idxVechi` (locul problemei în testul original), nu locul din
        // varianta curentă: așa litera corectă a ACELEIAȘI probleme se rotește
        // sigur de la o variantă la alta (a → b → c → d), nu la întâmplare.
        return amestecaVariante(q, k, idxVechi, rnd);
      });
      const amp = amprenta(ordine, intrebari);
      if (!vazute.has(amp) || incercare === 11) {
        vazute.add(amp);
        ales = { index: k, questions: intrebari, ordine };
      }
    }
    variante.push(ales);
  }
  return variante;
}

// Câte variante CU ADEVĂRAT diferite se pot face din test — se vede în
// interfață, ca profesorul să știe când cere mai multe decât are rost.
export function maxVariante(questions) {
  const baza = Array.isArray(questions) ? questions.filter((q) => q && q.statement) : [];
  if (!baza.length) return 0;
  let f = 1;
  for (let i = 2; i <= Math.min(baza.length, 8); i++) f *= i; // 8! = 40320, destul
  const grile = baza.filter(isGrila).length;
  return Math.min(9999, f * (grile ? 4 : 1));
}

// eticheta unei variante: „Varianta 3"
export const numeVarianta = (titlu, k) => `${(titlu || 'Test').replace(/\s*·\s*Varianta\s*\d+\s*$/i, '')} · Varianta ${k}`;
