// api/rezolvare-url.js — signed URL pentru fișiere premium din Rezolvări
const { admin, handledMethod, authUser, signedUrlFromPublic } = require('./_lib/http');

module.exports = async function handler(req, res) {
  if (handledMethod(req, res)) return;
  const supabase = admin();
  try {
    const { rezolvareId } = req.body || {};
    if (!rezolvareId) return res.status(400).json({ error: 'rezolvareId obligatoriu' });

    const { data: rez, error } = await supabase
      .from('rezolvari').select('id, file_url, is_free').eq('id', rezolvareId).single();
    if (error || !rez) return res.status(404).json({ error: 'Negăsit' });

    // Gratuit — URL direct.
    if (rez.is_free) return res.status(200).json({ url: rez.file_url });

    // Premium — verifică abonamentul utilizatorului REAL (din token).
    const userId = await authUser(req, supabase);
    const { data: profile } = await supabase
      .from('profiles').select('subscription_status').eq('id', userId).single();
    if (profile?.subscription_status !== 'active') {
      return res.status(403).json({ error: 'Necesită Premium' });
    }

    const url = await signedUrlFromPublic(supabase, rez.file_url, 300);
    return res.status(200).json({ url });
  } catch (err) {
    console.error('rezolvare-url error:', err);
    return res.status(err.status || 500).json({ error: err.message || 'Eroare server' });
  }
};
