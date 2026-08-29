// =====================================================================
// api/harta.js — HARTA CAPITOLELOR (pasul 5 din gamificare)
//
// POST /api/harta { action }
//   state   → { categorie, capitole[] } pentru o clasă/examen
//             { id, titlu, exercitii[], rezolvate, stapanit, blocat, procent }
//   unlock  → { chapterId } — „știu deja, sar peste" (deblochează fără XP)
//
// Deblocarea se face pe STĂPÂNIRE, nu pe număr de exerciții: treci mai
// departe când ai ≥70% la cel puțin două exerciții din capitol (sau la toate,
// dacă are mai puține). Primul capitol e mereu deschis, iar un capitol în care
// elevul lucrase deja înainte de hartă rămâne deschis.
//
// Legătura material → capitol se face o singură dată, prin clasificarea
// titlului (api/_lib/taxonomy.js), și se salvează în content.chapter_id.
// Tabele: supabase/gamificare_v5_harta.sql
// =====================================================================
const ai = require('./_lib/ai');
const http = require('./_lib/http');
const xp = require('./_lib/xp');
const taxonomy = require('./_lib/taxonomy');

const PRAG_PCT = 70;          // sub atât, exercițiul nu contează ca stăpânit
const TINTA_EXERCITII = 2;    // câte exerciții „bune" cere un capitol
const XP_CAPITOL = 80;        // bonus la stăpânirea unui capitol
const MONEDE_CAPITOL = 20;

const CATEGORII = {
  'clasa-5': 5, 'clasa-6': 6, 'clasa-7': 7, 'clasa-8': 8,
  'clasa-9': 9, 'clasa-10': 10, 'clasa-11': 11, 'clasa-12': 12,
};

// Capitolele unei categorii, în ordinea programei.
function capitoleleCategoriei(categorie) {
  if (categorie === 'evaluare-nationala') {
    return taxonomy.CHAPTERS.filter((c) => c.grade >= 5 && c.grade <= 8);
  }
  if (categorie === 'bacalaureat') {
    return taxonomy.CHAPTERS.filter((c) => c.grade >= 9 && c.grade <= 12);
  }
  const g = CATEGORII[categorie];
  return g ? taxonomy.CHAPTERS.filter((c) => c.grade === g) : [];
}

// Materialele categoriei, cu capitolul completat (o singură dată) prin clasificare.
async function materiale(supa, categorie) {
  const { data } = await supa.from('content')
    .select('id, title, description, category, is_free, chapter_id, sort_order')
    .eq('content_type', 'interactive')
    .eq('category', categorie)
    .order('sort_order', { ascending: true })
    .limit(300);

  const lista = data || [];
  const deSalvat = [];
  for (const c of lista) {
    if (c.chapter_id) continue;
    const rez = taxonomy.classify(`${c.title || ''} ${c.description || ''}`, categorie);
    if (rez && rez.chapterId) {
      c.chapter_id = rez.chapterId;
      deSalvat.push({ id: c.id, chapter_id: rez.chapterId });
    }
  }
  // Scriem înapoi clasificările noi — grupat pe capitol (o cerere per capitol,
  // nu una per material) și cel mult 60 per cerere, ca prima deschidere a unei
  // categorii să nu declanșeze sute de scrieri. Restul se completează la
  // următoarea vizită.
  const peCapitol = {};
  for (const r of deSalvat.slice(0, 60)) (peCapitol[r.chapter_id] = peCapitol[r.chapter_id] || []).push(r.id);
  for (const [cap, ids] of Object.entries(peCapitol)) {
    await supa.from('content').update({ chapter_id: cap }).in('id', ids);
  }
  return lista;
}

