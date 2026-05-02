// api/rezolvare-url.js — signed URL pentru fișiere premium din Rezolvări
const { createClient } = require('@supabase/supabase-js');

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Content-Type': 'application/json',
};

module.exports = async function handler(req, res) {
  Object.entries(CORS).forEach(([k, v]) => res.setHeader(k, v));
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') return res.status(405).end();

  const { rezolvareId, userId } = req.body || {};
  if (!rezolvareId) return res.status(400).json({ error: 'rezolvareId obligatoriu' });

  const supabase = createClient(
    process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY
  );

  // Obține rezolvarea
  const { data: rez, error } = await supabase
    .from('rezolvari').select('id, file_url, is_free').eq('id', rezolvareId).single();
  if (error || !rez) return res.status(404).json({ error: 'Negăsit' });

  // Gratuit — returnează URL direct
  if (rez.is_free) return res.status(200).json({ url: rez.file_url });

  // Premium — verifică abonament
  if (!userId) return res.status(403).json({ error: 'Necesită autentificare' });
  const { data: profile } = await supabase
    .from('profiles').select('subscription_status').eq('id', userId).single();
  if (profile?.subscription_status !== 'active') {
    return res.status(403).json({ error: 'Necesită Premium' });
  }

  // Generează signed URL
  const fileUrl = rez.file_url;
  const url = new URL(fileUrl);
  const parts = url.pathname.split('/');
  const objIdx = parts.findIndex(p => p === 'object');
  const bucket = parts[objIdx + 2];
  const filePath = parts.slice(objIdx + 3).join('/').split('?')[0];

  const { data, error: signErr } = await supabase.storage
    .from(bucket).createSignedUrl(filePath, 300);
  if (signErr || !data?.signedUrl) return res.status(500).json({ error: 'Eroare signed URL' });

  return res.status(200).json({ url: data.signedUrl });
};
