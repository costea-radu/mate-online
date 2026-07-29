// =====================================================================
// api/_lib/youtube.js — YouTube Data API v3 pentru agentul SEO (Faza 4a
// din GHID_AGENT_SEO_ACTIUNI.md): OPTIMIZAREA METADATELOR clipurilor
// EXISTENTE (titlu, descriere, taguri) pe baza interogărilor din GSC.
//
// Upload-ul automat NU trece prin acest modul: clipurile urcate de
// aplicații ne-auditate rămân forțat private — până la auditul YouTube
// rămâne fluxul semi-automat (agentul scrie titlul/descrierea/capitolele,
// adminul urcă din YouTube Studio; coada manuală există din Faza 3).
//
// Autentificare: OAuth cu REFRESH TOKEN (nu cont de serviciu — YouTube
// nu acceptă conturi de serviciu pentru canale personale). Pașii de
// configurare (o singură dată, ~15 min) sunt în Faza 4a din ghid.
//
// Env (Vercel → Settings → Environment Variables):
//   YT_CLIENT_ID      — OAuth Client ID (Google Cloud, tip „Desktop app")
//   YT_CLIENT_SECRET  — OAuth Client Secret
//   YT_REFRESH_TOKEN  — refresh token cu scope youtube (vezi ghidul)
//
// Fetch simplu, fără dependențe (ca google.js / social.js).
// =====================================================================

const CLIENT_ID = process.env.YT_CLIENT_ID || '';
const CLIENT_SECRET = process.env.YT_CLIENT_SECRET || '';
const REFRESH_TOKEN = process.env.YT_REFRESH_TOKEN || '';

const API = 'https://www.googleapis.com/youtube/v3';

const enabled = () => !!(CLIENT_ID && CLIENT_SECRET && REFRESH_TOKEN);

// ─── Access token din refresh token, cu cache până aproape de expirare ───────
let _token = null; // { token, exp }
async function accessToken() {
  if (!enabled()) throw new Error('YouTube neconectat (YT_CLIENT_ID / YT_CLIENT_SECRET / YT_REFRESH_TOKEN lipsesc — vezi Faza 4a din GHID_AGENT_SEO_ACTIUNI.md).');
  if (_token && _token.exp > Date.now() + 60_000) return _token.token;

  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: CLIENT_ID,
      client_secret: CLIENT_SECRET,
      refresh_token: REFRESH_TOKEN,
      grant_type: 'refresh_token',
    }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data.access_token) {
    throw new Error(`YouTube OAuth: ${data.error_description || data.error || res.status} (refresh token expirat/revocat? refă pasul 4a din ghid)`);
  }
  _token = { token: data.access_token, exp: Date.now() + (data.expires_in || 3600) * 1000 };
  return _token.token;
}

async function ytJson(path, { method = 'GET', params = {}, body = null } = {}) {
  const token = await accessToken();
  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v != null && v !== '') qs.set(k, String(v));
  const res = await fetch(`${API}/${path.replace(/^\//, '')}?${qs}`, {
    method,
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    ...(body ? { body: JSON.stringify(body) } : {}),
    signal: AbortSignal.timeout(30_000),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const e = data?.error || {};
    const reason = e.errors?.[0]?.reason ? ` (${e.errors[0].reason})` : '';
    throw new Error(`YouTube API ${e.code || res.status}: ${e.message || 'eroare necunoscută'}${reason}`);
  }
  return data;
}

// ─── Validări pentru metadate (limitele oficiale YouTube) ────────────────────
// title ≤ 100 caractere fără < >; description ≤ 5000 BYTES (diacriticele
// românești ocupă 2); tags: max 500 de caractere ÎN TOTAL (cu tot cu
// virgulele numărate de YouTube). Pure — testate în test/youtube.test.js.
function checkVideoMeta({ title = null, description = null, tags = null } = {}) {
  const out = {};
  if (title != null) {
    const t = String(title).replace(/\s+/g, ' ').trim();
    if (t.length < 5 || t.length > 100) throw new Error(`Titlul are ${t.length} caractere — permis 5–100 (ideal ≤ 70, ca să nu fie trunchiat în listări).`);
    if (/[<>]/.test(t)) throw new Error('Titlul YouTube nu poate conține caracterele < sau >.');
    out.title = t;
  }
  if (description != null) {
    const d = String(description).replace(/\r\n?/g, '\n').trim();
    const bytes = Buffer.byteLength(d, 'utf8');
    if (bytes > 5000) throw new Error(`Descrierea are ${bytes} bytes — maximul YouTube e 5000 (diacriticele ocupă 2). Scurteaz-o.`);
    if (/[<>]/.test(d)) throw new Error('Descrierea YouTube nu poate conține caracterele < sau >.');
    out.description = d;
  }
  if (tags != null) {
    const arr = (Array.isArray(tags) ? tags : [String(tags)])
      .map((t) => String(t).replace(/\s+/g, ' ').trim())
      .filter(Boolean);
    if (arr.some((t) => t.length > 100)) throw new Error('Fiecare tag YouTube are maxim 100 de caractere.');
    // YouTube numără TOATE caracterele tagurilor + câte o virgulă între ele
    // (tagurile cu spații se numără cu tot cu ghilimele — păstrăm marjă).
    const total = arr.reduce((s, t) => s + t.length + (/\s/.test(t) ? 2 : 0), 0) + Math.max(arr.length - 1, 0);
    if (total > 480) throw new Error(`Tagurile însumează ~${total} caractere — limita YouTube e 500 în total. Păstrează 8–15 taguri relevante.`);
    out.tags = arr;
  }
  return out;
}

