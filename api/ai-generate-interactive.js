// =====================================================================
// api/ai-generate-interactive.js — generează un EXERCIȚIU sau un TEST
// INTERACTIV, STRUCTURAT (listă de întrebări), ca să poată fi editat ca
// text (fără HTML), completat cu adăugare/ștergere de întrebări, deschis
// interactiv sau exportat PDF (variantă elev / cu barem — examPrint).
// Body: { userId, category?, topic?, difficulty?, dataMode?, chapters?,
//         kind?: 'exercitiu' (implicit, ~5 întrebări) | 'test',
//         count?: numărul de itemi ai TESTULUI (4–24, ales de profesor) }
// Răspuns: { questions:[{statement, options?, answer, explanation?}], kind, title, topic }
// Randarea în HTML interactiv se face pe client (src/lib/quizRender.js).
// =====================================================================
const ai = require('./_lib/ai');
const med = require('./_lib/meditatii'); // verifyQuestionSet (validare + verificator independent)
const { pdfText, storagePath, modeLine, cutBarem } = require('./_lib/pdftext');
const { S } = ai;

// Schema STRICTĂ a răspunsului (Structured Outputs): JSON garantat valid,
// „answer" = index (grilă) sau text (răspuns liber) — nu mai poate fi „b".
const QUESTIONS_SCHEMA = S.obj({
  questions: S.arr(S.obj({
    statement: S.str('enunțul întrebării (formule LaTeX între $...$)'),
    options: S.nullable(S.arr(S.str(), 'exact 4 variante la grilă; null la răspuns liber')),
    answer: { anyOf: [{ type: 'integer' }, { type: 'string' }], description: 'indexul variantei corecte (0–3) la grilă; textul răspunsului la răspuns liber' },
    explanation: S.str('de ce e corect (scurt) / redactarea model'),
  })),
});

const { answerIndex } = ai; // index valid (0–3) sau literă a–d → index; altfel null

module.exports = async function handler(req, res) {
  ai.applyCors(res);
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method Not Allowed' });

  const supa = ai.admin();
  try {
    const userId = await ai.authUser(req, supa);
    const { category = null, topic = '', difficulty = 'mediu', dataMode = 'modify' } = req.body || {};
    // capitolele alese de profesor (titluri) — întrebările vin DOAR din ele
    const chapters = (Array.isArray(req.body?.chapters) ? req.body.chapters : [])
      .map((c) => String(c || '').replace(/\s+/g, ' ').trim().slice(0, 140)).filter(Boolean).slice(0, 12);
    // EXERCIȚIU (implicit, ca până acum: ~5 întrebări, max 8) sau TEST cu un
    // NUMĂR DE ITEMI ales direct de profesor (4–24)
    const kind = req.body?.kind === 'test' ? 'test' : 'exercitiu';
    const countReq = parseInt(req.body?.count, 10);
    const count = kind === 'test' ? Math.min(24, Math.max(4, Number.isFinite(countReq) ? countReq : 10)) : null;
    const maxItems = kind === 'test' ? count : 8;
    // tipul itemilor: mixt (implicit) / doar grilă / doar cu redactarea răspunsului
    const qtype = ['grila', 'redactare'].includes(req.body?.qtype) ? req.body.qtype : 'mixt';
    const profile = await ai.requireUser(supa, userId);
    if (!profile.is_admin) ai.requirePremium(profile);
    const lim = await ai.enforceRateLimit(supa, userId, profile); // limite orare + bugete
    await ai.enforceFeatureQuota(supa, userId, profile, 'interactive', lim); // cota lunară

    // „Subiect + instrucțiuni": câmpul acceptă un prompt amplu de la profesor
    // (temă + cerințe pentru AI). Versiunea integrală intră în promptul de
    // generare; pentru căutarea în baza de date și pentru titlu folosim doar
    // prima linie (scurtă).
    const topicFull = String(topic || '').trim().slice(0, 2500);
    const topicShort = (topicFull.split(/\r?\n/)[0] || '').replace(/\s+/g, ' ').trim().slice(0, 120);

    const q = [topicShort, chapters.join(' '), category, 'exercițiu matematică'].filter(Boolean).join(' ');
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
          // planul acoperă numărul de itemi cerut (test cu N itemi) sau 5 (exercițiu)
          plan = Array.from({ length: kind === 'test' ? count : 5 }, (_, i) => `- Întrebarea ${i + 1} ← SURSA ${letters[i % letters.length]}, un exercițiu ales aleatoriu din ea.`).join('\n');
        }
      } catch { /* fără surse */ }
    }

    const taskLine = kind === 'test'
      ? `Sarcină: creează un TEST de matematică cu EXACT ${count} itemi (întrebări numerotate), în stilul exemplelor din baza de date, de la mai simplu la mai complex — ca o lucrare de verificare. Scrie TOȚI cei ${count} itemi, fără să te oprești mai devreme.`
      : 'Sarcină: creează un set de întrebări de matematică pentru un exercițiu interactiv, în stilul exemplelor din baza de date. Implicit 5 întrebări; dacă profesorul cere alt număr în instrucțiunile lui, respectă-l (minim 3, maxim 8).';
    const system = `${ai.PERSONA}

${taskLine}

=== EXEMPLE DIN BAZA DE DATE (temă/stil) ===
${examples}
=== SFÂRȘIT ===
${srcBlock ? `\n=== SUBIECTE REALE DIN CATEGORIE (sursa itemilor — antrenament/variante/simulări) ===\n${srcBlock}\n=== SFÂRȘIT SURSE ===\nPLAN (tras la sorți — respectă-l): fiecare întrebare vine din sursa indicată:\n${plan}\n` : ''}
REGIM DE LUCRU CU DATELE: ${modeLine(dataMode)}

Răspunde STRICT cu un OBIECT JSON valid (fără text în plus, fără markdown), cu EXACT această formă — cheia "questions" conține obiectele-întrebare:
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
${qtype === 'grila'
    ? `- TOATE întrebările sunt GRILĂ: "options" cu exact 4 variante și "answer" = INDEXUL variantei corecte (0,1,2,3). DISTRIBUIE răspunsul corect aleatoriu între cele 4 poziții (nu mereu 0). Variantele greșite trebuie să fie plauzibile (greșeli tipice de calcul). NU face nicio întrebare cu răspuns liber.`
    : qtype === 'redactare'
      ? `- TOATE întrebările sunt CU REDACTAREA RĂSPUNSULUI (fără variante): OMITE complet "options"; "answer" = răspunsul final, scurt, ca text (ex: "12", "x=3", "aria = 24 cm²"); "explanation" = REDACTAREA MODEL a rezolvării, pas cu pas, cum ar scrie-o elevul pe foaie (ea apare la barem). NU face nicio întrebare grilă.`
      : `- Majoritatea întrebărilor cu "options" (grilă, exact 4 variante) și "answer" = INDEXUL variantei corecte (0,1,2,3). DISTRIBUIE răspunsul corect aleatoriu între cele 4 poziții (nu mereu 0).
