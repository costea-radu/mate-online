// api/admin-users.js — listă utilizatori (doar admin)
const { admin, handledMethod, authUser, requireAdmin } = require('./_lib/http');

module.exports = async function handler(req, res) {
  if (handledMethod(req, res)) return;
  const supabase = admin();
  try {
    const userId = await authUser(req, supabase);
    await requireAdmin(supabase, userId);

    const { data: users, error } = await supabase
      .from('profiles')
      .select('id, full_name, email, subscription_status, is_admin, created_at')
      .order('created_at', { ascending: false });
    if (error) return res.status(500).json({ error: error.message });

    return res.status(200).json({ users: users || [] });
  } catch (err) {
    console.error('admin-users error:', err);
    return res.status(err.status || 500).json({ error: err.message || 'Eroare server' });
  }
};
