// =====================================================================
// test/misiune-zilnica.test.js — cererea din 30 octombrie 2026 (2):
//   „în «arena matematică» fă misiune zilnică, la fel ca la duolingo:
//    rezolvarea unui exercițiu pe zi, cu progres. Exercițiile să fie preluate
//    din site, interactive, începând cu clasa a 5-a, până pe a 12-a. Pune
//    deasupra de «dueluri»."
//
// api/_lib/misiune.js (logica pură + cu Supabase simulat), api/gamificare.js
// (action 'misiune' / 'misiune_clasa'), api/ai-score.js (îndeplinirea, doar pe
// scorul verificat), migrarea SQL (GRANT-urile din CLAUDE.md) și pagina /arena.
// =====================================================================
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const xp = require('../api/_lib/xp');
const misiune = require('../api/_lib/misiune');
const ai = require('../api/_lib/ai');
const score = require('../api/_lib/score');
const { createFakeSupabase, fakeRes } = require('./tools/fakeSupabase');

const read = (f) => fs.readFileSync(path.join(__dirname, '..', f), 'utf8');
const U = '33333333-3333-3333-3333-333333333333';
const AZI = xp.dayKey();
const zi = (n) => xp.addDays(AZI, n);

// ─── Logica pură ────────────────────────────────────────────────────────────
test('clasele misiunii: de la a V-a la a XII-a; liceul și a VIII-a au rezervă (BAC / EN)', () => {
  assert.deepStrictEqual(misiune.CLASE.map((c) => c.nr), [5, 6, 7, 8, 9, 10, 11, 12]);
  assert.strictEqual(misiune.clasaValida('clasa-5'), true);
  assert.strictEqual(misiune.clasaValida('clasa-12'), true);
  assert.strictEqual(misiune.clasaValida('clasa-4'), false);
  assert.strictEqual(misiune.clasaValida('bacalaureat'), false, 'misiunea se alege pe clasă');
  assert.strictEqual(misiune.REZERVA['clasa-8'], 'evaluare-nationala');
  assert.strictEqual(misiune.REZERVA['clasa-11'], 'bacalaureat');
  assert.strictEqual(misiune.REZERVA['clasa-6'], undefined);
});

test('seria: zile consecutive până azi sau ieri; ziua ratată o rupe; recordul rămâne', () => {
  assert.deepStrictEqual(misiune.serie([], AZI), { curenta: 0, record: 0, total: 0, aziFacut: false });
  // azi încă nefăcută: seria de ieri e încă vie
  assert.strictEqual(misiune.serie([zi(-2), zi(-1)], AZI).curenta, 2);
  assert.strictEqual(misiune.serie([zi(-2), zi(-1), AZI], AZI).curenta, 3);
  assert.strictEqual(misiune.serie([zi(-2), zi(-1), AZI], AZI).aziFacut, true);
  // o zi ratată (alaltăieri) rupe seria
  assert.strictEqual(misiune.serie([zi(-5), zi(-4), zi(-3), zi(-1), AZI], AZI).curenta, 2);
  assert.strictEqual(misiune.serie([zi(-5), zi(-4), zi(-3), zi(-1), AZI], AZI).record, 3);
  // ieri și azi lipsesc → 0, dar totalul și recordul rămân
  const s = misiune.serie([zi(-10), zi(-9), zi(-3)], AZI);
  assert.strictEqual(s.curenta, 0);
  assert.strictEqual(s.record, 2);
  assert.strictEqual(s.total, 3);
  // zilele duplicate nu se numără de două ori
  assert.strictEqual(misiune.serie([AZI, AZI, zi(-1)], AZI).total, 2);
});