async function state(supa, userId, categorie) {
  const capitole = capitoleleCategoriei(categorie);
  if (!capitole.length) return { ok: true, categorie, capitole: [] };

  const mats = await materiale(supa, categorie);
  const prog = await http.allRows((from, to) => supa.from('progress')
    .select('content_id, score, max_score').eq('user_id', userId).range(from, to));
  const scorPe = {};
  for (const p of prog) {
    scorPe[p.content_id] = p.max_score > 0 ? Math.round((p.score / p.max_score) * 100) : 0;
  }

  const { data: stari } = await supa.from('chapter_state')
    .select('*').eq('user_id', userId);
  const stare = Object.fromEntries((stari || []).map((s) => [s.chapter_id, s]));

  const out = [];
  let precedentStapanit = true;   // primul capitol e mereu deschis
  const deMarcat = [];

  for (const cap of capitole) {
    const ale = mats.filter((m) => m.chapter_id === cap.id);
    const rezolvate = ale.filter((m) => scorPe[m.id] != null);
    const bune = rezolvate.filter((m) => scorPe[m.id] >= PRAG_PCT);
    const tinta = Math.max(1, Math.min(TINTA_EXERCITII, ale.length || TINTA_EXERCITII));
    const medie = rezolvate.length
      ? Math.round(rezolvate.reduce((s, m) => s + scorPe[m.id], 0) / rezolvate.length)
      : 0;
    const stapanit = ale.length > 0 && bune.length >= tinta && medie >= PRAG_PCT;

    const st = stare[cap.id];
    const lucratAici = rezolvate.length > 0;      // a intrat aici înainte de hartă
    const blocat = !(precedentStapanit || st?.unlocked || lucratAici);

    if (stapanit && !st?.mastered_at) deMarcat.push(cap.id);

    out.push({
      id: cap.id,
      titlu: cap.title,
      clasa: cap.grade,
      total: ale.length,
      rezolvate: rezolvate.length,
      bune: bune.length,
      tinta,
      medie,
      stapanit,
      blocat,
      sarit: !!st?.unlocked,
      procent: ale.length ? Math.min(100, Math.round((bune.length / tinta) * 100)) : 0,
      exercitii: ale.slice(0, 12).map((m) => ({
        id: m.id, titlu: m.title, gratuit: !!m.is_free, scor: scorPe[m.id] ?? null,
      })),
    });

    // Lanțul de deblocare: pe lângă capitolele stăpânite, nu blochează nici
    // capitolele SĂRITE manual, nici cele care n-au încă niciun exercițiu —
    // altfel harta se oprea definitiv la prima gaură din conținut.
    precedentStapanit = stapanit || !!st?.unlocked || ale.length === 0;
  }

  // capitolele proaspăt stăpânite: marcăm și dăm bonusul o singură dată
  const premii = [];
  const acum = new Date().toISOString();
  for (const id of deMarcat) {
    // Rândul întâi (fără să atingem `awarded`), apoi un UPDATE CONDIȚIONAT:
    // `.eq('awarded', false).select()` — la două cereri simultane, doar una
    // primește rândul înapoi, deci bonusul se dă o singură dată.
    await supa.from('chapter_state').upsert(
      { user_id: userId, chapter_id: id, updated_at: acum },
      { onConflict: 'user_id,chapter_id', ignoreDuplicates: true },
    );
    const { data: castigat } = await supa.from('chapter_state')
      .update({ mastered_at: acum, awarded: true, updated_at: acum })
      .eq('user_id', userId).eq('chapter_id', id).eq('awarded', false)
      .select();
    if (Array.isArray(castigat) && castigat.length) {
      await xp.bonus(supa, userId, {
        source: 'capitol', xp: XP_CAPITOL, coins: MONEDE_CAPITOL, meta: { capitol: id },
      });
      premii.push(id);
    }
  }

  return { ok: true, categorie, capitole: out, premii, prag: PRAG_PCT, xpCapitol: XP_CAPITOL };
}

async function unlock(supa, userId, chapterId) {
  if (!chapterId) return { error: 'Lipsește capitolul.' };
  const cunoscut = taxonomy.CHAPTERS.some((c) => c.id === chapterId);
  if (!cunoscut) return { error: 'Capitol necunoscut.' };
  await supa.from('chapter_state').upsert({
    user_id: userId, chapter_id: chapterId, unlocked: true, updated_at: new Date().toISOString(),
  }, { onConflict: 'user_id,chapter_id' });
  return { ok: true };
}

module.exports = async function handler(req, res) {
  ai.applyCors(res);
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method Not Allowed' });

  const supa = ai.admin();
  try {
    const userId = await ai.authUser(req, supa);
    await ai.requireUser(supa, userId);
    const action = String(req.body?.action || 'state');

    if (action === 'state') {
      const categorie = String(req.body?.categorie || 'clasa-8');
      return res.status(200).json(await state(supa, userId, categorie));
    }
    if (action === 'unlock') {
      const r = await unlock(supa, userId, req.body?.chapterId);
      if (r.error) return res.status(400).json(r);
      return res.status(200).json(r);
    }
    return res.status(400).json({ error: `Acțiune necunoscută: ${action}` });
  } catch (err) {
    console.error('harta error:', err);
    return res.status(err.status || 500).json({ error: err.message || 'Eroare server' });
  }
};

module.exports.capitoleleCategoriei = capitoleleCategoriei;
