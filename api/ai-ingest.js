// =====================================================================
// api/ai-ingest.js — motorul de "învățare constantă"
//
// Indexează conținutul în baza de cunoștințe (ai_knowledge) cu embeddings.
// Etapa 3 (1.5): fragmente pe EXERCIȚII din textul real (PDF din cache,
// JSON-ul exercițiilor interactive, paragrafe din manuale), cu capitolul din
// programă; content_hash se compară — doar fragmentele schimbate se re-vectorizează.
//
// POST { userId, action }  (userId = admin)
//   action='process' : procesează coada (materiale noi/modificate)  [și GET, pentru cron]
//   action='reindex' : pune TOT conținutul în coadă, apoi procesează un lot
//   action='stats'   : statistici despre baza de cunoștințe
//
// CRON (Vercel): GET /api/ai-ingest?action=process  (rulează automat la interval)
//
// Pe același cron rulează și PRE-GENERAREA explicațiilor per exercițiu
// (_lib/pregen.js, pasul 3 din GHID_LIMITE_AI.md) — doar când coada de
// indexare e GOALĂ, ca explicațiile să se genereze din cunoștințe la zi —
// și ALARMA DE COST (_lib/costwatch.js, pasul 4): dacă costul AI de azi
// trece de AI_ALERT_DAY_LEI, adminul primește email în cel mult 10 minute.
// =====================================================================
const ai = require('./_lib/ai');
const pregen = require('./_lib/pregen');
const costwatch = require('./_lib/costwatch');

const BATCH = parseInt(process.env.AI_INGEST_BATCH || '20', 10);
// buget de timp per rulare (PDF-urile se citesc din cache, dar prima indexare
// descarcă și parsează fișierul + baremele-candidat) — restul rămâne în coadă
const TIME_MS = parseInt(process.env.AI_INGEST_TIME_MS || '60000', 10);
const ingest = require('./_lib/ingest');   // fragmentele pe EXERCIȚII (Etapa 3, 1.5)
const B = require('./_lib/barem');         // isBaremRow

async function fetchSource(supa, sourceType, id) {
  const table = sourceType === 'content' ? 'content' : 'rezolvari';
  const { data } = await supa.from(table).select('*').eq('id', id).single();
  return data;
}

// Textul unui PDF: din cache-ul ai_pdf_text (sau calculat și pus în cache) —
// aceeași sursă ca Profesorul Virtual. HTML-ul unui interactiv fără JSON: din Storage.
async function sourceTexts(supa, row) {
  const out = { pdfText: null, html: null, isBarem: false };
  if (row.content_type === 'pdf' && row.file_url) {
    out.isBarem = (row.subcategory || '') === 'bareme' || !!B.isBaremRow(row);
    try {
      const pdfCtx = require('./ai-pdf-context');
      if (out.isBarem) {
        // baremul: doar textul lui (fără potrivirea test ↔ barem, inutilă aici)
        const r = await pdfCtx.contentPdfText(supa, row, 60000);
        out.pdfText = r.text || '';
      } else {
        const ctx = await pdfCtx.getPdfContext(supa, row);
        out.pdfText = ctx.text || '';
      }
    } catch (e) { console.warn('ingest: textul PDF indisponibil (%s): %s', row.title, e.message); }
  } else if (row.content_type === 'interactive' && !(row.interactive_data && row.interactive_data.exercise) && row.file_url) {
    try {
      const { loadContentHtml } = require('./_lib/score');
      out.html = await loadContentHtml(supa, row);
    } catch (e) { console.warn('ingest: HTML indisponibil (%s): %s', row.title, e.message); }
  }
  return out;
}

// Construiește fragmentele unei surse (content / rezolvari).
async function buildChunks(supa, sourceType, row) {
  if (sourceType === 'content') return ingest.chunksForContent(row, await sourceTexts(supa, row));
  return ingest.chunksForRezolvare(row);
}

