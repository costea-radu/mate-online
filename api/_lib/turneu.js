// =====================================================================
// api/_lib/turneu.js — turneele de grupă (pasul 4 din gamificare)
//
// Profesorul deschide un turneu pe una dintre grupele lui: un set de
// exerciții + o fereastră de timp. Elevii din grupă NU se înscriu — rezolvă
// exercițiile normal, iar punctajul intră singur (prima rezolvare contează).
//
// Punctajul unui exercițiu = XP-ul ponderat calculat oricum la salvarea
// scorului (corecte × dificultate × precizie), deci nu premiază volumul.
//
// Tabele: supabase/gamificare_v4_turnee.sql
// =====================================================================
const xp = require('./xp');
const ai = require('./ai');
const http = require('./http');

const PREMII = [120, 70, 40];        // XP pentru locurile 1-3
const PREMII_MONEDE = [30, 20, 10];
const MAX_EXERCITII = 20;
const MAX_ZILE = 30;
const AUTO_EXERCITII = 8;     // câte exerciții pune turneul public automat
const AUTO_ZILE = 7;

// Grupele în care e elevul (mentor_students.group_id, mentor_role='profesor')
async function grupeleElevului(supa, userId) {
  const { data } = await supa.from('mentor_students')
    .select('group_id').eq('student_id', userId).eq('mentor_role', 'profesor').not('group_id', 'is', null);
  return [...new Set((data || []).map((r) => r.group_id))];
}

async function membriiGrupei(supa, groupId) {
  const { data } = await supa.from('mentor_students')
    .select('student_id').eq('group_id', groupId).eq('mentor_role', 'profesor');
  return [...new Set((data || []).map((r) => r.student_id))];
}

// Cine „participă" la un turneu: la cele de grupă, membrii grupei; la cele
// publice, doar cei ÎNSCRIȘI (altfel clasamentul ar fi plin de elevi care nici
// n-au știut că participă).
async function participanti(supa, t) {
  if (t.scope === 'public') {
    const { data } = await supa.from('tournament_entries')
      .select('user_id').eq('tournament_id', t.id);
    return [...new Set((data || []).map((r) => r.user_id))];
  }
  return t.group_id ? await membriiGrupei(supa, t.group_id) : [];
}

async function inscrierileMele(supa, userId) {
  const { data } = await supa.from('tournament_entries')
    .select('tournament_id').eq('user_id', userId);
  return [...new Set((data || []).map((r) => r.tournament_id))];
}

async function join(supa, userId, id) {
  const { data: t } = await supa.from('tournaments').select('*').eq('id', id).maybeSingle();
  if (!t) return { error: 'Turneul nu există.' };
  if (t.scope !== 'public') return { error: 'La turneele de grupă participi automat, nu prin înscriere.' };
  if (t.status !== 'activ' || t.ends_at < new Date().toISOString()) return { error: 'Turneul s-a încheiat.' };
  await supa.from('tournament_entries').upsert(
    { tournament_id: id, user_id: userId }, { onConflict: 'tournament_id,user_id' },
  );
  return { ok: true };
}

// ─── Punctarea automată la salvarea unui scor ───────────────────────────────
// Apelat din api/ai-score.js. Nu aruncă niciodată.
async function recordScore(supa, userId, contentId, { points, pct }) {
  try {
    if (!contentId || !(points > 0)) return null;
    const [grupe, inscrieri] = await Promise.all([
      grupeleElevului(supa, userId),
      inscrierileMele(supa, userId),
    ]);
    if (!grupe.length && !inscrieri.length) return null;

    const acum = new Date().toISOString();
    const { data: items } = await supa.from('tournament_items')
      .select('tournament_id, tournament:tournament_id ( id, title, group_id, scope, status, starts_at, ends_at )')
      .eq('content_id', contentId);

    const potrivite = (items || [])
      .map((i) => i.tournament)
      .filter((t) => t && t.status === 'activ' && t.starts_at <= acum && t.ends_at >= acum
        && (t.scope === 'public' ? inscrieri.includes(t.id) : grupe.includes(t.group_id)));
    if (!potrivite.length) return null;

    const intrate = [];
    for (const t of potrivite) {
      // Pe un material contează CEL MAI BUN punctaj al elevului: altfel o
      // salvare parțială (elevul era la jumătate) i-ar bloca definitiv un
      // rezultat slab, iar reluarea exercițiului n-ar mai folosi la nimic.
      // Rândul rămâne unic per (turneu, elev, material), deci nu se poate
      // aduna la nesfârșit din același exercițiu.
      const puncte = Math.round(points);
      const { data: vechi } = await supa.from('tournament_scores')
        .select('id, points').eq('tournament_id', t.id).eq('user_id', userId).eq('content_id', contentId)
        .maybeSingle();
      if (vechi) {
        if ((vechi.points || 0) >= puncte) continue;
        const { error } = await supa.from('tournament_scores')
          .update({ points: puncte, pct: Math.round(pct || 0) }).eq('id', vechi.id);
        if (!error) intrate.push({ id: t.id, titlu: t.title, puncte });
        continue;
      }
      const { error } = await supa.from('tournament_scores').insert({
        tournament_id: t.id, user_id: userId, content_id: contentId,
        points: puncte, pct: Math.round(pct || 0),
      });
      if (!error) intrate.push({ id: t.id, titlu: t.title, puncte });
    }
    return intrate.length ? intrate : null;
  } catch (e) {
    console.warn('turneu.recordScore:', e?.message || e);
    return null;
  }
}

