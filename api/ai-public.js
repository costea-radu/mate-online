// =====================================================================
// api/ai-public.js — „Biblioteca utilizatorilor" (teste/exerciții publice)
// POST { userId?, action, ... }
//   action='publish' (profesor/admin): { kind, title, category, topic, payload } → { id }
//   action='list'    (public): { q?, category?, limit? } → { items:[...] }
//   action='get'     (public): { id } → { item }
//   action='delete'  (creator/admin): { id } → { ok }
//   action='transcribe' (profesor/admin): { images: [dataUrl…] (≤ 8) } → { pages: [text…] }
//        — paginile unui material ÎNCĂRCAT din poze (src/components/IncarcaMaterial.jsx):
//        modelul de vedere le transcrie o dată, la încărcare, ca Profesorul Virtual
//        să aibă textul fișei (payload.text / pageTexts).
//
// ÎNCĂRCAREA materialelor (27 oct. 2026): profesorul încarcă un PDF, un Word sau
// poze; browserul face din ele un PDF (Word și pozele → src/lib/materialPdf.js),
// îl urcă în folderul lui din bucketul privat 'personal-pdfs' și îl publică aici
// ca orice PDF (kind 'pdf' — serverul face copia publică). Payload-ul aduce în plus
// { origin:'upload', source:'pdf'|'docx'|'foto', fileName, pages, text?, pageTexts? }.
// =====================================================================
const ai = require('./_lib/ai');

function buildSearchText(kind, title, topic, payload) {
  let parts = [title || '', topic || ''];
  if (kind === 'exam' && payload?.exam?.subjects) {
    payload.exam.subjects.forEach((s) => (s.items || []).forEach((it) => parts.push(it.statement || '')));
  } else if (kind === 'practice') {
    parts.push(payload?.statement || '');
  } else if (kind === 'pdf' && payload?.text) {
    // materialele încărcate se găsesc și după conținut (textul fișei)
    parts.push(String(payload.text).slice(0, 3500));
  }
  return parts.join(' ').slice(0, 4000);
}

// Câmpurile unui PDF publicat/încărcat — curățate (textul vine din browser:
// îl citește doar Profesorul Virtual, dar nu-l lăsăm să umfle rândul)
const PDF_SOURCES = new Set(['pdf', 'docx', 'foto']);
function cleanPdfPayload(p) {
  const out = { ...(p || {}) };
  delete out.signedUrl;
  if (out.text != null) out.text = String(out.text).slice(0, 40000);
  if (out.pageTexts != null) out.pageTexts = (Array.isArray(out.pageTexts) ? out.pageTexts : []).slice(0, 40).map((t) => String(t || '').slice(0, 6000));
  if (out.fileName != null) out.fileName = String(out.fileName).slice(0, 140);
  if (out.source != null && !PDF_SOURCES.has(out.source)) delete out.source;
  if (out.origin != null && out.origin !== 'upload') delete out.origin;
  if (out.pages != null) out.pages = Math.max(0, Math.min(500, parseInt(out.pages, 10) || 0));
  return out;
}

// Rezultatul unui elev la un material public (interactiv rezolvat în pagină sau
// PDF corectat cu „Răspunde în chat" — api/ai-correct.js). Cel mai bun scor rămâne.
async function recordPublicResult(supa, { publicId, userId, profile = null, score = 0, maxScore = 100 }) {
  // (rotunjit: la PDF-urile corectate punctajul poate avea zecimale — 7,5p)
  const sc = Math.max(0, Math.round(Number(score) || 0));
  const mx = Math.max(1, Math.round(Number(maxScore) || 100));
  // Snapshot cu numele elevului: scorul rămâne lizibil pentru autorul
  // testului și după ștergerea contului elevului (vezi
  // supabase/pastreaza_date_publice.sql — FK devine SET NULL).
  const studentName = (profile && (profile.full_name || profile.username
    || (profile.email ? profile.email.split('@')[0] : null))) || null;
  const { data: ex } = await supa.from('ai_public_results')
    .select('id, attempts, score').eq('public_id', publicId).eq('student_id', userId).maybeSingle();
  const writeRow = (withName) => ex
    ? supa.from('ai_public_results').update({
        score: Math.max(ex.score || 0, sc), max_score: mx,
        attempts: (ex.attempts || 1) + 1, completed_at: new Date().toISOString(),
        ...(withName ? { student_name: studentName } : {}),
      }).eq('id', ex.id)
    : supa.from('ai_public_results').insert({
        public_id: publicId, student_id: userId, score: sc, max_score: mx, attempts: 1,
        ...(withName ? { student_name: studentName } : {}),
      });
  let wr = await writeRow(true);
  if (wr.error && /student_name/i.test(wr.error.message || '')) {
    // instalare fără coloana nouă (pastreaza_date_publice.sql nerulat)
    wr = await writeRow(false);
  }
  if (wr.error) { const e = new Error(wr.error.message); e.status = 500; throw e; }
  return { ok: true };
}

