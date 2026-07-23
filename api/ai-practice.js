// =====================================================================
// api/ai-practice.js — generator + verificator de exerciții (efemer)
//
// action='generate': { userId, category?, topic?, difficulty? }
//    → { exercise: {statement, topic, difficulty, hints[]}, token }
//      (răspunsul corect NU se trimite acum; e ascuns în `token` semnat)
//
// action='check': { userId, token, studentAnswer, studentWork? }
//    → { correct, score, feedback, solution }  + actualizează stăpânirea
//
// Exercițiile sunt EFEMERE: nu se salvează în baza de date.
// =====================================================================
const ai = require('./_lib/ai');

module.exports = async function handler(req, res) {
  ai.applyCors(res);
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method Not Allowed' });

  const supa = ai.admin();
  try {
    const { action } = req.body || {};
    if (action === 'generate') return await generate(req, res, supa);
    if (action === 'check') return await check(req, res, supa);
    if (action === 'reveal') return await reveal(req, res, supa);
    return res.status(400).json({ error: "action trebuie să fie 'generate', 'check' sau 'reveal'" });
  } catch (err) {
    console.error('ai-practice error:', err);
    return res.status(err.status || 500).json({ error: err.message || 'Eroare server' });
  }
};

// ─── Generează un exercițiu nou, de tipul celor din baza de date ─────────────
async function generate(req, res, supa) {
  const userId = await ai.authUser(req, supa);
  const { category = null, topic = '', difficulty = 'mediu' } = req.body || {};
  const profile = await ai.requireUser(supa, userId);
  await ai.enforceRateLimit(supa, userId);
  await ai.enforceFreeQuota(supa, profile);
  const premium = ai.isPremium(profile);

  // Aducem exemple similare ca șabloane de stil/dificultate.
  const q = [topic, category, 'exercițiu matematică'].filter(Boolean).join(' ');
  const docs = await ai.retrieve(supa, { query: q, category, allowPremium: premium, k: 5, prefer: 'exercise' });
  const examples = ai.contextBlock(docs);

  const system = `${ai.PERSONA}

Sarcină: generează UN exercițiu NOU de matematică, original, în stilul exemplelor de mai jos (aceeași notație, același nivel, aceeași structură), dar cu numere/date diferite.

=== EXEMPLE DIN BAZA DE DATE ===
${examples}
=== SFÂRȘIT EXEMPLE ===

Cerințe:
- Subiect: ${topic || 'potrivit categoriei'} ${category ? '(categoria: ' + category + ')' : ''}.
- Dificultate: ${difficulty}.
- Exercițiul trebuie să fie complet rezolvabil și fără ambiguități.
- Scrie formulele matematice în LaTeX, între $...$ (inline) sau $$...$$ (pe rând). Ex: $\\frac{a}{b}$, $x^2$, $\\sqrt{5}$.
- Răspunde STRICT cu un obiect JSON, fără text în plus, cu cheile:
  {
    "statement": "enunțul exercițiului",
    "topic": "subiectul fin (ex: ecuatii_gradul_1)",
    "difficulty": "${difficulty}",
    "answer_type": "numeric | text | choice",
    "options": ["A", "B", "C", "D"],
    "hints": ["indiciu 1", "indiciu 2"],
    "final_answer": "răspunsul final, scurt (dacă answer_type='choice', pune exact una dintre opțiuni)",
    "solution": "rezolvarea completă, pas cu pas"
  }
  (folosește "options" doar când answer_type='choice'; pentru "numeric" răspunsul final trebuie să fie un număr)`;

  const { text, usage } = await ai.chat({
    system,
    messages: [{ role: 'user', content: `Generează exercițiul acum în format JSON. Fă-l DIFERIT de cele anterioare (alte numere, alt context). #${Math.random().toString(36).slice(2, 8)}.` }],
    temperature: 0.95, maxTokens: 1100, json: true, model: ai.GEN_MODEL,
  });
  await ai.logUsage(supa, userId, 'ai-practice:generate', usage);

  let parsed;
  try { parsed = JSON.parse(text); }
  catch { return res.status(502).json({ error: 'Generatorul a returnat un format invalid. Mai încearcă o dată.' }); }

  // Token semnat: păstrează răspunsul/soluția pentru verificare, fără DB.
  const token = ai.signToken({
    answer: parsed.final_answer || '',
    solution: parsed.solution || '',
    topic: parsed.topic || topic || 'general',
    category: category || 'general',
    statement: parsed.statement || '',
    answer_type: parsed.answer_type || 'text',
    options: Array.isArray(parsed.options) ? parsed.options : [],
    ts: Date.now(),
  });

  return res.status(200).json({
    exercise: {
      statement: parsed.statement,
      topic: parsed.topic || topic,
      difficulty: parsed.difficulty || difficulty,
      answer_type: parsed.answer_type || 'text',
      options: Array.isArray(parsed.options) ? parsed.options : [],
      hints: Array.isArray(parsed.hints) ? parsed.hints : [],
    },
    token,
  });
}

