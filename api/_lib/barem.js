// =====================================================================
// api/_lib/barem.js — potrivirea STRICTĂ subiect ↔ barem (fără dependențe)
//
// Regula de aur: mai bine NICIUN barem decât baremul GREȘIT.
// Un candidat se potrivește doar dacă anul, varianta, profilul și tipul
// sesiunii (simulare / model / rezervă / specială / olimpici) COINCID
// cu ale subiectului deschis. Ambiguitate (mai mulți candidați) = refuz.
//
// Merge la fel pentru BACALAUREAT și EVALUARE NAȚIONALĂ. Trei surse de
// adevăr, în această ordine: (1) titlul din site + numele original al
// fișierului; (2) ANTETUL PDF-urilor („Anul școlar 2023 – 2024 · Varianta 7",
// „Model", „Simulare", „Testul 3", „M_mate-info"); (3) conținutul — numerele
// din enunțuri care se regăsesc în rezolvările din barem.
// =====================================================================

// normalizare: litere mici, fără diacritice, separatorii devin spații
function norm(s) {
  return String(s || '').toLowerCase()
    .replace(/[ăâ]/g, 'a').replace(/î/g, 'i').replace(/[șş]/g, 's').replace(/[țţ]/g, 't')
    .replace(/[_\-.·–—]/g, ' ').replace(/\s+/g, ' ').trim();
}

const isBaremTitle = (title) => /\bbarem/.test(norm(title));

// ── Numele ORIGINAL al fișierului (din file_url) ─────────────────────────────
// Titlul scris în site poate omite informații (an, variantă, profil), dar numele
// oficial al fișierului încărcat (ex. „E_c_matematica_M_mate-info_2012_var_05_lro.pdf",
// „ENVIII_Matematica_2024_var_07_LRO.pdf"; baremul: „..._bar_07_LRO.pdf") le
// conține pe toate. Îl citim ALĂTURI de titlu la potrivirea test ↔ barem.
// La upload, Admin pune prefix „Date.now()_" — îl tăiem.
function fileNameOf(row) {
  let last = String((row && row.file_url) || '').split('#')[0].split('?')[0].split('/').pop() || '';
  try { last = decodeURIComponent(last); } catch { /* rămâne cum e */ }
  return last
    .replace(/\.[a-z0-9]{2,5}$/i, '')  // extensia (.pdf)
    .replace(/^\d{9,}[_-]/, '');       // prefixul de timestamp de la upload
}

// barem după RÂND (nu doar titlu): subcategoria, titlul SAU numele original al
// fișierului — numele oficiale de barem au „bar" acolo unde testul are „var".
function isBaremRow(row) {
  if (!row) return false;
  if (row.subcategory === 'bareme') return true;
  if (isBaremTitle(row.title)) return true;
  return /\bbarem\b|\bbar\b/.test(norm(fileNameOf(row)));
}

// examenul unui rând, după categoria din site
function examOf(row) {
  const c = String((row && row.category) || '');
  if (c === 'evaluare-nationala') return 'en';
  if (c === 'bacalaureat') return 'bac';
  return null;
}

// profilul de BAC: din coloana `profile` sau, în lipsă, din titlu ori din
// numele original al fișierului („M_mate-info", „M_st-nat", „M_tehnologic", „M_ped").
// La Evaluare Națională NU există profil — ignorăm coloana chiar dacă e completată.
function profileFromText(t) {
  if (!t) return null;
  if (/(mate|matematica)\s*(si\s*)?(info|informatica)|m1\b|mate info/.test(t)) return 'mate-info';
  if (/stiint|\bst\s*nat\b/.test(t)) return 'stiinte-naturii';
  if (/tehnolog|m2\b/.test(t)) return 'tehnologic';
  if (/pedagog|\bped\b/.test(t)) return 'pedagogic';
  return null;
}
function profileOf(row) {
  if (!row) return null;
  if (examOf(row) === 'en') return null;
  if (row.profile) return String(row.profile);
  return profileFromText(norm(row.title)) || profileFromText(norm(fileNameOf(row)));
}

