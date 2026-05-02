// api/rezolvari-admin.js — CRUD pentru rezolvări (doar admin)
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

  const supabase = createClient(
    process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY
  );

  const { action, adminId, data, id } = req.body || {};

  // Verifică admin
  const { data: caller } = await supabase.from('profiles')
    .select('is_admin').eq('id', adminId).single();
  if (!caller?.is_admin) return res.status(403).json({ error: 'Forbidden' });

  if (action === 'create') {
    const { data: row, error } = await supabase.from('rezolvari').insert(data).select().single();
    if (error) return res.status(500).json({ error: error.message });
    return res.status(200).json({ row });
  }

  if (action === 'delete') {
    const { error } = await supabase.from('rezolvari').delete().eq('id', id);
    if (error) return res.status(500).json({ error: error.message });
    return res.status(200).json({ ok: true });
  }

  if (action === 'list') {
    const { data: rows, error } = await supabase.from('rezolvari')
      .select('*').order('sort_order', { ascending: true }).order('created_at', { ascending: false });
    if (error) return res.status(500).json({ error: error.message });
    return res.status(200).json({ rows });
  }

  return res.status(400).json({ error: 'Acțiune necunoscută' });
};
