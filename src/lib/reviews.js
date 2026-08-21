// =====================================================================
// src/lib/reviews.js — recenzii (stele 1–5 + comentariu), direct prin
// Supabase; gardul real e RLS-ul din supabase/reviews_schema.sql
// (poate nota doar cine a rezolvat testul, o singură notă per test).
//
//   fetchReviewStats(targetType, ids)            → { [target_id]: { avg, n, nComentarii } }
//   fetchSiteStats()                             → { avg, n, nComentarii } pentru recenziile „site" aprobate
//   fetchMyReview(userId, targetType, targetId)  → recenzia proprie sau null
//   fetchReviews(targetType, targetId, opts)     → { items, hasMore } (cele mai noi primele)
//   saveReview({ userId, targetType, targetId, stars, body }) → rândul salvat
//   deleteReview(id)                             → șterge (propria recenzie sau, ca admin, oricare)
//   adminListReviews(filtre) / adminSetApproved(id, bool) / adminWorstTargets()
//   formatAvg(4.567)                             → „4,6" (virgulă, ca în română)
//
// Tipuri de țintă (target_type): 'content' (test din site — content.id),
// 'public_item' (Biblioteca utilizatorilor), 'site' (părere generală, target_id null).
//
// Citirile ÎNGHIT erorile (ex. migrarea nerulată → tabelul lipsește) și întorc
// gol, ca listele de teste să meargă și fără recenzii. Scrierile aruncă o
// eroare cu mesaj pe înțelesul utilizatorului.
// =====================================================================
import { supabase } from './supabase';

export const REVIEW_TARGETS = ['content', 'public_item', 'site'];
export const TARGET_LABEL = { content: 'Test din site', public_item: 'Biblioteca utilizatorilor', site: 'Despre ExamenMate' };
export const ROLE_LABEL = { elev: 'Elev', profesor: 'Profesor', parinte: 'Părinte' };

// reply / reply_at = răspunsul echipei (supabase/reviews_v2.sql); pe instalări
// fără coloane, cererile ar pica → citirile cad înapoi pe setul de bază.
const COLS = 'id, user_id, author_name, author_role, target_type, target_id, stars, body, approved, reply, reply_at, created_at, updated_at';
const COLS_BASE = 'id, user_id, author_name, author_role, target_type, target_id, stars, body, approved, created_at, updated_at';
const missingReply = (err) => /reply/i.test(String(err?.message || ''));

export async function fetchReviewStats(targetType, ids) {
  const list = [...new Set((ids || []).filter(Boolean))];
  if (!list.length) return {};
  try {
    const { data, error } = await supabase
      .from('reviews_stats')
      .select('target_id, avg_stars, n, n_comentarii')
      .eq('target_type', targetType)
      .in('target_id', list);
    if (error || !data) return {};
    const map = {};
    for (const r of data) {
      map[r.target_id] = { avg: Number(r.avg_stars) || 0, n: r.n || 0, nComentarii: r.n_comentarii || 0 };
    }
    return map;
  } catch {
    return {};
  }
}

// Media generală a site-ului (doar recenziile „site" aprobate — vezi view-ul).
export async function fetchSiteStats() {
  try {
    const { data, error } = await supabase
      .from('reviews_stats')
      .select('avg_stars, n, n_comentarii')
      .eq('target_type', 'site')
      .is('target_id', null)
      .maybeSingle();
    if (error || !data) return null;
    return { avg: Number(data.avg_stars) || 0, n: data.n || 0, nComentarii: data.n_comentarii || 0 };
  } catch {
    return null;
  }
}

// Lista recenziilor unei ținte, cele mai noi primele. Pentru 'site' doar cele
// aprobate (RLS-ul oricum le ascunde pe celelalte pentru public).
//   opts: { limit = 10, offset = 0, onlyWithBody = false, orderByStars = false }
export async function fetchReviews(targetType, targetId = null, opts = {}) {
  const { limit = 10, offset = 0, onlyWithBody = false, orderByStars = false } = opts;
  const build = (cols) => {
    let q = supabase.from('reviews').select(cols).eq('target_type', targetType);
    q = targetId ? q.eq('target_id', targetId) : q.is('target_id', null);
    if (targetType === 'site') q = q.eq('approved', true);
    if (onlyWithBody) q = q.not('body', 'is', null);
    if (orderByStars) q = q.order('stars', { ascending: false });
    return q.order('created_at', { ascending: false }).range(offset, offset + limit); // +1 → știm dacă mai sunt
  };
  try {
    let { data, error } = await build(COLS);
    if (error && missingReply(error)) ({ data, error } = await build(COLS_BASE));
    if (error || !data) return { items: [], hasMore: false };
    return { items: data.slice(0, limit), hasMore: data.length > limit };
  } catch {
    return { items: [], hasMore: false };
  }
}

export async function deleteReview(id) {
  const { error } = await supabase.from('reviews').delete().eq('id', id);
  if (error) throw new Error(friendlyError(error));
}

