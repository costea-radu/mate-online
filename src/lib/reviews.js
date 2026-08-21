// =====================================================================
// src/lib/reviews.js — recenzii (stele 1–5 + comentariu), direct prin
// Supabase; gardul real e RLS-ul din supabase/reviews_schema.sql
// (poate nota doar cine a rezolvat testul, o singură notă per test).
//
//   fetchReviewStats(targetType, ids)            → { [target_id]: { avg, n, nComentarii } }
//   fetchMyReview(userId, targetType, targetId)  → recenzia proprie sau null
//   saveReview({ userId, targetType, targetId, stars, body }) → rândul salvat
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

export async function fetchMyReview(userId, targetType, targetId) {
  if (!userId) return null;
  try {
    let q = supabase
      .from('reviews')
      .select('id, stars, body, created_at, updated_at')
      .eq('user_id', userId)
      .eq('target_type', targetType);
    q = targetId ? q.eq('target_id', targetId) : q.is('target_id', null);
    const { data, error } = await q.maybeSingle();
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
