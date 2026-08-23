// =====================================================================
// api/_lib/taxonomy.js — TAXONOMIA FIXĂ de capitole și subiecte (Etapa 3: 5.1 + 1.5)
//
// Sursa unică e CURRICULUM din api/_lib/meditatii.js (44 de capitole, cls. 5–12,
// fiecare cu 3–5 subiecte). Aici:
//   · topicsFor(...)        — lista de subiecte (etichete) pentru un capitol / o
//                             categorie → enum-ul din schema întrebărilor generate;
//   · canonicalTopic(free)  — un subiect scris liber de model („ecuatii_gradul_1",
//                             „Ecuații de gradul I") → eticheta din taxonomie (sau
//                             titlul capitolului); aceeași competență = aceeași cheie
//                             în ai_skill_mastery, nu 5 nume diferite;
//   · classify(text, cat)   — capitolul + subiectul unui fragment de text (pentru
//                             ai_knowledge.chapter_id / topic, la indexare).
// Potrivirea e pe cuvinte-cheie fără diacritice, cu rădăcini (stemmer ieftin)
// ponderate după cât de specifice sunt capitolului — ieftină, deterministă, fără model.
// =====================================================================
const { CURRICULUM, EN_RECAP } = require('./meditatii');

const fold = (s) => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/ș|ş/g, 's').replace(/ț|ţ/g, 't');
// cuvinte prea generale ca să separe capitolele
const STOP = new Set(['numere', 'numar', 'numarul', 'numarului', 'operatii', 'operatie', 'probleme', 'problema', 'rezolvarea', 'rezolvare', 'calcul', 'calculul', 'calculati', 'aflati', 'determinati', 'aratati', 'elemente', 'aplicatii', 'proprietati', 'proprietatile', 'notiunea', 'generalitati', 'simple', 'forma', 'formule', 'formulele', 'metode', 'metoda', 'intre', 'dintr', 'unui', 'unei', 'unor', 'pentru', 'doua', 'trei', 'naturale', 'natural', 'reale', 'real', 'punct', 'puncte', 'ale', 'lui']);
// rădăcina unui cuvânt (stemmer ieftin pentru română): fără diacritice, fără
// terminația de plural/articol, trunchiat la 8 litere — „triunghiului" = „triunghi",
// „fracțiile" = „fracții", dar „paralelipiped" ≠ „paralelogram"
const SUFFIXES = ['urile', 'ului', 'ilor', 'elor', 'ile', 'ele', 'uri', 'ul', 'ii', 'ei', 'ea', 'a', 'e', 'i', 'u'];
function stem(w) {
  let t = fold(w).replace(/[^a-z0-9]/g, '');
  for (const suf of SUFFIXES) { if (t.length - suf.length >= 3 && t.endsWith(suf)) { t = t.slice(0, -suf.length); break; } }
  if (t.length >= 5 && /[aeiu]$/.test(t)) t = t.slice(0, -1); // „triunghi"/„triunghiului" → „triungh"
  return t.slice(0, 8);
}
// cuvinte-cheie SUPLIMENTARE per capitol (nu apar în titluri/subiecte, dar apar
// în enunțuri) — doar pentru clasificare, nu se afișează nicăieri
const EXTRA_KEYS = {
  'c5-naturale': 'ordinea parantezelor putere exponent înmulțire împărțire scădere adunare',
  'c5-divizibilitate': 'divizor multiplu prim rest împărțire divizibil',
  'c5-metode': 'reducere unitate comparație figurativă',
  'c5-fractii-ordinare': 'ireductibilă numitor numărător echivalente fracție',
  'c5-fractii-zecimale': 'virgulă zecimal zecimală medie aritmetică',
  'c5-geometrie': 'segment dreaptă unghi lungime perimetru',
  'c6-multimi': 'mulțime element cmmdc cmmmc descompunere factori primi',
  'c6-rapoarte': 'procent raport proporție sută scară proporțional',
  'c6-intregi': 'întreg negativ temperatură opus',
  'c6-rationale': 'rațional',
  'c6-geometrie-drepte': 'unghi bisectoare paralele secantă perpendiculare adiacente complementare suplementare',
  'c6-triunghi': 'triunghi isoscel echilateral mediană înălțime bisectoare congruent perimetru',
  'c7-reale': 'radical rădăcină raționalizare radicali',
  'c7-ecuatii': 'ecuație necunoscută sistem ecuații liniare',
  'c7-date': 'probabilitate grafic medie axe coordonate',
  'c7-patrulatere': 'dreptunghi pătrat romb trapez paralelogram perimetru arie diagonală',
  'c7-asemanare': 'thales asemenea asemănare raport',
  'c7-metrice': 'ipotenuză catetă pitagora înălțime sinus cosinus tangentă',
  'c7-cerc': 'cerc rază diametru coardă arc tangentă disc',
  'c8-intervale': 'interval modul inecuație',
  'c8-calcul-algebric': 'descompunere factor expresie formule prescurtat',
  'c8-functii': 'grafic funcție f(x) liniară axe intersecție',
  'c8-spatiu-drepte': 'plan perpendiculare diedru spațiu',
  'c8-corpuri': 'paralelipiped volum cub piramidă con cilindru sferă trunchi prismă arie laterală totală muchie',
  'c9-logica-multimi': 'inducție propoziție mulțime',
  'c9-siruri': 'progresie rație termen sumă',
  'c9-functii-gr1': 'funcție gradul inecuație semn',
  'c9-functia-gr2': 'parabolă discriminant viète vârf',
  'c9-vectori': 'vector coliniari',
  'c9-trigonometrie': 'sinus cosinus tangentă trigonometric',
  'c10-puteri-radicali': 'logaritm exponențială putere radical',
  'c10-functii': 'injectivă surjectivă bijectivă inversă compunere',
  'c10-complexe': 'complex imaginar conjugat modul',
  'c10-numarare': 'combinări permutări aranjamente newton binom',
  'c10-finante': 'dobândă tva procent statistică',
  'c10-geometrie-analitica': 'dreapta pantă coordonate ecuația dreptei',
  'c11-matrice': 'matrice determinant inversă rang',
  'c11-sisteme': 'cramer gauss sistem compatibil',
  'c11-limite-siruri': 'limită convergent șir',
  'c11-limite-functii': 'asimptotă continuă limită',
  'c11-derivate': 'derivată tangentă derivabil',
  'c11-grafic': 'monotonie extrem convex inflexiune',
  'c12-grupuri': 'grup lege compoziție morfism inel corp',
  'c12-polinoame': 'polinom rădăcini rest bézout',
  'c12-primitive': 'primitivă integrală nedefinită',
  'c12-integrala': 'integrală definită leibniz newton',
  'c12-aplicatii': 'arie volum rotație integrală',
};
// „gradul I" / „gradul al II-lea" / „gradul 2" → cuvinte distincte (cifrele și
// numeralele romane scurte s-ar pierde la tokenizare)
const gradeWords = (t) => String(t || '')
  .replace(/_/g, ' ')
  .replace(/grad(?:ul|ului|e)?\s*(?:al\s*)?(?:ii|2|doi|doilea)(?:\s*-?\s*lea)?\b/gi, ' graddoi ')
  .replace(/grad(?:ul|ului|e)?\s*(?:al\s*)?(?:i|1|intai|întâi|unu)\b/gi, ' gradunu ');
