// =====================================================================
// api/gamificare.js — Arena matematică: starea elevului + liga săptămânală
//
// POST /api/gamificare            { action: 'state' }   (implicit)
//   → { stats, nivel, streak, misiune, azi, liga, saptamanaTrecuta, recent }
//
// GET  /api/gamificare?action=cron-league   (doar cron, cu CRON_SECRET)
//   → închide sezoanele încheiate: locuri, promovări, retrogradări.
//     vercel.json: "0 0 * * 1" = luni 03:00 ora României.
//
// Tabelele: supabase/gamificare_v2.sql · motorul: api/_lib/xp.js
// Toate scrierile se fac cu rolul de serviciu — elevul nu-și poate atinge XP-ul.
// =====================================================================
const ai = require('./_lib/ai');
const http = require('./_lib/http');
const xp = require('./_lib/xp');

// „Ana Maria Popescu" → „Ana P." (clasamentul e public în cohortă: arătăm
// prenumele și inițiala, nu numele complet al copilului)
function shortName(full, fallback = 'Elev') {
  const s = String(full || '').trim().replace(/\s+/g, ' ');
  if (!s) return fallback;
  const p = s.split(' ');
  if (p.length === 1) return p[0];
  return `${p[0]} ${p[p.length - 1][0].toUpperCase()}.`;
}

// ─── Starea elevului ────────────────────────────────────────────────────────
async function state(supa, userId) {
  const day = xp.dayKey();
  const stats = await xp.ensureStats(supa, userId);
  const mission = await xp.ensureMission(supa, userId, day);

  // XP-ul de azi + cât mai încape în plafonul de ligă
  const { data: todays } = await supa.from('xp_events')
    .select('xp, league_pts').eq('user_id', userId).eq('day', day);
  const xpAzi = (todays || []).reduce((s, r) => s + (r.xp || 0), 0);
  const ligaAzi = (todays || []).reduce((s, r) => s + (r.league_pts || 0), 0);

  // Înscrierea în liga săptămânii se face la prima deschidere a Arenei, ca
  // elevul să se vadă în clasament chiar înainte de primul exercițiu.
  const standing = await xp.ensureStanding(supa, userId, stats.league_tier || 1);

  let liga = null;
  if (standing) {
    const { data: rows } = await supa.from('league_standings')
      .select('user_id, points, updated_at')
      .eq('season_id', standing.season_id).eq('tier', standing.tier).eq('cohort', standing.cohort)
      .order('points', { ascending: false }).order('updated_at', { ascending: true })
      .limit(xp.COHORT_SIZE);
    const ids = (rows || []).map((r) => r.user_id);
    const { data: profs } = ids.length
      ? await supa.from('profiles').select('id, full_name').in('id', ids)
      : { data: [] };
    const byId = Object.fromEntries((profs || []).map((p) => [p.id, p.full_name]));
    const clasament = (rows || []).map((r, i) => ({
      loc: i + 1,
      nume: r.user_id === userId ? 'Tu' : shortName(byId[r.user_id]),
      puncte: r.points || 0,
      eu: r.user_id === userId,
      zona: i < xp.PROMOTE_TOP ? 'promovare'
        : ((rows.length >= xp.DEMOTE_MIN_MEMBERS && i >= rows.length - xp.DEMOTE_BOTTOM && standing.tier > 1) ? 'retrogradare' : null),
    }));
    liga = {
      ...xp.tierInfo(standing.tier),
      cohorta: standing.cohort,
      puncte: standing.points || 0,
      loc: (clasament.find((c) => c.eu) || {}).loc || null,
      membri: clasament.length,
      promoveaza: xp.PROMOTE_TOP,
      retrogradeaza: (clasament.length >= xp.DEMOTE_MIN_MEMBERS && standing.tier > 1) ? xp.DEMOTE_BOTTOM : 0,
      clasament,
      seFinalizeaza: xp.addDays(xp.weekStart(), 7), // luni următoare
    };
  }

  // Rezultatul săptămânii trecute (pentru mesajul „ai promovat în Argint")
  let saptamanaTrecuta = null;
  const { data: last } = await supa.from('league_standings')
    .select('place, outcome, tier, season:season_id ( week_start, closed_at )')
    .eq('user_id', userId).not('outcome', 'is', null)
    .order('updated_at', { ascending: false }).limit(1);
  if (last && last[0]) {
    // `tier` e divizia în care a JUCAT. Mesajul trebuie să arate divizia în
    // care ajunge acum, altfel „ai promovat în Liga Bronz" e chiar liga din
    // care tocmai a plecat.
    const t = last[0].tier;
    const tierNou = last[0].outcome === 'promovat' ? Math.min(xp.MAX_TIER, t + 1)
      : last[0].outcome === 'retrogradat' ? Math.max(1, t - 1) : t;
    saptamanaTrecuta = {
      loc: last[0].place, rezultat: last[0].outcome,
      ...xp.tierInfo(tierNou),
      saptamana: last[0].season?.week_start || null,
    };
  }

  const { data: recent } = await supa.from('xp_events')
    .select('source, xp, league_pts, created_at, meta')
    .eq('user_id', userId).order('created_at', { ascending: false }).limit(8);

  return {
    ok: true,
    stats: {
      totalXp: stats.total_xp || 0,
      monede: stats.coins || 0,
      streak: stats.streak_current || 0,
      streakRecord: stats.streak_best || 0,
      streakAzi: stats.streak_day === day,
      scuturi: stats.freezes || 0,
    },
    nivel: xp.levelOf(stats.total_xp || 0),
    azi: { xp: xpAzi, liga: ligaAzi, plafon: xp.LEAGUE_DAILY_CAP, pragStreak: xp.STREAK_MIN_XP },
    misiune: mission ? {
      label: mission.label, kind: mission.kind,
      progress: mission.progress || 0, target: mission.target,
      done: !!mission.done, reward_xp: mission.reward_xp, reward_coins: mission.reward_coins,
    } : null,
    liga,
    saptamanaTrecuta,
    recent: recent || [],
  };
}

