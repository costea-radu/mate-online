// api/admin-stats.js — statistici pentru panoul de administrare (doar admin)
//
// POST {}                          → numărătorile din Dashboard (materiale, utilizatori)
// POST { action: 'site', zile }    → „📊 Statistici de utilizare" (Admin → 🤖 Unelte AI):
//   paginile cele mai vizitate, materialele cele mai deschise, testele cele mai
//   folosite, utilizatorii care revin cel mai des / cu cele mai multe accesări,
//   funcțiile AI, conturile noi, dispozitivele, orele, sursele, retenția, Arena —
//   toate dintr-un singur apel SQL (supabase/statistici_vizite.sql →
//   admin_statistici). zile = 7 | 30 | 90 (implicit 30).
// POST { action: 'vizitatori', zile, ordine, tip, pagina } → TOȚI cei care au intrat pe
//   site în perioadă, câte 25 pe pagină (18 nov. 2026 — „pune-i pe toți care au accesat
//   în ultimele x zile, pe pagini"): tip 'cont' | 'anonimi' | 'toti', ordine 'zile'
//   (revin cel mai des) | 'accesari' (pagini văzute); pagina de la 1. Funcția SQL
//   admin_vizitatori (supabase/statistici_vizitatori.sql); lipsește → { ok: false,
//   setup: false } și panoul rămâne la primii 25 din 'site'.
const { admin, handledMethod, authUser, requireAdmin } = require('./_lib/http');

const PERIOADE = [7, 30, 90];
const PE_PAGINA = 25;
const TIPURI = ['cont', 'anonimi', 'toti'];

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

// O pagină din lista tuturor vizitatorilor perioadei
async function vizitatori(supabase, { zile, ordine, tip, pagina } = {}) {
  const z = PERIOADE.includes(Number(zile)) ? Number(zile) : 30;
  const t = TIPURI.includes(tip) ? tip : 'cont';
  const o = ordine === 'accesari' ? 'accesari' : 'zile';
  const p = Math.max(1, Math.min(10000, Math.floor(Number(pagina)) || 1));
  const { data, error } = await supabase.rpc('admin_vizitatori', {
    p_zile: z, p_ordine: o, p_tip: t, p_limita: PE_PAGINA, p_de_la: (p - 1) * PE_PAGINA,
  });
  if (error) {
    const lipsa = /admin_vizitatori|does not exist|schema cache|function/i.test(error.message || '');
    return { ok: false, setup: !lipsa, zile: z, tip: t, ordine: o, pagina: p, mesaj: error.message };
  }
  const d = data || {};
  const total = Number(d.total) || 0;
  return {
    ok: true, setup: true, zile: z, tip: t, ordine: o,
    pagina: p, peFiecarePagina: PE_PAGINA, total, pagini: Math.max(1, Math.ceil(total / PE_PAGINA)),
    randuri: Array.isArray(d.randuri) ? d.randuri : [],
  };
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
    if (req.body && req.body.action === 'vizitatori') {
      return res.status(200).json(await vizitatori(supabase, req.body));
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
module.exports.vizitatori = vizitatori;
module.exports.PE_PAGINA = PE_PAGINA;