test('săptămâna: 7 zile de luni, cu făcut / azi / ratat / viitor', () => {
  const w = misiune.saptamana([zi(-1)], AZI);
  assert.strictEqual(w.length, 7);
  assert.deepStrictEqual(w.map((z) => z.label), ['L', 'M', 'M', 'J', 'V', 'S', 'D']);
  assert.strictEqual(w[0].day, xp.weekStart(new Date(`${AZI}T12:00:00Z`)), 'începe lunea');
  const aziZ = w.find((z) => z.day === AZI);
  assert.strictEqual(aziZ.stare, 'azi');
  for (const z of w) {
    if (z.day > AZI) assert.strictEqual(z.stare, 'viitor');
    if (z.day < AZI && z.day !== zi(-1)) assert.strictEqual(z.stare, 'ratat');
    if (z.day === zi(-1)) assert.strictEqual(z.stare, 'facut');
  }
  assert.strictEqual(misiune.saptamana([AZI], AZI).find((z) => z.day === AZI).stare, 'facut');
});

test('exercițiul zilei: întâi ce n-a făcut niciodată (în ordinea din site), apoi ce are sub 70%, apoi recapitulare', () => {
  const pool = [{ id: 'a' }, { id: 'b' }, { id: 'c' }, { id: 'd' }];
  assert.strictEqual(misiune.alegeExercitiul([], {}), null);
  assert.strictEqual(misiune.alegeExercitiul(pool, {}).id, 'a');
  // a rezolvat „a" (oriunde în site) și „b" i-a fost misiune → „c"
  assert.strictEqual(misiune.alegeExercitiul(pool, { progres: new Map([['a', 90]]), folosite: new Map([['b', zi(-3)]]) }).id, 'c');
  // toate făcute: primul sub 70%, dar nu cel de ieri
  const progres = new Map([['a', 95], ['b', 40], ['c', 55], ['d', 100]]);
  assert.strictEqual(misiune.alegeExercitiul(pool, { progres, ieri: 'b' }).id, 'c');
  assert.strictEqual(misiune.alegeExercitiul(pool, { progres }).id, 'b');
  // toate stăpânite: recapitulare — cel folosit cel mai demult (nu cel de ieri)
  const toate = new Map([['a', 90], ['b', 90], ['c', 90], ['d', 90]]);
  const folosite = new Map([['a', zi(-1)], ['b', zi(-20)], ['c', zi(-5)], ['d', zi(-9)]]);
  assert.strictEqual(misiune.alegeExercitiul(pool, { progres: toate, folosite, ieri: 'a' }).id, 'b');
  // un singur exercițiu, făcut ieri: tot el (altceva nu există)
  assert.strictEqual(misiune.alegeExercitiul([{ id: 'x' }], { progres: new Map([['x', 90]]), ieri: 'x' }).id, 'x');
});

test('drumul clasei și recompensa (bază, „perfect", bonusul de serie la 7 / 14 zile)', () => {
  const d = misiune.drum([{ id: 'a' }, { id: 'b' }, { id: 'c' }, { id: 'd' }], new Map([['a', 50], ['b', 49], ['c', 100]]));
  assert.deepStrictEqual(d, { parcurse: 2, total: 4, pct: 50 });
  assert.deepStrictEqual(misiune.drum([], new Map()), { parcurse: 0, total: 0, pct: 0 });
  assert.deepStrictEqual(misiune.recompensa(60, 3), { xp: 20, coins: 5, perfect: false, bonusSerie: false });
  assert.deepStrictEqual(misiune.recompensa(95, 3), { xp: 30, coins: 5, perfect: true, bonusSerie: false });
  assert.deepStrictEqual(misiune.recompensa(70, 7), { xp: 50, coins: 15, perfect: false, bonusSerie: true });
  assert.strictEqual(misiune.recompensa(100, 14).xp, 60);
});

