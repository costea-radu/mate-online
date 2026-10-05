// =====================================================================
// api/_lib/liveLesson.js — LECȚIA de meditație live, pregătită pe BAREM
//
// „Fără barem nu explică nimic": lecția se face DOAR pentru un subiect de
// EN/BAC al cărui barem oficial e asociat sigur (ai_pdf_text, vezi
// api/ai-pdf-context.js). Pașii, rezultatele și punctajele vin din barem.
//
// Pregătirea (reluabilă, pe bucăți, cu lacăt — cronul sau prima cerere):
//   1. SCRIPTUL: subiectul și baremul se taie pe SUBIECTUL I / II / III, iar
//      câte un apel AI (în paralel, câte 3 itemi) scrie pentru fiecare item:
//      enunțul curat, întrebarea „încercați singuri" (grilă / de completat),
//      explicația PE BAREM (cu punctajul pașilor) și încă trei moduri —
//      intuitiv, greșeli care costă puncte, altă metodă — plus verificarea.
//      Literele grilelor de EN se verifică DETERMINIST cu baremul (barem.js).
//   2. VOCEA: fiecare segment rostit → Storage (tts.js), cu durata exactă și
//      mișcarea gurii; întâi începutul lecției, ca 1-la-1 să poată porni
//      înainte să fie gata totul.
//   3. Lecția e „gata" când toate segmentele au voce. Se refolosește la toate
//      ședințele (grup și 1-la-1) cu același subiect și profesor.
// =====================================================================
const ai = require('./ai');
const B = require('./barem');
const live = require('./live');
const tts = require('./tts');

const GEN_MODEL = () => process.env.LIVE_GEN_MODEL || ai.GEN_MODEL;
const CHUNK = () => Math.max(1, parseInt(process.env.LIVE_ITEMI_PE_APEL || '3', 10));
const TTS_PARALLEL = () => Math.max(1, parseInt(process.env.LIVE_TTS_PARALEL || '6', 10));

let fixLatex = (s) => s;
try { fixLatex = require('./meditatii').fixLatex || fixLatex; } catch { /* rămâne identitatea */ }

// ─── Secțiunile subiectului și ale baremului ─────────────────────────────────
// Unele PDF-uri repetă „SUBIECTUL I" (antet de pagină, tabelul de punctaj):
// păstrăm, pentru fiecare secțiune, cel mai lung fragment.
function sectionMap(text) {
  const out = {};
  for (const s of B.subjectSections(text)) {
    if (!out[s.sub] || s.text.length > out[s.sub].length) out[s.sub] = s.text;
  }
  return out;
}

// Câți itemi are fiecare secțiune (structura oficială din 2021 încoace).
// La BAC, Subiectele II și III au câte 2 probleme cu a), b), c) → 6 itemi.
function expectedCounts(exam) {
  return exam === 'en' ? { I: 6, II: 6, III: 6 } : { I: 6, II: 6, III: 6 };
}

// Planul apelurilor AI: [{ section, from, to }] — câte CHUNK itemi pe apel
function callPlan(exam, sections) {
  const counts = expectedCounts(exam);
  const plan = [];
  for (const sec of ['I', 'II', 'III']) {
    if (!sections.subject[sec] || !sections.barem[sec]) continue; // fără barem pe secțiune → nu se explică
    const n = counts[sec];
    for (let a = 1; a <= n; a += CHUNK()) plan.push({ section: sec, from: a, to: Math.min(n, a + CHUNK() - 1) });
  }
  return plan;
}

// ─── Paginile PDF (subiect + barem), atașate la fiecare apel ──────────────────
// Textul extras din PDF pierde des formulele: radicalii, liniile de fracție,
// exponenții, integralele, determinanții, matricele („2 2 6 2 3 2" în loc de
// √2·(2√6 − 2√3)). Modelul primește și PAGINILE (content part „file": text +
// imaginea paginii) — doar cele ale secțiunii din apel, ca să rămână ieftin.
// LIVE_PDF_PAGINI=0 → doar textul, ca înainte.
const PDF_PAGES_ON = () => !/^(0|nu|false|no|off)$/i.test(String(process.env.LIVE_PDF_PAGINI || '1').trim());
const SECTION_MAX_PAGES = 3;

// paginile fiecărei secțiuni: de la pagina pe care apare „SUBIECTUL S" până la
// cea pe care începe următorul (inclusiv — secțiunea se poate termina acolo)
function sectionPages(pageTexts) {
  const n = (pageTexts || []).length;
  const first = {};
  (pageTexts || []).forEach((t, i) => { for (const sc of B.subjectSections(t)) if (first[sc.sub] == null) first[sc.sub] = i; });
  const order = ['I', 'II', 'III'];
  const out = {};
  order.forEach((S, k) => {
    if (first[S] == null) return;
    const next = order.slice(k + 1).map((x) => first[x]).find((v) => v != null && v >= first[S]);
    const end = next == null ? n - 1 : next;
    const pages = [];
    for (let p = first[S]; p <= end && pages.length < SECTION_MAX_PAGES; p++) pages.push(p);
    out[S] = pages;
  });
  return out;
}

// { I: [part…], II: […], III: […] } — paginile subiectului și ale baremului, pe secțiuni
async function pdfAttachments({ supa, content, ctx, pdfCtx, log = () => {} }) {
  const out = { I: [], II: [], III: [] };
  if (!PDF_PAGES_ON() || !supa || !pdfCtx || !content?.file_url) return out;
  const pdfpages = require('./pdfpages');
  const add = async (buf, pageTexts, label) => {
    const secs = sectionPages(pageTexts);
    const all = [...Array(Math.min(Math.max(1, pageTexts.length), 4)).keys()];
    for (const S of ['I', 'II', 'III']) {
      const sub = await pdfpages.extractPagesPdf(buf, secs[S] || all).catch(() => null);
      const part = sub && pdfpages.filePart(sub, `${label}-subiectul-${S}.pdf`);
      if (part) out[S].push(part);
    }
  };
  try {
    const buf = await pdfCtx.downloadContentPdf(supa, content);
    const pages = Array.isArray(ctx?.pageTexts) && ctx.pageTexts.length ? ctx.pageTexts : await pdfpages.pageTexts(buf);
    await add(buf, pages, 'subiect');
  } catch (e) { log(`live: paginile subiectului ${content.id}: ${e.message}`); }
  try {
    const bid = ctx?.barem?.id;
    if (bid && bid !== content.id) {
      const { data: bc } = await supa.from('content').select('*').eq('id', bid).maybeSingle();
      if (bc?.file_url) {
        const bbuf = await pdfCtx.downloadContentPdf(supa, bc);
        await add(bbuf, await pdfpages.pageTexts(bbuf), 'barem');
      }
    }
  } catch (e) { log(`live: paginile baremului: ${e.message}`); }
  return out;
}

