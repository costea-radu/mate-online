// =====================================================================
// api/_lib/simulariOficiale.js — SIMULĂRILE DE EXAMEN din „Planul meu", compuse
// din SUBIECTELE OFICIALE, fără model
//
// Itemii subiectelor oficiale (EN, BAC pe profil) sunt deja „puși pe barem" în
// lecțiile meditațiilor live (live_lessons.script, api/_lib/liveLesson.js):
// enunțul curățat, variantele, răspunsul luat din barem (litera grilelor de EN e
// verificată pe tabelul baremului), explicația scrisă pe tablă pe barem.
// O simulare ia pozițiile examenului dintr-un subiect oficial pe care elevul nu
// l-a mai avut la simulări; ce lipsește se completează din alte subiecte:
//   · EN  — Subiectul I (6 grile) + Subiectul al II-lea (6 grile), ca până acum;
//   · BAC — Subiectul I (6 itemi cu rezultat) + câte un subpunct din problemele
//           Subiectelor II și III (cele cu rezultat și cu enunțul întreg).
// Cu pregătirea doar pe Subiectul I / II / I+II, doar pozițiile acelea.
// Cost 0, gata pe loc. Generarea (după modelul din site) rămâne doar pentru
// când itemii oficiali nelucrați s-au terminat (sau nu au destui itemi).
// =====================================================================
const L = require('./live');
const LL = require('./liveLesson');
const P = require('./pregatire');
const taxonomy = require('./taxonomy');

const SIX = [1, 2, 3, 4, 5, 6];
const pos = (sub, list) => list.map((k) => `${sub}.${k}`);

// Pozițiile simulării + câte trebuie găsite (altfel → generare)
function planFor(exam, scope = null) {
  if (exam === 'en') {
    const I = pos('I', SIX), II = pos('II', SIX);
    if (scope === 's1') return { slots: [...I, ...I], min: 9 };
    if (scope === 's2') return { slots: [...II, ...II], min: 9 };
    return { slots: [...I, ...II], min: 9 };
  }
  const I = pos('I', SIX), S2 = ['II.1', 'II.2'], S3 = ['III.1', 'III.2'];
  if (scope === 's1') return { slots: [...I, 'I.1', 'I.2', 'I.3'], min: 6 };
  if (scope === 's2') return { slots: [...S2, ...S2, ...S2], min: 4 };
  if (scope === 's1s2') return { slots: [...I, ...S2], min: 6 };
  return { slots: [...I, ...S2, ...S3], min: 6 };
}

const SHOW_THAT = (t) => /\b(aratati|demonstrati|verificati|justificati)\s+ca\b/.test(L.foldRo(t));
// enunțul unui subpunct (BAC II.1.b) trebuie să conțină și datele problemei
const HAS_CONTEXT = (t) => /\b(se considera|se da|se dau|fie|consideram|pe multimea|in reperul|in sistemul|se noteaza)\b/.test(L.foldRo(t));
// enunț care trimite la o figură din PDF (o arătăm prin linkul spre subiect)
const NEEDS_FIGURE = (t) => /\b(figur|desen|alaturat|reprezentat)/.test(L.foldRo(t));

function explanationOf(it, poll) {
  const lines = (it.modes?.barem || []).flatMap((s) => (Array.isArray(s?.board) ? s.board : [])).map((x) => String(x || '').trim()).filter(Boolean);
  return [String(poll.explain || '').trim(), lines.slice(0, 14).join('\n')].filter(Boolean).join('\n').slice(0, 1600);
}

// Itemul oficial → întrebarea din „Planul meu" ({ statement, options?, answer, explanation, topic })
function questionOf(it, { category = null } = {}) {
  if (!it || !String(it.statement || '').trim()) return null;
  const ref = LL.parseRef(it.ref);
  if (!ref) return null;
  const showThat = SHOW_THAT(it.statement);
  if (ref.letter && !HAS_CONTEXT(it.statement)) return null;            // subpunct fără datele problemei
  const poll = it.tryPoll || (!showThat ? it.check : null);
  if (!poll || !poll.type) return null;
  const statement = String((showThat ? it.statementTry : null) || it.statement).trim();
  if (!statement || (showThat && !it.statementTry)) return null;
  const cls = taxonomy.classify(statement, category);
  const base = { statement, explanation: explanationOf(it, poll), topic: cls?.topic || null, chapter: cls?.chapterId || null };
  if (poll.type === 'grila') {
    const options = (Array.isArray(poll.options) && poll.options.length >= 2 ? poll.options : it.options || []).map((o) => String(o ?? '').trim());
    const k = 'abcde'.indexOf(String(poll.answer || '').trim().toLowerCase().replace(/[).\s]/g, ''));
    if (options.length < 2 || options.some((o) => !o) || k < 0 || k >= options.length) return null;
    return { ...base, options, answer: k };
  }
  const answer = String(poll.answer || '').replace(/^\$+|\$+$/g, '').trim();
  if (!answer || answer.length > 60) return null;
  // întrebarea pusă (dacă nu e chiar enunțul) vine sub enunț: „Cât este $m$?"
  const q = String(poll.question || '').trim();
  const same = !q || statement.includes(q) || L.foldRo(q).replace(/\W+/g, '') === L.foldRo(statement).replace(/\W+/g, '');
  return { ...base, statement: same ? statement : `${statement}\n\n${q}`, answer };
}