// ─── Clasamentul unui turneu ────────────────────────────────────────────────
async function clasament(supa, t, userId = null) {
  const scores = await http.allRows((from, to) => supa.from('tournament_scores')
    .select('user_id, points, pct').eq('tournament_id', t.id).range(from, to));
  const membri = await participanti(supa, t);

  const acc = {};
  for (const m of membri) acc[m] = { user_id: m, puncte: 0, exercitii: 0, medie: 0, sumaPct: 0 };
  for (const s of scores) {
    const a = acc[s.user_id] || (acc[s.user_id] = { user_id: s.user_id, puncte: 0, exercitii: 0, medie: 0, sumaPct: 0 });
    a.puncte += s.points || 0;
    a.exercitii += 1;
    a.sumaPct += s.pct || 0;
  }
  const ids = Object.keys(acc);
  const { data: profs } = ids.length
    ? await supa.from('profiles').select('id, full_name').in('id', ids)
    : { data: [] };
  const nume = {};
  (profs || []).forEach((p) => {
    const s = String(p.full_name || '').trim().replace(/\s+/g, ' ');
    const parti = s ? s.split(' ') : [];
    nume[p.id] = parti.length > 1 ? `${parti[0]} ${parti[parti.length - 1][0].toUpperCase()}.` : (parti[0] || 'Elev');
  });

  return Object.values(acc)
    .map((a) => ({ ...a, medie: a.exercitii ? Math.round(a.sumaPct / a.exercitii) : 0 }))
    .sort((a, b) => (b.puncte - a.puncte) || (b.medie - a.medie))
    .map((a, i) => ({
      loc: i + 1,
      user_id: a.user_id,                       // intern (premii); nu pleacă spre client
      nume: a.user_id === userId ? 'Tu' : (nume[a.user_id] || 'Elev'),
      eu: a.user_id === userId,
      puncte: a.puncte, exercitii: a.exercitii, medie: a.medie,
    }));
}

// ─── Ce turnee văd eu ───────────────────────────────────────────────────────
async function list(supa, userId, { isTeacher = false } = {}) {
  const [grupe, inscrieri] = await Promise.all([
    grupeleElevului(supa, userId),
    inscrierileMele(supa, userId),
  ]);
  const acum = new Date().toISOString();

  // Turneele DE GRUPĂ: descrescător după final, ca cele curente să fie primele.
  const deGrupa = [];
  if (grupe.length || isTeacher) {
    let q = supa.from('tournaments').select('*').eq('scope', 'grupa')
      .order('ends_at', { ascending: false });
    if (isTeacher) {
      // profesorul își vede turneele lui + pe cele ale grupelor din care face parte
      q = grupe.length ? q.or(`owner_id.eq.${userId},group_id.in.(${grupe.join(',')})`) : q.eq('owner_id', userId);
    } else {
      q = q.in('group_id', grupe);
    }
    const { data } = await q.limit(20);
    deGrupa.push(...(data || []));
  }

  // Turneele PUBLICE active se văd de oricine; înscrierea e separată.
  const { data: publice } = await supa.from('tournaments')
    .select('*').eq('scope', 'public').eq('status', 'activ').gte('ends_at', acum)
    .order('ends_at', { ascending: false }).limit(10);

  const turnee = [];
  for (const t of [...deGrupa, ...(publice || [])]) {
    const activ = t.status === 'activ' && t.ends_at >= acum;
    const board = await clasament(supa, t, userId);
    const { data: items } = await supa.from('tournament_items')
      .select('content_id, title, position, content:content_id ( content_type )')
      .eq('tournament_id', t.id).order('position');
    turnee.push({
      id: t.id, titlu: t.title, mesaj: t.message, grupa: t.group_name,
      public: t.scope === 'public',
      inscris: t.scope === 'public' ? inscrieri.includes(t.id) : true,
      participanti: board.length,
      organizator: t.owner_name, activ, incepe: t.starts_at, seIncheie: t.ends_at,
      exercitii: (items || []).map((i) => ({
        id: i.content_id, titlu: i.title, tip: i.content?.content_type || 'interactive',
      })),
      clasament: board.slice(0, 20).map(({ user_id: _uid, ...r }) => r),
      locMeu: (board.find((b) => b.eu) || {}).loc || null,
      alMeu: t.owner_id === userId,
    });
  }
  return { turnee };
}

