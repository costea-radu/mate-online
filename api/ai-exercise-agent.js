// =====================================================================
// api/ai-exercise-agent.js — AGENTUL CLAUDE de generare exerciții (admin).
// Primește un FIȘIER-MODEL (PDF trimis nativ către Claude / text extras
// din HTML) + INSTRUCȚIUNILE adminului (mesaj liber, stil chat) și
// generează un exercițiu asemănător: grilă sau cu etape de rezolvare
// (indicii + barem + punctaj). Formatul se alege automat după model,
// dacă instrucțiunile nu cer altceva.
// Body: { userId, instructions?, model?, modelPdf?(base64), history? }
//   - model    = text-model (HTML convertit în text) SAU exercițiul curent
//                (JSON) când se cere o variantă nouă / asemănătoare.
//   - modelPdf = PDF-ul model, base64 (necesită ANTHROPIC_API_KEY).
// Răspuns: { exercise, provider }
// =====================================================================
const ai = require('./_lib/ai');
const claude = require('./_lib/claude');

const SCHEMAS = `— GRILĂ:
{
  "title": "titlul exercițiului",
  "kind": "grila",
  "output": "interactive sau pdf — formatul de salvare cerut de admin (implicit interactive)",
  "statement": "context general (opțional, poate fi gol)",
  "questions": [
    { "statement": "enunț (LaTeX între $...$)", "options": ["A", "B", "C", "D"],
      "answer": 0, "hint": "indiciu fără răspuns", "explanation": "rezolvarea completă", "points": 10 }
  ]
}
— CU ETAPE DE REZOLVARE:
{
  "title": "titlul exercițiului",
  "kind": "etape",
  "statement": "enunțul complet al problemei (LaTeX între $...$)",
  "steps": [
    { "prompt": "ce se cere la această etapă", "answer": "răspuns scurt (număr/expresie)",
      "hint": "indiciu fără răspuns", "explanation": "rezolvarea etapei (barem)", "points": 10 }
  ],
  "final_answer": "răspunsul final"
}`;

