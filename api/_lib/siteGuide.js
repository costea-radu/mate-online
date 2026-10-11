// =====================================================================
// api/_lib/siteGuide.js — GHIDUL SITE-ULUI în widgetul Profesorului Virtual
// (fără AI: răspunsuri fixe, corecte, cost 0)
//
// Întrebările care NU sunt despre o problemă de matematică anume — „ajută-mă la
// subiectul 1 bac", „cum mă pregătesc pentru EN", „unde găsesc variante", „vreau
// meditații", „cât costă", „bună" — primesc un răspuns cu arhitectura site-ului:
// ce e la acel subiect (structura OFICIALĂ a examenului, nu ce „își amintește"
// modelul) și unde îl lucrează: Pregătirea de examen (direct pe exercițiul cerut),
// meditațiile live, testele interactive, PDF-urile cu barem, Planul meu.
// Înainte, modelul răspundea din memorie și greșea (ex. polinoamele „la Subiectul I"
// la BAC — ele sunt la Subiectul al II-lea, ex. 2).
//
// Întrebările de MATEMATICĂ (expresii, formule, noțiuni: ecuații, funcții, matrice…)
// merg în continuare la profesor (modelul AI); la ele, `footer` adaugă trimiteri
// spre meditații și teste interactive din site.
//
// Folosit de api/ai-chat.js și api/ai-chat-stream.js. Teste: test/site-guide.test.js.
// =====================================================================
const L = require('./live');
// pregatire → liveLesson → ai: încărcată leneș (ai.js citește de aici structura examenelor)
let _P = null;
const P = () => (_P || (_P = require('./pregatire')));

// litere mici, fără diacritice (ă â î ș ț → a a i s t)
const fold = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

// ─── Ce e matematică: expresii / simboluri / noțiuni ─────────────────────────
const MATH_SYM = /[=<>≤≥≠√∫π∞^]|\\frac|\\sqrt|\$|\d\s*[-+*/·×]\s*\d|\d\s*%|\b[a-z]\s*\(\s*[a-z0-9]\s*\)|\b[xyz]\b|\b(sin|cos|tg|ctg|log|ln|lg|lim)\b/;
const MATH_WORDS = new RegExp([
  'ecuati', 'inecuati', '\\bfuncti(a|e|ei|ii|ile|iilor)?\\b', 'derivat', 'integral', 'primitiv', 'polinom',
  '\\bmatric', 'determinant', 'logaritm', 'radical', 'fracti(a|e|ei|i|ii|ile|ilor)?\\b', 'procent', '\\bputer(e|ea|i|ile|ilor)\\b',
  'exponent', 'triunghi', 'patrat', 'dreptunghi', '\\bcerc', '\\bunghi', '\\bari(a|e|ei)\\b', 'perimetr', '\\bvolum',
  'teorem', 'pitagora', 'thales', '\\bvector', 'progresi', 'combinari', 'aranjament', 'permutari', 'probabilit',
  'trigonometr', '\\bsinus', 'cosinus', 'tangent', '\\bnumer(e|ele)? complex', '\\bnumar(ul)? complex', '\\bmodul(ul)? (unui|numarului)',
  '\\bmedi(a|e|ei) (aritmetic|geometric|ponderat)', '\\bmultim(e|ea|i|ile|ilor)\\b', '\\binterval', 'divizor', '\\bmultipl(u|ul|i|ii)\\b',
  'cmmdc', 'cmmmc', '\\bnumer(e|ele)? prime\\b', '\\b(numar|numarul|numere|numerele) (par|impar|prim|natural|intreg|rational|real|irational)',
  'monoton', 'asimptot', '\\bgrafic(ul|ului)?\\b', 'parabol', '\\bsegment', 'paralel', 'perpendicular', 'bisectoar',
  '\\bmedian(a|e|ei)\\b', 'inaltim', 'diagonal', '\\bromb', 'trapez', 'paralelogram', '\\bcub(ul|ului)?\\b', 'piramid',
  '\\bprism', 'cilindr', '\\bsfer(a|ei|e)\\b', 'simetric', 'lege(a)? de compozitie', '\\bgrup(ul)? (abelian|comutativ)',
  'structur(a|i) de grup', 'radacin', 'necunoscut', 'numitor', 'numarator', 'zecimal', 'periodic', 'proportii',
  'regula de trei', '\\badunar', '\\bscader', 'inmultir', 'impartir', 'demonstr', 'simplific', 'descompun', '\\bexpresi(a|e|ei|ile)\\b',
].join('|'));
// câteva pași de calcul scriși în cuvinte („cât face 25 la sută din 80")
const MATH_TALK = /\bcat (face|fac|este|e)\s+\d|\bla suta din\b/;

