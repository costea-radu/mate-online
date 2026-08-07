// =====================================================================
// api/ai-vision.js — foto-rezolvare: citește exercițiul dintr-o imagine
// Body: { userId, imageBase64 (data URL sau base64), note? }
// Răspuns: { problemText }   (enunțul transcris, în LaTeX)
//
// Imaginea NU se salvează — e procesată și uitată (efemer, privat).
// =====================================================================
const ai = require('./_lib/ai');

module.exports = async function handler(req, res) {
  ai.applyCors(res);
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method Not Allowed' });

  const supa = ai.admin();
  try {
    const userId = await ai.authUser(req, supa);
    const { imageBase64, note } = req.body || {};
    const profile = await ai.requireUser(supa, userId);
    const lim = await ai.enforceRateLimit(supa, userId, profile); // limite orare + bugete
    await ai.enforceFeatureQuota(supa, userId, profile, 'foto', lim); // cota zilnică de foto-rezolvări
    await ai.enforceFreeQuota(supa, profile);

    if (!imageBase64) return res.status(400).json({ error: 'imageBase64 obligatoriu' });
    const dataUrl = imageBase64.startsWith('data:') ? imageBase64 : `data:image/jpeg;base64,${imageBase64}`;

    // Limită de mărime (~4.5MB body pe Vercel). Clientul trimite imaginea deja micșorată.
    const approxBytes = (dataUrl.length * 3) / 4;
    if (approxBytes > 5_000_000) {
      return res.status(413).json({ error: 'Imaginea e prea mare. Fă o poză mai mică sau mai aproape de exercițiu.' });
    }

    const system = `Ești un asistent care transcrie exerciții de matematică din fotografii, pentru elevi români.
- Extrage EXACT enunțul exercițiului din imagine, fără să-l rezolvi.
- Scrie formulele în LaTeX, între $...$ (inline) sau $$...$$ (pe rând).
- Dacă sunt mai multe exerciții, transcrie-le pe toate, numerotate.
- Dacă imaginea nu conține un exercițiu de matematică lizibil, spune scurt: "Nu am putut citi un exercițiu clar în imagine."
- Răspunde DOAR cu enunțul transcris (sau mesajul de mai sus), în limba română.`;

    const { text, usage } = await ai.chatVision({
      system,
      text: note && note.trim() ? note : 'Transcrie exercițiul din imagine, cu formulele în LaTeX.',
      imageDataUrl: dataUrl,
      maxTokens: 800,
    });

    await ai.logUsage(supa, userId, 'ai-vision', usage);
    return res.status(200).json({ problemText: (text || '').trim() });
  } catch (err) {
    console.error('ai-vision error:', err);
    return res.status(err.status || 500).json({ error: err.message || 'Eroare server' });
  }
};
