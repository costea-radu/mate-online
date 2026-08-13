// =====================================================================
// api/_lib/pregen.js — explicații PRE-GENERATE per exercițiu (pasul 3
// din GHID_LIMITE_AI.md).
//
// Ideea: baza de exerciții e FINITĂ. „Explică-mi exercițiul X" și „dă-mi
// un indiciu la X" au același răspuns bun pentru toți elevii — îl generăm
// O DATĂ, offline, pe modelul ieftin, și îl servim apoi dintr-un SELECT
// (cost 0, latență ~0). Generarea rulează în loturi mici din cronul
// existent de ingest (/api/ai-ingest?action=process), DUPĂ ce coada de
// indexare e goală (cunoștințele sunt la zi înainte să explice din ele).
//
// Servirea (din ai-chat / ai-chat-stream) e CONSERVATOARE — doar când:
//   · modul e 'explain' sau 'hint' și există context.contentId;
//   · e PRIMUL mesaj al conversației (fără istoric care să schimbe sensul);
//   · mesajul e o cerere CANONICĂ („explică-mi...", „dă-mi un indiciu") —
//     o întrebare specifică merge pe fluxul normal, cu răspuns personalizat;
//   · materialul e gratuit SAU elevul e abonat (nu scurgem conținut premium).
// =====================================================================
const ai = require('./ai');
const { norm } = require('./barem');

const BATCH = parseInt(process.env.AI_PREGEN_BATCH || '3', 10);
const DISABLED = process.env.AI_PREGEN_DISABLED === '1';
const PREGEN_MODEL = process.env.AI_PREGEN_MODEL || ai.CHAT_MODEL;
const MAX_SOURCE_CHARS = 9000;

const warned = new Set();
const warnOnce = (k, msg) => { if (!warned.has(k)) { warned.add(k); console.warn(msg); } };

// ─── Cererea canonică (exportat pentru teste) ────────────────────────────────
// Scurtă și generică → se poate servi răspunsul canonic. Orice întrebare
// specifică (lungă sau cu detalii) → fluxul normal de chat.
const RE_EXPLAIN = /(explica|explicatie|teorie|teoria|cum se rezolva|cum se face|nu (inteleg|am inteles)|nu stiu (cum|sa)|ajuta-?ma|despre ce (e|este)|ce trebuie sa fac|invata-?ma|arata-?mi cum)/;
const RE_HINT = /(indiciu|hint|un pas|primul pas|de unde (incep|pornesc)|cum (incep|pornesc)|o idee|un pont|ajutor la inceput|impinge-?ma)/;
function isCanonicalAsk(message, mode) {
  const m = norm(String(message || '')).trim();
  if (!m || m.length > 120) return false; // mesaj lung = întrebare specifică
  if (mode === 'explain') return RE_EXPLAIN.test(m);
  if (mode === 'hint') return RE_HINT.test(m);
  return false;
}

// Condițiile PURE de servire (fără DB) — apelate de endpoint-uri.
function canServe({ mode, context = {}, conversationId, message }) {
  if (DISABLED) return false;
  if (mode !== 'explain' && mode !== 'hint') return false;
  if (!context.contentId || context.pdf) return false; // agentul PDF are fluxul lui (barem)
  if (conversationId) return false;                    // doar prima întrebare din conversație
  return isCanonicalAsk(message, mode);
}

// ─── Sursa unui material: cunoștințele lui indexate din ai_knowledge ─────────
async function sourceFor(supa, contentId) {
  const { data: c } = await supa.from('content')
    .select('id, title, category, content_type, is_free').eq('id', contentId).maybeSingle();
  if (!c) return null;
  const { data: chunks } = await supa.from('ai_knowledge')
    .select('source_type, chunk_index, topic, content')
    .eq('source_id', contentId)
    .order('source_type', { ascending: true }).order('chunk_index', { ascending: true })
    .limit(40);
  if (!chunks || !chunks.length) return null;

  const enunt = chunks.filter((k) => k.source_type !== 'solution').map((k) => k.content).join('\n');
  const rezolvare = chunks.filter((k) => k.source_type === 'solution').map((k) => k.content).join('\n');
  let text = `TITLU: ${c.title}\nCATEGORIE: ${c.category}${chunks[0].topic ? `\nSUBIECT: ${chunks[0].topic}` : ''}\n\nMATERIALUL:\n"""${enunt.slice(0, MAX_SOURCE_CHARS)}"""`;
  if (rezolvare) text += `\n\nREZOLVAREA (sprijin intern — elevul nu o vede direct):\n"""${rezolvare.slice(0, Math.max(1500, MAX_SOURCE_CHARS - enunt.length))}"""`;
  return { content: c, text, hash: ai.sha256(text) };
}

// ─── Generarea unei intrări (explain sau hint) ───────────────────────────────
const KINDS = {
  explain: {
    ask: 'Explică-mi acest material, ca și cum aș fi un elev care îl deschide prima dată și nu știe de unde să înceapă.',
    maxTokens: 900,
    extra: 'Scrie o explicație CANONICĂ, valabilă pentru orice elev (fără să presupui o întrebare anume): despre ce e materialul, noțiunile necesare, metoda de rezolvare pas cu pas pe ideile principale și un sfat de final. Formulele în LaTeX ($...$).',
  },
  hint: {
    ask: 'Dă-mi un indiciu ca să încep singur acest material.',
    maxTokens: 320,
    extra: 'Scrie UN SINGUR indiciu canonic pentru primul pas, valabil pentru orice elev. NU dezvălui rezolvarea și NU da rezultate finale. Încheie cu o întrebare care îl pune pe elev în mișcare.',
  },
};

