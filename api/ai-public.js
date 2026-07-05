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
      const items = data || [];
      // Completează numele afișat cu numele/username-ul CURENT al profesorului.
      const ids = [...new Set(items.map((i) => i.created_by).filter(Boolean))];
      if (ids.length) {
        const { data: profs } = await supa.from('profiles').select('id, full_name, username, email').in('id', ids);
        const nameMap = {};
        (profs || []).forEach((p) => {
          nameMap[p.id] = p.full_name || p.username || (p.email ? p.email.split('@')[0] : null);
        });
        items.forEach((it) => { if (nameMap[it.created_by]) it.creator_name = nameMap[it.created_by]; });
      }
      return res.status(200).json({ items });
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

      // Nume afișat: nume complet → username → partea din email → „Profesor".
      const creatorName = profile.full_name || profile.username
        || (profile.email ? profile.email.split('@')[0] : null) || 'Profesor';

      // Permite publicarea cu același nume; dacă ACELAȘI profesor a mai publicat
      // un test cu acest nume, adaugă un număr: „X", „X 2", „X 3"...
      const base = String(title).trim();
      const esc = base.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const rx = new RegExp(`^${esc}(\\s+\\d+)?$`);
      const { data: sameName } = await supa.from('ai_public_library')
        .select('title').eq('created_by', userId).eq('kind', kind).ilike('title', `${base}%`);
      const n = (sameName || []).filter((r) => rx.test((r.title || '').trim())).length;
      const finalTitle = n === 0 ? base : `${base} ${n + 1}`;

      const { data, error } = await supa.from('ai_public_library').insert({
        created_by: userId, creator_name: creatorName,
        creator_role: 'profesor', kind, title: finalTitle, category, topic, payload,
        search_text: buildSearchText(kind, finalTitle, topic, payload),
      }).select('id, title').single();
      if (error) return res.status(500).json({ error: error.message });
      return res.status(200).json({ id: data.id, title: data.title });
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

      // Menține mereu (până la) 3 teste gratuite: dacă a scăzut sub 3,
      // promovează cele mai vechi teste ne-gratuite până se ajunge la 3.
      try {
        const { count: freeCount } = await supa.from('ai_public_library')
          .select('*', { count: 'exact', head: true }).eq('is_free', true);
        const need = 3 - (freeCount || 0);
        if (need > 0) {
          const { data: cand } = await supa.from('ai_public_library')
            .select('id').eq('is_free', false).order('created_at', { ascending: true }).limit(need);
          if (cand && cand.length) {
            await supa.from('ai_public_library').update({ is_free: true }).in('id', cand.map((c) => c.id));
          }
        }
      } catch { /* ignoră */ }

      return res.status(200).json({ ok: true });
    }

    return res.status(400).json({ error: 'action invalid' });
  } catch (err) {
    console.error('ai-public error:', err);
    return res.status(err.status || 500).json({ error: err.message || 'Eroare server', code: err.code || null });
  }
};
