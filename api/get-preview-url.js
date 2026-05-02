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

  // Extrage bucket și path din URL (suportă /object/public/ și /object/sign/)
  const fileUrl = content.file_url;
  
  let bucket, path;
  
  // Încearcă /object/public/bucket/path
  const pubMarker = '/object/public/';
  const pubIdx = fileUrl.indexOf(pubMarker);
  if (pubIdx !== -1) {
    const after = fileUrl.slice(pubIdx + pubMarker.length);
    const slashIdx = after.indexOf('/');
    bucket = after.slice(0, slashIdx);
    path = after.slice(slashIdx + 1);
  } else {
    // Încearcă /storage/v1/object/public/bucket/path
    const parts = fileUrl.split('/storage/v1/');
    if (parts.length < 2) return res.status(400).json({ error: 'URL invalid: ' + fileUrl });
    const rest = parts[1].replace('object/public/', '').replace('object/sign/', '');
    const slashIdx = rest.indexOf('/');
    bucket = rest.slice(0, slashIdx);
    path = rest.slice(slashIdx + 1).split('?')[0]; // elimină query params
  }
  
  console.log('Preview:', { bucket, path, fileUrl });

  // Signed URL valabil 2 minute — suficient pentru preview
  const { data, error: signErr } = await supabase.storage
    .from(bucket)
    .createSignedUrl(path, 120);

  if (signErr || !data?.signedUrl) {
    return res.status(500).json({ error: 'Nu s-a putut genera URL-ul' });
  }

  return res.status(200).json({ url: data.signedUrl });
};
