// api/get-preview-url.js
// Returnează signed URL pentru preview (prima pagină) — fără verificare premium
// Oricine poate accesa preview-ul, dar URL-ul expiră în 2 minute

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
  const { data: content, error } = await supabase
    .from('content')
    .select('id, file_url, content_type')
    .eq('id', contentId)
    .single();

  if (error || !content || content.content_type !== 'pdf') {
    return res.status(404).json({ error: 'Fișier negăsit' });
  }

  // Extrage bucket și path din URL
  const fileUrl = content.file_url;
  const marker = '/object/public/';
  const idx = fileUrl.indexOf(marker);
  if (idx === -1) return res.status(400).json({ error: 'URL invalid' });

  const after = fileUrl.slice(idx + marker.length);
  const slashIdx = after.indexOf('/');
  const bucket = after.slice(0, slashIdx);
  const path = after.slice(slashIdx + 1);

  // Signed URL valabil 2 minute — suficient pentru preview
  const { data, error: signErr } = await supabase.storage
    .from(bucket)
    .createSignedUrl(path, 120);

  if (signErr || !data?.signedUrl) {
    return res.status(500).json({ error: 'Nu s-a putut genera URL-ul' });
  }

  return res.status(200).json({ url: data.signedUrl });
};