// Procesează un lot din coadă: fragmente → (doar cele schimbate) embed → upsert.
async function processQueue(supa) {
  const { data: jobs } = await supa.from('ai_ingest_queue')
    .select('*').is('processed_at', null).order('enqueued_at', { ascending: true }).limit(BATCH);
  if (!jobs || !jobs.length) return { processed: 0, embedded: 0, deleted: 0, skipped: 0, remaining: 0 };

  const t0 = Date.now();
  let embedded = 0, deleted = 0, skipped = 0, chunksTotal = 0;
  const toEmbed = [];   // fragmente noi/schimbate (primesc vectori)
  const toWrite = [];   // toate fragmentele de scris (schimbate + cele fără vector)
  const doneJobs = [];

  for (const job of jobs) {
    if (Date.now() - t0 > TIME_MS && doneJobs.length) break; // restul rămâne în coadă
    try {
      if (job.op === 'delete') {
        await supa.from('ai_knowledge').delete().eq('source_id', job.source_id);
        deleted++; doneJobs.push(job); continue;
      }
      const row = await fetchSource(supa, job.source_type, job.source_id);
      if (!row) { doneJobs.push(job); continue; }
      const chunks = await buildChunks(supa, job.source_type, row);
      chunksTotal += chunks.length;
      // ce există deja pentru sursă: hash + dacă are vector
      const { data: existing } = await supa.from('ai_knowledge')
        .select('source_type, chunk_index, content_hash, embedding').eq('source_id', job.source_id);
      const have = new Map((existing || []).map((r) => [`${r.source_type}:${r.chunk_index}`, { hash: r.content_hash, vec: r.embedding != null }]));
      const kinds = new Set(chunks.map((c) => c.source_type));
      for (const c of chunks) {
        // hash-ul acoperă și metadatele INDEXATE (is_free, categorie, titlu,
        // capitol): altfel un test trecut din gratuit în premium rămânea
        // `is_free=true` în ai_knowledge și continua să apară la conturile free
        const hash = ai.sha256([c.content, c.category, c.is_free, c.title, c.chapter_id || ''].join('\u0000'));
        const prev = have.get(`${c.source_type}:${c.chunk_index}`);
        if (prev && prev.hash === hash && prev.vec) { skipped++; continue; } // neschimbat → nu-l atingem
        const rowOut = { ...c, content_hash: hash, updated_at: new Date().toISOString() };
        toWrite.push(rowOut);
        toEmbed.push(rowOut);
      }
      // fragmentele vechi de prisos: indexuri peste număr sau alt source_type
      for (const k of kinds) {
        const n = chunks.filter((c) => c.source_type === k).length;
        await supa.from('ai_knowledge').delete().eq('source_id', job.source_id).eq('source_type', k).gte('chunk_index', n);
      }
      const stale = [...new Set((existing || []).map((r) => r.source_type))].filter((k) => !kinds.has(k));
      for (const k of stale) await supa.from('ai_knowledge').delete().eq('source_id', job.source_id).eq('source_type', k);
      doneJobs.push(job);
    } catch (e) {
      console.error('ingest: jobul %s/%s a eșuat: %s', job.source_type, job.source_id, e.message);
      doneJobs.push(job); // nu blocăm coada la nesfârșit pe o sursă defectă
    }
  }

  // Embeddings în bloc, DOAR pentru fragmentele noi/schimbate.
  let vectors = null;
  if (ai.hasEmbeddings() && toEmbed.length) {
    try {
      // pe felii de 128: un lot mare (20 materiale × zeci de exerciții) depășea
      // limita de tokeni a unui singur apel de embeddings
      vectors = [];
      for (let i = 0; i < toEmbed.length; i += 128) {
        const part = await ai.embed(toEmbed.slice(i, i + 128).map((c) => c.content));
        vectors.push(...(Array.isArray(part) ? part : [part]));
      }
    } catch (e) { vectors = null; console.warn('Embedding batch failed (scriu fragmentele fără vectori noi):', e.message); }
  }
  if (vectors) { toEmbed.forEach((c, i) => { c.embedding = vectors[i]; }); embedded = toEmbed.length; }
  // fără vectori: scriem textul (și păstrăm vectorul vechi, dacă există — nu trimitem cheia `embedding`)

  let badRows = 0;
  if (toWrite.length) {
    const ON = { onConflict: 'source_type,source_id,chunk_index' };
    // plasă de siguranță: chiar dacă ingest.safeRow a curățat deja fragmentele,
    // trecem încă o dată peste TOT ce se scrie — orice octet de control scăpat
    // face Postgres să respingă LOTUL ÎNTREG cu „unsupported Unicode escape sequence"
    const rows = toWrite.map((r) => ingest.safeRow(r));
    let { error } = await supa.from('ai_knowledge').upsert(rows, ON);
    if (error && /chapter_id/.test(error.message || '')) {
      // migrarea supabase/ai_rag_v2.sql nu e rulată → indexăm fără capitol
      console.warn('ai_knowledge fără coloana chapter_id — rulează supabase/ai_rag_v2.sql (indexez fără capitol)');
      const noChapter = rows.map(({ chapter_id: _drop, ...r }) => r); // eslint-disable-line no-unused-vars
      ({ error } = await supa.from('ai_knowledge').upsert(noChapter, ON));
    }
    if (error) {
      // Ultimul resort: scriem rând cu rând. Fără asta, un SINGUR fragment defect
      // pică tot lotul, joburile nu se marchează procesate, iar cronul reia la
      // fiecare 10 minute ACELEAȘI materiale — re-embedding la nesfârșit, pe bani.
      console.warn('Upsert în bloc a eșuat (%s) — scriu rând cu rând, ca lotul să avanseze.', error.message);
      for (const r of rows) {
        const { error: e1 } = await supa.from('ai_knowledge').upsert([r], ON);
        if (!e1) continue;
        const { chapter_id: _d, ...noCh } = r; // eslint-disable-line no-unused-vars
        const { error: e2 } = await supa.from('ai_knowledge').upsert([noCh], ON);
        if (e2) { badRows++; console.warn('  fragment sărit %s#%s: %s', r.source_id, r.chunk_index, e2.message); }
      }
      // tot lotul respins → e o problemă reală (schemă, drepturi), nu un fragment defect
      if (badRows === rows.length) throw new Error('Upsert ai_knowledge: ' + error.message);
    }
  }

  // Marchează joburile ca procesate. Dacă asta eșuează în tăcere, cronul
  // reia ACELEAȘI joburi la fiecare rulare (re-embedding la nesfârșit = cost).
  const ids = doneJobs.map((j) => j.id);
  if (ids.length) {
    const { error: markErr } = await supa.from('ai_ingest_queue')
      .update({ processed_at: new Date().toISOString() }).in('id', ids);
    if (markErr) throw new Error('Marcare coadă procesată: ' + markErr.message);
  }
  // curățăm rândurile procesate mai vechi de 7 zile (funcția din ai_rag_v2.sql; lipsa ei nu e eroare)
  try { await supa.rpc('ai_ingest_queue_purge'); } catch { /* migrare nerulată */ }

  const { count: remaining } = await supa.from('ai_ingest_queue')
    .select('*', { count: 'exact', head: true }).is('processed_at', null);

  return { processed: doneJobs.length, chunks: chunksTotal, embedded, skipped, deleted, ...(badRows ? { badRows } : {}), remaining: remaining || 0 };
}

