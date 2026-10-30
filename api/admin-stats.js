// api/admin-stats.js — statistici pentru panoul de administrare (doar admin)
//
// POST {}                          → numărătorile din Dashboard (materiale, utilizatori)
// POST { action: 'site', zile }    → „📊 Statistici de utilizare" (Admin → 🤖 AI Tutor):
//   paginile cele mai vizitate, materialele cele mai deschise, testele cele mai
//   folosite, utilizatorii care revin cel mai des / cu cele mai multe accesări,
//   funcțiile AI, conturile noi, dispozitivele, orele, sursele, retenția, Arena —
//   toate dintr-un singur apel SQL (supabase/statistici_vizite.sql →
//   admin_statistici). zile = 7 | 30 | 90 (implicit 30).
const { admin, handledMethod, authUser, requireAdmin } = require('./_lib/http');

const PERIOADE = [7, 30, 90];

async function statisticiSite(supabase, zile) {
  const z = PERIOADE.includes(Number(zile)) ? Number(zile) : 30;
  const { data, error } = await supabase.rpc('admin_statistici', { p_zile: z });
  if (error) {
    // funcția lipsește → migrarea nu e rulată: panoul spune ce e de făcut
    const lipsa = /admin_statistici|does not exist|schema cache|function/i.test(error.message || '');
    return { ok: false, setup: !lipsa, zile: z, mesaj: error.message };
  }
  return { ok: true, setup: true, zile: z, ...(data || {}) };
}

module.exports = async function handler(req, res) {
  if (handledMethod(req, res)) return;
  const supabase = admin();
  try {
    const userId = await authUser(req, supabase);
    await requireAdmin(supabase, userId);

    if (req.body && req.body.action === 'site') {
      return res.status(200).json(await statisticiSite(supabase, req.body.zile));
    }

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

module.exports.statisticiSite = statisticiSite;