- Poți face și întrebări cu răspuns liber: OMITE "options" și pune "answer" ca text (ex: "12" sau "x=3").`}
- Respectă cât mai fidel exercițiile-model (tip, stil, dificultate), schimbând doar minim datele.
- Subiect: ${topicShort || 'potrivit categoriei'}${category ? ' · categoria ' + category : ''}. Dificultate: ${difficulty}.
- Folosește „·" (\\cdot în LaTeX) pentru înmulțire, NICIODATĂ × sau litera x.
- Variază: la cereri repetate pentru același model, generează exerciții DIFERITE (alte valori, alt context).${chapters.length ? `
- CAPITOLELE CERUTE DE PROFESOR (restricție OBLIGATORIE de conținut): ${chapters.join(' · ')}. TOATE întrebările provin EXCLUSIV din aceste capitole — dacă o sursă sau planul indică un exercițiu din alt capitol, alege/compune în loc unul din capitolele cerute, în același stil.` : ''}
- IMPORTANT JSON valid: scrie fiecare backslash din LaTeX de DOUĂ ori. Ex: pentru fracție "$\\\\frac{1}{2}$", radical "$\\\\sqrt{9}$".${topicFull ? `

SUBIECT + INSTRUCȚIUNI DE LA PROFESOR — au PRIORITATE față de regulile de stil și de plan de mai sus (temă, tipuri de întrebări, număr de întrebări, dificultate, restricții asupra numerelor, contexte etc.); respectă-le întocmai, păstrând DOAR formatul JSON cerut:
"""
${topicFull}
"""` : ''}`;

    // bugetul de tokeni crește cu numărul de itemi (un item ≈ 350–450 tokeni cu
    // opțiuni + explicație); la 3200, testele de 15–24 itemi s-ar trunchia.
    // Redactările model (qtype='redactare') sunt mai lungi → buget mai mare.
    const perItem = qtype === 'redactare' ? 600 : 450;
    const base = qtype === 'redactare' ? 4000 : 3200;
    const maxTokens = maxItems <= 8 ? base : Math.min(12000, base + (maxItems - 8) * perItem);
    let data, usage, text;
    try {
      ({ data, usage, text } = await ai.chatJson({
        system,
        messages: [{ role: 'user', content: `Generează obiectul JSON cu ${kind === 'test' ? `TESTUL de ${count} itemi` : 'întrebările'} acum${topicFull ? ', respectând întocmai subiectul și instrucțiunile profesorului' : ''}. Fă-le DIFERITE de generările anterioare (alte numere, alte contexte, altă ordine). Sesiune #${Math.random().toString(36).slice(2, 8)}.` }],
        temperature: 0.9, maxTokens,
        model: ai.pickModel(ai.GEN_MODEL, lim), // peste bugetul zilnic → model standard
        schema: QUESTIONS_SCHEMA, schemaName: 'intrebari_interactive',
      }));
    } catch (e) {
      if (e.usage) await ai.logUsage(supa, userId, 'ai-generate-interactive', e.usage);
      if (e.status === 502) return res.status(502).json({ error: 'Generatorul nu a produs întrebări valide. Mai încearcă o dată.' });
      throw e;
    }
    await ai.logUsage(supa, userId, 'ai-generate-interactive', usage);

    let questions = data;
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
    // randa o pagină albă. (plafonul urmează numărul de itemi cerut la teste)
    // La grilă, „answer" trebuie să fie un index valid (sau o literă a–d) —
    // înainte, `Number("b") || 0` transforma tăcut o literă în indexul 0 (cheie greșită).
    questions = questions.slice(0, maxItems).map((q) => {
      const options = Array.isArray(q.options) && q.options.length ? q.options.map((o) => String(o)) : undefined;
      return {
        statement: String(q.statement || '').trim(),
        options,
        answer: options ? answerIndex(q.answer, options.length) : String(q.answer ?? '').trim(),
        explanation: q.explanation ? String(q.explanation) : '',
      };
    }).filter((q) => {
      if (q.statement.length < 6) return false;
      if (q.options) return q.options.length >= 2 && Number.isInteger(q.answer);
      return String(q.answer).length > 0;
    });
    if (!questions.length) {
      return res.status(502).json({ error: 'Generatorul nu a produs întrebări valide. Mai încearcă o dată.' });
    }
    // tipul de itemi cerut strict (doar grilă / doar redactare): păstrăm doar
    // itemii de tipul cerut — DAR nu aruncăm tot setul pentru 1-2 scăpări ale
    // modelului (filtrăm doar dacă rămân destui)
    if (qtype !== 'mixt') {
      const wanted = questions.filter((q) => (qtype === 'grila' ? Array.isArray(q.options) : !q.options));
      if (wanted.length >= Math.min(3, questions.length)) questions = wanted;
    }
    // un „test" cu prea puține întrebări valide față de cerere = răspuns
    // trunchiat — mai bine eroare cu retry decât un test pe jumătate
    if (kind === 'test' && questions.length < Math.min(4, count)) {
      return res.status(502).json({ error: 'Testul a ieșit incomplet. Mai încearcă o dată (sau alege mai puțini itemi).' });
    }

    // ── Etapa 2 (1.3): validare structurală (duplicate, LaTeX, variante) +
    //    VERIFICATOR INDEPENDENT (al doilea apel rezolvă fiecare întrebare fără
    //    cheie); întrebările cu răspuns neconfirmat se ELIMINĂ, iar la teste cu
    //    număr fix de itemi se cer înlocuitori (o singură rundă). ──
    const checked = await med.verifyQuestionSet(questions, {
      model: ai.pickModel(ai.GEN_MODEL, lim), supa, userId, endpoint: 'ai-generate-interactive:verify',
      wantCount: kind === 'test' ? count : null, qtype,
      regenContext: `Subiect: ${topicShort || chapters.join(', ') || category || 'matematică'}. Dificultate: ${difficulty}.${chapters.length ? ` Capitole: ${chapters.join(' · ')}.` : ''}`,
    });
    questions = checked.questions;
    if (!questions.length) {
      return res.status(502).json({ error: 'Întrebările generate nu au trecut verificarea automată. Mai încearcă o dată.' });
    }

    return res.status(200).json({
      questions,
      kind,
      title: `${kind === 'test' ? `Test (${questions.length} itemi)` : 'Exercițiu interactiv'} · ${topicShort || chapters[0] || category || 'matematică'}`,
      topic: topicShort || chapters[0] || null,
      verification: checked.report,
    });
  } catch (err) {
    console.error('ai-generate-interactive error:', err);
    return res.status(err.status || 500).json({ error: err.message || 'Eroare server', code: err.code || null });
  }
};
