// =====================================================================
// api/ai-generate-interactive.js — generează un EXERCIȚIU INTERACTIV.
// STRUCTURAT (listă de întrebări), ca să poată fi editat ca text (fără HTML)
// și completat cu adăugare/ștergere de întrebări.
// Body: { userId, category?, topic?, difficulty? }
// Răspuns: { questions:[{statement, options?, answer, explanation?}], title, topic }
// Randarea în HTML interactiv se face pe client (src/lib/quizRender.js).
// =====================================================================
const ai = require('./_lib/ai');
const { pdfText, storagePath, modeLine, cutBarem } = require('./_lib/pdftext');

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
    const { category = null, topic = '', difficulty = 'mediu', dataMode = 'modify' } = req.body || {};
    const profile = await ai.requireUser(supa, userId);
    if (!profile.is_admin) ai.requirePremium(profile);
    await ai.enforceRateLimit(supa, userId);

    const q = [topic, category, 'exercițiu matematică'].filter(Boolean).join(' ');
    const docs = await ai.retrieve(supa, { query: q, category, allowPremium: true, k: 5, prefer: 'exercise' });
    const examples = ai.contextBlock(docs);

    // ── Surse REALE din categoria aleasă: teste interactive + subiecte PDF
    //    (teste de antrenament, variante date, simulări) — strict aceeași categorie ──
    let srcBlock = '';
    let plan = '';
    if (category) {
      try {
        const { data: rowsAll } = await supa.from('content')
          .select('title, file_url, interactive_data, content_type, subcategory')
          .in('content_type', ['interactive', 'pdf']).eq('category', category)
          // recente întâi + limită mare, ca sursele să acopere TOATE subcategoriile
          // (Simulări, Variante Date, capitole…), nu doar primele 80 nesortate.
          .order('created_at', { ascending: false }).limit(300);
        const rows = (rowsAll || []).filter((r) => (r.subcategory || '') !== 'bareme');
          const stratify = (arr) => {
            const g = {};
        arr.forEach((r) => { (g[r.subcategory || ''] = g[r.subcategory || ''] || []).push(r); });
        Object.values(g).forEach((a) => a.sort(() => Math.random() - 0.5));
            const ks = Object.keys(g).sort(() => Math.random() - 0.5);
            const out = []; let added = true;
        while (added) { added = false; for (const k of ks) { const it = g[k].pop(); if (it) { out.push(it); added = true; } } }
        return out;
    };
        // Parcurgem TOATĂ coada stratificată: dacă un PDF nu are text extractibil
        // (ex. scanat), încercăm următorul din aceeași subcategorie — altfel
        // Variantele Date cădeau tăcut și rămâneau doar Simulările.
        const queue = stratify(rows);
        const parts = [];
        const covered = new Set();
        for (const r of queue) {
          const sub = r.subcategory || r.content_type || '';
          if (parts.length >= 4 && covered.has(sub)) continue; // căutăm doar subcategorii lipsă
          if (parts.length >= 6) break;
          try {
            if (r.interactive_data?.exercise) {
              parts.push(`=== SURSA ${String.fromCharCode(65 + parts.length)} (${sub}): ${r.title} ===\n${JSON.stringify(r.interactive_data.exercise).slice(0, 4000)}`);
              covered.add(sub);
              continue;
            }
            const { bucket, filePath } = storagePath(r.file_url);
            const { data: blob } = await supa.storage.from(bucket).download(filePath);
            if (!blob) continue;
            const buf = Buffer.from(await blob.arrayBuffer());
            const txt = (r.content_type === 'pdf' || /\.pdf(\?|$)/i.test(filePath))
              ? await pdfText(buf, 4000)
              : cutBarem(buf.toString('utf8')).replace(/<script[\s\S]*?<\/script>/gi, ' ').replace(/<style[\s\S]*?<\/style>/gi, ' ').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 4000);
            if (txt.length > 200) { parts.push(`=== SURSA ${String.fromCharCode(65 + parts.length)} (${sub}): ${r.title} ===\n${txt}`); covered.add(sub); }
          } catch { /* sursă ignorată — trecem la următoarea */ }
        }
        if (parts.length >= 2) {
          srcBlock = parts.join('\n\n');
          const letters = parts.map((_, i) => String.fromCharCode(65 + i)).sort(() => Math.random() - 0.5);
          plan = Array.from({ length: 5 }, (_, i) => `- Întrebarea ${i + 1} ← SURSA ${letters[i % letters.length]}, un exercițiu ales aleatoriu din ea.`).join('\n');
        }
      } catch { /* fără surse */ }
    }

    const system = `${ai.PERSONA}

Sarcină: creează un set de 5 întrebări de matematică pentru un exercițiu interactiv, în stilul exemplelor din baza de date.

=== EXEMPLE DIN BAZA DE DATE (temă/stil) ===
${examples}
=== SFÂRȘIT ===
${srcBlock ? `\n=== SUBIECTE REALE DIN CATEGORIE (sursa itemilor — antrenament/variante/simulări) ===\n${srcBlock}\n=== SFÂRȘIT SURSE ===\nPLAN (tras la sorți — respectă-l): fiecare întrebare vine din sursa indicată:\n${plan}\n` : ''}
REGIM DE LUCRU CU DATELE: ${modeLine(dataMode)}

Răspunde STRICT cu un OBIECT JSON valid (fără text în plus, fără markdown), cu EXACT această formă — cheia "questions" conține cele 5 obiecte:
{
  "questions": [
    {
      "statement": "enunțul întrebării (formule LaTeX între $...$)",
      "options": ["varianta a", "varianta b", "varianta c", "varianta d"],
      "answer": 0,
      "explanation": "de ce e corect (scurt)"
    }
  ]
}
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
      messages: [{ role: 'user', content: `Generează obiectul JSON cu cele 5 întrebări acum. Fă-le DIFERITE de generările anterioare (alte numere, alte contexte, altă ordine). Sesiune #${Math.random().toString(36).slice(2, 8)}.` }],
      temperature: 0.9, maxTokens: 2200, json: true, model: ai.GEN_MODEL,
    });
    await ai.logUsage(supa, userId, 'ai-generate-interactive', usage);

    let questions = safeParse(text);
    // modelele în modul JSON întorc un OBIECT — despachetăm orice formă:
    // {"questions":[...]}, {"intrebari":[...]}, sau {"1":{...},"2":{...}}
    if (questions && !Array.isArray(questions) && typeof questions === 'object') {
      questions = Object.values(questions).find(Array.isArray)
        || Object.values(questions).filter((v) => v && typeof v === 'object' && (v.statement || v.enunt));
    }
    if (!Array.isArray(questions) || !questions.length) {
      console.error('ai-generate-interactive: răspuns neparsabil:', String(text).slice(0, 300));
      return res.status(502).json({ error: 'Generatorul nu a produs întrebări valide. Mai încearcă o dată.' });
    }
    // normalizează + VALIDEAZĂ: fără întrebări cu enunț gol, grile fără opțiuni
    // sau răspunsuri lipsă. Altfel clientul primea `questions: []` cu 200 și
    // randa o pagină albă.
    questions = questions.slice(0, 8).map((q) => ({
      statement: String(q.statement || '').trim(),
      options: Array.isArray(q.options) ? q.options.map((o) => String(o)) : undefined,
      answer: Array.isArray(q.options) ? Number(q.answer) || 0 : String(q.answer ?? '').trim(),
      explanation: q.explanation ? String(q.explanation) : '',
    })).filter((q) => {
      if (q.statement.length < 6) return false;
      if (q.options) return q.options.length >= 2 && q.answer >= 0 && q.answer < q.options.length;
      return String(q.answer).length > 0;
    });
    if (!questions.length) {
      return res.status(502).json({ error: 'Generatorul nu a produs întrebări valide. Mai încearcă o dată.' });
    }

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