// ─── Ce e despre site / examen / pregătire ───────────────────────────────────
const EXAM_RE = /\b(bac|bacalaureat\w*|evaluare\w*|en|examen\w*|simular\w*|variant\w*|barem\w*|model(e|ul)? de (subiect|test)\w*|subiect\w*|tez(a|e|ele)|lucrar(e|ea|i)|olimpiad\w*)\b/;
const SITE_RE = /(meditati|profesor(ul)? virtual|prof(\.|esorul)? tudor|planul meu|pregatire\w* (de|pentru) examen|\b1[ -]la[ -]1\b|\blive\b|abonament|\bpret(ul|uri|urile)?\b|\bcost(a|ul|uri)\b|\bplat(a|esc|esti|i)\b|\bcont(ul)?\b|parol|inregistr|autentific|\blogare\b|\bsite(ul)?\b|platform|\baplicati|interactiv|\bpdf\b|culegere|\bmanual|auxiliar|\bexercitii(le)?\b|\bteste(le)?\b|\btest(ul)?\b)/;
const HELP_RE = /(\bajut(a|ati|or)\w*|\bam nevoie\b|\bvreau sa (invat|ma pregatesc|exersez|lucrez|fac)\b|\bcum (ma pregatesc|invat|incep|functioneaza|folosesc|lucrez)\b|\bde unde (sa )?incep\b|\bunde (gasesc|sunt|e|este|pot|lucrez)\b|\bce (pot|poti|stii) (sa )?(fac|faci)\b|\bcine esti\b|\bce esti\b)/;
const GREET_RE = /^(salut(are)?|buna( ziua| seara| dimineata)?|hei|hey|hello|hi|servus|ceau|neata)[\s!.,?]*$/;
const THANKS_RE = /^(ok|bine|super|perfect)?[\s,]*(multumesc( frumos| mult)?|mersi( mult)?|merci|ms|mss|multam|thanks|thank you|mul?tumesc)[\s!.,?]*$/;

