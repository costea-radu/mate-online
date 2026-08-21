// =====================================================================
// api/sitemap.js — sitemap.xml GENERAT DIN BAZA DE DATE, mereu actual.
// (Faza 1c din GHID_AGENT_SEO_ACTIUNI.md; servit ca /sitemap.xml prin rewrite)
//
// Conține: rutele statice publice + paginile pe clasă care AU materiale în DB
// + articolele publicate din tabelul `articole` (apare în Faza 2 — până atunci
// blocul e sărit fără eroare). Trimiterea către Google se face prin
// Search Console API (sitemaps.submit) — unealta submit_sitemap a agentului.
// =====================================================================
const http = require('./_lib/http');

const SITE = (process.env.SITE_ORIGIN && process.env.SITE_ORIGIN !== '*')
  ? process.env.SITE_ORIGIN.replace(/\/$/, '')
  : 'https://examenmate.com';

// [rută, changefreq, priority]
const STATIC_ROUTES = [
  ['/', 'daily', '1.0'],
  ['/evaluare-nationala', 'weekly', '0.9'],
  ['/bacalaureat', 'weekly', '0.9'],
  ['/rezolvari', 'daily', '0.9'],
  ['/manuale', 'weekly', '0.7'],
  ['/discutii', 'daily', '0.6'],
  ['/profesor-virtual', 'weekly', '0.8'],
  ['/meditatii', 'weekly', '0.9'],
  ['/tema', 'weekly', '0.7'],
  ['/biblioteca-utilizatorilor', 'weekly', '0.6'],
  ['/recenzii', 'weekly', '0.6'],
  ['/preturi', 'monthly', '0.8'],
  ['/faq', 'monthly', '0.6'],
  ['/despre-noi', 'monthly', '0.5'],
  ['/contact', 'monthly', '0.5'],
  ['/politica-confidentialitate', 'yearly', '0.2'],
  ['/termeni-conditii', 'yearly', '0.2'],
  ['/politica-cookies', 'yearly', '0.2'],
  ['/politica-retur', 'yearly', '0.2'],
];

const escXml = (s) => String(s)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;').replace(/'/g, '&apos;');

module.exports = async function handler(req, res) {
  if (req.method !== 'GET' && req.method !== 'HEAD') return res.status(405).send('Method Not Allowed');
  const urls = []; // { loc, lastmod?, changefreq, priority }

  for (const [route, changefreq, priority] of STATIC_ROUTES) {
    urls.push({ loc: SITE + route, changefreq, priority });
  }

  const supa = http.admin();

  // Paginile pe clasă — doar clasele care au efectiv materiale.
  // (paginat: PostgREST întoarce max 1000 de rânduri per cerere)
  try {
    const rows = [];
    for (let p = 0; p < 12; p++) {
      const { data, error } = await supa.from('content').select('category').range(p * 1000, p * 1000 + 999);
      if (error) throw new Error(error.message);
      rows.push(...(data || []));
      if (!data || data.length < 1000) break;
    }
    const grades = new Set();
    rows.forEach((r) => {
      const m = /^clasa-(\d+)$/.exec(r.category || '');
      if (m) grades.add(Number(m[1]));
    });
    [...grades].sort((a, b) => a - b).forEach((n) => {
      urls.push({ loc: `${SITE}/clase/${n}`, changefreq: 'weekly', priority: '0.8' });
    });
  } catch (e) { console.warn('sitemap: content indisponibil:', e.message); }

  // Articolele publicate (tabelul `articole` apare în Faza 2).
  try {
    const { data } = await supa
      .from('articole')
      .select('slug, published_at, updated_at')
      .eq('status', 'published')
      .order('published_at', { ascending: false })
      .limit(2000);
    (data || []).forEach((a) => {
      if (!/^[a-z0-9-]{1,120}$/.test(a.slug || '')) return;
      const last = a.updated_at || a.published_at;
      urls.push({
        loc: `${SITE}/rezolvari/${a.slug}`,
        lastmod: last ? String(last).slice(0, 10) : null,
        changefreq: 'monthly',
        priority: '0.7',
      });
    });
  } catch { /* normal înainte de Faza 2 */ }

  const body = urls.map((u) => [
    '  <url>',
    `    <loc>${escXml(u.loc)}</loc>`,
    u.lastmod ? `    <lastmod>${u.lastmod}</lastmod>` : null,
    `    <changefreq>${u.changefreq}</changefreq>`,
    `    <priority>${u.priority}</priority>`,
    '  </url>',
  ].filter(Boolean).join('\n')).join('\n');

  const xml = `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${body}\n</urlset>\n`;

  res.setHeader('Content-Type', 'application/xml; charset=utf-8');
  res.setHeader('Cache-Control', 'public, max-age=0, must-revalidate');
  res.setHeader('Vercel-CDN-Cache-Control', 'public, s-maxage=3600, stale-while-revalidate=86400');
  return res.status(200).send(xml);
};
