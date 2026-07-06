// =====================================================================
// src/lib/api.js — cereri autentificate către /api + gestionarea tokenului
// Atașează tokenul de sesiune Supabase (Authorization: Bearer ...) și îl
// reîmprospătează PROACTIV când a expirat, ca serverul (și interogările
// directe Supabase) să nu primească un token expirat → „sesiune expirată".
// =====================================================================
import { supabase } from './supabase';

// O singură reîmprospătare în zbor (dedup) — evită coliziunile de refresh-token
// (rotația Supabase invalidează sesiunea dacă se reîmprospătează concurent).
let refreshPromise = null;
function refreshOnce() {
  if (!refreshPromise) {
    refreshPromise = supabase.auth.refreshSession()
      .then(({ data }) => data?.session || null)
      .catch(() => null)
      .finally(() => { refreshPromise = null; });
  }
  return refreshPromise;
}

// Sesiune cu token valid. Reîmprospătează dacă expiră în <30s.
export async function getValidSession() {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) return null;
  const expMs = (session.expires_at || 0) * 1000;
  if (expMs - Date.now() > 30_000) return session; // încă valid
  return (await refreshOnce()) || session;
}

// Forțează o reîmprospătare (folosit la retry pe 401).
export async function forceRefresh() {
  return refreshOnce();
}

// Antete cu tokenul curent (valid).
export async function authHeaders() {
  const session = await getValidSession();
  const h = { 'Content-Type': 'application/json' };
  if (session?.access_token) h.Authorization = `Bearer ${session.access_token}`;
  return h;
}

// POST autentificat, cu re-încercare unică pe 401 (token expirat între timp).
export async function apiPost(path, body = {}) {
  let res = await fetch(path, { method: 'POST', headers: await authHeaders(), body: JSON.stringify(body) });
  if (res.status === 401) {
    await forceRefresh();
    res = await fetch(path, { method: 'POST', headers: await authHeaders(), body: JSON.stringify(body) });
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const e = new Error(data.error || `Eroare server (${res.status})`);
    e.status = res.status;
    if (data.code === 'PREMIUM_REQUIRED' || res.status === 402) e.premium = true;
    throw e;
  }
  return data;
}
