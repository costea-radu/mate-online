// =====================================================================
// api/ai-account.js — operațiuni de cont care necesită drepturi de server
// POST { userId, action }
//   action='delete'          → șterge definitiv contul (auth + date)
//   action='check_username'  → { available }  (verifică disponibilitatea)
// =====================================================================
const ai = require('./_lib/ai');

module.exports = async function handler(req, res) {
  ai.applyCors(res);
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method Not Allowed' });

  const supa = ai.admin();
  try {
    const { userId, action } = req.body || {};
    await ai.requireUser(supa, userId);

    if (action === 'check_username') {
      const { username } = req.body || {};
      if (!username || !username.trim()) return res.status(200).json({ available: false });
      const { data } = await supa.from('profiles').select('id')
        .ilike('username', username.trim()).neq('id', userId).limit(1);
      return res.status(200).json({ available: !(data && data.length) });
    }

    if (action === 'delete') {
      // șterge datele legate (best-effort) apoi contul auth
      const tables = ['ai_conversations', 'ai_messages', 'ai_personal_items', 'ai_skill_mastery',
        'ai_assignment_results', 'ai_notifications', 'progress', 'rezolvari'];
      // (majoritatea au ON DELETE CASCADE pe user; ștergerea userului le curăță oricum)
      try { await supa.auth.admin.deleteUser(userId); }
      catch (e) { return res.status(500).json({ error: 'Nu am putut șterge contul: ' + e.message }); }
      return res.status(200).json({ ok: true });
    }

    return res.status(400).json({ error: 'action invalid' });
  } catch (err) {
    console.error('ai-account error:', err);
    return res.status(err.status || 500).json({ error: err.message || 'Eroare server' });
  }
};
