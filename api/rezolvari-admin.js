// api/rezolvari-admin.js — CRUD pentru rezolvări (doar admin)
const { admin, handledMethod, authUser, requireAdmin } = require('./_lib/http');

module.exports = async function handler(req, res) {
  if (handledMethod(req, res)) return;
  const supabase = admin();
  try {
    const userId = await authUser(req, supabase);
    await requireAdmin(supabase, userId);

    const { action, data, id } = req.body || {};

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
  } catch (err) {
    console.error('rezolvari-admin error:', err);
    return res.status(err.status || 500).json({ error: err.message || 'Eroare server' });
  }
};