// ─── Ce a cerut: examenul, profilul, subiectul, exercițiul, clasa ────────────
const ROMAN = { i: 1, ii: 2, iii: 3, iv: 4, v: 5, vi: 6, vii: 7, viii: 8, ix: 9, x: 10, xi: 11, xii: 12 };
const SUB_WORD = { i: 'I', 1: 'I', intai: 'I', unu: 'I', ii: 'II', 2: 'II', doi: 'II', doilea: 'II', iii: 'III', 3: 'III', trei: 'III', treilea: 'III' };
function parse(t) {
  let exam = null, profile = null, sub = null, ex = null, letter = null, grade = null;
  if (/\b(mate[- ]?info\w*|m1|m_mate|matematica[- ]informatica|real|informatica)\b/.test(t)) profile = 'mate-info';
  else if (/\b(stiint\w*|st[- ]?nat\w*|m2|naturii)\b/.test(t)) profile = 'stiinte-naturii';
  else if (/\b(tehnolog\w*|tehn|m3)\b/.test(t)) profile = 'tehnologic';
  const g = /\bclas(a|ei)\s*(a\s*)?(\d{1,2}|[ivx]{1,4})(-?a)?\b/.exec(t);
  if (g) { const n = /^\d+$/.test(g[3]) ? Number(g[3]) : ROMAN[g[3]]; if (n >= 5 && n <= 12) grade = n; }
  if (/\b(bac|bacalaureat\w*)\b/.test(t) || profile || grade === 12) exam = 'bac';
  else if (/\b(en|evaluare\w*|capacitate)\b/.test(t) || grade === 8) exam = 'en';
  // „subiectul 1", „subiectul al II-lea", „S. II", „s1" (dar nu „și" → „si")
  const s = /\bsubiect(ul)?\s*(al\s*)?(iii|ii|i|1|2|3|intai|unu|doilea|doi|treilea|trei)\b/.exec(t) || /\bs(?:\.\s?(iii|ii|i)|\s?([123]))\b/.exec(t);
  if (s) sub = SUB_WORD[s[3] || s[1] || s[2]] || null;
  const e = /\b(ex(ercitiul|\.)?|problema|itemul)\s*(nr\.?\s*)?([1-6])\s*([abc])?\b/.exec(t);
  if (e) { ex = Number(e[4]); letter = e[5] || null; }
  const l = /\b(sub)?punctul\s*([abc])\b/.exec(t);
  if (l) letter = l[2];
  return { exam, profile, sub, ex, letter, grade };
}