// ─── Crearea (doar profesor/admin, pe grupele lui) ──────────────────────────
async function create(supa, userId, profile, { groupId, title, message, contentIds, zile, scope = 'grupa' }) {
  const lista = [...new Set((Array.isArray(contentIds) ? contentIds : []).filter(Boolean))].slice(0, MAX_EXERCITII);
  const public_ = scope === 'public';
  if (public_ && !profile.is_admin) return { error: 'Turneele publice se creează doar din contul de administrator.' };
  if (!public_ && !groupId) return { error: 'Alege grupa.' };
  if (!lista.length) return { error: 'Alege cel puțin un exercițiu.' };

  let grupa = null;
  if (!public_) {
    const { data } = await supa.from('mentor_groups').select('id, name, teacher_id').eq('id', groupId).maybeSingle();
    grupa = data;
    if (!grupa) return { error: 'Grupa nu există.' };
    if (grupa.teacher_id !== userId && !profile.is_admin) return { error: 'Poți crea turnee doar pe grupele tale.' };
  }

  const nrZile = Math.max(1, Math.min(MAX_ZILE, parseInt(zile, 10) || 7));
  const { data: mat } = await supa.from('content')
    .select('id, title, content_type').in('id', lista).in('content_type', ['interactive', 'pdf']);
  if (!mat || !mat.length) return { error: 'Materialele alese nu pot fi punctate (doar exerciții interactive sau teste PDF).' };

  // requireUser nu întoarce `full_name` — îl citim separat, altfel organizatorul
  // ar rămâne mereu null în clasament.
  const { data: eu } = await supa.from('profiles').select('full_name').eq('id', userId).maybeSingle();

  const { data: t, error } = await supa.from('tournaments').insert({
    owner_id: userId,
    owner_name: String(eu?.full_name || '').trim() || null,
    scope: public_ ? 'public' : 'grupa',
    group_id: grupa ? grupa.id : null, group_name: grupa ? grupa.name : null,
    title: String(title || (public_ ? 'Turneu public' : 'Turneu')).slice(0, 120),
    message: message ? String(message).slice(0, 400) : null,
    ends_at: new Date(Date.now() + nrZile * 86400000).toISOString(),
  }).select().maybeSingle();
  if (error) return { error: `Turneul nu s-a putut crea (${error.message}).` };

  await supa.from('tournament_items').insert(
    mat.map((c, i) => ({ tournament_id: t.id, content_id: c.id, title: c.title, position: i })),
  );

  // anunțăm elevii din grupă (la cele publice nu trimitem nimănui: turneul apare
  // în Arenă, iar o notificare către tot site-ul ar fi spam)
  const membri = grupa ? await membriiGrupei(supa, grupa.id) : [];
  for (const m of membri) {
    try {
      await ai.createNotification(supa, {
        recipientId: m, type: 'turneu',
        title: `Turneu nou: ${t.title}`,
        body: `${grupa ? grupa.name : 'Public'} · ${mat.length} ${mat.length === 1 ? 'exercițiu' : 'exerciții'} · ${nrZile} ${nrZile === 1 ? 'zi' : 'zile'}`,
        data: { tournamentId: t.id, url: '/arena' },
      });
    } catch { /* notificările nu blochează turneul */ }
  }

  return { ok: true, id: t.id };
}

async function close(supa, userId, profile, id) {
  const { data: t } = await supa.from('tournaments').select('*').eq('id', id).maybeSingle();
  if (!t) return { error: 'Turneul nu există.' };
  if (t.owner_id !== userId && !profile.is_admin) return { error: 'Doar organizatorul poate încheia turneul.' };
  await supa.from('tournaments').update({ status: 'incheiat', ends_at: new Date().toISOString() }).eq('id', id);
  return { ok: true };
}