async function generateFor(supa, contentId, kind, src = null) {
  const k = KINDS[kind];
  if (!k) return null;
  const s = src || await sourceFor(supa, contentId);
  if (!s) return null;
  const system = `${ai.PERSONA}\n\n${ai.MODE_ROLES[kind === 'hint' ? 'hint' : 'explain']}\n\n${k.extra}\n\n${s.text}`;
  const { text, usage } = await ai.chat({
    system, messages: [{ role: 'user', content: k.ask }],
    temperature: 0.3, maxTokens: k.maxTokens, model: PREGEN_MODEL,
  });
  if (!String(text || '').trim()) return null;
  const { error } = await supa.from('ai_pregen').upsert({
    content_id: contentId, kind, text: text.trim(),
    model: usage.model || PREGEN_MODEL, source_hash: s.hash,
    updated_at: new Date().toISOString(),
  }, { onConflict: 'content_id,kind' });
  if (error) { warnOnce('upsert', `pregen: upsert eșuat (rulează supabase/ai_pregen.sql?): ${error.message}`); return null; }
  // cost de PLATFORMĂ (user_id null) — apare în ai_usage_daily, nu în bugetul vreunui elev
  await ai.logUsage(supa, null, `ai-pregen:${kind}`, usage);
  return { contentId, kind, chars: text.length };
}

// ─── Procesare în loturi (apelată din cronul de ingest) ──────────────────────
async function processBatch(supa, limit = BATCH) {
  if (DISABLED) return { pregenerated: 0, note: 'AI_PREGEN_DISABLED=1' };
  if (!ai.hasChat()) return { pregenerated: 0, note: 'fără cheie LLM' };
  let ids = [];
  try {
    const { data, error } = await supa.rpc('ai_pregen_candidates', { p_limit: limit });
    if (error) throw new Error(error.message);
    ids = (data || []).map((r) => r.content_id || r);
  } catch (e) {
    warnOnce('candidates', `Pre-generarea inactivă — rulează supabase/ai_pregen.sql. Detaliu: ${e.message}`);
    return { pregenerated: 0, note: 'migrarea ai_pregen.sql nerulată' };
  }
  let done = 0;
  for (const id of ids) {
    try {
      const src = await sourceFor(supa, id);
      if (!src) continue;
      // generăm doar ce lipsește sau e învechit (hash diferit)
      const { data: existing } = await supa.from('ai_pregen')
        .select('kind, source_hash').eq('content_id', id);
      const have = new Map((existing || []).map((r) => [r.kind, r.source_hash]));
      for (const kind of Object.keys(KINDS)) {
        if (have.get(kind) === src.hash) continue; // proaspăt → sari
        const r = await generateFor(supa, id, kind, src);
        if (r) done++;
      }
    } catch (e) { console.warn(`pregen: ${id}: ${e.message}`); }
  }
  return { pregenerated: done, candidates: ids.length };
}

// ─── Servire (din chat): intrarea pre-generată + gardul premium ──────────────
// Întoarce { text, model } sau null (lipsă / conținut premium la cont gratuit).
async function getServable(supa, { contentId, mode, premium }) {
  try {
    const { data } = await supa.from('ai_pregen')
      .select('text, model, content:content_id ( is_free )')
      .eq('content_id', contentId).eq('kind', mode).maybeSingle();
    if (!data || !String(data.text || '').trim()) return null;
    const isFree = data.content ? !!data.content.is_free : false;
    if (!isFree && !premium) return null; // nu scurgem explicații de conținut premium
    return { text: data.text, model: data.model || null };
  } catch (e) {
    warnOnce('serve', `pregen: servire indisponibilă: ${e.message}`);
    return null;
  }
}

// Statistici pentru panoul de admin (best-effort). Cerem doar COUNT-ul
// (head + count exact) pe RPC, nu rândurile: PostgREST trunchiază orice
// răspuns la „Max rows" (implicit 1000), deci numărarea rândurilor plafona
// „De pre-generat" la 1000. Content-Range cu count=exact dă totalul real.
// Funcția e STABLE, deci HEAD e permis. Fallback: metoda veche (plafonată).
async function stats(supa) {
  try {
    const { count: total } = await supa.from('ai_pregen').select('*', { count: 'exact', head: true });
    let pending = null;
    const { count, error } = await supa.rpc('ai_pregen_candidates', { p_limit: 100000 },
      { count: 'exact', head: true });
    if (!error && typeof count === 'number') pending = count;
    else {
      const { data: cand } = await supa.rpc('ai_pregen_candidates', { p_limit: 100000 });
      pending = (cand || []).length;
    }
    return { pregen_total: total || 0, pregen_pending: pending };
  } catch { return { pregen_total: 0, pregen_pending: null }; }
}

module.exports = { canServe, isCanonicalAsk, getServable, processBatch, generateFor, sourceFor, stats, BATCH };
