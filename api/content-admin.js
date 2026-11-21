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
//   • plaseaza — materialul abia încărcat („Adaugă PDF / Interactiv") trece la
//                capitolul lui: după ultimul material al capitolului, în clase și în
//                rubrica „Capitole" de la EN / BAC (18 nov. 2026 — planPlasare; capitolul
//                după titlu, api/_lib/capitoleHarta.js). Restul listei își păstrează
//                ordinea (se renumerotează rubrica, ca la reorder).
//   • perechi / asociaza / asociaza_lot / dezleaga — Admin → „🔗 PDF ↔ Interactiv"
//                (21 nov. 2026): toate PDF-urile (fără bareme) și testele interactive cu
//                legăturile lor + jurnalul generatorului pentru testele fără PDF; legarea
//                unui test de PDF-ul după care e făcut (content.pdf_sursa_id) și, după caz,
//                ca test principal al PDF-ului (content.interactiv_id); dezlegarea.
//                Potrivirea pe titlu / jurnal: _lib/pdfTestPotrivire.js (și în browser).
// Rulează cu service role (ocolește RLS) și cere is_admin pe tokenul REAL.
// Logica pură (validare, planificarea renumerotării) e în _lib/contentAdmin.js.
// =====================================================================
const { admin, handledMethod, authUser, requireAdmin, parseStoragePath, allRows } = require('./_lib/http');
const {
  sanitizeUpdate, planReorder, planSortAll, bucketFor, CATEGORIES,
  checkReplacement, interactiveDataAfterReplace, CONTENT_BUCKETS,
  NEW_POSITION_KEY, normalizeNewPosition, applyNewPosition, planMoveNewToEnd, rubricKey, planPlasare,
} = require('./_lib/contentAdmin');
const { capitolDin } = require('./_lib/capitoleHarta');
const settings = require('./_lib/settings');
const { isBaremRow } = require('./_lib/barem');
const potrivire = require('./_lib/pdfTestPotrivire');

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

// 🧩 PDF ↔ test interactiv (19 nov. 2026): testul principal al unui PDF (content.interactiv_id)
// e „făcut după" el (content.pdf_sursa_id); un test mutat la alt PDF nu mai e principalul celui
// vechi; un PDF fără test principal îl primește pe cel legat acum de el.
async function legaturiInAcord(supabase, cur, patch) {
  try {
    if (patch.interactiv_id) {
      const { data: t } = await supabase.from('content').select('id, pdf_sursa_id').eq('id', patch.interactiv_id).maybeSingle();
      if (t && t.pdf_sursa_id && t.pdf_sursa_id !== cur.id) {
        await supabase.from('content').update({ interactiv_id: null }).eq('id', t.pdf_sursa_id).eq('interactiv_id', t.id);
      }
      await supabase.from('content').update({ pdf_sursa_id: cur.id }).eq('id', patch.interactiv_id);
    }
    if ('pdf_sursa_id' in patch) {
      if (cur.pdf_sursa_id && cur.pdf_sursa_id !== patch.pdf_sursa_id) {
        await supabase.from('content').update({ interactiv_id: null }).eq('id', cur.pdf_sursa_id).eq('interactiv_id', cur.id);
        // 21 nov. 2026: PDF-ul vechi, rămas fără principal, îl primește pe cel mai nou test rămas după el
        await principalNou(supabase, cur.pdf_sursa_id);
      }
      if (patch.pdf_sursa_id) {
        await supabase.from('content').update({ interactiv_id: cur.id }).eq('id', patch.pdf_sursa_id).is('interactiv_id', null);
      }
    }
  } catch (e) { console.warn('content-admin: legăturile PDF ↔ test:', e.message); }
}