// Enunțuri stricate de extragerea textului („[formula nu e lizibilă…]") — itemul nu se predă
const UNREADABLE = /(nu\s+(sunt|este|e)\s+(lizibil|vizibil)|ilizibil|\[\s*formula|nu\s+se\s+(poate|pot)\s+citi|textul?\s+extras\s+din\s+pdf|din\s+textul\s+extras)/;
const unreadable = (...texts) => UNREADABLE.test(live.foldRo(texts.filter(Boolean).join(' ')));
// lecțiile scrise înainte: itemii cu enunțul stricat nu mai apar în sală
function dropUnreadable(script) {
  if (!script || !Array.isArray(script.items)) return script;
  const ok = script.items.filter((it) => !unreadable(it.statement, ...(it.options || [])));
  return ok.length === script.items.length || ok.length < 1 ? script : { ...script, items: ok };
}

// ─── Schema răspunsului AI (Structured Outputs, strictă) ─────────────────────
const S = ai.S;
const SAY_DESC = 'ce ROSTEȘTE profesorul: text de citit cu voce tare, fără LaTeX și fără simboluri, maximum 40 de cuvinte';
const BOARD_DESC = '0–4 rânduri scrise pe tablă în timpul segmentului (câte un pas pe rând)';
const BOARD_LINE = S.str('un rând scris pe tablă: un pas al rezolvării, formulele în LaTeX între $...$');
const SEG = S.obj({ say: S.str(SAY_DESC), board: S.arr(BOARD_LINE, BOARD_DESC) });
const SEGS = (d) => S.arr(SEG, d);
const POLL = S.obj({
  type: S.enum(['grila', 'completare']),
  question: S.str('întrebarea (poate conține LaTeX între $...$)'),
  options: S.nullable(S.arr(S.str(), 'exact 4 variante (a, b, c, d) la grilă; null la completare')),
  answer: S.str('grilă: litera corectă (a/b/c/d); completare: rezultatul din barem'),
  explain: S.str('o propoziție: de ce acesta e răspunsul corect'),
});
// ÎNTREBAREA PE PAS: pusă înaintea segmentului în care profesorul scrie pe tablă un
// rezultat intermediar din barem — elevii îl calculează ei, răspund pe ecran, apoi
// profesorul scrie pasul (regula 6b din prompt)
const ASK_PROPS = {
  type: S.enum(['grila', 'completare']),
  question: S.str('întrebarea despre REZULTATUL INTERMEDIAR pe care profesorul îl scrie pe tablă în acest segment; se înțelege și fără tablă (conține expresia sau datele necesare); NU conține rezultatul; LaTeX între $...$'),
  options: S.nullable(S.arr(S.str(), 'exact 4 variante la grilă: rezultatul corect și greșelile tipice; null la completare')),
  answer: S.str('grilă: litera corectă (a/b/c/d); completare: rezultatul intermediar din barem — un singur număr sau o expresie scurtă, în LaTeX fără $ („16", „2x+3", „\\frac{1}{2}", „\\{1, 3\\}")'),
  hint: S.str('un indiciu scurt (formula sau proprietatea de folosit), FĂRĂ rezultat'),
  explain: S.str('o propoziție: de unde vine rezultatul (pasul din barem)'),
  say: S.str('ce spune profesorul cu voce tare când pune întrebarea: fără simboluri și fără rezultat, cel mult 25 de cuvinte („Înainte să scriu, încercați voi: cât este delta? Scrieți rezultatul pe ecran.")'),
};
const ASK = S.obj(ASK_PROPS);
const SEG_BAREM = S.obj({
  say: S.str(SAY_DESC),
  board: S.arr(BOARD_LINE, BOARD_DESC),
  ask: S.nullable(ASK),
});
const ITEM = S.obj({
  ref: S.str('referința: „I.3", „II.5", „III.2" sau, la BAC II/III, „II.1.a"'),
  title: S.str('titlul scurt: „Subiectul I, exercițiul 3"'),
  kind: S.enum(['grila', 'rezultat', 'rezolvare']),
  statement: S.str('enunțul complet, curățat (LaTeX între $...$)'),
  statementTry: S.nullable(S.str('DOAR la „Arătați că / Demonstrați că / Verificați că…" cu rezultat care se calculează: enunțul cu cerința reformulată ca întrebare de calcul, FĂRĂ rezultat („Calculați E(x)."); altfel null')),
  options: S.nullable(S.arr(S.str(), 'variantele a–d, dacă itemul e grilă')),
  answer: S.str('răspunsul final din barem (litera la grilă)'),
  points: S.int('punctajul itemului din barem'),
  barem: S.str('fragmentul de barem al itemului, pe scurt (pașii și punctele)'),
  intro: SEGS('1–2 segmente: anunți itemul și citești enunțul'),
  tryPoll: S.nullable(POLL),
  afterTry: SEGS('0–1 segment scurt de trecere spre răspuns („Să vedem răspunsul corect.")'),
  modes: S.obj({
    barem: S.arr(SEG_BAREM, '3–12 segmente: rezolvarea oficială pas cu pas, cu punctajul pașilor; pe tablă rămâne TOATĂ rezolvarea; „ask" = întrebarea pe pas pusă ÎNAINTEA segmentului (regula 6b), altfel null'),
    intuitiv: SEGS('2–5 segmente: ideea pe înțelesul tuturor'),
    greseli: SEGS('2–4 segmente: greșelile care costă puncte'),
    alta_metoda: S.nullable(SEGS('2–6 segmente: altă metodă corectă, cu același rezultat')),
  }),
  check: S.nullable(POLL),
  afterCheck: SEGS('0–1 segment scurt după verificare'),
});
const SCHEMA = S.obj({ items: S.arr(ITEM) });

// Regulile întrebărilor pe pași (aceleași la scrierea lecției și la completarea
// lecțiilor scrise înainte — addStepQuestions)
const STEP_RULES = [
  'Elevii lucrează EI pașii rezolvării: înaintea fiecărui rezultat intermediar important din barem (un pas care primește puncte: o valoare calculată, o expresie obținută, o ecuație sau o relație, o mulțime de soluții, un determinant, o derivată, o limită, o arie…), profesorul îi întreabă, ei răspund pe ecran, apoi el scrie pasul pe tablă și îl explică.',
  'CEL PUȚIN o întrebare la FIECARE subpunct (a, b, c) al itemului — de preferat la primul pas al subpunctului, înainte să înceapă explicația lui — și câte una la fiecare rezultat intermediar important (în total 2–4 la un item cu mai mulți pași, 1 la un item cu un singur pas).',
  '(1) Rezultatul întrebat NU apare pe tablă și NU e rostit înainte de întrebare: abia în segmentul de după întrebare se scrie pe tablă.',
  '(2) Întrebarea se înțelege singură, fără tablă: conține expresia sau datele de care e nevoie („Cât este $\\Delta$ pentru ecuația $x^2 - 4x + 3 = 0$?", „Ce obțineți pentru $f\'(x)$, dacă $f(x) = x^3 - 3x$?", „Cât este $\\det(A(1))$?") și nu conține rezultatul.',
  '(3) „completare" când răspunsul e un singur număr sau o expresie scurtă (scris în LaTeX fără $: „16", „2x+3", „\\frac{1}{2}", „\\{1, 3\\}"); altfel „grila", cu 4 variante plauzibile — rezultatul corect și greșelile tipice — și litera corectă (a/b/c/d), corecta nu mereu pe aceeași poziție.',
  '(4) „say" = ce spune profesorul cu voce tare când pune întrebarea (fără simboluri, fără rezultat): „Înainte să scriu, încercați voi: cât este delta? Scrieți rezultatul pe ecran."; „hint" = un indiciu scurt (formula, proprietatea), fără rezultat; „explain" = de unde vine rezultatul.',
  '(5) Nu întreba ce scrie deja în enunț: la „Arătați că…" întrebi etapele intermediare, nu rezultatul final din enunț.',
];

function systemPrompt(teacher, exam, profile) {
  const g = teacher.gender === 'f';
  return [
    `Ești ${teacher.name}, ${g ? 'profesoară virtuală' : 'profesor virtual'} de matematică (AI) pe platforma ExamenMate. ${teacher.style || ''}`,
    `Pregătești o meditație online, ca într-o clasă virtuală cu mai mulți elevi, în care explici un subiect de ${live.EXAM_LABEL(exam, profile)}${exam === 'bac' && live.PROFILE_LABELS[profile] ? ` (programa ${live.PROFILE_LABELS[profile]})` : ''} DOAR pe baza baremului oficial.`,
    '',
    'REGULI:',
    '0. FORMULELE: dacă ai paginile PDF atașate (subiectul și baremul), citește formulele DIN PAGINI — textul extras le pierde des (radicali, linii de fracție, exponenți, integrale, determinanți, matrice, vectori, limite, figuri). Transcrie-le exact, în LaTeX între $...$: $\\sqrt{2}$, $\\sqrt[3]{x}$, $\\frac{a}{b}$, $x^{2}$, $a_{n}$, $\\int_{0}^{1} f(x)\\,dx$, $\\lim_{x \\to 2} f(x)$, $\\begin{vmatrix} 1 & 2 \\\\ 3 & 4 \\end{vmatrix}$ (determinant), $\\begin{pmatrix} 1 & 2 \\\\ 3 & 4 \\end{pmatrix}$ (matrice), $\\overrightarrow{AB}$, $\\vec{v}$, $\\log_{2} x$, $\\widehat{ABC}$, $\\mathbb{R}$. Nu scrie NICIODATĂ un enunț cu „[formula nu e lizibilă]" sau „…": dacă un item chiar nu se poate citi nici din pagină, nu îl include.',
    '1. Sursa de adevăr este BAREMUL. Rezultatele, pașii și punctajele le iei din barem. Nu inventa alt rezultat. Dacă un item nu apare în barem, NU îl include.',
    '2. Enunțul îl iei din textul subiectului; corectezi doar greșelile de extragere din PDF (spații, indici, fracții, radicali). Formulele în LaTeX între $...$.',
    '3. Fiecare item se explică în mai multe moduri: „barem" (rezolvarea oficială, pas cu pas, spunând câte puncte se acordă: „pentru acest calcul se acordă 2 puncte"), „intuitiv" (ideea pentru un elev care nu a înțeles: o imagine, o comparație, o verificare rapidă, fără calcule lungi), „greseli" (greșelile tipice și cum se pierd puncte) și „alta_metoda" (o altă rezolvare corectă, cu ACELAȘI rezultat — baremul punctează orice metodă corectă; null dacă nu există una firească).',
    '4. „say" se ROSTEȘTE: scrie exact cum se citește cu voce tare în română — fără LaTeX, fără simboluri: „x la pătrat", „radical din 3", „a supra b", „egal", „ori", „unghiul A B C", „segmentul A B". Numere zecimale cu virgulă („doi virgulă cinci"). Propoziții scurte, cel mult 40 de cuvinte pe segment. Vorbești la persoana a doua plural („încercați", „observați"), ca într-o clasă; nu comenta procente sau cine a răspuns.',
    '5. „board" = ce scrii pe tablă cât timp spui segmentul: 0–4 rânduri scurte, câte un pas pe rând; formulele în LaTeX între $...$ (ex. „$\\Delta = b^2 - 4ac = 16$"). Pe tablă rămân pașii rezolvării, ca pe o tablă adevărată. Pe tablă scrii matematică, nu fraze: cel mult câteva cuvinte de legătură („deci", „așadar", „din (1) și (2)").',
    '5b. REZOLVĂRILE COMPLETE: la itemii cu rezolvare (Subiectele II și III, probleme, demonstrații, calcule în mai mulți pași), în modul „barem" tabla trebuie să ajungă să conțină TOATĂ rezolvarea care ia punctajul maxim, ca în barem: formula sau proprietatea folosită, fiecare transformare pe rândul ei (fără pași săriți; lanțurile de egalități continuă pe rândul următor cu „$= \\ldots$"), rezultatul, cu punctajul pasului la sfârșitul rândului („(2p)"). La itemii-grilă și la cei cu rezultat scurt, baremul dă doar răspunsul: pe tablă scrii totuși CALCULUL care duce la el (2–5 rânduri: formula, înlocuirea, calculul, rezultatul), apoi varianta corectă; nu copia pe tablă tabelul de punctaj („Alt răspuns — 0p"). La itemii cu subpuncte a), b), c) în același enunț (ex. problemele de la Subiectul al III-lea, la EN), primul rând de pe tablă al fiecărui subpunct începe cu litera lui („a) …", „b) …"), iar în „say" spui „La punctul b, …".',
    '5c. Cerințele „Arătați că…", „Demonstrați că…", „Verificați că…" au rezultatul scris chiar în enunț. (1) Dacă rezultatul e o valoare sau o expresie care se CALCULEAZĂ (ex. „Arătați că $E(x) = 4x$", „Arătați că $a = 2$", „Verificați că $f(1) = 3$"), elevii nu trebuie să-l vadă înainte să încerce: în „statementTry" scrii enunțul cu cerința reformulată ca întrebare de calcul, FĂRĂ rezultat („Calculați $E(x)$.", „Determinați numărul $a$.", „Calculați $f(1)$."), restul enunțului rămânând la fel; „tryPoll" = type „completare", cu aceeași întrebare de calcul și rezultatul ca răspuns; în „intro" citești cerința reformulată (fără rezultat). (2) Altfel (ex. „Arătați că triunghiul $ABC$ este dreptunghic"): „statementTry" = null și „tryPoll" = null. (3) În ambele cazuri, în modul „barem" scrii pe tablă ETAPELE INTERMEDIARE din barem, fiecare pe rândul ei (nu doar rezultatul, nu porni de la rezultat), iar la final spui că ați obținut exact ce cerea subiectul („Deci $E(x) = 4x$, exact ce trebuia arătat.").',
    '6. „tryPoll": la itemii-grilă (variante a–d) întrebarea e chiar itemul, cu variantele lui și LITERA corectă din barem (type „grila"); la itemii cu un rezultat scurt, type „completare", cu rezultatul din barem. La itemii cu rezolvare lungă: null (excepție: „Arătați că…" cu rezultat calculabil, vezi 5c). „statementTry" = null la toți ceilalți itemi.',
    '6b. ÎNTREBĂRILE PE PAȘI („ask" în segmentele modului „barem") — DOAR la Subiectele II și III, la itemii cu rezolvare (nu la grile, nu la Subiectul I). „ask" = întrebarea pe care profesorul o pune ÎNAINTEA segmentului în care scrie pe tablă rezultatul intermediar întrebat; la celelalte segmente „ask" = null. ' + STEP_RULES.join(' '),
    '7. „check": la itemii fără tryPoll — o întrebare scurtă de VERIFICARE, la sfârșit (rezultatul final sau un pas-cheie din barem), diferită de întrebările pe pași (grilă cu 4 variante sau completare cu un număr). La itemii cu tryPoll: null.',
    '8. „intro": anunți itemul („Trecem la Subiectul al doilea, exercițiul 4.") și citești enunțul. „afterTry"/„afterCheck": o trecere scurtă („Să vedem răspunsul corect.").',
    '9. Ton: cald, sigur, încurajator; fără glume forțate; fără emoji; fără linkuri.',
  ].join('\n');
}

function userPrompt({ exam, section, from, to, subjectSection, baremSection, title, pages = false }) {
  const bacSub = exam === 'bac' && section !== 'I';
  return [
    `Subiectul: „${title}".`,
    pages ? `Ai atașate PAGINILE PDF ale subiectului${pages === 'barem' ? ' și ale baremului' : ''} pentru Subiectul ${section}: formulele le citești din pagini (regula 0); textul de mai jos ajută doar la ordinea itemilor.` : '',
    `Explică itemii ${from}–${to} din SUBIECTUL ${section} (în ordinea din subiect).`,
    bacSub ? `La acest subiect fiecare problemă are cerințele a), b), c): fiecare literă e un item separat. Itemii 1–3 = problema 1 (a, b, c), itemii 4–6 = problema 2 (a, b, c). Ref: „${section}.1.a", „${section}.1.b", …` : '',
    section !== 'I' && live.STEPS_ON() ? 'Nu uita întrebările pe pași („ask", regula 6b) la itemii cu rezolvare: cel puțin una la fiecare subpunct, înaintea rezultatelor intermediare din barem.' : '',
    '',
    `=== TEXTUL SUBIECTULUI ${section} (extras din PDF) ===`,
    subjectSection.slice(0, 9000),
    '',
    `=== BAREMUL OFICIAL — SUBIECTUL ${section} ===`,
    baremSection.slice(0, 9000),
  ].filter((l) => l !== '').join('\n');
}

// ─── Normalizarea și verificarea deterministă a itemilor ─────────────────────
const LETTERS = ['a', 'b', 'c', 'd'];
const cleanStr = (s, max = 4000) => fixLatex(String(s ?? '').replace(/\u0000/g, '').trim()).slice(0, max);

function cleanSegs(arr, { min = 0, max = 10 } = {}) {
  const out = [];
  for (const s of Array.isArray(arr) ? arr : []) {
    const say = String(s?.say || '').replace(/\s+/g, ' ').trim().slice(0, 420);
    if (!say) continue;
    const board = (Array.isArray(s.board) ? s.board : []).map((b) => cleanStr(b, 200)).filter(Boolean).slice(0, 4);
    out.push({ say, board });
    if (out.length >= max) break;
  }
  return out.length >= min ? out : [];
}

function cleanPoll(p) {
  if (!p || !p.question) return null;
  const type = p.type === 'grila' ? 'grila' : 'completare';
  const poll = { type, question: cleanStr(p.question, 600), answer: String(p.answer ?? '').trim().slice(0, 80), explain: cleanStr(p.explain || '', 300) };
  if (type === 'grila') {
    const opts = (Array.isArray(p.options) ? p.options : []).map((o) => cleanStr(o, 200).replace(/^\s*[a-d]\s*[).]\s*/i, '')).filter(Boolean);
    if (opts.length !== 4) return null;
    poll.options = opts;
    const letter = (/^\s*([a-d])\s*\)?/i.exec(poll.answer) || [])[1];
    if (!letter) return null;
    poll.answer = letter.toLowerCase();
  } else {
    poll.options = null;
    poll.answer = cleanStr(poll.answer, 80).replace(/^\$|\$$/g, '');
    if (!poll.answer) return null;
  }
  return poll;
}

