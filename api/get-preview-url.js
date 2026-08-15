// api/get-preview-url.js — PREVIEW SECURIZAT: doar PAGINA 1, doar utilizatori autentificați.
//
// De ce așa: varianta veche semna un URL către FIȘIERUL COMPLET și se baza pe
// faptul că frontend-ul randează doar pagina 1. Dar „doar pagina 1" era pur pe
// client — oricine (chiar nelogat) putea cere URL-ul și descărca PDF-ul premium
// întreg, ocolind complet abonamentul. Acum extragem pagina 1 pe SERVER și
// returnăm doar acei octeți, deci fișierul complet nu mai părăsește niciodată
// backend-ul. Abonamentul NU e necesar (neabonații văd pagina 1 ca să decidă să
// se aboneze), dar autentificarea DA — elimină harvesting-ul anonim.
const { admin, handledMethod, authUser, parseStoragePath } = require('./_lib/http');
const { PDFDocument } = require('pdf-lib');

const MAX_PREVIEW_BYTES = 40 * 1024 * 1024; // peste 40MB refuzăm extragerea

module.exports = async function handler(req, res) {
  if (handledMethod(req, res)) return;
  const supabase = admin();
  try {
    // 1) Autentificare obligatorie. authUser aruncă cu .status=401 dacă lipsește
    //    tokenul → frontend-ul afișează starea „login_required".
    let userId;
    try { userId = await authUser(req, supabase); }
    catch { return res.status(401).json({ error: 'login_required' }); }
    void userId; // legat de auth; nu mai e nevoie de el mai departe

    const { contentId } = req.body || {};
    if (!contentId) return res.status(400).json({ error: 'contentId obligatoriu' });

    const { data: content, error: dbErr } = await supabase
      .from('content').select('id, file_url, content_type').eq('id', contentId).single();
    if (dbErr || !content) return res.status(404).json({ error: 'Fișier negăsit' });

    // 2) Descarcă fișierul cu service role, direct din Storage (fără a expune
    //    vreun URL semnat către client).
    const { bucket, filePath } = parseStoragePath(content.file_url);
    const { data: blob, error: dlErr } = await supabase.storage.from(bucket).download(filePath);
    if (dlErr || !blob) return res.status(404).json({ error: 'Fișier indisponibil' });

    const srcBytes = new Uint8Array(await blob.arrayBuffer());
    if (srcBytes.byteLength > MAX_PREVIEW_BYTES) {
      return res.status(413).json({ error: 'Fișier prea mare pentru preview' });
    }

    // 3) Extrage DOAR pagina 1 într-un PDF nou și returnează-l (base64).
    let pdfBase64;
    try {
      const src = await PDFDocument.load(srcBytes, { ignoreEncryption: true });
      if (src.getPageCount() < 1) throw new Error('PDF fără pagini');
      const out = await PDFDocument.create();
      const [page] = await out.copyPages(src, [0]);
      out.addPage(page);
      const outBytes = await out.save();
      pdfBase64 = Buffer.from(outBytes).toString('base64');
    } catch (e) {
      console.error('get-preview-url: extragere pagina 1 eșuată:', e.message);
      return res.status(422).json({ error: 'Previzualizare indisponibilă pentru acest fișier' });
    }

    return res.status(200).json({ pdfBase64 });
  } catch (err) {
    console.error('get-preview-url error:', err);
    return res.status(err.status || 500).json({ error: err.message || 'Eroare server' });
  }
};
