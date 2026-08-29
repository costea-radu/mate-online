// =====================================================================
// api/_lib/xp.js — motorul de gamificare (XP, streak, misiunea zilei, ligă)
// Rulează DOAR pe server, cu rolul de serviciu. Tabelele: supabase/gamificare_v2.sql
//
// De ce formulă ponderată și nu „câte exerciții ai făcut":
//   numărul brut de exerciții premiază elevul care stă 5 ore și rezolvă lucruri
//   ușoare. Aici XP-ul = corecte × dificultate × precizie × penalizare-reluare,
//   iar punctele de LIGĂ au plafon zilnic — deci liga se câștigă intrând
//   CONSTANT, nu stând mult într-o singură zi.
// =====================================================================

// ─── Constante reglabile (se pot muta în env dacă e nevoie) ─────────────────
const XP_PER_CORRECT   = 5;                        // XP de bază pentru un item corect
const XP_MAX_PER_TEST  = 100;                      // plafon per exercițiu (un test de 60 de itemi nu valorează cât o săptămână)
const LEAGUE_DAILY_CAP = parseInt(process.env.GAMI_LEAGUE_DAILY_CAP || '200', 10);
const STREAK_MIN_XP    = parseInt(process.env.GAMI_STREAK_MIN_XP || '20', 10);  // ~4 itemi corecți
const MAX_FREEZES      = 2;                        // „scuturi" de streak
const COHORT_SIZE      = parseInt(process.env.GAMI_COHORT_SIZE || '30', 10);
const PROMOTE_TOP      = 3;
const DEMOTE_BOTTOM    = 3;
const DEMOTE_MIN_MEMBERS = 8;                      // sub atât nu retrogradăm pe nimeni

// Ponderea dificultății (1-5). Materialul poate avea `content.difficulty`;
// dacă nu, o deducem din categorie.
const DIFF_WEIGHT = { 1: 0.8, 2: 1.0, 3: 1.2, 4: 1.5, 5: 1.8 };
const DIFF_BY_CATEGORY = {
  'clasa-5': 1, 'clasa-6': 2, 'clasa-7': 2, 'clasa-8': 3,
  'clasa-9': 3, 'clasa-10': 4, 'clasa-11': 4, 'clasa-12': 5,
  'evaluare-nationala': 4, 'bacalaureat': 5, 'manuale': 2,
};

// Nivelurile (prag cumulat de XP). Peste ultimul → rămâne „Legendă".
const LEVELS = [
  { min: 0,     name: 'Începător' },
  { min: 100,   name: 'Explorator' },
  { min: 300,   name: 'Practicant' },
  { min: 600,   name: 'Rezolvitor' },
  { min: 1000,  name: 'Constructor' },
  { min: 1600,  name: 'Strateg' },
  { min: 2400,  name: 'Analist' },
  { min: 3500,  name: 'Maestru' },
  { min: 5000,  name: 'Mare Maestru' },
  { min: 7000,  name: 'Legendă' },
];

const TIERS = [
  null,
  { tier: 1, name: 'Bronz',   icon: '🥉' },
  { tier: 2, name: 'Argint',  icon: '🥈' },
  { tier: 3, name: 'Aur',     icon: '🥇' },
  { tier: 4, name: 'Diamant', icon: '💎' },
  { tier: 5, name: 'Maestru', icon: '👑' },
];
const MAX_TIER = 5;

// ─── Zile și săptămâni în ora României ──────────────────────────────────────
function dayKey(now = new Date()) {
  // 'YYYY-MM-DD' în Europe/Bucharest (en-CA dă exact formatul ISO)
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Bucharest', year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(now);
}