// ── Anul: „2024", dar și anul școlar „2023 – 2024" / „2023-2024" / „2023/2024"
//    (anul examenului = al doilea) ────────────────────────────────────────────
function yearOf(t) {
  const r = String(t || '').match(/\b((?:19|20)\d{2})\s*[\/–—-]?\s*((?:19|20)\d{2})\b/);
  if (r && parseInt(r[2], 10) === parseInt(r[1], 10) + 1) return r[2];
  const m = String(t || '').match(/\b(?:19|20)\d{2}\b/);
  return m ? m[0] : null;
}

// ── Varianta / testul / simularea numerotate ────────────────────────────────
// „varianta 7", „var 05", „v3", iar la bareme „bar 05" / „barem 7"; la EN și
// testele de antrenament „Testul 3" / „Test_03" (baremul lor: „Bar_03"), plus
// „Simulare 2" (a doua simulare națională din același an).
const VARIANT_RE = /\b(?:varianta|var|v|barem|bar|testul|test|simularea|simulare|modelul|model)\s*(\d{1,3})\b/;
// FELUL itemului numerotat: variantă oficială vs. test de antrenament. Baremele
// oficiale se numesc la fel („Bar_02") pentru „Var_02" ȘI pentru „Test_02" —
// doar antetul PDF-ului („Varianta 2" / „Testul 2") le desparte.
function kindOf(t) {
  if (/\b(?:varianta|var|v)\s*\d{1,3}\b/.test(t)) return 'varianta';
  if (/\btest(?:ul)?\s*\d{1,3}\b/.test(t)) return 'test';
  return null;
}
// tipul sesiunii: „olimpi" prinde și „olimpic", și „olimpiada"; „judet" prinde
// simulările JUDEȚENE (altele decât simularea națională din același an)
const FLAG_RES = [
  ['simulare', /\bsimul/], ['model', /\bmodel/], ['rezerva', /\brezerv/],
  ['speciala', /\bspecial/], ['olimpi', /\bolimpi/], ['judet', /\bjudet/],
];
function flagsOf(t) {
  return FLAG_RES.filter(([, re]) => re.test(t)).map(([f]) => f);
}

// cuvinte „de identitate" (județ, oraș, liceu...) — doar pentru departajare,
// NU pentru refuz: „Simulare Iași 2024" ↔ „Barem simulare Iași 2024"
const STOP_WORDS = new Set(('barem bareme baremul baremele bar var varianta variante test testul teste model modele modelul ' +
  'simulare simulari simularea evaluare evaluarea nationala national en viii clasa clasei matematica mate info pdf lro ' +
  'subiect subiecte subiectul rezolvare rezolvari rezolvarea corectare notare si de la cu din pentru sesiune sesiunea ' +
  'proba scrisa anul scolar bac bacalaureat examen examenul examenului speciala rezerva olimpici olimpiada judetean judeteana ' +
  'judet isj edu ro enviii absolventii absolventilor elevii elevilor stiintele naturii tehnologic pedagogic antrenament ' +
  'stiinte informatica iunie iulie august februarie martie aprilie mai noiembrie decembrie ianuarie').split(' '));
function wordsOf(t) {
  return [...new Set(String(t || '').split(' ').filter((w) => w.length >= 3 && !/\d/.test(w) && !STOP_WORDS.has(w)))];
}

// amprenta unui TEXT (titlu sau nume de fișier): an + variantă + fel + tipul sesiunii
function tokensFromText(t) {
  t = String(t || '');
  const vm = t.match(VARIANT_RE);
  return {
    year: yearOf(t),
    variant: vm ? String(parseInt(vm[1], 10)) : null,
    kind: kindOf(t),
    flags: flagsOf(t),
    words: wordsOf(t),
  };
}

