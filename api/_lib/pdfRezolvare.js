// =====================================================================
// api/_lib/pdfRezolvare.js — corectarea din „✏️ Rezolvă pe PDF" (7 nov. 2026)
// (endpointul: api/rezolva-pdf.js; partea din browser: src/lib/pdfRezolvare.js)
//
// Elevul a rezolvat testul de Evaluare Națională DIRECT PE PDF: a încercuit
// litera la grilele de la Subiectele I și II și a scris rezolvările la Subiectul
// al III-lea, pe pagină. La „✅ Corectează":
//   · GRILELE — varianta încercuită a fost recunoscută în browser (harta testului
//     din textul PDF-ului); aici se compară cu litera din tabelul BAREMULUI
//     (barem.grilaAnswers) — fără AI, deci și fără abonament;
//   · SCRISUL DE MÂNĂ (Subiectul al III-lea, și orice item la care nu s-au găsit
//     variantele în text) — imaginile zonelor din pagină, cu scrisul pe ele, merg
//     la corectorul de scris de mână (corector.correctJson: implicit Claude Opus
//     5.5), strict după barem. Premium, ca „🎓 Cere corectarea" din spațiul de lucru.
// Partea pură (curățarea cererii, punctarea grilelor, normalizarea, mesajul) e
// testată în test/rezolva-pe-pdf.test.js.
// =====================================================================
const B = require('./barem');

const ROMAN = { 1: 'I', 2: 'II', 3: 'III' };
const SUBJ = { 1: 'Subiectul I', 2: 'Subiectul al II-lea', 3: 'Subiectul al III-lea' };
const KEY_RE = /^[123]\.[1-9]$/;
const LIT = ['a', 'b', 'c', 'd'];
const VERDICT_ITEM = ['corect', 'partial', 'gresit', 'necompletat'];
const VERDICT_PAS = ['corect', 'gresit', 'incomplet', 'neclar'];
const MAX_IMAGES = 6;
const MAX_IMG_CHARS = 2_000_000;
const MAX_TOTAL_CHARS = 4_000_000;
const IMG_RE = /^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/;

const short = (key) => { const [s, ex] = String(key).split('.'); return `${ROMAN[s] || s}.${ex}`; };
const longName = (key) => { const [s, ex] = String(key).split('.'); return `${SUBJ[s] || `Subiectul ${s}`}, ${s === '3' ? 'problema' : 'exercițiul'} ${ex}`; };
const num = (v) => { const n = Number(String(v ?? '').replace(',', '.')); return Number.isFinite(n) ? n : null; };
const round2 = (n) => Math.round(n * 100) / 100;

// ── cererea, curățată (nimic din ea nu e de încredere) ──
function cleanBody(body) {
  const b = body && typeof body === 'object' ? body : {};
  const seen = new Set();
  const grile = [];
  for (const g of Array.isArray(b.grile) ? b.grile : []) {
    const key = String(g && g.key || '');
    if (!KEY_RE.test(key) || key[0] === '3' || seen.has(key)) continue;
    const litere = [...new Set((Array.isArray(g.litere) ? g.litere : []).map((l) => String(l).toLowerCase()).filter((l) => LIT.includes(l)))].sort();
    if (!litere.length) continue;
    seen.add(key);
    grile.push({ key, litere, cum: g.cum === 'semn' ? 'semn' : 'cerc' });
  }
  const nerecunoscute = [];
  for (const g of Array.isArray(b.nerecunoscute) ? b.nerecunoscute : []) {
    const key = String(g && g.key || '');
    if (!KEY_RE.test(key) || seen.has(key)) continue;
    seen.add(key);
    nerecunoscute.push({ key, motiv: g.motiv === 'neclar' ? 'neclar' : 'nimic' });
  }
  const scris = [];
  for (const k of Array.isArray(b.scris) ? b.scris : []) {
    const key = String(k || '');
    if (!KEY_RE.test(key) || seen.has(key)) continue;
    seen.add(key);
    scris.push(key);
  }
  const images = [], labels = [];
  let total = 0;
  for (const im of Array.isArray(b.images) ? b.images : []) {
    const url = im && typeof im === 'object' ? im.url : im;
    if (typeof url !== 'string' || url.length > MAX_IMG_CHARS || !IMG_RE.test(url)) continue;
    if (total + url.length > MAX_TOTAL_CHARS) break;
    total += url.length;
    images.push(url);
    labels.push(String((im && im.label) || '').replace(/\s+/g, ' ').slice(0, 300));
    if (images.length >= MAX_IMAGES) break;
  }
  const sig = /^\d-\d-\d$/.test(String(b.structura || '')) ? String(b.structura) : null;
  return {
    grile, nerecunoscute, scris, images, labels,
    harta: b.harta !== false && !!sig,
    structura: sig,
    durationSec: Math.max(0, Math.min(6 * 3600, Math.round(Number(b.durationSec) || 0))),
    thumb: typeof b.thumb === 'string' && /^data:image\/(jpeg|png|webp);base64,/.test(b.thumb) && b.thumb.length <= 16000 ? b.thumb : null,
  };
}