function addDays(key, n) {
  const d = new Date(`${key}T12:00:00Z`); // amiază → fără surprize la ora de vară
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

function daysBetween(a, b) { // b - a, în zile
  return Math.round((new Date(`${b}T12:00:00Z`) - new Date(`${a}T12:00:00Z`)) / 86400000);
}

function weekStart(now = new Date()) { // lunea săptămânii curente
  const key = dayKey(now);
  const dow = new Date(`${key}T12:00:00Z`).getUTCDay(); // 0=duminică
  return addDays(key, dow === 0 ? -6 : 1 - dow);
}

// ─── Formula ────────────────────────────────────────────────────────────────
function difficultyOf(content) {
  const d = Number(content?.difficulty);
  if (d >= 1 && d <= 5) return Math.round(d);
  return DIFF_BY_CATEGORY[content?.category] || 2;
}

function precisionMult(pct) {
  if (pct >= 90) return 1.25;
  if (pct >= 70) return 1.10;
  if (pct >= 40) return 1.00;
  return 0.60;                       // greșești mult → tot iei ceva, dar puțin
}

function repeatFactor(attempts) {
  const a = Math.max(1, Number(attempts) || 1);
  return Math.max(0.15, 1 / a);      // a 2-a oară 50%, a 3-a 33%… (anti-farming)
}

// correct/total pot lipsi (test încărcat manual) → le estimăm din procent.
const UNVERIFIED_FACTOR = 0.4;   // scor trimis de browser, nerecalculat din chei
const UNVERIFIED_MAX_XP = 30;

function computeXp({ score = 0, maxScore = 100, correct = null, total = null, attempts = 1, difficulty = 2, prevPct = null, verified = true }) {
  const pct = maxScore > 0 ? Math.max(0, Math.min(100, (score / maxScore) * 100)) : 0;
  const items = Number(total) > 0 ? Number(total) : 10;
  const ok = Number.isFinite(Number(correct)) && correct !== null
    ? Math.max(0, Number(correct))
    : Math.round((pct / 100) * items);

  const dif  = DIFF_WEIGHT[difficulty] || 1;
  const prec = precisionMult(pct);
  const rep  = repeatFactor(attempts);

  let xp = Math.round(XP_PER_CORRECT * ok * dif * prec * rep);
  xp = Math.min(XP_MAX_PER_TEST, xp);

  // Materialele fără chei citibile (teste încărcate manual) se salvează cu
  // scorul trimis de browser — deci un POST fabricat ar putea cere 100%.
  // Scorul rămâne, dar XP-ul e mult redus și plafonat, ca gamificarea să nu
  // devină motivul de a falsifica rezultate.
  if (!verified) xp = Math.min(UNVERIFIED_MAX_XP, Math.round(xp * UNVERIFIED_FACTOR));

  // Bonus de PROGRES: ai reluat exercițiul și te-ai îmbunătățit cu 20+ puncte
  // procentuale. Fără el, penalizarea de reluare ar descuraja exact elevul care
  // se întoarce ca să înțeleagă.
  let bonusProgres = 0;
  if (prevPct != null && pct - prevPct >= 20) bonusProgres = 15;

  return {
    xp: Math.max(0, xp + bonusProgres),
    pct: Math.round(pct),
    detalii: { corecte: ok, itemi: items, dificultate: difficulty, w_dificultate: dif, w_precizie: prec, w_reluare: Math.round(rep * 100) / 100, bonus_progres: bonusProgres, verificat: !!verified },
  };
}

function levelOf(totalXp) {
  const xp = Math.max(0, Number(totalXp) || 0);
  let i = 0;
  for (let k = 0; k < LEVELS.length; k++) if (xp >= LEVELS[k].min) i = k;
  const next = LEVELS[i + 1] || null;
  return {
    level: i + 1,
    name: LEVELS[i].name,
    xpStart: LEVELS[i].min,
    xpNext: next ? next.min : null,
    progressPct: next ? Math.round(((xp - LEVELS[i].min) / (next.min - LEVELS[i].min)) * 100) : 100,
  };
}

const tierInfo = (t) => TIERS[Math.max(1, Math.min(MAX_TIER, Number(t) || 1))];

// ─── Misiunea zilei ─────────────────────────────────────────────────────────
// Rotație deterministă pe zi: același elev primește același tip într-o zi,
// dar tipul se schimbă de la o zi la alta.
const MISSION_KINDS = [
  { kind: 'corecte',  target: 8,   label: 'Rezolvă corect 8 itemi astăzi' },
  { kind: 'xp',       target: 100, label: 'Adună 100 XP astăzi' },
  { kind: 'precizie', target: 2,   label: 'Obține minim 80% la 2 exerciții' },
];

function missionForDay(day) {
  const idx = Math.abs(daysBetween('2026-01-05', day)) % MISSION_KINDS.length; // 5 ian 2026 = luni
  return MISSION_KINDS[idx];
}

async function ensureMission(supa, userId, day) {
  const { data: existing } = await supa.from('daily_missions')
    .select('*').eq('user_id', userId).eq('day', day).maybeSingle();
  if (existing) return existing;
  const m = missionForDay(day);
  const row = { user_id: userId, day, kind: m.kind, label: m.label, target: m.target };
  const { data, error } = await supa.from('daily_missions').insert(row).select().maybeSingle();
  if (error || !data) { // curse între două cereri simultane → recitim
    const { data: again } = await supa.from('daily_missions')
      .select('*').eq('user_id', userId).eq('day', day).maybeSingle();
    return again || null; // fără `id` nu putem urmări progresul → nicio misiune
  }
  return data;
}

// ─── Statistici ─────────────────────────────────────────────────────────────
async function ensureStats(supa, userId) {
  const { data } = await supa.from('user_stats').select('*').eq('user_id', userId).maybeSingle();
  if (data) return data;
  const { data: created } = await supa.from('user_stats').insert({ user_id: userId }).select().maybeSingle();
  if (created) return created;
  // insert eșuat = rândul a apărut între timp (altă cerere) SAU tabela lipsește
  const { data: again } = await supa.from('user_stats').select('*').eq('user_id', userId).maybeSingle();
  return again || {
    user_id: userId, total_xp: 0, coins: 0, streak_current: 0, streak_best: 0,
    streak_day: null, freezes: 0, league_tier: 1,
  };
}

// ─── Liga ───────────────────────────────────────────────────────────────────
async function ensureStanding(supa, userId, tier, week = weekStart()) {
  const { data, error } = await supa.rpc('league_join', {
    p_user: userId, p_week: week, p_tier: tier, p_size: COHORT_SIZE,
  });
  if (error) return null;
  return Array.isArray(data) ? data[0] : data;
}

// ─── Acordarea XP ───────────────────────────────────────────────────────────
// Punctul de intrare unic. Îl apelează api/ai-score.js (și, mai târziu,
// duelurile / temele). Nu aruncă niciodată: gamificarea nu are voie să strice
// salvarea scorului.
async function award(supa, userId, opts = {}) {
  const {
    source = 'interactive', refId = null, content = null,
    score = 0, maxScore = 100, correct = null, total = null,
    attempts = 1, prevPct = null, verified = true, meta = {},
  } = opts;

  try {
    const day = dayKey();
    const stats = await ensureStats(supa, userId);
    const difficulty = difficultyOf(content);
    const calc = computeXp({ score, maxScore, correct, total, attempts, difficulty, prevPct, verified });
    if (calc.xp <= 0) return null;

    // ── plafonul zilnic al punctelor de ligă ──
    const { data: todays } = await supa.from('xp_events')
      .select('xp, league_pts').eq('user_id', userId).eq('day', day);
    const usedLeague = (todays || []).reduce((s, r) => s + (r.league_pts || 0), 0);
    const xpToday0   = (todays || []).reduce((s, r) => s + (r.xp || 0), 0);
    const room = Math.max(0, LEAGUE_DAILY_CAP - usedLeague);
    const leaguePts = Math.min(calc.xp, room);

    await supa.from('xp_events').insert({
      user_id: userId, day, source, ref_id: refId,
      xp: calc.xp, league_pts: leaguePts,
      meta: { ...calc.detalii, pct: calc.pct, ...meta },
    });

    let xpTotalAzi = xpToday0 + calc.xp;
    let xpAcordat = calc.xp;
    let leagueTotal = leaguePts;
    let coins = stats.coins || 0;

    // ── misiunea zilei ──
    let mission = await ensureMission(supa, userId, day);
    let missionDone = false;
    if (mission && mission.id && !mission.done) {
      const inc = mission.kind === 'corecte' ? (calc.detalii.corecte || 0)
        : mission.kind === 'xp' ? calc.xp
          : (calc.pct >= 80 ? 1 : 0);
      const progress = Math.min(mission.target, (mission.progress || 0) + inc);
      const done = progress >= mission.target;
      // `.eq('done', false)` + `select()`: dacă două exerciții sunt trimise în
      // același timp, doar UNUL primește rândul înapoi → recompensa se dă o
      // singură dată (Postgres reevaluează condiția după blocarea rândului).
      const { data: upd } = await supa.from('daily_missions')
        .update({ progress, done, done_at: done ? new Date().toISOString() : null })
        .eq('id', mission.id).eq('done', false).select();
      const amCastigat = Array.isArray(upd) && upd.length > 0;
      mission = { ...mission, progress, done };

      if (done && amCastigat) {
        missionDone = true;
        const bonus = mission.reward_xp || 50;
        const room2 = Math.max(0, LEAGUE_DAILY_CAP - usedLeague - leaguePts);
        const bonusLeague = Math.min(bonus, room2);
        await supa.from('xp_events').insert({
          user_id: userId, day, source: 'misiune', ref_id: null,
          xp: bonus, league_pts: bonusLeague, meta: { misiune: mission.kind },
        });
        xpAcordat += bonus;
        xpTotalAzi += bonus;
        leagueTotal += bonusLeague;
        coins += mission.reward_coins || 10;
      }
    }

    // ── streak: ziua contează dacă ai strâns cel puțin STREAK_MIN_XP ──
    let streak = stats.streak_current || 0;
    let streakBest = stats.streak_best || 0;
    let streakDay = stats.streak_day || null;
    let freezes = stats.freezes || 0;
    let streakUp = false;
    if (xpTotalAzi >= STREAK_MIN_XP && streakDay !== day) {
      const gap = streakDay ? daysBetween(streakDay, day) : null;
      if (gap === 1) streak += 1;
      else if (gap === 2 && freezes > 0) { freezes -= 1; streak += 1; } // scutul acoperă o zi ratată
      else streak = 1;
      streakDay = day;
      streakUp = true;
      if (streak > streakBest) streakBest = streak;
      if (streak > 0 && streak % 7 === 0 && freezes < MAX_FREEZES) freezes += 1; // 7 zile → un scut
    }

    // ── liga ──
    let standing = null;
    if (leagueTotal > 0) {
      standing = await ensureStanding(supa, userId, stats.league_tier || 1);
      if (standing) {
        // incrementare ATOMICĂ: două exerciții trimise în același timp nu se anulează
        const { data: pts, error: e1 } = await supa.rpc('league_add', { p_standing: standing.id, p_points: leagueTotal });
        if (e1) { // migrarea cu funcțiile atomice nu e rulată încă
          await supa.from('league_standings')
            .update({ points: (standing.points || 0) + leagueTotal, updated_at: new Date().toISOString() })
            .eq('id', standing.id);
          standing = { ...standing, points: (standing.points || 0) + leagueTotal };
        } else {
          standing = { ...standing, points: Number(pts) || ((standing.points || 0) + leagueTotal) };
        }
      }
    }

    // ── totaluri (XP + monede: incrementare atomică) ──
    const coinsDelta = coins - (stats.coins || 0);
    let totalXp = (stats.total_xp || 0) + xpAcordat;
    const { data: bumped, error: e2 } = await supa.rpc('xp_bump', { p_user: userId, p_xp: xpAcordat, p_coins: coinsDelta });
    const bumpedRow = Array.isArray(bumped) ? bumped[0] : bumped;
    if (!e2 && bumpedRow) totalXp = bumpedRow.total_xp;
    else await supa.from('user_stats').update({ total_xp: totalXp, coins }).eq('user_id', userId);

    // seria de zile se scrie separat (un singur scriitor per elev per zi);
    // upsert, ca să funcționeze și dacă rândul din user_stats nu exista încă
    await supa.from('user_stats').upsert({
      user_id: userId,
      streak_current: streak, streak_best: streakBest, streak_day: streakDay, freezes,
      updated_at: new Date().toISOString(),
    }, { onConflict: 'user_id' });

    const levelBefore = levelOf(stats.total_xp || 0);
    const level = levelOf(totalXp);

    return {
      xp: xpAcordat,
      xpExercitiu: calc.xp,
      leaguePts: leagueTotal,
      plafonAtins: leaguePts < calc.xp,
      totalXp,
      level,
      nivelNou: level.level > levelBefore.level ? level : null,
      streak, streakUp, freezes,
      coins,
      misiune: mission ? { label: mission.label, progress: mission.progress, target: mission.target, done: mission.done, tocmaiFinalizata: missionDone } : null,
      liga: standing ? { tier: standing.tier, ...tierInfo(standing.tier), puncte: standing.points } : null,
      detalii: calc.detalii,
    };
  } catch (e) {
    console.warn('xp.award:', e?.message || e);
    return null; // gamificarea nu blochează niciodată salvarea scorului
  }
}

// ─── XP „de eveniment" (duel câștigat, loc în turneu, capitol stăpânit) ─────
// Nu vine dintr-un exercițiu, deci nu trece prin formulă. Respectă totuși
// plafonul zilnic al ligii, ca un turneu să nu poată sări peste el.
async function bonus(supa, userId, { source = 'bonus', refId = null, xp: amount = 0, coins = 0, meta = {}, league = true } = {}) {
  try {
    const suma = Math.max(0, Math.round(Number(amount) || 0));
    const monede = Math.max(0, Math.round(Number(coins) || 0));
    if (suma <= 0 && monede <= 0) return null;

    const day = dayKey();
    const stats = await ensureStats(supa, userId);

    let leaguePts = 0;
    if (league && suma > 0) {
      const { data: todays } = await supa.from('xp_events')
        .select('league_pts').eq('user_id', userId).eq('day', day);
      const used = (todays || []).reduce((s, r) => s + (r.league_pts || 0), 0);
      leaguePts = Math.max(0, Math.min(suma, LEAGUE_DAILY_CAP - used));
    }

    await supa.from('xp_events').insert({
      user_id: userId, day, source, ref_id: refId, xp: suma, league_pts: leaguePts, meta,
    });

    let totalXp = (stats.total_xp || 0) + suma;
    const { data: bumped, error } = await supa.rpc('xp_bump', { p_user: userId, p_xp: suma, p_coins: monede });
    const row = Array.isArray(bumped) ? bumped[0] : bumped;
    if (!error && row) totalXp = row.total_xp;
    else await supa.from('user_stats').update({ total_xp: totalXp, coins: (stats.coins || 0) + monede }).eq('user_id', userId);

    if (leaguePts > 0) {
      const standing = await ensureStanding(supa, userId, stats.league_tier || 1);
      if (standing) {
        const { error: e1 } = await supa.rpc('league_add', { p_standing: standing.id, p_points: leaguePts });
        if (e1) {
          await supa.from('league_standings')
            .update({ points: (standing.points || 0) + leaguePts, updated_at: new Date().toISOString() })
            .eq('id', standing.id);
        }
      }
    }

    return { xp: suma, coins: monede, leaguePts, totalXp, level: levelOf(totalXp) };
  } catch (e) {
    console.warn('xp.bonus:', e?.message || e);
    return null;
  }
}

module.exports = {
  // constante
  XP_PER_CORRECT, XP_MAX_PER_TEST, LEAGUE_DAILY_CAP, STREAK_MIN_XP, COHORT_SIZE,
  UNVERIFIED_FACTOR, UNVERIFIED_MAX_XP,
  PROMOTE_TOP, DEMOTE_BOTTOM, DEMOTE_MIN_MEMBERS, MAX_TIER, LEVELS, TIERS,
  // pure (testabile)
  dayKey, addDays, daysBetween, weekStart, difficultyOf, precisionMult, repeatFactor,
  computeXp, levelOf, tierInfo, missionForDay,
  // cu baza de date
  ensureStats, ensureMission, ensureStanding, award, bonus,
};