// „II.1.a" → { subject:'II', ex:1, letter:'a' }; „I.3" → { subject:'I', ex:3 }
function parseRef(ref) {
  const m = /^\s*(I{1,3})\s*[.\s]\s*(\d)(?:\s*[.\s]\s*([a-d]))?/i.exec(String(ref || ''));
  return m ? { subject: m[1].toUpperCase(), ex: parseInt(m[2], 10), letter: m[3] ? m[3].toLowerCase() : null } : null;
}
const refKey = (r) => (r ? `${r.subject}.${r.ex}${r.letter ? '.' + r.letter : ''}` : '');

// „Arătați că / Demonstrați că / Verificați că…" — rezultatul e scris în enunț
const SHOW_THAT = (t) => /\b(aratati|demonstrati|verificati|justificati)\s+ca\b/.test(live.foldRo(t));
const normEq = (x) => live.foldRo(String(x || '')).replace(/\$|\\[,;!]|\s+/g, '');
// textul „scapă" rezultatul? („= 4x" sau rezultatul lung, întreg)
function leaksAnswer(text, ans) {
  const a = normEq(ans);
  if (!a) return false;
  const t = normEq(text);
  return t.includes('=' + a) || (a.length >= 4 && t.includes(a));
}

// ═════════════════════════════════════════════════════════════════════════════
// ÎNTREBĂRILE PE PAȘI — Subiectele II și III, itemii cu rezolvare
//
// Profesorul se oprește înaintea rezultatelor intermediare din barem și îi pune pe
// elevi să le calculeze (răspund pe ecran), apoi scrie pasul pe tablă. Cel puțin o
// întrebare la FIECARE subpunct: la BAC itemul e un subpunct (II.1.a); la EN,
// problemele de la Subiectul al III-lea au a), b) în același item.
// Un pas = { at, part, type, question, options, answer, explain, hint, ask:[seg], src }
//   at  = indexul segmentului din modes.barem ÎNAINTEA căruia se pune întrebarea
//         (segmentul care scrie rezultatul pe tablă; = numărul de segmente → la sfârșit)
//   src = 'ai' (scrisă de model) | 'barem' (din rândurile scrise pe tablă, fără AI)
// Verificările sunt deterministe: rezultatul nu e deja pe tablă, întrebarea nu îl
// conține, grila are 4 variante și o literă, cel mult o întrebare înaintea unui
// segment, cel mult MAX_STEPS pe item (întâi câte una pe subpunct).
// ═════════════════════════════════════════════════════════════════════════════
const PASI_V = 1;            // versiunea întrebărilor pe pași dintr-un script (script.pasi)
const MAX_STEPS = 4;
const ASK_SAY = [
  'Înainte să scriu rezultatul, încercați voi: ce se obține la acest pas? Scrieți pe ecran.',
  'Calculați voi pasul acesta și scrieți rezultatul pe ecran. Apoi verificăm împreună.',
  'Hai să vedem dacă vă iese: scrieți pe ecran rezultatul acestui pas.',
];

