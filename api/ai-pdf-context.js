// =====================================================================
// api/ai-pdf-context.js — textul unui PDF deschis, pentru Profesorul Virtual
// Body: { userId, contentId }
// Răspuns: { text, chars, truncated, title, fileName, category,
//            barem, baremText, baremStatus }
//
// Elevul deschide un PDF (variantă de examen, fișă etc.) și îl întreabă pe
// profesor despre exercițiile din el. Aici extragem textul PDF-ului pe server
// (pdf-parse) și îl trimitem în contextul conversației — ÎMPREUNĂ cu baremul
// lui oficial, găsit în aceeași categorie (Bacalaureat SAU Evaluare Națională).
//
// Asocierea test ↔ barem, în ordine (vezi _lib/barem.js):
//   1. METADATE: titlul din site + numele original al fișierului (an, variantă,
//      test de antrenament, model/simulare/rezervă/specială, profil la BAC);
//      lipsurile din titlu se completează din ANTETUL PDF-ului deschis;
//   2. ANTETUL baremului-candidat (descărcat): „Anul școlar 2023 – 2024 ·
//      Varianta 7" trebuie să spună același lucru ca testul;
//   3. CONȚINUTUL: numerele din enunțuri (la EN: Subiectul al III-lea) trebuie
//      să se regăsească în rezolvările din barem.
// Regula de aur rămâne: mai bine NICIUN barem decât baremul GREȘIT.
// =====================================================================
const ai = require('./_lib/ai');
const { storagePath, pageRenderer, toPdfData } = require('./_lib/pdftext');
const B = require('./_lib/barem');

const MAX_PAGES = parseInt(process.env.AI_PDF_MAX_PAGES || '20', 10);
const MAX_CHARS = parseInt(process.env.AI_PDF_MAX_CHARS || '20000', 10);
const BAREM_MAX_CHARS = parseInt(process.env.AI_BAREM_MAX_CHARS || '12000', 10);
// câți candidați de barem citim (descărcăm) când metadatele nu decid singure
const CONTENT_CANDIDATES = parseInt(process.env.AI_BAREM_CONTENT_CANDIDATES || '8', 10);

// Descarcă un PDF din `content` și îi extrage textul (cu rezervă pe Storage).
// Răspuns: { text (tăiat la maxChars), full (tot textul), chars, truncated }
// Octeții PDF-ului unui material (URL public / semnat, cu rezervă pe Storage)
async function downloadContentPdf(supa, content) {
  const url = content.is_free ? content.file_url : await ai.signedUrlFromPublic(supa, content.file_url, 300);
  let buf = null;
  try {
    const r = await fetch(url);
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    buf = Buffer.from(await r.arrayBuffer());
  } catch (e) {
    try {
      const { bucket, filePath } = storagePath(content.file_url);
      const { data } = await supa.storage.from(bucket).download(filePath);
      if (data) buf = Buffer.from(await data.arrayBuffer());
    } catch { /* rămâne null */ }
    if (!buf) throw new Error('Nu am putut descărca fișierul: ' + e.message);
  }
  return buf;
}

async function contentPdfText(supa, content, maxChars) {
  const buf = await downloadContentPdf(supa, content);
  let text = '';
  const pages = []; // textul FIECĂREI pagini (Etapa 2: paginile exercițiului merg la model)
  try {
    const pdfParse = require('pdf-parse');
    // pageRenderer: rânduri în ordinea vizuală, cu spații corecte — altfel
    // formulele („x*y=5(x-1)(y-1)+1", fracții) ies terci și AI-ul citește greșit
    const parsed = await pdfParse(toPdfData(buf), {
      max: MAX_PAGES,
      pagerender: (pd) => pageRenderer(pd).then((t) => { pages.push(String(t || '').replace(/[ \t]+/g, ' ').replace(/\n{3,}/g, '\n\n').trim()); return t; }),
    });
    text = String(parsed.text || '').replace(/[ \t]+/g, ' ').replace(/\n{3,}/g, '\n\n').trim();
  } catch (e) {
    console.warn('ai-pdf-context pdf-parse:', e.message);
  }
  return { text: text.slice(0, maxChars), full: text, chars: text.length, truncated: text.length > maxChars, pages, buf };
}