// ─── Cron: închiderea turneelor expirate + premiile ─────────────────────────
async function finalizeExpired(supa) {
  const acum = new Date().toISOString();
  const { data } = await supa.from('tournaments')
    .select('*').eq('awarded', false).or(`status.eq.incheiat,ends_at.lt.${acum}`).limit(50);

  const raport = [];
  for (const t of data || []) {
    const board = await clasament(supa, t);
    const premiati = board.filter((b) => b.puncte > 0).slice(0, PREMII.length);

    const locuri = board.filter((b) => b.user_id).map((b) => ({
      tournament_id: t.id, user_id: b.user_id, place: b.loc, points: b.puncte,
    }));
    if (locuri.length) {
      await supa.from('tournament_places').upsert(locuri, { onConflict: 'tournament_id,user_id' });
    }

    for (let i = 0; i < premiati.length; i++) {
      const uid = premiati[i].user_id;
      if (!uid) continue;
      await xp.bonus(supa, uid, {
        source: 'turneu', refId: t.id, xp: PREMII[i], coins: PREMII_MONEDE[i],
        meta: { turneu: t.title, loc: i + 1 },
      });
      try {
        await ai.createNotification(supa, {
          recipientId: uid, type: 'turneu',
          title: `Locul ${i + 1} în „${t.title}"`,
          body: `+${PREMII[i]} XP · +${PREMII_MONEDE[i]} monede`,
          data: { tournamentId: t.id, url: '/arena' },
        });
      } catch { /* ignorăm */ }
    }

    await supa.from('tournaments').update({ status: 'incheiat', awarded: true }).eq('id', t.id);
    raport.push({ turneu: t.title, participanti: board.length, premiati: premiati.length });
  }
  return { ok: true, inchise: raport.length, raport };
}

// ─── „Turneul săptămânii" — creat automat de cron, deschis oricui ───────────
// Rulează la fiecare tic: dacă există deja un turneu public automat activ, nu
// face nimic. Alege exerciții GRATUITE, ca să poată participa și conturile
// fără abonament (turneul e și cârlig de conversie, nu doar joc).
async function ensureWeeklyPublic(supa) {
  const acum = new Date().toISOString();
  const { data: existent } = await supa.from('tournaments')
    .select('id').eq('scope', 'public').eq('auto', true).eq('status', 'activ')
    .gte('ends_at', acum).limit(1);
  if (existent && existent.length) return { creat: false };

  const { data: mat } = await supa.from('content')
    .select('id, title, category, content_type')
    .in('content_type', ['interactive', 'pdf'])
    .eq('is_free', true)
    .order('sort_order', { ascending: true })
    .limit(120);
  if (!mat || mat.length < 3) return { creat: false, motiv: 'prea puține materiale gratuite' };

  // câte unul din fiecare categorie, pe rând, ca turneul să nu fie tot dintr-o clasă
  const peCategorie = {};
  for (const m of mat) (peCategorie[m.category || 'altele'] = peCategorie[m.category || 'altele'] || []).push(m);
  const alese = [];
  const chei = Object.keys(peCategorie);
  for (let i = 0; alese.length < AUTO_EXERCITII && i < 20; i++) {
    for (const k of chei) {
      const m = peCategorie[k][i];
      if (m) alese.push(m);
      if (alese.length >= AUTO_EXERCITII) break;
    }
  }
  if (!alese.length) return { creat: false };

  const saptamana = new Date().toLocaleDateString('ro-RO', { day: 'numeric', month: 'long' });
  const { data: t, error } = await supa.from('tournaments').insert({
    owner_id: null, owner_name: 'ExamenMate', scope: 'public', auto: true,
    title: `Turneul săptămânii · ${saptamana}`,
    message: 'Deschis oricui de pe site. Înscrie-te și rezolvă exercițiile din listă.',
    ends_at: new Date(Date.now() + AUTO_ZILE * 86400000).toISOString(),
  }).select().maybeSingle();
  if (error || !t) return { creat: false, motiv: error?.message };

  await supa.from('tournament_items').insert(
    alese.map((c, i) => ({ tournament_id: t.id, content_id: c.id, title: c.title, position: i })),
  );
  return { creat: true, id: t.id, exercitii: alese.length };
}

module.exports = {
  PREMII, PREMII_MONEDE, MAX_EXERCITII, MAX_ZILE,
  AUTO_EXERCITII, AUTO_ZILE,
  grupeleElevului, membriiGrupei, participanti, inscrierileMele, join, clasament,
  recordScore, list, create, close, finalizeExpired, ensureWeeklyPublic,
};