// itemii care primesc întrebări pe pași: Subiectele II și III, cu rezolvare (nu grilele)
const stepEligible = (it) => !!it && live.STEPS_ON() && (it.section === 'II' || it.section === 'III')
  && it.kind !== 'grila' && !(Array.isArray(it.options) && it.options.length) && Array.isArray(it.modes?.barem) && it.modes.barem.length > 0;

// Subpunctele unui item: la BAC itemul e chiar subpunctul (o singură parte, null);
// la EN, „a) … b) …" din enunț → ['a', 'b']
// (Doar când explicația pe barem arată și ea unde începe fiecare subpunct — altfel
// întrebările n-ar putea fi puse pe subpuncte, iar itemul se tratează ca unul singur.)
function itemParts(it) {
  const r = parseRef(it?.ref);
  if (!r || r.letter) return [null];
  const letters = [];
  for (const m of String(it.statement || '').matchAll(/(?:^|\n|[.:;!?]\s+)\(?([a-d])\)\s*(?=\S)/g)) {
    const l = m[1].toLowerCase();
    if (!letters.includes(l)) letters.push(l);
  }
  if (letters.length < 2 || letters[0] !== 'a') return [null];
  const seen = new Set(markedParts(it.modes?.barem || [], letters));
  return seen.size >= 2 ? letters : [null];
}

// Subpunctul marcat la începutul unui segment: primul rând de pe tablă („b) …") sau
// începutul frazei („La punctul b, …"); null dacă segmentul nu începe un subpunct
function partMark(s, parts) {
  const first = String((s.board || [])[0] || '').replace(/^\s*\$?\s*/, '');
  const m = /^\(?([a-d])\)/i.exec(first)
    || /^\s*(?:(?:acum|apoi|trecem)\s+)?(?:la\s+)?(?:punctul|subpunctul|cerin[țt]a)\s+([a-d])\b/i.exec(String(s.say || ''))
    || /^\s*\(?([a-d])\)/i.exec(String(s.say || ''));
  const l = m ? m[1].toLowerCase() : null;
  return l && parts.includes(l) ? l : null;
}
function markedParts(segs, parts) {
  let cur = parts[0];
  return (segs || []).map((s) => (cur = partMark(s, parts) || cur));
}
// Subpunctul fiecărui segment din explicația pe barem
function segmentParts(segs, parts) {
  if (!parts || parts.length < 2) return (segs || []).map(() => (parts && parts[0]) || null);
  return markedParts(segs, parts);
}
const partAt = (segParts, at) => (segParts.length ? segParts[Math.max(0, Math.min(segParts.length - 1, at))] : null) ?? null;

// Rezultatul e deja scris în text (pe tablă / în întrebare)? Doar ca valoare
// „întreagă" — după „=" (sau singur) și urmată de un capăt (nu „= 3x" pentru „3")
const POINTS_RE = /\(\s*\d+\s*p(?:uncte)?\s*\)|[—–]\s*\d+\s*p\b|\b\d+\s*p\b/gi;
const stripPoints = (s) => String(s || '').replace(POINTS_RE, ' ');
const eqNorm = (s) => live.foldRo(stripPoints(s))
  .replace(/\\[dt]frac/g, '\\frac')
  .replace(/\$|\\[,;!:]|\\left(?![a-z])|\\right(?![a-z])|\\displaystyle|\s+/g, '')
  .replace(/[{}]/g, '');
const AFTER_OK = /^(?:$|[;)\]|?!]|[.,](?!\d)|\\(?:rightarrow|implies|iff|leftrightarrow|quad|qquad|text|land|lor))/;
const BEFORE_OK = (t, i) => i === 0 || /[=:]/.test(t[i - 1]) || /\\(?:rightarrow|implies|iff)$/.test(t.slice(0, i));
function revealsAnswer(text, ans) {
  const a = eqNorm(ans);
  const t = eqNorm(text);
  if (!a || !t) return false;
  for (let i = t.indexOf(a); i >= 0; i = t.indexOf(a, i + 1)) {
    if (BEFORE_OK(t, i) && AFTER_OK.test(t.slice(i + a.length))) return true;
  }
  return false;
}

// textul valorii corecte (la grilă, varianta corectă)
const correctText = (p) => (p.type === 'grila' ? (p.options || [])['abcd'.indexOf(p.answer)] || '' : p.answer);

// Rezultatele date chiar în enunț („Arătați că $E(x) = 1$…"): formulele de după
// „arătați / demonstrați / verificați că", până la sfârșitul propoziției
function shownResults(statement) {
  const out = [];
  for (const m of String(statement || '').matchAll(/(?:arăta[țt]i|aratati|demonstra[țt]i|verifica[țt]i|justifica[țt]i)\s+c[ăa](?=\s)([^\n]*?)(?:\.\s|\.$|\n|$)/gi)) {
    for (const c of m[1].matchAll(/\$([^$]+)\$/g)) out.push(c[1]);
  }
  return out;
}

// Un pas propus (de model sau din barem) → pasul curat, sau null
function cleanStep(raw, { at, segs, segParts, statement = '', log = () => {}, ref = '' }) {
  const poll = cleanPoll(raw);
  if (!poll) return null;
  const val = correctText(poll);
  if (!val) return null;
  if (revealsAnswer(poll.question, val)) { log(`live: ${ref} — întrebarea pe pas își conține răspunsul („${poll.question.slice(0, 60)}") — omisă`); return null; }
  if (shownResults(statement).some((c) => revealsAnswer(c, val))) { log(`live: ${ref} — întrebarea pe pas cere rezultatul dat în enunț („${String(val).slice(0, 30)}") — omisă`); return null; }
  // rezultatul e deja pe tablă (scris înainte, la același subpunct) → nu mai e o întrebare
  const part = partAt(segParts, at);
  const before = segs.slice(0, at).filter((_, j) => (segParts[j] ?? null) === part).flatMap((s) => s.board || []);
  if (before.some((l) => revealsAnswer(l, val))) { log(`live: ${ref} — rezultatul întrebării pe pas („${String(val).slice(0, 30)}") e deja pe tablă — omisă`); return null; }
  let say = String(raw.say || '').replace(/\s+/g, ' ').trim().slice(0, 300);
  // rostirea nu spune rezultatul (cifrele lui, când e un număr)
  if (/^-?\d+(?:[.,]\d+)?$/.test(String(val).trim()) && new RegExp(`(^|[^\\d.,])${String(val).trim().replace(/[.,]/g, '[.,]')}($|[^\\d.,])`).test(say)) say = '';
  if (!say) say = ASK_SAY[at % ASK_SAY.length];
  let hint = cleanStr(raw.hint || '', 240) || null;
  if (hint && revealsAnswer(hint, val)) hint = null;
  return { at, part, ...poll, hint, ask: [{ say, board: [] }], src: raw.src === 'barem' ? 'barem' : 'ai' };
}