// ─── Verifică rezolvarea elevului ────────────────────────────────────────────
async function check(req, res, supa) {
  const userId = await ai.authUser(req, supa);
  const { token, studentAnswer = '', studentWork = '' } = req.body || {};
  const profile = await ai.requireUser(supa, userId);
  await ai.enforceRateLimit(supa, userId);
  await ai.enforceFreeQuota(supa, profile);

  const data = ai.verifyToken(token);
  if (!data) return res.status(400).json({ error: 'Token invalid sau expirat. Generează din nou exercițiul.' });

  const system = `${ai.PERSONA}

Sarcină: ești profesor și corectezi răspunsul unui elev la un exercițiu.

ENUNȚ: ${data.statement}
RĂSPUNS CORECT (de referință): ${data.answer}
REZOLVARE DE REFERINȚĂ: ${data.solution}

RĂSPUNSUL ELEVULUI: ${studentAnswer || '(nu a scris un răspuns final)'}
LUCRAREA ELEVULUI: ${studentWork || '(fără pași)'}

Evaluează matematic (echivalențe acceptate, ex: 1/2 = 0,5). Fii încurajator, dar corect.
Răspunde STRICT cu JSON:
{
  "correct": true/false,
  "score": 0-100,
  "feedback": "feedback scurt, prietenos; dacă e greșit, arată unde s-a greșit și pasul corect",
  "solution": "rezolvarea corectă pas cu pas (pe scurt)"
}`;

  const { text, usage } = await ai.chat({
    system,
    messages: [{ role: 'user', content: 'Corectează și răspunde în format JSON.' }],
    temperature: 0.2, maxTokens: 800, json: true, model: ai.GEN_MODEL,
  });
  await ai.logUsage(supa, userId, 'ai-practice:check', usage);

  let parsed;
  try { parsed = JSON.parse(text); }
  catch { return res.status(502).json({ error: 'Verificatorul a returnat un format invalid. Mai încearcă.' }); }

  // Actualizăm stăpânirea competenței (medie exponențială).
  try {
    await supa.rpc('bump_skill_mastery', {
      p_user: userId, p_category: data.category, p_topic: data.topic, p_correct: !!parsed.correct,
    });

    // Detecție stagnare: dacă elevul rămâne slab la subiect după mai multe încercări,
    // anunțăm profesorii lui (cu dedup pe 7 zile).
    const { data: sk } = await supa.from('ai_skill_mastery')
      .select('mastery, attempts').eq('user_id', userId)
      .eq('category', data.category || 'general').eq('topic', data.topic).single();
    if (sk && sk.attempts >= 4 && Number(sk.mastery) < 0.5) {
      const teachers = await ai.teachersOf(supa, userId);
      const { data: prof } = await supa.from('profiles').select('full_name, email').eq('id', userId).single();
      const who = prof?.full_name || prof?.email || 'Un elev';
      for (const tId of teachers) {
        await ai.createNotification(supa, {
          recipientId: tId,
          type: 'stagnation',
          title: `${who} stagnează la „${data.topic}"`,
          body: `Stăpânire ${Math.round(Number(sk.mastery) * 100)}% după ${sk.attempts} încercări. Poate are nevoie de ajutor la acest subiect.`,
          data: { studentId: userId, topic: data.topic, category: data.category, mastery: Number(sk.mastery), attempts: sk.attempts },
          dedupeKey: `stagnation:${userId}:${data.category || 'general'}:${data.topic}`,
          dedupeDays: 7,
        });
      }
    }
  } catch (e) { console.warn('mastery/notify update failed:', e.message); }

  return res.status(200).json({
    correct: !!parsed.correct,
    score: Math.max(0, Math.min(100, parseInt(parsed.score, 10) || 0)),
    feedback: parsed.feedback || '',
    solution: parsed.solution || data.solution,
    topic: data.topic,
  });
}

// ─── Dezvăluie exercițiul complet (pentru export PDF / interactiv) ───────────
// Doar pentru abonați. Întoarce enunțul + răspunsul + rezolvarea din token.
async function reveal(req, res, supa) {
  const userId = await ai.authUser(req, supa);
  const { token } = req.body || {};
  const profile = await ai.requireUser(supa, userId);
  ai.requirePremium(profile);
  const data = ai.verifyToken(token);
  if (!data) return res.status(400).json({ error: 'Token invalid sau expirat. Generează din nou exercițiul.' });
  return res.status(200).json({
    statement: data.statement,
    answer: data.answer,
    solution: data.solution,
    topic: data.topic,
    category: data.category,
    answer_type: data.answer_type || 'text',
    options: Array.isArray(data.options) ? data.options : [],
  });
}
