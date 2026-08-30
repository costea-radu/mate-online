// =====================================================================
// api/ai-correct.js — CORECTAREA cu punctaj a testelor / exercițiilor PDF
// („Răspunde în chat" din Prof. Virtual și din Meditatorul AI)
//
// Fluxul: elevul deschide un test PDF (sau încarcă o poză / un PDF în chat)
// → apasă „Răspunde în chat" → primește un FORMULAR construit din barem
// (câte un câmp pentru fiecare exercițiu și subpunct a), b), c), cu punctele
// lui) sau, fără barem, doar câmpuri de răspuns → „Corectează" → AI-ul
// primește (1) testul, (2) baremul, (3) răspunsurile elevului și acordă
// punctaj PE FIECARE SUBPUNCT, explică greșelile, ce a făcut bine și ce
// nu a completat. Punctajul se salvează ca la testele interactive:
//   • test din platformă  → `progress` (apare la profesor/părinte/elev);
//   • poză/PDF încărcat   → `ai_pdf_results` (supabase/corectare_pdf.sql).
//
// POST { userId, action, ... }
//   action='pdf_text' { fileBase64 }                → { text, chars, truncated }
//   action='form'     { testText, baremText?, title? } → { items, hasBarem, total, oficiu, title }
//   action='grade'    { conversationId?, context?, testText, baremText?,
//                       items, answers, durationSec?, meditatii? }
// =====================================================================
const ai = require('./_lib/ai');
const med = require('./_lib/meditatii');
const { pageRenderer, toPdfData } = require('./_lib/pdftext');
const pdfContext = require('./ai-pdf-context'); // getPdfContext / loadContentForUser (textul + baremul DE PE SERVER)
const xp = require('./_lib/xp');
const duel = require('./_lib/duel');
const turneu = require('./_lib/turneu');

const MAX_TEXT = 12000;          // textul testului / baremului trimis modelului
const MAX_LEAVES = 40;           // câte cerințe (subpuncte) acceptăm în formular
const MAX_ANSWER = 1500;         // lungimea unui răspuns de elev
const { S } = ai;

// ── FORMULARUL SEMNAT ────────────────────────────────────────────────────────
// Formularul construit la „Răspunde în chat" se întoarce cu un TOKEN (HMAC,
// valabil FORM_TTL_SEC) peste: sursa (contentId sau hash-ul textului încărcat),
// existența baremului și amprenta cerințelor (id-uri + puncte). La „Corectează"
// serverul verifică tokenul: punctele maxime, baremul și testul nu mai pot fi
// modificate din browser (înainte, un elev putea trimite items cu puncte
// umflate și un „barem" propriu și obținea 100% în `progress`, la profesor).
const FORM_TTL_SEC = parseInt(process.env.AI_CORRECT_FORM_TTL || String(6 * 3600), 10);
function itemsFingerprint(items) {
  const canon = (Array.isArray(items) ? items : []).map((it) => [
    String(it?.id ?? ''), it?.puncte ?? null,
    (Array.isArray(it?.subpuncte) ? it.subpuncte : []).map((s) => [String(s?.id ?? ''), s?.puncte ?? null]),
  ]);
  return ai.sha256(JSON.stringify(canon)).slice(0, 32);
}
function signForm({ items, contentId = null, testText = '', hasBarem = false, total = 0, oficiu = 0 }) {
  return ai.signToken({
    v: 1, h: itemsFingerprint(items), c: contentId || null,
    t: contentId ? null : ai.sha256(String(testText || '').slice(0, MAX_TEXT)).slice(0, 32),
    b: !!hasBarem, tot: total, of: oficiu,
  }, FORM_TTL_SEC);
}
// Verifică tokenul față de ce a trimis clientul; întoarce payload-ul sau null.
function verifyForm(token, { items, contentId = null, testText = '' }) {
  const d = ai.verifyToken(token);
  if (!d || d.v !== 1) return null;
  if (d.h !== itemsFingerprint(items)) return null;
  if ((d.c || null) !== (contentId || null)) return null;
  if (!d.c && d.t !== ai.sha256(String(testText || '').slice(0, MAX_TEXT)).slice(0, 32)) return null;
  return d;
}

// Scheme STRICTE (Structured Outputs): formularul și corectarea vin ca JSON
// garantat valid, cu tipuri fixe — fără „10p" ca text sau verdicte inventate.
const FORM_SCHEMA = S.obj({
  titlu: S.str('titlul scurt al testului'),
  oficiu: S.int('10 la examenele oficiale, altfel 0'),
  items: S.arr(S.obj({
    id: S.str('ex. "I.1", "III.2"'),
    eticheta: S.str('numele scurt al cerinței'),
    cerinta: S.str('cerința din TEST, pe scurt, LaTeX între $...$'),
    puncte: S.nullable(S.num('punctajul maxim; null dacă exercițiul are subpuncte')),
    subpuncte: S.nullable(S.arr(S.obj({
      id: S.str('ex. "a"'),
      eticheta: S.str('ex. "a)"'),
      cerinta: S.str(),
      puncte: S.nullable(S.num()),
    }), 'null dacă exercițiul nu are subpuncte')),
  })),
});
const GRADE_SCHEMA = S.obj({
  items: S.arr(S.obj({
    id: S.str('id-ul cerinței, neschimbat'),
    puncte: S.num('punctele acordate (0 … maxim)'),
    verdict: S.enum(['corect', 'partial', 'gresit', 'necompletat']),
    explicatie: S.str('1–3 propoziții calde, la persoana a II-a'),
    tema: S.str('subiectul matematic, 1–3 cuvinte'),
  })),
  feedback: S.str('2–4 propoziții despre întreaga lucrare'),
});

