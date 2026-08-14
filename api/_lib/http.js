// =====================================================================
// api/_lib/http.js — utilitare HTTP partajate de TOATE rutele serverless
// (CORS, guard de metodă, autentificare reală pe token, verificare admin,
//  signed URL din URL public). Elimină boilerplate-ul duplicat și, mai
//  important, centralizează AUTENTIFICAREA într-un singur loc.
// =====================================================================
const { createClient } = require('@supabase/supabase-js');
const crypto = require('node:crypto');

// Originea permisă: setează SITE_ORIGIN în Vercel (ex: https://examenmate.com).
// Fallback '*' doar dacă nu e setată (retrocompatibil în dev).
const ALLOW_ORIGIN = process.env.SITE_ORIGIN || '*';

const CORS = {
  'Access-Control-Allow-Origin': ALLOW_ORIGIN,
  // ATENȚIE: 'Authorization' e obligatoriu — altfel preflight-ul blochează tokenul.
  'Access-Control-Allow-Headers': 'Content-Type, Authorization, x-cron-secret',
  'Access-Control-Allow-Methods': 'POST, GET, OPTIONS',
  'Content-Type': 'application/json',
};

function applyCors(res) {
  Object.entries(CORS).forEach(([k, v]) => res.setHeader(k, v));
  if (ALLOW_ORIGIN !== '*') res.setHeader('Vary', 'Origin');
}

// Tratează preflight/metodă. Întoarce true dacă cererea a fost deja terminată.
// allowGet=true pentru rutele care acceptă și GET (cron).
function handledMethod(req, res, { allowGet = false } = {}) {
  applyCors(res);
  if (req.method === 'OPTIONS') { res.status(204).end(); return true; }
  if (req.method === 'POST') return false;
  if (allowGet && req.method === 'GET') return false;
  res.status(405).json({ error: 'Method Not Allowed' });
  return true;
}

// Client admin (service role) — ocolește RLS. A se folosi DOAR pe server.
function admin() {
  return createClient(
    process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY
  );
}