// Adaugă pașii propuși la item: curățați, fără dubluri, cel mult unul înaintea unui
// segment, cel mult MAX_STEPS (întâi primul de la fiecare subpunct), în ordine
function addSteps(it, raws, { log = () => {}, src = 'ai' } = {}) {
  if (!stepEligible(it)) { it.steps = []; return 0; }
  const segs = it.modes.barem;
  const parts = itemParts(it);
  const segParts = segmentParts(segs, parts);
  const have = Array.isArray(it.steps) ? it.steps.slice() : [];
  const key = (s) => eqNorm(s.question);
  const tryVal = it.tryPoll ? eqNorm(correctText(it.tryPoll)) : null;
  let added = 0;
  for (const raw of Array.isArray(raws) ? raws : []) {
    if (!raw || !Number.isFinite(Number(raw.at))) continue;
    const at = Math.max(0, Math.min(segs.length, Math.round(Number(raw.at))));
    const st = cleanStep({ ...raw, src }, { at, segs, segParts, statement: it.statement, log, ref: it.ref });
    if (!st) continue;
    if (have.some((h) => h.at === st.at || key(h) === key(st))) continue;
    if (tryVal && eqNorm(correctText(st)) === tryVal) continue;          // aceeași întrebare ca încercarea de la început
    have.push(st);
    added++;
  }
  // cel mult MAX_STEPS: întâi primul pas al fiecărui subpunct, apoi restul, în ordine
  have.sort((a, b) => a.at - b.at);
  const firsts = parts.map((p) => have.find((s) => (s.part ?? null) === p)).filter(Boolean);
  const keep = new Set(firsts.slice(0, MAX_STEPS));
  for (const s of have) { if (keep.size >= MAX_STEPS) break; keep.add(s); }
  it.steps = have.filter((s) => keep.has(s));
  return added;
}

// Subpunctele fără nicio întrebare înainte (încercarea de la început contează doar
// la itemii cu un singur subpunct)
function missingParts(it) {
  if (!stepEligible(it)) return [];
  const parts = itemParts(it);
  const steps = Array.isArray(it.steps) ? it.steps : [];
  if (parts.length === 1) return steps.length || it.tryPoll ? [] : [parts[0]];
  const have = new Set(steps.map((s) => s.part ?? null));
  return parts.filter((p) => !have.has(p));
}

// „$\Delta = b^2 - 4ac = 16$ (2p)" → { lhs: '\Delta = b^2 - 4ac', rhs: '16' }: ultima
// egalitate simplă de pe un rând de tablă. strict = un rezultat (număr / expresie
// redusă); altfel și o expresie încă necalculată („E(2) = (2+1)^2 - 2 \cdot 4"):
// răspunsul elevului se verifică matematic, deci „1" e corect și acolo.
const SKIP_EQ = /\\(?:Rightarrow|Leftrightarrow|rightarrow|implies|iff|in|notin|subset|subseteq|cup|cap|le|ge|leq|geq|neq|ne|lt|gt|approx|equiv|text|mathrm|quad|qquad|forall|exists|ldots|dots|cdots|begin|end|lim|int|sum)\b|[<>≤≥≠;]|\.\.\.|,/;
const RHS_CMDS = new Set(['frac', 'sqrt', 'pi']);
const RHS_CMDS_LOOSE = new Set(['frac', 'sqrt', 'pi', 'cdot']);
function splitTopEq(m) {
  const out = [];
  let depth = 0, cur = '';
  for (const ch of m) {
    if (ch === '{' || ch === '(' || ch === '[') depth++;
    if (ch === '}' || ch === ')' || ch === ']') depth = Math.max(0, depth - 1);
    if (ch === '=' && depth === 0) { out.push(cur); cur = ''; continue; }
    cur += ch;
  }
  out.push(cur);
  return out.map((x) => x.trim());
}
function lastEquality(line, { strict = true } = {}) {
  const maths = [...stripPoints(line).matchAll(/\$([^$]+)\$/g)].map((m) => m[1]);
  for (let k = maths.length - 1; k >= 0; k--) {
    const m = maths[k].trim();
    if (SKIP_EQ.test(m)) continue;
    const parts = splitTopEq(m);
    if (parts.length < 2 || !parts[0]) continue;                       // „= …" (rând de continuare) → nu
    const rhs = parts[parts.length - 1];
    const lhs = parts.slice(0, -1).join(' = ');
    const flat = rhs.replace(/\s+/g, '');
    const ok = strict
      ? flat.length <= 16 && /^[0-9a-zA-Z+\-/^{}\\.]+$/.test(flat)
      : flat.length <= 28 && /^[0-9a-zA-Z+\-*/^(){}\\.]+$/.test(flat);
    if (!flat || !ok || !/\d/.test(flat)) continue;
    const cmds = strict ? RHS_CMDS : RHS_CMDS_LOOSE;
    if ([...flat.matchAll(/\\([a-zA-Z]+)/g)].some((c) => !cmds.has(c[1]))) continue;
    if (eqNorm(lhs) === eqNorm(rhs) || lhs.replace(/\s+/g, '').length < 2) continue;
    return { lhs, rhs };
  }
  return null;
}

// Fără AI: la subpunctele rămase fără întrebare, profesorul întreabă rezultatul unui
// pas pe care oricum îl scrie pe tablă („Ce se obține? $\Delta = b^2 - 4ac = ?$").
// Întâi rezultatele propriu-zise, apoi înlocuirile încă necalculate; primul care
// trece verificările (nu e deja pe tablă, nu e dat în enunț) rămâne.
function addBaremSteps(it, miss, { log = () => {} } = {}) {
  if (!stepEligible(it) || !miss || !miss.length) return 0;
  const segs = it.modes.barem;
  const segParts = segmentParts(segs, itemParts(it));
  const statementMath = [...String(it.statement || '').matchAll(/\$([^$]+)\$/g)].map((m) => m[1]);
  let added = 0;
  for (const p of miss) {
    let done = false;
    for (const strict of [true, false]) {
      for (let k = 0; k < segs.length && !done; k++) {
        if ((segParts[k] ?? null) !== (p ?? null)) continue;
        if ((it.steps || []).some((s) => s.at === k)) continue;
        for (const line of segs[k].board || []) {
          const eq = lastEquality(line, { strict });
          if (!eq) continue;
          // o expresie care e chiar în enunț (ex. definiția lui E(x)) nu e o întrebare
          if (statementMath.some((c) => revealsAnswer(c, eq.rhs))) continue;
          const raw = {
            at: k, type: 'completare', options: null, answer: eq.rhs, hint: '',
            question: `Ce se obține la acest pas? $${eq.lhs} = \\;?$`,
            explain: `Pasul din barem: ${stripPoints(line).replace(/\s+/g, ' ').trim()}`,
            say: ASK_SAY[(k + added) % ASK_SAY.length],
          };
          if (addSteps(it, [raw], { log, src: 'barem' })) { added++; done = true; break; }
        }
      }
      if (done) break;
    }
  }
  if (added) log(`live: ${it.ref} — ${added} întrebări pe pași luate din rândurile de pe tablă (fără AI)`);
  return added;
}

// Pașii scriși de model în explicația pe barem („ask" la segmente) → pașii itemului
function cleanBaremSegs(arr, { min = 1, max = 14 } = {}) {
  const segs = [], asks = [];
  for (const s of Array.isArray(arr) ? arr : []) {
    const say = String(s?.say || '').replace(/\s+/g, ' ').trim().slice(0, 420);
    if (!say) continue;
    const board = (Array.isArray(s.board) ? s.board : []).map((b) => cleanStr(b, 200)).filter(Boolean).slice(0, 4);
    if (s.ask && typeof s.ask === 'object') asks.push({ ...s.ask, at: segs.length });
    segs.push({ say, board });
    if (segs.length >= max) break;
  }
  return segs.length >= min ? { segs, asks } : { segs: [], asks: [] };
}

