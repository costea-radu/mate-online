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
        .select('id, kind, title, category, topic, creator_name, creator_role, created_by, is_free, created_at')
        .order('is_free', { ascending: false })
        .order('created_at', { ascending: false }).limit(Math.min(limit, 100));
      if (category) query = query.eq('category', category);
      if (q && q.trim()) query = query.ilike('search_text', `%${q.trim()}%`);
      const { data } = await query;
      return res.status(200).json({ items: data || [] });
    }

    if (action === 'get') {
      const { userId, id } = req.body || {};
      if (!id) return res.status(400).json({ error: 'id obligatoriu' });
      const profile = await ai.requireUser(supa, userId);
      const { data } = await supa.from('ai_public_library').select('*').eq('id', id).single();
      if (!data) return res.status(404).json({ error: 'Nu a fost găsit.' });
      // Barieră pe server: neabonații pot deschide DOAR testele gratuite.
      const premium = profile.subscription_status === 'active' || profile.is_admin;
      const allowed = data.is_free || premium || data.created_by === userId;
      if (!allowed) {
        return res.status(402).json({ error: 'Acest test necesită abonament. Fără abonament poți deschide doar testele gratuite din bibliotecă.', code: 'PREMIUM_REQUIRED' });
      }
      return res.status(200).json({ item: data });
    }

    // Admin: marchează/demarchează un test ca gratuit
    if (action === 'set_free') {
      const { userId, id, isFree } = req.body || {};
      const profile = await ai.requireUser(supa, userId);
      if (!profile.is_admin) return res.status(403).json({ error: 'Doar adminul poate marca teste gratuite.' });
      if (!id) return res.status(400).json({ error: 'id obligatoriu' });
      const { error } = await supa.from('ai_public_library').update({ is_free: !!isFree }).eq('id', id);
      if (error) return res.status(500).json({ error: error.message });
      return res.status(200).json({ ok: true, is_free: !!isFree });
    }

    if (action === 'publish') {
      const { userId, kind, title, category = null, topic = null, payload = {} } = req.body || {};
      const profile = await ai.requireUser(supa, userId);
      // doar profesorii (sau admin) pot publica public
      if (!(profile.role === 'profesor' || profile.is_admin)) {
        return res.status(403).json({ error: 'Doar profesorii pot publica în biblioteca publică.' });
      }
      if (!kind || !title) return res.status(400).json({ error: 'kind și title obligatorii' });
      // Nu republica dacă profesorul a publicat deja același test (după titlu + tip).
      const { data: existing } = await supa.from('ai_public_library')
        .select('id').eq('created_by', userId).eq('kind', kind).eq('title', title).limit(1);
      if (existing && existing.length) {
        return res.status(200).json({ id: existing[0].id, alreadyPublished: true });
      }
      const { data, error } = await supa.from('ai_public_library').insert({
        created_by: userId, creator_name: profile.full_name || profile.email || 'Profesor',
        creator_role: 'profesor', kind, title, category, topic, payload,
        search_text: buildSearchText(kind, title, topic, payload),
      }).select('id').single();
      if (error) return res.status(500).json({ error: error.message });
      return res.status(200).json({ id: data.id });
    }

    if (action === 'record') {
      const { userId, id, score = 0, maxScore = 100 } = req.body || {};
      await ai.requireUser(supa, userId);
      if (!id) return res.status(400).json({ error: 'id obligatoriu' });
      const sc = Math.max(0, parseInt(score, 10) || 0);
      const mx = Math.max(1, parseInt(maxScore, 10) || 100);
      const { data: ex } = await supa.from('ai_public_results').select('id, attempts, score').eq('public_id', id).eq('student_id', userId).single();
      if (ex) {
        await supa.from('ai_public_results').update({ score: Math.max(ex.score || 0, sc), max_score: mx, attempts: (ex.attempts || 1) + 1, completed_at: new Date().toISOString() }).eq('id', ex.id);
      } else {
        await supa.from('ai_public_results').insert({ public_id: id, student_id: userId, score: sc, max_score: mx, attempts: 1 });
      }
      return res.status(200).json({ ok: true });
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