// ── DECIZIA test ↔ barem (pură: primește candidații și un cititor de text) ────
// `readText(candidate)` → textul baremului-candidat ('' dacă e scanat/indisponibil).
// Răspuns: { barem: {id,title,fileName,matchedBy,evidence,contentScore} | null,
//            text, status, tried }
//   status: 'ok' (metadate confirmate de antet/conținut) | 'ok_antet' (decis de
//           antetul PDF-urilor) | 'ok_continut' (decis de numerele din enunțuri) |
//           'negasit' | 'ambiguu' | 'continut_diferit'
async function chooseBarem({ content, subjectText, candidates, readText, maxRead = CONTENT_CANDIDATES, log = console.warn }) {
  const exam = B.examOf(content);
  const subjectDoc = B.docTokens(subjectText);                // ce spune PDF-ul deschis despre el
  const subject = B.tokensOf(content, subjectDoc);            // metadate + antet
  const pool = (candidates || []).filter((c) => c && c.id !== content.id && c.file_url && B.isBaremRow(c));
  const texts = new Map();
  const read = async (c) => {
    if (!texts.has(c.id)) {
      let t = '';
      try { t = String((await readText(c)) || ''); } catch (e) { log(`ai-pdf-context: baremul „${c.title}" nu a putut fi citit: ${e.message}`); }
      texts.set(c.id, t.length > 50 ? t : '');
    }
    return texts.get(c.id);
  };
  // verdictul unui candidat CITIT: antet + conținut
  const judge = async (c) => {
    const text = await read(c);
    if (!text) return { c, text: '', compat: 'fara_text', score: null };
    const all = B.tokensOf(c, B.docTokens(text));             // metadatele baremului + antetul lui
    const compat = B.docsCompatible(subject, all);
    const score = B.contentMatchScore(subjectText, text, { exam });
    return { c, text, compat, score, evidence: B.describeTokens(all) };
  };
  const pack = (j, matchedBy, status) => ({
    barem: {
      id: j.c.id, title: j.c.title || 'Barem', fileName: B.fileNameOf(j.c) || null,
      matchedBy, evidence: j.evidence || B.describeTokens(subject) || null,
      contentScore: j.score,
    },
    text: j.text, status, tried: texts.size,
  });
  const minScore = 0.35; // sub acest prag, „titlurile mint" (numerele testului nu sunt în barem)

  // 1) potrivire STRICTĂ pe metadate (titlu + numele fișierului + antetul testului)
  const m = B.matchBarem(content, pool, subjectDoc);
  let status = m.status;
  if (m.barem) {
    const j = await judge(m.barem);
    if (j.compat === 'match') return pack(j, 'metadate+antet', 'ok');
    if (j.compat === 'unknown' && (j.score === null || j.score >= minScore)) {
      return pack(j, j.score === null ? 'metadate' : 'metadate+continut', 'ok');
    }
    if (j.compat === 'contradiction' || (j.score !== null && j.score < minScore)) {
      log(`ai-pdf-context: barem respins (${j.compat === 'contradiction' ? 'antetul spune altceva' : `scor conținut ${j.score.toFixed(2)}`}): „${content.title}" vs „${m.barem.title}"`);
      status = 'continut_diferit';
    } else {
      status = 'negasit'; // PDF scanat / fără text → nu ne bazăm pe el
    }
  }

  // 2) metadatele NU au decis (negăsit / ambiguu / respins) → citim candidații
  //    COMPATIBILI (fără contradicții de an/variantă/profil/sesiune; câmpurile
  //    lipsă sunt permise) și lăsăm ANTETUL lor, apoi CONȚINUTUL, să decidă.
  if (!subjectText || subjectText.length < 200) return { barem: null, text: '', status, tried: texts.size }; // test scanat/gol
  const ranked = pool
    .filter((c) => !B.tokensContradict(subject, B.tokensOf(c)))
    .map((c) => ({ c, agree: B.tokensAgreement(subject, B.tokensOf(c)) }))
    .sort((a, b) => b.agree - a.agree)
    .slice(0, maxRead)
    .map((x) => x.c);
  const judged = [];
  for (const c of ranked) {
    const j = await judge(c);
    if (j.compat !== 'fara_text') judged.push(j);
  }
  if (!judged.length) return { barem: null, text: '', status, tried: texts.size };

  const matches = judged.filter((j) => j.compat === 'match');
  if (matches.length === 1) {
    log(`ai-pdf-context: barem ales după ANTET (${matches[0].evidence}): „${content.title}" ↔ „${matches[0].c.title}"`);
    return pack(matches[0], 'antet', 'ok_antet');
  }
  // mai mulți candidați cu același antet (ex. două simulări în același an) sau
  // niciunul sigur → numerele din enunțuri; câștigă DOAR cu scor mare și cu
  // distanță clară față de următorul
  const group = matches.length > 1 ? matches : judged.filter((j) => j.compat === 'unknown');
  const win = B.pickByContentScore(group.map((j) => j.score), { accept: matches.length > 1 ? 0.35 : 0.5, margin: 0.15 });
  if (win === -1) {
    if (group.length) log(`ai-pdf-context: potrivirea pe conținut nu a decis (scoruri: ${group.map((j) => (j.score == null ? '—' : j.score.toFixed(2))).join(', ')}) pentru „${content.title}"`);
    return { barem: null, text: '', status: matches.length > 1 ? 'ambiguu' : status, tried: texts.size };
  }
  log(`ai-pdf-context: barem ales PE CONȚINUT (scor ${group[win].score.toFixed(2)}): „${content.title}" ↔ „${group[win].c.title}"`);
  return pack(group[win], matches.length > 1 ? 'antet+continut' : 'continut', 'ok_continut');
}

