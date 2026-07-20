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
const { storagePath } = require('./_lib/pdftext');

const MAX_PAGES = parseInt(process.env.AI_PDF_MAX_PAGES || '20', 10);
const MAX_CHARS = parseInt(process.env.AI_PDF_MAX_CHARS || '9000', 10);

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

    const { data: content } = await supa.from('content')
      .select('id, title, file_url, is_free, content_type, category').eq('id', contentId).single();
    if (!content || !content.file_url) return res.status(404).json({ error: 'Material negăsit' });
    if (!content.is_free && !ai.isPremium(profile) && !profile.is_admin) {
      return res.status(403).json({ error: 'Acces interzis. Necesită abonament.' });
    }

    // Descarcă PDF-ul (public pentru materialele gratuite, semnat pentru premium)
    const url = content.is_free ? content.file_url : await ai.signedUrlFromPublic(supa, content.file_url, 300);
    let buf = null;
    try {
      const r = await fetch(url);
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      buf = Buffer.from(await r.arrayBuffer());
    } catch (e) {
      // rezervă: descărcare directă din Storage
      try {
        const { bucket, filePath } = storagePath(content.file_url);
        const { data } = await supa.storage.from(bucket).download(filePath);
        if (data) buf = Buffer.from(await data.arrayBuffer());
      } catch { /* rămâne null */ }
      if (!buf) return res.status(502).json({ error: 'Nu am putut descărca fișierul: ' + e.message });
    }

    // Extrage textul (păstrăm și baremul: profesorul îl folosește ca să verifice,
    // dar regulile din prompt îi interzic să dea rezolvarea necerută).
    let text = '';
    try {
      const pdfParse = require('pdf-parse');
      const parsed = await pdfParse(buf, { max: MAX_PAGES });
      text = String(parsed.text || '').replace(/[ \t]+/g, ' ').replace(/\n{3,}/g, '\n\n').trim();
    } catch (e) {
      console.warn('ai-pdf-context pdf-parse:', e.message);
    }

    const truncated = text.length > MAX_CHARS;
    return res.status(200).json({
      text: text.slice(0, MAX_CHARS),
      chars: text.length,
      truncated,
      title: content.title || null,
      category: content.category || null,
    });
  } catch (err) {
    console.error('ai-pdf-context error:', err);
    return res.status(err.status || 500).json({ error: err.message || 'Eroare server' });
  }
};
