// =====================================================================
// api/ai-generate-interactive.js — generează un EXERCIȚIU INTERACTIV (HTML)
// Body: { userId, category?, topic?, difficulty? }
// Răspuns: { html, title, topic }
//
// HTML-ul e autonom (CSS/JS inline) și raportează scorul către platformă prin
//   window.parent.postMessage({ type:'MATE_SCORE', score, maxScore }, '*')
// exact ca exercițiile interactive existente. Admin sau abonat.
// =====================================================================
const ai = require('./_lib/ai');

module.exports = async function handler(req, res) {
  ai.applyCors(res);
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method Not Allowed' });

  const supa = ai.admin();
  try {
    const { userId, category = null, topic = '', difficulty = 'mediu' } = req.body || {};
    const profile = await ai.requireUser(supa, userId);
    if (!profile.is_admin) ai.requirePremium(profile); // adminii pot oricând; altfel doar abonații
    await ai.enforceRateLimit(supa, userId);

    const q = [topic, category, 'exercițiu matematică'].filter(Boolean).join(' ');
    const docs = await ai.retrieve(supa, { query: q, category, allowPremium: true, k: 5, prefer: 'exercise' });
    const examples = ai.contextBlock(docs);

    const system = `${ai.PERSONA}

Sarcină: creează UN exercițiu interactiv de matematică, ca o pagină HTML completă și autonomă, în stilul exemplelor din baza de date.

=== EXEMPLE DIN BAZA DE DATE (temă/stil) ===
${examples}
=== SFÂRȘIT ===

CONTRACT TEHNIC OBLIGATORIU (respectă-l exact):
1. Returnează UN SINGUR document HTML complet: <!DOCTYPE html> ... </html>. Fără explicații, fără blocuri de cod markdown.
2. Tot CSS-ul și JS-ul sunt INLINE (fără fișiere externe), cu excepția KaTeX care se poate încărca din CDN:
   <link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/katex@0.16.11/dist/katex.min.css">
   <script src="https://cdn.jsdelivr.net/npm/katex@0.16.11/dist/katex.min.js"></script>
   <script src="https://cdn.jsdelivr.net/npm/katex@0.16.11/dist/contrib/auto-render.min.js"></script>
   și la final: document.addEventListener('DOMContentLoaded', () => renderMathInElement(document.body, {delimiters:[{left:'$$',right:'$$',display:true},{left:'$',right:'$',display:false}]}));
3. Exercițiul are 4–6 întrebări (grilă cu variante SAU input numeric). Elevul răspunde, apasă un buton „Verifică", iar pagina afișează corect/greșit și scorul.
4. La final (după verificare) trimite OBLIGATORIU scorul către platformă:
   window.parent.postMessage({ type: 'MATE_SCORE', score: <întreg>, maxScore: <întreg> }, '*');
   unde score = nr. răspunsuri corecte, maxScore = nr. total întrebări (numere ÎNTREGI).
5. Design curat, responsive, culori sobre (bleumarin #0f2b44, auriu #e8b931, fundal alb/crem). Font sans-serif de sistem.
6. Formulele se scriu în LaTeX ($...$). Matematica trebuie să fie corectă, iar răspunsurile marcate corect.
7. Respectă cât mai fidel exercițiile-model din baza de date (tip, stil, dificultate), schimbând doar minim datele. La geometrie, include o FIGURĂ simplă desenată în SVG inline (puncte, laturi, unghiuri etichetate), similară cu modelul.
8. Subiect: ${topic || 'potrivit categoriei'}${category ? ' · categoria ' + category : ''}. Dificultate: ${difficulty}.

Începe direct cu <!DOCTYPE html>.`;

    const { text, usage } = await ai.chat({
      system,
      messages: [{ role: 'user', content: 'Generează pagina HTML completă a exercițiului interactiv acum.' }],
      temperature: 0.7, maxTokens: 3600,
    });
    await ai.logUsage(supa, userId, 'ai-generate-interactive', usage);

    // Curățăm eventualele garduri de cod ```html ... ```
    let html = (text || '').trim();
    const fence = html.match(/```(?:html)?\s*([\s\S]*?)```/i);
    if (fence) html = fence[1].trim();
    if (!/<!doctype html>/i.test(html) && !/<html/i.test(html)) {
      return res.status(502).json({ error: 'Generatorul nu a produs HTML valid. Mai încearcă o dată.' });
    }
    // Plasă de siguranță: dacă lipsește postMessage-ul cu scorul, avertizăm în consolă (nu blocăm).
    const hasScore = /MATE_SCORE/.test(html);

    return res.status(200).json({
      html,
      title: `Exercițiu interactiv · ${topic || category || 'matematică'}`,
      topic: topic || null,
      warning: hasScore ? null : 'Atenție: HTML-ul generat nu pare să trimită scorul (MATE_SCORE). Verifică înainte de salvare.',
    });
  } catch (err) {
    console.error('ai-generate-interactive error:', err);
    return res.status(err.status || 500).json({ error: err.message || 'Eroare server', code: err.code || null });
  }
};