// ─── Cu Supabase simulat ────────────────────────────────────────────────────
function baza(extra = {}) {
  return createFakeSupabase({
    content: [
      { id: 'c-bar', title: 'Barem fracții', category: 'clasa-6', content_type: 'interactive', is_free: true, subcategory: 'bareme', sort_order: 0 },
      { id: 'c1', title: 'Fracții — exercițiul 1', category: 'clasa-6', content_type: 'interactive', is_free: true, sort_order: 1 },
      { id: 'c2', title: 'Fracții — exercițiul 2', category: 'clasa-6', content_type: 'interactive', is_free: false, sort_order: 2 },
      { id: 'c3', title: 'Ecuații — exercițiul 3', category: 'clasa-6', content_type: 'interactive', is_free: true, sort_order: 3 },
      { id: 'c-pdf', title: 'Test PDF', category: 'clasa-6', content_type: 'pdf', is_free: true, sort_order: 4 },
      { id: 'b1', title: 'BAC — funcții', category: 'bacalaureat', content_type: 'interactive', is_free: true, sort_order: 1 },
    ],
    user_stats: [{ user_id: U, total_xp: 0, coins: 0, streak_current: 0, streak_best: 0, freezes: 0, league_tier: 1 }],
    daily_exercises: [],
    progress: [],
    xp_events: [],
    ...extra,
  });
}
const ELEV = { id: U, subscription_status: null, role: 'elev', is_admin: false };
const PREMIUM = { ...ELEV, subscription_status: 'active' };

test('fără clasă aleasă: alegerea (a V-a … a XII-a); migrarea nerulată → misiunea inactivă, fără erori', async () => {
  const supa = baza();
  const s = await misiune.stare(supa, U, ELEV);
  assert.strictEqual(s.activ, true);
  assert.strictEqual(s.alegeClasa, true);
  assert.strictEqual(s.clase.length, 8);
  assert.strictEqual((supa.db.tables.daily_exercises || []).length, 0, 'nimic atribuit înainte de alegere');

  const lipsa = baza();
  lipsa.db.failTables.add('daily_exercises');
  const s2 = await misiune.stare(lipsa, U, ELEV);
  assert.strictEqual(s2.activ, false);
  const r = await misiune.alegeClasa(lipsa, U, ELEV, 'clasa-6');
  assert.match(r.error, /gamificare_v8_misiune_zilnica\.sql/);
  assert.strictEqual(await misiune.inregistreaza(lipsa, U, { contentId: 'c1', score: 5, maxScore: 5 }), null, 'salvarea scorului nu cade');
});

test('alegerea clasei → exercițiul zilei, din site, interactiv, fără bareme; fără abonament doar cele gratuite', async () => {
  const supa = baza();
  assert.match((await misiune.alegeClasa(supa, U, ELEV, 'clasa-13')).error, /a V-a și a XII-a/);
  const r = await misiune.alegeClasa(supa, U, ELEV, 'clasa-6');
  assert.ok(r.ok);
  assert.strictEqual(supa.db.tables.user_stats[0].mission_category, 'clasa-6');
  const m = r.misiune;
  assert.strictEqual(m.clasa.label, 'a VI-a');
  assert.strictEqual(m.exercitiu.id, 'c1', 'primul exercițiu interactiv gratuit, nu baremul');
  assert.strictEqual(m.status, 'deschis');
  assert.deepStrictEqual(m.drum, { parcurse: 0, total: 2, pct: 0 }, 'drumul: c1 + c3 (c2 e premium, c-pdf nu e interactiv)');
  assert.strictEqual(supa.db.tables.daily_exercises.length, 1);
  // a doua deschidere din aceeași zi: același exercițiu, niciun rând nou
  const din2 = await misiune.stare(supa, U, ELEV);
  assert.strictEqual(din2.exercitiu.id, 'c1');
  assert.strictEqual(supa.db.tables.daily_exercises.length, 1);

  // cu abonament: și exercițiile premium; „c1" deja rezolvat în site → „c2"
  const p = baza({ progress: [{ user_id: U, content_id: 'c1', score: 9, max_score: 10 }], user_stats: [{ user_id: U, mission_category: 'clasa-6', total_xp: 0, coins: 0 }] });
  const mp = await misiune.stare(p, U, PREMIUM);
  assert.strictEqual(mp.exercitiu.id, 'c2');
  assert.deepStrictEqual(mp.drum, { parcurse: 1, total: 3, pct: 33 });
});

