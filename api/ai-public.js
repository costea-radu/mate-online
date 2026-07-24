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

// Menține mereu (până la) 3 teste gratuite: dacă sunt sub 3, promovează cele
// mai vechi teste ne-gratuite până se ajunge la 3. Idempotent — nu face nimic
// dacă deja sunt 3 (sau mai puține teste în total).
async function ensureThreeFree(supa) {
  try {
    const { count } = await supa.from('ai_public_library')
      .select('*', { count: 'exact', head: true }).eq('is_free', true);
    const need = 3 - (count || 0);
    if (need > 0) {
      const { data: cand } = await supa.from('ai_public_library')
        .select('id').eq('is_free', false).order('created_at', { ascending: true }).limit(need);
      if (cand && cand.length) {
        await supa.from('ai_public_library').update({ is_free: true }).in('id', cand.map((c) => c.id));
      }
    }
  } catch { /* ignoră */ }
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
      await ensureThreeFree(supa); // autocorectează la 3 gratuite
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
      const userId = await ai.authUser(req, supa);
      const { id } = req.body || {};
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
      // PDF publicat: bucketul e privat, deci cititorul primește un URL semnat
      // (generat cu clientul admin — RLS nu-l blochează).
      if (data.kind === 'pdf' && data.payload?.pdfPath) {
        try {
          const { data: signed } = await supa.storage.from(data.payload.bucket || 'personal-pdfs')
            .createSignedUrl(data.payload.pdfPath, 3600);
          if (signed?.signedUrl) data.payload = { ...data.payload, signedUrl: signed.signedUrl };
        } catch (e) { console.warn('ai-public get signedUrl:', e.message); }
      }
      return res.status(200).json({ item: data });
    }

    // Admin: marchează/demarchează un test ca gratuit
    if (action === 'set_free') {
      const userId = await ai.authUser(req, supa);
      const { id, isFree } = req.body || {};
      const profile = await ai.requireUser(supa, userId);
      if (!profile.is_admin) return res.status(403).json({ error: 'Doar adminul poate marca teste gratuite.' });
      if (!id) return res.status(400).json({ error: 'id obligatoriu' });
      const { error } = await supa.from('ai_public_library').update({ is_free: !!isFree }).eq('id', id);
      if (error) return res.status(500).json({ error: error.message });
      return res.status(200).json({ ok: true, is_free: !!isFree });
    }

    if (action === 'publish') {
      const userId = await ai.authUser(req, supa);
      const { kind, title, category = null, topic = null, payload = {} } = req.body || {};
      const profile = await ai.requireUser(supa, userId);
      // doar profesorii (sau admin) pot publica public
      if (!(profile.role === 'profesor' || profile.is_admin)) {
        return res.status(403).json({ error: 'Doar profesorii pot publica în biblioteca publică.' });
      }
      if (!kind || !title) return res.status(400).json({ error: 'kind și title obligatorii' });

      // Nume afișat: nume complet → username → partea din email → „Profesor".
      const creatorName = profile.full_name || profile.username
        || (profile.email ? profile.email.split('@')[0] : null) || 'Profesor';

      // PDF-urile stau în bucketul PRIVAT al profesorului — publicăm o COPIE
      // independentă (dacă profesorul își șterge itemul privat, cel public
      // rămâne întreg). Cititorii primesc URL semnat la 'get'.
      let pubPayload = payload;
      if (kind === 'pdf' && payload?.pdfPath) {
        const bucket = payload.bucket || 'personal-pdfs';
        const { data: fileData, error: dlErr } = await supa.storage.from(bucket).download(payload.pdfPath);
        if (dlErr || !fileData) return res.status(502).json({ error: 'PDF-ul nu a putut fi citit din Storage: ' + (dlErr?.message || 'necunoscut') });
        const copyPath = `public-library/${Date.now()}_${Math.random().toString(36).slice(2, 10)}.pdf`;
        const buf = Buffer.from(await fileData.arrayBuffer());
        const { error: upErr } = await supa.storage.from(bucket).upload(copyPath, buf, { contentType: 'application/pdf', upsert: false });
        if (upErr) return res.status(502).json({ error: 'Copia publică nu a putut fi creată: ' + upErr.message });
        pubPayload = { ...payload, pdfPath: copyPath, bucket };
      }

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
        creator_role: 'profesor', kind, title: finalTitle, category, topic, payload: pubPayload,
        search_text: buildSearchText(kind, finalTitle, topic, pubPayload),
      }).select('id, title').single();
      if (error) return res.status(500).json({ error: error.message });
      await ensureThreeFree(supa);
      return res.status(200).json({ id: data.id, title: data.title });
    }

    if (action === 'record') {
      const userId = await ai.authUser(req, supa);
      const { id, score = 0, maxScore = 100 } = req.body || {};
      await ai.requireUser(supa, userId);
      if (!id) return res.status(400).json({ error: 'id obligatoriu' });
      const sc = Math.max(0, parseInt(score, 10) || 0);
      const mx = Math.max(1, parseInt(maxScore, 10) || 100);
      // Notă: erorile de scriere NU se mai ignoră — altfel scorul se pierde
      // în tăcere iar clientul primește {ok:true} (bug istoric).
      const { data: ex } = await supa.from('ai_public_results')
        .select('id, attempts, score').eq('public_id', id).eq('student_id', userId).maybeSingle();
      const wr = ex
        ? await supa.from('ai_public_results').update({
            score: Math.max(ex.score || 0, sc), max_score: mx,
            attempts: (ex.attempts || 1) + 1, completed_at: new Date().toISOString(),
          }).eq('id', ex.id)
        : await supa.from('ai_public_results').insert({
            public_id: id, student_id: userId, score: sc, max_score: mx, attempts: 1,
          });
      if (wr.error) {
        console.error('ai-public record error:', wr.error);
        return res.status(500).json({ error: 'Scorul nu a putut fi salvat.', detail: wr.error.message });
      }
      return res.status(200).json({ ok: true });
    }

    if (action === 'delete') {
      const userId = await ai.authUser(req, supa);
      const { id } = req.body || {};
      const profile = await ai.requireUser(supa, userId);
      if (!id) return res.status(400).json({ error: 'id obligatoriu' });
      const { data: row } = await supa.from('ai_public_library').select('created_by, kind, payload').eq('id', id).single();
      if (!row) return res.status(404).json({ error: 'Nu există.' });
      if (row.created_by !== userId && !profile.is_admin) return res.status(403).json({ error: 'Nu poți șterge.' });
      await supa.from('ai_public_library').delete().eq('id', id);
      // ștergem și COPIA publică a PDF-ului din Storage (doar pe a noastră,
      // din public-library/ — nu fișierul privat al profesorului)
      if (row.kind === 'pdf' && row.payload?.pdfPath && String(row.payload.pdfPath).startsWith('public-library/')) {
        await supa.storage.from(row.payload.bucket || 'personal-pdfs').remove([row.payload.pdfPath]).catch(() => {});
      }
      await ensureThreeFree(supa); // menține 3 gratuite
      return res.status(200).json({ ok: true });
    }

    return res.status(400).json({ error: 'action invalid' });
  } catch (err) {
    console.error('ai-public error:', err);
    return res.status(err.status || 500).json({ error: err.message || 'Eroare server', code: err.code || null });
  }
};