// EN de azi (6 · 6 · 6): fiecare item are 5 puncte; Subiectul al III-lea: a) 2p + b) 3p
const isEn666 = (sig) => sig === '6-6-6';
function itemMax(key, sig) { return isEn666(sig) ? 5 : (key[0] === '3' ? null : 5); }

// ── GRILELE, după tabelul baremului ──
// → { results: [...], faraCheie: [{ key, litere }] } (faraCheie = baremul nu dă litera)
function gradeGrile(grile, nerecunoscute, baremText) {
  const keyMap = baremText ? B.grilaAnswers(baremText) : {};
  const results = [], faraCheie = [];
  for (const g of grile) {
    const [s, ex] = g.key.split('.');
    const corect = keyMap[ROMAN[s]] && keyMap[ROMAN[s]][Number(ex)];
    const base = { key: g.key, s: Number(s), ex: Number(ex), tip: 'grila', eticheta: longName(g.key), litera: g.litere.length === 1 ? g.litere[0] : null, litere: g.litere, puncte_max: 5, sursa: 'barem' };
    if (g.litere.length > 1) {
      // regula oficială: se punctează doar rezultatul — 5p sau 0p; mai multe variante = 0p
      results.push({ ...base, verdict: 'gresit', puncte: 0, motiv: `ai încercuit mai multe variante (${g.litere.map((l) => `${l})`).join(', ')}) — se punctează doar un singur răspuns` });
      continue;
    }
    if (!corect) { faraCheie.push(g); continue; }
    const ok = g.litere[0] === corect;
    results.push({ ...base, verdict: ok ? 'corect' : 'gresit', puncte: ok ? 5 : 0, motiv: '' });
  }
  for (const g of nerecunoscute) {
    const [s, ex] = g.key.split('.');
    results.push({
      key: g.key, s: Number(s), ex: Number(ex), tip: 'grila', eticheta: longName(g.key), litera: null, litere: [],
      verdict: 'necompletat', puncte: 0, puncte_max: 5, sursa: 'recunoastere',
      motiv: g.motiv === 'neclar'
        ? 'cercul tău cuprinde mai multe variante — încercuiește doar litera răspunsului ales'
        : 'n-am văzut nicio literă încercuită — încercuiește litera răspunsului ales',
    });
  }
  return { results, faraCheie, hasKey: Object.keys(keyMap).length > 0 };
}