module.exports = async function handler(req, res) {
  ai.applyCors(res);
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method Not Allowed' });

  const supa = ai.admin();
  try {
    const userId = await ai.authUser(req, supa);
    const profile = await ai.requireUser(supa, userId);
    const lim = await ai.enforceRateLimit(supa, userId, profile); // limite orare + bugete (vezi GHID_LIMITE_AI.md)
    await ai.enforceFreeQuota(supa, profile);

    const { action } = req.body || {};
    if (action === 'pdf_text') return await pdfText(req, res, supa, userId);
    if (action === 'form') return await buildForm(req, res, supa, userId, lim, profile);
    if (action === 'grade') {
      // cota lunară de corectări (doar notarea propriu-zisă; formularul nu consumă cota)
      await ai.enforceFeatureQuota(supa, userId, profile, 'corectari', lim);
      return await grade(req, res, supa, userId, lim, profile);
    }
    return res.status(400).json({ error: 'action invalid' });
  } catch (err) {
    console.error('ai-correct error:', err);
    return res.status(err.status || 500).json({ error: err.message || 'Eroare server', code: err.code || null });
  }
};

// ─── Textul unui PDF ÎNCĂRCAT DE ELEV în chat (temă, fișă, variantă) ─────────
async function pdfText(req, res, supa, userId) {
  const { fileBase64 } = req.body || {};
  if (!fileBase64) return res.status(400).json({ error: 'fileBase64 obligatoriu' });
  const b64 = String(fileBase64).replace(/^data:[^;]+;base64,/, '');
  if (b64.length > 5_000_000) return res.status(413).json({ error: 'PDF-ul e prea mare (max ~3.5 MB). Fotografiază exercițiul în loc.' });
  let text = '';
  try {
    const pdfParse = require('pdf-parse');
    const parsed = await pdfParse(toPdfData(Buffer.from(b64, 'base64')), { max: 12, pagerender: pageRenderer });
    text = String(parsed.text || '').replace(/[ \t]+/g, ' ').replace(/\n{3,}/g, '\n\n').trim();
  } catch (e) {
    console.warn('ai-correct pdf_text:', e.message);
    return res.status(422).json({ error: 'Nu am putut citi PDF-ul. Dacă e scanat, fotografiază exercițiul cu butonul 📷.' });
  }
  if (text.length < 40) {
    return res.status(422).json({ error: 'PDF-ul pare scanat (fără text). Fotografiază exercițiul cu butonul 📷.' });
  }
  await ai.logUsage(supa, userId, 'ai-correct:pdf_text', {});
  return res.status(200).json({ text: text.slice(0, 20000), chars: text.length, truncated: text.length > 20000 });
}

// ─── Repararea LaTeX-ului corupt de JSON (poza cu „rac{30}{100}") ────────────
// Modelul scrie „\frac" în stringul JSON → JSON.parse transformă „\f" în
// form-feed și rămâne „␌rac{30}{100}". med.fixLatex repară exact cazul acesta
// (\f/\t/\b de control, backslash dublu, comenzi rămase fără backslash în $...$).
function cleanMath(s) {
  if (typeof s !== 'string' || !s) return s;
  // „\r" mâncat din \right / \rightarrow (carriage return + „ight...")
  let t = s.replace(/\r(?=ight)/g, '\\r').replace(/\r/g, ' ');
  return med.fixLatex(t);
}

// ─── Normalizarea formularului venit de la model ─────────────────────────────
const cleanPts = (v) => {
  const n = parseFloat(String(v ?? '').replace(',', '.').replace(/[^\d.]/g, ''));
  return Number.isFinite(n) && n > 0 ? Math.round(n * 100) / 100 : null;
};
function normalizeItems(raw, { hasBarem }) {
  const items = [];
  let leaves = 0;
  (Array.isArray(raw) ? raw : []).forEach((it, i) => {
    if (!it || leaves >= MAX_LEAVES) return;
    const id = String(it.id || `ex${i + 1}`).slice(0, 24);
    const base = {
      id,
      eticheta: cleanMath(String(it.eticheta || it.label || id).slice(0, 120)),
      cerinta: cleanMath(String(it.cerinta || it.statement || '').slice(0, 600)),
    };
    const subs = Array.isArray(it.subpuncte) ? it.subpuncte : [];
    if (subs.length) {
      base.subpuncte = [];
      subs.forEach((s, j) => {
        if (!s || leaves >= MAX_LEAVES) return;
        const sid = String(s.id || String.fromCharCode(97 + j)).slice(0, 8);
        base.subpuncte.push({
          id: `${id}.${sid}`,
          eticheta: cleanMath(String(s.eticheta || `${sid})`).slice(0, 80)),
          cerinta: cleanMath(String(s.cerinta || s.statement || '').slice(0, 600)),
          puncte: cleanPts(s.puncte), // null = lipsă; se umple după punctajele oficiale
        });
        leaves++;
      });
      if (base.subpuncte.length) items.push(base);
    } else {
      base.puncte = cleanPts(it.puncte);
      items.push(base);
      leaves++;
    }
  });
  return items;
}

// punctele încă lipsă primesc valoarea implicită (se apelează DUPĂ ce
// punctajele oficiale EN/BAC au avut ocazia să le umple)
function fillMissingPoints(items, fallback) {
  leavesOf(items).forEach((l) => { if (cleanPts(l.puncte) == null) l.puncte = fallback; });
}

