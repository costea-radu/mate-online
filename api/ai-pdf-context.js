// =====================================================================
// api/ai-pdf-context.js — textul unui PDF deschis, pentru Profesorul Virtual
// Body: { userId, contentId }
// Răspuns: { text, chars, truncated }
//
// Elevul deschide un PDF (variantă de examen, fișă etc.) și îl întreabă pe
// profesor despre exercițiile din el. Aici extragem textul PDF-ului pe server
// (pdf-parse) și îl trimitem în contextul conversației.
// =====================================================================
const ai = require('./_lib/ai');
const { storagePath, pageRenderer } = require('./_lib/pdftext');
const { matchBarem, isBaremRow, contentMatchScore, fileNameOf, tokensContradict, tokensAgreement, pickByContentScore } = require('./_lib/barem');

const MAX_PAGES = parseInt(process.env.AI_PDF_MAX_PAGES || '20', 10);
const MAX_CHARS = parseInt(process.env.AI_PDF_MAX_CHARS || '20000', 10);
const BAREM_MAX_CHARS = parseInt(process.env.AI_BAREM_MAX_CHARS || '12000', 10);
// câți candidați de barem citim PE CONȚINUT când metadatele nu decid
const CONTENT_CANDIDATES = parseInt(process.env.AI_BAREM_CONTENT_CANDIDATES || '6', 10);

// Descarcă un PDF din `content` și îi extrage textul (cu rezervă pe Storage).
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
  return { text: text.slice(0, maxChars), chars: text.length, truncated: text.length > maxChars };
}

// ── REZERVĂ: alegerea baremului PE CONȚINUT, când metadatele nu decid ─────────
// Baremul unei variante repetă numerele din enunțuri. CITIM efectiv candidații
// fără contradicții de metadate (an/variantă/profil/sesiune — câmpurile LIPSĂ
// sunt permise, cele explicit DIFERITE nu) și măsurăm contentMatchScore pe
// textul fiecăruia. Câștigă un candidat DOAR cu scor ≥ 0.5 și clar peste
// următorul (+0.15) — altfel niciunul (mai bine fără barem decât cu unul greșit).
async function contentBasedBarem(supa, subject, subjectText, candidates, excludeId) {
  if (!subjectText || subjectText.length < 200) return null; // test scanat/gol — nu judecăm
  const compatible = (candidates || [])
    .filter((c) => c && c.id !== subject.id && c.id !== excludeId && c.file_url)
    .filter((c) => isBaremRow(c) && !tokensContradict(subject, c));
  if (!compatible.length) return null;
  // citim întâi candidații ale căror metadate CUNOSCUTE coincid cel mai mult
  const ranked = compatible
    .map((c) => ({ c, agree: tokensAgreement(subject, c) }))
    .sort((a, b) => b.agree - a.agree)
    .slice(0, CONTENT_CANDIDATES)
    .map((x) => x.c);
  const read = [];
  for (const c of ranked) {
    try {
      const bt = await contentPdfText(supa, c, BAREM_MAX_CHARS);
      if (!bt.text || bt.text.length <= 50) continue; // PDF scanat/fără text
      const score = contentMatchScore(subjectText, bt.text);
      if (score !== null) read.push({ c, text: bt.text, score });
    } catch { /* candidat imposibil de descărcat — mergem mai departe */ }
  }
  const win = pickByContentScore(read.map((r) => r.score));
  if (win === -1) {
    if (read.length) console.warn(`ai-pdf-context: potrivirea pe conținut nu a decis (scoruri: ${read.map((r) => r.score.toFixed(2)).join(', ')}) pentru "${subject.title}"`);
    return null;
  }
  const best = read[win];
  console.warn(`ai-pdf-context: barem ales PE CONȚINUT (scor ${best.score.toFixed(2)}): "${subject.title}" ↔ "${best.c.title}"`);
  return {
    barem: { id: best.c.id, title: best.c.title || 'Barem', fileName: fileNameOf(best.c) || null, contentScore: best.score, matchedBy: 'continut' },
    text: best.text,
  };
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

    // 2) BAREMUL corespunzător (strict: an + variantă + profil + tip sesiune).
    //    Explicațiile din barem sunt sursa de adevăr — dar NUMAI baremul corect.
    let barem = null, baremText = '', baremStatus = 'negasit';
    // potrivirea folosește titlul din site + NUMELE ORIGINAL al fișierului
    const subjectIsBarem = isBaremRow(content);
    if (subjectIsBarem) {
      baremStatus = 'este_barem'; // e deschis chiar baremul — nu mai căutăm altul
    } else if (content.category) {
      try {
        const { data: cands } = await supa.from('content')
          .select('*')
          .eq('content_type', 'pdf')
          .eq('category', content.category);

        // 2a) potrivire STRICTĂ pe metadate (titlu + numele original al fișierului)
        const m = matchBarem(content, cands || []);
        baremStatus = m.status;
        let rejectedId = null;
        if (m.barem && m.barem.file_url) {
          const bt = await contentPdfText(supa, m.barem, BAREM_MAX_CHARS);
          if (bt.text && bt.text.length > 50) {
            // VERIFICARE PE CONȚINUT (peste an/variantă/profil/sesiune):
            // numerele distinctive din test trebuie să se regăsească în barem.
            // Dacă nu se regăsesc, titlurile mint — respingem baremul.
            const score = contentMatchScore(main.text, bt.text);
            if (score !== null && score < 0.35) {
              console.warn(`ai-pdf-context: barem respins pe conținut (scor ${score.toFixed(2)}): "${content.title}" vs "${m.barem.title}"`);
              baremStatus = 'continut_diferit';
              rejectedId = m.barem.id;
            } else {
              barem = { id: m.barem.id, title: m.barem.title || 'Barem', fileName: fileNameOf(m.barem) || null, contentScore: score, matchedBy: score !== null ? 'metadate+continut' : 'metadate' };
              baremText = bt.text;
            }
          } else {
            baremStatus = 'negasit'; // PDF scanat / fără text → nu ne bazăm pe el
          }
        }

        // 2b) metadatele NU au decis (negăsit / ambiguu / conținut diferit) →
        //     CITIM CONȚINUTUL candidaților compatibili și alegem pe scor,
        //     doar cu diferență clară — potrivire sigură, nu ghicit.
        if (!barem) {
          const found = await contentBasedBarem(supa, content, main.text, cands || [], rejectedId);
          if (found) { barem = found.barem; baremText = found.text; baremStatus = 'ok_continut'; }
        }
      } catch (e) {
        console.warn('ai-pdf-context barem:', e.message);
      }
    }

    return res.status(200).json({
      text: main.text,
      chars: main.chars,
      truncated: main.truncated,
      title: content.title || null,
      fileName: fileNameOf(content) || null, // numele original al fișierului testului
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
