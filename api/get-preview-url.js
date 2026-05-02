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

  const { contentId } = req.body || {};
  if (!contentId) return res.status(400).json({ error: 'contentId obligatoriu' });

  const supabase = createClient(
    process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY
  );

  // Obține fișierul
  const { data: content, error: dbErr } = await supabase
    .from('content')
    .select('id, file_url, content_type')
    .eq('id', contentId)
    .single();

  if (dbErr || !content) {
    return res.status(404).json({ error: 'Fișier negăsit', detail: dbErr?.message });
  }

  const fileUrl = content.file_url;

  // Extrage bucket și path — suportă orice format Supabase Storage URL
  // Format: https://xxx.supabase.co/storage/v1/object/public/BUCKET/path/to/file.pdf
  let bucket, filePath;
  try {
    const url = new URL(fileUrl);
    // pathname = /storage/v1/object/public/BUCKET/path/to/file.pdf
    const parts = url.pathname.split('/');
    // parts = ['', 'storage', 'v1', 'object', 'public', 'BUCKET', 'path', ...]
    const objIdx = parts.findIndex(p => p === 'object');
    if (objIdx === -1) throw new Error('Nu am găsit /object/ în URL');
    // după 'object' urmează 'public' sau 'sign', apoi bucket
    bucket = parts[objIdx + 2];
    filePath = parts.slice(objIdx + 3).join('/');
    // Elimină query params din filePath
    filePath = filePath.split('?')[0];
  } catch (e) {
    return res.status(400).json({ error: 'URL invalid', detail: e.message, fileUrl });
  }

  if (!bucket || !filePath) {
    return res.status(400).json({ error: 'Nu s-a putut extrage calea', fileUrl });
  }

  // Signed URL valabil 2 minute
  const { data, error: signErr } = await supabase.storage
    .from(bucket)
    .createSignedUrl(filePath, 120);

  if (signErr || !data?.signedUrl) {
    return res.status(500).json({
      error: 'Nu s-a putut genera URL-ul semnat',
      detail: signErr?.message,
      bucket,
      filePath,
    });
  }

  return res.status(200).json({ url: data.signedUrl });
};