// Aplică verificările deterministe pe itemii unei secțiuni. `grile` = răspunsurile
// oficiale din tabelul baremului (EN), `baremText` = tot baremul.
function normalizeItems(rawItems, { section, exam, grile = {}, baremText = '', log = () => {} }) {
  const out = [];
  for (const it of Array.isArray(rawItems) ? rawItems : []) {
    const r = parseRef(it?.ref);
    if (!r || r.subject !== section) continue;
    const bar = cleanBaremSegs(it.modes?.barem, { min: 1, max: 14 });
    const item = {
      ref: refKey(r), section, title: String(it.title || `Subiectul ${section}, exercițiul ${r.ex}${r.letter ? ` ${r.letter})` : ''}`).slice(0, 80),
      kind: ['grila', 'rezultat', 'rezolvare'].includes(it.kind) ? it.kind : 'rezolvare',
      statement: cleanStr(it.statement, 2500),
      statementTry: cleanStr(it.statementTry || '', 2500) || null,
      options: Array.isArray(it.options) && it.options.length === 4 ? it.options.map((o) => cleanStr(o, 200).replace(/^\s*[a-d]\s*[).]\s*/i, '')) : null,
      answer: cleanStr(it.answer, 200),
      points: Number.isFinite(it.points) ? Math.max(0, Math.min(30, it.points)) : 5,
      barem: cleanStr(it.barem, 1500),
      intro: cleanSegs(it.intro, { min: 1, max: 3 }),
      tryPoll: cleanPoll(it.tryPoll),
      afterTry: cleanSegs(it.afterTry, { max: 2 }),
      modes: {
        barem: bar.segs,
        intuitiv: cleanSegs(it.modes?.intuitiv, { max: 6 }),
        greseli: cleanSegs(it.modes?.greseli, { max: 5 }),
        alta_metoda: it.modes?.alta_metoda ? cleanSegs(it.modes.alta_metoda, { max: 7 }) : [],
      },
      check: cleanPoll(it.check),
      afterCheck: cleanSegs(it.afterCheck, { max: 2 }),
    };
    if (!item.statement || !item.modes.barem.length) { log(`live: item ${item.ref} fără enunț sau fără explicație pe barem — omis`); continue; }
    if (unreadable(item.statement, ...(item.options || []))) { log(`live: item ${item.ref} — enunțul nu s-a putut citi (formule pierdute) — omis`); continue; }

    // GRILELE de EN: litera oficială din tabelul baremului are ultimul cuvânt
    const official = grile[section] && !r.letter ? grile[section][r.ex] : null;
    if (official) {
      if (item.tryPoll && item.tryPoll.type === 'grila' && item.tryPoll.answer !== official) {
        log(`live: ${item.ref} — AI a zis „${item.tryPoll.answer}", baremul spune „${official}" → corectat`);
        item.tryPoll.answer = official;
      }
      if (item.kind === 'grila') item.answer = official;
      if (!item.tryPoll && item.options) {
        item.tryPoll = { type: 'grila', question: item.statement, options: item.options, answer: official, explain: '' };
      }
    } else if (exam === 'en' && (section === 'I' || section === 'II') && item.kind === 'grila') {
      // grilă fără literă găsită în barem → fără sondaj (nu riscăm o cheie greșită)
      const loc = B.locateBaremItem(baremText, { subject: section, ex: r.ex, letter: null });
      if (loc && loc.kind === 'grila') {
        if (item.tryPoll && item.tryPoll.type === 'grila') item.tryPoll.answer = loc.litera;
        item.answer = loc.litera;
      } else if (item.tryPoll && item.tryPoll.type === 'grila') {
        log(`live: ${item.ref} — litera nu se poate confirma din barem → fără sondaj`);
        item.tryPoll = null;
      }
    }
    // rezultat scurt (bareme vechi de EN): rezultatul oficial la sondajul de completare
    if (!official && item.tryPoll && item.tryPoll.type === 'completare') {
      const loc = B.locateBaremItem(baremText, { subject: section, ex: r.ex, letter: r.letter });
      if (loc && loc.kind === 'rezultat' && loc.raspuns) item.tryPoll.answer = loc.raspuns;
    }
    // „Arătați că…": rezultatul e în enunț → elevii încearcă pe cerința reformulată
    // („Calculați…", fără rezultat). Fără o reformulare curată, sondajul ar da
    // răspunsul: nu se pune (explicația pe barem rămâne, cu etapele intermediare).
    const showThat = SHOW_THAT(item.statement);
    if (showThat) {
      const ans = item.tryPoll && item.tryPoll.type === 'completare' ? item.tryPoll.answer : '';
      const ok = item.statementTry && item.tryPoll && !SHOW_THAT(item.statementTry) && !SHOW_THAT(item.tryPoll.question)
        && !leaksAnswer(item.statementTry, ans) && !leaksAnswer(item.tryPoll.question, ans);
      if (!ok) {
        if (item.statementTry || item.tryPoll) log(`live: ${item.ref} — „Arătați că…" fără reformulare curată → fără sondaj înainte`);
        item.statementTry = null;
        item.tryPoll = null;
      }
    } else item.statementTry = null;
    // un singur sondaj înainte (tryPoll) SAU o verificare după (check)
    if (item.tryPoll && item.check) item.check = null;
    // întrebările pe pași (Subiectele II și III): cele scrise de model în explicația pe barem
    item.steps = [];
    if (stepEligible(item)) addSteps(item, bar.asks, { log });
    if (!item.tryPoll && !item.check && !showThat && !item.steps.length) {
      // item fără întrebare → o verificare simplă cu rezultatul final (dacă e scurt)
      const ans = String(item.answer || '').replace(/^\$|\$$/g, '').trim();
      if (ans && ans.length <= 24 && /\d/.test(ans)) {
        item.check = { type: 'completare', question: 'Care este rezultatul final la acest item?', options: null, answer: ans, explain: '', auto: true };
      }
    }
    if (!item.afterTry.length && item.tryPoll) item.afterTry = [{ say: 'Să vedem răspunsul corect.', board: [] }];
    if (!item.afterCheck.length && item.check) item.afterCheck = [{ say: 'Să verificăm împreună.', board: [] }];
    out.push(item);
  }
  // fără dubluri (apelurile pe bucăți se pot suprapune)
  const seen = new Set();
  return out.filter((it) => (seen.has(it.ref) ? false : (seen.add(it.ref), true)));
}

function refOrder(a, b) {
  const pa = parseRef(a.ref), pb = parseRef(b.ref);
  const sec = { I: 1, II: 2, III: 3 };
  return (sec[pa.subject] - sec[pb.subject]) || (pa.ex - pb.ex) || String(pa.letter || '').localeCompare(String(pb.letter || ''));
}

// ─── Segmentele fixe (început, întrebări, pauză, final) ──────────────────────
function spokenTitle(title) {
  return String(title || 'subiectul de azi').replace(/[_]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 120);
}
function templates(teacher, { title, exam, profile }) {
  const f = teacher.gender === 'f';
  const who = f ? `${teacher.name}, profesoara voastră virtuală de matematică` : `${teacher.name}, profesorul vostru virtual de matematică`;
  const seg = (say) => ({ say, board: [] });
  return {
    intro: [
      seg(`Bine ați venit la meditație! Sunt ${who}.`),
      seg(`Astăzi rezolvăm împreună un subiect de ${exam === 'en' ? 'Evaluare Națională' : 'Bacalaureat'}: ${spokenTitle(title)}. Lucrăm strict după baremul oficial, ca să vedeți exact cum se dau punctele.`),
      seg('La fiecare exercițiu vă las întâi să încercați singuri, apoi vă explic pe barem și încă o dată, pe înțelesul tuturor. La problemele grele vă întreb la fiecare pas din barem: răspundeți pe ecran.'),
      seg('Pregătiți o foaie și un pix. Dacă ceva nu e clar, scrieți-mi oricând în chat: vă răspund imediat.'),
    ],
    qna: [seg('Acum e momentul pentru întrebări. Scrieți în chat ce nu a fost clar și vă răspund pe rând.')],
    breakSay: [seg('Facem o pauză scurtă, de cinci minute. Beți un pahar cu apă, mișcați-vă puțin și ne revedem aici.')],
    outro: [
      seg('Cam asta a fost pentru azi. Ați lucrat foarte bine!'),
      seg('Baremul complet și subiectul îl găsiți pe ExamenMate. Refaceți singuri, mâine, exercițiile la care ați greșit: așa se fixează.'),
      seg(`Vă aștept la următoarea ședință. ${f ? 'Vă pup' : 'Toate cele bune'} și spor la învățat!`),
    ],
  };
}

// id stabil pentru fiecare segment (același text → aceeași voce, refolosită)
const tagSegs = (prefix, segs) => (segs || []).forEach((s, i) => { s.id = `${prefix}${i}-${live.shortId(prefix + '|' + i + '|' + s.say)}`; });
// id-urile întrebărilor pe pași și ale frazelor cu care sunt puse: după conținut (nu
// după poziție) — un pas neschimbat își păstrează id-ul (și vocea) la completări
function assignStepIds(it, k) {
  const p = it.ref.replace(/\./g, '');
  for (const st of Array.isArray(it.steps) ? it.steps : []) {
    const h = live.shortId(`${it.ref}|pas|${st.question}`);
    st.id = `p${k}s-${h}`;
    tagSegs(`${p}q${h.slice(0, 5)}`, st.ask);
  }
}
function assignIds(script) {
  const tag = tagSegs;
  tag('in', script.intro); tag('qa', script.qna); tag('pz', script.breakSay); tag('fi', script.outro);
  script.items.forEach((it, k) => {
    const p = it.ref.replace(/\./g, '');
    tag(`${p}i`, it.intro); tag(`${p}t`, it.afterTry); tag(`${p}k`, it.afterCheck);
    for (const m of Object.keys(it.modes)) tag(`${p}${m.slice(0, 2)}`, it.modes[m]);
    if (it.tryPoll) it.tryPoll.id = `p${k}t-${live.shortId(it.ref + 'try')}`;
    if (it.check) it.check.id = `p${k}c-${live.shortId(it.ref + 'check')}`;
    assignStepIds(it, k);
  });
  return script;
}

