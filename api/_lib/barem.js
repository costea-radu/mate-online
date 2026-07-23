// =====================================================================
// api/_lib/barem.js — potrivirea STRICTĂ subiect ↔ barem (fără dependențe)
//
// Regula de aur: mai bine NICIUN barem decât baremul GREȘIT.
// Un candidat se potrivește doar dacă anul, varianta, profilul și tipul
// sesiunii (simulare / model / rezervă / specială / olimpici) COINCID
// cu ale subiectului deschis. Ambiguitate (mai mulți candidați) = refuz.
// =====================================================================

// normalizare: litere mici, fără diacritice, separatorii devin spații
function norm(s) {
  return String(s || '').toLowerCase()
    .replace(/[ăâ]/g, 'a').replace(/î/g, 'i').replace(/[șş]/g, 's').replace(/[țţ]/g, 't')
    .replace(/[_\-.·]/g, ' ').replace(/\s+/g, ' ').trim();
}

const isBaremTitle = (title) => /\bbarem/.test(norm(title));

// profilul de BAC: din coloana `profile` sau, în lipsă, din titlu
function profileOf(row) {
  if (row && row.profile) return String(row.profile);
  const t = norm(row && row.title);
  if (/(mate|matematica)\s*(si\s*)?(info|informatica)|m1\b|mate info/.test(t)) return 'mate-info';
  if (/stiint/.test(t)) return 'stiinte-naturii';
  if (/tehnolog|m2\b/.test(t)) return 'tehnologic';
  if (/pedagog/.test(t)) return 'pedagogic';
  return null;
}

// amprenta unui titlu: an + variantă + tipul sesiunii + profil
function tokensOf(row) {
  const t = norm(row && row.title);
  const year = (t.match(/\b(?:19|20)\d{2}\b/) || [null])[0];
  const vm = t.match(/\b(?:varianta|var|v)\s*(\d{1,3})\b/);
  const variant = vm ? String(parseInt(vm[1], 10)) : null;
  const flags = ['simulare', 'model', 'rezerva', 'speciala', 'olimpic']
    .filter((f) => t.includes(f)).sort().join(',');
  return { year, variant, flags, profile: profileOf(row) };
}

// Alege baremul pentru `subject` din lista `candidates` (rânduri `content`).
// Răspuns: { barem, status: 'ok' | 'negasit' | 'ambiguu' }
function matchBarem(subject, candidates) {
  const s = tokensOf(subject);
  const ok = (candidates || []).filter((c) => {
    if (!c || c.id === subject.id) return false;
    if (c.subcategory !== 'bareme' && !isBaremTitle(c.title)) return false;
    const b = tokensOf(c);
    if (s.profile && b.profile !== s.profile) return false;      // profil diferit → nu
    if (!s.profile && b.profile) return false;                    // baremul are profil, subiectul nu → nesigur
    if ((s.year || b.year) && s.year !== b.year) return false;    // anul trebuie să coincidă
    if ((s.variant || b.variant) && s.variant !== b.variant) return false; // varianta la fel
    if (s.flags !== b.flags) return false;                        // simulare↔simulare, model↔model...
    return true;
  });
  if (ok.length === 1) return { barem: ok[0], status: 'ok' };
  if (ok.length > 1) return { barem: null, status: 'ambiguu' };
  return { barem: null, status: 'negasit' };
}

// ── Verificare de CONȚINUT: baremul trebuie să „vorbească" despre același test ──
// Baremul unei variante repetă numerele din enunțuri (rezultate, coeficienți).
// Măsurăm câte dintre numerele distinctive ale testului apar și în barem.
// Răspuns: 0..1, sau null dacă testul nu are destule numere ca să judecăm.
function contentMatchScore(subjectText, baremText) {
  const numsOf = (s) => {
    const m = String(s || '').match(/\d+(?:[.,]\d+)?/g) || [];
    // păstrăm numerele purtătoare de informație (≥2 cifre sau zecimale);
    // 0/1/2/5 etc. apar peste tot și nu diferențiază variantele
    return new Set(m.filter((x) => x.length >= 2));
  };
  const a = numsOf(subjectText), b = numsOf(baremText);
  if (a.size < 6) return null; // prea puține numere — nu decidem pe conținut
  let hit = 0;
  a.forEach((n) => { if (b.has(n)) hit++; });
  return hit / a.size;
}