const tokens = (text) => [...new Set(fold(gradeWords(text)).split(/[^a-z0-9]+/).filter((w) => w.length >= 4 && !STOP.has(w)).map(stem).filter((w) => w.length >= 3))];

// ── indexul capitolelor ──────────────────────────────────────────────────────
const CHAPTERS = [];
for (const grade of Object.keys(CURRICULUM)) {
  for (const ch of CURRICULUM[grade]) {
    CHAPTERS.push({
      id: ch.id, grade: Number(grade), title: ch.title, topics: ch.topics.slice(),
      keys: new Set(tokens(`${ch.title} ${ch.topics.join(' ')} ${EXTRA_KEYS[ch.id] || ''}`)),
      topicKeys: ch.topics.map((t) => ({ label: t, keys: new Set(tokens(t)) })),
    });
  }
}
for (const ch of EN_RECAP) {
  CHAPTERS.push({ id: ch.id, grade: 0, title: ch.title, topics: ch.topics.slice(), keys: new Set(tokens(`${ch.title} ${ch.topics.join(' ')}`)), topicKeys: ch.topics.map((t) => ({ label: t, keys: new Set(tokens(t)) })) });
}
const BY_ID = new Map(CHAPTERS.map((c) => [c.id, c]));
const ALL_TOPICS = [...new Set(CHAPTERS.flatMap((c) => c.topics))];
// ponderea unui cuvânt-cheie ÎN CADRUL categoriei: unic unui capitol → 2; în 2
// capitole → 1; comun → 0.5 (calculată o dată per categorie)
const DF_CACHE = new Map();
function weightsFor(category) {
  const key = String(category || '*');
  if (DF_CACHE.has(key)) return DF_CACHE.get(key);
  const df = new Map();
  for (const c of classifyPool(category)) for (const k of c.keys) df.set(k, (df.get(k) || 0) + 1);
  const w = (k) => { const d = df.get(k) || 0; return d <= 1 ? 2 : d === 2 ? 1 : 0.5; };
  DF_CACHE.set(key, w);
  return w;
}