// amprenta unui RÂND: titlul din site + numele original al fișierului se
// completează reciproc (titlul are prioritate; fișierul umple ce lipsește,
// iar tipul sesiunii e reuniunea celor două — strictețe, nu relaxare).
// Opțional, `doc` = amprenta ANTETULUI PDF (docTokens) — umple DOAR câmpurile
// încă necunoscute (metadatele scrise de admin rămân cu prioritate).
function tokensOf(row, doc = null) {
  const a = tokensFromText(norm(row && row.title));
  const b = tokensFromText(norm(fileNameOf(row)));
  const d = doc || {};
  const flags = new Set([...a.flags, ...b.flags]);
  // flag-urile din antet se adaugă doar când metadatele nu spun NIMIC despre sesiune
  // (altfel un „model" din titlu + „simulare" din antet ar bloca orice potrivire)
  if (!flags.size && Array.isArray(d.flagList)) d.flagList.forEach((f) => flags.add(f));
  return {
    exam: examOf(row) || d.exam || null,
    year: a.year || b.year || d.year || null,
    variant: a.variant || b.variant || d.variant || null,
    kind: a.kind || b.kind || d.kind || null,
    flags: [...flags].sort().join(','),
    profile: profileOf(row) || (examOf(row) === 'en' ? null : d.profile || null),
    words: [...new Set([...a.words, ...b.words])],
  };
}

// potrivirea STRICTĂ pe amprente (toate câmpurile cunoscute trebuie să coincidă)
function tokensStrictMatch(s, b) {
  if (s.profile && b.profile !== s.profile) return false;       // profil diferit → nu
  if (!s.profile && b.profile) return false;                     // baremul are profil, subiectul nu → nesigur
  if ((s.year || b.year) && s.year !== b.year) return false;     // anul trebuie să coincidă
  if ((s.variant || b.variant) && s.variant !== b.variant) return false; // varianta la fel
  if (s.kind && b.kind && s.kind !== b.kind) return false;       // variantă ≠ test de antrenament
  if (s.flags !== b.flags) return false;                         // simulare↔simulare, model↔model...
  return true;
}

// Alege baremul pentru `subject` din lista `candidates` (rânduri `content`).
// `subjectDoc` (opțional) = amprenta antetului PDF-ului deschis (docTokens):
// ce spune antetul (ex. „Varianta 7") EXCLUDE candidații care îl contrazic,
// dar nu se cere și baremelor ale căror metadate nu spun nimic despre variantă
// (titlu „Barem EN 2024" + fișier redenumit) — pe acelea le confirmă apoi
// antetul lor, la citire.
// Răspuns: { barem, status: 'ok' | 'negasit' | 'ambiguu' }
function matchBarem(subject, candidates, subjectDoc = null) {
  const s = tokensOf(subject);
  const sAll = subjectDoc ? tokensOf(subject, subjectDoc) : s;
  const ok = (candidates || []).filter((c) => {
    if (!c || c.id === subject.id) return false;
    if (!isBaremRow(c)) return false; // titlu, subcategorie SAU nume original de fișier
    const b = tokensOf(c);
    return tokensStrictMatch(s, b) && !tokensContradict(sAll, b);
  });
  if (ok.length === 1) return { barem: ok[0], status: 'ok' };
  if (ok.length > 1) return { barem: null, status: 'ambiguu' };
  return { barem: null, status: 'negasit' };
}

// ── Compatibilitate TOLERANTĂ pentru potrivirea PE CONȚINUT ──────────────────
// Contradicție = ambele părți au câmpul DEFINIT și el diferă. Câmpurile LIPSĂ
// nu blochează — metadatele incomplete sunt exact cazul în care decide
// conținutul. Un candidat cu an/variantă/profil/sesiune explicit DIFERITE nu
// are voie să câștige nici cu scor mare (regula de aur: mai bine niciunul).
// Acceptă rânduri `content` SAU amprente deja calculate (obiecte cu `year`).
const asTokens = (x) => (x && typeof x === 'object' && 'year' in x && !('title' in x) ? x : tokensOf(x));
function tokensContradict(subject, candidate) {
  const s = asTokens(subject), b = asTokens(candidate);
  if (s.exam && b.exam && s.exam !== b.exam) return true;
  if (s.year && b.year && s.year !== b.year) return true;
  if (s.variant && b.variant && s.variant !== b.variant) return true;
  if (s.kind && b.kind && s.kind !== b.kind) return true;
  if (s.profile && b.profile && s.profile !== b.profile) return true;
  if (s.flags && b.flags && s.flags !== b.flags) return true;
  return false;
}

