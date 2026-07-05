// =====================================================================
// api/ai-generate-interactive.js — generează un EXERCIȚIU INTERACTIV
// STRUCTURAT (listă de întrebări), ca să poată fi editat ca text (fără HTML)
// și completat cu adăugare/ștergere de întrebări.
// Body: { userId, category?, topic?, difficulty? }
// Răspuns: { questions:[{statement, options?, answer, explanation?}], title, topic }
// Randarea în HTML interactiv se face pe client (src/lib/quizRender.js).
// =====================================================================
const ai = require('./_lib/ai');

// Parsare JSON tolerantă la LaTeX (backslash-uri simple ca \frac devin \\frac).
function safeParse(text) {
  let s = (text || '').trim();
  const fence = s.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence) s = fence[1].trim();
  const a = s.indexOf('['); const b = s.lastIndexOf(']');
  if (a !== -1 && b !== -1) s = s.slice(a, b + 1);
  try { return JSON.parse(s); } catch { /* încearcă reparat */ }
  try { return JSON.parse(s.replace(/\\(?![\\/"bfnrtu])/g, '\\\\')); } catch { /* nimic */ }
  return null;
}

module.exports = async function handler(req, res) {
  ai.applyCors(res);
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method Not Allowed' });

  const supa = ai.admin();
  try {
    const userId = await ai.authUser(req, supa);
    const { category = null, topic = '', difficulty = 'mediu' } = req.body || {};
    const profile = await ai.requireUser(supa, userId);
    if (!profile.is_admin) ai.requirePremium(profile);
    await ai.enforceRateLimit(supa, userId);

    const q = [topic, category, 'exercițiu matematică'].filter(Boolean).join(' ');
    const docs = await ai.retrieve(supa, { query: q, category, allowPremium: true, k: 5, prefer: 'exercise' });
    const examples = ai.contextBlock(docs);

    const system = `${ai.PERSONA}

Sarcină: creează un set de 5 întrebări de matematică pentru un exercițiu interactiv, în stilul exemplelor din baza de date.

=== EXEMPLE DIN BAZA DE DATE (temă/stil) ===
${examples}
=== SFÂRȘIT ===

Răspunde STRICT cu un array JSON valid (fără text în plus, fără markdown), cu 5 obiecte:
[
  {
    "statement": "enunțul întrebării (formule LaTeX între $...$)",
    "options": ["varianta a", "varianta b", "varianta c", "varianta d"],
    "answer": 0,
    "explanation": "de ce e corect (scurt)"
  }
]
Reguli:
- Majoritatea întrebărilor cu "options" (grilă, exact 4 variante) și "answer" = INDEXUL variantei corecte (0,1,2,3). DISTRIBUIE răspunsul corect aleatoriu între cele 4 poziții (nu mereu 0).
- Poți face și întrebări cu răspuns liber: OMITE "options" și pune "answer" ca text (ex: "12" sau "x=3").
- Respectă cât mai fidel exercițiile-model (tip, stil, dificultate), schimbând doar minim datele.
- Subiect: ${topic || 'potrivit categoriei'}${category ? ' · categoria ' + category : ''}. Dificultate: ${difficulty}.
- Folosește „·" (\\cdot în LaTeX) pentru înmulțire, NICIODATĂ × sau litera x.
- Variază: la cereri repetate pentru același model, generează exerciții DIFERITE (alte valori, alt context).
- IMPORTANT JSON valid: scrie fiecare backslash din LaTeX de DOUĂ ori. Ex: pentru fracție "$\\\\frac{1}{2}$", radical "$\\\\sqrt{9}$".`;

    const { text, usage } = await ai.chat({
      system,
      messages: [{ role: 'user', content: `Generează array-ul JSON cu cele 5 întrebări acum. Fă-le DIFERITE de generările anterioare (alte numere, alte contexte, altă ordine). Sesiune #${Math.random().toString(36).slice(2, 8)}.` }],
      temperature: 0.9, maxTokens: 2200, json: true,
    });
    await ai.logUsage(supa, userId, 'ai-generate-interactive', usage);

    let questions = safeParse(text);
    if (!Array.isArray(questions) || !questions.length) {
      return res.status(502).json({ error: 'Generatorul nu a produs întrebări valide. Mai încearcă o dată.' });
    }
    // normalizează
    questions = questions.slice(0, 8).map((q) => ({
      statement: String(q.statement || ''),
      options: Array.isArray(q.options) ? q.options.map((o) => String(o)) : undefined,
      answer: Array.isArray(q.options) ? Number(q.answer) || 0 : String(q.answer ?? ''),
      explanation: q.explanation ? String(q.explanation) : '',
    })).filter((q) => q.statement);

    return res.status(200).json({
      questions,
      title: `Exercițiu interactiv · ${topic || category || 'matematică'}`,
      topic: topic || null,
    });
  } catch (err) {
    console.error('ai-generate-interactive error:', err);
    return res.status(err.status || 500).json({ error: err.message || 'Eroare server', code: err.code || null });
  }
};
