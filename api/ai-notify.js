// =====================================================================
// api/ai-notify.js — notificări in-app
//
// POST { userId, action }
//   action='list'         → { notifications[] }   (ale destinatarului)
//   action='unread_count' → { count }
//   action='read'         → { ok }  (body: notificationId? sau all:true)
//   action='scan'         → (admin/cron) detectează stagnări și creează alerte
//
// CRON (opțional): GET /api/ai-notify?action=scan&secret=AI_CRON_SECRET
// =====================================================================
const ai = require('./_lib/ai');

async function scan(supa) {
  // Toți elevii care stagnează (mastery<0.5 după >=4 încercări), activi recent.
  const since = new Date(Date.now() - 30 * 86400 * 1000).toISOString();
  const { data: rows } = await supa.from('ai_skill_mastery')
    .select('user_id, category, topic, mastery, attempts, last_interaction')
    .lt('mastery', 0.5).gte('attempts', 4).gte('last_interaction', since);

  let created = 0;
  for (const r of rows || []) {
    const teachers = await ai.teachersOf(supa, r.user_id);
    if (!teachers.length) continue;
    const { data: prof } = await supa.from('profiles').select('full_name, email').eq('id', r.user_id).single();
    const who = prof?.full_name || prof?.email || 'Un elev';
    for (const tId of teachers) {
      const ok = await ai.createNotification(supa, {
        recipientId: tId, type: 'stagnation',
        title: `${who} stagnează la „${r.topic}"`,
        body: `Stăpânire ${Math.round(Number(r.mastery) * 100)}% după ${r.attempts} încercări.`,
        data: { studentId: r.user_id, topic: r.topic, category: r.category, mastery: Number(r.mastery), attempts: r.attempts },
        dedupeKey: `stagnation:${r.user_id}:${r.category || 'general'}:${r.topic}`, dedupeDays: 7,
      });
      if (ok) created++;
    }
  }
  return { scanned: (rows || []).length, created };
}

module.exports = async function handler(req, res) {
  ai.applyCors(res);
  if (req.method === 'OPTIONS') return res.status(204).end();

  const supa = ai.admin();
  try {
    // CRON: GET ?action=scan
    if (req.method === 'GET') {
      const cronOk = req.headers['x-vercel-cron'] || (process.env.AI_CRON_SECRET && req.query.secret === process.env.AI_CRON_SECRET);
      if (req.query.action === 'scan' && cronOk) return res.status(200).json(await scan(supa));
      return res.status(403).json({ error: 'Neautorizat' });
    }
    if (req.method !== 'POST') return res.status(405).json({ error: 'Method Not Allowed' });

    const { userId, action = 'list', notificationId, all } = req.body || {};
    const profile = await ai.requireUser(supa, userId);

    if (action === 'list') {
      const { data } = await supa.from('ai_notifications')
        .select('id, type, title, body, data, read, created_at')
        .eq('recipient_id', userId).order('created_at', { ascending: false }).limit(30);
      return res.status(200).json({ notifications: data || [] });
    }
    if (action === 'unread_count') {
      const { count } = await supa.from('ai_notifications')
        .select('*', { count: 'exact', head: true }).eq('recipient_id', userId).eq('read', false);
      return res.status(200).json({ count: count || 0 });
    }
    if (action === 'read') {
      let q = supa.from('ai_notifications').update({ read: true }).eq('recipient_id', userId);
      if (!all) { if (!notificationId) return res.status(400).json({ error: 'notificationId sau all:true' }); q = q.eq('id', notificationId); }
      const { error } = await q;
      if (error) return res.status(500).json({ error: error.message });
      return res.status(200).json({ ok: true });
    }
    if (action === 'scan') {
      if (!profile.is_admin) return res.status(403).json({ error: 'Doar adminul poate scana manual.' });
      return res.status(200).json(await scan(supa));
    }
    return res.status(400).json({ error: 'action invalid' });
  } catch (err) {
    console.error('ai-notify error:', err);
    return res.status(err.status || 500).json({ error: err.message || 'Eroare server' });
  }
};