// câte câmpuri CUNOSCUTE coincid — pentru a citi întâi candidații promițători
function tokensAgreement(subject, candidate) {
  const s = asTokens(subject), b = asTokens(candidate);
  let n = 0;
  if (s.variant && s.variant === b.variant) n += 3; // varianta e cel mai specifică
  if (s.year && s.year === b.year) n += 2;
  if (s.profile && s.profile === b.profile) n += 1;
  if (s.flags && s.flags === b.flags) n += 1;
  if (s.kind && s.kind === b.kind) n += 1;
  // cuvinte de identitate comune (județ, oraș, liceu): „iasi" ↔ „iasi"
  const sw = new Set(s.words || []);
  if (sw.size && (b.words || []).some((w) => sw.has(w))) n += 1;
  return n;
}

// Decizia pe scoruri de conținut: candidatul cel mai bun câștigă DOAR cu scor
// mare ȘI cu distanță clară față de următorul (altfel e ambiguu → refuz).
// `scores` = listă de numere (aceeași ordine ca și candidații); răspuns: indexul
// câștigătorului sau -1.
function pickByContentScore(scores, { accept = 0.5, margin = 0.15 } = {}) {
  let best = -1, second = -1;
  (scores || []).forEach((sc, i) => {
    if (typeof sc !== 'number') return;
    if (best === -1 || sc > scores[best]) { second = best; best = i; }
    else if (second === -1 || sc > scores[second]) { second = i; }
  });
  if (best === -1) return -1;
  if (scores[best] < accept) return -1;                                  // nu e clar „despre acest test"
  if (second !== -1 && scores[best] - scores[second] < margin) return -1; // doi la fel de buni = ambiguu
  return best;
}

// ── Verificare de CONȚINUT: baremul trebuie să „vorbească" despre același test ──
// Baremul unei variante repetă numerele din enunțuri (rezultate, coeficienți).
// Măsurăm câte dintre numerele distinctive ale testului apar și în barem.
// La EVALUARE NAȚIONALĂ, Subiectul I și II sunt grile: baremul dă doar LITERA,
// deci zecile de numere din variantele de răspuns nu se regăsesc în el și
// scorul pe tot testul ieșea artificial mic (baremul corect era respins).
// Acolo măsurăm pe SUBIECTUL al III-lea (problemele cu rezolvare), unde
// baremul repetă datele enunțurilor.
// Răspuns: 0..1, sau null dacă testul nu are destule numere ca să judecăm.
function numbersOf(s) {
  const m = String(s || '').match(/\d+(?:[.,]\d+)?/g) || [];
  // păstrăm numerele purtătoare de informație (≥2 cifre sau zecimale);
  // 0/1/2/5 etc. apar peste tot și nu diferențiază variantele; anii (2024)
  // apar în antetul oricărui document din acel an
  return new Set(m.filter((x) => x.length >= 2 && !/^(?:19|20)\d{2}$/.test(x)));
}
function subjectIIIPart(text) {
  // ULTIMA apariție a titlului, cu text consistent după ea (o mențiune din
  // instrucțiunile de la început nu e titlul secțiunii)
  const src = String(text || '');
  let at = -1;
  for (const m of src.matchAll(/SUBIECTUL\s+(?:al\s+)?(?:III|3)\b/gi)) {
    if (src.length - m.index >= 300) at = m.index;
  }
  return at === -1 ? null : src.slice(at);
}
function contentMatchScore(subjectText, baremText, { exam = null } = {}) {
  let a = null;
  if (exam === 'en') {
    const part = subjectIIIPart(subjectText);
    if (part) a = numbersOf(part);
  }
  if (!a || a.size < 6) a = numbersOf(subjectText);
  if (a.size < 6) return null; // prea puține numere — nu decidem pe conținut
  const b = numbersOf(baremText);
  let hit = 0;
  a.forEach((n) => { if (b.has(n)) hit++; });
  return hit / a.size;
}

