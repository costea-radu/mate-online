// =====================================================================
// api/ai-feedback.js — feedback pe răspunsurile AI (👍 / 👎)
// Body: { userId, messageId, value (1 | -1), note? }
// =====================================================================
const ai = require('./_lib/ai');

module.exports = async function handler(req, res) {
  ai.applyCors(res);
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method Not Allowed' });

  const supa = ai.admin();
  try {
    const { userId, messageId, value, note = null } = req.body || {};
    await ai.requireUser(supa, userId);
    if (!messageId || ![1, -1].includes(value)) return res.status(400).json({ error: 'messageId și value (1 sau -1) obligatorii' });

    // Verificăm că mesajul aparține unei conversații a utilizatorului.
    const { data: msg } = await supa.from('ai_messages')
      .select('id, conversation_id, ai_conversations!inner(user_id)')
      .eq('id', messageId).single();
    if (!msg || msg.ai_conversations?.user_id !== userId) {
      return res.status(403).json({ error: 'Mesaj inexistent sau neautorizat' });
    }

    const { error } = await supa.from('ai_feedback')
      .upsert({ message_id: messageId, user_id: userId, value, note }, { onConflict: 'message_id,user_id' });
    if (error) return res.status(500).json({ error: error.message });

    return res.status(200).json({ ok: true });
  } catch (err) {
    console.error('ai-feedback error:', err);
    return res.status(err.status || 500).json({ error: err.message || 'Eroare server' });
  }
};
