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

  const { userId } = req.body;
  if (!userId) return res.status(400).json({ error: 'userId obligatoriu' });

  // Folosim service role key — ocoleste RLS
  const supabase = createClient(
    process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY
  );

  // Verificam ca userul e admin
  const { data: profile, error: profileError } = await supabase
    .from('profiles')
    .select('is_admin')
    .eq('id', userId)
    .single();

  if (profileError || !profile?.is_admin) {
    return res.status(403).json({ error: 'Acces interzis' });
  }

  const [
    { count: total },
    { count: pdf },
    { count: interactive },
    { count: manual },
    { count: users },
    { count: premium },
  ] = await Promise.all([
    supabase.from('content').select('*', { count: 'exact', head: true }),
    supabase.from('content').select('*', { count: 'exact', head: true }).eq('content_type', 'pdf'),
    supabase.from('content').select('*', { count: 'exact', head: true }).eq('content_type', 'interactive'),
    supabase.from('content').select('*', { count: 'exact', head: true }).eq('content_type', 'manual'),
    supabase.from('profiles').select('*', { count: 'exact', head: true }),
    supabase.from('profiles').select('*', { count: 'exact', head: true }).eq('subscription_status', 'active'),
  ]);

  return res.status(200).json({
    total: total || 0,
    pdf: pdf || 0,
    interactive: interactive || 0,
    manual: manual || 0,
    users: users || 0,
    premium: premium || 0,
  });
};