// ═════════════════════════ CORECTORUL (scrisul de pe PDF) ═════════════════════════
function schema(S) {
  return S.obj({
    itemi: S.arr(S.obj({
      cheie: S.str('cheia itemului EXACT ca în listă ("3.2", "1.4"); fără listă: cheia dedusă ("3.1") sau "?"'),
      eticheta: S.str('ex. "Subiectul al III-lea, problema 2"'),
      litera: S.nullable(S.str('DOAR la grile: litera încercuită de elev — "a", "b", "c" sau "d"; null dacă nu se vede încercuită una singură')),
      transcriere: S.str('ce a scris elevul la acest item, rând cu rând (\\n), formulele în LaTeX între $...$; [?] = ilizibil; gol la grile'),
      subpuncte: S.arr(S.obj({
        litera: S.str('subpunctul problemei: "a" sau "b" (sau "c"); "" la grile și la problemele fără subpuncte'),
        verdict: S.enum(VERDICT_ITEM),
        puncte: S.nullable(S.num('punctele acordate STRICT după barem; null fără barem')),
        puncte_max: S.nullable(S.num('punctajul maxim al subpunctului din barem; null fără barem')),
        pasi: S.arr(S.obj({
          text: S.str('pasul elevului, pe scurt, formulele în $...$'),
          verdict: S.enum(VERDICT_PAS),
          comentariu: S.str('de ce, într-o propoziție; poate fi gol la un pas corect evident'),
        })),
        motiv_punctaj: S.str('ce elemente din barem s-au punctat și care nu (gol fără barem)'),
      })),
    })),
    feedback: S.str('2–4 propoziții calde despre ce a rezolvat elevul pe PDF, la persoana a II-a'),
    sfat: S.str('ce să facă acum: un indiciu concret, FĂRĂ rezultatul final dacă a greșit'),
  });
}

const SYSTEM = `Ești „Profesorul Virtual" de pe ExamenMate — profesor corector de matematică la Evaluarea Națională (clasa a VIII-a), cald și exact.
Elevul a rezolvat testul DIRECT PE PDF, cu degetul, cu creionul sau cu mouse-ul: a încercuit litera răspunsului la grilele de la Subiectele I și II și a scris rezolvările la Subiectul al III-lea, în spațiul de sub fiecare problemă.
Primești IMAGINI cu zone din paginile testului. Pe ele, TEXTUL TIPĂRIT este testul (enunțurile, variantele de răspuns, figurile); SCRISUL DE MÂNĂ — liniile trase cu mâna, albastre, negre sau roșii — este al elevului. Corectezi DOAR ce a scris elevul: textul tipărit nu e răspunsul lui.

1) CITEȘTE scrisul de mână, rând cu rând, ca un profesor care corectează lucrări:
- Folosește contextul (enunțul tipărit, baremul, rândurile vecine, firul calculului) ca să descifrezi cifrele și semnele ambigue: 1/7, 4/9, 0/6, 5/S, 2/Z, x/×, +/t, virgula zecimală, minusul față de bara de fracție, exponenții. Contextul te ajută să CITEȘTI, nu să corectezi în locul elevului: transcrii ce a scris EL, cu greșelile lui.
- Ce nu se poate citi deloc marchezi cu [?] — nu inventa.
- Amplificarea și simplificarea fracțiilor se scriu cu factorul mic, SUS, lângă fracție, cu o paranteză (în stânga la amplificare, în dreapta la simplificare): nu sunt puteri.
- Fiecare imagine are o etichetă cu itemii de pe ea; o problemă poate continua pe imaginea următoare (atunci e UN SINGUR item). Scrisul aflat în zona unei probleme ține de ea.

2) CORECTEAZĂ fiecare item cerut, cu cheia lui exactă:
CU BAREM — strict:
- BAREMUL este SINGURA sursă a punctajului: acorzi punctele DOAR pentru elementele punctate în barem pe care elevul le-a atins efectiv, exact cum le împarte baremul; nu depășești punctajul maxim; intențiile și pașii nescriși nu se punctează;
- rezultatul corect este cel din barem — nu recalcula altă valoare; formele echivalente se acceptă; o metodă corectă diferită de cea din barem primește punctajul corespunzător (regula oficială);
- la Subiectul al III-lea fiecare problemă are subpunctele a) și b) (la Evaluarea Națională de azi: a) 2p, b) 3p): câte un element în "subpuncte" pentru FIECARE subpunct, cu punctele lui; subpunctul nerezolvat → "necompletat", 0 puncte;
- la grile (Subiectele I și II): în "litera" pui litera încercuită de elev (sau null), iar în "subpuncte" un singur element (litera ""): 5 puncte doar dacă litera e cea din barem, altfel 0.
FĂRĂ BAREM: rezolvă TU atent fiecare item (verifică de două ori calculele), compară pas cu pas cu ce a scris elevul; NU acorzi puncte ("puncte" și "puncte_max" = null), doar verdicte.

3) CUM SCRII: la persoana a II-a, concis. Arată EXACT primul pas greșit și de ce; spune și ce a făcut bine. NU dezvălui rezultatul final corect dacă elevul a greșit și mai poate corecta singur — în "sfat" îi dai un indiciu. Baremul e pentru TINE, nu-l recita.
Un item fără scris de mână lizibil → un element cu verdictul "necompletat" (sau transcrierea cu [?] și verdictul potrivit, dacă se vede ceva).

REDACTARE JSON: în stringuri, comenzile LaTeX se scriu cu backslash DUBLAT ("$\\\\frac{1}{2}$", "$\\\\sqrt{2}$"). Fără ** sau alte marcaje în interiorul formulelor $...$.`;

