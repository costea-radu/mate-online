// =====================================================================
// api/ai-ingest.js — motorul de "învățare constantă"
//
// Indexează conținutul în baza de cunoștințe (ai_knowledge) cu embeddings.
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
// indexare e GOALĂ, ca explicațiile să se genereze din cunoștințe la zi.
// =====================================================================
const ai = require('./_lib/ai');
const pregen = require('./_lib/pregen');

const BATCH = parseInt(process.env.AI_INGEST_BATCH || '20', 10);

// Etichetare simplă de subiect din titlu/descriere (ajută filtrarea în RAG).
const TOPIC_RULES = [
  [/fract|num[ăa]r ra[țt]ional/i, 'fractii'],
  [/procent/i, 'procente'],
  [/ecua[țt]/i, 'ecuatii'],
  [/inecua[țt]/i, 'inecuatii'],
  [/sistem/i, 'sisteme'],
  [/func[țt]/i, 'functii'],
  [/derivat/i, 'derivate'],
  [/integral/i, 'integrale'],
  [/limit/i, 'limite'],
  [/matric|determinant/i, 'matrici'],
  [/vector/i, 'vectori'],
  [/trigonometr|sin|cos/i, 'trigonometrie'],
  [/geometr|triunghi|cerc|patrulater|arie|volum|perimetru/i, 'geometrie'],
  [/probabilit|statistic/i, 'probabilitati'],
  [/divizib|prim|cmmdc|cmmmc/i, 'divizibilitate'],
  [/putere|radical|r[ăa]d[ăa]cin/i, 'puteri_radicali'],
  [/logaritm/i, 'logaritmi'],
  [/progres|[șs]ir/i, 'siruri'],
];
function guessTopic(text = '') {
  for (const [re, topic] of TOPIC_RULES) if (re.test(text)) return topic;
  return null;
}

const stripHtml = (s) => String(s || '').replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim();

function chunkText(text, size = 1100) {
  const t = String(text || '').trim();
  if (t.length <= size) return [t];
  const out = [];
  for (let i = 0; i < t.length; i += size) out.push(t.slice(i, i + size));
  return out;
}

// Construiește fragmentele (chunks) dintr-o sursă.
function buildChunks(sourceType, row) {
  if (sourceType === 'content') {
    const isManual = row.content_type === 'manual';
    const kbType = isManual ? 'manual' : 'exercise';
    const header = [row.title, row.description].filter(Boolean).join(' — ');
    const topic = guessTopic(`${row.title} ${row.description}`);
    if (isManual && row.manual_content) {
      const body = stripHtml(row.manual_content);
      return chunkText(`${header}\n${body}`).map((c, i) => ({
        source_type: kbType, source_id: row.id, chunk_index: i,
        category: row.category, topic, title: row.title, content: c, is_free: !!row.is_free,
      }));
    }
    // PDF / interactive: indexăm metadatele (titlu, descriere, categorie, tip).
    const meta = `Tip: ${row.content_type}. Categorie: ${row.category}. ${header}`;
    return [{
      source_type: kbType, source_id: row.id, chunk_index: 0,
      category: row.category, topic, title: row.title, content: meta, is_free: !!row.is_free,
    }];
  }
  // rezolvari
  const header = [row.title, row.description].filter(Boolean).join(' — ');
  const topic = guessTopic(`${row.title} ${row.description}`);
  const meta = `Rezolvare (${row.type}). Categorie: ${row.category || 'general'}. ${header}`;
  return [{
    source_type: 'solution', source_id: row.id, chunk_index: 0,
    category: row.category, topic, title: row.title, content: meta, is_free: row.is_free !== false,
  }];
}

async function fetchSource(supa, sourceType, id) {
  const table = sourceType === 'content' ? 'content' : 'rezolvari';
  const { data } = await supa.from(table).select('*').eq('id', id).single();
  return data;
}