// ─── Admin (RLS: adminul vede/aprobă/șterge orice recenzie) ──────────────────
//   filtre: { targetType: ''|'content'|'public_item'|'site', maxStars: 0|2|3,
//             status: ''|'pending'|'approved', targetId, limit, offset }
export async function adminListReviews(f = {}) {
  const { targetType = '', maxStars = 0, status = '', targetId = null, limit = 50, offset = 0, onlyUnanswered = false } = f;
  const build = (cols) => {
    let q = supabase.from('reviews').select(cols);
    // starea (în așteptare / publicată) are sens doar pentru recenziile „site"
    if (status === 'pending') q = q.eq('target_type', 'site').eq('approved', false);
    else if (status === 'approved') q = q.eq('target_type', 'site').eq('approved', true);
    else if (targetType) q = q.eq('target_type', targetType);
    if (targetId) q = q.eq('target_id', targetId);
    if (maxStars) q = q.lte('stars', maxStars);
    if (onlyUnanswered) q = q.is('reply', null).not('body', 'is', null); // comentarii fără răspuns
    return q.order('created_at', { ascending: false }).range(offset, offset + limit);
  };
  let { data, error } = await build(COLS);
  if (error && missingReply(error) && !onlyUnanswered) ({ data, error } = await build(COLS_BASE));
  if (error) throw new Error(friendlyError(error));
  return { items: (data || []).slice(0, limit), hasMore: (data || []).length > limit };
}

export async function adminSetApproved(id, approved) {
  const { error } = await supabase.from('reviews').update({ approved: !!approved }).eq('id', id);
  if (error) throw new Error(friendlyError(error));
}

// Răspunsul echipei (doar admin — triggerul ignoră coloana pentru restul).
// text gol/null → șterge răspunsul. reply_at se pune automat (trigger).
export async function adminSetReply(id, text) {
  const reply = String(text || '').trim().slice(0, 1000) || null;
  const { data, error } = await supabase.from('reviews').update({ reply }).eq('id', id).select(COLS).single();
  if (error) throw new Error(missingReply(error) ? 'Răspunsul echipei nu e activat încă (rulează supabase/reviews_v2.sql).' : friendlyError(error));
  return data;
}

// Contoare pentru rezumatul din Admin (cereri HEAD cu count exact).
export async function adminCounts() {
  try {
    const [all, pending, site] = await Promise.all([
      supabase.from('reviews').select('id', { count: 'exact', head: true }),
      supabase.from('reviews').select('id', { count: 'exact', head: true }).eq('target_type', 'site').eq('approved', false),
      supabase.from('reviews').select('id', { count: 'exact', head: true }).eq('target_type', 'site').eq('approved', true),
    ]);
    return { total: all.count || 0, pending: pending.count || 0, sitePublished: site.count || 0 };
  } catch {
    return { total: 0, pending: 0, sitePublished: 0 };
  }
}

// Testele cu notele cele mai slabe (coada de corecturi), din view-ul agregat.
export async function adminWorstTargets(targetType = 'content', limit = 30) {
  try {
    const { data, error } = await supabase
      .from('reviews_stats')
      .select('target_id, avg_stars, n, n_comentarii')
      .eq('target_type', targetType)
      .order('avg_stars', { ascending: true })
      .order('n', { ascending: false })
      .limit(limit);
    if (error || !data) return [];
    return data.map((r) => ({ targetId: r.target_id, avg: Number(r.avg_stars) || 0, n: r.n || 0, nComentarii: r.n_comentarii || 0 }));
  } catch {
    return [];
  }
}

export async function fetchMyReview(userId, targetType, targetId) {
  if (!userId) return null;
  const build = (cols) => {
    let q = supabase.from('reviews').select(cols).eq('user_id', userId).eq('target_type', targetType);
    q = targetId ? q.eq('target_id', targetId) : q.is('target_id', null);
    return q.maybeSingle();
  };
  try {
    let { data, error } = await build(COLS);
    if (error && missingReply(error)) ({ data, error } = await build(COLS_BASE));
    if (error) return null;
    return data || null;
  } catch {
    return null;
  }
}

export async function saveReview({ userId, targetType, targetId = null, stars, body = '' }) {
  if (!userId) throw new Error('Autentifică-te ca să lași o notă.');
  const s = Number(stars);
  if (!Number.isInteger(s) || s < 1 || s > 5) throw new Error('Alege între 1 și 5 stele.');
  const text = String(body || '').trim().slice(0, 1000) || null;
  const row = { user_id: userId, target_type: targetType, target_id: targetId || null, stars: s, body: text };

  let res;
  if (targetId) {
    // o singură notă per (utilizator, test): constrângerea UNIQUE → upsert
    res = await supabase
      .from('reviews')
      .upsert(row, { onConflict: 'user_id,target_type,target_id' })
      .select()
      .single();
  } else {
    // 'site' (target_id NULL — UNIQUE nu „vede" NULL): update dacă există, altfel insert
    const existing = await fetchMyReview(userId, targetType, null);
    res = existing
      ? await supabase.from('reviews').update({ stars: s, body: text }).eq('id', existing.id).select().single()
      : await supabase.from('reviews').insert(row).select().single();
  }
  if (res.error) throw new Error(friendlyError(res.error));
  return res.data;
}

function friendlyError(err) {
  const msg = String(err?.message || '');
  if (/row-level security/i.test(msg)) return 'Poți nota doar testele pe care le-ai rezolvat.';
  if (/reply/i.test(msg) && /does not exist|schema cache/i.test(msg)) return 'Răspunsul echipei nu e activat încă (rulează supabase/reviews_v2.sql).';
  if (/does not exist|schema cache/i.test(msg)) return 'Recenziile nu sunt activate încă (rulează supabase/reviews_schema.sql).';
  if (/duplicate key/i.test(msg)) return 'Ai lăsat deja o notă aici — o poți actualiza.';
  return msg || 'Nu am putut salva nota. Încearcă din nou.';
}

// „4,6" — o zecimală, cu virgulă; întregii fără zecimale („5")
export function formatAvg(avg) {
  const v = Number(avg) || 0;
  const one = Math.round(v * 10) / 10;
  return Number.isInteger(one) ? String(one) : one.toFixed(1).replace('.', ',');
}
