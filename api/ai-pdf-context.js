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
const { matchBarem, isBaremTitle, contentMatchScore } = require('./_lib/barem');

const MAX_PAGES = parseInt(process.env.AI_PDF_MAX_PAGES || '20', 10);
const MAX_CHARS = parseInt(process.env.AI_PDF_MAX_CHARS || '20000', 10);
const BAREM_MAX_CHARS = parseInt(process.env.AI_BAREM_MAX_CHARS || '12000', 10);

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
    const subjectIsBarem = content.subcategory === 'bareme' || isBaremTitle(content.title);
    if (subjectIsBarem) {
      baremStatus = 'este_barem'; // e deschis chiar baremul — nu mai căutăm altul
    } else if (content.category) {
      try {
        const { data: cands } = await supa.from('content')
          .select('*')
          .eq('content_type', 'pdf')
          .eq('category', content.category);
        const m = matchBarem(content, cands || []);
        baremStatus = m.status;
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
            } else {
              barem = { id: m.barem.id, title: m.barem.title || 'Barem', contentScore: score };
              baremText = bt.text;
            }
          } else {
            baremStatus = 'negasit'; // PDF scanat / fără text → nu ne bazăm pe el
          }
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