test('clasa fără exerciții interactive: liceul primește din Bacalaureat; schimbarea clasei mută misiunea deschisă', async () => {
  const supa = baza();
  await misiune.alegeClasa(supa, U, ELEV, 'clasa-6');
  assert.strictEqual(supa.db.tables.daily_exercises[0].content_id, 'c1');
  const r = await misiune.alegeClasa(supa, U, ELEV, 'clasa-11');
  assert.strictEqual(r.misiune.clasa.label, 'a XI-a');
  assert.strictEqual(r.misiune.exercitiu.id, 'b1', 'rezerva: Bacalaureat');
  assert.strictEqual(r.misiune.din, 'bacalaureat');
  assert.strictEqual(supa.db.tables.daily_exercises.length, 1, 'aceeași zi, același rând');
  // clasa a VII-a nu are nimic și nici rezervă → fără exercițiu, cu mesaj în pagină
  const r2 = await misiune.alegeClasa(supa, U, ELEV, 'clasa-7');
  assert.strictEqual(r2.misiune.exercitiu, null);
});

test('îndeplinirea: doar exercițiul zilei, de la 50%; o singură recompensă; reîncercările se numără', async () => {
  const supa = baza({ daily_exercises: [
    { id: 'm-2', user_id: U, day: zi(-2), category: 'clasa-6', content_id: 'c3', status: 'indeplinit', attempts: 1, best_pct: 80, xp: 20 },
    { id: 'm-1', user_id: U, day: zi(-1), category: 'clasa-6', content_id: 'c3', status: 'indeplinit', attempts: 1, best_pct: 70, xp: 20 },
  ], user_stats: [{ user_id: U, mission_category: 'clasa-6', total_xp: 0, coins: 0 }] });
  const m = await misiune.stare(supa, U, ELEV);
  assert.strictEqual(m.exercitiu.id, 'c1');
  assert.strictEqual(m.serie, 2, 'seria de ieri e încă vie');

  // alt exercițiu decât cel al zilei → nimic
  assert.strictEqual(await misiune.inregistreaza(supa, U, { contentId: 'c3', score: 10, maxScore: 10 }), null);
  // sub prag → încă nu, dar încercarea se numără
  const sub = await misiune.inregistreaza(supa, U, { contentId: 'c1', score: 2, maxScore: 5 });
  assert.strictEqual(sub.indeplinita, false);
  assert.strictEqual(sub.pct, 40);
  assert.strictEqual(sub.incercari, 1);
  // de la 50%: îndeplinită, cu recompensa prin XP (sursa „misiune-zilnica") și seria crescută
  const ok = await misiune.inregistreaza(supa, U, { contentId: 'c1', score: 5, maxScore: 5 });
  assert.strictEqual(ok.tocmaiIndeplinita, true);
  assert.strictEqual(ok.serie, 3);
  assert.strictEqual(ok.perfect, true);
  assert.strictEqual(ok.xp, 30);
  assert.strictEqual(ok.incercari, 2);
  const ev = supa.db.tables.xp_events.filter((e) => e.source === 'misiune-zilnica');
  assert.strictEqual(ev.length, 1);
  assert.strictEqual(ev[0].xp, 30);
  const rand = supa.db.tables.daily_exercises.find((r) => r.day === AZI);
  assert.strictEqual(rand.status, 'indeplinit');
  assert.strictEqual(rand.best_pct, 100);
  assert.strictEqual(rand.xp, 30);
  // încă o rezolvare în aceeași zi: fără a doua recompensă
  const din2 = await misiune.inregistreaza(supa, U, { contentId: 'c1', score: 5, maxScore: 5 });
  assert.strictEqual(din2.tocmaiIndeplinita, false);
  assert.strictEqual(din2.indeplinita, true);
  assert.strictEqual(supa.db.tables.xp_events.filter((e) => e.source === 'misiune-zilnica').length, 1);
  // pagina: azi bifată, seria 3, totalul 3
  const dupa = await misiune.stare(supa, U, ELEV);
  assert.strictEqual(dupa.status, 'indeplinit');
  assert.strictEqual(dupa.serie, 3);
  assert.strictEqual(dupa.total, 3);
  assert.strictEqual(dupa.saptamana.find((z) => z.day === AZI).stare, 'facut');
  // scor neverificat: se bifează, dar fără bonusul „perfect"
  const n = baza({ daily_exercises: [{ id: 'mz', user_id: U, day: AZI, category: 'clasa-6', content_id: 'c1', status: 'deschis', attempts: 0 }] });
  const nv = await misiune.inregistreaza(n, U, { contentId: 'c1', score: 10, maxScore: 10, verified: false });
  assert.strictEqual(nv.tocmaiIndeplinita, true);
  assert.strictEqual(nv.perfect, false);
});

