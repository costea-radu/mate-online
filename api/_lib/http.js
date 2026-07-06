// =====================================================================
// api/_lib/http.js — utilitare HTTP partajate de TOATE rutele serverless
// (CORS, guard de metodă, autentificare reală pe token, verificare admin,
//  signed URL din URL public). Elimină boilerplate-ul duplicat și, mai
//  important, centralizează AUTENTIFICAREA într-un singur loc.
// =====================================================================
const { createClient } = require('@supabase/supabase-js');

// Originea permisă: setează SITE_ORIGIN în Vercel (ex: https://examenmate.ro).
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

// ─── AUTENTIFICARE REALĂ ─────────────────────────────────────────────────────
// Derivă userId-ul din tokenul de sesiune Supabase (Authorization: Bearer ...).
// NU se mai are încredere în `req.body.userId` (era falsificabil de oricine).
async function authUser(req, supa) {
  const h = req.headers.authorization || req.headers.Authorization || '';
  const token = String(h).replace(/^Bearer\s+/i, '').trim();
  if (!token) { const e = new Error('Neautentificat. Reautentifică-te.'); e.status = 401; throw e; }
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
};
