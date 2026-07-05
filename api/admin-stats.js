// api/admin-stats.js — statistici pentru panoul de administrare (doar admin)
const { admin, handledMethod, authUser, requireAdmin } = require('./_lib/http');

module.exports = async function handler(req, res) {
  if (handledMethod(req, res)) return;
  const supabase = admin();
  try {
    const userId = await authUser(req, supabase);
    await requireAdmin(supabase, userId);

    const [
      { count: total }, { count: pdf }, { count: interactive },
      { count: manual }, { count: users }, { count: premium },
    ] = await Promise.all([
      supabase.from('content').select('*', { count: 'exact', head: true }),
      supabase.from('content').select('*', { count: 'exact', head: true }).eq('content_type', 'pdf'),
      supabase.from('content').select('*', { count: 'exact', head: true }).eq('content_type', 'interactive'),
      supabase.from('content').select('*', { count: 'exact', head: true }).eq('content_type', 'manual'),
      supabase.from('profiles').select('*', { count: 'exact', head: true }),
      supabase.from('profiles').select('*', { count: 'exact', head: true }).eq('subscription_status', 'active'),
    ]);

    return res.status(200).json({
      total: total || 0, pdf: pdf || 0, interactive: interactive || 0,
      manual: manual || 0, users: users || 0, premium: premium || 0,
    });
  } catch (err) {
    console.error('admin-stats error:', err);
    return res.status(err.status || 500).json({ error: err.message || 'Eroare server' });
  }
};