// ═══════════════════════════════════════════════════════════════════════════
// AMPRENTA din ANTETUL PDF-ului („docTokens") — ce spune DOCUMENTUL despre el
// însuși, independent de titlul dat de admin sau de numele fișierului:
//   EN:  „Evaluarea Națională pentru absolvenții clasei a VIII-a · Anul școlar
//         2023 – 2024 · Matematică · Varianta 7 | Model | Simulare | Testul 3"
//        + subsolul „Probă scrisă la matematică Varianta 7"
//   BAC: „Examenul național de bacalaureat 2024 · Proba E. c) · Matematică
//         M_mate-info · Varianta 5 | Simulare | Model"
//   barem: aceleași + „BAREM DE EVALUARE ȘI DE NOTARE".
// ═══════════════════════════════════════════════════════════════════════════
function docTokens(text) {
  const raw = String(text || '');
  if (raw.trim().length < 40) return null;
  const t = norm(raw.slice(0, 30000));
  // antetul = până la primul „SUBIECTUL I" (corpul testului poate conține
  // cuvinte ca „model" sau „test" în enunțuri — nu le luăm în seamă)
  const si = t.search(/\bsubiectul\s+(?:al\s+)?i\b/);
  const head = t.slice(0, si > 0 ? Math.min(si, 2500) : 1500);
  // subsolul, repetat pe fiecare pagină: „proba scrisa la matematica [M_...] varianta 7"
  // (doar primele ~45 de caractere — imediat după subsol începe pagina următoare)
  const foots = [...t.matchAll(/proba\s+scrisa\s+la\s+matematica(.{0,45})/g)].map((m) => m[1]);
  const zone = [head, ...foots].join('\n');

  let exam = null;
  if (/\bevaluarea?\s+nationala\b|\bclas(?:a|ei)\s+a\s+viii\s+a\b|\ben\s+viii\b|\benviii\b/.test(head)) exam = 'en';
  else if (/\bbacalaureat/.test(head)) exam = 'bac';

  // anul: „Anul școlar 2023 – 2024" (= examenul din 2024) / „bacalaureat 2024";
  // la alte documente (fișe, culegeri) un an din antet NU e identitate — îl ignorăm
  let year = null;
  const ys = head.match(/anul\s+scolar\s+((?:19|20)\d{2})\s+((?:19|20)\d{2})\b/);
  if (ys) year = ys[2];
  else {
    const yb = head.match(/bacalaureat(?:\s+national)?\s+((?:19|20)\d{2})\b/);
    year = yb ? yb[1] : (exam ? yearOf(head) : null);
  }

  const vm = zone.match(/\bvarianta\s+(\d{1,3})\b/);
  const tm = zone.match(/\btest(?:ul)?\s+(\d{1,3})\b/);
  let variant = null, kind = null;
  if (vm) { variant = String(parseInt(vm[1], 10)); kind = 'varianta'; }
  else if (tm) { variant = String(parseInt(tm[1], 10)); kind = 'test'; }
  const flagList = [];
  if (/\bsimulare\b/.test(zone)) flagList.push('simulare');
  if (/\bmodel\b/.test(zone)) flagList.push('model');
  if (/\bsesiunea?\s+speciala\b|\bspeciala\b/.test(head)) flagList.push('speciala');
  if (/\brezerva\b/.test(head)) flagList.push('rezerva');
  const sm = zone.match(/\bsimularea?\s+(\d{1,2})\b/); // „Simulare 2" (a doua simulare din an)
  if (sm && !variant) variant = String(parseInt(sm[1], 10));

  const profile = exam === 'en' ? null : profileFromText(head);
  const isBarem = /\bbarem(?:ul)?\s+de\s+(?:evaluare|corectare|notare)\b/.test(head);
  if (!exam && !year && !variant && !flagList.length) return null; // antet nerecunoscut

  return { exam, year, variant, kind, flagList, flags: [...flagList].sort().join(','), profile, isBarem, words: [] };
}

