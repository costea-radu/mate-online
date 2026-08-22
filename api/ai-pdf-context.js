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
const { storagePath, pageRenderer } = require('./_lib/pdftext');
const B = require('./_lib/barem');

const MAX_PAGES = parseInt(process.env.AI_PDF_MAX_PAGES || '20', 10);
const MAX_CHARS = parseInt(process.env.AI_PDF_MAX_CHARS || '20000', 10);
const BAREM_MAX_CHARS = parseInt(process.env.AI_BAREM_MAX_CHARS || '12000', 10);
// câți candidați de barem citim (descărcăm) când metadatele nu decid singure
const CONTENT_CANDIDATES = parseInt(process.env.AI_BAREM_CONTENT_CANDIDATES || '8', 10);

// Descarcă un PDF din `content` și îi extrage textul (cu rezervă pe Storage).
// Răspuns: { text (tăiat la maxChars), full (tot textul), chars, truncated }
async function contentPdfText(supa, content, maxChars) {
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
  let text = '';
  try {
    const pdfParse = require('pdf-parse');
    // pageRenderer: rânduri în ordinea vizuală, cu spații corecte — altfel
    // formulele („x*y=5(x-1)(y-1)+1", fracții) ies terci și AI-ul citește greșit
    const parsed = await pdfParse(buf, { max: MAX_PAGES, pagerender: pageRenderer });
    text = String(parsed.text || '').replace(/[ \t]+/g, ' ').replace(/\n{3,}/g, '\n\n').trim();
  } catch (e) {
    console.warn('ai-pdf-context pdf-parse:', e.message);
  }
  return { text: text.slice(0, maxChars), full: text, chars: text.length, truncated: text.length > maxChars };
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

module.exports = async function handler(req, res) {
  ai.applyCors(res);
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method Not Allowed' });

  const supa = ai.admin();
  try {
    const userId = await ai.authUser(req, supa);
    const profile = await ai.requireUser(supa, userId);

    const { contentId } = req.body || {};
    if (!contentId) return res.status(400).json({ error: 'contentId obligatoriu' });

    // select('*') — tolerează deploy-uri cu/fără coloanele subcategory/profile
    const { data: content } = await supa.from('content')
      .select('*').eq('id', contentId).single();
    if (!content || !content.file_url) return res.status(404).json({ error: 'Material negăsit' });
    if (!content.is_free && !ai.isPremium(profile) && !profile.is_admin) {
      return res.status(403).json({ error: 'Acces interzis. Necesită abonament.' });
    }

    // 1) Textul testului deschis
    let main;
    try {
      main = await contentPdfText(supa, content, MAX_CHARS);
    } catch (e) {
      return res.status(502).json({ error: e.message });
    }

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

    return res.status(200).json({
      text: main.text,
      chars: main.chars,
      truncated: main.truncated,
      title: content.title || null,
      fileName: B.fileNameOf(content) || null, // numele original al fișierului testului
      category: content.category || null,
      barem,
      baremText,
      baremStatus,
    });
  } catch (err) {
    console.error('ai-pdf-context error:', err);
    return res.status(err.status || 500).json({ error: err.message || 'Eroare server' });
  }
};

module.exports.chooseBarem = chooseBarem;