function stubScore(supa, verif) {
  const saved = { admin: ai.admin, authUser: ai.authUser, requireUser: ai.requireUser, applyCors: ai.applyCors, vs: score.verifiedScore, lh: score.loadContentHtml };
  Object.assign(ai, { admin: () => supa, authUser: async () => U, requireUser: async () => ELEV, applyCors: () => {} });
  score.verifiedScore = async () => verif;
  score.loadContentHtml = async () => '';
  return () => { Object.assign(ai, { admin: saved.admin, authUser: saved.authUser, requireUser: saved.requireUser, applyCors: saved.applyCors }); score.verifiedScore = saved.vs; score.loadContentHtml = saved.lh; };
}

test('api/ai-score: rezolvarea FINALĂ a exercițiului zilei îndeplinește misiunea; salvarea parțială nu', async () => {
  const supa = baza({ daily_exercises: [{ id: 'mz', user_id: U, day: AZI, category: 'clasa-6', content_id: 'c1', status: 'deschis', attempts: 0 }] });
  const restore = stubScore(supa, { hasKeys: true, verified: true, score: 4, maxScore: 5, correct: 4, total: 5 });
  try {
    const handler = require('../api/ai-score');
    const p = fakeRes();
    await handler({ method: 'POST', headers: {}, body: { contentId: 'c1', answers: [1, 2, 3, 0, 1], score: 0, maxScore: 0, partial: true } }, p);
    assert.strictEqual(p.statusCode, 200, JSON.stringify(p.body));
    assert.strictEqual(p.body.partial, true);
    assert.strictEqual(supa.db.tables.daily_exercises[0].status, 'deschis', 'salvarea automată de la jumătate nu bifează misiunea');

    const res = fakeRes();
    await handler({ method: 'POST', headers: {}, body: { contentId: 'c1', answers: [1, 2, 3, 0, 1], score: 4, maxScore: 5 } }, res);
    assert.strictEqual(res.statusCode, 200, JSON.stringify(res.body));
    assert.strictEqual(res.body.misiune.tocmaiIndeplinita, true);
    assert.strictEqual(res.body.misiune.pct, 80);
    assert.strictEqual(supa.db.tables.daily_exercises[0].status, 'indeplinit');
  } finally { restore(); }
});

test('api/gamificare: action „misiune" și „misiune_clasa"; starea are „misiuneAzi" pentru indicatorul din navbar', async () => {
  const supa = baza();
  const saved = { admin: ai.admin, authUser: ai.authUser, requireUser: ai.requireUser, applyCors: ai.applyCors };
  Object.assign(ai, { admin: () => supa, authUser: async () => U, requireUser: async () => ELEV, applyCors: () => {} });
  try {
    const handler = require('../api/gamificare');
    const r1 = fakeRes();
    await handler({ method: 'POST', headers: {}, query: {}, body: { action: 'misiune' } }, r1);
    assert.strictEqual(r1.statusCode, 200, JSON.stringify(r1.body));
    assert.strictEqual(r1.body.misiune.alegeClasa, true);
    const r2 = fakeRes();
    await handler({ method: 'POST', headers: {}, query: {}, body: { action: 'misiune_clasa', categorie: 'clasa-6' } }, r2);
    assert.strictEqual(r2.statusCode, 200, JSON.stringify(r2.body));
    assert.strictEqual(r2.body.misiune.exercitiu.id, 'c1');
    const r3 = fakeRes();
    await handler({ method: 'POST', headers: {}, query: {}, body: { action: 'misiune_clasa', categorie: 'clasa-3' } }, r3);
    assert.strictEqual(r3.statusCode, 400);
    const r4 = fakeRes();
    await handler({ method: 'POST', headers: {}, query: {}, body: { action: 'state' } }, r4);
    assert.strictEqual(r4.statusCode, 200, JSON.stringify(r4.body));
    assert.deepStrictEqual(r4.body.misiuneAzi, { clasa: 'clasa-6', status: 'deschis' });
  } finally { Object.assign(ai, saved); }
});