// Două amprente (ale testului și ale unui barem — din metadate + antet) spun
// despre ACELAȘI document?
//   'contradiction' — un câmp cunoscut în ambele diferă (an, variantă, fel,
//                     profil, examen, tipul sesiunii) → candidatul e exclus;
//   'match'         — același an ȘI (aceeași variantă/test numerotat SAU același
//                     tip de sesiune: simulare↔simulare, model↔model);
//   'unknown'       — nu se contrazic, dar nici nu avem destule date.
function docsCompatible(a, b) {
  if (!a || !b) return 'unknown';
  if (tokensContradict(a, b)) return 'contradiction';
  // o variantă NUMEROTATĂ fără tip de sesiune (sesiunea obișnuită: „Varianta 7")
  // față de un document de simulare/model/rezervă → documente diferite
  if ((a.flags || '') !== (b.flags || '')) {
    const regular = (x) => !x.flags && !!x.variant;
    if ((regular(a) && b.flags) || (regular(b) && a.flags)) return 'contradiction';
  }
  if (a.year && a.year === b.year) {
    if (a.variant && a.variant === b.variant) return 'match';
    if (a.flags && a.flags === b.flags) return 'match';
  }
  return 'unknown';
}

// „dovada" potrivirii, pentru UI/loguri: „an 2024 · varianta 7 · simulare"
function describeTokens(tk) {
  if (!tk) return '';
  const bits = [];
  if (tk.year) bits.push(`an ${tk.year}`);
  if (tk.variant) bits.push(`${tk.kind === 'test' ? 'testul' : 'varianta'} ${tk.variant}`);
  if (tk.flags) bits.push(tk.flags.split(',').join(' · '));
  if (tk.profile) bits.push(tk.profile);
  return bits.join(' · ');
}

