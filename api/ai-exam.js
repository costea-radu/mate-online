// =====================================================================
// api/ai-exam.js — generează un MODEL de test de examen (structura oficială)
// Body: { userId, examType }
//   examType: 'evaluare-nationala' | 'bac-tehnologic' | 'bac-stiinte' | 'bac-mate-info'
// Răspuns: { exam: {...structură cu subiecte, itemi, punctaje, barem} }
// Doar pentru abonați.
// =====================================================================
const ai = require('./_lib/ai');
const { pdfText, storagePath, modeLine, cutBarem } = require('./_lib/pdftext');

// ── Reparare LaTeX corupt de JSON.parse ──────────────────────────────────────
// Modelele scriu uneori "\frac" cu un singur backslash în JSON. JSON.parse
// transformă \f, \t, \b în caractere de control (form-feed, tab, backspace),
// ceea ce strică formulele ("\frac" → "rac"). Le restaurăm aici.
function restoreLatex(s) {
  if (typeof s !== 'string') return s;
  return s
    .replace(/\f/g, '\\f')       // \frac, \forall, \frown...
    .replace(/\t/g, '\\t')       // \times, \theta, \tan, \to, \text, \triangle...
    .replace(/\u0008/g, '\\b');  // \begin, \binom, \beta...
  // \n și \r le păstrăm (sunt rânduri reale în text)
}
function deepRestore(obj) {
  if (Array.isArray(obj)) return obj.map(deepRestore);
  if (obj && typeof obj === 'object') { const o = {}; for (const k of Object.keys(obj)) o[k] = deepRestore(obj[k]); return o; }
  return restoreLatex(obj);
}
// Parsare tolerantă: dacă JSON.parse eșuează (ex: "\sqrt" — escape invalid),
// dublăm backslash-urile invalide și reîncercăm.
function lenientParse(text) {
  try { return JSON.parse(text); } catch { /* reparăm mai jos */ }
  const repaired = text.replace(/\\(?!["\\/bfnrtu])/g, '\\\\');
  return JSON.parse(repaired);
}

// ── Structura detaliată pentru Evaluare Națională (după cerințe) ──────────────
const EN_SPEC = `Structura testului de Evaluare Națională (EXACT așa):

SUBIECTUL I — ALGEBRĂ — GRILĂ (30 puncte): 6 itemi, fiecare 5 puncte. Itemii 1–5 au 4 variante (a, b, c, d) cu UN SINGUR răspuns corect. Itemul 6 are DOAR 2 variante: „Adevărat" și „Fals".
- I.1: ordinea efectuării operațiilor (adunare, scădere, înmulțire, împărțire).
- I.2: procente, proporții, probabilități.
- I.3: calcule cu numere întregi — ecuații sau probleme cu temperaturi.
- I.4: calcule cu fracții — operații, comparări de fracții ordinare sau zecimale.
- I.5: calcule cu radicali — operații, medie geometrică, intervale.
- I.6: (Adevărat/Fals) enunț cu un grafic/statistică sau o problemă simplă.

SUBIECTUL al II-lea — GEOMETRIE — GRILĂ (30 puncte): 6 itemi, fiecare 5 puncte, cu 4 variante (a, b, c, d), un singur răspuns corect.
- II.1: calcule cu segmente — mijloc, simetric, adunări, scăderi.
- II.2: unghiuri — adiacente, complementare, suplementare, opuse la vârf, în jurul unui punct, formate de două paralele cu o secantă, bisectoare.
- II.3: triunghi — suma măsurilor unghiurilor, unghi exterior, triunghi dreptunghic/isoscel/echilateral, perimetru, arie, linii importante (mediană, mediatoare, înălțime, bisectoare, linie mijlocie), proprietatea „mediana împarte triunghiul în două triunghiuri cu arii egale".
- II.4: patrulatere — suma măsurilor unghiurilor, proprietăți paralelogram/dreptunghi/romb/pătrat/trapez, arii, perimetre, „diagonala paralelogramului îl împarte în două părți cu arii egale".
- II.5: cercul — arie, lungime, unghi cu vârful la centru, unghi cu vârful pe cerc, diametru, rază, coardă, tangentă.
- II.6: corpuri geometrice — cub, prismă, paralelipiped, piramidă, trunchi de piramidă, cilindru, con, trunchi de con, sferă: sumă muchii, arii, volume, diagonala paralelipipedului/cubului.

SUBIECTUL al III-lea — ALGEBRĂ ȘI GEOMETRIE — REZOLVĂRI COMPLETE (30 puncte): 6 probleme, fiecare 5 puncte, fiecare cu două subpuncte a) și b).
- III.1: probleme cu ecuații și sisteme — a) verificare dacă un număr poate face parte din datele problemei; b) rezolvarea problemei.
- III.2: expresii E(x) — a) descompunerea unui numitor scris ca ecuație de gradul 2 cu soluții întregi: a(x−x1)(x−x2); b) rezolvarea expresiei, ecuații E(x)=n, 1/E(x)=n, a/E(x) ∈ ℕ etc.
- III.3: funcții liniare de gradul 1 — a) un calcul de tip f(1)+f(2)=…; b) graficul funcției: distanța de la originea sistemului la grafic, de la un punct de pe Ox la grafic, aria triunghiului format de axa Ox, axa Oy și grafic.
- III.4: geometrie plană 1 (triunghi, paralelogram, dreptunghi, romb, pătrat, trapez, cerc) — a) un calcul simplu (arie, perimetru sau lungime cerc); b) teorema lui Thales / teorema fundamentală a asemănării pentru lungimi de segmente.
- III.5: geometrie plană 2 — a) lungimea unui segment cu teorema lui Pitagora; b) teorema lui Pitagora, teorema înălțimii, teorema catetei, trigonometrie, aria cu sinus.
- III.6: geometrie în spațiu — a) calcul arii/volume/diagonale sau unghiul a două drepte în spațiu; b) distanța de la un punct la o dreaptă (teorema celor trei perpendiculare), de la un punct la un plan (reciproca teoremei celor trei perpendiculare), unghiul a două plane.`;

const EXAMS = {
  'evaluare-nationala': {
    title: 'Evaluare Națională · Matematică',
    category: 'evaluare-nationala',
    durationMin: 120,
    query: 'evaluare națională matematică clasa 8 exercițiu grilă',
    special: 'en',
    // Subcategoriile-sursă din care se COMBINĂ itemii — exact ca rubrica
    // „Simulări + Variante Date (mix)” a agentului Claude.
    sourceSubs: ['simulari', 'variante'],
  },
  'bac-tehnologic': {
    title: 'Bacalaureat · Matematică M_tehnologic',
    category: 'bacalaureat', profile: 'tehnologic', durationMin: 180,
    sourceSubs: ['simulari', 'variante', 'teste-antrenament', 'exercitii'],
    query: 'bacalaureat matematică tehnologic exercițiu',
    programa: 'Programa M_tehnologic (cea mai accesibilă filieră): mulțimi de numere, funcții elementare, progresii, trigonometrie de bază, numere complexe (simplu), geometrie analitică simplă, elemente de analiză (șiruri, limite simple, derivate), matematici financiare, statistică și probabilități.',
    structure: `Structură oficială:
- SUBIECTUL I (30 puncte): 5 itemi cu răspuns scurt/rezolvare succintă, aprox. 5–6 puncte fiecare.
- SUBIECTUL al II-lea (30 puncte): 2 probleme cu subpuncte (a, b, c) — matrice/sisteme și funcții.
- SUBIECTUL al III-lea (30 puncte): 2 probleme cu subpuncte — analiză (șiruri/derivate) și aplicații.`,
  },
  'bac-stiinte': {
    title: 'Bacalaureat · Matematică M_științele-naturii',
    category: 'bacalaureat', profile: 'stiinte-naturii', durationMin: 180,
    sourceSubs: ['simulari', 'variante', 'teste-antrenament', 'exercitii'],
    query: 'bacalaureat matematică științele naturii exercițiu',
    programa: 'Programa M_științe-ale-naturii (nivel intermediar): funcții, progresii, trigonometrie, numere complexe, geometrie analitică, combinatorică și binomul lui Newton, analiză matematică (limite, continuitate, derivate, primitive și integrale — nivel mediu), probabilități.',
    structure: `Structură oficială:
- SUBIECTUL I (30 puncte): 5 itemi cu rezolvare succintă (aprox. 5–6 puncte fiecare).
- SUBIECTUL al II-lea (30 puncte): 2 probleme cu subpuncte (a, b, c) — algebră (matrice/sisteme, funcții).
- SUBIECTUL al III-lea (30 puncte): 2 probleme cu subpuncte — analiză matematică (derivate, integrale).`,
  },
  'bac-mate-info': {
    title: 'Bacalaureat · Matematică M_mate-info',
    category: 'bacalaureat', profile: 'mate-info', durationMin: 180,
    sourceSubs: ['simulari', 'variante', 'teste-antrenament', 'exercitii'],
    query: 'bacalaureat matematică mate-info exercițiu dificil',
    programa: 'Programa M_mate-info (cea mai dificilă filieră): structuri algebrice (grupuri, inele, corpuri), matrice și determinanți, sisteme, polinoame, numere complexe, combinatorică, analiză matematică riguroasă (șiruri, limite, continuitate, derivabilitate, studiul funcțiilor, primitive, integrala definită și aplicații).',
    structure: `Structură oficială:
- SUBIECTUL I (30 puncte): 5 itemi cu rezolvare succintă (aprox. 6 puncte fiecare).
- SUBIECTUL al II-lea (30 puncte): 2 probleme cu subpuncte (a, b, c) — matrice/determinanți, structuri algebrice, polinoame.
- SUBIECTUL al III-lea (30 puncte): 2 probleme cu subpuncte — analiză matematică (studiul unei funcții, integrale).`,
  },
};

const JSON_RULE = `IMPORTANT pentru JSON valid: scrie fiecare backslash din comenzile LaTeX de DOUĂ ori (backslash dublu). Exemple corecte în JSON: pentru fracție folosește \\\\frac{...}{...}, pentru radical \\\\sqrt{...}, pentru înmulțire \\\\cdot, pentru unghi \\\\angle. Formulele se pun între $...$.`;

// ── Specificația figurilor geometrice: AI-ul descrie figura ca obiect JSON,
//    iar clientul o desenează determinist (src/lib/figureRender.js) — figura
//    apare sub enunț, în dreapta paginii, ca în subiectele oficiale. ─────────
const FIGURE_SPEC = `FIGURI GEOMETRICE — cheia "figure" a itemului:
- OBLIGATORIU la TOȚI itemii Subiectului al II-lea (II.1–II.6) și la problemele III.3, III.4, III.5, III.6.
- NU pune "figure" la Subiectul I și nici la problemele III.1 și III.2 (sunt de algebră).
- Figura trebuie să corespundă EXACT enunțului: aceleași litere, același tip de configurație.
- "type" poate fi: segment, unghi, triunghi, patrat, dreptunghi, paralelogram, romb, trapez, cerc, xOy, cub, paralelipiped, prisma, piramida, con, cilindru, sfera, trunchi-con, trunchi-piramida.
- Formatele pe tipuri (folosește DOAR cheile de mai jos):
  · segment: {"type":"segment","labels":["A","B","C","D"]} — punctele de pe dreaptă, în ordine; opțional "pozitii":[0,0.5,0.75,1] (fracții 0..1, câte una pentru fiecare literă).
  · unghi: {"type":"unghi","varf":"O","raze":["A","M","B"]} — semidreptele care pleacă din vârf, în ordinea rotirii (pentru bisectoare pune litera bisectoarei între laturile unghiului).
  · triunghi: {"type":"triunghi","variant":"oarecare|isoscel|echilateral|dreptunghic","labels":["A","B","C"]} — labels[0] = vârful de sus, apoi stânga-jos, dreapta-jos; la "dreptunghic" adaugă "unghi_drept":"B" (litera vârfului cu unghiul drept). Opțional "inaltime":{"din":"A","picior":"D"}.
  · patrat/dreptunghi/paralelogram/romb/trapez: {"type":"...","labels":["A","B","C","D"]} — conturul în ordinea: A=stânga-jos, B=dreapta-jos, C=dreapta-sus, D=stânga-sus. La trapez: "variant":"oarecare|dreptunghic|isoscel" (bazele sunt AB — mare, jos — și DC — mică, sus). Opțional "diagonale":true.
  · Puncte pe laturi (orice poligon): "puncte":[{"label":"M","pe":"BC","la":0.5}] ("la" = fracția de la primul capăt al laturii). Segmente suplimentare între orice puncte etichetate: "segmente":[["A","M"],["B","D"]] (și "segmente_punctate" pentru linii punctate).
  · cerc: {"type":"cerc","centru":"O"} + opțional: "inscris":["A","B","C"] (poligon înscris în cerc), "puncte":[{"label":"D","unghi":250}] (alt punct pe cerc; unghiul în grade, 0=dreapta, sens trigonometric), "raza":"A", "diametru":["A","B"], "coarda":["M","N"], "tangenta":{"la":"A"}, "segmente":[["B","D"]].
  · xOy (grafic de funcție): {"type":"xOy","functie":{"a":2,"b":-4}} pentru f(x)=ax+b + opțional "puncte":[{"label":"A","x":2,"y":0},{"label":"B","x":0,"y":-4}].
  · cub/paralelipiped: {"type":"cub","labels":["A","B","C","D","A'","B'","C'","D'"]} (baza jos, apoi vârfurile de sus) + opțional "segmente":[["A","C'"]] pentru diagonale.
  · prisma: {"type":"prisma","variant":"triunghiulara|patrulatera","labels":["A","B","C","A'","B'","C'"]} (6 sau 8 litere).
  · piramida: {"type":"piramida","variant":"patrulatera|triunghiulara","labels":["V","A","B","C","D"]} — PRIMA literă este vârful. Opțional "inaltime":{"picior":"O"}.
  · con: {"type":"con","labels":["V","A","B"]} + opțional "inaltime":{"picior":"O"}. cilindru: {"type":"cilindru","inaltime":true}. sfera: {"type":"sfera","centru":"O","raza":"A"}. trunchi-con: {"type":"trunchi-con","inaltime":true}. trunchi-piramida: {"type":"trunchi-piramida","labels":["A","B","C","D","A'","B'","C'","D'"]}.
- Exemple complete:
  {"type":"triunghi","variant":"isoscel","labels":["A","B","C"],"puncte":[{"label":"E","pe":"BC","la":0.65}],"segmente":[["A","E"]]}
  {"type":"cerc","centru":"O","inscris":["A","B","C"],"puncte":[{"label":"D","unghi":268}],"segmente":[["B","D"],["D","C"]]}
  {"type":"trapez","variant":"dreptunghic","labels":["A","B","C","D"],"puncte":[{"label":"M","pe":"DC","la":0.5}],"segmente":[["A","M"],["B","D"]]}`;

const FIDELITY = `Fidelitate față de modele:
1) STRUCTURA este LEGE — același număr de subiecte și itemi, aceleași punctaje, aceeași ordine a tipurilor de itemi și același stil de formulare ca în subiectele reale ale site-ului; nu adăuga, nu elimina, nu rearanja.
2) ITEMII SE COPIAZĂ din surse (enunț, tip, structură), conform regimului de lucru cu datele; nu introduce tipuri de itemi care nu apar în surse.
3) IGNORĂ complet secțiunile de BAREM din surse — baremele NU sunt itemi și nu se preiau ca exerciții; folosește-le doar ca referință de punctaj.
4) Folosește „·" (\\cdot) pentru înmulțire, niciodată × sau x. La geometrie include FIGURA descrisă clar în enunț (puncte, laturi, unghiuri, măsuri), ca elevul să o poată desena.
5) Dacă menționezi platforma, adresa este EXACT https://examenmate.com (nu .ro).
6) Enunțurile trebuie să fie complete și autonome (fără „vezi figura din fișier").`;

function buildENSystem(examples) {
  return `${ai.PERSONA}

Sarcină: generează un MODEL COMPLET de test de Evaluare Națională la matematică, ca material de pregătire, respectând EXACT structura de mai jos și conținuturile cerute pentru fiecare item.

${EN_SPEC}

${FIGURE_SPEC}

Reguli:
- ${FIDELITY}
- FIGURA itemilor de geometrie este OBLIGATORIE (cheia "figure", conform specificației de mai sus): la II.1–II.6 și III.3–III.6. Literele din figură trebuie să fie EXACT cele din enunț.
- COPIAZĂ itemii din TESTELE REALE DIN SITE (dacă sunt furnizate) sau din exercițiile-model: păstrează enunțul și structura itemului-sursă, schimbă DOAR numerele/notațiile și recalculează rezultatul și variantele. COMBINĂ sursele: itemul 1 preluat dintr-un test, itemul 2 din ALT test, itemul 3 din altul (ciclic). Creezi un item complet nou NUMAI dacă sursele nu acoperă poziția respectivă.
- SUBIECTUL I este EXCLUSIV de aritmetică și algebră — NICIUN item de geometrie la Subiectul I (fără figuri, segmente, unghiuri, triunghiuri, patrulatere, cerc, arii, perimetre, volume, corpuri geometrice). Geometria apare NUMAI la Subiectul al II-lea și la problemele III.4–III.6. Dacă itemul-sursă indicat pentru o poziție de la Subiectul I este de geometrie, alege în loc un item de algebră.
- La grilă (Subiectele I și II): fiecare item are exact 4 variante (I.6 are 2: „Adevărat"/„Fals"), un singur răspuns corect, iar variantele greșite trebuie să fie plauzibile.
- DISTRIBUIE răspunsul corect aleatoriu între a), b), c) și d) de la un item la altul (NU pune mereu „a" corect). Aproximativ un sfert din itemi să aibă corect pe fiecare literă.
- La Subiectul III: dă rezolvare completă, pas cu pas, pentru fiecare subpunct a) și b).
- Enunțuri clare, corecte matematic. Formulele în LaTeX între $...$.
${JSON_RULE}

=== EXERCIȚII DIN BAZA DE DATE (model) ===
${examples}
=== SFÂRȘIT ===

Răspunde STRICT cu un obiect JSON, fără text în plus:
{
  "title": "Evaluare Națională · Matematică",
  "durationMin": 120,
  "subjects": [
    {
      "label": "SUBIECTUL I", "points": 30,
      "instructions": "Scrieți litera corespunzătoare răspunsului corect. Fiecare item: 5 puncte.",
      "items": [
        { "number": "1", "statement": "enunț cu $LaTeX$", "options": ["$...$", "$...$", "$...$", "$...$"], "answer": "a", "points": 5, "solution": "justificare scurtă" }
      ]
    },
    {
      "label": "SUBIECTUL al II-lea", "points": 30,
      "instructions": "Scrieți litera corespunzătoare răspunsului corect. Fiecare item: 5 puncte.",
      "items": [ { "number": "1", "statement": "...", "options": ["...","...","...","..."], "answer": "b", "points": 5, "solution": "...", "figure": { "type": "segment", "labels": ["A","B","C","D"] } } ]
    },
    {
      "label": "SUBIECTUL al III-lea", "points": 30,
      "instructions": "Scrieți rezolvările complete. Fiecare problemă: 5 puncte.",
      "items": [
        { "number": "1", "statement": "enunțul problemei",
          "parts": [ { "label": "a", "text": "cerința a)", "points": 2, "solution": "rezolvare completă a)" },
                     { "label": "b", "text": "cerința b)", "points": 3, "solution": "rezolvare completă b)" } ],
          "figure": "(DOAR la problemele 3–6, conform specificației figurilor; la 1 și 2 NU pune cheia)" }
      ]
    }
  ]
}
La I.6 folosește "options": ["Adevărat", "Fals"]. Respectă conținutul cerut pentru fiecare item (I.1…I.6, II.1…II.6, III.1…III.6).`;
}

function buildGenericSystem(cfg, examples) {
  return `${ai.PERSONA}

Sarcină: generează un MODEL COMPLET de test pentru „${cfg.title}", ca material de pregătire, respectând EXACT structura oficială și punctajele.

${cfg.programa}

${cfg.structure}

Reguli de conținut:
- ${FIDELITY}
- COPIAZĂ exercițiile din TESTELE REALE DIN SITE (dacă sunt furnizate) sau din exercițiile-model: păstrează enunțul și structura, schimbă DOAR numerele/notațiile/coeficienții și recalculează. COMBINĂ sursele: exercițiul 1 dintr-un test, exercițiul 2 din ALT test (ciclic). Creezi unul complet nou NUMAI dacă sursele nu acoperă poziția.
- Fiecare subiect (I, II, III) totalizează exact 30 de puncte.
- Include baremul: pentru fiecare item, rezolvare scurtă și răspunsul final.
- Dacă un item e cu variante (grilă), distribuie răspunsul corect aleatoriu între variante (nu mereu prima).
- Enunțuri clare, corecte matematic. Formulele în LaTeX între $...$.
${JSON_RULE}

=== EXERCIȚII DIN BAZA DE DATE (model) ===
${examples}
=== SFÂRȘIT ===

Răspunde STRICT cu un obiect JSON, fără text în plus:
{
  "title": "${cfg.title}", "durationMin": ${cfg.durationMin},
  "subjects": [
    { "label": "SUBIECTUL I", "points": 30, "instructions": "(opțional)",
      "items": [ { "number": "1", "statement": "enunț cu $LaTeX$", "points": 6, "solution": "rezolvare pe scurt", "answer": "răspuns final" } ] },
    { "label": "SUBIECTUL al II-lea", "points": 30, "items": [ ... ] },
    { "label": "SUBIECTUL al III-lea", "points": 30, "items": [ ... ] }
  ]
}`;
}

module.exports = async function handler(req, res) {
  ai.applyCors(res);
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method Not Allowed' });

  const supa = ai.admin();
  try {
    const userId = await ai.authUser(req, supa);
    const { examType, instructions = '', dataMode = 'modify' } = req.body || {};
    const profile = await ai.requireUser(supa, userId);
    if (!profile.is_admin) ai.requirePremium(profile); // abonați sau admin
    await ai.enforceRateLimit(supa, userId);

    const cfg = EXAMS[examType];
    if (!cfg) return res.status(400).json({ error: 'examType invalid' });

    const docs = await ai.retrieve(supa, { query: cfg.query, category: cfg.category, allowPremium: true, k: 10, prefer: 'exercise' });
    // amestecăm exemplele → generările succesive pornesc de la modele diferite
    const examples = ai.contextBlock([...docs].sort(() => Math.random() - 0.5).slice(0, 6));

    // ── Testele REALE din site (rubrica examenului) — sursa combinării:
    //    itemul 1 preluat dintr-un test, itemul 2 din altul, cu numere noi. ──
    let siteTests = '';
    let combinePlan = '';
    let combinedFrom = [];
    try {
      let qSrc = supa.from('content')
        .select('title, file_url, interactive_data, content_type, subcategory, profile')
        .in('content_type', ['interactive', 'pdf']).eq('category', cfg.category)
        // cele mai recente întâi + limită mare: altfel un eșantion nesortat de 80
        // de rânduri sărea peste Variante Date (rămâneau doar Simulările).
        .order('created_at', { ascending: false }).limit(300);
      if (cfg.profile) qSrc = qSrc.eq('profile', cfg.profile);
      // sursele COMBINĂRII: Simulări + Variante Date + Modele (+ celelalte teste),
      // ca itemii să vină din mai multe subcategorii, nu doar din Simulări.
      if (Array.isArray(cfg.sourceSubs) && cfg.sourceSubs.length) qSrc = qSrc.in('subcategory', cfg.sourceSubs);
      const { data: rowsAll } = await qSrc;
      // separăm strict categoria/profilul; excludem baremele și capitolele teoretice
      const rows = (rowsAll || []).filter((r) => (r.subcategory || '') !== 'bareme');
      // stratificat pe subcategorii: Simulările se combină cu Variante Date + Modele etc.
    const stratify = (arr) => {
      const g = {};
      arr.forEach((r) => { (g[r.subcategory || ''] = g[r.subcategory || ''] || []).push(r); });
      Object.values(g).forEach((a) => a.sort(() => Math.random() - 0.5));
      const ks = Object.keys(g).sort(() => Math.random() - 0.5);
      const out = []; let added = true;
      while (added) { added = false; for (const k of ks) { const it = g[k].pop(); if (it) { out.push(it); added = true; } } }
      return out;
    };
      // Parcurgem TOATĂ coada stratificată (nu doar primele 5 rânduri): dacă un
      // PDF nu are text extractibil (ex. scanat), încercăm URMĂTORUL din aceeași
      // subcategorie — altfel Variantele Date cădeau tăcut și rămâneau doar
      // Simulările. Continuăm până acoperim TOATE subcategoriile-sursă.
      const queue = stratify(rows);
      const parts = [];
      const partSubs = [];       // subcategoria fiecărui TEST inclus (A, B, C…)
      const partTitles = [];
      const covered = new Set(); // subcategoriile deja reprezentate
      for (const r of queue) {
        const sub = r.subcategory || r.content_type || '';
        if (parts.length >= 5 && covered.has(sub)) continue; // căutăm doar subcategorii lipsă
        if (parts.length >= 7) break;
        try {
          if (r.interactive_data?.exercise) {
            parts.push(`=== TESTUL ${String.fromCharCode(65 + parts.length)} (${sub}): ${r.title} ===\n${JSON.stringify(r.interactive_data.exercise).slice(0, 4500)}`);
            partSubs.push(sub); partTitles.push(r.title); covered.add(sub);
            continue;
          }
          const { bucket, filePath } = storagePath(r.file_url);
          const { data: blob } = await supa.storage.from(bucket).download(filePath);
          if (!blob) continue;
          const buf = Buffer.from(await blob.arrayBuffer());
          let txt = '';
          if (r.content_type === 'pdf' || /\.pdf(\?|$)/i.test(filePath)) {
            txt = await pdfText(buf, 4500); // subiecte PDF: variante date / simulări
          } else {
            txt = cutBarem(buf.toString('utf8')).replace(/<script[\s\S]*?<\/script>/gi, ' ').replace(/<style[\s\S]*?<\/style>/gi, ' ').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
          }
          if (txt.length > 200) {
            parts.push(`=== TESTUL ${String.fromCharCode(65 + parts.length)} (${sub}): ${r.title} ===\n${txt.slice(0, 4500)}`);
            partSubs.push(sub); partTitles.push(r.title); covered.add(sub);
          }
        } catch { /* sursă ignorată — trecem la următoarea */ }
      }
      if (parts.length >= 2) {
        siteTests = parts.join('\n\n');
        // PLAN DE COMBINARE generat ALEATORIU pe server → fiecare generare
        // combină alte teste și alți itemi (rezolvă „aceleași câteva teste”).
        // Literele alternează subcategoriile (Simulări ↔ Variante Date), ca
        // itemii să fie un MIX real, nu preluați dintr-o singură subcategorie.
        const bySub = {};
        parts.forEach((_, i) => { (bySub[partSubs[i]] = bySub[partSubs[i]] || []).push(String.fromCharCode(65 + i)); });
        const groups = Object.values(bySub).map((a) => a.sort(() => Math.random() - 0.5));
        groups.sort(() => Math.random() - 0.5);
        const letters = [];
        for (let added = true; added;) { added = false; for (const g of groups) { const L = g.shift(); if (L) { letters.push(L); added = true; } } }
        if (cfg.special === 'en') {
          // poziții explicite pe subiecte — Subiectul I NUMAI algebră (fără geometrie)
          const positions = [
            ...Array.from({ length: 6 }, (_, i) => ({ label: `SUBIECTUL I, itemul ${i + 1}`, constraint: 'item de ARITMETICĂ/ALGEBRĂ (FĂRĂ geometrie), conform conținutului I.' + (i + 1) }),),
            ...Array.from({ length: 6 }, (_, i) => ({ label: `SUBIECTUL al II-lea, itemul ${i + 1}`, constraint: 'item de GEOMETRIE, conform conținutului II.' + (i + 1) }),),
            ...Array.from({ length: 6 }, (_, i) => ({ label: `SUBIECTUL al III-lea, problema ${i + 1}`, constraint: 'problemă cu rezolvare completă, conform conținutului III.' + (i + 1) }),),
          ];
          combinePlan = positions.map((p, i) => {
            const L = letters[i % letters.length];
            return `- ${p.label} → copiază/adaptează din TESTUL ${L} un ${p.constraint} (dacă TESTUL ${L} nu are un astfel de item, ia-l din alt test).`;
          }).join('\n');
        } else {
          combinePlan = Array.from({ length: 12 }, (_, i) => {
            const L = letters[i % letters.length];
            return `- Itemul ${i + 1} → copiază/adaptează din TESTUL ${L} itemul nr. ${1 + Math.floor(Math.random() * 5)} (dacă nu există, alt item din TESTUL ${L}).`;
          }).join('\n');
        }
        combinedFrom = parts.map((_, i) => `${partTitles[i]} [${partSubs[i]}]`);
      }
    } catch { /* fără combinare */ }

    let system = cfg.special === 'en' ? buildENSystem(examples) : buildGenericSystem(cfg, examples);
    system += `\n\nREGIM DE LUCRU CU DATELE: ${modeLine(dataMode)}`;
    if (siteTests) {
      system += `\n\n=== TESTE REALE DIN SITE (SURSA OBLIGATORIE a itemilor) ===\n${siteTests}\n=== SFÂRȘIT TESTE ===

PLAN DE COMBINARE — OBLIGATORIU, poziție cu poziție (a fost tras la sorți pe server; respectă-l întocmai):
${combinePlan}

Pentru FIECARE poziție: COPIAZĂ itemul indicat (enunț, tip, structură, stil). ${modeLine(dataMode)} NU inventa itemi în alt stil. Structura, punctajele și numărul de itemi rămân EXACT cele cerute mai sus.
Sursele provin din subcategorii diferite (marcate în paranteză la fiecare TEST — ex. „simulari”, „variante”): testul final trebuie să fie un MIX REAL, cu itemi preluați din TOATE subcategoriile prezente, nu doar dintr-una.`;
    }

    const { text, usage } = await ai.chat({
      system,
      messages: [{ role: 'user', content: `Generează testul complet acum, în format JSON. Fă-l DIFERIT de variantele anterioare (alte numere, alte enunțuri). Variantă #${Math.random().toString(36).slice(2, 8)}.${instructions.trim() ? `\n\nINSTRUCȚIUNILE PROFESORULUI (respectă-le întocmai, au prioritate): ${String(instructions).slice(0, 4000)}` : ''}` }],
      // 7500: figurile ("figure") adaugă ~1000 de tokeni peste cei 18 itemi —
      // cu 5000 răspunsul se trunchia și parse-ul eșua.
      temperature: 0.7, maxTokens: 7500, json: true, model: ai.GEN_MODEL,
    });
    await ai.logUsage(supa, userId, 'ai-exam', usage);

    let parsed;
    try { parsed = deepRestore(lenientParse(text)); }
    catch (e) { console.error('exam parse fail:', e.message); return res.status(502).json({ error: 'Generatorul a returnat un format invalid. Mai încearcă o dată.' }); }

    const exam = {
      examType,
      title: parsed.title || cfg.title,
      durationMin: parsed.durationMin || cfg.durationMin,
      totalPoints: 100,
      oficiu: 10,
      subjects: Array.isArray(parsed.subjects) ? parsed.subjects : [],
    };
    // Validare: un „test" fără subiecte sau fără itemi = răspuns trunchiat/gol
    // (modelele cu raționament pot epuiza bugetul) — mai bine eroare cu retry
    // decât un PDF gol.
    const itemCount = exam.subjects.reduce((n, s) => n + (Array.isArray(s?.items) ? s.items.length : 0), 0);
    if (!exam.subjects.length || !itemCount) {
      console.error('ai-exam: structură goală (subiecte/itemi lipsă)');
      return res.status(502).json({ error: 'Generatorul a returnat un test incomplet. Mai încearcă o dată.' });
    }
    return res.status(200).json({ exam, combinedFrom });
  } catch (err) {
    console.error('ai-exam error:', err);
    return res.status(err.status || 500).json({ error: err.message || 'Eroare server', code: err.code || null });
  }
};