// ── CONTEXTUL COMPLET al unui PDF: text + barem (calculat) ───────────────────
// Răspuns: { text, chars, truncated, title, fileName, category, barem, baremText, baremStatus }
async function computePdfContext(supa, content) {
  // 1) Textul testului deschis
  let main = await contentPdfText(supa, content, MAX_CHARS);

  // 2) BAREMUL corespunzător (strict: an + variantă + profil + tip sesiune,
  //    confirmat de antetul și de conținutul PDF-urilor). Explicațiile din
  //    barem sunt sursa de adevăr — dar NUMAI baremul corect.
  let barem = null, baremText = '', baremStatus = 'negasit';
  const embedded = B.splitEmbeddedBarem(main.full);
  if (embedded) {
    // baremul e în ACELAȘI PDF (ex. simulări județene „subiecte + barem")
    main = { ...main, text: embedded.test.slice(0, MAX_CHARS), chars: embedded.test.length, truncated: embedded.test.length > MAX_CHARS };
    baremText = embedded.barem.slice(0, BAREM_MAX_CHARS);
    barem = { id: content.id, title: `${content.title || 'Test'} (baremul inclus în PDF)`, fileName: B.fileNameOf(content) || null, matchedBy: 'inclus', evidence: 'baremul se află în același fișier', contentScore: null };
    baremStatus = 'inclus';
  } else if (B.isBaremRow(content)) {
    baremStatus = 'este_barem'; // e deschis chiar baremul — nu mai căutăm altul
  } else if (content.category) {
    try {
      const { data: cands } = await supa.from('content')
        .select('*')
        .eq('content_type', 'pdf')
        .eq('category', content.category);
      const r = await chooseBarem({
        content, subjectText: main.text, candidates: cands || [],
        readText: async (c) => (await contentPdfText(supa, c, BAREM_MAX_CHARS)).text,
      });
      baremStatus = r.status;
      if (r.barem) { barem = r.barem; baremText = r.text; }
    } catch (e) {
      console.warn('ai-pdf-context barem:', e.message);
    }
  }

  return {
    text: main.text,
    chars: main.chars,
    truncated: main.truncated,
    title: content.title || null,
    fileName: B.fileNameOf(content) || null, // numele original al fișierului testului
    category: content.category || null,
    barem,
    baremText,
    baremStatus,
    pageTexts: main.pages || [], // Etapa 2: pentru localizarea paginii exercițiului
  };
}