// ─── 🔗 PDF ↔ Interactiv (21 nov. 2026) ──────────────────────────────────────────
// „Fă în admin o rubrică în care pot asocia manual un PDF de un test interactiv. Fă ca
// PDF-urile să se asocieze automat cu un test interactiv generat după modelul lui."
const COLOANE_PERECHE = 'id, title, content_type, category, subcategory, profile, is_free, created_at, interactiv_id, pdf_sursa_id, file_url';
const scurt = (r) => (r ? {
  id: r.id, title: r.title || '', content_type: r.content_type, category: r.category || null,
  subcategory: r.subcategory || null, profile: r.profile || null, is_free: !!r.is_free, created_at: r.created_at || null,
  ...(r.content_type === 'pdf' ? { interactiv_id: r.interactiv_id || null } : { pdf_sursa_id: r.pdf_sursa_id || null }),
} : null);
const eroare = (status, mesaj) => Object.assign(new Error(mesaj), { status });

async function randPereche(supabase, id) {
  const { data, error } = await supabase.from('content').select(COLOANE_PERECHE).eq('id', id).maybeSingle();
  if (error) throw new Error(error.message);
  return data || null;
}

// Un PDF fără test principal, dar cu teste făcute după el → cel mai nou devine principal
// (altfel PDF-ul și-ar pierde „🧩 Deschide interactiv" de pe site). Întoarce id-ul sau null.
async function principalNou(supabase, pdfId) {
  if (!pdfId) return null;
  const { data: pdf } = await supabase.from('content').select('id, interactiv_id').eq('id', pdfId).maybeSingle();
  if (!pdf || pdf.interactiv_id) return pdf ? pdf.interactiv_id || null : null;
  const { data: teste } = await supabase.from('content').select('id, created_at')
    .eq('content_type', 'interactive').eq('pdf_sursa_id', pdfId);
  const id = potrivire.alegePrincipal(teste || []);
  if (!id) return null;
  await supabase.from('content').update({ interactiv_id: id }).eq('id', pdfId).is('interactiv_id', null);
  return id;
}

// Leagă testul de PDF-ul după care e făcut. principal: 'da' (devine testul principal al
// PDF-ului) sau 'daca-lipseste' (doar dacă PDF-ul n-are încă unul — ca generatorul).
// doarNeasociat: testul legat între timp de alt PDF rămâne neatins („🤖 Asociază automat").
async function asociazaPereche(supabase, { pdfId, testId, principal = 'daca-lipseste', doarNeasociat = false } = {}) {
  if (!UUID.test(String(pdfId || '')) || !UUID.test(String(testId || ''))) throw eroare(400, 'Alege și PDF-ul, și testul.');
  const [pdf, test] = await Promise.all([randPereche(supabase, pdfId), randPereche(supabase, testId)]);
  if (!pdf || pdf.content_type !== 'pdf') throw eroare(400, 'PDF-ul ales nu există (sau nu e un PDF).');
  if (!test || test.content_type !== 'interactive') throw eroare(400, 'Testul ales nu există (sau nu e un test interactiv).');
  if (isBaremRow(pdf)) throw eroare(400, 'Un barem nu are test interactiv — alege PDF-ul cu subiectele.');
  const motiv = potrivire.motivIncompatibil(test, pdf);
  if (motiv) throw eroare(400, motiv);
  if (doarNeasociat && test.pdf_sursa_id && test.pdf_sursa_id !== pdf.id) return { sarit: true, pdf: scurt(pdf), test: scurt(test), vechi: null, principal: false };

  const vechiId = test.pdf_sursa_id && test.pdf_sursa_id !== pdf.id ? test.pdf_sursa_id : null;
  if (test.pdf_sursa_id !== pdf.id) {
    const { error } = await supabase.from('content').update({ pdf_sursa_id: pdf.id, updated_at: new Date().toISOString() }).eq('id', test.id);
    if (error) throw new Error(`Asocierea n-a putut fi salvată: ${error.message}`);
  }
  // PDF-ul de dinainte al testului: dacă îl avea principal, primește alt test rămas după el
  if (vechiId) {
    await supabase.from('content').update({ interactiv_id: null }).eq('id', vechiId).eq('interactiv_id', test.id);
    await principalNou(supabase, vechiId);
  }
  const facePrincipal = principal === 'da' || !pdf.interactiv_id || pdf.interactiv_id === test.id;
  if (facePrincipal && pdf.interactiv_id !== test.id) {
    const { error } = await supabase.from('content').update({ interactiv_id: test.id, updated_at: new Date().toISOString() }).eq('id', pdf.id);
    if (error) throw new Error(`Testul principal n-a putut fi salvat: ${error.message}`);
  }
  const [p2, t2, v2] = await Promise.all([randPereche(supabase, pdf.id), randPereche(supabase, test.id), vechiId ? randPereche(supabase, vechiId) : null]);
  return { sarit: false, pdf: scurt(p2), test: scurt(t2), vechi: scurt(v2), principal: facePrincipal };
}