// ─── CRON: e cererea o invocare legitimă de cron? ────────────────────────────
// FOLOSITĂ DE TOATE RUTELE-CRON. Cauza reală a „task-urile nu rulează singure”:
// verificarea veche accepta DOAR headerul `x-vercel-cron`, dar Vercel NU mai
// documentează/trimite garantat acel header — invocările cron actuale se
// recunosc prin headerul `x-vercel-cron-schedule` (documentat: conține expresia
// cron care a declanșat invocarea), prin user-agent-ul `vercel-cron/1.0` și,
// oficial, prin `Authorization: Bearer CRON_SECRET` (Vercel îl trimite automat
// dacă variabila de mediu CRON_SECRET există în proiect). Cronul era deci
// respins cu 403 la fiecare tic — doar „▶️ Rulează acum” (autentificat ca
// admin) mai funcționa. Acceptăm ORICARE dintre semnale (retrocompatibil):
//   1. x-vercel-cron / x-vercel-cron-schedule (puse de platformă);
//   2. user-agent care începe cu „vercel-cron/”;
//   3. Authorization: Bearer <CRON_SECRET sau AI_CRON_SECRET>;
//   4. ?secret=AI_CRON_SECRET (declanșare manuală / servicii externe de ping).
function isCronRequest(req) {
  const h = req.headers || {};
  if (h['x-vercel-cron'] || h['x-vercel-cron-schedule']) return true;
  if (/^vercel-cron\//i.test(String(h['user-agent'] || ''))) return true;
  const bearer = String(h.authorization || h.Authorization || '').replace(/^Bearer\s+/i, '').trim();
  const secrets = [process.env.CRON_SECRET, process.env.AI_CRON_SECRET].filter(Boolean);
  if (bearer && secrets.includes(bearer)) return true;
  const qSecret = (req.query && req.query.secret) || null;
  if (qSecret && secrets.includes(qSecret)) return true;
  return false;
}

// ─── VERIFICARE LOCALĂ A JWT (scalare: zero drumuri la Auth per cerere) ──────
// Până acum, FIECARE cerere API făcea un apel de rețea la Supabase Auth
// (`supa.auth.getUser`) doar ca să afle userId-ul — +50–150ms pe cerere și
// presiune pe Auth la trafic mare. Tokenul e însă un JWT semnat de proiect,
// deci îl putem verifica LOCAL, criptografic, fără nicio cerere:
//   · proiecte cu chei ASIMETRICE (implicit la proiectele noi): verificăm cu
//     cheia publică din JWKS (/auth/v1/.well-known/jwks.json), descărcată o
//     dată și ținută în cache 10 minute per instanță;
//   · proiecte pe „Legacy HS256": setează SUPABASE_JWT_SECRET în Vercel
//     (Supabase → Settings → API → JWT Secret) și verificăm HMAC local;
//   · orice caz neacoperit (fără secret, JWKS indisponibil, alg necunoscut)
//     → fallback EXACT pe comportamentul vechi (auth.getUser). Nimic nu se
//     pierde: doar drumul de rețea dispare în cazul obișnuit.
// Compromis asumat (standard la JWT): un token rămâne valabil până la `exp`
// (≤1h) chiar dacă sesiunea a fost închisă între timp de pe alt dispozitiv.
const JWKS_TTL_MS = 10 * 60 * 1000;
const jwksCache = { keys: null, at: 0, url: null }; // mutat în loc (exportat pt. teste)

const b64uToBuf = (s) => Buffer.from(String(s).replace(/-/g, '+').replace(/_/g, '/'), 'base64');

function decodeJwt(token) {
  const parts = String(token).split('.');
  if (parts.length !== 3) return null;
  try {
    return {
      header: JSON.parse(b64uToBuf(parts[0]).toString('utf8')),
      payload: JSON.parse(b64uToBuf(parts[1]).toString('utf8')),
      signed: `${parts[0]}.${parts[1]}`,
      sig: b64uToBuf(parts[2]),
    };
  } catch { return null; }
}

async function fetchJwks(base) {
  const url = `${base}/auth/v1/.well-known/jwks.json`;
  const now = Date.now();
  if (jwksCache.keys && jwksCache.url === url && now - jwksCache.at < JWKS_TTL_MS) return jwksCache.keys;
  const r = await fetch(url, { signal: AbortSignal.timeout(3000) });
  if (!r.ok) throw new Error(`JWKS ${r.status}`);
  const body = await r.json();
  Object.assign(jwksCache, { keys: body.keys || [], at: now, url });
  return jwksCache.keys;
}

// Cheia pentru `kid`; la kid necunoscut reîncercăm o dată (rotație de chei),
// dar nu mai des de o dată pe minut (un token ostil nu ne pune să spamăm JWKS).
async function jwkForKid(base, kid) {
  let keys = await fetchJwks(base);
  let jwk = keys.find((k) => k.kid === kid);
  if (!jwk && Date.now() - jwksCache.at > 60 * 1000) {
    jwksCache.at = 0;
    keys = await fetchJwks(base);
    jwk = keys.find((k) => k.kid === kid);
  }
  return jwk || null;
}

// Întoarce claims-urile dacă tokenul e valid; null dacă nu POATE fi verificat
// local (apelantul decide fallback-ul). Aruncă doar la probleme de rețea JWKS.
async function verifyJwtLocal(token) {
  const jwt = decodeJwt(token);
  if (!jwt || !jwt.header || !jwt.payload) return null;
  const { header, payload } = jwt;
  const now = Math.floor(Date.now() / 1000);
  if (!(Number(payload.exp) > now - 30)) return null;              // expirat
  if (payload.nbf && Number(payload.nbf) > now + 30) return null;  // încă nevalabil
  const base = String(process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || '').replace(/\/+$/, '');
  if (!base || payload.iss !== `${base}/auth/v1`) return null;     // alt emitent/proiect
  const aud = Array.isArray(payload.aud) ? payload.aud : [payload.aud];
  if (!aud.includes('authenticated')) return null;                 // doar sesiuni de utilizator
  if (!payload.sub) return null;

  if (header.alg === 'HS256') {
    const secret = process.env.SUPABASE_JWT_SECRET;
    if (!secret) return null; // fără secret nu verificăm local — fallback
    const mac = crypto.createHmac('sha256', secret).update(jwt.signed).digest();
    if (mac.length !== jwt.sig.length || !crypto.timingSafeEqual(mac, jwt.sig)) return null;
    return payload;
  }

  if (header.alg === 'ES256' || header.alg === 'RS256') {
    const jwk = await jwkForKid(base, header.kid);
    if (!jwk) return null;
    let pub;
    try { pub = crypto.createPublicKey({ key: jwk, format: 'jwk' }); } catch { return null; }
    const ok = header.alg === 'ES256'
      // semnătura JOSE la ES256 e r||s („ieee-p1363"), nu DER
      ? crypto.verify('sha256', Buffer.from(jwt.signed), { key: pub, dsaEncoding: 'ieee-p1363' }, jwt.sig)
      : crypto.verify('sha256', Buffer.from(jwt.signed), pub, jwt.sig);
    return ok ? payload : null;
  }

  return null; // alg necunoscut (sau 'none') → fallback, care refuză oricum
}

// ─── AUTENTIFICARE REALĂ ─────────────────────────────────────────────────────
// Derivă userId-ul din tokenul de sesiune Supabase (Authorization: Bearer ...).
// NU se mai are încredere în `req.body.userId` (era falsificabil de oricine).
// Întâi local (fără rețea, vezi mai sus); fallback: auth.getUser, ca înainte.
async function authUser(req, supa) {
  const h = req.headers.authorization || req.headers.Authorization || '';
  const token = String(h).replace(/^Bearer\s+/i, '').trim();
  if (!token) { const e = new Error('Neautentificat. Reautentifică-te.'); e.status = 401; throw e; }
  try {
    const claims = await verifyJwtLocal(token);
    if (claims) return claims.sub;
  } catch { /* JWKS indisponibil etc. → încercăm pe drumul vechi */ }
  const { data, error } = await supa.auth.getUser(token);
  if (error || !data?.user) { const e = new Error('Sesiune invalidă sau expirată.'); e.status = 401; throw e; }
  return data.user.id;
}

// Verifică drept de admin (după ce ai userId-ul REAL din authUser).
async function requireAdmin(supa, userId) {
  const { data, error } = await supa.from('profiles').select('is_admin').eq('id', userId).single();
  if (error || !data?.is_admin) { const e = new Error('Acces interzis'); e.status = 403; throw e; }
  return true;
}

// ─── Citire PAGINATĂ din Supabase (PostgREST întoarce max 1000/cerere) ───────
// Fără paginare, listele mari se trunchiază TĂCUT la 1000 de rânduri — caz
// real: progresul elevilor unui profesor era ordonat descrescător după dată,
// deci rezultatele VECHI (grupa de anul trecut) dispăreau din dashboard pe
// măsură ce elevii activi adăugau rânduri noi. `build(from, to)` primește
// intervalul și întoarce cererea Supabase cu .range(from, to) aplicat.
async function allRows(build, { pageSize = 1000, maxPages = 30 } = {}) {
  const out = [];
  for (let p = 0; p < maxPages; p++) {
    const { data, error } = await build(p * pageSize, p * pageSize + pageSize - 1);
    if (error) throw new Error(error.message);
    out.push(...(data || []));
    if (!data || data.length < pageSize) break;
  }
  return out;
}

// Filtre .in(...) pe liste mari de id-uri: împărțim în loturi (URL-ul cererii
// PostgREST are limită de lungime) și citim fiecare lot paginat cu allRows.
async function inBatches(ids, buildBatch, { batchSize = 100, ...opts } = {}) {
  const list = Array.isArray(ids) ? ids : [];
  const out = [];
  for (let i = 0; i < list.length; i += batchSize) {
    const chunk = list.slice(i, i + batchSize);
    out.push(...await allRows((from, to) => buildBatch(chunk, from, to), opts));
  }
  return out;
}

// ─── Parsează bucket + cale dintr-un URL public Supabase Storage (PUR) ───────
// Suportă .../object/public/BUCKET/path și .../object/sign/BUCKET/path.
function parseStoragePath(fileUrl) {
  const url = new URL(fileUrl);
  const parts = url.pathname.split('/');
  const objIdx = parts.findIndex((p) => p === 'object');
  if (objIdx === -1) throw new Error('URL invalid (fără /object/).');
  const bucket = parts[objIdx + 2];
  const filePath = parts.slice(objIdx + 3).join('/').split('?')[0];
  if (!bucket || !filePath) throw new Error('Nu s-a putut extrage calea din URL.');
  return { bucket, filePath };
}

// Signed URL dintr-un URL public Supabase Storage (implementare robustă).
async function signedUrlFromPublic(supa, fileUrl, ttl = 300) {
  const { bucket, filePath } = parseStoragePath(fileUrl);
  const { data, error } = await supa.storage.from(bucket).createSignedUrl(filePath, ttl);
  if (error || !data?.signedUrl) throw new Error('Nu s-a putut genera linkul semnat.');
  return data.signedUrl;
}

module.exports = {
  CORS, applyCors, handledMethod, admin,
  authUser, requireAdmin, parseStoragePath, signedUrlFromPublic,
  allRows, inBatches, isCronRequest,
  // verificarea locală a sesiunii (exportate pentru teste)
  verifyJwtLocal, decodeJwt, jwksCache,
};