// Pagina pe care e elevul completează ce n-a spus: pe /bacalaureat/tehnologic,
// „ajută-mă la subiectul 1" e despre BAC Tehnologic
function withPage(p, page) {
  const pg = String(page || '');
  const out = { ...p };
  const b = /^\/bacalaureat(?:\/(mate-info|stiinte-naturii|tehnologic))?(?:[/?#]|$)/.exec(pg);
  if (b) { if (!out.exam) out.exam = 'bac'; if (out.exam === 'bac' && !out.profile && b[1]) out.profile = b[1]; }
  if (!out.exam && /^\/evaluare-nationala(?:[/?#]|$)/.test(pg)) out.exam = 'en';
  const c = /^\/clase\/(\d{1,2})(?:[/?#]|$)/.exec(pg);
  if (!out.grade && c && Number(c[1]) >= 5 && Number(c[1]) <= 12) out.grade = Number(c[1]);
  if (!out.exam && out.grade === 8) out.exam = 'en';
  if (!out.exam && out.grade === 12) out.exam = 'bac';
  return out;
}

// Ce fel de întrebare e (null = profesorul răspunde, cu modelul AI):
//   'thanks' | 'hello' | 'exam' | 'meditatii' | 'preturi' | 'cont' | 'materiale' | 'clasa' | 'general'
// Doar în widgetul general — nu pe un PDF/test deschis, nu pe tabla din „Planul meu",
// nu pentru profesori/părinți (au alt asistent), nu cu poze.
const GUIDE_MODES = new Set(['tutor', 'explain', 'hint', 'assistant']);
function route({ message, mode = 'tutor', context = {}, conversationId = null, images = null, regenerate = false } = {}) {
  if (regenerate || !GUIDE_MODES.has(mode)) return null;
  const c = context || {};
  if (c.pdf || c.interactive || c.meditatii || c.tabla || c.exerciseText || c.attachedText || c.contentId) return null;
  if (Array.isArray(images) && images.length) return null;
  const t = fold(message).replace(/\s+/g, ' ').trim();
  if (!t || t.length > 300) return null;                 // un enunț lung e matematică
  if (THANKS_RE.test(t)) return { kind: 'thanks' };
  if (MATH_SYM.test(t) || MATH_WORDS.test(t) || MATH_TALK.test(t)) return null;
  if (GREET_RE.test(t)) return { kind: 'hello' };
  const said = parse(t);
  const p = withPage(said, c.page);
  const site = SITE_RE.test(t), exam = EXAM_RE.test(t), help = HELP_RE.test(t);
  if (!site && !exam && !help && !said.grade) return null;   // neclar → profesorul
  let kind = 'general';
  if (/meditati|profesor(ul)? virtual|prof(\.|esorul)? tudor|\b1[ -]la[ -]1\b|\blive\b|planul meu/.test(t) && !p.sub) kind = 'meditatii';
  else if (/abonament|\bpret|\bcost(a|ul|uri)\b|\bplat(a|esc|esti|i)\b/.test(t)) kind = 'preturi';
  else if (/\bcont(ul)?\b|parol|inregistr|autentific|\blogare\b/.test(t)) kind = 'cont';
  else if (said.exam || said.sub || (p.exam && (exam || help))) kind = 'exam';
  else if (p.grade) kind = 'clasa';
  else if (/\bpdf\b|variant|barem|simular|interactiv|\bteste(le)?\b|\btest(ul)?\b|culegere|\bmanual|auxiliar|\bexercitii/.test(t)) kind = 'materiale';
  // într-o discuție în curs, „unde găsesc exerciții de felul ăsta?" ține de subiectul
  // discuției → profesorul (știe despre ce vorbeați); ghidul ia doar cererile clare
  if (conversationId && (kind === 'general' || kind === 'materiale')) return null;
  return { kind, ...p };
}

// ─── Structura OFICIALĂ a examenelor (fără AI: nu se poate încurca) ──────────
const STRUCT = {
  bac: {
    name: 'BAC la matematică',
    total: '3 subiecte × 30 de puncte (+10 din oficiu), 3 ore',
    I: '6 exerciții scurte, câte 5 puncte — calcule și numere (progresii, logaritmi, puteri), funcții, ecuații, probabilități, geometrie analitică (vectori) și trigonometrie',
    II: '2 probleme a câte 15 puncte (cu a, b, c) — ex. 1: matrice, determinanți, sisteme de ecuații; ex. 2: legi de compoziție sau polinoame',
    III: '2 probleme de analiză, a câte 15 puncte (cu a, b, c) — ex. 1: funcții (limite, derivate, monotonie, asimptote); ex. 2: integrale',
  },
  en: {
    name: 'Evaluarea Națională la matematică',
    total: '3 subiecte × 30 de puncte (+10 din oficiu), 2 ore',
    I: '6 exerciții grilă, câte 5 puncte — calcule cu numere, operații, procente, ecuații simple',
    II: '6 exerciții grilă, câte 5 puncte — mai ales geometrie',
    III: '6 probleme cu rezolvare completă (cu a, b) — algebră și geometrie, în plan și în spațiu',
  },
};
const SUB_TITLE = { I: 'Subiectul I', II: 'Subiectul al II-lea', III: 'Subiectul al III-lea' };
const PROFILE_LABEL = { 'mate-info': 'Mate-Info', 'stiinte-naturii': 'Științele Naturii', tehnologic: 'Tehnologic' };

const examPage = (exam, profile) => (exam === 'bac' ? `/bacalaureat${profile ? `/${profile}` : ''}` : '/evaluare-nationala');
const examLabel = (exam, profile) => (exam === 'bac' ? `BAC${profile ? ` ${PROFILE_LABEL[profile]}` : ''}` : 'EN');
const liveTimes = () => { try { return L.intervals().map((i) => i.label).join(' și ') || '17:00–19:00'; } catch { return '17:00–19:00'; } };
const bullets = (xs) => xs.filter(Boolean).map((x) => `• ${x}`).join('\n');
const ASK = 'Ai un exercițiu anume? Scrie-mi enunțul sau trimite o poză 📷 și ți-l explic pas cu pas.';

// exercițiul cerut, ca poziție din Pregătirea de examen (ex. „III.2.b"), dacă există
function prepPos({ exam, sub, ex, letter }) {
  if (!exam || !sub) return null;
  const tries = [ex && letter ? `${sub}.${ex}.${letter}` : null, ex ? `${sub}.${ex}` : null, `${sub}.1`].filter(Boolean);
  for (const pos of tries) { const p = P().positionOf(exam, pos); if (p) return p; }
  return null;
}

function resources({ exam = null, profile = null, pos = null }) {
  const lbl = exam ? examLabel(exam, profile) : null;
  const where = exam ? `sala de ${exam === 'bac' ? 'BAC' : 'EN'}` : 'câte o sală pentru EN și pentru fiecare profil de BAC';
  return bullets([
    // (eticheta linkului fără „. " — widgetul împarte textul în propoziții pentru voce)
    `**Pregătire de examen** (1-la-1 cu Prof. Tudor): exercițiu cu exercițiu, din subiectele oficiale, explicate pe barem. ${pos ? `[Începe cu ${pos.label}](/meditatii/pregatire?pos=${pos.pos})` : '[Pregătire de examen](/meditatii/pregatire)'}`,
    `**Meditații live**: zilnic, ${liveTimes()}, ${where} — sau 1-la-1 oricând, pe subiectul ales. [Meditații live](/meditatii)`,
    exam
      ? `**Teste interactive**: te verifici pe loc, cu explicații la fiecare întrebare. [Teste interactive ${lbl}](${examPage(exam, profile)})`
      : '**Teste interactive**, cu explicații la fiecare întrebare: [Evaluarea Națională](/evaluare-nationala) · [Bacalaureat](/bacalaureat)',
    exam
      ? `**Subiecte PDF cu barem** (exerciții pe subiecte, variante, simulări): deschide unul și întreabă-mă acolo — citesc enunțul și baremul lui. [PDF-uri ${lbl}](${examPage(exam, profile)}?tab=pdf)`
      : '**Subiecte PDF cu barem** (variante, simulări): [EN](/evaluare-nationala?tab=pdf) · [BAC](/bacalaureat?tab=pdf) — deschide unul și întreabă-mă acolo: citesc enunțul și baremul lui.',
  ]);
}

function answer(r) {
  const p = r || {};
  switch (p.kind) {
    case 'thanks':
      return 'Cu plăcere! 😊 Când mai ai nevoie, scrie-mi un exercițiu — sau intră în [Planul meu](/meditatii/plan).';
    case 'hello':
    case 'general':
      return [
        `${p.kind === 'hello' ? 'Bună! ' : ''}Sunt **Profesorul Virtual** de pe ExamenMate: te ajut la matematică, la clasele 5–12, la Evaluarea Națională și la BAC. ${ASK}`,
        'Pe site mai găsești:',
        bullets([
          '**Teste interactive și PDF-uri cu barem**: [Evaluarea Națională](/evaluare-nationala) · [Bacalaureat](/bacalaureat) · pe clase, de la [clasa a 5-a](/clase/5) la [a 12-a](/clase/12)',
          `**Meditații live** zilnic (${liveTimes()}) și **1-la-1** oricând, cu Prof. Tudor: [Meditații live](/meditatii)`,
          '**Pregătire de examen**, exercițiu cu exercițiu: [Pregătire de examen](/meditatii/pregatire)',
          '**Planul meu**: test inițial, plan personalizat, lecții pe tablă, teme corectate: [Planul meu](/meditatii/plan)',
        ]),
      ].join('\n\n');
    case 'meditatii':
      return [
        '**Meditațiile de pe ExamenMate** (cu Prof. Tudor, profesor virtual):',
        bullets([
          `**Live, de grup**: zilnic, ${liveTimes()}, câte o sală pentru EN și pentru fiecare profil de BAC — ${L.PRICE_GROUP_LEI()} lei ședința sau incluse în abonament. [Meditații live](/meditatii)`,
          `**1-la-1, oricând**: alegi subiectul și exercițiile; ${L.PRIVATE_MINUTES()} de minute, prelungite până termini — ${L.PRICE_PRIVATE_LEI()} lei sau ${L.PRIVATE_INCLUDED()} pe lună incluse în abonament.`,
          '**Pregătire de examen**: exercițiu cu exercițiu, în ordinea din examen, tot 1-la-1. [Pregătire de examen](/meditatii/pregatire)',
          '**Planul meu**: test inițial, plan personalizat, lecții pe tablă, teme corectate. [Planul meu](/meditatii/plan)',
        ]),
        'Toate prețurile: butonul „💳 Prețuri" din pagina [Meditații live](/meditatii).',
      ].join('\n\n');
    case 'preturi':
      return [
        '**Prețuri ExamenMate:**',
        bullets([
          'Abonamentul (lunar sau anual): [Prețuri](/preturi)',
          `Meditație live de grup: ${L.PRICE_GROUP_LEI()} lei — inclusă în abonament`,
          `Meditație 1-la-1 sau Pregătire de examen: ${L.PRICE_PRIVATE_LEI()} lei ședința — ${L.PRIVATE_INCLUDED()} pe lună incluse în abonament`,
          'Câte o meditație 1-la-1 gratuită pentru fiecare examen (EN și fiecare profil de BAC), fără abonament: [Meditații live](/meditatii)',
        ]),
      ].join('\n\n');
    case 'cont':
      return 'Contul tău (abonamentul, rezultatele, asocierile): [Contul meu](/profil). Ai uitat parola? [Resetare parolă](/resetare-parola). Abonamentul: [Prețuri](/preturi).';
    case 'clasa': {
      const g = p.grade;
      return [
        `**Clasa a ${g}-a** pe ExamenMate:`,
        bullets([
          `**Exerciții și teste pe capitole** (interactive și PDF): [Clasa a ${g}-a](/clase/${g})`,
          '**Planul meu**: test inițial, plan personalizat, lecții explicate pe tablă, teme corectate: [Planul meu](/meditatii/plan)',
          g === 8 || g === 12 ? `**${g === 8 ? 'Evaluarea Națională' : 'Bacalaureatul'}**: [${g === 8 ? 'EN' : 'BAC'}](${g === 8 ? '/evaluare-nationala' : '/bacalaureat'})` : null,
        ]),
        ASK,
      ].join('\n\n');
    }
    case 'materiale':
      return [
        '**Unde găsești materialele pe ExamenMate:**',
        bullets([
          '**Teste interactive** (te verifici pe loc, cu explicații): [Evaluarea Națională](/evaluare-nationala) · [Bacalaureat](/bacalaureat) · pe clase: [clasa a 5-a](/clase/5) … [a 12-a](/clase/12)',
          '**PDF-uri cu barem** (variante, simulări, exerciții pe subiecte): [EN](/evaluare-nationala?tab=pdf) · [BAC](/bacalaureat?tab=pdf)',
          '**Exerciții interactive generate pe loc**, pe tema dorită: [Profesorul Virtual](/profesor-virtual)',
          '**Rezolvări și teorie**: [Rezolvări](/rezolvari)',
        ]),
        'Deschide un PDF și întreabă-mă acolo: citesc enunțul și baremul lui.',
      ].join('\n\n');
    case 'exam':
    default: {
      const exam = p.exam;
      const pos = prepPos(p);
      const S = exam ? STRUCT[exam] : null;
      const head = [];
      if (p.sub && S) {
        head.push(`**${SUB_TITLE[p.sub]} la ${exam === 'bac' ? `BAC${p.profile ? ` (${PROFILE_LABEL[p.profile]})` : ''}` : 'Evaluarea Națională'}**: ${S[p.sub]}.`);
      } else if (p.sub) {
        head.push(`**${SUB_TITLE[p.sub]}** — la BAC: ${STRUCT.bac[p.sub]}.`, `La Evaluarea Națională: ${STRUCT.en[p.sub]}.`);
      } else if (S) {
        head.push(`**${S.name}**: ${S.total}.`, bullets(['I', 'II', 'III'].map((k) => `${SUB_TITLE[k]}: ${S[k]}`)));
      } else {
        head.push('**Pregătirea pentru examen pe ExamenMate** (Evaluarea Națională sau BAC):');
      }
      return [
        ...head,
        p.sub ? 'Pe ExamenMate îl lucrezi așa:' : 'Pe ExamenMate te pregătești așa:',
        resources({ exam, profile: p.profile, pos }),
        exam === 'bac' && !p.profile ? 'La BAC, alege-ți profilul (Mate-Info, Științele Naturii sau Tehnologic) pe pagina de teste.' : null,
        ASK,
      ].filter(Boolean).join('\n\n');
    }
  }
}

// ─── Trimiterile din răspunsurile de MATEMATICĂ (de la model) ────────────────
// La prima întrebare dintr-o discuție (sau când pomenește examenul / clasa), sub
// explicație: unde exersează pe site. Nu și dacă modelul a dat deja linkurile.
function footer({ message, context = {}, mode = 'tutor', priorCount = 0, reply = '' } = {}) {
  if (!GUIDE_MODES.has(mode)) return '';
  const c = context || {};
  if (c.pdf || c.interactive || c.meditatii || c.tabla || c.exerciseText || c.contentId) return '';
  if (/\]\(\/(meditatii|evaluare-nationala|bacalaureat|clase)/.test(String(reply || ''))) return '';
  const said = parse(fold(message));
  const p = withPage(said, c.page);
  const { exam, grade } = p;
  const mentioned = !!(said.exam || said.grade || said.sub);
  if (priorCount > 0 && !mentioned) return '';
  let links;
  if (exam) {
    const pos = prepPos({ ...p, exam });
    links = [
      `[Teste interactive ${examLabel(exam, p.profile)}](${examPage(exam, p.profile)})`,
      pos && p.sub ? `[Pregătire de examen: ${pos.label}](/meditatii/pregatire?pos=${pos.pos})` : '[Pregătire de examen](/meditatii/pregatire)',
      '[Meditații live](/meditatii)',
    ];
  } else if (grade) {
    links = [`[Exerciții pentru clasa a ${grade}-a](/clase/${grade})`, '[Planul meu](/meditatii/plan)', '[Meditații live](/meditatii)'];
  } else {
    links = ['[Planul meu](/meditatii/plan)', '[Meditații live](/meditatii)', '[Teste EN](/evaluare-nationala)', '[Teste BAC](/bacalaureat)'];
  }
  return `\n\n📚 Exersează și pe site: ${links.join(' · ')}`;
}

// Pentru promptul profesorului (modelul): structura corectă, ca să nu o inventeze
const EXAM_STRUCTURE_PROMPT = `STRUCTURA OFICIALĂ A EXAMENELOR DE MATEMATICĂ (folosește-o EXACT când vorbești despre subiecte; nu muta temele între subiecte):
- BAC (toate profilurile): ${STRUCT.bac.total}. Subiectul I — ${STRUCT.bac.I}. Subiectul al II-lea — ${STRUCT.bac.II}. Subiectul al III-lea — ${STRUCT.bac.III}. Polinoamele și legile de compoziție sunt la Subiectul al II-lea, ex. 2 — NU la Subiectul I.
- Evaluarea Națională (clasa a VIII-a): ${STRUCT.en.total}. Subiectul I — ${STRUCT.en.I}. Subiectul al II-lea — ${STRUCT.en.II}. Subiectul al III-lea — ${STRUCT.en.III}.
Când elevul cere ajutor „la un subiect" fără un exercițiu anume, nu inventa exerciții: spune-i ce conține subiectul și trimite-l la [Pregătire de examen](/meditatii/pregatire), [Meditații live](/meditatii) și la testele interactive / PDF-urile cu barem de pe pagina examenului; cere-i enunțul ca să i-l explici.`;

module.exports = { fold, parse, withPage, route, answer, footer, prepPos, STRUCT, EXAM_STRUCTURE_PROMPT };
