// =====================================================================
// api/ai-exam.js — generează un MODEL de test de examen (structură oficială)
// Body: { userId, examType }
//   examType: 'evaluare-nationala' | 'bac-tehnologic' | 'bac-stiinte' | 'bac-mate-info'
// Răspuns: { exam: {...structură cu subiecte, itemi, punctaje, barem} }
// Doar pentru abonați.
// =====================================================================
const ai = require('./_lib/ai');

const EXAMS = {
  'evaluare-nationala': {
    title: 'Evaluare Națională · Matematică',
    category: 'evaluare-nationala',
    durationMin: 120,
    query: 'evaluare națională matematică clasa 8 exercițiu',
    programa: 'Programa de Evaluare Națională (clasele V–VIII): numere reale, calcul algebric, ecuații, funcții, procente, geometrie plană (triunghiuri, patrulatere, cerc, arii), corpuri geometrice (prisme, piramide, cilindru, con, sferă).',
    structure: `Structură (identică cu cea oficială):
- SUBIECTUL I (30 de puncte): cerințe cu răspuns scurt (rezultat direct) — încercuire/completare, fiecare item 5 puncte (aprox. 6 itemi).
- SUBIECTUL al II-lea (30 de puncte): 2–3 itemi cu rezolvare (calcul algebric, ecuații/sisteme, un desen geometric cu cerințe).
- SUBIECTUL al III-lea (30 de puncte): 2 probleme cu enunț (geometrie și/sau funcții/probleme practice), cu subpuncte.`,
  },
  'bac-tehnologic': {
    title: 'Bacalaureat · Matematică M_tehnologic',
    category: 'bacalaureat',
    durationMin: 180,
    query: 'bacalaureat matematică tehnologic exercițiu',
    programa: 'Programa M_tehnologic (cea mai accesibilă filieră): mulțimi de numere, funcții elementare, progresii, trigonometrie de bază, numere complexe (simplu), geometrie analitică simplă, elemente de analiză (șiruri, limite simple, derivate), matematici financiare, statistică și probabilități.',
    structure: `Structură (identică cu cea oficială):
- SUBIECTUL I (30 de puncte): 5 itemi cu răspuns scurt/rezolvare succintă, fiecare aprox. 5–6 puncte.
- SUBIECTUL al II-lea (30 de puncte): 2 probleme cu subpuncte (a, b, c) — de obicei matrice/sisteme și funcții.
- SUBIECTUL al III-lea (30 de puncte): 2 probleme cu subpuncte — analiză (șiruri/derivate) și aplicații.`,
  },
  'bac-stiinte': {
    title: 'Bacalaureat · Matematică M_științele-naturii',
    category: 'bacalaureat',
    durationMin: 180,
    query: 'bacalaureat matematică științele naturii exercițiu',
    programa: 'Programa M_științe-ale-naturii (nivel intermediar): funcții, progresii, trigonometrie, numere complexe, geometrie analitică, combinatorică și binomul lui Newton, analiză matematică (limite, continuitate, derivate, primitive și integrale — nivel mediu), probabilități.',
    structure: `Structură (identică cu cea oficială):
- SUBIECTUL I (30 de puncte): 5 itemi cu rezolvare succintă (aprox. 5–6 puncte fiecare).
- SUBIECTUL al II-lea (30 de puncte): 2 probleme cu subpuncte (a, b, c) — algebră (matrice/sisteme, funcții).
- SUBIECTUL al III-lea (30 de puncte): 2 probleme cu subpuncte — analiză matematică (derivate, integrale).`,
  },
  'bac-mate-info': {
    title: 'Bacalaureat · Matematică M_mate-info',
    category: 'bacalaureat',
    durationMin: 180,
    query: 'bacalaureat matematică mate-info exercițiu dificil',
    programa: 'Programa M_mate-info (cea mai dificilă filieră): structuri algebrice (grupuri, inele, corpuri), matrice și determinanți, sisteme, polinoame, numere complexe, combinatorică, analiză matematică riguroasă (șiruri, limite, continuitate, derivabilitate, studiul funcțiilor, primitive, integrala definită și aplicații).',
    structure: `Structură (identică cu cea oficială):
- SUBIECTUL I (30 de puncte): 5 itemi cu rezolvare succintă (aprox. 6 puncte fiecare).
- SUBIECTUL al II-lea (30 de puncte): 2 probleme cu subpuncte (a, b, c) — matrice/determinanți, structuri algebrice, polinoame.
- SUBIECTUL al III-lea (30 de puncte): 2 probleme cu subpuncte — analiză matematică (studiul unei funcții, integrale).`,
  },
};

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

    // RAG: aducem exerciții reale din categoria potrivită ca model de stil/dificultate.
    const docs = await ai.retrieve(supa, { query: cfg.query, category: cfg.category, allowPremium: true, k: 10 });
    const examples = ai.contextBlock(docs);

    const system = `${ai.PERSONA}

Sarcină: generează un MODEL COMPLET de test pentru „${cfg.title}", ca material de pregătire, respectând EXACT structura oficială și punctajele.

${cfg.programa}

${cfg.structure}

Reguli de conținut:
- Bazează-te pe EXERCIȚIILE DIN BAZA DE DATE de mai jos: recombină-le și schimbă date minime (numere, notații, coeficienți) ca să obții itemi noi echivalenți ca dificultate. Creează un exercițiu complet nou doar dacă e simplu și necesar.
- Fiecare subiect (I, II, III) totalizează exact 30 de puncte; distribuie punctele pe itemi/subpuncte.
- Formulele se scriu în LaTeX, între $...$ (inline) sau $$...$$ (bloc).
- Include și baremul: pentru fiecare item, o rezolvare scurtă și răspunsul final.
- Enunțuri clare, fără ambiguități, corecte matematic.

=== EXERCIȚII DIN BAZA DE DATE (model) ===
${examples}
=== SFÂRȘIT ===

Răspunde STRICT cu un obiect JSON, fără text în plus:
{
  "title": "${cfg.title}",
  "durationMin": ${cfg.durationMin},
  "subjects": [
    {
      "label": "SUBIECTUL I",
      "points": 30,
      "instructions": "text scurt (opțional)",
      "items": [
        { "number": "1", "statement": "enunț cu LaTeX", "points": 5, "solution": "rezolvare pe scurt", "answer": "răspuns final" }
      ]
    },
    { "label": "SUBIECTUL al II-lea", "points": 30, "items": [ ... ] },
    { "label": "SUBIECTUL al III-lea", "points": 30, "items": [ ... ] }
  ]
}`;

    const { text, usage } = await ai.chat({
      system,
      messages: [{ role: 'user', content: 'Generează testul complet acum, în format JSON.' }],
      temperature: 0.7, maxTokens: 4200, json: true,
    });
    await ai.logUsage(supa, userId, 'ai-exam', usage);

    let parsed;
    try { parsed = JSON.parse(text); }
    catch { return res.status(502).json({ error: 'Generatorul a returnat un format invalid. Mai încearcă o dată.' }); }

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
