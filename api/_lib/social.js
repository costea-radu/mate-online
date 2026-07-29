// =====================================================================
// api/_lib/social.js — SOCIAL MEDIA pentru agentul SEO (Faza 3 din
// GHID_AGENT_SEO_ACTIUNI.md): publicare pe Facebook Page + Instagram
// prin Meta Graph API, UTM automat pe linkuri, semnarea parametrilor
// pentru generatorul de carduri (api/social-image.js) și citirea
// metricilor înapoi în `social_posts.metrics`.
//
// Fetch simplu, fără dependențe (ca google.js). Env (Vercel → Settings):
//   META_PAGE_ID        — id-ul paginii de Facebook
//   META_PAGE_TOKEN     — Page Access Token long-lived (vezi Faza 3a din ghid)
//   META_IG_USER_ID     — id-ul contului Instagram Business (opțional; fără el
//                         doar Facebook se publică automat)
//   META_GRAPH_VERSION  — opțional, implicit v23.0
//
// Cine cheamă publishPost(): api/social-cron.js (la 15 min, postările
// `approved` scadente) și api/social-queue.js („Publică acum" din admin).
// TikTok/YouTube NU se publică de aici (fără audit API nu se poate) — ele
// intră cu status `manual` în coada din admin (copy-paste, 5 min/zi).
// =====================================================================
const crypto = require('crypto');

const PAGE_ID = process.env.META_PAGE_ID || '';
const PAGE_TOKEN = process.env.META_PAGE_TOKEN || '';
const IG_USER_ID = process.env.META_IG_USER_ID || '';
const GRAPH_V = process.env.META_GRAPH_VERSION || 'v23.0';
const GRAPH = `https://graph.facebook.com/${GRAPH_V}`;

const SITE = (process.env.SITE_ORIGIN && process.env.SITE_ORIGIN !== '*')
  ? process.env.SITE_ORIGIN.replace(/\/$/, '')
  : 'https://examenmate.com';

const PLATFORMS = ['facebook', 'instagram', 'tiktok', 'youtube'];
const AUTO_PLATFORMS = ['facebook', 'instagram']; // restul → coada manuală

const enabled = () => !!(PAGE_ID && PAGE_TOKEN);
const igEnabled = () => enabled() && !!IG_USER_ID;

// ─── Apelul brut către Graph API ─────────────────────────────────────────────
async function graph(path, { method = 'GET', params = {}, timeoutMs = 30_000 } = {}) {
  if (!enabled()) throw new Error('Meta neconfigurat (META_PAGE_ID + META_PAGE_TOKEN lipsesc — vezi Faza 3a din GHID_AGENT_SEO_ACTIUNI.md).');
  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v != null && v !== '') qs.set(k, String(v));
  qs.set('access_token', PAGE_TOKEN);

  const url = `${GRAPH}/${path.replace(/^\//, '')}`;
  const opts = { method, signal: AbortSignal.timeout(timeoutMs) };
  let full = url;
  if (method === 'POST') {
    opts.headers = { 'Content-Type': 'application/x-www-form-urlencoded' };
    opts.body = qs.toString();
  } else {
    full = `${url}?${qs}`;
  }
  const res = await fetch(full, opts);
  const data = await res.json().catch(() => ({}));
  if (!res.ok || data.error) {
    const e = data.error || {};
    throw new Error(`Graph API ${e.code || res.status}: ${e.message || 'eroare necunoscută'}${e.error_user_msg ? ` — ${e.error_user_msg}` : ''}`);
  }
  return data;
}

// ─── UTM automat pe linkurile proprii ────────────────────────────────────────
// Doar linkurile către site (sau rutele relative) primesc UTM — nu poluăm
// URL-urile altora. utm_source=platforma, utm_medium=social, utm_campaign=slug.
function addUtm(link, { source, campaign = 'social' } = {}) {
  let raw = String(link || '').trim();
  if (!raw) return null;
  if (raw.startsWith('/')) raw = SITE + raw; // rută relativă → URL absolut
  let url;
  try { url = new URL(raw); } catch { return raw; }
  const own = new URL(SITE);
  if (url.hostname !== own.hostname) return url.toString(); // link extern — neatins
  url.searchParams.set('utm_source', String(source || 'social'));
  url.searchParams.set('utm_medium', 'social');
  url.searchParams.set('utm_campaign', String(campaign || 'social'));
  return url.toString();
}

