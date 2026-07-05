// =====================================================================
// api/ai-transcribe.js — speech-to-text (fallback, când browserul nu suportă)
// Body: { userId, audioBase64 (data URL sau base64), mime? }
// Răspuns: { text }
// =====================================================================
const ai = require('./_lib/ai');

module.exports = async function handler(req, res) {
  ai.applyCors(res);
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method Not Allowed' });

  const supa = ai.admin();
  try {
    const userId = await ai.authUser(req, supa);
    const { audioBase64, mime = 'audio/webm' } = req.body || {};
    const profile = await ai.requireUser(supa, userId);
    await ai.enforceRateLimit(supa, userId);
    await ai.enforceFreeQuota(supa, profile);
    if (!audioBase64) return res.status(400).json({ error: 'audioBase64 obligatoriu' });

    const b64 = audioBase64.includes(',') ? audioBase64.split(',')[1] : audioBase64;
    const buffer = Buffer.from(b64, 'base64');
    if (buffer.length > 8_000_000) return res.status(413).json({ error: 'Înregistrare prea lungă.' });

    const text = await ai.transcribe({ audioBuffer: buffer, mime, language: 'ro' });
    await ai.logUsage(supa, userId, 'ai-transcribe', {});
    return res.status(200).json({ text: (text || '').trim() });
  } catch (err) {
    console.error('ai-transcribe error:', err);
    return res.status(err.status || 500).json({ error: err.message || 'Eroare server' });
  }
};