// Profesorul și-a schimbat numele (ex. „Prof. Radu" → „Prof. Tudor"): lecțiile deja
// scrise îl rostesc pe cel nou. Doar textul se schimbă — id-urile segmentelor și
// ale întrebărilor rămân (cronologia ședințelor în curs nu se strică).
function renameTeacher(script, teacher) {
  if (!script || !teacher?.name || !script.teacherName || script.teacherName === teacher.name) return script;
  const old = new RegExp(String(script.teacherName).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g');
  const copy = JSON.parse(JSON.stringify(script));
  for (const s of segmentsInOrder(copy)) s.say = s.say.replace(old, teacher.name);
  copy.teacherName = teacher.name;
  return copy;
}

// Toate segmentele, în ORDINEA în care se aud (pentru vocea generată întâi
// la început — 1-la-1 poate porni înainte să fie gata tot)
function itemSegments(it) {
  const out = [];
  const add = (arr) => (arr || []).forEach((s) => out.push(s));
  add(it.intro); add(it.afterTry); add(it.modes?.barem);
  for (const st of Array.isArray(it.steps) ? it.steps : []) add(st.ask);   // frazele întrebărilor pe pași
  add(it.afterCheck);
  for (const m of live.ALT_MODES) add(it.modes?.[m]);
  return out;
}
function segmentsInOrder(script) {
  const out = [];
  const add = (arr) => (arr || []).forEach((s) => out.push(s));
  add(script.intro);
  for (const it of script.items || []) add(itemSegments(it));
  add(script.qna); add(script.breakSay); add(script.outro);
  return out;
}

// Ordinea în care se generează vocea: de obicei, de la începutul lecției. La 1-la-1,
// dacă elevul a sărit înainte (⏭), întâi itemul la care a ajuns și cei de după el,
// apoi restul — ca vocea să-l ajungă din urmă cât mai repede.
function voiceOrder(script, fromRef = null) {
  const all = segmentsInOrder(script);
  const items = script?.items || [];
  const k = fromRef ? items.findIndex((it) => it.ref === fromRef) : -1;
  if (k <= 0) return all;
  const first = [];
  for (let i = k; i < items.length; i++) first.push(...itemSegments(items[i]));
  const seen = new Set(first.map((s) => s.id));
  return [...first, ...all.filter((s) => !seen.has(s.id))];
}

// ─── 1. Scriptul ─────────────────────────────────────────────────────────────
async function generateScript({ ctx, content, teacher, exam, profile, log = console.warn, attachments = null }) {
  const subjectText = String(ctx.text || '');
  const baremText = String(ctx.baremText || '');
  if (!live.hasBarem({ barem_status: ctx.baremStatus, barem_text: baremText })) {
    const e = new Error('Subiectul nu are barem asociat sigur — profesorul nu îl explică.'); e.code = 'NO_BAREM'; throw e;
  }
  const sections = { subject: sectionMap(subjectText), barem: sectionMap(baremText) };
  let plan = callPlan(exam, sections);
  // subiect fără titlurile „SUBIECTUL I/II/III" recunoscute → un singur apel pe tot
  let whole = false;
  if (!plan.length) {
    whole = true;
    plan = [{ section: 'I', from: 1, to: 6 }, { section: 'II', from: 1, to: 6 }, { section: 'III', from: 1, to: 6 }];
  }
  const grile = exam === 'en' ? B.grilaAnswers(baremText) : {};
  const usage = { in: 0, out: 0, model: GEN_MODEL() };
  const title = content.title || 'Subiect';

  const pdfpages = require('./pdfpages');
  const results = await Promise.all(plan.map(async (p) => {
    try {
      const parts = (attachments && attachments[p.section]) || [];
      const text = userPrompt({
        exam, section: p.section, from: p.from, to: p.to, title,
        subjectSection: whole ? subjectText : sections.subject[p.section],
        baremSection: whole ? baremText : sections.barem[p.section],
        pages: parts.length ? (parts.some((x) => /^barem-/.test(x?.file?.filename || '')) ? 'barem' : 'subiect') : false,
      });
      const r = await ai.chatJson({
        system: systemPrompt(teacher, exam, profile),
        messages: [{ role: 'user', content: pdfpages.userContent(text, parts) }],
        schema: SCHEMA, schemaName: 'lectie_live', model: GEN_MODEL(), maxTokens: 16000, temperature: 0.4,
      });
      usage.in += r.usage?.in || 0; usage.out += r.usage?.out || 0;
      return normalizeItems(r.data?.items, { section: p.section, exam, grile, baremText, log });
    } catch (e) {
      if (e.usage) { usage.in += e.usage.in || 0; usage.out += e.usage.out || 0; }
      log(`live: generarea ${p.section} ${p.from}–${p.to} a eșuat: ${e.message}`);
      return [];
    }
  }));
  const seen = new Set();
  const items = results.flat().filter((it) => (seen.has(it.ref) ? false : (seen.add(it.ref), true))).sort(refOrder);
  if (items.length < 3) {
    const e = new Error(`Lecția nu s-a putut pregăti (${items.length} itemi explicați). Subiectul poate fi scanat sau baremul greu de citit.`);
    e.code = 'SCRIPT_FAIL'; e.usage = usage; throw e;
  }
  // întrebările pe pași: subpunctele rămase fără nicio întrebare → un apel scurt doar
  // pentru ele, apoi (fără AI) rezultatele pașilor scriși pe tablă
  const steps = live.STEPS_ON() ? await fillMissingSteps(items, { teacher, exam, profile, title, log, usage }) : null;
  // v2 = scrisă cu paginile PDF (formulele citite din pagini); v1 = doar din textul extras
  const withPages = Object.values(attachments || {}).some((a) => Array.isArray(a) && a.length);
  const script = {
    v: withPages ? 2 : 1, ...(steps ? { pasi: PASI_V } : {}), title, exam, profile: profile || null, teacher: teacher.id, teacherName: teacher.name,
    subjectId: content.id, baremId: ctx.barem?.id || null, baremTitle: ctx.barem?.title || null,
    ...templates(teacher, { title, exam, profile }),
    items,
  };
  return { script: assignIds(script), usage, steps };
}

// ─── 1b. Întrebările pe pași care lipsesc ────────────────────────────────────
// Un apel scurt pe secțiune, doar pentru itemii cu subpuncte fără întrebare: modelul
// primește explicația pe barem pe segmente numerotate și spune înaintea cărui segment
// pune fiecare întrebare. Ce rămâne tot fără întrebare → rezultatele pașilor de pe tablă.
const STEP_FIX_SCHEMA = S.obj({
  items: S.arr(S.obj({
    ref: S.str('referința itemului, exact ca în listă („II.1.a", „III.2")'),
    steps: S.arr(S.obj({
      before: S.int('numărul segmentului [k] ÎNAINTEA căruia pui întrebarea: segmentul în care se scrie pe tablă, prima dată, rezultatul întrebat (N+1 = după ultimul segment)'),
      ...ASK_PROPS,
    }), '1–4 întrebări; cel puțin una la fiecare subpunct marcat „LIPSĂ"'),
  })),
});

function stepsSystemPrompt(teacher, exam, profile) {
  const g = teacher.gender === 'f';
  return [
    `Ești ${teacher.name}, ${g ? 'profesoară virtuală' : 'profesor virtual'} de matematică (AI) pe platforma ExamenMate. Ții o meditație online pe un subiect de ${live.EXAM_LABEL(exam, profile)}${exam === 'bac' && live.PROFILE_LABELS[profile] ? ` (programa ${live.PROFILE_LABELS[profile]})` : ''}, explicat DOAR pe baza baremului oficial.`,
    'Explicația pe barem a fiecărui item e gata, pe segmente (ce spui și ce scrii pe tablă). Acum adaugi ÎNTREBĂRILE PE PAȘI: elevii răspund pe ecran la rezultatele intermediare din barem, înainte să le scrii tu.',
    '',
    'REGULI:',
    ...STEP_RULES,
    '(6) „before" = numărul segmentului [k] ÎNAINTEA căruia pui întrebarea: segmentul în care se scrie pe tablă, PRIMA DATĂ, rezultatul întrebat. Pentru o întrebare de la sfârșitul explicației, „before" = N+1 (N = numărul de segmente ale itemului).',
    '(7) Rezultatele le iei DOAR din barem și din explicația dată — nu inventa alt rezultat. Formulele în LaTeX între $...$; „say" fără LaTeX, cum se citește cu voce tare.',
    '(8) Nu repeta întrebările deja puse (sunt trecute la fiecare item). Ton cald, încurajator; fără emoji.',
  ].join('\n');
}

function stepsUserPrompt({ title, items }) {
  const out = [`Subiectul: „${spokenTitle(title)}".`, 'Scrie întrebările pe pași pentru itemii de mai jos (doar pentru ei).', ''];
  for (const it of items) {
    const parts = itemParts(it);
    const miss = new Set(missingParts(it).map((p) => p ?? '-'));
    const segs = it.modes.barem;
    out.push(`=== ITEMUL ${it.ref} — ${it.title} (${segs.length} segmente) ===`);
    out.push(`Enunț: ${it.statement}`);
    if (it.barem) out.push(`Barem: ${it.barem}`);
    out.push(parts.length > 1
      ? `Subpuncte: ${parts.map((p) => `${p})${miss.has(p) ? ' — LIPSĂ' : ''}`).join(', ')}`
      : `Un singur subpunct${miss.size ? ' — LIPSĂ (cel puțin o întrebare)' : ''}.`);
    out.push('Explicația pe barem:');
    segs.forEach((s, i) => out.push(`[${i + 1}] spune: „${s.say}"${s.board?.length ? ` · tabla: ${s.board.join(' | ')}` : ''}`));
    const had = Array.isArray(it.steps) ? it.steps : [];
    if (had.length) out.push(`Întrebări deja puse: ${had.map((s) => `înainte de [${s.at + 1}]: „${s.question}"`).join('; ')}`);
    out.push('');
  }
  return out.join('\n');
}

// Completează întrebările pe pași ale itemilor (în loc). Nu aruncă: dacă modelul nu
// răspunde, rămân pașii din barem. { asked, ai, aiFailed, fromBarem, missing:[ref] }
async function fillMissingSteps(items, { teacher, exam, profile, title, log = console.warn, usage = null, useAi = true } = {}) {
  const need = (items || []).filter((it) => missingParts(it).length);
  const report = { asked: need.length, ai: 0, aiFailed: 0, fromBarem: 0, missing: [] };
  if (need.length && useAi) {
    const bySec = {};
    for (const it of need) (bySec[it.section] = bySec[it.section] || []).push(it);
    await Promise.all(Object.values(bySec).map(async (list) => {
      try {
        const r = await ai.chatJson({
          system: stepsSystemPrompt(teacher, exam, profile),
          messages: [{ role: 'user', content: stepsUserPrompt({ title, items: list }) }],
          schema: STEP_FIX_SCHEMA, schemaName: 'intrebari_pe_pasi', model: GEN_MODEL(), maxTokens: 12000, temperature: 0.3,
        });
        if (usage) { usage.in += r.usage?.in || 0; usage.out += r.usage?.out || 0; }
        for (const ri of r.data?.items || []) {
          const it = list.find((x) => x.ref === refKey(parseRef(ri?.ref)));
          if (!it) continue;
          report.ai += addSteps(it, (Array.isArray(ri.steps) ? ri.steps : []).map((s) => ({ ...s, at: Number(s?.before) - 1 })), { log });
        }
      } catch (e) {
        report.aiFailed++;
        if (usage && e.usage) { usage.in += e.usage.in || 0; usage.out += e.usage.out || 0; }
        log(`live: întrebările pe pași (${list.map((x) => x.ref).join(', ')}) nu s-au putut scrie: ${e.message}`);
      }
    }));
  }
  for (const it of items || []) {
    const miss = missingParts(it);
    if (miss.length) report.fromBarem += addBaremSteps(it, miss, { log });
    // verificarea generică („Care este rezultatul final?") nu mai e nevoie lângă pași
    if (it.steps?.length && it.check?.auto) { it.check = null; it.afterCheck = []; }
    if (missingParts(it).length) report.missing.push(it.ref);
  }
  return report;
}

// Lecțiile scrise înainte de întrebările pe pași (fără script.pasi) se completează o
// singură dată — doar întrebările: explicațiile, id-urile lor și vocea rămân.
const needsSteps = (script) => !!script && live.STEPS_ON() && Number(script.pasi || 0) < PASI_V
  && Array.isArray(script.items) && script.items.length > 0;

async function addStepQuestions({ script, teacher, log = console.warn, force = false, useAi = true }) {
  const copy = JSON.parse(JSON.stringify(script));
  const usage = { in: 0, out: 0, model: GEN_MODEL() };
  const items = copy.items || [];
  if (force) for (const it of items) if (stepEligible(it)) it.steps = [];
  const report = await fillMissingSteps(items, { teacher, exam: copy.exam, profile: copy.profile, title: copy.title, log, usage, useAi });
  items.forEach((it, k) => assignStepIds(it, k));
  copy.pasi = PASI_V;
  return { script: copy, usage, report };
}

// Scriptul altui profesor, pentru același subiect → doar segmentele fixe se
// rescriu (numele, genul); explicațiile rămân, vocea se generează din nou.
function adaptScript(script, teacher) {
  const copy = JSON.parse(JSON.stringify(script));
  Object.assign(copy, templates(teacher, { title: copy.title, exam: copy.exam, profile: copy.profile }), { teacher: teacher.id });
  // numele celuilalt profesor nu are ce căuta în explicații
  const other = new RegExp(String(script.teacherName || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g');
  if (script.teacherName) {
    for (const s of segmentsInOrder(copy)) s.say = s.say.replace(other, teacher.name);
  }
  copy.teacherName = teacher.name;
  return assignIds(copy);
}

// ─── 2. Vocea (pe bucăți, cu buget de timp) ──────────────────────────────────
async function voiceScript(supa, { lessonId, script, teacher, audio = {}, budgetMs = 240000, log = console.warn, onProgress = null, every = 15, fromRef = null }) {
  const t0 = Date.now();
  const todo = voiceOrder(script, fromRef).filter((s) => !audio[s.id]);
  let cost = 0, failed = 0, sinceSave = 0;
  const queue = todo.slice();
  const worker = async () => {
    while (queue.length && Date.now() - t0 < budgetMs) {
      const seg = queue.shift();
      try {
        const v = await tts.voiceSegment(supa, { text: seg.say, teacher, path: `lessons/${lessonId}/${seg.id}` });
        if (v) { audio[seg.id] = { url: v.url, dur: v.dur, lip: v.lip }; cost += v.cost || 0; }
        // progresul se salvează din când în când: o întrerupere nu pierde vocea deja făcută
        if (onProgress && ++sinceSave >= every) { sinceSave = 0; try { await onProgress(audio, cost); } catch { /* următoarea salvare */ } }
      } catch (e) {
        failed++;
        if (e.code === 'NO_TTS') { queue.length = 0; throw e; }
        log(`live: vocea segmentului ${seg.id} a eșuat: ${e.message}`);
      }
    }
  };
  await Promise.all(Array.from({ length: TTS_PARALLEL() }, worker));
  const total = segmentsInOrder(script).length;
  const done = segmentsInOrder(script).filter((s) => audio[s.id]).length;
  return { audio, cost, failed, total, done };
}

// Câte segmente de la început au voce (1-la-1 poate porni după intro + 2 itemi).
// Celelalte moduri („Explică altfel") vin imediat după, în ordinea vocii.
function playableHead(script, audio) {
  const need = [];
  (script.intro || []).forEach((s) => need.push(s));
  for (const it of (script.items || []).slice(0, 2)) {
    (it.intro || []).forEach((s) => need.push(s));
    (it.afterTry || []).forEach((s) => need.push(s));
    (it.modes?.barem || []).forEach((s) => need.push(s));
    for (const st of live.stepsFor(it)) (st.ask || []).forEach((s) => need.push(s));
  }
  return need.length > 0 && need.every((s) => audio[s.id]);
}

module.exports = {
  generateScript, adaptScript, renameTeacher, dropUnreadable, pdfAttachments, sectionPages, voiceScript, playableHead, segmentsInOrder, voiceOrder, itemSegments, templates, assignIds,
  normalizeItems, sectionMap, callPlan, parseRef, refKey, SCHEMA, systemPrompt, userPrompt, GEN_MODEL,
  // întrebările pe pași
  PASI_V, STEP_FIX_SCHEMA, stepEligible, itemParts, segmentParts, missingParts, addSteps, addBaremSteps, lastEquality, revealsAnswer,
  fillMissingSteps, needsSteps, addStepQuestions, stepsSystemPrompt, stepsUserPrompt,
};