function normalize(ex) {
  if (!ex || typeof ex !== 'object') return null;
  const kind = ex.kind === 'etape' ? 'etape' : 'grila';
  const out = {
    title: String(ex.title || 'Exercițiu generat'), kind,
    statement: String(ex.statement || ''),
    output: ex.output === 'pdf' ? 'pdf' : 'interactive',
  };
  if (kind === 'grila') {
    const qs = Array.isArray(ex.questions) ? ex.questions : [];
    out.questions = qs.slice(0, 20).map((q) => ({
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
    out.steps = st.slice(0, 20).map((s) => ({
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

    const { instructions = '', model = null, modelPdf = null, formatText = null, formatPdf = null, history = [] } = req.body || {};
    if (!instructions.trim() && !model && !modelPdf) {
      return res.status(400).json({ error: 'Încarcă un fișier-model sau scrie instrucțiuni pentru agent.' });
    }
    if ((modelPdf || formatPdf) && !claude.HAS_KEY) {
      return res.status(400).json({ error: 'Modelele PDF necesită cheia ANTHROPIC_API_KEY (setează-o în Vercel). Alternativ, folosește un model HTML sau doar instrucțiuni.' });
    }
    if ((String(modelPdf || '').length + String(formatPdf || '').length) > 4.2 * 1024 * 1024) {
      return res.status(400).json({ error: 'Fișierele PDF sunt prea mari (max ~3 MB în total).' });
    }

    // RAG ușor: stilul materialelor din site rămâne o referință
    const ragQuery = (instructions || 'exercițiu de matematică asemănător modelului').slice(0, 300);
    const docs = await ai.retrieve(supa, { query: ragQuery, category: null, allowPremium: true, k: 4, prefer: 'exercise' });
    const ctx = ai.contextBlock(docs);

    const system = `Ești agentul de creare de exerciții al platformei ExamenMate (matematică, românește, clasele 5–12, Evaluare Națională, Bacalaureat).

Primești (opțional) un EXERCIȚIU-MODEL (PDF sau text), opțional un al doilea fișier: MODELUL DE FORMAT (structura/așezarea/stilul baremului dorite la rezultat), și instrucțiunile adminului.
Sarcina: generează UN exercițiu NOU, ASEMĂNĂTOR modelului de exerciții (aceeași temă, stil și dificultate — dar cu ALTE valori numerice/context; NU copia modelul), turnat în structura modelului de format (număr de itemi, tip grilă/etape, barem), respectând întocmai instrucțiunile adminului (ele au prioritate absolută).
Transformări permise și încurajate când sunt cerute: PDF → interactiv, interactiv → PDF, schimbarea numerelor/valorilor, schimbarea tipului (grilă ↔ etape).

=== MATERIALE DIN SITE (referință de stil și nivel) ===
${ctx}
=== SFÂRȘIT MATERIALE ===

Răspunde STRICT cu UN SINGUR obiect JSON valid (fără alt text, fără markdown), în UNUL din cele două formate:
${SCHEMAS}

Alegerea formatului JSON: potrivește-l cu modelul de format dacă există, altfel cu modelul de exerciții (grilă → "grila"; problemă pe pași → "etape"). Dacă adminul cere explicit, are prioritate.
Câmpul "output": pune "pdf" dacă adminul cere salvare/tipărire ca PDF ori fișă de lucru; altfel "interactive". Ambele scheme acceptă câmpul "output".

Reguli:
- Formule în LaTeX între $...$; fiecare backslash scris DUBLU (ex: "$\\\\frac{1}{2}$").
- Înmulțirea cu „·” ($\\\\cdot$), niciodată × sau litera x.
- "points" = baremul fiecărui item; păstrează proporțiile baremului din model dacă există.
- Indiciile ghidează, NU dau răspunsul; "explanation" = rezolvarea completă (baremul afișat după verificare).
- La grilă: exact 4 variante, "answer" = indexul corect (0–3), distribuit aleatoriu.
- La etape: răspunsuri scurte, verificabile prin comparație de text.
- Numărul de itemi: ca în model sau conform instrucțiunilor.
- Generările repetate trebuie să DIFERE (alte valori, alt context).`;

    // Conversație: instrucțiunile anterioare (context), apoi mesajul curent
    const past = (Array.isArray(history) ? history : []).slice(-6).map((m) => ({
      role: m.role === 'assistant' ? 'assistant' : 'user',
      content: String(m.content || '').slice(0, 2000),
    }));

    const blocks = [];
    if (modelPdf) {
      blocks.push({ type: 'text', text: 'FIȘIERUL 1 — EXERCIȚIILE-MODEL (PDF):' });
      blocks.push({ type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: String(modelPdf) } });
    }
    if (formatPdf) {
      blocks.push({ type: 'text', text: 'FIȘIERUL 2 — MODELUL DE FORMAT (PDF):' });
      blocks.push({ type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: String(formatPdf) } });
    }
    const textParts = [];
    if (model) textParts.push(`EXERCIȚIU-MODEL:\n${typeof model === 'string' ? model.slice(0, 20000) : JSON.stringify(model, null, 2)}`);
    if (formatText) textParts.push(`MODEL DE FORMAT:\n${String(formatText).slice(0, 20000)}`);
    textParts.push(`INSTRUCȚIUNI: ${instructions.trim() || 'Generează un exercițiu asemănător modelului.'}`);
    textParts.push(`Generează acum obiectul JSON. Sesiune #${Math.random().toString(36).slice(2, 8)}.`);
    blocks.push({ type: 'text', text: textParts.join('\n\n') });

    const { text, usage, provider, stopReason } = await claude.chatClaude({
      system,
      messages: [...past, { role: 'user', content: blocks }],
      maxTokens: 8000,
    });
    await ai.logUsage(supa, userId, 'ai-exercise-agent', usage);

    const exercise = normalize(claude.extractJson(text));
    if (!exercise) {
      console.error('ai-exercise-agent: JSON invalid. stopReason=%s, primele 400 caractere: %s', stopReason, String(text || '').slice(0, 400));
      const explain = stopReason === 'max_tokens'
        ? 'Răspunsul a fost tăiat (testul cerut e foarte lung). Cere mai puține întrebări sau împarte-l în două generări.'
        : 'Agentul nu a produs un exercițiu valid. Reformulează instrucțiunile și mai încearcă.';
      return res.status(502).json({ error: explain });
    }

    return res.status(200).json({ exercise, provider });
  } catch (err) {
    console.error('ai-exercise-agent error:', err);
    return res.status(err.status || 500).json({ error: err.message || 'Eroare server', code: err.code || null });
  }
};
