// =====================================================================
// api/_lib/google.js — date REALE din Google pentru agentul SEO & Marketing.
//
// Autentificare prin CONT DE SERVICIU (service account), fără OAuth interactiv:
//   1. Creezi contul de serviciu în Google Cloud (vezi GHID_EMAIL_SI_SEO.md);
//   2. Îl adaugi ca utilizator în Search Console (și, opțional, în GA4);
//   3. Pui cheia JSON în Vercel → Environment Variables.
//
// Env:
//   GOOGLE_SERVICE_ACCOUNT_JSON  = conținutul fișierului JSON descărcat
//                                  (raw sau base64 — ambele merg)
//   GSC_SITE_URL                 = https://examenmate.com/  (proprietatea din
//                                  Search Console; sau sc-domain:examenmate.com)
//   GA4_PROPERTY_ID              = 123456789  (opțional — doar cifrele)
//
// Fără dependențe externe: JWT semnat RS256 cu modulul nativ `crypto`.
// =====================================================================
const crypto = require('crypto');

const GSC_SITE = process.env.GSC_SITE_URL || 'https://examenmate.com/';
const GA4_PROPERTY = String(process.env.GA4_PROPERTY_ID || '').replace(/\D/g, '');

// ─── Cheia contului de serviciu ──────────────────────────────────────────────
let _sa = null, _saTried = false;
function serviceAccount() {
  if (_saTried) return _sa;
  _saTried = true;
  let raw = process.env.GOOGLE_SERVICE_ACCOUNT_JSON || '';
  if (!raw) return null;
  try {
    if (!raw.trim().startsWith('{')) raw = Buffer.from(raw, 'base64').toString('utf8'); // varianta base64
    const j = JSON.parse(raw);
    if (j.client_email && j.private_key) _sa = { email: j.client_email, key: j.private_key };
  } catch (e) { console.error('google: GOOGLE_SERVICE_ACCOUNT_JSON invalid:', e.message); }
  return _sa;
}

const enabled = () => !!serviceAccount();

// ─── Access token OAuth2 (JWT bearer), cu cache până aproape de expirare ─────
const _tokens = new Map(); // scope → { token, exp }
async function accessToken(scope) {
  const sa = serviceAccount();
  if (!sa) throw new Error('Contul de serviciu Google nu e configurat.');
  const cached = _tokens.get(scope);
  if (cached && cached.exp > Date.now() + 60_000) return cached.token;

  const now = Math.floor(Date.now() / 1000);
  const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
  const unsigned = `${b64({ alg: 'RS256', typ: 'JWT' })}.${b64({
    iss: sa.email, scope, aud: 'https://oauth2.googleapis.com/token', iat: now, exp: now + 3600,
  })}`;
  const signature = crypto.createSign('RSA-SHA256').update(unsigned).sign(sa.key, 'base64url');

  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion: `${unsigned}.${signature}`,
    }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data.access_token) throw new Error(`Google OAuth: ${data.error_description || data.error || res.status}`);
  _tokens.set(scope, { token: data.access_token, exp: Date.now() + (data.expires_in || 3600) * 1000 });
  return data.access_token;
}