// Procesează un lot din coadă: embed + upsert în ai_knowledge.
async function processQueue(supa) {
  const { data: jobs } = await supa.from('ai_ingest_queue')
    .select('*').is('processed_at', null).order('enqueued_at', { ascending: true }).limit(BATCH);
  if (!jobs || !jobs.length) return { processed: 0, embedded: 0, deleted: 0, remaining: 0 };

  let embedded = 0, deleted = 0;
  const allChunks = [];

  for (const job of jobs) {
    if (job.op === 'delete') {
      await supa.from('ai_knowledge').delete()
        .eq('source_type', job.source_type === 'content' ? 'exercise' : 'solution')
        .eq('source_id', job.source_id);
      // pentru content poate fi și 'manual'
      if (job.source_type === 'content') {
        await supa.from('ai_knowledge').delete().eq('source_type', 'manual').eq('source_id', job.source_id);
      }
      deleted++;
      continue;
    }
    const row = await fetchSource(supa, job.source_type, job.source_id);
    if (!row) continue;
    const chunks = buildChunks(job.source_type, row);
    chunks.forEach((c) => allChunks.push(c));

    // curăță fragmentele vechi rămase (dacă numărul s-a micșorat)
    const maxIdx = chunks.length;
    await supa.from('ai_knowledge').delete()
      .eq('source_type', chunks[0].source_type).eq('source_id', job.source_id).gte('chunk_index', maxIdx);
  }

  // Embeddings în bloc (dacă furnizorul e configurat).
  let vectors = null;
  if (ai.hasEmbeddings() && allChunks.length) {
    try { vectors = await ai.embed(allChunks.map((c) => c.content)); }
    catch (e) { console.warn('Embedding batch failed (continui fără vectori):', e.message); }
  }

  // Upsert fragmente.
  const rows = allChunks.map((c, i) => ({
    ...c,
    content_hash: ai.sha256(c.content),
    embedding: vectors ? vectors[i] : null,
    updated_at: new Date().toISOString(),
  }));
  if (rows.length) {
    const { error } = await supa.from('ai_knowledge').upsert(rows, { onConflict: 'source_type,source_id,chunk_index' });
    if (error) throw new Error('Upsert ai_knowledge: ' + error.message);
    embedded = vectors ? rows.length : 0;
  }

  // Marchează joburile ca procesate. Dacă asta eșuează în tăcere, cronul
  // reia ACELEAȘI joburi la fiecare rulare (re-embedding la nesfârșit = cost).
  const ids = jobs.map((j) => j.id);
  const { error: markErr } = await supa.from('ai_ingest_queue')
    .update({ processed_at: new Date().toISOString() }).in('id', ids);
  if (markErr) throw new Error('Marcare coadă procesată: ' + markErr.message);

  const { count: remaining } = await supa.from('ai_ingest_queue')
    .select('*', { count: 'exact', head: true }).is('processed_at', null);

  return { processed: jobs.length, embedded, deleted, remaining: remaining || 0 };
}

// Coada de indexare goală → folosim rularea cronului pentru pre-generare
// (câteva materiale per rulare; nu blochează niciodată indexarea).
async function processWithPregen(supa) {
  const q = await processQueue(supa);
  if (q.remaining === 0) {
    try { q.pregen = await pregen.processBatch(supa); }
    catch (e) { console.warn('pregen în cron:', e.message); q.pregen = { pregenerated: 0, note: e.message }; }
  }
  return q;
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
  const types = ['exercise', 'solution', 'manual', 'theory', 'faq'];
  const counts = {};
  for (const t of types) {
    const { count } = await supa.from('ai_knowledge').select('*', { count: 'exact', head: true }).eq('source_type', t);
    counts[t] = count || 0;
  }
  const { count: pending } = await supa.from('ai_ingest_queue').select('*', { count: 'exact', head: true }).is('processed_at', null);
  const { count: withVec } = await supa.from('ai_knowledge').select('*', { count: 'exact', head: true }).not('embedding', 'is', null);
  const { count: totalKb } = await supa.from('ai_knowledge').select('*', { count: 'exact', head: true });
  return {
    knowledge: counts,
    total: totalKb || 0,
    embedded: withVec || 0,
    pending_queue: pending || 0,
    embeddings_provider: ai.hasEmbeddings() ? ai.EMBED_MODEL : 'inactiv (fallback lexical)',
    chat_model: ai.CHAT_MODEL,
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
      const cronOk = req.headers['x-vercel-cron'] || (process.env.AI_CRON_SECRET && req.query.secret === process.env.AI_CRON_SECRET);
      if (action === 'process' && cronOk) return res.status(200).json(await processWithPregen(supa));
      return res.status(403).json({ error: 'Neautorizat' });
    }

    if (req.method !== 'POST') return res.status(405).json({ error: 'Method Not Allowed' });

    const userId = await ai.authUser(req, supa);
    const { action = 'process' } = req.body || {};
    const profile = await ai.requireUser(supa, userId);
    if (!profile.is_admin) return res.status(403).json({ error: 'Doar administratorii pot indexa.' });

    if (action === 'process') return res.status(200).json(await processWithPregen(supa));
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
