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

  const { action, page, userId, sessionId, adminId } = req.body;

  if (action === 'track') {
    await supabase.from('analytics').insert({
      page: page || '/',
      user_id: userId || null,
      session_id: sessionId || null,
    });
    return res.status(200).json({ ok: true });
  }

  if (action === 'stats') {
    const { data: caller } = await supabase.from('profiles').select('is_admin').eq('id', adminId).single();
    if (!caller?.is_admin) return res.status(403).json({ error: 'Forbidden' });

    const now = new Date();
    const ranges = {
      today: new Date(now.getFullYear(), now.getMonth(), now.getDate()).toISOString(),
      week: new Date(now.getTime() - 7 * 86400000).toISOString(),
      month: new Date(now.getTime() - 30 * 86400000).toISOString(),
      year: new Date(now.getTime() - 365 * 86400000).toISOString(),
    };

    const [today, week, month, year, topPages, dailyChart] = await Promise.all([
      supabase.from('analytics').select('id', { count: 'exact', head: true }).gte('created_at', ranges.today),
      supabase.from('analytics').select('id', { count: 'exact', head: true }).gte('created_at', ranges.week),
      supabase.from('analytics').select('id', { count: 'exact', head: true }).gte('created_at', ranges.month),
      supabase.from('analytics').select('id', { count: 'exact', head: true }).gte('created_at', ranges.year),
      supabase.rpc('top_pages', { since: ranges.month }),
      supabase.rpc('daily_visits', { since: new Date(now.getTime() - 14 * 86400000).toISOString() }),
    ]);

    return res.status(200).json({
      counts: { today: today.count || 0, week: week.count || 0, month: month.count || 0, year: year.count || 0 },
      topPages: topPages.data || [],
      dailyChart: dailyChart.data || [],
    });
  }

  return res.status(400).json({ error: 'Unknown action' });
};
