// api/get-preview-url.js — signed URL scurt pentru PREVIEW (public, orice material)
const { admin, handledMethod, signedUrlFromPublic } = require('./_lib/http');

module.exports = async function handler(req, res) {
  if (handledMethod(req, res)) return;
  const supabase = admin();
  try {
    const { contentId } = req.body || {};
    if (!contentId) return res.status(400).json({ error: 'contentId obligatoriu' });

    const { data: content, error: dbErr } = await supabase
      .from('content').select('id, file_url, content_type').eq('id', contentId).single();
    if (dbErr || !content) return res.status(404).json({ error: 'Fișier negăsit', detail: dbErr?.message });

    const url = await signedUrlFromPublic(supabase, content.file_url, 120); // 2 min
    return res.status(200).json({ url });
  } catch (err) {
    console.error('get-preview-url error:', err);
    return res.status(err.status || 500).json({ error: err.message || 'Eroare server' });
  }
};
