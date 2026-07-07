// =====================================================================
// api/ai-exercise-agent.js — AGENTUL CLAUDE de generare exerciții (admin).
// Generează exerciții GRILĂ sau CU ETAPE DE REZOLVARE (indicii + barem +
// punctaj), învățând din materialele indexate în site (RAG).
// Body: { userId, action:'generate'|'similar', kind:'grila'|'etape',
//         category, topic, difficulty, count, model? }
//   - model = exercițiul curent (eventual editat de admin) folosit ca model
//             pentru „generează asemănător”.
// Răspuns: { exercise, provider }
// =====================================================================
const ai = require('./_lib/ai');
const claude = require('./_lib/claude');

const SCHEMA_GRILA = `{
  "title": "titlul exercițiului",
  "kind": "grila",
  "statement": "context general (opțional, poate fi gol)",
  "questions": [
    {
      "statement": "enunțul întrebării (LaTeX între $...$)",
      "options": ["varianta A", "varianta B", "varianta C", "varianta D"],
      "answer": 0,
      "hint": "indiciu scurt, fără a da răspunsul",
      "explanation": "rezolvarea/justificarea completă",
      "points": 10
    }
  ]
}`;

const SCHEMA_ETAPE = `{
  "title": "titlul exercițiului",
  "kind": "etape",
  "statement": "enunțul complet al problemei (LaTeX între $...$)",
  "steps": [
    {
      "prompt": "ce se cere la această etapă (subîntrebare clară)",
      "answer": "răspunsul corect, scurt (număr sau expresie simplă)",
      "hint": "indiciu care ghidează fără să dea răspunsul",
      "explanation": "rezolvarea detaliată a etapei (baremul: ce se punctează)",
      "points": 10
    }
  ],
  "final_answer": "răspunsul final al problemei"
}`;

function normalize(ex, kind) {
  if (!ex || typeof ex !== 'object') return null;
  const out = {
    title: String(ex.title || 'Exercițiu generat'),
    kind: ex.kind === 'etape' || kind === 'etape' ? 'etape' : 'grila',
    statement: String(ex.statement || ''),
  };
  if (out.kind === 'grila') {
    const qs = Array.isArray(ex.questions) ? ex.questions : [];
    out.questions = qs.slice(0, 15).map((q) => ({
      statement: String(q.statement || ''),
      options: Array.isArray(q.options) && q.options.length ? q.options.slice(0, 6).map(String) : undefined,
      answer: Array.isArray(q.options) && q.options.length ? Math.max(0, Number(q.answer) || 0) : String(q.answer ?? ''),
      hint: String(q.hint || ''),
      explanation: String(q.explanation || ''),
      points: Math.max(1, Number(q.points) || 10),
    })).filter((q) => q.statement);
    if (!out.questions.length) return null;
  } else {
    const st = Array.isArray(ex.steps) ? ex.steps : [];
    out.steps = st.slice(0, 15).map((s) => ({
      prompt: String(s.prompt || s.text || ''),
      answer: String(s.answer ?? ''),
      hint: String(s.hint || ''),
      explanation: String(s.explanation || ''),
      points: Math.max(1, Number(s.points) || 10),
    })).filter((s) => s.prompt);
    out.final_answer = String(ex.final_answer || '');
    if (!out.steps.length || !out.statement) return null;
  }
  return out;
}

module.exports = async function handler(req, res) {
  ai.applyCors(res);
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method Not Allowed' });

  const supa = ai.admin();
  try {
    const userId = await ai.authUser(req, supa);
    await ai.requireAdmin(supa, userId);

    const {
      action = 'generate', kind = 'grila', category = null, topic = '',
      difficulty = 'mediu', count = 5, model = null,
    } = req.body || {};
    const n = Math.min(10, Math.max(1, Number(count) || 5));

    // RAG: exemple din materialele site-ului (agentul „învață” din ele)
    const q = [topic, category, kind === 'etape' ? 'problemă rezolvare etape' : 'exercițiu grilă'].filter(Boolean).join(' ');
    const docs = await ai.retrieve(supa, { query: q, category, allowPremium: true, k: 5, prefer: kind === 'etape' ? 'solution' : 'exercise' });
    const ctx = ai.contextBlock(docs);

    const schema = kind === 'etape' ? SCHEMA_ETAPE : SCHEMA_GRILA;
    const modelBlock = model
      ? `\n=== EXERCIȚIU-MODEL (generează unul ASEMĂNĂTOR: aceeași structură, temă și dificultate, dar cu ALTE valori/context; NU copia) ===\n${typeof model === 'string' ? model : JSON.stringify(model, null, 2)}\n=== SFÂRȘIT MODEL ===\n`
      : '';

    const system = `Ești agentul de creare de exerciții al platformei ExamenMate (matematică, românește, clasele 5–12, Evaluare Națională, Bacalaureat).

=== MATERIALE DIN SITE (stil, nivel, notații — respectă-le) ===
${ctx}
=== SFÂRȘIT MATERIALE ===
${modelBlock}
Sarcină: creează ${kind === 'etape' ? 'O problemă cu ETAPE DE REZOLVARE (' + n + ' etape logice)' : 'un exercițiu GRILĂ cu ' + n + ' întrebări'}.
Categoria: ${category || 'generală'}. Subiect: ${topic || 'potrivit categoriei'}. Dificultate: ${difficulty}.

Răspunde STRICT cu UN SINGUR obiect JSON valid (fără text în plus, fără markdown), după schema:
${schema}

Reguli:
- Formule matematice în LaTeX între $...$; scrie fiecare backslash DUBLU (ex: "$\\\\frac{1}{2}$").
- Folosește „·” ($\\\\cdot$) pentru înmulțire, niciodată × sau litera x.
- "points" = punctajul fiecărui item (barem); valorile pot diferi după dificultate.
- Indiciile ghidează raționamentul, NU dau răspunsul.
- "explanation" = rezolvare completă, pas cu pas — e baremul afișat elevului după verificare.
- La grilă: exact 4 variante, "answer" = indexul corect (0–3), distribuit ALEATORIU.
- La etape: etapele urmează logic una din alta; răspunsurile scurte (număr/expresie simplă), verificabile prin comparație de text.
- Generările repetate trebuie să DIFERE (alte valori, alt context).`;

    const { text, usage, provider } = await claude.chatClaude({
      system,
      messages: [{ role: 'user', content: `Generează acum obiectul JSON (${action === 'similar' ? 'asemănător modelului' : 'nou'}). Sesiune #${Math.random().toString(36).slice(2, 8)}.` }],
      temperature: 0.85,
      maxTokens: 2600,
    });
    await ai.logUsage(supa, userId, 'ai-exercise-agent', usage);

    const exercise = normalize(claude.extractJson(text), kind);
    if (!exercise) return res.status(502).json({ error: 'Agentul nu a produs un exercițiu valid. Mai încearcă o dată.' });

    return res.status(200).json({ exercise, provider });
  } catch (err) {
    console.error('ai-exercise-agent error:', err);
    return res.status(err.status || 500).json({ error: err.message || 'Eroare server', code: err.code || null });
  }
};
