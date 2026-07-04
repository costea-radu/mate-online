// =====================================================================
// api/ai-notify.js — notificări in-app (personale + anunțuri globale)
//
// POST { userId, action }
//   action='list'         → { notifications[] }  (personale + broadcasturi, cu stare citit)
//   action='unread_count' → { count }
//   action='read'         → { ok }  (body: { id, kind } sau { all:true })
//   action='scan'         → (admin/cron) evoluție/stagnare/scădere elevi → alerte
//
// CRON: GET /api/ai-notify?action=scan  (header x-vercel-cron sau ?secret=AI_CRON_SECRET)
// =====================================================================
const ai = require('./_lib/ai');

// ── Scanare progres: stagnare / evoluție / scădere → profesori ȘI părinți ──────
async function scan(supa) {
  const since = new Date(Date.now() - 30 * 86400 * 1000).toISOString();
  const { data: rows } = await supa.from('ai_skill_mastery')
    .select('user_id, category, topic, mastery, attempts, last_interaction')
    .gte('last_interaction', since);
  if (!rows || !rows.length) return { scanned: 0, created: 0 };

  const userIds = [...new Set(rows.map((r) => r.user_id))];
  // snapshoturile anterioare
  const { data: snaps } = await supa.from('ai_mastery_snapshots')
    .select('user_id, topic, mastery').in('user_id', userIds);
  const prevMap = new Map();
  (snaps || []).forEach((s) => prevMap.set(`${s.user_id}:${s.topic}`, Number(s.mastery)));

  // cache mentori + nume per elev
  const mentorsCache = new Map();
  const nameCache = new Map();
  async function mentorsFor(uid) {
    if (!mentorsCache.has(uid)) mentorsCache.set(uid, await ai.mentorsOf(supa, uid));
    return mentorsCache.get(uid);
  }
  async function nameFor(uid) {
    if (!nameCache.has(uid)) {
      const { data: p } = await supa.from('profiles').select('full_name, email').eq('id', uid).single();
      nameCache.set(uid, p?.full_name || p?.email || 'Un elev');
    }
    return nameCache.get(uid);
  }

  let created = 0;
  const upserts = [];
  for (const r of rows) {
    const cur = Number(r.mastery);
    const prev = prevMap.get(`${r.user_id}:${r.topic}`);
    let kind = null, title = null, body = null;

    if (prev != null && prev < 0.5 && cur >= 0.7) {
      kind = 'evolution';
    } else if (prev != null && prev >= 0.6 && cur < 0.45) {
      kind = 'decline';
    } else if (cur < 0.5 && r.attempts >= 4) {
      kind = 'stagnation';
    }

    // pregătește noul snapshot indiferent de rezultat
    upserts.push({ user_id: r.user_id, topic: r.topic, category: r.category, mastery: cur, updated_at: new Date().toISOString() });

    if (!kind) continue;
    const who = await nameFor(r.user_id);
    const pct = Math.round(cur * 100);
    if (kind === 'evolution') { title = `${who} a progresat la „${r.topic}"`; body = `Stăpânire ${pct}% — evoluție bună!`; }
    else if (kind === 'decline') { title = `${who} a scăzut la „${r.topic}"`; body = `Stăpânire ${pct}% — ar putea avea nevoie de ajutor.`; }
    else { title = `${who} stagnează la „${r.topic}"`; body = `Stăpânire ${pct}% după ${r.attempts} încercări.`; }

    const mentors = await mentorsFor(r.user_id);
    for (const mId of mentors) {
      const ok = await ai.createNotification(supa, {
        recipientId: mId, type: kind, title, body,
        data: { studentId: r.user_id, topic: r.topic, category: r.category, mastery: cur, url: '/profil' },
        dedupeKey: `${kind}:${r.user_id}:${r.category || 'general'}:${r.topic}`, dedupeDays: 7,
      });
      if (ok) created++;
    }
  }

  // salvează snapshoturile noi (în loturi)
  for (let i = 0; i < upserts.length; i += 200) {
    await supa.from('ai_mastery_snapshots').upsert(upserts.slice(i, i + 200), { onConflict: 'user_id,topic' });
  }
  return { scanned: rows.length, created };
}

// ── Listă unificată: personale + anunțuri ─────────────────────────────────────
async function buildList(supa, userId, limit = 40) {
  const cutoff = new Date(Date.now() - 60 * 86400 * 1000).toISOString();
  const [{ data: personal }, { data: broadcasts }, { data: reads }] = await Promise.all([
    supa.from('ai_notifications').select('id, type, title, body, data, read, created_at')
      .eq('recipient_id', userId).order('created_at', { ascending: false }).limit(limit),
    supa.from('ai_broadcasts').select('id, type, title, body, data, created_at')
      .gte('created_at', cutoff).order('created_at', { ascending: false }).limit(limit),
    supa.from('ai_broadcast_reads').select('broadcast_id').eq('user_id', userId),
  ]);
  const readSet = new Set((reads || []).map((r) => r.broadcast_id));
  const items = [
    ...(personal || []).map((n) => ({ ...n, kind: 'personal' })),
    ...(broadcasts || []).map((b) => ({ ...b, kind: 'broadcast', read: readSet.has(b.id) })),
  ];
  items.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
  return items.slice(0, limit);
}

