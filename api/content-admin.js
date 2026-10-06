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
//   • replace_file — „🔁 Înlocuiește": materialul primește fișierul nou (încărcat
//                de browser în Storage, într-o cale nouă); rândul rămâne același
//                → data adăugării, poziția, rezultatele și recenziile rămân.
//                Fișierul vechi se șterge după ce rândul a fost actualizat.
//   • settings / set_new_position — unde apar materialele NOI (primele sau la
//                sfârșit), pe tot site-ul / categorie / rubrică (app_settings;
//                aplicată la inserare de triggerul din setari_ordine_gratuite.sql).
//   • move_new_to_end — mută la sfârșitul rubricilor materialele noi rămase pe
//                poziția 0 (apărute primele după o ordonare).
// Rulează cu service role (ocolește RLS) și cere is_admin pe tokenul REAL.
// Logica pură (validare, planificarea renumerotării) e în _lib/contentAdmin.js.
// =====================================================================
const { admin, handledMethod, authUser, requireAdmin, parseStoragePath, allRows } = require('./_lib/http');
const {
  sanitizeUpdate, planReorder, planSortAll, bucketFor, CATEGORIES,
  checkReplacement, interactiveDataAfterReplace, CONTENT_BUCKETS,
  NEW_POSITION_KEY, normalizeNewPosition, applyNewPosition, planMoveNewToEnd, rubricKey,
} = require('./_lib/contentAdmin');
const settings = require('./_lib/settings');

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

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

// Există obiectul în Storage? (true / false; null = nu s-a putut verifica)
async function objectExists(supabase, bucket, path) {
  const i = path.lastIndexOf('/');
  const dir = i >= 0 ? path.slice(0, i) : '';
  const name = i >= 0 ? path.slice(i + 1) : path;
  try {
    const { data, error } = await supabase.storage.from(bucket).list(dir, { limit: 100, search: name });
    if (error) return null;
    return (data || []).some((f) => f && f.name === name);
  } catch { return null; }
}

const fileNameOf = (url) => {
  if (!url) return null;
  try { return decodeURIComponent(String(url).split('?')[0].split('/').pop() || '').replace(/^\d+_/, ''); }
  catch { return String(url).split('/').pop(); }
};

