// =====================================================================
// src/lib/live/items.js — exercițiile unei lecții (pentru „📋 Exerciții":
// elevul alege ce exercițiu lucrează, nu neapărat la rând — ex. Subiectul I
// ex. 5, Subiectul al II-lea ex. 2 b), Subiectul al III-lea ex. 1 c)).
//
// Referințele sunt ca în lecțiile pe barem (api/_lib/liveLesson.js): „I.5",
// „II.2.b" (la BAC, problemele de la Subiectele II și III au a), b), c) — fiecare
// e un item), „III.1" (la EN, problemele de la Subiectul III sunt întregi).
// =====================================================================
export const SECTION_LABEL = { I: 'Subiectul I', II: 'Subiectul al II-lea', III: 'Subiectul al III-lea' };
export const SECTION_SHORT = { I: 'S. I', II: 'S. II', III: 'S. III' };
const SEC_ORDER = { I: 1, II: 2, III: 3 };

export function parseRef(ref) {
  const m = /^\s*(I{1,3})\s*[.\s]\s*(\d)(?:\s*[.\s]\s*([a-d]))?/i.exec(String(ref || ''));
  return m ? { section: m[1].toUpperCase(), ex: parseInt(m[2], 10), letter: m[3] ? m[3].toLowerCase() : null } : null;
}
// „II.2.b" → „S. II · ex. 2 b)"
export function refLabel(ref, { long = false } = {}) {
  const r = parseRef(ref);
  if (!r) return String(ref || '');
  return long
    ? `${SECTION_LABEL[r.section]}, exercițiul ${r.ex}${r.letter ? ` ${r.letter})` : ''}`
    : `${SECTION_SHORT[r.section]} · ex. ${r.ex}${r.letter ? ` ${r.letter})` : ''}`;
}
const order = (ref) => { const r = parseRef(ref); return r ? SEC_ORDER[r.section] * 1000 + r.ex * 10 + (r.letter ? r.letter.charCodeAt(0) - 96 : 0) : 99999; };

// itemii lecției, din cronologie (scenele „item" = începutul fiecărui exercițiu)
export function itemsFromTimeline(tl) {
  const out = [];
  const seen = new Set();
  for (const s of (tl && tl.scenes) || []) {
    if (s.type !== 'item' || s.item == null || seen.has(s.item)) continue;
    seen.add(s.item);
    out.push({ item: s.item, ref: s.ref, title: s.title, section: s.section || parseRef(s.ref)?.section || 'I' });
  }
  return out;
}

// structura obișnuită a examenului — înainte să fie gata lecția (alegerea de la intrare)
export function defaultRefs(exam) {
  const out = [];
  for (let k = 1; k <= 6; k++) out.push(`I.${k}`);
  if (exam === 'bac') {
    for (const s of ['II', 'III']) for (let k = 1; k <= 2; k++) for (const l of ['a', 'b', 'c']) out.push(`${s}.${k}.${l}`);
  } else {
    for (const s of ['II', 'III']) for (let k = 1; k <= 6; k++) out.push(`${s}.${k}`);
  }
  return out.map((ref) => ({ item: null, ref, title: refLabel(ref, { long: true }), section: parseRef(ref).section }));
}

// grupate pe subiecte; la problemele cu a), b), c) — pe exerciții
export function groupItems(items) {
  const secs = [];
  for (const it of items || []) {
    const r = parseRef(it.ref);
    if (!r) continue;
    let sec = secs.find((x) => x.section === r.section);
    if (!sec) { sec = { section: r.section, label: SECTION_LABEL[r.section], groups: [] }; secs.push(sec); }
    let g = sec.groups.find((x) => x.ex === r.ex);
    if (!g) { g = { ex: r.ex, items: [] }; sec.groups.push(g); }
    g.items.push({ ...it, letter: r.letter });
  }
  secs.sort((a, b) => SEC_ORDER[a.section] - SEC_ORDER[b.section]);
  for (const s of secs) {
    s.groups.sort((a, b) => a.ex - b.ex);
    for (const g of s.groups) g.items.sort((a, b) => String(a.letter || '').localeCompare(String(b.letter || '')));
  }
  return secs;
}

// scena de început a exercițiului ales: exact „II.2.b"; „II.2" → primul subpunct;
// „III.1.b" ales, dar lecția are „III.1" întreg (EN) → „III.1"; lipsă → următorul din lecție
export function sceneIndexForRef(tl, ref) {
  const scenes = (tl && tl.scenes) || [];
  const heads = scenes.map((s, i) => ({ s, i })).filter((x) => x.s.type === 'item' && x.s.item != null);
  if (!ref || !heads.length) return { index: -1, exact: false };
  const exact = heads.find((x) => x.s.ref === ref);
  if (exact) return { index: exact.i, exact: true, ref };
  const child = heads.find((x) => String(x.s.ref).startsWith(`${ref}.`));
  if (child) return { index: child.i, exact: true, ref: child.s.ref };
  const parent = String(ref).split('.').slice(0, 2).join('.');
  const whole = heads.find((x) => x.s.ref === parent);
  if (whole) return { index: whole.i, exact: true, ref: whole.s.ref };
  const want = order(ref);
  const after = heads.filter((x) => order(x.s.ref) > want).sort((a, b) => order(a.s.ref) - order(b.s.ref))[0];
  return after ? { index: after.i, exact: false, ref: after.s.ref } : { index: -1, exact: false };
}

// starea fiecărui exercițiu pentru elev: corect / greșit (după întrebările lui) / văzut
export function itemStatus(tl, myAnswers = {}, visited = new Set()) {
  const out = {};
  for (const s of (tl && tl.scenes) || []) {
    if (s.type !== 'sondaj' || !s.poll || s.item == null) continue;
    const a = myAnswers[s.poll.id];
    if (!a) continue;
    if (a.correct === false) out[s.item] = 'gresit';
    else if (a.correct && out[s.item] !== 'gresit') out[s.item] = 'corect';
  }
  for (const i of visited) if (!out[i]) out[i] = 'vazut';
  return out;
}