// clasele pe care le acoperă o categorie de conținut
function gradesFor(category) {
  const c = String(category || '');
  if (c === 'evaluare-nationala') return [5, 6, 7, 8, 0];
  if (c === 'bacalaureat') return [9, 10, 11, 12];
  const m = /^clasa-(\d+)$/.exec(c);
  if (m) return [Number(m[1])];
  return null; // toate
}
function chaptersFor(category) {
  const g = gradesFor(category);
  return g ? CHAPTERS.filter((c) => g.includes(c.grade)) : CHAPTERS.filter((c) => c.grade > 0);
}
// la clasificare capitolele de recapitulare (EN) nu participă — dublează cuvintele-cheie
const classifyPool = (category) => chaptersFor(category).filter((c) => c.grade > 0);

// Subiectele (etichete) pentru schema întrebărilor: ale capitolului (dacă e dat)
// + titlul lui ca rezervă; altfel ale capitolelor din categorie.
function topicsFor({ chapterId = null, chapterIds = null, category = null } = {}) {
  const ids = chapterIds && chapterIds.length ? chapterIds : (chapterId ? [chapterId] : null);
  const chs = ids ? ids.map((id) => BY_ID.get(id)).filter(Boolean) : chaptersFor(category);
  const out = [];
  for (const c of chs) { for (const t of c.topics) if (!out.includes(t)) out.push(t); if (!out.includes(c.title)) out.push(c.title); }
  return out.length ? out : ALL_TOPICS.slice();
}

// ── clasificarea unui text: { chapterId, topic, score } | null ───────────────
function classify(text, category = null, { minScore = 1.5 } = {}) {
  const tk = tokens(String(text || '').slice(0, 4000));
  if (!tk.length) return null;
  const weight = weightsFor(category);
  let best = null;
  for (const c of classifyPool(category)) {
    let score = 0;
    for (const t of tk) if (c.keys.has(t)) score += weight(t);
    if (score > (best ? best.score : 0)) best = { chapter: c, score };
  }
  if (!best || best.score < minScore) return null;
  // subiectul din capitol cu cea mai bună suprapunere (altfel titlul capitolului)
  let topic = best.chapter.title, topicScore = 0;
  for (const t of best.chapter.topicKeys) {
    let s = 0;
    for (const w of tk) if (t.keys.has(w)) s++;
    if (s > topicScore) { topicScore = s; topic = t.label; }
  }
  return { chapterId: best.chapter.id, topic, score: best.score };
}

// ── subiectul canonic pentru un text liber al modelului ───────────────────────
// „ecuatii_gradul_1" → „ecuația de gradul I cu o necunoscută"; „Fracții ordinare"
// (titlu de capitol) → rămâne; necunoscut → titlul capitolului dat sau textul
// curățat (fără _, minuscule) ca ultimă soluție.
function canonicalTopic(free, { chapterId = null, category = null } = {}) {
  const raw = String(free || '').replace(/_/g, ' ').trim();
  if (!raw) return chapterId && BY_ID.get(chapterId) ? BY_ID.get(chapterId).title : 'general';
  const f = fold(raw);
  // potrivire exactă (fără diacritice) pe etichete / titluri
  for (const c of CHAPTERS) {
    if (fold(c.title) === f) return c.title;
    for (const t of c.topics) if (fold(t) === f) return t;
  }
  const tk = tokens(raw);
  const pool = chapterId && BY_ID.get(chapterId) ? [BY_ID.get(chapterId)] : chaptersFor(category);
  let best = null;
  for (const c of pool) {
    for (const t of c.topicKeys) {
      let s = 0;
      for (const w of tk) if (t.keys.has(w)) s++;
      const frac = t.keys.size ? s / t.keys.size : 0;
      if (s && (!best || s > best.s || (s === best.s && frac > best.frac))) best = { label: t.label, s, frac };
    }
    let cs = 0;
    for (const w of tk) if (c.keys.has(w)) cs++;
    if (cs && (!best || cs > best.s + 1)) best = { label: c.title, s: cs, frac: 0 };
  }
  if (best && (best.s >= 2 || best.frac >= 0.5 || tk.length === 1)) return best.label;
  if (chapterId && BY_ID.get(chapterId)) return BY_ID.get(chapterId).title;
  return raw.toLowerCase().slice(0, 60);
}

const chapterTitle = (id) => (BY_ID.get(id) ? BY_ID.get(id).title : null);

module.exports = { CHAPTERS, ALL_TOPICS, topicsFor, classify, canonicalTopic, chapterTitle, tokens, fold, gradesFor };