module.exports = async function handler(req, res) {
  ai.applyCors(res);
  if (req.method === 'OPTIONS') return res.status(204).end();

  const supa = ai.admin();
  try {
    if (req.method === 'GET') {
      const cronOk = req.headers['x-vercel-cron'] || (process.env.AI_CRON_SECRET && req.query.secret === process.env.AI_CRON_SECRET);
      if (req.query.action === 'scan' && cronOk) return res.status(200).json(await scan(supa));
      return res.status(403).json({ error: 'Neautorizat' });
    }
    if (req.method !== 'POST') return res.status(405).json({ error: 'Method Not Allowed' });

    const { userId, action = 'list', id, notificationId, kind, all } = req.body || {};
    const profile = await ai.requireUser(supa, userId);

    if (action === 'list') {
      return res.status(200).json({ notifications: await buildList(supa, userId) });
    }

    if (action === 'unread_count') {
      const cutoff = new Date(Date.now() - 60 * 86400 * 1000).toISOString();
      const [{ count: pc }, { data: broadcasts }, { data: reads }] = await Promise.all([
        supa.from('ai_notifications').select('*', { count: 'exact', head: true }).eq('recipient_id', userId).eq('read', false),
        supa.from('ai_broadcasts').select('id').gte('created_at', cutoff),
        supa.from('ai_broadcast_reads').select('broadcast_id').eq('user_id', userId),
      ]);
      const readSet = new Set((reads || []).map((r) => r.broadcast_id));
      const broadcastUnread = (broadcasts || []).filter((b) => !readSet.has(b.id)).length;
      return res.status(200).json({ count: (pc || 0) + broadcastUnread });
    }

    if (action === 'read') {
      const itemId = id || notificationId;
      if (all) {
        await supa.from('ai_notifications').update({ read: true }).eq('recipient_id', userId).eq('read', false);
        const cutoff = new Date(Date.now() - 60 * 86400 * 1000).toISOString();
        const { data: broadcasts } = await supa.from('ai_broadcasts').select('id').gte('created_at', cutoff);
        if (broadcasts && broadcasts.length) {
          await supa.from('ai_broadcast_reads').upsert(
            broadcasts.map((b) => ({ broadcast_id: b.id, user_id: userId })), { onConflict: 'broadcast_id,user_id' });
        }
        return res.status(200).json({ ok: true });
      }
      if (!itemId) return res.status(400).json({ error: 'id sau all:true' });
      if (kind === 'broadcast') {
        const { error } = await supa.from('ai_broadcast_reads').upsert({ broadcast_id: itemId, user_id: userId }, { onConflict: 'broadcast_id,user_id' });
        if (error) return res.status(500).json({ error: error.message });
      } else {
        const { error } = await supa.from('ai_notifications').update({ read: true }).eq('recipient_id', userId).eq('id', itemId);
        if (error) return res.status(500).json({ error: error.message });
      }
      return res.status(200).json({ ok: true });
    }

    if (action === 'scan') {
      if (!profile.is_admin) return res.status(403).json({ error: 'Doar adminul poate scana manual.' });
      return res.status(200).json(await scan(supa));
    }

    // Admin: trimite un anunț către toți (ex: update la AI sau o pagină nouă)
    if (action === 'broadcast') {
      if (!profile.is_admin) return res.status(403).json({ error: 'Doar adminul poate trimite anunțuri.' });
      const { title, body = null, url = null, type = 'update' } = req.body || {};
      if (!title || !title.trim()) return res.status(400).json({ error: 'Titlu obligatoriu' });
      const { error } = await supa.from('ai_broadcasts').insert({ type, title: title.trim(), body, data: url ? { url } : {} });
      if (error) return res.status(500).json({ error: error.message });
      return res.status(200).json({ ok: true });
    }

    // Admin: lista anunțurilor trimise
    if (action === 'broadcast_list') {
      if (!profile.is_admin) return res.status(403).json({ error: 'Doar adminul.' });
      const { data } = await supa.from('ai_broadcasts').select('id, type, title, body, created_at')
        .order('created_at', { ascending: false }).limit(50);
      return res.status(200).json({ broadcasts: data || [] });
    }

    // Admin: șterge un anunț trimis
    if (action === 'broadcast_delete') {
      if (!profile.is_admin) return res.status(403).json({ error: 'Doar adminul.' });
      const { id } = req.body || {};
      if (!id) return res.status(400).json({ error: 'id obligatoriu' });
      const { error } = await supa.from('ai_broadcasts').delete().eq('id', id);
      if (error) return res.status(500).json({ error: error.message });
      return res.status(200).json({ ok: true });
    }
    return res.status(400).json({ error: 'action invalid' });
  } catch (err) {
    console.error('ai-notify error:', err);
    return res.status(err.status || 500).json({ error: err.message || 'Eroare server' });
  }
};