// itemii de pe o poziție întreagă („II.1" → II.1, II.1.a, II.1.b, …)
function itemsAtPos(items, p) {
  const [sub, exS] = String(p).split('.');
  const ex = parseInt(exS, 10);
  return (items || [])
    .map((it) => ({ it, r: LL.parseRef(it.ref) }))
    .filter((x) => x.r && x.r.subject === sub && x.r.ex === ex)
    .sort((a, b) => String(a.r.letter || '').localeCompare(String(b.r.letter || '')))
    .map((x) => x.it);
}

// ordinea subiectelor: întâi cele nefolosite la simulări, amestecate per elev
const mix = (seed, id) => L.shortId(`${seed}|${id}`);
function orderLessons(lessons, usedSids, seed) {
  const fresh = lessons.filter((l) => !usedSids.has(l.subject_id));
  const old = lessons.filter((l) => usedSids.has(l.subject_id));
  const sort = (arr) => arr.slice().sort((a, b) => mix(seed, a.subject_id).localeCompare(mix(seed, b.subject_id)));
  return [...sort(fresh), ...sort(old)];
}

// Itemii oficiali deja dați elevului la simulările din „Planul meu"
async function usedOfficial(supa, userId) {
  const { data } = await supa.from('ai_meditatii_sessions').select('official:payload->official')
    .eq('user_id', userId).eq('kind', 'simulare').order('created_at', { ascending: false }).limit(200);
  const keys = new Set(), sids = new Set();
  let count = 0;
  for (const r of data || []) {
    const list = Array.isArray(r.official) ? r.official : [];
    if (list.length) count++;
    for (const o of list) { if (o && o.sid) { sids.add(o.sid); keys.add(`${o.sid}|${o.ref}`); } }
  }
  return { keys, sids, count };
}

// Lecțiile cu itemii scriși (orice profesor; cea mai nouă versiune pe subiect)
async function readyLessons(supa, E) {
  let q = supa.from('live_lessons').select('id, subject_id, title, version')
    .eq('exam', E.exam).in('status', ['script', 'audio', 'gata']);
  if (E.exam === 'bac' && E.profile) q = q.eq('profile', E.profile);
  const { data, error } = await q.order('version', { ascending: false }).limit(1500);
  if (error) return [];
  const bySubject = new Map();
  for (const r of data || []) if (r.subject_id && !bySubject.has(r.subject_id)) bySubject.set(r.subject_id, r);
  return [...bySubject.values()];
}

async function loadItems(supa, lessonId) {
  const { data } = await supa.from('live_lessons').select('id, subject_id, title, items:script->items').eq('id', lessonId).maybeSingle();
  if (!data || !Array.isArray(data.items) || !data.items.length) return null;
  // grilele (EN) rămase fără întrebare în lecțiile scrise înainte de 24 oct. o primesc și aici
  const items = LL.restoreGrilaTries(LL.dropUnreadable({ items: data.items })).items;
  return { sid: data.subject_id, title: data.title || 'Subiect oficial', items };
}

// Simularea: { questions, official: [{ sid, ref, title }], titles } | null (→ generare)
async function build(supa, { userId, examType, scope = null, maxLoads = 6 } = {}) {
  const E = P.examOf(examType);
  if (!E) return null;
  const { slots, min } = planFor(E.exam, scope);
  const category = E.exam === 'en' ? 'evaluare-nationala' : 'bacalaureat';
  const [used, lessons] = await Promise.all([usedOfficial(supa, userId), readyLessons(supa, E)]);
  if (!lessons.length) return null;
  const ordered = orderLessons(lessons, used.sids, `${userId}|${used.count}`);

  const loaded = [];
  const taken = new Set();
  let next = 0, loads = 0;
  const pick = (src, p) => {
    for (const it of itemsAtPos(src.items, p)) {
      const key = `${src.sid}|${it.ref}`;
      if (taken.has(key) || used.keys.has(key)) continue;
      const q = questionOf(it, { category });
      if (!q) continue;
      taken.add(key);
      return { ...q, official: { sid: src.sid, ref: LL.refKey(LL.parseRef(it.ref)), title: src.title, figure: NEEDS_FIGURE(it.statement) } };
    }
    return null;
  };
  const out = [];
  for (const p of slots) {
    let q = null;
    for (const src of loaded) { q = pick(src, p); if (q) break; }
    while (!q && next < ordered.length && loads < maxLoads) {
      loads++;
      const src = await loadItems(supa, ordered[next++].id);
      if (!src) continue;
      loaded.push(src);
      q = pick(src, p);
    }
    if (q) out.push(q);
  }
  if (out.length < min) return null;
  const titles = [...new Set(out.map((q) => q.official.title))];
  return {
    questions: out,
    official: out.map((q) => ({ sid: q.official.sid, ref: q.official.ref, title: q.official.title })),
    titles,
  };
}

module.exports = { planFor, questionOf, itemsAtPos, orderLessons, usedOfficial, readyLessons, build, SHOW_THAT, HAS_CONTEXT, NEEDS_FIGURE };