// Snippet-ul NOU pentru videos.update: API-ul ÎNLOCUIEȘTE tot snippet-ul,
// deci pornim de la cel actual și suprascriem doar câmpurile schimbate
// (categoryId e obligatoriu la update — îl păstrăm pe cel existent).
function applyMeta(snippet, { title = null, description = null, tags = null } = {}) {
  const s = snippet || {};
  const out = {
    title: title != null ? title : (s.title || ''),
    description: description != null ? description : (s.description || ''),
    tags: tags != null ? tags : (Array.isArray(s.tags) ? s.tags : []),
    categoryId: s.categoryId || '27', // 27 = Education (fallback dacă lipsește)
  };
  if (s.defaultLanguage) out.defaultLanguage = s.defaultLanguage;
  if (s.defaultAudioLanguage) out.defaultAudioLanguage = s.defaultAudioLanguage;
  return out;
}

const videoUrl = (id) => `https://www.youtube.com/watch?v=${id}`;

// ─── Canalul propriu + lista clipurilor ──────────────────────────────────────
async function channelInfo() {
  const r = await ytJson('channels', { params: { part: 'snippet,statistics,contentDetails', mine: 'true' } });
  const ch = (r.items || [])[0];
  if (!ch) throw new Error('Niciun canal YouTube pe contul autorizat (tokenul e pe contul corect? canalul există?).');
  return {
    id: ch.id,
    title: ch.snippet?.title || null,
    uploadsPlaylist: ch.contentDetails?.relatedPlaylists?.uploads || null,
    stats: {
      subscribers: Number(ch.statistics?.subscriberCount || 0),
      views: Number(ch.statistics?.viewCount || 0),
      videos: Number(ch.statistics?.videoCount || 0),
    },
  };
}

// Toate clipurile canalului (prin playlistul de upload-uri), cu statistici.
// `search` filtrează client-side în titlu+descriere (canal mic — suficient
// și mult mai ieftin la cotă decât search.list, care costă 100 de unități).
async function listVideos({ search = '', limit = 25 } = {}) {
  const ch = await channelInfo();
  if (!ch.uploadsPlaylist) return { channel: ch, videos: [] };

  const max = Math.min(Math.max(parseInt(limit, 10) || 25, 1), 50);
  const ids = [];
  let pageToken = null;
  for (let page = 0; page < 4 && ids.length < 200; page++) {
    const r = await ytJson('playlistItems', {
      params: { part: 'contentDetails', playlistId: ch.uploadsPlaylist, maxResults: 50, ...(pageToken ? { pageToken } : {}) },
    });
    for (const it of r.items || []) if (it.contentDetails?.videoId) ids.push(it.contentDetails.videoId);
    pageToken = r.nextPageToken;
    if (!pageToken) break;
  }
  if (!ids.length) return { channel: ch, videos: [] };

  const videos = [];
  for (let i = 0; i < ids.length; i += 50) {
    const r = await ytJson('videos', { params: { part: 'snippet,statistics,status', id: ids.slice(i, i + 50).join(',') } });
    for (const v of r.items || []) {
      videos.push({
        id: v.id,
        title: v.snippet?.title || '',
        description: v.snippet?.description || '',
        tags: v.snippet?.tags || [],
        publishedAt: v.snippet?.publishedAt || null,
        privacy: v.status?.privacyStatus || null,
        stats: {
          views: Number(v.statistics?.viewCount || 0),
          likes: Number(v.statistics?.likeCount || 0),
          comments: Number(v.statistics?.commentCount || 0),
        },
        url: videoUrl(v.id),
      });
    }
  }

  const needle = String(search || '').trim().toLowerCase();
  const filtered = needle
    ? videos.filter((v) => (v.title + ' ' + v.description).toLowerCase().includes(needle))
    : videos;
  filtered.sort((a, b) => String(b.publishedAt || '').localeCompare(String(a.publishedAt || '')));
  return { channel: ch, videos: filtered.slice(0, max), total: filtered.length };
}

// Un clip, cu snippet-ul COMPLET (necesar înainte de update).
async function getVideo(id) {
  const vid = String(id || '').trim();
  if (!/^[\w-]{5,20}$/.test(vid)) throw new Error(`ID de clip invalid: „${id}".`);
  const r = await ytJson('videos', { params: { part: 'snippet,statistics,status', id: vid } });
  const v = (r.items || [])[0];
  if (!v) throw new Error(`Clipul ${vid} nu există sau nu e pe canalul autorizat.`);
  return {
    id: v.id,
    snippet: v.snippet || {},
    privacy: v.status?.privacyStatus || null,
    stats: {
      views: Number(v.statistics?.viewCount || 0),
      likes: Number(v.statistics?.likeCount || 0),
      comments: Number(v.statistics?.commentCount || 0),
    },
    url: videoUrl(v.id),
  };
}

// Actualizează metadatele unui clip EXISTENT (videos.update înlocuiește
// snippet-ul întreg — de-asta îl citim întâi și păstrăm ce nu se schimbă).
async function updateVideo({ id, title = null, description = null, tags = null }) {
  const current = await getVideo(id);
  const checked = checkVideoMeta({ title, description, tags });
  const snippet = applyMeta(current.snippet, checked);
  await ytJson('videos', { method: 'PUT', params: { part: 'snippet' }, body: { id: current.id, snippet } });
  return { id: current.id, url: current.url, title: snippet.title };
}

module.exports = { enabled, channelInfo, listVideos, getVideo, updateVideo, checkVideoMeta, applyMeta, videoUrl };