// ── BAREMUL INCLUS în același PDF (ex. simulări județene: subiecte + barem) ──
// Tăiem textul la titlul „BAREM DE EVALUARE (ȘI DE NOTARE)" de pe un rând
// propriu, aflat DUPĂ o parte de test consistentă. Un document care ESTE barem
// (titlul apare chiar în antet) nu se taie.
function splitEmbeddedBarem(text) {
  const src = String(text || '');
  if (src.length < 1000) return null;
  // titlul baremului pe rând propriu (eventual urmat de „Varianta 2" / „Model")
  const headingRe = /^[ \t]*BAREM(?:UL)?\b(?:\s+DE\s+(?:EVALUARE|CORECTARE|NOTARE)(?:\s+(?:ȘI|SI|ŞI)\s+(?:DE\s+)?NOTARE)?)?[ \t]*:?(?:\s+(?:varianta|var\.?|model(?:ul)?|simulare|testul?)\b[^\n]{0,12})?[ \t]*$/i;
  if (/BAREM(?:UL)?\s+DE\s+(?:EVALUARE|CORECTARE|NOTARE)/i.test(src.slice(0, 600))) return null; // e chiar un barem
  const lines = src.split('\n');
  let pos = 0;
  for (const line of lines) {
    if (pos >= 600 && line.length <= 70 && !/pagina/i.test(line) && headingRe.test(line)) {
      const test = src.slice(0, pos).trim();
      const barem = src.slice(pos).trim();
      if (test.length >= 600 && barem.length >= 300 && /SUBIECTUL/i.test(test)) return { test, barem };
    }
    pos += line.length + 1;
  }
  return null;
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
  m = t.match(/\b(?:ex|exercitiul?|exercitiu|problema|punctul|intrebarea|cerinta|itemul|item)\s*([1-9])\b/);
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

// începutul unui exercițiu: „2." / „2)" la început de rând (nu „2.5"); în
// subiectele oficiale punctajul stă în stânga itemului — „5p 2. Rezultatul..."
function exStartRe(n) { return new RegExp(`(?:^|\\n)[ \\t]*(?:\\(?\\d{1,2}\\s*p\\)?\\.?[ \\t]+)?${n}\\s*[\\.\\)](?!\\d)`); }

// secțiunile „SUBIECTUL I / al II-lea / al III-lea" dintr-un text
function subjectSections(text) {
  const src = String(text || '');
  const secs = [...src.matchAll(/SUBIECTUL\s+(?:al\s+)?(I{1,3}|[123])(?:\s*-?\s*lea)?/gi)]
    .map((m) => ({ idx: m.index, sub: ROMAN[String(m[1]).toLowerCase()] }));
  return secs.map((s, i) => ({ sub: s.sub, idx: s.idx, text: src.slice(s.idx, i + 1 < secs.length ? secs[i + 1].idx : src.length) }));
}

// Taie din `text` fragmentul corespunzător referinței. null = negăsit sigur.
// opts.minLen — lungimea minimă acceptată (implicit 15; la răspunsurile scurte
// din baremele EN — „3. c. 5p" — se dă mai mic); opts.ignoreLetter — la grile
// literele sunt VARIANTE de răspuns, nu subpuncte.
function sliceExercise(text, ref, opts = {}) {
  const minLen = opts.minLen == null ? 15 : opts.minLen;
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
  // 2) exercițiul (până la următorul exercițiu sau până la următorul SUBIECT)
  if (ref.ex) {
    const i = src.search(exStartRe(ref.ex));
    if (i === -1) return null;
    const rest = src.slice(i + 1);
    const ends = [rest.search(exStartRe(ref.ex + 1)), rest.search(/\n[ \t]*SUBIECTUL\s+(?:al\s+)?(?:I{1,3}|[123])\b/i)].filter((k) => k !== -1);
    src = ends.length ? src.slice(i, i + 1 + Math.min(...ends)) : src.slice(i);
  }
  // 3) litera („b)" precedată de spațiu/rând nou — nu „(a+b)")
  if (ref.letter && !opts.ignoreLetter) {
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
  return src.length >= minLen ? src : null;
}

function formatRef(ref) {
  if (!ref) return null;
  return [ref.subject, ref.ex, ref.letter].filter(Boolean).join('.');
}

// ═══════════════════════════════════════════════════════════════════════════
// GRILELE din baremele de EVALUARE NAȚIONALĂ (Subiectul I și II, din 2020):
// baremul NU are rezolvare, ci un tabel cu litera corectă a fiecărui item:
//   Nr. item   | 1. | 2. | 3. | 4. | 5. | 6.
//   Rezultate  | c. | d. | b. | a. | c. | d.
//   Punctaj    | 5p | 5p | 5p | 5p | 5p | 5p
// (sau, pe verticală, „3. c. 5p"). Răspuns: { I: {1:'c', ...}, II: {...} }.
// ═══════════════════════════════════════════════════════════════════════════
function grilaAnswers(baremText) {
  const out = {};
  for (const sec of subjectSections(baremText)) {
    if (sec.sub !== 'I' && sec.sub !== 'II') continue;
    const map = {};
    const lines = sec.text.split('\n').map((l) => l.trim()).filter(Boolean);
    // (a) tabel orizontal: rândul cu numerele itemilor + rândul cu literele
    //     (sau amândouă pe același rând: „1. c. 2. d. 3. b. …")
    const LABELS = new Set(['nr', 'numar', 'numarul', 'item', 'itemul', 'itemului', 'itemi', 'de', 'ordine', 'crt', 'intrebare', 'intrebarea', 'intrebarii', 'exercitiu', 'exercitiul', 'exercitiului', 'subiect', 'punct', 'rezultat', 'rezultate', 'raspuns', 'raspunsul', 'raspunsuri', 'corect', 'corecte', 'punctaj']);
    for (let i = 0; i < lines.length && !Object.keys(map).length; i++) {
      const nums = [...lines[i].matchAll(/(?:^|\s)([1-9])\s*[.)]?(?=\s|$)/g)].map((m) => parseInt(m[1], 10));
      if (nums.length < 4) continue;
      const rest = norm(lines[i].replace(/(?:^|\s)[1-9]\s*[.)]?(?=\s|$)/g, ' ')).split(' ').filter((w) => w.length >= 3 && !LABELS.has(w) && !/^\d+p$/.test(w));
      if (rest.length) continue; // un rând de enunț, nu antetul tabelului
      for (let j = i; j <= i + 3 && j < lines.length; j++) {
        const letters = [...lines[j].matchAll(/(?:^|\s)([a-d])\s*[.)]?(?=\s|$)/gi)].map((m) => m[1].toLowerCase());
        if (letters.length === nums.length) {
          nums.forEach((n, k) => { map[n] = letters[k]; });
          break;
        }
      }
    }
    // (b) pe verticală / inline: „3. c. 5p" sau „3. c) 5 puncte"
    if (!Object.keys(map).length) {
      const re = /(?:^|\n|\s)([1-9])\s*[.)]\s*([a-d])\s*[.)]?\s*\d\s*p(?:uncte)?\b/gi;
      for (const m of sec.text.matchAll(re)) map[parseInt(m[1], 10)] = m[2].toLowerCase();
    }
    if (Object.keys(map).length >= 3) out[sec.sub] = map;
  }
  return out;
}