// Transcrierea paginilor încărcate din poze (o dată, la încărcare)
const TRANSCRIBE_MAX = 8;
const TRANSCRIBE_SYSTEM = `Transcrii fidel paginile unei fișe / unui test de matematică, fotografiate de un profesor român, ca Profesorul Virtual al platformei să le poată citi.
Pentru FIECARE imagine, în ordine, scrii tot textul paginii:
- formulele în LaTeX, între $...$ (pe rând separat între $$...$$), virgula zecimală românească (1,5);
- păstrezi numerotarea exercițiilor, subpunctele a), b), c), variantele de răspuns și punctajele, cum apar;
- figurile le descrii scurt, între paranteze drepte: [Figura: triunghiul ABC dreptunghic în A, cu AB = 6 cm …];
- tabelele, rând cu rând, cu celulele despărțite prin „ | ";
- NU rezolvi nimic și NU adaugi nimic; ce nu se poate citi marchezi cu [?];
- o imagine fără conținut matematic lizibil → textul gol.
În JSON, comenzile LaTeX se scriu cu backslash DUBLAT („\\\\frac", „\\\\sqrt"). Răspunzi DOAR cu obiectul JSON cerut, cu EXACT câte un element în "pagini" pentru fiecare imagine.`;

// POLITICĂ: tot ce se publică e PREMIUM implicit. Sistemul menține însă minim
// 3 teste gratuite (cele mai RECENTE), ca vizitatorii să aibă mostre — DAR
// fără să suprascrie vreodată deciziile adminului: auto-promovarea atinge doar
// rândurile cu free_set_by_admin = false, iar orice comutare manuală (gratuit
// SAU premium) blochează rândul (free_set_by_admin = true) pentru mecanism.
async function ensureThreeFree(supa) {
  try {
    const { count } = await supa.from('ai_public_library')
      .select('*', { count: 'exact', head: true }).eq('is_free', true);
    const need = 3 - (count || 0);
    if (need > 0) {
      const { data: cand } = await supa.from('ai_public_library')
        .select('id').eq('is_free', false).eq('free_set_by_admin', false)
        .order('created_at', { ascending: false }).limit(need);
      if (cand && cand.length) {
        await supa.from('ai_public_library').update({ is_free: true }).in('id', cand.map((c) => c.id));
      }
    }
  } catch { /* coloana lipsă (script nerulat) sau eroare trecătoare — nu blocăm */ }
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
      await ensureThreeFree(supa); // minim 3 gratuite, fără a atinge deciziile adminului
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
      // decizia adminului devine DEFINITIVĂ pentru acest test (în ambele sensuri)
      let { error } = await supa.from('ai_public_library')
        .update({ is_free: !!isFree, free_set_by_admin: true }).eq('id', id);
      if (error && /free_set_by_admin|column/i.test(error.message || '')) {
        // instalare fără coloana nouă (scriptul public_library_pdf.sql nerulat)
        ({ error } = await supa.from('ai_public_library').update({ is_free: !!isFree }).eq('id', id));
      }
      if (error) return res.status(500).json({ error: error.message });
      if (!isFree) await ensureThreeFree(supa); // reface minimul de 3 din alte teste
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
      let pubPayload = kind === 'pdf' ? cleanPdfPayload(payload) : payload;
      if (kind === 'pdf' && payload?.pdfPath) {
        const bucket = payload.bucket || 'personal-pdfs';
        const { data: fileData, error: dlErr } = await supa.storage.from(bucket).download(payload.pdfPath);
        if (dlErr || !fileData) return res.status(502).json({ error: 'PDF-ul nu a putut fi citit din Storage: ' + (dlErr?.message || 'necunoscut') });
        const copyPath = `public-library/${Date.now()}_${Math.random().toString(36).slice(2, 10)}.pdf`;
        const buf = Buffer.from(await fileData.arrayBuffer());
        const { error: upErr } = await supa.storage.from(bucket).upload(copyPath, buf, { contentType: 'application/pdf', upsert: false });
        if (upErr) return res.status(502).json({ error: 'Copia publică nu a putut fi creată: ' + upErr.message });
        pubPayload = { ...pubPayload, pdfPath: copyPath, bucket };
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
        is_free: false, // premium implicit; auto-promovarea/adminul pot marca gratuit
      }).select('id, title').single();
      if (error) return res.status(500).json({ error: error.message });
      await ensureThreeFree(supa); // dacă-s sub 3 gratuite, cel nou (cel mai recent) devine gratuit
      return res.status(200).json({ id: data.id, title: data.title });
    }

    if (action === 'record') {
      const userId = await ai.authUser(req, supa);
      const { id, score = 0, maxScore = 100 } = req.body || {};
      const profile = await ai.requireUser(supa, userId);
      if (!id) return res.status(400).json({ error: 'id obligatoriu' });
      // Notă: erorile de scriere NU se mai ignoră — altfel scorul se pierde
      // în tăcere iar clientul primește {ok:true} (bug istoric).
      try {
        await recordPublicResult(supa, { publicId: id, userId, profile, score, maxScore });
      } catch (e) {
        console.error('ai-public record error:', e.message);
        return res.status(500).json({ error: 'Scorul nu a putut fi salvat.', detail: e.message });
      }
      return res.status(200).json({ ok: true });
    }

    // Paginile unui material încărcat din POZE → textul lor (profesor/admin)
    if (action === 'transcribe') {
      const userId = await ai.authUser(req, supa);
      const profile = await ai.requireUser(supa, userId);
      if (!(profile.role === 'profesor' || profile.is_admin)) {
        return res.status(403).json({ error: 'Doar profesorii pot încărca materiale în bibliotecă.' });
      }
      // Fiecare poză primită își păstrează locul în răspuns: una invalidă sau peste
      // limite primește textul gol, ca paginile să nu alunece una peste alta.
      const raw = (Array.isArray(req.body?.images) ? req.body.images : []).slice(0, TRANSCRIBE_MAX);
      let total = 0;
      const images = [];
      const slots = [];   // slots[i] = indexul pozei i în `images` sau -1
      for (const u of raw) {
        const ok = typeof u === 'string' && u.length <= 1_500_000 && total + u.length <= 4_200_000
          && /^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/=]+$/.test(u);
        if (ok) { total += u.length; slots.push(images.length); images.push(u); } else slots.push(-1);
      }
      if (!images.length) return res.status(400).json({ error: 'Nu am primit nicio poză de transcris.' });
      const lim = await ai.enforceRateLimit(supa, userId, profile); // limita orară + creditele profesorului
      const parts = [];
      images.forEach((u, i) => {
        parts.push({ type: 'text', text: `Pagina ${i + 1} din ${images.length}:` });
        parts.push({ type: 'image_url', image_url: { url: u, detail: 'high' } });
      });
      parts.push({ type: 'text', text: `Transcrie cele ${images.length} pagini, în ordine.` });
      const schema = ai.S.obj({ pagini: ai.S.arr(ai.S.obj({ text: ai.S.str('tot textul paginii, cu formulele în LaTeX între $...$') })) });
      let r;
      try {
        r = await ai.chatJson({
          system: TRANSCRIBE_SYSTEM, messages: [{ role: 'user', content: parts }],
          schema, schemaName: 'transcriere_pagini', temperature: 0.1,
          maxTokens: Math.min(16000, 1500 + images.length * 1800),
          model: ai.pickModel(ai.VISION_MODEL, lim), restoreLatex: true,
        });
      } catch (e) {
        if (e.usage) await ai.logUsage(supa, userId, 'ai-public:transcribe', e.usage);
        throw e;
      }
      await ai.logUsage(supa, userId, 'ai-public:transcribe', r.usage);
      const got = (Array.isArray(r.data?.pagini) ? r.data.pagini : []).slice(0, images.length)
        .map((p) => String((p && p.text) || '').slice(0, 6000));
      const pages = slots.map((k) => (k >= 0 ? got[k] || '' : ''));
      return res.status(200).json({ pages });
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
      await ensureThreeFree(supa); // dacă s-a șters un test gratuit, completează minimul
      return res.status(200).json({ ok: true });
    }

    return res.status(400).json({ error: 'action invalid' });
  } catch (err) {
    if (!err.status || err.status >= 500) console.error('ai-public error:', err);
    return res.status(err.status || 500).json({ error: err.message || 'Eroare server', code: err.code || null });
  }
};

// exportate pentru api/ai-correct.js (rezultatul la un PDF din bibliotecă) și pentru teste
module.exports.recordPublicResult = recordPublicResult;
module.exports.cleanPdfPayload = cleanPdfPayload;
module.exports.buildSearchText = buildSearchText;
