// =====================================================================
// src/lib/badges.js — insignele elevilor (gamificare)
// Acordate client-side la salvarea scorului (InteractiveViewer) și citite
// de Profesorul Virtual (backend: tabela user_badges) pentru felicitări.
// Necesită scriptul supabase/gamification_schema.sql rulat o dată.
// =====================================================================
import { supabase } from './supabase';

// ctx: { pct, attempts, category, totals: { completed, perfect, byCategory } }
export const BADGES = [
  { id: 'primul-exercitiu', icon: '🎯', name: 'Primul pas',
    desc: 'Ai finalizat primul exercițiu interactiv.',
    check: (c) => c.totals.completed >= 1 },
  { id: 'punctaj-maxim', icon: '🏆', name: 'Punctaj maxim',
    desc: 'Ai obținut punctajul maxim la un exercițiu.',
    check: (c) => c.pct >= 100 },
  { id: 'perseverent', icon: '💪', name: 'Perseverent',
    desc: 'Ai reluat un exercițiu până l-ai stăpânit (3+ încercări, peste 80%).',
    check: (c) => c.attempts >= 3 && c.pct >= 80 },
  { id: 'maraton-5', icon: '🔥', name: 'În formă',
    desc: 'Ai finalizat 5 exerciții interactive.',
    check: (c) => c.totals.completed >= 5 },
  { id: 'maraton-10', icon: '🚀', name: 'De neoprit',
    desc: 'Ai finalizat 10 exerciții interactive.',
    check: (c) => c.totals.completed >= 10 },
  { id: 'maraton-25', icon: '👑', name: 'Campion',
    desc: 'Ai finalizat 25 de exerciții interactive.',
    check: (c) => c.totals.completed >= 25 },
  { id: 'perfectionist', icon: '⭐', name: 'Perfecționist',
    desc: 'Punctaj maxim la 5 exerciții diferite.',
    check: (c) => c.totals.perfect >= 5 },
  { id: 'pregatit-bac', icon: '🎓', name: 'Pregătit de Bac',
    desc: '5 exerciții finalizate din secțiunea Bacalaureat.',
    check: (c) => (c.totals.byCategory['bacalaureat'] || 0) >= 5 },
  { id: 'pregatit-en', icon: '📘', name: 'Pregătit de Evaluare',
    desc: '5 exerciții finalizate din secțiunea Evaluare Națională.',
    check: (c) => (c.totals.byCategory['evaluare-nationala'] || 0) >= 5 },
];

// Verifică și acordă insignele noi după un scor salvat.
// Returnează lista definițiilor proaspăt câștigate (posibil goală).
export async function awardBadges(userId, { score = 0, maxScore = 0, attempts = 1, category = null } = {}) {
  if (!userId) return [];
  try {
    // Totalurile din progres (categoria vine prin FK către content)
    const { data: prog } = await supabase
      .from('progress')
      .select('score, max_score, content:content_id ( category )')
      .eq('user_id', userId);
    const rows = prog || [];
    const byCategory = {};
    let perfect = 0;
    rows.forEach((r) => {
      const cat = r.content?.category;
      if (cat) byCategory[cat] = (byCategory[cat] || 0) + 1;
      if (r.max_score > 0 && r.score >= r.max_score) perfect++;
    });
    const ctx = {
      pct: maxScore > 0 ? Math.round((score / maxScore) * 100) : 0,
      attempts: attempts || 1,
      category,
      totals: { completed: rows.length, perfect, byCategory },
    };

    const candidates = BADGES.filter((b) => { try { return b.check(ctx); } catch { return false; } });
    if (!candidates.length) return [];

    const { data: have, error: haveErr } = await supabase
      .from('user_badges').select('badge_id').eq('user_id', userId);
    if (haveErr) return []; // tabela lipsește (scriptul SQL nu a fost rulat) — nu deranjăm elevul
    const owned = new Set((have || []).map((b) => b.badge_id));
    const fresh = candidates.filter((b) => !owned.has(b.id));
    if (!fresh.length) return [];

    const { error } = await supabase.from('user_badges').insert(
      fresh.map((b) => ({ user_id: userId, badge_id: b.id, name: b.name, icon: b.icon }))
    );
    if (error) return [];
    return fresh;
  } catch {
    return [];
  }
}

// Insignele elevului (pentru profil)
export async function getMyBadges(userId) {
  if (!userId) return [];
  try {
    const { data } = await supabase
      .from('user_badges')
      .select('badge_id, name, icon, earned_at')
      .eq('user_id', userId)
      .order('earned_at', { ascending: false });
    return (data || []).map((row) => {
      const def = BADGES.find((b) => b.id === row.badge_id);
      return { id: row.badge_id, icon: row.icon || def?.icon || '🏅', name: row.name || def?.name || row.badge_id, desc: def?.desc || '', earned_at: row.earned_at };
    });
  } catch {
    return [];
  }
}
