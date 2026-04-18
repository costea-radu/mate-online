const { createClient } = require('@supabase/supabase-js');

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Content-Type': 'application/json',
};

module.exports = async function handler(req, res) {
  Object.entries(CORS_HEADERS).forEach(([key, val]) => res.setHeader(key, val));
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method Not Allowed' });

  const { userId, contentId } = req.body;
  if (!userId || !contentId) {
    return res.status(400).json({ error: 'userId și contentId sunt obligatorii' });
  }

  const supabase = createClient(
    process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY
  );

  // 1. Verifică că materialul există
  const { data: content, error: contentError } = await supabase
    .from('content')
    .select('id, file_url, is_free, content_type')
    .eq('id', contentId)
    .single();

  if (contentError || !content) {
    return res.status(404).json({ error: 'Material negăsit' });
  }

  // 2. Fișierele gratuite — returnăm URL-ul public direct
  if (content.is_free) {
    return res.status(200).json({ url: content.file_url });
  }

  // 3. Fișierele premium — verificăm că userul e abonat activ
  const { data: profile, error: profileError } = await supabase
    .from('profiles')
    .select('subscription_status')
    .eq('id', userId)
    .single();

  if (profileError || profile?.subscription_status !== 'active') {
    return res.status(403).json({ error: 'Acces interzis. Necesită abonament Premium.' });
  }

  // 4. Extragem calea din URL
  const fileUrl = content.file_url;
  const marker = '/object/public/';
  const idx = fileUrl.indexOf(marker);
  if (idx === -1) return res.status(500).json({ error: 'URL invalid în baza de date' });

  const after = fileUrl.slice(idx + marker.length);
  const slashIdx = after.indexOf('/');
  if (slashIdx === -1) return res.status(500).json({ error: 'Path invalid' });

  const bucket = after.slice(0, slashIdx);
  const path = after.slice(slashIdx + 1);

  // 5. Generăm signed URL valabil 5 minute
  const { data, error: signError } = await supabase.storage
    .from(bucket)
    .createSignedUrl(path, 300); // 300 secunde = 5 minute

  if (signError || !data?.signedUrl) {
    console.error('Signed URL error:', signError);
    return res.status(500).json({ error: 'Nu s-a putut genera linkul' });
  }

  return res.status(200).json({ url: data.signedUrl });
};