// Desface legătura dintre un PDF și un test (ambele părți); PDF-ul rămas fără principal
// îl primește pe cel mai nou dintre celelalte teste făcute după el, dacă are.
async function dezleagaPereche(supabase, { pdfId, testId } = {}) {
  if (!UUID.test(String(pdfId || '')) || !UUID.test(String(testId || ''))) throw eroare(400, 'Alege și PDF-ul, și testul.');
  const [pdf, test] = await Promise.all([randPereche(supabase, pdfId), randPereche(supabase, testId)]);
  if (!pdf || !test) throw eroare(404, 'PDF-ul sau testul nu mai există.');
  if (test.pdf_sursa_id === pdf.id) {
    const { error } = await supabase.from('content').update({ pdf_sursa_id: null, updated_at: new Date().toISOString() }).eq('id', test.id);
    if (error) throw new Error(`Legătura n-a putut fi scoasă: ${error.message}`);
  }
  let altPrincipal = null;
  if (pdf.interactiv_id === test.id) {
    await supabase.from('content').update({ interactiv_id: null, updated_at: new Date().toISOString() }).eq('id', pdf.id).eq('interactiv_id', test.id);
    altPrincipal = await principalNou(supabase, pdf.id);
  }
  const [p2, t2] = await Promise.all([randPereche(supabase, pdf.id), randPereche(supabase, test.id)]);
  return { pdf: scurt(p2), test: scurt(t2), altPrincipal };
}

