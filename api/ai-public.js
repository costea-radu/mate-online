// =====================================================================
// api/ai-public.js — „Biblioteca utilizatorilor" (teste/exerciții publice)
// POST { userId?, action, ... }
//   action='publish' (profesor/admin): { kind, title, category, topic, payload } → { id }
//   action='list'    (public): { q?, category?, limit? } → { items:[...] }
//   action='get'     (public): { id } → { item }
//   action='delete'  (creator/admin): { id } → { ok }
// =====================================================================
const ai = require('./_lib/ai');

function buildSearchText(kind, title, topic, payload) {
  let parts = [title || '', topic || ''];
  if (kind === 'exam' && payload?.exam?.subjects) {
    payload.exam.subjects.forEach((s) => (s.items || []).forEach((it) => parts.push(it.statement || '')));
  } else if (kind === 'practice') {
    parts.push(payload?.statement || '');
  }
  return parts.join(' ').slice(0, 4000);
}

module.exports = async function handler(req, res) {
  ai.applyCors(res);
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method Not Allowed' });

  const supa = ai.admin();
  try {
    const { action } = req.body || {};

    if (action === 'list') {
      const { q = '', category = null, limit = 60 } = req.body || {};
      let query = supa.from('ai_public_library')
        .select('id, kind, title, category, topic, creator_name, creator_role, created_at')
        .order('created_at', { ascending: false }).limit(Math.min(limit, 100));
      if (category) query = query.eq('category', category);
      if (q && q.trim()) query = query.ilike('search_text', `%${q.trim()}%`);
      const { data } = await query;
      return res.status(200).json({ items: data || [] });
    }

    if (action === 'get') {
      const { id } = req.body || {};
      if (!id) return res.status(400).json({ error: 'id obligatoriu' });
      const { data } = await supa.from('ai_public_library').select('*').eq('id', id).single();
      if (!data) return res.status(404).json({ error: 'Nu a fost găsit.' });
      return res.status(200).json({ item: data });
    }

    if (action === 'publish') {
      const { userId, kind, title, category = null, topic = null, payload = {} } = req.body || {};
      const profile = await ai.requireUser(supa, userId);
      // doar profesorii (sau admin) pot publica public
      if (!(profile.role === 'profesor' || profile.is_admin)) {
        return res.status(403).json({ error: 'Doar profesorii pot publica în biblioteca publică.' });
      }
      if (!kind || !title) return res.status(400).json({ error: 'kind și title obligatorii' });
      const { data, error } = await supa.from('ai_public_library').insert({
        created_by: userId, creator_name: profile.full_name || profile.email || 'Profesor',
        creator_role: 'profesor', kind, title, category, topic, payload,
        search_text: buildSearchText(kind, title, topic, payload),
      }).select('id').single();
      if (error) return res.status(500).json({ error: error.message });
      return res.status(200).json({ id: data.id });
    }

    if (action === 'delete') {
      const { userId, id } = req.body || {};
      const profile = await ai.requireUser(supa, userId);
      if (!id) return res.status(400).json({ error: 'id obligatoriu' });
      const { data: row } = await supa.from('ai_public_library').select('created_by').eq('id', id).single();
      if (!row) return res.status(404).json({ error: 'Nu există.' });
      if (row.created_by !== userId && !profile.is_admin) return res.status(403).json({ error: 'Nu poți șterge.' });
      await supa.from('ai_public_library').delete().eq('id', id);
      return res.status(200).json({ ok: true });
    }

    return res.status(400).json({ error: 'action invalid' });
  } catch (err) {
    console.error('ai-public error:', err);
    return res.status(err.status || 500).json({ error: err.message || 'Eroare server', code: err.code || null });
  }
};