// ── CACHE (supabase/ai_pdf_cache.sql → tabela ai_pdf_text) ───────────────────
// Până acum, la FIECARE deschidere a unui PDF (și acum și la fiecare
// corectare, care recitește testul de pe server) se descărcau și se parsau
// testul + până la 8 bareme-candidat. Rezultatul se păstrează aici, pe
// content_id, și e valabil cât timp fișierul (file_url) e același; o
// asociere „negăsit"/„ambiguu" se reîncearcă după CACHE_RETRY_HOURS (poate
// apărea baremul între timp). Lipsa tabelei nu blochează nimic (warnOnce).
const CACHE_RETRY_HOURS = parseInt(process.env.AI_PDF_CACHE_RETRY_HOURS || '24', 10);
const CACHE_OK = new Set(['ok', 'ok_antet', 'ok_continut', 'inclus', 'este_barem', 'ok_admin']);
const warned = new Set();
const warnOnce = (k, m) => { if (!warned.has(k)) { warned.add(k); console.warn(m); } };

async function readCache(supa, content) {
  try {
    const { data, error } = await supa.from('ai_pdf_text').select('*').eq('content_id', content.id).maybeSingle();
    if (error) { warnOnce('ai_pdf_text', `ai_pdf_text indisponibilă (${error.message}) — rulează supabase/ai_pdf_cache.sql; continui fără cache.`); return null; }
    if (!data || data.file_url !== content.file_url) return null; // fișier schimbat → recalcul
    if (!String(data.text || '').trim()) return null;             // rând doar cu override (fără text încă) → recalcul
    if (!CACHE_OK.has(data.barem_status)) {
      const age = Date.now() - new Date(data.updated_at || 0).getTime();
      if (age > CACHE_RETRY_HOURS * 3600 * 1000) return null; // reîncercăm asocierea
    }
    return {
      text: data.text || '', chars: data.chars || (data.text || '').length, truncated: !!data.truncated,
      title: content.title || null, fileName: B.fileNameOf(content) || null, category: content.category || null,
      barem: data.barem || null, baremText: data.barem_text || '', baremStatus: data.barem_status || 'negasit',
      pageTexts: Array.isArray(data.page_texts) ? data.page_texts : [],
      baremOverride: data.barem_override_id || null,
      cached: true,
    };
  } catch (e) { warnOnce('ai_pdf_text_e', `ai_pdf_text: ${e.message}`); return null; }
}
async function writeCache(supa, content, ctx) {
  const row = {
    content_id: content.id, file_url: content.file_url,
    text: ctx.text || '', chars: ctx.chars || 0, truncated: !!ctx.truncated,
    barem_id: ctx.barem?.id || null, barem: ctx.barem || null, barem_text: ctx.baremText || '',
    barem_status: ctx.baremStatus || 'negasit', updated_at: new Date().toISOString(),
  };
  try {
    // page_texts e coloană din Etapa 2 (supabase/ai_pdf_cache_v2.sql): fără ea, scriem restul
    let { error } = await supa.from('ai_pdf_text').upsert({ ...row, ...(Array.isArray(ctx.pageTexts) ? { page_texts: ctx.pageTexts } : {}) }, { onConflict: 'content_id' });
    if (error && /page_texts/.test(error.message || '')) {
      warnOnce('ai_pdf_text_pages', 'ai_pdf_text fără coloana page_texts — rulează supabase/ai_pdf_cache_v2.sql (paginile PDF către model nu se pot localiza din cache).');
      ({ error } = await supa.from('ai_pdf_text').upsert(row, { onConflict: 'content_id' }));
    }
    if (error) warnOnce('ai_pdf_text_w', `ai_pdf_text: scrierea în cache a eșuat (${error.message}) — rulează supabase/ai_pdf_cache.sql.`);
  } catch (e) { warnOnce('ai_pdf_text_we', `ai_pdf_text: ${e.message}`); }
}