// Slug pentru utm_campaign: explicit > ultimul segment din link > implicit.
function campaignSlug(explicit, link) {
  const clean = (s) => String(s || '').toLowerCase().trim()
    .replace(/[ăâ]/g, 'a').replace(/î/g, 'i').replace(/[șş]/g, 's').replace(/[țţ]/g, 't')
    .replace(/[^a-z0-9-]+/g, '-').replace(/-{2,}/g, '-').replace(/^-|-$/g, '')
    .slice(0, 60);
  const fromExplicit = clean(explicit);
  if (fromExplicit.length >= 2) return fromExplicit;
  try {
    const path = new URL(String(link).startsWith('/') ? SITE + link : String(link)).pathname;
    const seg = clean(path.split('/').filter(Boolean).pop());
    if (seg.length >= 2) return seg;
  } catch { /* fără link valid */ }
  return 'social';
}

const isVideoUrl = (u) => /\.(mp4|mov|m4v)(\?|#|$)/i.test(String(u || ''));

// Caption-ul final: textul + linkul (cu UTM) pe rând separat. Pe Instagram
// linkul nu e clicabil în caption, dar rămâne vizibil (și copiabil).
function buildCaption({ text, utmLink }) {
  const t = String(text || '').trim();
  return utmLink ? `${t}\n\n${utmLink}` : t;
}

// ─── Publicarea unui rând din social_posts ───────────────────────────────────
// Întoarce { external_id, kind } sau aruncă eroare (cron-ul o scrie în `error`).
async function publishPost(row) {
  const platform = row.platform;
  const caption = buildCaption({ text: row.text_content, utmLink: row.link_url });

  if (platform === 'facebook') {
    if (row.media_url && isVideoUrl(row.media_url)) {
      const r = await graph(`${PAGE_ID}/videos`, { method: 'POST', params: { file_url: row.media_url, description: caption }, timeoutMs: 120_000 });
      return { external_id: r.id, kind: 'fb_video' };
    }
    if (row.media_url) {
      const r = await graph(`${PAGE_ID}/photos`, { method: 'POST', params: { url: row.media_url, caption } });
      return { external_id: r.post_id || r.id, kind: 'fb_photo' };
    }
    const params = { message: String(row.text_content || '').trim() };
    if (row.link_url) params.link = row.link_url; // preview card din link
    const r = await graph(`${PAGE_ID}/feed`, { method: 'POST', params });
    return { external_id: r.id, kind: 'fb_feed' };
  }

  if (platform === 'instagram') {
    if (!igEnabled()) throw new Error('Instagram neconfigurat (META_IG_USER_ID lipsește — vezi Faza 3a din ghid).');
    if (!row.media_url) throw new Error('Instagram cere imagine sau video (media_url) — nu există postare doar-text.');
    const video = isVideoUrl(row.media_url);
    const container = await graph(`${IG_USER_ID}/media`, {
      method: 'POST',
      params: video
        ? { media_type: 'REELS', video_url: row.media_url, caption }
        : { image_url: row.media_url, caption },
      timeoutMs: 60_000,
    });
    // containerul se procesează asincron (video: zeci de secunde) — așteptăm FINISHED
    const waitMs = video ? 8000 : 1500;
    const maxTries = video ? 20 : 6;
    for (let i = 0; i < maxTries; i++) {
      const st = await graph(`${container.id}`, { params: { fields: 'status_code' } });
      if (st.status_code === 'FINISHED') break;
      if (st.status_code === 'ERROR') throw new Error('Instagram a respins media (status ERROR) — verifică formatul (JPEG pentru imagini, MP4 pentru Reels) și URL-ul public.');
      if (i === maxTries - 1) throw new Error(`Instagram încă procesează media (status ${st.status_code}) — reîncearcă în câteva minute (Reîncearcă din panoul Social).`);
      await new Promise((r) => setTimeout(r, waitMs));
    }
    const pub = await graph(`${IG_USER_ID}/media_publish`, { method: 'POST', params: { creation_id: container.id }, timeoutMs: 60_000 });
    return { external_id: pub.id, kind: video ? 'ig_reel' : 'ig_image' };
  }

  throw new Error(`Platforma „${platform}" nu se publică automat — postările TikTok/YouTube stau în coada manuală din admin.`);
}

// Șterge o postare de pe Facebook (revert). Instagram NU permite ștergerea prin API.
async function deleteFbPost(externalId) {
  await graph(String(externalId), { method: 'DELETE' });
  return { deleted: externalId };
}

// ─── Metrici (best effort — unele cer permisiuni în plus) ────────────────────
// FB: like/comments/shares vin cu pages_read_engagement; reach cere read_insights.
// IG: like_count/comments_count vin cu instagram_basic; reach cere
// instagram_manage_insights. Ce nu se poate citi se sare fără să eșueze totul.
async function fetchInsights(row) {
  const out = { fetched_at: new Date().toISOString() };
  if (row.platform === 'facebook') {
    try {
      const d = await graph(String(row.external_id), {
        params: { fields: 'permalink_url,likes.summary(true).limit(0),comments.summary(true).limit(0),shares' },
      });
      out.permalink = d.permalink_url || null;
      out.likes = d.likes?.summary?.total_count ?? null;
      out.comments = d.comments?.summary?.total_count ?? null;
      out.shares = d.shares?.count ?? 0;
    } catch (e) { out.base_error = e.message; }
    try {
      const ins = await graph(`${row.external_id}/insights`, { params: { metric: 'post_impressions_unique' } });
      out.reach = ins.data?.[0]?.values?.[0]?.value ?? null;
    } catch { /* read_insights lipsește — nu blocăm restul */ }
  } else if (row.platform === 'instagram') {
    try {
      const d = await graph(String(row.external_id), { params: { fields: 'permalink,like_count,comments_count' } });
      out.permalink = d.permalink || null;
      out.likes = d.like_count ?? null;
      out.comments = d.comments_count ?? null;
    } catch (e) { out.base_error = e.message; }
    try {
      const ins = await graph(`${row.external_id}/insights`, { params: { metric: 'reach,saved' } });
      for (const m of ins.data || []) out[m.name] = m.values?.[0]?.value ?? null;
    } catch { /* instagram_manage_insights lipsește — ok */ }
  }
  return out;
}

// ─── Cardurile branded (api/social-image.js) — parametri SEMNAȚI ─────────────
// Endpointul de imagini e public (Meta descarcă imaginea de la URL), deci
// parametrii sunt semnați HMAC ca nimeni să nu genereze carduri cu alt text.
const IMAGE_TEMPLATES = ['formula', 'exercitiu', 'greseala', 'countdown', 'anunt'];

function imageSecret() {
  return process.env.AI_SIGNING_SECRET || process.env.SUPABASE_SERVICE_ROLE_KEY || '';
}

function signImage({ template, title = '', subtitle = '', badge = '' }) {
  const secret = imageSecret();
  if (!secret) return '';
  return crypto.createHmac('sha256', secret)
    .update([template, title, subtitle, badge].map((s) => String(s || '')).join(' '))
    .digest('hex')
    .slice(0, 24);
}

function verifyImageSig({ template, title = '', subtitle = '', badge = '', sig = '' }) {
  const secret = imageSecret();
  if (!secret) return true; // dev local fără chei — nesemnat
  const want = signImage({ template, title, subtitle, badge });
  const a = Buffer.from(String(sig || ''));
  const b = Buffer.from(want);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

// URL-ul complet al unui card generat — devine media_url pentru FB/IG.
function imageUrl({ template, title = '', subtitle = '', badge = '' }) {
  if (!IMAGE_TEMPLATES.includes(template)) throw new Error(`Șablon de imagine necunoscut: „${template}". Permise: ${IMAGE_TEMPLATES.join(', ')}.`);
  const qs = new URLSearchParams({ template, title: String(title), subtitle: String(subtitle), badge: String(badge) });
  const sig = signImage({ template, title, subtitle, badge });
  if (sig) qs.set('sig', sig);
  return `${SITE}/api/social-image?${qs}`;
}

module.exports = {
  SITE, PLATFORMS, AUTO_PLATFORMS, IMAGE_TEMPLATES,
  enabled, igEnabled, graph,
  addUtm, campaignSlug, isVideoUrl, buildCaption,
  publishPost, deleteFbPost, fetchInsights,
  signImage, verifyImageSig, imageUrl,
};
