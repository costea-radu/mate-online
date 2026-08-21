// =====================================================================
// api/content-admin.js — Admin → „Tot Conținutul": editare + ordine de afișare
//   • update   — modifică metadatele unui material (titlu, descriere,
//                categorie, subcategorie, profil, tip, acces, ordine). Când se
//                schimbă accesul (gratuit ↔ premium), fișierul e MUTAT în
//                bucket-ul potrivit (content-files-free e public → un material
//                devenit premium ar rămâne descărcabil direct de la file_url).
//   • reorder  — primește id-urile unei rubrici în ordinea dorită și scrie
//                sort_order = 1..N (drag-and-drop / săgeți din admin).
//   • sort_all — renumerotează tot site-ul (sau o categorie) după dată / titlu,
//                crescător / descrescător (înlocuiește reset_sort_order*.sql).
// Rulează cu service role (ocolește RLS) și cere is_admin pe tokenul REAL.
// Logica pură (validare, planificarea renumerotării) e în _lib/contentAdmin.js.
// =====================================================================
const { admin, handledMethod, authUser, requireAdmin, parseStoragePath, allRows } = require('./_lib/http');
const { sanitizeUpdate, planReorder, planSortAll, bucketFor, CATEGORIES } = require('./_lib/contentAdmin');

const CHUNK = 20; // update-uri în paralel (PostgREST nu are update în bloc pe valori diferite)

async function applyUpdates(supabase, updates) {
  for (let i = 0; i < updates.length; i += CHUNK) {
    const chunk = updates.slice(i, i + CHUNK);
    const results = await Promise.all(chunk.map((u) =>
      supabase.from('content').update({ sort_order: u.sort_order }).eq('id', u.id)));
    const failed = results.find((r) => r.error);
    if (failed) throw new Error(`Actualizarea ordinii a eșuat: ${failed.error.message}`);
  }
  return updates.length;
}

// Mută fișierul între bucket-uri (copiere → apoi ștergerea originalului după
// ce rândul din baza de date a fost actualizat; dacă ceva eșuează pe drum,
// originalul rămâne neatins). Întoarce { newUrl, cleanup } sau null.
async function prepareBucketMove(supabase, row, isFree) {
  if (!row.file_url) return null;
  let parsed;
  try { parsed = parseStoragePath(row.file_url); }
  catch {
    const e = new Error('Fișierul nu are un URL de Storage valid — accesul nu poate fi schimbat automat.');
    e.status = 400; throw e;
  }
  const target = bucketFor(isFree);
  if (parsed.bucket === target) return null; // e deja unde trebuie
  const { error: cpErr } = await supabase.storage.from(parsed.bucket)
    .copy(parsed.filePath, parsed.filePath, { destinationBucket: target });
  if (cpErr && !/exists|duplicate/i.test(String(cpErr.message || ''))) {
    const e = new Error(`Mutarea fișierului în bucket-ul „${target}" a eșuat: ${cpErr.message}`);
    e.status = 502; throw e;
  }
  const { data: urlData } = supabase.storage.from(target).getPublicUrl(parsed.filePath);
  return {
    newUrl: urlData?.publicUrl || row.file_url,
    from: parsed.bucket, to: target, path: parsed.filePath,
  };
}

module.exports = async function handler(req, res) {
  if (handledMethod(req, res)) return;
  const supabase = admin();
  try {
    const userId = await authUser(req, supabase);
    await requireAdmin(supabase, userId);

    const { action } = req.body || {};

    // ─── update ──────────────────────────────────────────────────────────────
    if (action === 'update') {
      const { id, data } = req.body || {};
      if (!id) return res.status(400).json({ error: 'id obligatoriu' });
      const { data: current, error: curErr } = await supabase.from('content').select('*').eq('id', id).single();
      if (curErr || !current) return res.status(404).json({ error: 'Material negăsit' });

      const { patch, errors } = sanitizeUpdate(data || {}, current);
      if (errors.length) return res.status(400).json({ error: errors.join(' ') });
      if (!Object.keys(patch).length) return res.status(200).json({ row: current, changed: false });

      let move = null;
      if ('is_free' in patch) {
        move = await prepareBucketMove(supabase, current, patch.is_free);
        if (move) patch.file_url = move.newUrl;
      }
      patch.updated_at = new Date().toISOString();

      const { data: row, error: updErr } = await supabase.from('content').update(patch).eq('id', id).select().single();
      if (updErr) {
        if (move) await supabase.storage.from(move.to).remove([move.path]).catch(() => {});
        return res.status(500).json({ error: `Salvarea a eșuat: ${updErr.message}` });
      }
      if (move) await supabase.storage.from(move.from).remove([move.path]).catch(() => {});
      return res.status(200).json({ row, changed: true, moved: move ? { from: move.from, to: move.to } : null });
    }

    // ─── reorder ─────────────────────────────────────────────────────────────
    if (action === 'reorder') {
      const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
      const ids = Array.isArray(req.body.ids) ? req.body.ids.map(String).filter((id) => UUID.test(id)) : [];
      if (!ids.length) return res.status(400).json({ error: 'Lista de id-uri e goală.' });
      if (ids.length > 2000) return res.status(400).json({ error: 'Prea multe materiale într-o singură cerere.' });
      const rows = [];
      for (let i = 0; i < ids.length; i += 200) {
        const { data, error } = await supabase.from('content').select('id, sort_order').in('id', ids.slice(i, i + 200));
        if (error) throw new Error(error.message);
        rows.push(...(data || []));
      }
      const plan = planReorder(rows, ids);
      const updated = await applyUpdates(supabase, plan.updates);
      return res.status(200).json({ ok: true, updated, total: plan.total, missing: plan.missing.length });
    }

    // ─── sort_all ────────────────────────────────────────────────────────────
    if (action === 'sort_all') {
      const { by = 'created_at', dir = 'desc', category = null } = req.body || {};
      if (category && !CATEGORIES.includes(String(category))) return res.status(400).json({ error: 'Categorie necunoscută.' });
      const rows = await allRows((from, to) => {
        let q = supabase.from('content').select('id, title, category, created_at, sort_order').order('created_at', { ascending: true }).range(from, to);
        if (category) q = q.eq('category', String(category));
        return q;
      });
      let plan;
      try { plan = planSortAll(rows, { by: String(by), dir: String(dir) }); }
      catch (e) { return res.status(400).json({ error: e.message }); }
      const updated = await applyUpdates(supabase, plan.updates);
      return res.status(200).json({ ok: true, updated, total: plan.total });
    }

    return res.status(400).json({ error: 'Acțiune necunoscută' });
  } catch (err) {
    console.error('content-admin error:', err);
    return res.status(err.status || 500).json({ error: err.message || 'Eroare server' });
  }
};