// ─── PUNCTAJELE OFICIALE — Evaluare Națională și Bacalaureat ─────────────────
// EN:  Subiectul I și II → 5p pe fiecare exercițiu grilă; Subiectul III →
//      a) 2p + b) 3p (subiectele vechi, cu a,b,c la III → 5p pe subpunct).
// BAC: 5p pe fiecare cerință (I: 6×5, II: 2×3×5, III: 2×3×5).
// Total 90p + 10p din oficiu = 100p.
// Regula de prioritate: BAREMUL are întotdeauna ultimul cuvânt — cu barem,
// valorile oficiale doar UMPLU punctele lipsă; FĂRĂ barem, ele se FORȚEAZĂ
// determinist (altfel modelul punea 10p peste tot — cazul raportat).
function applyOfficialPoints(items, category, hasBarem) {
  const cat = String(category || '').toLowerCase();
  const en = cat === 'evaluare-nationala';
  const bac = cat === 'bacalaureat';
  if (!en && !bac) return false;
  const force = !hasBarem; // baremul, când există, rămâne sursa punctelor
  const subjOf = (it) => {
    const m1 = /^(i{1,3})(?=[.\s]|$)/i.exec(String(it.id || ''));
    if (m1) return m1[1].toUpperCase();
    const m2 = /subiect\w*\s+(?:al\s+)?(i{1,3})\b/i.exec(String(it.eticheta || ''));
    return m2 ? m2[1].toUpperCase() : null;
  };
  const put = (leaf, val) => {
    if (force || cleanPts(leaf.puncte) == null) leaf.puncte = val;
  };
  let official = false;
  (items || []).forEach((it) => {
    const subj = subjOf(it);
    if (!subj) return; // structură neoficială (fișă) — punctele rămân cum sunt
    official = true;
    if (Array.isArray(it.subpuncte) && it.subpuncte.length) {
      if (en && subj === 'III' && it.subpuncte.length === 2) {
        put(it.subpuncte[0], 2); // a) 2p
        put(it.subpuncte[1], 3); // b) 3p
      } else {
        it.subpuncte.forEach((s) => put(s, 5));
      }
    } else {
      put(it, 5);
    }
  });
  return official;
}
// toate CERINȚELE punctabile (frunzele: exerciții simple + subpunctele a,b,c)
const leavesOf = (items) => (items || []).flatMap((it) => (it.subpuncte?.length ? it.subpuncte : [it]));

// Frunzele formularului venit de la CLIENT (id-urile subpunctelor sunt DEJA
// prefixate, ex. "III.1.a" — nu se mai re-normalizează). Eticheta subpunctului
// include exercițiul-părinte („Subiectul III, pr. 1 · a)") pentru corectare.
function flattenClientItems(items) {
  const leaves = [];
  const seen = new Set();
  const push = (leaf) => {
    if (leaves.length >= MAX_LEAVES) return;
    const srcId = String(leaf.id || `ex${leaves.length + 1}`).slice(0, 40);
    let id = srcId;
    while (seen.has(id)) id = id + "'";
    seen.add(id);
    leaves.push({ ...leaf, id, srcId });
  };
  (Array.isArray(items) ? items : []).forEach((it, i) => {
    if (!it) return;
    if (Array.isArray(it.subpuncte) && it.subpuncte.length) {
      it.subpuncte.forEach((s) => {
        if (!s) return;
        push({
          id: s.id || `${it.id || 'ex' + (i + 1)}.${leaves.length}`,
          eticheta: `${String(it.eticheta || it.id || '').slice(0, 90)} · ${String(s.eticheta || s.id || '').slice(0, 24)}`.trim(),
          cerinta: String(s.cerinta || it.cerinta || '').slice(0, 600),
          puncte: cleanPts(s.puncte) ?? 5,
        });
      });
    } else {
      push({
        id: it.id || `ex${i + 1}`,
        eticheta: String(it.eticheta || it.id || `Cerința ${i + 1}`).slice(0, 120),
        cerinta: String(it.cerinta || '').slice(0, 600),
        puncte: cleanPts(it.puncte) ?? 5,
      });
    }
  });
  return leaves;
}

// Regulile comune despre textul extras din PDF + scrierea LaTeX în JSON.
const FORM_TEXT_RULES = `ATENȚIE la textul extras automat din PDF:
- RADICALII, exponenții, fracțiile și săgețile de vectori se PIERD des la extracție. Semne că enunțul avea radical: cuvântul „radical", resturi „√", ori rezolvarea din barem ÎNCEPE prin ridicare la pătrat / membrul drept din barem este PĂTRATUL celui din test (în test „3x+6=6", în barem apare 36, adică 6² → enunțul real era $\\\\sqrt{3x+6}=6$). Atunci scrii cerința RECONSTRUITĂ corect, cu radical.
- "cerinta" este ÎNTOTDEAUNA enunțul din TEST (reconstruit dacă a pierdut simboluri) — NICIODATĂ primul pas de calcul din barem (ex. NU scrie „3x+6=36": aceea e ridicarea la pătrat din rezolvare, nu enunțul).
- În stringurile JSON, comenzile LaTeX se scriu cu backslash DUBLAT: "$\\\\sqrt{3x+6}=6$", "$\\\\frac{30}{100}$" — altfel se pierd la parsare. Nu pune ** în interiorul formulelor.`;

// Structura oficială de punctaj, după categorie (cerința utilizatorului).
function officialStructureNote(category) {
  const cat = String(category || '').toLowerCase();
  if (cat === 'evaluare-nationala') {
    return `PUNCTAJUL OFICIAL (Evaluare Națională): Subiectul I — 6 exerciții grilă × 5p; Subiectul II — 6 exerciții grilă × 5p; Subiectul III — exerciții cu subpunctele a) 2p și b) 3p (subiectele vechi, cu a,b,c la III → 5p pe subpunct). Total 90p, plus 10p din oficiu ("oficiu":10). Folosește EXACT aceste puncte.`;
  }
  if (cat === 'bacalaureat') {
    return `PUNCTAJUL OFICIAL (Bacalaureat): fiecare cerință valorează 5p — Subiectul I: 6 exerciții × 5p; Subiectul II: 2 probleme cu subpunctele a), b), c) × 5p; Subiectul III: la fel. Total 90p, plus 10p din oficiu ("oficiu":10).`;
  }
  return '';
}