// Jurnalul generatorului pentru testele fără PDF (cine le-a făcut, din ce materiale)
async function jurnalGenerator(supabase, teste, pdfs) {
  const ids = teste.map((t) => t.id);
  if (!ids.length) return {};
  try {
    const runs = [];
    for (let i = 0; i < ids.length; i += 100) {
      const { data, error } = await supabase.from('agent_task_runs').select('content_id, task_id, combined_from').in('content_id', ids.slice(i, i + 100));
      if (error) return {};
      runs.push(...(data || []));
    }
    const taskIds = [...new Set(runs.map((r) => r.task_id).filter(Boolean))];
    let tasks = [];
    if (taskIds.length) {
      const { data } = await supabase.from('agent_tasks').select('id, name, category, subcategory, profile, ctype').in('id', taskIds);
      tasks = data || [];
    }
    return potrivire.construiesteJurnal({ runs, tasks, teste, pdfs });
  } catch { return {}; }   // fără tabelele agentului → fără jurnal
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
      // 🧩 testul interactiv asociat unui PDF: chiar un test interactiv (19 nov. 2026)
      if (patch.interactiv_id) {
        const { data: tinta } = await supabase.from('content').select('id, content_type').eq('id', patch.interactiv_id).maybeSingle();
        if (!tinta || tinta.content_type !== 'interactive') return res.status(400).json({ error: 'Testul interactiv asociat nu există (sau nu e un test interactiv).' });
      }
      if (patch.pdf_sursa_id) {
        const { data: sursa } = await supabase.from('content').select('id, content_type').eq('id', patch.pdf_sursa_id).maybeSingle();
        if (!sursa || sursa.content_type !== 'pdf') return res.status(400).json({ error: 'PDF-ul ales nu există (sau nu e un PDF).' });
      }

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
      await legaturiInAcord(supabase, current, patch);
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

    // ─── plaseaza: materialul nou, la capitolul lui ──────────────────────────
    if (action === 'plaseaza') {
      const id = String((req.body || {}).id || '');
      if (!UUID.test(id)) return res.status(400).json({ error: 'id invalid' });
      const { data: nou, error: nErr } = await supabase.from('content')
        .select('id, title, category, subcategory, profile, content_type, sort_order, created_at').eq('id', id).maybeSingle();
      if (nErr) throw new Error(nErr.message);
      if (!nou) return res.status(404).json({ error: 'Material negăsit' });
      const rows = await allRows((from, to) => supabase.from('content')
        .select('id, title, category, subcategory, profile, content_type, sort_order, created_at')
        .eq('category', nou.category).eq('content_type', nou.content_type)
        .order('created_at', { ascending: true }).range(from, to));
      const plan = planPlasare(rows, nou, capitolDin);
      if (!plan) return res.status(200).json({ ok: true, placed: false, capitol: null });
      const { updates } = planReorder([...rows.filter((r) => String(r.id) !== id), nou], plan.ids);
      const updated = await applyUpdates(supabase, updates);
      return res.status(200).json({ ok: true, placed: true, updated, capitol: plan.capitol, dupa: plan.dupa, capitolNou: plan.capitolNou, loc: plan.loc, total: plan.total });
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

    // ─── 🔗 PDF ↔ Interactiv: perechi / asociaza / asociaza_lot / dezleaga ──────────
    if (action === 'perechi') {
      const rows = await allRows((from, to) => supabase.from('content').select(COLOANE_PERECHE)
        .in('content_type', ['pdf', 'interactive']).order('created_at', { ascending: true }).range(from, to));
      const pdfs = rows.filter((r) => r.content_type === 'pdf' && !isBaremRow(r)).map(scurt);
      const teste = rows.filter((r) => r.content_type === 'interactive').map(scurt);
      const jurnal = await jurnalGenerator(supabase, teste.filter((t) => !t.pdf_sursa_id), pdfs);
      return res.status(200).json({ pdfs, teste, jurnal });
    }
    if (action === 'asociaza') {
      const { pdfId, testId, principal } = req.body || {};
      const r = await asociazaPereche(supabase, { pdfId, testId, principal: principal === 'da' ? 'da' : 'daca-lipseste' });
      return res.status(200).json({ ok: true, ...r });
    }
    if (action === 'asociaza_lot') {
      const perechi = Array.isArray((req.body || {}).perechi) ? req.body.perechi.slice(0, 300) : [];
      if (!perechi.length) return res.status(400).json({ error: 'Nicio pereche de asociat.' });
      const rezultate = [];
      for (const p of perechi) {
        try {
          const r = await asociazaPereche(supabase, { pdfId: p && p.pdfId, testId: p && p.testId, principal: 'daca-lipseste', doarNeasociat: true });
          rezultate.push({ pdfId: p.pdfId, testId: p.testId, ok: !r.sarit, sarit: !!r.sarit, ...r });
        } catch (e) {
          rezultate.push({ pdfId: p && p.pdfId, testId: p && p.testId, ok: false, eroare: e.message });
        }
      }
      return res.status(200).json({ ok: true, facute: rezultate.filter((r) => r.ok).length, rezultate });
    }
    if (action === 'dezleaga') {
      const { pdfId, testId } = req.body || {};
      const r = await dezleagaPereche(supabase, { pdfId, testId });
      return res.status(200).json({ ok: true, ...r });
    }

    return res.status(400).json({ error: 'Acțiune necunoscută' });
  } catch (err) {
    console.error('content-admin error:', err);
    return res.status(err.status || 500).json({ error: err.message || 'Eroare server' });
  }
};

module.exports.legaturiInAcord = legaturiInAcord;
module.exports.asociazaPereche = asociazaPereche;
module.exports.dezleagaPereche = dezleagaPereche;
module.exports.principalNou = principalNou;
module.exports.jurnalGenerator = jurnalGenerator;