// răspuns SCURT dintr-un fragment de barem de o singură cerință: „3. 24 5p",
// „3. c. 5p", „2. 3,5 cm 5p" → „24" / „c" / „3,5 cm" (baremele vechi de EN,
// Subiectul I/II = doar rezultatul). null dacă fragmentul e o rezolvare reală.
function shortAnswerOf(frag) {
  const one = String(frag || '').replace(/\s+/g, ' ').trim();
  if (!one || one.length > 60) return null;
  const m = one.match(/^[1-9]\s*[.)]\s*(.+?)\s*\(?\d+\s*p(?:uncte)?\.?\)?\.?$/i);
  if (!m) return null;
  const ans = m[1].replace(/[.)]$/, '').trim();
  if (!ans || ans.length > 30) return null;
  // „3. Se acordă 5p" NU e un rezultat — un rezultat are cifre sau e o literă/expresie scurtă
  if (!/\d/.test(ans) && !/^[a-d]$/i.test(ans) && /[a-zA-ZăâîșțĂÂÎȘȚ]{4,}/.test(ans)) return null;
  return ans;
}

// Itemul de barem pentru referința elevului — deterministic:
//   { text, kind: 'grila', litera }     → grilă EN (litera oficială)
//   { text, kind: 'rezultat', raspuns } → doar rezultatul (bareme vechi EN)
//   { text, kind: 'rezolvare' }         → pași de rezolvare (BAC, EN Subiectul III)
// null = nu s-a putut izola sigur.
function locateBaremItem(baremText, ref) {
  if (!baremText || !ref || !ref.ex) return null;
  const grile = grilaAnswers(baremText);
  const subject = ref.subject; // fără subiect precizat nu ghicim grila (I.3 ≠ II.3)
  if (!subject && Object.keys(grile).some((s) => grile[s][ref.ex])) return null; // itemul există și în grile → ambiguu
  if (subject && grile[subject] && grile[subject][ref.ex]) {
    const litera = grile[subject][ref.ex];
    return { kind: 'grila', litera, text: `${subject}.${ref.ex} — răspunsul corect: ${litera}) (5 puncte; se punctează doar rezultatul)` };
  }
  const frag = sliceExercise(baremText, ref, { minLen: 4 });
  if (!frag) return null;
  const short = shortAnswerOf(frag);
  if (short) {
    if (/^[a-d]$/i.test(short)) {
      return { kind: 'grila', litera: short.toLowerCase(), text: `${formatRef(ref)} — răspunsul corect: ${short.toLowerCase()}) (5 puncte; se punctează doar rezultatul)` };
    }
    return { kind: 'rezultat', raspuns: short, text: `${formatRef(ref)} — rezultatul corect: ${short} (se punctează doar rezultatul)` };
  }
  return frag.length >= 15 ? { kind: 'rezolvare', text: frag } : null;
}

module.exports = {
  norm, isBaremTitle, isBaremRow, fileNameOf, profileOf, examOf, yearOf, tokensFromText, tokensOf, tokensStrictMatch,
  matchBarem, tokensContradict, tokensAgreement, pickByContentScore, contentMatchScore,
  docTokens, docsCompatible, describeTokens, splitEmbeddedBarem,
  parseExerciseRef, sliceExercise, subjectSections, formatRef, grilaAnswers, shortAnswerOf, locateBaremItem,
};