// Coada de indexare goală → folosim rularea cronului pentru pre-generare
// (câteva materiale per rulare; nu blochează niciodată indexarea).
async function processWithPregen(supa) {
  const q = await processQueue(supa);
  if (q.remaining === 0) {
    try { q.pregen = await pregen.processBatch(supa); }
    catch (e) { console.warn('pregen în cron:', e.message); q.pregen = { pregenerated: 0, note: e.message }; }
  }
  // Alarma de cost (pasul 4) — o interogare agregată ieftină, la FIECARE
  // rulare (indiferent de coadă); trimite email cel mult o dată pe zi.
  try { q.costAlert = await costwatch.checkThreshold(supa); }
  catch (e) { console.warn('costwatch în cron:', e.message); }
  return q;
}

// ── Etapa 3 (5.1): unifică subiectele duplicate din ai_skill_mastery ─────────
// „ecuatii_gradul_1", „Ecuații de gradul I" și „ecuatii gradul 1" erau trei
// competențe diferite; le aducem pe toate la eticheta din taxonomie și le
// îmbinăm (merge_skill_topic din supabase/meditatii_v3.sql).
async function normalizeTopics(supa, { dryRun = false } = {}) {
  const taxonomy = require('./_lib/taxonomy');
  const { data: rows, error } = await supa.from('ai_skill_mastery')
    .select('user_id, category, topic, attempts').limit(20000);
  if (error) throw new Error('ai_skill_mastery: ' + error.message);
  const plan = [];
  for (const r of rows || []) {
    const to = taxonomy.canonicalTopic(r.topic, { category: r.category });
    if (to && to !== r.topic) plan.push({ user_id: r.user_id, category: r.category, from: r.topic, to });
  }
  if (dryRun) return { total: (rows || []).length, toMerge: plan.length, sample: plan.slice(0, 20) };
  let merged = 0, failed = 0, lastErr = null;
  for (const m of plan) {
    const { error: e } = await supa.rpc('merge_skill_topic', { p_user: m.user_id, p_category: m.category, p_from: m.from, p_to: m.to });
    if (e) { failed++; lastErr = e.message; } else merged++;
    if (failed >= 5) break; // funcția lipsește / altă problemă sistematică — nu insistăm
  }
  if (failed) console.warn('normalize_topics: merge_skill_topic a eșuat (%s)', lastErr);
  return {
    total: (rows || []).length, toMerge: plan.length, merged, failed,
    ...(failed ? { note: `rulează supabase/meditatii_v3.sql (funcția merge_skill_topic): ${String(lastErr).slice(0, 120)}` } : {}),
  };
}