// ── Asocierea CONFIRMATĂ DE ADMIN (Etapa 2, punctul 3.1) ─────────────────────
// ai_pdf_text.barem_override_id: baremul ales de administrator pentru un test
// (are prioritate față de potrivirea automată). null = automat.
async function readOverride(supa, contentId) {
  try {
    const { data, error } = await supa.from('ai_pdf_text').select('barem_override_id').eq('content_id', contentId).maybeSingle();
    if (error || !data) return null;
    return data.barem_override_id || null;
  } catch { return null; }
}
async function applyOverride(supa, content, ctx, overrideId) {
  if (!overrideId) return ctx;
  if (ctx.barem && ctx.barem.id === overrideId && ctx.baremStatus === 'ok_admin') return ctx;
  const { data: ov } = await supa.from('content').select('*').eq('id', overrideId).maybeSingle();
  if (!ov || !ov.file_url) { warnOnce(`ov:${overrideId}`, `ai-pdf-context: baremul asociat manual ${overrideId} nu mai există`); return ctx; }
  let text = '';
  try { text = (await contentPdfText(supa, ov, BAREM_MAX_CHARS)).text; } catch (e) { warnOnce(`ovr:${overrideId}`, `ai-pdf-context: baremul asociat manual nu a putut fi citit (${e.message})`); return ctx; }
  const next = {
    ...ctx,
    barem: { id: ov.id, title: ov.title || 'Barem', fileName: B.fileNameOf(ov) || null, matchedBy: 'admin', evidence: 'asociat manual de administrator', contentScore: null },
    baremText: text, baremStatus: 'ok_admin', baremOverride: overrideId,
  };
  await writeCache(supa, content, next); // textul baremului intră în cache (nu se re-parsează)
  return next;
}

// Admin: setează / șterge asocierea manuală (baremId=null → automat)
async function setOverride(supa, content, baremId) {
  const payload = { content_id: content.id, barem_override_id: baremId || null };
  const { data: existing } = await supa.from('ai_pdf_text').select('content_id').eq('content_id', content.id).maybeSingle();
  const { error } = existing
    ? await supa.from('ai_pdf_text').update({ barem_override_id: baremId || null, updated_at: new Date().toISOString() }).eq('content_id', content.id)
    : await supa.from('ai_pdf_text').insert({ ...payload, file_url: content.file_url, text: '', barem_status: 'negasit' });
  if (error) { const e = new Error(`Nu am putut salva asocierea (${error.message}) — rulează supabase/ai_pdf_cache_v2.sql.`); e.status = 500; throw e; }
  if (!baremId) {
    // revenim la potrivirea automată: recalcul la următoarea deschidere
    await supa.from('ai_pdf_text').update({ barem_status: 'negasit', barem_id: null, barem: null, barem_text: '', updated_at: new Date(0).toISOString() }).eq('content_id', content.id);
  }
}