// ─── SQL + pagina ───────────────────────────────────────────────────────────
test('migrarea: RLS + GRANT pentru authenticated și service_role în același fișier, fără anon; politica de citire proprie', () => {
  const sql = read('supabase/gamificare_v8_misiune_zilnica.sql');
  assert.match(sql, /create table if not exists public\.daily_exercises/);
  assert.match(sql, /alter table public\.daily_exercises enable row level security;/);
  assert.match(sql, /grant select, insert, update, delete on public\.daily_exercises to authenticated;/);
  assert.match(sql, /grant select, insert, update, delete on public\.daily_exercises to service_role;/);
  assert.doesNotMatch(sql, /to anon/, 'misiunile elevilor nu sunt publice');
  assert.match(sql, /daily_exercises_own_select on public\.daily_exercises for select to authenticated\s+using \(user_id = \(select auth\.uid\(\)\)\)/);
  assert.match(sql, /unique \(user_id, day\)/);
  assert.match(sql, /alter table public\.user_stats add column if not exists mission_category text;/);
  // ordinea: grant-urile vin imediat după crearea tabelei (regula din CLAUDE.md)
  const i = sql.indexOf('create table if not exists public.daily_exercises');
  assert.ok(sql.indexOf('enable row level security', i) < sql.indexOf('create index', i));
});

test('/arena: „🎯 Misiunea zilnică" stă deasupra duelurilor; exercițiul se deschide în vizualizator; navbarul arată 🎯', () => {
  const arena = read('src/pages/Arena.jsx');
  const iM = arena.indexOf('<MisiuneZilnica />');
  const iD = arena.indexOf('<DueluriPanel />');
  assert.ok(iM > 0 && iD > iM, 'misiunea e înaintea duelurilor');
  assert.ok(!/<[A-Z]\w+/.test(arena.slice(iM + '<MisiuneZilnica />'.length, iD).replace(/\{\/\*[\s\S]*?\*\/\}/g, '')), 'nimic între ele');
  assert.match(arena, /⚡ Provocarea bonus a zilei/, 'vechea „misiune a zilei" nu se mai confundă cu cea nouă');

  const card = read('src/components/MisiuneZilnica.jsx');
  assert.match(card, /aiClient\.gamificare\(\{ action: 'misiune' \}\)/);
  assert.match(card, /aiClient\.gamificare\(\{ action: 'misiune_clasa', categorie \}\)/);
  assert.match(card, /navigate\(`\/exercitiu\?id=\$\{ex\.id\}&misiune=1`\)/);
  assert.match(card, /onArenaChange\(\(\) => load\(\)\)/, 'se reîmprospătează după exercițiu');
  assert.match(card, /Drumul clasei/);
  assert.match(card, /zile la rând/);

  const iv = read('src/pages/InteractiveViewer.jsx');
  assert.match(iv, /const dinMisiune = searchParams\.get\('misiune'\) === '1';/);
  assert.match(iv, /if \(r\.misiune\) \{ setMisiuneRez\(r\.misiune\); arenaChanged\(\); \}/);
  assert.match(iv, /Misiunea zilnică — îndeplinită!/);
  assert.match(read('src/components/ArenaIndicator.jsx'), /misiune\.clasa && misiune\.status !== 'indeplinit'/);
  assert.match(read('api/ai-score.js'), /misiune\.inregistreaza\(supa, userId, \{\s*contentId: content\.id, score: v\.score, maxScore: v\.maxScore, verified: !!v\.verified,/);
});