// ─── FORMULARUL: câmpurile de răspuns, construite din barem (sau din test) ───
// Sursa testului + baremului pentru formular/corectare:
//   · test din platformă (contentId) → DE PE SERVER (cache ai_pdf_text /
//     calcul), cu verificarea accesului — textul și baremul din body se ignoră;
//   · poză / PDF încărcat de elev (fără contentId) → textul din body (al lui),
//     FĂRĂ barem (nu există unul verificat pentru materialele încărcate).
async function resolveSource(supa, profile, { contentId, testText, baremText, title, category }) {
  if (contentId) {
    const content = await pdfContext.loadContentForUser(supa, contentId, profile); // 404/403
    const ctx = await pdfContext.getPdfContext(supa, content);
    return {
      contentId: content.id,
      test: String(ctx.text || '').slice(0, MAX_TEXT),
      barem: String(ctx.baremText || '').slice(0, MAX_TEXT),
      title: String(title || content.title || '').slice(0, 140),
      category: content.category || category || '',
      fromServer: true,
    };
  }
  return {
    contentId: null,
    test: String(testText || '').slice(0, MAX_TEXT),
    barem: '', // materialele încărcate de elev nu au barem verificat
    title: String(title || '').slice(0, 140),
    category: String(category || ''),
    fromServer: false,
  };
}