async function enqueueAll(supa) {
  let total = 0;
  const PAGE = 1000;
  const CHUNK = 50; // câte enqueue-uri rulăm în paralel
  for (const [src, table] of [['content', 'content'], ['rezolvari', 'rezolvari']]) {
    let from = 0;
    while (true) {
      const { data, error } = await supa.from(table).select('id')
        .order('id', { ascending: true }).range(from, from + PAGE - 1);
      if (error) break;
      const rows = data || [];
      for (let i = 0; i < rows.length; i += CHUNK) {
        await Promise.all(rows.slice(i, i + CHUNK).map((r) =>
          supa.rpc('enqueue_ingest', { p_source: src, p_id: r.id, p_op: 'upsert' })));
        total += Math.min(CHUNK, rows.length - i);
      }
      if (rows.length < PAGE) break;
      from += PAGE;
    }
  }
  return total;
}

async function stats(supa) {
  const types = ['exercise', 'solution', 'manual']; // (theory/faq nu se produc nicăieri)
  const counts = {};
  for (const t of types) {
    const { count } = await supa.from('ai_knowledge').select('*', { count: 'exact', head: true }).eq('source_type', t);
    counts[t] = count || 0;
  }
  const { count: pending } = await supa.from('ai_ingest_queue').select('*', { count: 'exact', head: true }).is('processed_at', null);
  const { count: withVec } = await supa.from('ai_knowledge').select('*', { count: 'exact', head: true }).not('embedding', 'is', null);
  // fragmente cu capitol din programă (Etapa 3) — 0/eroare dacă migrarea ai_rag_v2.sql nu e rulată
  let withChapter = null;
  try { const r = await supa.from('ai_knowledge').select('*', { count: 'exact', head: true }).not('chapter_id', 'is', null); withChapter = r.error ? null : (r.count || 0); } catch { withChapter = null; }
  const { count: totalKb } = await supa.from('ai_knowledge').select('*', { count: 'exact', head: true });
  return {
    knowledge: counts,
    total: totalKb || 0,
    embedded: withVec || 0,
    with_chapter: withChapter, // null = migrarea RAG v2 nerulată
    pending_queue: pending || 0,
    embeddings_provider: ai.hasEmbeddings() ? ai.EMBED_MODEL : 'inactiv (fallback lexical)',
    chat_model: ai.CHAT_MODEL,
    // modelele pe moduri (Etapa 2, 1.4) — vizibile în panoul admin AI
    tutor_model: ai.TUTOR_MODEL,
    pdf_model: ai.PDF_MODEL,
    gen_model: ai.GEN_MODEL,
    reasoning_effort: ai.REASONING_EFFORT || 'implicit',
    ...(await pregen.stats(supa)), // pregen_total + pregen_pending (pasul 3)
  };
}

module.exports = async function handler(req, res) {
  ai.applyCors(res);
  if (req.method === 'OPTIONS') return res.status(204).end();

  const supa = ai.admin();
  try {
    // CRON (Vercel) sau apel automat: GET ?action=process
    if (req.method === 'GET') {
      const action = (req.query.action || 'process');
      const cronOk = ai.isCronRequest(req); // x-vercel-cron(-schedule) / vercel-cron UA / Bearer CRON_SECRET / ?secret=
      if (action === 'process' && cronOk) return res.status(200).json(await processWithPregen(supa));
      return res.status(403).json({ error: 'Neautorizat' });
    }

    if (req.method !== 'POST') return res.status(405).json({ error: 'Method Not Allowed' });

    const userId = await ai.authUser(req, supa);
    const { action = 'process' } = req.body || {};
    const profile = await ai.requireUser(supa, userId);
    if (!profile.is_admin) return res.status(403).json({ error: 'Doar administratorii pot indexa.' });

    if (action === 'process') return res.status(200).json(await processWithPregen(supa));
    // Etapa 3 (5.1): unificarea subiectelor din ai_skill_mastery (o singură dată)
    if (action === 'normalize_topics') return res.status(200).json(await normalizeTopics(supa, { dryRun: !!req.body?.dryRun }));
    if (action === 'stats')   return res.status(200).json(await stats(supa));
    if (action === 'reindex') {
      const enqueued = await enqueueAll(supa);
      const first = await processQueue(supa); // procesăm primul lot imediat
      return res.status(200).json({ enqueued, firstBatch: first, note: 'Apelează din nou "process" până când pending_queue = 0.' });
    }
    return res.status(400).json({ error: 'action invalid' });
  } catch (err) {
    console.error('ai-ingest error:', err);
    return res.status(err.status || 500).json({ error: err.message || 'Eroare server' });
  }
};
