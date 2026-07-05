// =====================================================================
// src/lib/api.js — cereri autentificate către /api
// Atașează tokenul de sesiune Supabase (Authorization: Bearer ...) ca
// serverul să deducă identitatea REALĂ, nu din body (care era falsificabil).
// =====================================================================
import { supabase } from './supabase';

// Antete cu tokenul curent (dacă există sesiune).
export async function authHeaders() {
  const { data: { session } } = await supabase.auth.getSession();
  const h = { 'Content-Type': 'application/json' };
  if (session?.access_token) h.Authorization = `Bearer ${session.access_token}`;
  return h;
}

// POST autentificat. Întoarce JSON; aruncă Error cu .status / .premium la eșec.
export async function apiPost(path, body = {}) {
  const res = await fetch(path, { method: 'POST', headers: await authHeaders(), body: JSON.stringify(body) });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const e = new Error(data.error || `Eroare server (${res.status})`);
    e.status = res.status;
    if (data.code === 'PREMIUM_REQUIRED' || res.status === 402) e.premium = true;
    throw e;
  }
  return data;
}