// Textul de după imagini
function userText({ src, harta, scris, faraCheie, nImages }) {
  const L = [];
  if (nImages) L.push(nImages > 1 ? `Imaginile de mai sus (${nImages}) sunt zone din paginile testului, cu scrisul elevului pe ele.` : 'Imaginea de mai sus este o zonă din pagina testului, cu scrisul elevului pe ea.');
  L.push(`\nTESTUL${src.title ? ` „${String(src.title).slice(0, 140)}"` : ''} (text extras automat din PDF — radicalii, exponenții și fracțiile se pot pierde la extracție; enunțul real e cel din imagini):\n"""${String(src.test || '(textul testului nu e disponibil)').slice(0, 9000)}"""`);
  if (src.barem) L.push(`\nBAREMUL OFICIAL:\n"""${String(src.barem).slice(0, 9000)}"""`);
  if (harta && scris.length) {
    L.push(`\nITEMII DE CORECTAT DIN IMAGINI (câte un element în "itemi" pentru fiecare, cu cheia exactă):\n${scris.map((k) => `- "${k}" — ${longName(k)}${k[0] !== '3' ? ' (grilă: spune ce literă a încercuit)' : ''}`).join('\n')}`);
  } else if (!harta && nImages) {
    L.push('\nNu știu exact unde e fiecare exercițiu pe pagini: găsește TU, după textul tipărit, ce itemi a rezolvat elevul (grilele încercuite, problemele scrise) și corectează-i pe fiecare; cheia: subiectul și numărul ("1.3" = Subiectul I, exercițiul 3; "3.2" = Subiectul al III-lea, problema 2).');
  }
  if (faraCheie.length) {
    L.push(`\nGRILE la care baremul nu dă litera (rezolvă-le TU, din textul testului, și spune dacă alegerea elevului e corectă — câte un element pentru fiecare):\n${faraCheie.map((g) => `- "${g.key}" — ${longName(g.key)}: elevul a încercuit ${g.litere[0]})`).join('\n')}`);
  }
  L.push(src.barem
    ? '\nCorectează STRICT după barem. Răspunde DOAR cu obiectul JSON cerut.'
    : '\nNu există barem: verifică pașii și spune unde a greșit, fără puncte. Răspunde DOAR cu obiectul JSON cerut.');
  return L.join('\n');
}

// Răspunsul modelului → itemi curați. `want` = cheile cerute (null = fără hartă)
function normalizeAi(raw, { want = null, faraCheie = [], hasBarem, structura, keyMap = {} }) {
  const d = raw && typeof raw === 'object' ? raw : {};
  const wanted = want ? new Set([...want, ...faraCheie.map((g) => g.key)]) : null;
  const byKey = new Map();
  for (const x of Array.isArray(d.itemi) ? d.itemi.slice(0, 24) : []) {
    if (!x || typeof x !== 'object') continue;
    const key = String(x.cheie || '').trim();
    if (!KEY_RE.test(key)) continue;
    if (wanted && !wanted.has(key)) continue;
    if (byKey.has(key)) continue;
    const [s, ex] = key.split('.').map(Number);
    const grila = s !== 3;
    const cap = itemMax(key, structura);
    const parts = (Array.isArray(x.subpuncte) ? x.subpuncte : []).slice(0, 4).map((p) => {
      const q = p && typeof p === 'object' ? p : {};
      let max = hasBarem ? num(q.puncte_max) : null;
      if (max != null && (max <= 0 || max > 30)) max = null;
      let pts = hasBarem && max != null ? num(q.puncte) : null;
      if (pts != null) pts = round2(Math.max(0, Math.min(max, pts)));
      let verdict = VERDICT_ITEM.includes(q.verdict) ? q.verdict : 'partial';
      if (pts != null && max != null) {
        if (pts >= max) verdict = 'corect';
        else if (pts <= 0) { if (verdict !== 'necompletat') verdict = 'gresit'; }
        else verdict = 'partial';
      }
      return {
        l: /^[a-c]$/.test(String(q.litera || '')) ? String(q.litera) : '',
        verdict, puncte: pts, puncte_max: pts != null ? max : null,
        pasi: (Array.isArray(q.pasi) ? q.pasi : []).slice(0, 12).map((t) => ({
          text: String((t && t.text) || '').slice(0, 400),
          verdict: VERDICT_PAS.includes(t && t.verdict) ? t.verdict : 'neclar',
          comentariu: String((t && t.comentariu) || '').slice(0, 400),
        })).filter((t) => t.text),
        motiv: hasBarem ? String(q.motiv_punctaj || '').slice(0, 600) : '',
      };
    });
    const litera = grila && /^[a-d]$/.test(String(x.litera || '').toLowerCase()) ? String(x.litera).toLowerCase() : null;
    let item = {
      key, s, ex, tip: grila ? 'grila' : 'scris', eticheta: longName(key), sursa: 'corector',
      litera, transcriere: grila ? '' : String(x.transcriere || '').slice(0, 2500), parti: grila ? [] : parts.filter((p) => p.l || parts.length === 1),
    };
    if (grila) {
      // grila: punctajul îl dă BAREMUL (litera din tabel), nu modelul
      const corect = keyMap[ROMAN[s]] && keyMap[ROMAN[s]][ex];
      const p0 = parts[0] || {};
      if (corect && litera) item = { ...item, verdict: litera === corect ? 'corect' : 'gresit', puncte: litera === corect ? 5 : 0, puncte_max: 5, motiv: '' };
      else if (!litera) item = { ...item, verdict: 'necompletat', puncte: hasBarem ? 0 : null, puncte_max: hasBarem ? 5 : null, motiv: 'n-am văzut nicio literă încercuită' };
      else item = { ...item, verdict: p0.verdict || 'partial', puncte: p0.puncte != null ? (p0.puncte >= (p0.puncte_max || 5) ? 5 : 0) : null, puncte_max: p0.puncte != null ? 5 : null, motiv: p0.motiv || '', pasi: p0.pasi || [] };
    } else {
      const scored = item.parti.filter((p) => p.puncte != null);
      let pts = null, max = null;
      if (hasBarem && scored.length && scored.length === item.parti.length) {
        pts = round2(scored.reduce((a, p) => a + p.puncte, 0));
        max = round2(scored.reduce((a, p) => a + p.puncte_max, 0));
        if (cap != null) { max = cap; pts = Math.min(pts, cap); }
      }
      const vs = item.parti.map((p) => p.verdict);
      let verdict = !vs.length ? 'necompletat'
        : vs.every((v) => v === 'necompletat') ? 'necompletat'
          : vs.every((v) => v === 'corect') ? 'corect'
            : vs.every((v) => v === 'gresit' || v === 'necompletat') ? 'gresit' : 'partial';
      if (pts != null && max != null) {
        if (pts >= max) verdict = 'corect';
        else if (pts <= 0) { if (verdict !== 'necompletat') verdict = 'gresit'; } else verdict = 'partial';
      }
      item = { ...item, verdict, puncte: pts, puncte_max: max != null ? max : cap };
    }
    byKey.set(key, item);
  }
  // un item cerut și uitat de model → necorectat (nu „greșit")
  if (want) {
    for (const key of want) {
      if (byKey.has(key)) continue;
      const [s, ex] = key.split('.').map(Number);
      byKey.set(key, { key, s, ex, tip: s === 3 ? 'scris' : 'grila', eticheta: longName(key), sursa: 'corector', verdict: 'neclar', puncte: null, puncte_max: itemMax(key, structura), parti: [], transcriere: '', litera: null, motiv: 'corectorul nu a putut citi acest item' });
    }
  }
  return {
    items: [...byKey.values()],
    feedback: String(d.feedback || '').slice(0, 1200),
    sfat: String(d.sfat || '').slice(0, 600),
  };
}

// ── totalul ──
// itemii ATINȘI (cu scris) sunt în `items`; restul sunt necompletați (0p).
function summarize(items, { structura }) {
  const en = isEn666(structura);
  const graded = items.filter((it) => it.puncte != null && it.puncte_max != null);
  const pending = items.filter((it) => it.puncte == null);    // blocat (Premium) / fără barem / necitit
  const score = round2(graded.reduce((a, it) => a + it.puncte, 0));
  const gradedMax = round2(graded.reduce((a, it) => a + it.puncte_max, 0));
  const total = en ? 90 : null;
  const bySubject = {};
  for (const s of [1, 2, 3]) {
    const list = items.filter((it) => it.s === s);
    const g = list.filter((it) => it.puncte != null);
    bySubject[s] = { atinse: list.length, puncte: round2(g.reduce((a, it) => a + it.puncte, 0)), corectate: g.length };
  }
  const subjectsTouched = [1, 2, 3].filter((s) => bySubject[s].atinse > 0);
  // „complet": tot ce a scris elevul s-a putut puncta, și a lucrat la toate cele trei subiecte
  const complete = !!total && !pending.length && subjectsTouched.length === 3;
  return { score, gradedMax, total, pending: pending.map((it) => it.key), bySubject, complete };
}

const ICON = { corect: '✔', partial: '◐', gresit: '✖', necompletat: '—', neclar: '❔', blocat: '⭐' };
const ICON_PAS = { corect: '✔', gresit: '✖', incomplet: '◐', neclar: '❔' };
const fmtP = (n) => String(n).replace('.', ',');

// Mesajul profesorului în conversație (Markdown ușor + $…$, ca MathText)
function formatMessage({ items, sum, structura, title, hasBarem, feedback = '', sfat = '', nota = null, premiumNeeded = false, order = null }) {
  const out = [];
  const en = isEn666(structura);
  const head = sum.total
    ? `**${fmtP(sum.score)}/${sum.total}p**${sum.pending.length ? ' (fără itemii necorectați)' : ''}${nota != null && sum.complete ? ` · cu cele 10p din oficiu: **${fmtP(round2(sum.score + 10))}p**, nota **${fmtP(nota)}**` : ''}`
    : (sum.gradedMax ? `**${fmtP(sum.score)}/${fmtP(sum.gradedMax)}p**` : '');
  out.push(`✏️ **Corectarea rezolvării de pe PDF**${title ? ` · ${title}` : ''}${head ? ` — ${head}` : ''}`);
  const allKeys = order && order.length ? order : (en ? [1, 2, 3].flatMap((s) => [1, 2, 3, 4, 5, 6].map((e) => `${s}.${e}`)) : []);
  const done = new Set(items.map((it) => it.key));
  const necomp = allKeys.filter((k) => !done.has(k));
  if (allKeys.length) out.push(`Ai lucrat la ${done.size} din ${allKeys.length} itemi${necomp.length ? `; necompletați: ${necomp.map(short).join(', ')}` : ''}.`);
  for (const s of [1, 2, 3]) {
    const list = items.filter((it) => it.s === s).sort((a, b) => a.ex - b.ex);
    if (!list.length) continue;
    const g = sum.bySubject[s];
    const lines = [`**${SUBJ[s]}**${g.corectate ? ` — ${fmtP(g.puncte)}p` : ''}`];
    for (const it of list) {
      const ic = it.blocat ? ICON.blocat : (ICON[it.verdict] || '•');
      const pts = it.puncte != null && it.puncte_max != null ? ` — ${fmtP(it.puncte)}/${fmtP(it.puncte_max)}p` : '';
      if (it.tip === 'grila') {
        const ales = it.litere && it.litere.length > 1 ? it.litere.map((l) => `${l})`).join(' și ') : (it.litera ? `${it.litera})` : '');
        const icg = it.sursa === 'recunoastere' ? '❔' : ic;
        lines.push(`${icg} ${it.ex}.${ales ? ` ai ales ${ales}` : ''}${pts}${it.motiv ? ` · ${it.motiv}` : ''}`);
        continue;
      }
      if (it.blocat) { lines.push(`${ic} ${it.ex}. — scrisul tău se corectează cu Premium`); continue; }
      lines.push(`${ic} **Problema ${it.ex}**${pts}${it.motiv ? ` — ${it.motiv}` : ''}`);
      if (it.transcriere && it.transcriere.trim()) lines.push(`Ce am citit: ${it.transcriere.trim().split('\n').join(' · ')}`);
      for (const p of it.parti || []) {
        const pp = p.puncte != null && p.puncte_max != null ? ` ${fmtP(p.puncte)}/${fmtP(p.puncte_max)}p` : '';
        const steps = (p.pasi || []).map((t) => `${ICON_PAS[t.verdict] || '•'} ${t.text}${t.comentariu ? ` — ${t.comentariu}` : ''}`);
        lines.push(`${p.l ? `${p.l})` : '•'} ${ICON[p.verdict] || ''}${pp}${steps.length ? `: ${steps.join('; ')}` : ''}${p.motiv ? ` (${p.motiv})` : ''}`);
      }
    }
    out.push(lines.join('\n'));
  }
  if (premiumNeeded) out.push('⭐ Grilele ți le-am corectat după barem. Scrisul de mână de la Subiectul al III-lea îl citește și îl punctează profesorul virtual cu abonamentul Premium.');
  if (!hasBarem) out.push('Pentru acest test nu am barem, așa că la problemele scrise nu dau puncte — doar verific pașii.');
  if (feedback) out.push(feedback);
  if (sfat) out.push(`💡 ${sfat}`);
  out.push(sum.complete
    ? 'Rezultatul s-a salvat la „Rezultatele mele". Întreabă-mă orice despre corectare.'
    : 'Poți corecta oricând din nou: modifică pe PDF și apasă iar „✅ Corectează". Întreabă-mă orice despre corectare.');
  return out.join('\n\n');
}

module.exports = {
  cleanBody, gradeGrile, schema, SYSTEM, userText, normalizeAi, summarize, formatMessage,
  isEn666, itemMax, longName, short, MAX_IMAGES,
};