async function gJson(url, { scope, body = null }) {
  const token = await accessToken(scope);
  const res = await fetch(url, {
    method: body ? 'POST' : 'GET',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data?.error?.message || `Google API ${res.status}`);
  return data;
}

// ─── Search Console ──────────────────────────────────────────────────────────
const GSC_SCOPE = 'https://www.googleapis.com/auth/webmasters.readonly';
async function gscQuery(body) {
  const url = `https://www.googleapis.com/webmasters/v3/sites/${encodeURIComponent(GSC_SITE)}/searchAnalytics/query`;
  return gJson(url, { scope: GSC_SCOPE, body });
}

// ─── GA4 (Analytics Data API) ────────────────────────────────────────────────
const GA_SCOPE = 'https://www.googleapis.com/auth/analytics.readonly';
async function ga4Run(body) {
  if (!GA4_PROPERTY) throw new Error('GA4_PROPERTY_ID nu e setat.');
  const url = `https://analyticsdata.googleapis.com/v1beta/properties/${GA4_PROPERTY}:runReport`;
  return gJson(url, { scope: GA_SCOPE, body });
}

// ─── Rezumat gata de pus în promptul agentului SEO ───────────────────────────
const day = (d) => d.toISOString().slice(0, 10);
const pct = (x) => `${(Number(x || 0) * 100).toFixed(1)}%`;
const r1 = (x) => Number(x || 0).toFixed(1);

async function contextBlock() {
  if (!enabled()) return null;
  const parts = [];

  // Interval: ultimele 28 de zile (GSC are ~2 zile întârziere) + perioada anterioară
  const end = new Date(Date.now() - 2 * 86400 * 1000);
  const start = new Date(end.getTime() - 27 * 86400 * 1000);
  const prevEnd = new Date(start.getTime() - 86400 * 1000);
  const prevStart = new Date(prevEnd.getTime() - 27 * 86400 * 1000);

  // 1) Search Console
  try {
    const [tot, prev, byQuery, byPage] = await Promise.all([
      gscQuery({ startDate: day(start), endDate: day(end), rowLimit: 1 }),
      gscQuery({ startDate: day(prevStart), endDate: day(prevEnd), rowLimit: 1 }),
      gscQuery({ startDate: day(start), endDate: day(end), dimensions: ['query'], rowLimit: 100 }),
      gscQuery({ startDate: day(start), endDate: day(end), dimensions: ['page'], rowLimit: 25 }),
    ]);
    const t = (tot.rows || [])[0] || {};
    const p = (prev.rows || [])[0] || {};
    const delta = (a, b) => (b ? `${a >= b ? '+' : ''}${(((a - b) / b) * 100).toFixed(0)}%` : 'n/a');
    parts.push(
      `— TOTALURI GSC (${day(start)} → ${day(end)}, vs. perioada anterioară):\n` +
      `Clicuri: ${t.clicks || 0} (${delta(t.clicks || 0, p.clicks || 0)}) · Impresii: ${t.impressions || 0} (${delta(t.impressions || 0, p.impressions || 0)}) · CTR: ${pct(t.ctr)} · Poziție medie: ${r1(t.position)}`
    );

    const qRows = byQuery.rows || [];
    const fmtQ = (r) => `„${r.keys[0]}" — ${r.clicks} clicuri, ${r.impressions} impresii, CTR ${pct(r.ctr)}, poz. ${r1(r.position)}`;
    if (qRows.length) {
      parts.push('— TOP INTEROGĂRI (după clicuri):\n' + qRows.slice(0, 12).map((r) => '  • ' + fmtQ(r)).join('\n'));
      const opp = qRows
        .filter((r) => r.position >= 5 && r.position <= 20 && r.impressions >= 20)
        .sort((a, b) => b.impressions - a.impressions).slice(0, 10);
      if (opp.length) parts.push('— OPORTUNITĂȚI (poziții 5–20, impresii mari — aproape de top):\n' + opp.map((r) => '  • ' + fmtQ(r)).join('\n'));
    } else {
      parts.push('— GSC: niciun rând (site nou în index sau proprietate greșită în GSC_SITE_URL).');
    }

    const pRows = byPage.rows || [];
    if (pRows.length) {
      parts.push('— TOP PAGINI:\n' + pRows.slice(0, 10)
        .map((r) => `  • ${String(r.keys[0]).replace(/^https?:\/\/[^/]+/, '') || '/'} — ${r.clicks} clicuri, ${r.impressions} impresii, poz. ${r1(r.position)}`)
        .join('\n'));
    }
  } catch (e) {
    parts.push(`— Search Console indisponibil: ${e.message} (verifică GSC_SITE_URL și accesul contului de serviciu în Search Console → Setări → Utilizatori)`);
  }

  // 2) GA4 (opțional)
  if (GA4_PROPERTY) {
    try {
      const dateRanges = [{ startDate: '28daysAgo', endDate: 'today' }];
      const [totals, channels, pages] = await Promise.all([
        ga4Run({ dateRanges, metrics: [{ name: 'activeUsers' }, { name: 'sessions' }, { name: 'screenPageViews' }] }),
        ga4Run({ dateRanges, dimensions: [{ name: 'sessionDefaultChannelGroup' }], metrics: [{ name: 'sessions' }], limit: 8 }),
        ga4Run({ dateRanges, dimensions: [{ name: 'pagePath' }], metrics: [{ name: 'screenPageViews' }], orderBys: [{ metric: { metricName: 'screenPageViews' }, desc: true }], limit: 10 }),
      ]);
      const mv = (rep, i) => rep?.rows?.[0]?.metricValues?.[i]?.value || '0';
      parts.push(`— GA4 (28 zile): utilizatori activi ${mv(totals, 0)}, sesiuni ${mv(totals, 1)}, afișări de pagină ${mv(totals, 2)}`);
      if (channels?.rows?.length) {
        parts.push('— CANALE DE TRAFIC:\n' + channels.rows.map((r) => `  • ${r.dimensionValues[0].value}: ${r.metricValues[0].value} sesiuni`).join('\n'));
      }
      if (pages?.rows?.length) {
        parts.push('— PAGINI VIZITATE (GA4):\n' + pages.rows.map((r) => `  • ${r.dimensionValues[0].value} — ${r.metricValues[0].value} afișări`).join('\n'));
      }
    } catch (e) {
      parts.push(`— GA4 indisponibil: ${e.message}`);
    }
  }

  return parts.join('\n\n');
}

module.exports = { enabled, gscQuery, ga4Run, contextBlock, GSC_SITE };