// Contextul PDF al unui material, din cache sau calculat (și pus în cache).
// Folosit de handlerul de mai jos ȘI de ai-correct (care NU mai are încredere
// în textul/baremul trimise din browser, ci le recitește de aici).
async function getPdfContext(supa, content, { refresh = false } = {}) {
  let ctx = null;
  if (!refresh) ctx = await readCache(supa, content);
  if (!ctx) {
    ctx = await computePdfContext(supa, content);
    await writeCache(supa, content, ctx);
    ctx = { ...ctx, cached: false };
  }
  // asocierea confirmată de admin are prioritate față de cea automată
  const ov = ctx.baremOverride !== undefined && ctx.cached ? ctx.baremOverride : await readOverride(supa, content.id);
  if (ov) ctx = await applyOverride(supa, content, ctx, ov);
  return ctx;
}

// Materialul + verificarea accesului (gratuit / abonat / admin). Aruncă 404/403.
async function loadContentForUser(supa, contentId, profile) {
  // select('*') — tolerează deploy-uri cu/fără coloanele subcategory/profile
  const { data: content } = await supa.from('content').select('*').eq('id', contentId).single();
  if (!content || !content.file_url) { const e = new Error('Material negăsit'); e.status = 404; throw e; }
  if (!content.is_free && !ai.isPremium(profile) && !profile.is_admin) {
    const e = new Error('Acces interzis. Necesită abonament.'); e.status = 403; throw e;
  }
  return content;
}

module.exports = async function handler(req, res) {
  ai.applyCors(res);
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method Not Allowed' });

  const supa = ai.admin();
  try {
    const userId = await ai.authUser(req, supa);
    const profile = await ai.requireUser(supa, userId);

    const { contentId, refresh = false, action = null } = req.body || {};
    if (!contentId) return res.status(400).json({ error: 'contentId obligatoriu' });
    const content = await loadContentForUser(supa, contentId, profile);

    // ── acțiuni ADMIN: asocierea manuală test ↔ barem (Etapa 2, 3.1) ──
    if (action === 'candidates' || action === 'set_barem') {
      if (!profile.is_admin) return res.status(403).json({ error: 'Doar administratorii pot asocia bareme.' });
      if (action === 'candidates') {
        const { data: rows } = await supa.from('content').select('id, title, category, subcategory, file_url')
          .eq('content_type', 'pdf').eq('category', content.category).neq('id', content.id).order('title', { ascending: true }).limit(400);
        const list = (rows || []).filter((c) => c.file_url).map((c) => ({ id: c.id, title: c.title, isBarem: B.isBaremRow(c) }))
          .sort((a, b) => (b.isBarem - a.isBarem) || String(a.title).localeCompare(String(b.title), 'ro'));
        const current = await getPdfContext(supa, content).catch(() => null);
        return res.status(200).json({ candidates: list, current: current ? { barem: current.barem, baremStatus: current.baremStatus, override: current.baremOverride || null } : null });
      }
      const { baremId = null } = req.body || {};
      if (baremId) {
        const { data: b } = await supa.from('content').select('id, content_type, file_url').eq('id', baremId).maybeSingle();
        if (!b || b.content_type !== 'pdf' || !b.file_url) return res.status(400).json({ error: 'Baremul ales nu este un PDF valid.' });
      }
      await setOverride(supa, content, baremId);
      const ctx = await getPdfContext(supa, content, { refresh: !baremId });
      return res.status(200).json({ ok: true, barem: ctx.barem, baremStatus: ctx.baremStatus, override: baremId || null });
    }

    let ctx;
    try {
      ctx = await getPdfContext(supa, content, { refresh: !!refresh && !!profile.is_admin });
    } catch (e) {
      return res.status(502).json({ error: e.message });
    }
    return res.status(200).json(ctx);
  } catch (err) {
    console.error('ai-pdf-context error:', err);
    return res.status(err.status || 500).json({ error: err.message || 'Eroare server' });
  }
};

module.exports.chooseBarem = chooseBarem;
module.exports.getPdfContext = getPdfContext;
module.exports.computePdfContext = computePdfContext;
module.exports.loadContentForUser = loadContentForUser;
module.exports.contentPdfText = contentPdfText;
module.exports.downloadContentPdf = downloadContentPdf;
module.exports.setOverride = setOverride;
