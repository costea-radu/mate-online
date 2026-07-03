// =====================================================================
// api/ai-exam.js — generează un MODEL de test de examen (structură oficială)
// Body: { userId, examType }
//   examType: 'evaluare-nationala' | 'bac-tehnologic' | 'bac-stiinte' | 'bac-mate-info'
// Răspuns: { exam: {...structură cu subiecte, itemi, punctaje, barem} }
// Doar pentru abonați.
// =====================================================================
const ai = require('./_lib/ai');

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
  },
  'bac-tehnologic': {
    title: 'Bacalaureat · Matematică M_tehnologic',
    category: 'bacalaureat', durationMin: 180,
    query: 'bacalaureat matematică tehnologic exercițiu',
    programa: 'Programa M_tehnologic (cea mai accesibilă filieră): mulțimi de numere, funcții elementare, progresii, trigonometrie de bază, numere complexe (simplu), geometrie analitică simplă, elemente de analiză (șiruri, limite simple, derivate), matematici financiare, statistică și probabilități.',
    structure: `Structură oficială:
- SUBIECTUL I (30 puncte): 5 itemi cu răspuns scurt/rezolvare succintă, aprox. 5–6 puncte fiecare.
- SUBIECTUL al II-lea (30 puncte): 2 probleme cu subpuncte (a, b, c) — matrice/sisteme și funcții.
- SUBIECTUL al III-lea (30 puncte): 2 probleme cu subpuncte — analiză (șiruri/derivate) și aplicații.`,
  },
  'bac-stiinte': {
    title: 'Bacalaureat · Matematică M_științele-naturii',
    category: 'bacalaureat', durationMin: 180,
    query: 'bacalaureat matematică științele naturii exercițiu',
    programa: 'Programa M_științe-ale-naturii (nivel intermediar): funcții, progresii, trigonometrie, numere complexe, geometrie analitică, combinatorică și binomul lui Newton, analiză matematică (limite, continuitate, derivate, primitive și integrale — nivel mediu), probabilități.',
    structure: `Structură oficială:
- SUBIECTUL I (30 puncte): 5 itemi cu rezolvare succintă (aprox. 5–6 puncte fiecare).
- SUBIECTUL al II-lea (30 puncte): 2 probleme cu subpuncte (a, b, c) — algebră (matrice/sisteme, funcții).
- SUBIECTUL al III-lea (30 puncte): 2 probleme cu subpuncte — analiză matematică (derivate, integrale).`,
  },
  'bac-mate-info': {
    title: 'Bacalaureat · Matematică M_mate-info',
    category: 'bacalaureat', durationMin: 180,
    query: 'bacalaureat matematică mate-info exercițiu dificil',
    programa: 'Programa M_mate-info (cea mai dificilă filieră): structuri algebrice (grupuri, inele, corpuri), matrice și determinanți, sisteme, polinoame, numere complexe, combinatorică, analiză matematică riguroasă (șiruri, limite, continuitate, derivabilitate, studiul funcțiilor, primitive, integrala definită și aplicații).',
    structure: `Structură oficială:
- SUBIECTUL I (30 puncte): 5 itemi cu rezolvare succintă (aprox. 6 puncte fiecare).
- SUBIECTUL al II-lea (30 puncte): 2 probleme cu subpuncte (a, b, c) — matrice/determinanți, structuri algebrice, polinoame.
- SUBIECTUL al III-lea (30 puncte): 2 probleme cu subpuncte — analiză matematică (studiul unei funcții, integrale).`,
  },
};

const JSON_RULE = `IMPORTANT pentru JSON valid: scrie fiecare backslash din comenzile LaTeX de DOUĂ ori (backslash dublu). Exemple corecte în JSON: pentru fracție folosește \\\\frac{...}{...}, pentru radical \\\\sqrt{...}, pentru înmulțire \\\\cdot, pentru unghi \\\\angle. Formulele se pun între $...$.`;

const FIDELITY = `Fidelitate față de modele: respectă cât mai fidel exercițiile-model din baza de date — preia structura, tipul și stilul, iar unde e potrivit chiar formularea, schimbând DOAR minim datele (numere, notații, coeficienți). Nu introduce tipuri de itemi care nu apar în modele. La geometrie, include și FIGURA: descrie-o clar în enunț (puncte, laturi, unghiuri, măsuri) așa cum apare în model, ca elevul să o poată desena.`;

function buildENSystem(examples) {
  return `${ai.PERSONA}

Sarcină: generează un MODEL COMPLET de test de Evaluare Națională la matematică, ca material de pregătire, respectând EXACT structura de mai jos și conținuturile cerute pentru fiecare item.

${EN_SPEC}

Reguli:
- ${FIDELITY}
- Bazează-te pe EXERCIȚIILE DIN BAZA DE DATE de mai jos: ia modele de acolo și schimbă date minime (numere, notații). Creează un item complet nou doar dacă e simplu și necesar.
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
      "items": [ { "number": "1", "statement": "...", "options": ["...","...","...","..."], "answer": "b", "points": 5, "solution": "..." } ]
    },
    {
      "label": "SUBIECTUL al III-lea", "points": 30,
      "instructions": "Scrieți rezolvările complete. Fiecare problemă: 5 puncte.",
      "items": [
        { "number": "1", "statement": "enunțul problemei",
          "parts": [ { "label": "a", "text": "cerința a)", "points": 2, "solution": "rezolvare completă a)" },
                     { "label": "b", "text": "cerința b)", "points": 3, "solution": "rezolvare completă b)" } ] }
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
- Bazează-te pe EXERCIȚIILE DIN BAZA DE DATE de mai jos și schimbă date minime (numere, notații, coeficienți). Creează un exercițiu complet nou doar dacă e simplu și necesar.
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
    const { userId, examType } = req.body || {};
    const profile = await ai.requireUser(supa, userId);
    ai.requirePremium(profile); // generatorul de teste e doar pentru abonați
    await ai.enforceRateLimit(supa, userId);

    const cfg = EXAMS[examType];
    if (!cfg) return res.status(400).json({ error: 'examType invalid' });

    const docs = await ai.retrieve(supa, { query: cfg.query, category: cfg.category, allowPremium: true, k: 10, prefer: 'exercise' });
    const examples = ai.contextBlock(docs);

    const system = cfg.special === 'en' ? buildENSystem(examples) : buildGenericSystem(cfg, examples);

    const { text, usage } = await ai.chat({
      system,
      messages: [{ role: 'user', content: 'Generează testul complet acum, în format JSON.' }],
      temperature: 0.6, maxTokens: 5000, json: true,
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
    return res.status(200).json({ exam });
  } catch (err) {
    console.error('ai-exam error:', err);
    return res.status(err.status || 500).json({ error: err.message || 'Eroare server', code: err.code || null });
  }
};