// Rândurile pentru „mută la sfârșit": o categorie, o rubrică sau tot site-ul
async function rowsForScope(supabase, { category = null } = {}) {
  return allRows((from, to) => {
    let q = supabase.from('content').select('id, category, subcategory, profile, content_type, sort_order, created_at')
      .order('created_at', { ascending: true }).range(from, to);
    if (category) q = q.eq('category', String(category));
    return q;
  });
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

    // ─── replace_file ────────────────────────────────────────────────────────
    // Browserul a încărcat deja fișierul nou în Storage (aceeași cale ca la
    // „Adaugă PDF / Interactiv": pdf|interactive/<categorie>/<timp>_<nume>).
    if (action === 'replace_file') {
      const { id, path } = req.body || {};
      if (!UUID.test(String(id || ''))) return res.status(400).json({ error: 'id obligatoriu' });
      const { data: current, error: curErr } = await supabase.from('content').select('*').eq('id', id).single();
      if (curErr || !current) return res.status(404).json({ error: 'Material negăsit' });
      const check = checkReplacement(current, path);
      if (!check.ok) return res.status(400).json({ error: check.error });
      // browserul trimite fișierul pe care îl vedea; dacă între timp s-a schimbat
      // (altă înlocuire, o corectură publicată), nu suprascriem orbește
      if (Object.prototype.hasOwnProperty.call(req.body, 'expectUrl') && (req.body.expectUrl || null) !== (current.file_url || null)) {
        return res.status(409).json({ error: 'Fișierul acestui material s-a schimbat între timp. Reîncarcă lista și încearcă din nou.' });
      }
      if (await objectExists(supabase, check.bucket, path) === false) {
        return res.status(400).json({ error: `Fișierul nou nu a ajuns în Storage (bucket-ul „${check.bucket}"). Încearcă din nou.` });
      }
      const { data: urlData } = supabase.storage.from(check.bucket).getPublicUrl(path);
      const newUrl = urlData?.publicUrl;
      if (!newUrl) return res.status(500).json({ error: 'Nu am putut construi adresa fișierului nou.' });
      if (newUrl === current.file_url) return res.status(400).json({ error: 'Acesta e chiar fișierul de acum.' });

      const nowIso = new Date().toISOString();
      const patch = { file_url: newUrl, updated_at: nowIso };
      const idata = interactiveDataAfterReplace(current.interactive_data, nowIso);
      if (idata) patch.interactive_data = idata;
      // update condiționat: doar dacă fișierul e încă cel citit mai sus
      let q = supabase.from('content').update(patch).eq('id', id);
      q = current.file_url ? q.eq('file_url', current.file_url) : q.is('file_url', null);
      const { data: rows, error: updErr } = await q.select();
      if (updErr) return res.status(500).json({ error: `Salvarea a eșuat: ${updErr.message}` });
      const row = Array.isArray(rows) ? rows[0] : rows;
      if (!row) return res.status(409).json({ error: 'Fișierul acestui material s-a schimbat între timp. Reîncarcă lista și încearcă din nou.' });

      // fișierul vechi: șters după ce rândul arată spre cel nou — doar dacă e un
      // fișier de materiale (content-files / content-files-free) și nu-l mai
      // folosește niciun alt material
      let removedOld = false;
      if (current.file_url) {
        let old = null;
        try { old = parseStoragePath(current.file_url); } catch { old = null; }
        if (old && CONTENT_BUCKETS.includes(old.bucket) && !(old.bucket === check.bucket && old.filePath === path)) {
          const { data: others } = await supabase.from('content').select('id').eq('file_url', current.file_url).limit(2);
          if (!(others || []).some((o) => o.id !== id)) {
            const { error: rmErr } = await supabase.storage.from(old.bucket).remove([old.filePath]);
            removedOld = !rmErr;
          }
        }
      }
      // un subiect de EN/BAC cu lecție de meditație live scrisă pe fișierul vechi
      let liveLessons = 0;
      try {
        const { count } = await supabase.from('live_lessons').select('id', { count: 'exact', head: true }).eq('subject_id', id);
        liveLessons = count || 0;
      } catch { /* meditațiile live nu sunt instalate */ }
      return res.status(200).json({
        row, changed: true, removedOld, liveLessons,
        replaced: { from: fileNameOf(current.file_url), to: fileNameOf(newUrl) },
        keysFromNewFile: !!idata,
      });
    }

    // ─── settings / set_new_position — unde apar materialele noi ────────────
    if (action === 'settings') {
      const st = await settings.readSetting(supabase, NEW_POSITION_KEY);
      return res.status(200).json({ setup: st.setup, newPosition: normalizeNewPosition(st.value) });
    }
    if (action === 'set_new_position') {
      const { scope, category = null, rubric = null } = req.body || {};
      const value = req.body?.value == null || req.body.value === '' ? null : String(req.body.value);
      const st = await settings.readSetting(supabase, NEW_POSITION_KEY);
      if (!st.setup) return res.status(503).json({ error: settings.SETUP_HINT, code: 'SETTINGS_SETUP' });
      let next;
      try { next = applyNewPosition(st.value, { scope: String(scope || ''), category, rubric, value }); }
      catch (e) { return res.status(400).json({ error: e.message }); }
      await settings.writeSetting(supabase, NEW_POSITION_KEY, next, userId);
      return res.status(200).json({ ok: true, setup: true, newPosition: next });
    }

    // ─── move_new_to_end — materialele noi rămase pe poziția 0 → la sfârșit ──
    if (action === 'move_new_to_end') {
      const { category = null, rubric = null } = req.body || {};
      const cat = rubric && typeof rubric === 'object' ? rubric.category : category;
      if (cat && !CATEGORIES.includes(String(cat))) return res.status(400).json({ error: 'Categorie necunoscută.' });
      let rows = await rowsForScope(supabase, { category: cat || null });
      if (rubric && typeof rubric === 'object') {
        const key = rubricKey(rubric);
        rows = rows.filter((r) => rubricKey(r) === key);
      }
      const plan = planMoveNewToEnd(rows);
      const moved = await applyUpdates(supabase, plan.updates);
      return res.status(200).json({ ok: true, moved, rubrics: plan.rubrics, ids: plan.updates.map((u) => u.id), positions: Object.fromEntries(plan.updates.map((u) => [u.id, u.sort_order])) });
    }

    return res.status(400).json({ error: 'Acțiune necunoscută' });
  } catch (err) {
    console.error('content-admin error:', err);
    return res.status(err.status || 500).json({ error: err.message || 'Eroare server' });
  }
};
