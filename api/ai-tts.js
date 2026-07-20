// =====================================================================
// api/ai-tts.js — glasul Profesorului Virtual (text → voce, pe server)
// Body: { userId, text, voice? }
// Răspuns: { audioBase64, mime }
//
// De ce pe server: vocile din browser diferă de la un dispozitiv la altul
// (pe telefon, vocea românească din sistem e de obicei feminină). Sintetizând
// pe server, glasul e IDENTIC peste tot: masculin, grav, ton de narator.
// Nu consumă din acțiunile gratuite (vezi enforceFreeQuota).
// =====================================================================
const ai = require('./_lib/ai');

const MAX_CHARS = 3800;

module.exports = async function handler(req, res) {
  ai.applyCors(res);
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method Not Allowed' });

  const supa = ai.admin();
  try {
    const userId = await ai.authUser(req, supa);
    await ai.requireUser(supa, userId);
    await ai.enforceRateLimit(supa, userId);

    const { text, voice } = req.body || {};
    const clean = String(text || '').trim();
    if (!clean) return res.status(400).json({ error: 'text obligatoriu' });
    if (!ai.hasTTS()) return res.status(501).json({ error: 'TTS neconfigurat pe server' });

    const audio = await ai.tts({ text: clean.slice(0, MAX_CHARS), voice: voice || undefined });
    await ai.logUsage(supa, userId, 'ai-tts', { in: 0, out: Math.ceil(clean.length / 4) });

    return res.status(200).json({ audioBase64: audio.toString('base64'), mime: 'audio/mpeg' });
  } catch (err) {
    console.error('ai-tts error:', err);
    return res.status(err.status || 500).json({ error: err.message || 'Eroare server' });
  }
};
