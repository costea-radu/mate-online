// api/get-file-url.js — signed URL pentru materiale premium din bibliotecă
const { admin, handledMethod, authUser, signedUrlFromPublic } = require('./_lib/http');

module.exports = async function handler(req, res) {
  if (handledMethod(req, res)) return;
  const supabase = admin();
  try {
    const { contentId } = req.body || {};
    if (!contentId) return res.status(400).json({ error: 'contentId obligatoriu' });

    const { data: content, error: contentError } = await supabase
      .from('content').select('id, file_url, is_free, content_type').eq('id', contentId).single();
    if (contentError || !content) return res.status(404).json({ error: 'Material negăsit' });

    // Fișierele gratuite — URL public direct (fără autentificare).
    if (content.is_free) return res.status(200).json({ url: content.file_url });

    // Premium — verifică abonamentul utilizatorului REAL (din token).
    const userId = await authUser(req, supabase);
    const { data: profile, error: profileError } = await supabase
      .from('profiles').select('subscription_status').eq('id', userId).single();
    if (profileError || profile?.subscription_status !== 'active') {
      return res.status(403).json({ error: 'Acces interzis. Necesită abonament Premium.' });
    }

    const url = await signedUrlFromPublic(supabase, content.file_url, 300); // 5 min
    return res.status(200).json({ url });
  } catch (err) {
    console.error('get-file-url error:', err);
    return res.status(err.status || 500).json({ error: err.message || 'Eroare server' });
  }
};