// ─── Închiderea sezoanelor (cron săptămânal) ────────────────────────────────
async function closeSeasons(supa) {
  const week = xp.weekStart();
  const { data: seasons } = await supa.from('league_seasons')
    .select('*').is('closed_at', null).lt('week_start', week)
    .order('week_start', { ascending: true }); // sezoanele restante se închid în ordine
  const raport = [];

  for (const season of seasons || []) {
    // allRows: PostgREST întoarce maximum 1000 de rânduri per cerere și
    // trunchiază TĂCUT — fără paginare, cohortele „de la coadă" n-ar fi
    // niciodată clasate, iar sezonul s-ar închide oricum.
    // `.is('outcome', null)`: dacă o rulare a picat la jumătate, cea următoare
    // reia doar rândurile neprocesate (nicio promovare plătită de două ori).
    const rows = await http.allRows((from, to) => supa.from('league_standings')
      .select('id, user_id, tier, cohort, points, updated_at')
      .eq('season_id', season.id).is('outcome', null)
      .order('points', { ascending: false }).order('updated_at', { ascending: true })
      .range(from, to));

    // grupare pe cohorte
    const groups = {};
    for (const r of rows) {
      const k = `${r.tier}|${r.cohort}`;
      (groups[k] = groups[k] || []).push(r);
    }

    let promovati = 0; let retrogradati = 0;
    for (const key of Object.keys(groups)) {
      const g = groups[key];
      for (let i = 0; i < g.length; i++) {
        const r = g[i];
        const loc = i + 1;
        let outcome = 'ramas';
        let tierNou = r.tier;

        if (loc <= xp.PROMOTE_TOP && (r.points || 0) > 0 && r.tier < xp.MAX_TIER) {
          outcome = 'promovat'; tierNou = r.tier + 1; promovati++;
        } else if (g.length >= xp.DEMOTE_MIN_MEMBERS && loc > g.length - xp.DEMOTE_BOTTOM && r.tier > 1) {
          outcome = 'retrogradat'; tierNou = r.tier - 1; retrogradati++;
        }

        await supa.from('league_standings')
          .update({ place: loc, outcome }).eq('id', r.id);
        if (tierNou !== r.tier) {
          await supa.from('user_stats')
            .update({ league_tier: tierNou, updated_at: new Date().toISOString() })
            .eq('user_id', r.user_id);
        }
        // mic bonus pentru promovare (nu intră în punctele de ligă)
        if (outcome === 'promovat') {
          await supa.from('xp_events').insert({
            user_id: r.user_id, day: xp.dayKey(), source: 'liga', xp: 100, league_pts: 0,
            meta: { promovat_in: tierNou, loc },
          });
          const { error: eBump } = await supa.rpc('xp_bump', { p_user: r.user_id, p_xp: 100, p_coins: 25 });
          if (eBump) { // fără funcțiile atomice (migrare veche) — drum de rezervă
            const { data: st } = await supa.from('user_stats').select('total_xp, coins').eq('user_id', r.user_id).maybeSingle();
            await supa.from('user_stats').update({
              total_xp: (st?.total_xp || 0) + 100, coins: (st?.coins || 0) + 25,
              updated_at: new Date().toISOString(),
            }).eq('user_id', r.user_id);
          }
        }
      }
    }

    await supa.from('league_seasons').update({ closed_at: new Date().toISOString() }).eq('id', season.id);
    raport.push({ saptamana: season.week_start, elevi: rows.length, cohorte: Object.keys(groups).length, promovati, retrogradati });
  }

  return { ok: true, inchise: raport.length, raport };
}

// ─── Handler ────────────────────────────────────────────────────────────────
module.exports = async function handler(req, res) {
  ai.applyCors(res);
  if (req.method === 'OPTIONS') return res.status(204).end();

  const action = String((req.query && req.query.action) || (req.body && req.body.action) || 'state');
  const supa = ai.admin();

  try {
    // cronul săptămânal — fără sesiune de utilizator, doar cu secretul
    if (action === 'cron-league') {
      if (!ai.isCronRequest(req)) return res.status(403).json({ error: 'Neautorizat' });
      return res.status(200).json(await closeSeasons(supa));
    }

    if (req.method !== 'POST') return res.status(405).json({ error: 'Method Not Allowed' });
    const userId = await ai.authUser(req, supa);
    await ai.requireUser(supa, userId);

    if (action === 'state') return res.status(200).json(await state(supa, userId));
    return res.status(400).json({ error: `Acțiune necunoscută: ${action}` });
  } catch (err) {
    console.error('gamificare error:', err);
    return res.status(err.status || 500).json({ error: err.message || 'Eroare server' });
  }
};

module.exports.closeSeasons = closeSeasons;
module.exports.shortName = shortName;