// ═══════════════════════════════════════════════════════════════════════════
// LOCALIZARE DETERMINISTĂ a unui item (subiect/exercițiu/literă) într-un text
// structurat (test sau barem). Nu depinde de „citirea" AI: parsează referința
// elevului („subiectul III ex 2 b", „II.2.b") și taie fragmentul pe structura
// oficială (SUBIECTUL al III-lea → „2." → „b)").
// ═══════════════════════════════════════════════════════════════════════════
const ROMAN = { i: 'I', ii: 'II', iii: 'III', 1: 'I', 2: 'II', 3: 'III' };

// „subiectul III ex 2 b", „II.2.b", „subiectul al ii-lea problema 1 litera a"
function parseExerciseRef(text) {
  const t = norm(text);
  if (!t) return null;
  let subject = null, ex = null, letter = null;
  let m = t.match(/subiect\w*\s*(?:al\s*)?(i{1,3}|[123])(?:\s*lea)?\b/);
  if (m) subject = ROMAN[m[1]] || null;
  m = t.match(/\b(?:ex|exercitiul?|exercitiu|problema|punctul|intrebarea|cerinta)\s*([1-9])\b/);
  if (m) ex = parseInt(m[1], 10);
  m = t.match(/\b(?:litera|punctul|subpunctul|cerinta)\s*([a-d])\b/);
  if (m) letter = m[1];
  // forma compactă: „iii 2 b" / „ii 1" (normalizarea a transformat punctele în spații)
  m = t.match(/\b(i{1,3})\s+([1-9])(?:\s+([a-d])\b)?/);
  if (m) {
    if (!subject) subject = ROMAN[m[1]];
    if (!ex) ex = parseInt(m[2], 10);
    if (!letter && m[3]) letter = m[3];
  }
  // literă izolată la final: „... 2 b" / „... 2, b)"
  if (ex && !letter) {
    m = t.match(new RegExp(`\\b${ex}\\s+([a-d])\\b`));
    if (m) letter = m[1];
  }
  if (!subject && !ex && !letter) return null;
  return { subject, ex, letter };
}

// începutul unui exercițiu: „2." / „2)" la început de rând (nu „2.5")
function exStartRe(n) { return new RegExp(`(?:^|\\n)[ \\t]*${n}\\s*[\\.\\)](?!\\d)`); }

// Taie din `text` fragmentul corespunzător referinței. null = negăsit sigur.
function sliceExercise(text, ref) {
  let src = String(text || '');
  if (!src.trim() || !ref) return null;
  // 1) secțiunea subiectului
  const secs = [...src.matchAll(/SUBIECTUL\s+(?:al\s+)?(I{1,3}|[123])(?:\s*-?\s*lea)?/gi)]
    .map((m) => ({ idx: m.index, sub: ROMAN[String(m[1]).toLowerCase()] }));
  if (ref.subject) {
    const at = secs.findIndex((s) => s.sub === ref.subject);
    if (at === -1) return null;
    src = src.slice(secs[at].idx, at + 1 < secs.length ? secs[at + 1].idx : src.length);
  } else if (ref.ex && secs.length > 1) {
    // fără subiect precizat: acceptăm doar dacă numărul de exercițiu e unic în tot textul
    const hits = [...src.matchAll(new RegExp(exStartRe(ref.ex).source, 'g'))];
    if (hits.length !== 1) return null;
  }
  // 2) exercițiul
  if (ref.ex) {
    const i = src.search(exStartRe(ref.ex));
    if (i === -1) return null;
    const rest = src.slice(i + 1);
    const j = rest.search(exStartRe(ref.ex + 1));
    src = j === -1 ? src.slice(i) : src.slice(i, i + 1 + j);
  }
  // 3) litera („b)" precedată de spațiu/rând nou — nu „(a+b)")
  if (ref.letter) {
    const lRe = new RegExp(`(?:^|\\n|\\s)${ref.letter}\\s*\\)`);
    const li = src.search(lRe);
    if (li !== -1) {
      const next = String.fromCharCode(ref.letter.charCodeAt(0) + 1);
      const rest = src.slice(li + 1);
      const ni = rest.search(new RegExp(`(?:^|\\n|\\s)${next}\\s*\\)`));
      src = ni === -1 ? src.slice(li) : src.slice(li, li + 1 + ni);
    } // litera negăsită → păstrăm tot exercițiul (mai bine mai mult decât greșit)
  }
  src = src.trim();
  return src.length >= 15 ? src : null;
}

function formatRef(ref) {
  if (!ref) return null;
  return [ref.subject, ref.ex, ref.letter].filter(Boolean).join('.');
}

module.exports = { norm, isBaremTitle, profileOf, tokensOf, matchBarem, contentMatchScore, parseExerciseRef, sliceExercise, formatRef };
