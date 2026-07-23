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

module.exports = { norm, isBaremTitle, profileOf, tokensOf, matchBarem, contentMatchScore };