async function buildForm(req, res, supa, userId, lim, profile) {
  const { testText = '', baremText = '', title = '', category = '', contentId = null } = req.body || {};
  const src = await resolveSource(supa, profile, { contentId, testText, baremText, title, category });
  const test = src.test;
  const barem = src.barem;
  if (test.trim().length < 30 && barem.trim().length < 30) {
    return res.status(400).json({ error: 'Nu am textul testului. Deschide un test PDF sau fotografiază / încarcă exercițiul în chat.' });
  }
  const hasBarem = barem.trim().length > 80;
  const structura = officialStructureNote(src.category);

  const system = hasBarem
    ? `Primești un TEST de matematică (bac / Evaluare Națională / fișă) și BAREMUL lui oficial. Construiește STRUCTURA formularului de răspuns al elevului, EXACT pe structura baremului:
- câte un element pentru FIECARE exercițiu punctat în barem, în ordinea din test (Subiectul I, II, III...);
- unde exercițiul are subpuncte a), b), c) — fiecare subpunct devine element SEPARAT, cu punctele LUI din barem (ca în barem);
- "puncte" = punctajul maxim al cerinței EXACT ca în barem (ex. 5, 3, 2). NU include punctele din oficiu în items; scrie-le separat în "oficiu" (10 la examenele oficiale, altfel 0);
- "cerinta" = cerința exercițiului, copiată pe scurt din TEST (max 2 rânduri, cu formulele în LaTeX $...$);
- "eticheta" = numele scurt al cerinței (ex. "Subiectul I, ex. 3" / "Subiectul III, pr. 1, a)").
${structura ? structura + '\n' : ''}${FORM_TEXT_RULES}
Răspunde DOAR cu JSON: {"titlu":"<titlul scurt al testului>","oficiu":10,"items":[{"id":"I.1","eticheta":"Subiectul I, ex. 1","cerinta":"...","puncte":5},{"id":"III.1","eticheta":"Subiectul III, pr. 1","cerinta":"...","subpuncte":[{"id":"a","eticheta":"a)","cerinta":"...","puncte":2},{"id":"b","eticheta":"b)","cerinta":"...","puncte":3}]}]}`
    : `Primești un exercițiu / test de matematică (extras dintr-un PDF sau transcris dintr-o poză a elevului). Construiește STRUCTURA formularului de răspuns:
- câte un element pentru FIECARE exercițiu / cerință din text, în ordinea lor (Subiectul I, II, III dacă există);
- unde exercițiul are subpuncte a), b), c) — fiecare subpunct devine element SEPARAT;
${structura ? '- ' + structura + '\n' : '- fără barem și fără structură de examen, fiecare cerință valorează 10 puncte ("puncte":10); "oficiu":0;\n'}- "cerinta" = cerința, copiată pe scurt (max 2 rânduri, formulele în LaTeX $...$);
- "eticheta" = numele scurt (ex. "Subiectul I, ex. 1" / "Exercițiul 2, b)").
${FORM_TEXT_RULES}
Răspunde DOAR cu JSON: {"titlu":"<titlu scurt: despre ce e testul>","oficiu":${structura ? 10 : 0},"items":[{"id":"I.1","eticheta":"Subiectul I, ex. 1","cerinta":"...","puncte":5},{"id":"III.1","eticheta":"Subiectul III, ex. 1","cerinta":"...","subpuncte":[{"id":"a","eticheta":"a)","cerinta":"...","puncte":2},{"id":"b","eticheta":"b)","cerinta":"...","puncte":3}]}]}`;

  const user = `TESTUL${src.title ? ` „${String(src.title).slice(0, 120)}"` : ''}${src.category ? ` (categoria: ${src.category})` : ''}:\n"""${test || '(textul testului nu e disponibil — folosește baremul)'}"""${hasBarem ? `\n\nBAREMUL OFICIAL:\n"""${barem}"""` : ''}`;

  let parsed = null;
  try {
    const r = await ai.chatJson({
      system, messages: [{ role: 'user', content: user }],
      temperature: 0, maxTokens: 3500,
      model: ai.pickModel(hasBarem ? ai.PDF_MODEL : ai.GEN_MODEL, lim), // peste bugetul zilnic → model standard
      schema: FORM_SCHEMA, schemaName: 'formular_raspuns',
      restoreLatex: false, // normalizeItems → cleanMath face deja reparația (inclusiv \r)
    });
    parsed = r.data;
    await ai.logUsage(supa, userId, 'ai-correct:form', r.usage);
  } catch (e) {
    if (e.usage) await ai.logUsage(supa, userId, 'ai-correct:form', e.usage);
    if (e.status !== 502) throw e; // 502 (format invalid) → mesajul de mai jos
  }
  const items = normalizeItems(parsed?.items, { hasBarem });
  if (!items.length) {
    return res.status(422).json({ error: 'Nu am putut construi formularul din acest material. Încearcă din nou sau fotografiază exercițiul mai clar.' });
  }
  // punctajele OFICIALE: fără barem se forțează; cu barem doar umplu golurile
  // (EN: 5p grile, III a=2p/b=3p; BAC: 5p pe cerință)
  const official = applyOfficialPoints(items, src.category, hasBarem);
  fillMissingPoints(items, hasBarem ? 5 : 10);
  const leaves = leavesOf(items);
  const total = Math.round(leaves.reduce((s, l) => s + (l.puncte || 0), 0) * 100) / 100;
  const oficiu = (official || hasBarem) ? Math.max(0, Math.min(10, parseInt(parsed?.oficiu, 10) || (official ? 10 : 0))) : 0;
  // tokenul semnat: la „Corectează" serverul verifică amprenta cerințelor
  // (id-uri + puncte) și sursa — formularul nu poate fi „editat" din browser
  const token = signForm({ items, contentId: src.contentId, testText: test, hasBarem, total, oficiu });
  return res.status(200).json({
    items, hasBarem, total, oficiu, token,
    contentId: src.contentId,
    title: cleanMath(String(parsed?.titlu || src.title || 'Exercițiu').slice(0, 140)),
  });
}

// ─── CORECTAREA: test + barem + răspunsuri → punctaj pe subpuncte ────────────
const VERDICTE = ['corect', 'partial', 'gresit', 'necompletat'];

async function grade(req, res, supa, userId, lim, profile) {
  const {
    conversationId = null, context = {}, testText: bodyTestText = '',
    items = [], answers = {}, durationSec = 0, meditatii = false, title: bodyTitle = '', token = null,
    images = [], // Etapa 2 (1.1): poze cu REZOLVAREA SCRISĂ DE MÂNĂ (data URL), max 3
  } = req.body || {};
  const photos = (Array.isArray(images) ? images : []).filter((u) => typeof u === 'string' && /^data:image\/(jpeg|png|webp);base64,/.test(u) && u.length <= 2_200_000).slice(0, 3);

  // 1) formularul trebuie să fie cel semnat de server (id-uri + puncte + sursă)
  const contentId = context.contentId || null;
  const signed = verifyForm(token, { items, contentId, testText: bodyTestText });
  if (!signed) {
    return res.status(400).json({ error: 'Formularul a expirat sau a fost modificat. Apasă din nou „Răspunde în chat" și completează răspunsurile.', code: 'FORM_TOKEN' });
  }
  // 2) testul + baremul: DE PE SERVER pentru materialele din platformă
  //    (cache ai_pdf_text), din body doar pentru poza/PDF-ul propriu al elevului
  const src = await resolveSource(supa, profile, {
    contentId, testText: bodyTestText, baremText: '', title: bodyTitle || context.title, category: context.category,
  });
  const testText = src.test;
  const baremText = src.barem;
  const hasBarem = String(baremText || '').trim().length > 80;
  // plasă de siguranță: punctajele oficiale EN/BAC se respectă și la corectare
  applyOfficialPoints(items, src.category, hasBarem);
  const leaves = flattenClientItems(items);
  if (!leaves.length) return res.status(400).json({ error: 'Formularul nu are cerințe de corectat.' });
  const title = String(bodyTitle || context.title || src.title || 'Exercițiu').slice(0, 140);

  // răspunsurile elevului, pe cerințe (gol = necompletat)
  const ans = {};
  leaves.forEach((l) => {
    const raw = answers ? (answers[l.id] != null ? answers[l.id] : answers[l.srcId]) : null;
    ans[l.id] = raw != null ? String(raw).trim().slice(0, MAX_ANSWER) : '';
  });
  const answeredCount = leaves.filter((l) => ans[l.id]).length;
  if (!answeredCount && !photos.length) return res.status(400).json({ error: 'Completează măcar un răspuns (sau adaugă o poză cu rezolvarea) înainte de corectare.' });

  // ── promptul de corectare ──
  const listing = leaves.map((l) =>
    `[${l.id}] ${l.eticheta} (maxim ${l.puncte}p)${l.cerinta ? `\nCERINȚA: ${l.cerinta}` : ''}\nRĂSPUNSUL ELEVULUI: ${ans[l.id] ? `"""${ans[l.id]}"""` : '(necompletat)'}`
  ).join('\n\n');

  const system = `Ești „Profesorul Virtual" de pe ExamenMate — corectezi lucrarea unui elev român la matematică, ca un profesor corector de examen.
Primești: (1) TESTUL, ${hasBarem ? '(2) BAREMUL OFICIAL de corectare, ' : ''}(${hasBarem ? '3' : '2'}) RĂSPUNSURILE elevului pe fiecare cerință.
Reguli de corectare:
${hasBarem ? `- BAREMUL este SINGURA sursă a punctajului: pentru fiecare cerință, compară răspunsul elevului cu elementele punctate din barem și acordă punctele DOAR pentru elementele atinse (punctaj parțial exact ca în barem). Nu depăși punctajul maxim al cerinței.
- La cerințele de tip grilă sau „se punctează doar rezultatul": rezultat corect = punctaj întreg; altfel 0.
- Rezultatul corect al fiecărei cerințe este cel din barem — NU recalcula altă valoare.` : `- Fără barem oficial: rezolvă TU fiecare cerință foarte atent (verifică de două ori calculele), apoi compară cu răspunsul elevului și punctează din maximul cerinței (punctaj parțial pentru metodă corectă cu greșeli de calcul).`}
- Acceptă forme echivalente ale rezultatului (ex. $1/2$ = $0,5$, ordinea factorilor, simplificări echivalente).
- SIMBOLURI PIERDUTE LA EXTRACȚIE: textul testului vine dintr-o extracție automată din PDF — radicalii, exponenții și fracțiile se pot pierde. Dacă enunțul din test și ${hasBarem ? 'baremul' : 'logica rezolvării'} nu se potrivesc numeric (ex. în test „3x+6=6", ${hasBarem ? 'în barem apare 36, adică 6²' : 'iar rezolvarea firească trece prin 36 = 6²'}), enunțul REAL avea radical ($\\\\sqrt{3x+6}=6$) — corectează după enunțul reconstruit și explică-i elevului legătura, fără să afirmi că un număr „vine din enunț" dacă acolo scrie altceva.
- Răspuns gol → "verdict":"necompletat", 0 puncte.
- "explicatie": 1–3 propoziții calde, în română, la persoana a II-a: ce a făcut bine, UNDE a greșit și ce trebuia făcut (cu formulele în LaTeX $...$). La cerințele corecte, o confirmare scurtă.
- "tema": subiectul matematic al cerinței, în 1–3 cuvinte (ex. "ecuații", "progresii", "funcții", "geometrie").
- "feedback" general: 2–4 propoziții despre întreaga lucrare: ce stăpânește, la ce a greșit, ce nu a completat și ce să exerseze.
- REDACTARE: în stringurile JSON, comenzile LaTeX se scriu cu backslash DUBLAT ("$\\\\frac{30}{100} \\\\cdot 500 = 150$", "$\\\\sqrt{3x+6}$") — altfel se pierd la parsare. Nu pune ** sau alte marcaje în interiorul formulelor $...$.
Răspunde DOAR cu JSON: {"items":[{"id":"<id-ul cerinței>","puncte":<număr>,"verdict":"corect|partial|gresit|necompletat","explicatie":"...","tema":"..."}],"feedback":"..."} — cu EXACT un element pentru FIECARE cerință primită, cu id-ul ei neschimbat.`;

  const userText = `TESTUL${title ? ` „${title}"` : ''}:\n"""${String(testText || '').slice(0, MAX_TEXT)}"""\n\n${hasBarem ? `BAREMUL OFICIAL:\n"""${String(baremText).slice(0, MAX_TEXT)}"""\n\n` : ''}RĂSPUNSURILE ELEVULUI (corectează fiecare cerință):\n${listing}${photos.length ? `\n\nPOZE CU REZOLVAREA SCRISĂ DE MÂNĂ (${photos.length}): citește pașii și rezultatele din imagini pentru FIECARE cerință; punctezi și ce e scris în poze (metodă, calcule, rezultat), ca un profesor corector. Dacă pentru o cerință există și text tastat, și rezolvare în poză, le iei împreună; textul tastat are prioritate la rezultatul final dacă diferă. O cerință cu rezolvare DOAR în poză NU este „necompletată".` : ''}`;
  // mesaj multimodal: text + pozele (format OpenAI image_url); fără poze → doar text
  const user = photos.length
    ? [{ type: 'text', text: userText }, ...photos.map((u) => ({ type: 'image_url', image_url: { url: u, detail: 'high' } }))]
    : userText;

  const maxTokens = Math.min(7000, 900 + leaves.length * 220);
  const gradeModel = ai.pickModel(hasBarem ? ai.PDF_MODEL : ai.GEN_MODEL, lim); // peste bugetul zilnic → model standard
  let parsed = null;
  try {
    // schemă strictă: verdictele din enum, punctele numere; chatJson reîncearcă
    // singur o dată dacă răspunsul nu e JSON valid
    const r = await ai.chatJson({
      system, messages: [{ role: 'user', content: user }],
      temperature: 0.1, maxTokens, model: gradeModel,
      schema: GRADE_SCHEMA, schemaName: 'corectare_lucrare',
      restoreLatex: false, // cleanMath de mai jos face reparația LaTeX
    });
    parsed = r.data;
    await ai.logUsage(supa, userId, 'ai-correct:grade', r.usage);
  } catch (e) {
    if (e.usage) await ai.logUsage(supa, userId, 'ai-correct:grade', e.usage);
    if (e.status !== 502) throw e;
  }
  if (!parsed || !Array.isArray(parsed.items)) {
    return res.status(502).json({ error: 'Corectarea nu a reușit (răspuns invalid). Mai încearcă o dată.' });
  }

  // ── punctajele, validate pe server (modelul nu poate depăși maximul) ──
  const byId = {};
  parsed.items.forEach((g) => { if (g && g.id != null) byId[String(g.id)] = g; });
  const graded = leaves.map((l) => {
    const g = byId[l.id] || {};
    // cu poze, o cerință fără text tastat poate fi rezolvată în imagine —
    // verdictul modelului rămâne; fără poze, gol = necompletat (ca înainte)
    const answered = !!ans[l.id] || (photos.length > 0 && VERDICTE.includes(g.verdict) && g.verdict !== 'necompletat');
    let verdict = VERDICTE.includes(g.verdict) ? g.verdict : (answered ? 'gresit' : 'necompletat');
    if (!answered) verdict = 'necompletat';
    let puncte = Math.max(0, Math.min(l.puncte, Number(String(g.puncte ?? 0).replace(',', '.')) || 0));
    if (verdict === 'necompletat') puncte = 0;
    if (verdict === 'corect') puncte = l.puncte;
    puncte = Math.round(puncte * 100) / 100;
    return {
      id: l.id, eticheta: cleanMath(l.eticheta), cerinta: cleanMath(l.cerinta), maxPuncte: l.puncte,
      puncte, verdict, answered,
      explicatie: cleanMath(String(g.explicatie || '').slice(0, 700)),
      tema: String(g.tema || '').slice(0, 60),
      raspuns: ans[l.id] || null,
    };
  });

  const score = Math.round(graded.reduce((s, g) => s + g.puncte, 0) * 100) / 100;
  const maxScore = Math.round(graded.reduce((s, g) => s + g.maxPuncte, 0) * 100) / 100;
  const pct = maxScore ? Math.round((score / maxScore) * 100) : 0;
  const nota = med.notaTest(score, maxScore); // include cele 10 puncte din oficiu (regula notaDinScor)
  const feedback = cleanMath(String(parsed.feedback || '').slice(0, 1500));
  const necompletate = graded.filter((g) => g.verdict === 'necompletat').map((g) => g.eticheta);

  // ── salvarea punctajului (ca la testele interactive) ──
  const sessionSeconds = Math.max(0, Math.min(6 * 3600, Math.round(Number(durationSec) || 0)));
  let saved = null, attempts = 1, timeSpent = sessionSeconds;
  const category = src.category || context.category || null; // contentId: verificat mai sus (token + acces)
  try {
    if (contentId) {
      // TEST DIN PLATFORMĂ → `progress`, exact ca exercițiile interactive
      // (apare automat la „Rezultate elevi", „Raport AI", cont părinte și elev)
      const r = await saveProgress(supa, userId, {
        contentId, title, category, score, maxScore, sessionSeconds,
      });
      attempts = r.attempts; timeSpent = r.timeSpent; saved = { kind: 'progress' };

      // GAMIFICARE: testele PDF corectate de AI intră în aceleași socoteli ca
      // exercițiile interactive — XP, misiunea zilei, ligă, dueluri, turnee.
      // Corectarea o face serverul, deci scorul e la fel de „verificat".
      try {
        const gami = await xp.award(supa, userId, {
          source: 'pdf', refId: contentId, content: { category, difficulty: src?.difficulty },
          score, maxScore, attempts, meta: { titlu: title || null },
        });
        await duel.recordByContent(supa, userId, contentId, { score, maxScore });
        if (gami && gami.xpExercitiu > 0) {
          await turneu.recordScore(supa, userId, contentId, { points: gami.xpExercitiu, pct });
        }
      } catch (e) { console.warn('ai-correct gamificare:', e.message); }
    } else {
      // POZĂ / PDF ÎNCĂRCAT DE ELEV → `ai_pdf_results`
      const r = await saveUploadResult(supa, userId, {
        title, category, score, maxScore, sessionSeconds,
        breakdown: graded.map(({ id, eticheta, puncte, maxPuncte, verdict }) => ({ id, eticheta, puncte, maxPuncte, verdict })),
        feedback, testText,
      });
      attempts = r.attempts; timeSpent = r.timeSpent; saved = { kind: 'upload' };
    }
  } catch (e) {
    console.error('ai-correct: salvarea punctajului a eșuat:', e.message);
    saved = { kind: 'nesalvat', error: e.message };
  }

  // ── corectarea intră în CONVERSAȚIE (istoricul chatului + „a folosit Prof. Virtual") ──
  let convId = conversationId || null, messageId = null;
  try {
    if (convId) {
      const { data } = await supa.from('ai_conversations').select('id, user_id').eq('id', convId).maybeSingle();
      if (!data || data.user_id !== userId) convId = null;
    }
    if (!convId) {
      const { data } = await supa.from('ai_conversations')
        .insert({ user_id: userId, title: `Corectare: ${title}`.slice(0, 60), context: { pdf: !!context.pdf, meditatii: !!meditatii, contentId, category, title } })
        .select('id').single();
      convId = data?.id || null;
    }
    if (convId) {
      const userMsg = `📝 Am completat formularul de răspunsuri la „${title}" (${answeredCount}/${leaves.length} cerințe) și am apăsat „Corectează".`;
      const detail = graded.map((g) => {
        const ic = g.verdict === 'corect' ? '✔' : g.verdict === 'partial' ? '◐' : g.verdict === 'necompletat' ? '—' : '✖';
        return `${ic} ${g.eticheta}: ${g.puncte}/${g.maxPuncte}p${g.explicatie ? ` — ${g.explicatie}` : ''}`;
      }).join('\n');
      const asstMsg = `📋 Corectarea lucrării „${title}": **${score}/${maxScore} puncte** (${pct}%)${nota != null ? ` · nota ${nota}` : ''}.\n\n${feedback}\n\n${detail}${necompletate.length ? `\n\nNu ai completat: ${necompletate.join(', ')}.` : ''}\n\nÎntreabă-mă orice despre corectare — îți explic fiecare cerință pas cu pas.`;
      await supa.from('ai_messages').insert({ conversation_id: convId, role: 'user', content: userMsg, mode: 'tutor' });
      const { data: saved2 } = await supa.from('ai_messages')
        .insert({ conversation_id: convId, role: 'assistant', content: asstMsg, mode: 'tutor', metadata: { correction: { score, maxScore, nota, title } } })
        .select('id').single();
      messageId = saved2?.id || null;
      await supa.from('ai_conversations').update({ updated_at: new Date().toISOString() }).eq('id', convId);
    }
  } catch (e) { console.warn('ai-correct: salvarea în conversație a eșuat:', e.message); }

  // ── MEDITAȚII: rezultatul alimentează meditatorul (greșeli → „încă 10 la fel",
  //    stăpânire pe subiecte → plan, părinții sunt anunțați) ──
  let mistakeIds = [];
  if (meditatii) {
    try { mistakeIds = await meditatiiEffects(supa, userId, { graded, title, score, maxScore, pct, sessionSeconds }); }
    catch (e) { console.warn('ai-correct meditatii:', e.message); }
  }

  return res.status(200).json({
    conversationId: convId, messageId,
    items: graded, score, maxScore, pct, nota,
    oficiu: hasBarem ? 10 : 0,
    feedback, necompletate,
    saved, attempts, timeSpent, mistakeIds,
  });
}

// `progress` cu upsert progresiv (tolerează instalări fără coloanele snapshot)
async function saveProgress(supa, userId, { contentId, title, category, score, maxScore, sessionSeconds }) {
  let existing = null;
  try {
    const { data } = await supa.from('progress').select('*')
      .eq('user_id', userId).eq('content_id', contentId).maybeSingle();
    existing = data || null;
  } catch { /* prima încercare */ }
  const attempts = (existing?.attempts || 0) + 1;
  const timeSpent = (existing?.time_spent || 0) + sessionSeconds;
  const base = {
    user_id: userId, content_id: contentId,
    score: Math.round(score), max_score: Math.round(maxScore),
    completed_at: new Date().toISOString(), attempts,
  };
  const snapshot = { test_title: title || null, content_type: 'pdf', category: category || null };
  let { error } = await supa.from('progress')
    .upsert({ ...base, ...snapshot, time_spent: timeSpent }, { onConflict: 'user_id,content_id' });
  if (error) {
    ({ error } = await supa.from('progress').upsert({ ...base, time_spent: timeSpent }, { onConflict: 'user_id,content_id' }));
  }
  if (error) {
    ({ error } = await supa.from('progress').upsert(base, { onConflict: 'user_id,content_id' }));
  }
  if (error) throw new Error(error.message);
  return { attempts, timeSpent };
}

// `ai_pdf_results` pentru poze / PDF-uri încărcate de elev (cheie = hash-ul textului)
async function saveUploadResult(supa, userId, { title, category, score, maxScore, sessionSeconds, breakdown, feedback, testText }) {
  const sourceKey = 'up-' + ai.sha256(String(testText || title || '').slice(0, 4000)).slice(0, 40);
  let existing = null;
  try {
    const { data } = await supa.from('ai_pdf_results').select('id, attempts, time_spent')
      .eq('user_id', userId).eq('source_key', sourceKey).maybeSingle();
    existing = data || null;
  } catch { /* tabel nou */ }
  const attempts = (existing?.attempts || 0) + 1;
  const timeSpent = (existing?.time_spent || 0) + sessionSeconds;
  const { error } = await supa.from('ai_pdf_results').upsert({
    user_id: userId, content_id: null, source_key: sourceKey, source: 'incarcat',
    title: title || 'Exercițiu corectat de Prof. Virtual', category: category || null,
    score, max_score: maxScore, attempts, time_spent: timeSpent, used_tutor: true,
    breakdown, feedback: String(feedback || '').slice(0, 1500),
    completed_at: new Date().toISOString(),
  }, { onConflict: 'user_id,source_key' });
  if (error) {
    throw new Error(`${error.message} — rulează supabase/corectare_pdf.sql în Supabase → SQL Editor.`);
  }
  return { attempts, timeSpent };
}

// Meditații: greșelile intră în jurnal (pentru „încă 10 exerciții la fel"),
// stăpânirea pe subiecte se actualizează (alimentează planul de învățare și
// recomandările), seria de studiu crește, iar părinții sunt anunțați.
async function meditatiiEffects(supa, userId, { graded, title, score, maxScore, pct, sessionSeconds }) {
  const medProfile = await med.getProfile(supa, userId);
  const category = med.categoryFor(medProfile || {});

  // 1) jurnalul de greșeli (doar cerințele la care a răspuns și a greșit)
  const wrong = graded.filter((g) => g.answered && (g.verdict === 'gresit' || g.verdict === 'partial'));
  let mistakeIds = [];
  if (wrong.length) {
    const analysis = await med.classifyMistakes(wrong.map((g) => ({
      statement: g.cerinta || g.eticheta, correct: '',
      given: g.raspuns, explanation: g.explicatie,
    })), { supa, userId, endpoint: 'ai-correct:mistakes' });
    const rows = wrong.map((g, i) => ({
      user_id: userId, chapter: null,
      topic: g.tema || title.slice(0, 60),
      error_type: (analysis.find((a) => a.index === i) || {}).errorType || 'necunoscut',
      statement: (g.cerinta || g.eticheta || '').slice(0, 600),
      student_answer: String(g.raspuns || '').slice(0, 600),
      correct_answer: '',
      analysis: ((analysis.find((a) => a.index === i) || {}).analysis || g.explicatie || '').slice(0, 600),
    }));
    const { data: ins } = await supa.from('ai_meditatii_mistakes').insert(rows).select('id');
    mistakeIds = (ins || []).map((m) => m.id);
  }

  // 2) stăpânirea pe subiecte (alimentează planul + recomandările meditatorului)
  await Promise.allSettled(graded.filter((g) => g.answered).map((g) =>
    supa.rpc('bump_skill_mastery', {
      p_user: userId, p_category: category,
      p_topic: require('./_lib/taxonomy').canonicalTopic(g.tema || 'general', { category }), p_correct: g.verdict === 'corect',
    })
  ));

  // 3) seria de studiu + timpul total
  if (medProfile) {
    const streak = med.bumpStreak(medProfile);
    await supa.from('ai_meditatii_profile').update({
      streak_days: streak.streak_days, last_study_date: streak.last_study_date,
      total_seconds: (medProfile.total_seconds || 0) + sessionSeconds,
    }).eq('user_id', userId);
  }

  // 4) părinții asociați află (o notificare pe zi)
  try {
    const [{ data: links }, { data: prof }] = await Promise.all([
      supa.from('mentor_students').select('mentor_id').eq('student_id', userId).eq('mentor_role', 'parinte'),
      supa.from('profiles').select('full_name, email').eq('id', userId).single(),
    ]);
    const parents = [...new Set((links || []).map((l) => l.mentor_id))];
    const who = prof?.full_name || prof?.email || 'Copilul tău';
    const today = new Date().toISOString().slice(0, 10);
    await Promise.allSettled(parents.map((pid) => ai.createNotification(supa, {
      recipientId: pid, type: 'meditatii_parent',
      title: `🎓 ${who} a lucrat azi cu Profesorul Virtual`,
      body: `A rezolvat și corectat „${title}": ${score}/${maxScore} (${pct}%).`,
      data: { url: '/profil', studentId: userId },
      dedupeKey: `med_parent:${userId}:${today}`, dedupeDays: 1,
    })));
  } catch { /* opțional */ }

  return mistakeIds;
}

// exportate pentru teste (test/etapa1-*.test.js)
module.exports.signForm = signForm;
module.exports.verifyForm = verifyForm;
module.exports.itemsFingerprint = itemsFingerprint;
module.exports.applyOfficialPoints = applyOfficialPoints;
