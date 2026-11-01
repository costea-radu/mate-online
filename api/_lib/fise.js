// =====================================================================
// api/_lib/fise.js — BANCA DE EXERCIȚII din fișele claselor 5–12
// (cerut pe 1 nov. 2026: „Teste diferite / elev" și din fișele cu exerciții)
//
// Fișele PDF ale claselor (content: clasa-5 … clasa-12, content_type 'pdf') își
// grupează exercițiile diferit de la o fișă la alta — așa cum sunt scrise în ele:
//   • „Nivel 1" … „Nivel 22: Media geometrică" (Radicali, clasa a VII-a);
//   • „1) TRIUNGHIURI ASEMENEA" → „MODEL 1", „MODEL 2" (Asemănare);
//   • „Exercițiul 1 … de forma x² + bx = 0" cu 20 de ecuații (Ecuația de gradul II);
//   • secțiuni („Adunări și scăderi (50 de exerciții)");
//   • doar o listă numerotată (fișele de BAC, clasele 9–12).
// Exercițiile stau des câte 2–4 pe același rând, iar formulele lipsesc din
// stratul de text (sunt desenate) — de aceea fișa o CITEȘTE modelul cu vedere
// (PDF_MODEL), pe bucăți de câte 2 pagini, O SINGURĂ DATĂ. Rezultatul (grupele,
// cu exercițiile lor în LaTeX) se păstrează în `fise_banca` (supabase/fise_banca.sql)
// și îl folosesc toți profesorii; testele se compun apoi fără niciun cost.
//
// Funcțiile pure (schema, îmbinarea bucăților, ordinea fișelor) se testează în
// Node: test/teste-diferite-fise.test.js.
// =====================================================================

const CLASS_CATS = ['clasa-5', 'clasa-6', 'clasa-7', 'clasa-8', 'clasa-9', 'clasa-10', 'clasa-11', 'clasa-12'];
const KINDS = ['nivel', 'tip', 'sectiune', 'lista'];
const PAGES_PER_CHUNK = 2;
const MAX_PAGES = 40;          // fișele site-ului au cel mult ~20 de pagini
const CONCURRENCY = 3;
const MAX_EX_PER_GROUP = 600;
const MAX_TEXT = 1500;
// o bucată de pagini trimisă modelului (PDF, înainte de base64). Fișele cu poze
// trec peste limita agentului PDF (1,5 MB); API-ul primește până la 32 MB per
// cerere — 6 MB lasă loc destul. Peste ea, bucata se citește pagină cu pagină.
const MAX_SHEET_PART_BYTES = 6 * 1024 * 1024;
const sheetPart = (buf, filename) => (!buf || buf.length > MAX_SHEET_PART_BYTES ? null
  : { type: 'file', file: { filename, file_data: `data:application/pdf;base64,${buf.toString('base64')}` } });

// Schema STRICTĂ a unei bucăți citite (Structured Outputs — ai.S)
function schemaFor(S) {
  return S.obj({
    groups: S.arr(S.obj({
      title: S.nullable(S.str('titlul EXACT din fișă („Nivel 3", „Triunghiuri asemenea · MODEL 2", „Exercițiul 4 — ecuații de forma x² + bx = 0", „Adunări și scăderi"); null = continuarea grupului de pe pagina anterioară')),
      kind: S.enum(KINDS, 'nivel = „Nivel N"; tip = tip / model / exercițiu-tip; sectiune = alt titlu; lista = fără titlu'),
      instruction: S.nullable(S.str('cerința comună a grupului, scrisă o singură dată în fișă („Calculați:", „Rezolvați în R ecuațiile:"), altfel null')),
      exercises: S.arr(S.obj({
        n: S.str('numărul sau litera din fișă: „7", „7 a)", „b)"'),
        text: S.str('enunțul EXACT, cu formulele în LaTeX între $…$'),
        figure: S.bool('true dacă exercițiul are nevoie de o figură desenată în fișă'),
      })),
    })),
  });
}

const SYSTEM = `Ești asistentul unui profesor de matematică din România. Primești câteva pagini dintr-o FIȘĂ DE EXERCIȚII (PDF) și le TRANSCRII FIDEL, ca profesorul să poată alege apoi exercițiile pentru teste.

GRUPEAZĂ exercițiile EXACT după titlurile din fișă, cu textul lor:
- nivelele („Nivel 1", „Nivelul 3: Raționalizare") → kind "nivel";
- tipurile („Tipul 2", „MODEL 1", „Exercițiul 3 — ecuații de forma …", „Problema-tip …") → kind "tip"; un tip aflat sub o secțiune („1) TRIUNGHIURI ASEMENEA" → „MODEL 1") are titlul cu amândouă: „Triunghiuri asemenea · MODEL 1";
- alte titluri de secțiune („Adunări și scăderi (50 de exerciții)", „Progresii aritmetice") → kind "sectiune";
- fără niciun titlu (o listă numerotată) → kind "lista", titlul = tema fișei.
- Un exercițiu numerotat cu MULTE subpuncte de același fel (a), b), … z), aa) …) este de fapt un TIP: grupul = acel exercițiu (titlu „Exercițiul 2 — <cerința, pe scurt>", kind "tip", instruction = cerința), iar exercițiile grupului = subpunctele lui (n = „a)", „b)" …).
- Subpunctele PUȚINE ale unui exercițiu (ex. „1. a) √9 = b) √16 =") rămân în același exercițiu.

FIECARE exercițiu: n = numărul / litera din fișă; text = enunțul EXACT, cu TOATE formulele în LaTeX între $…$ (fracții \\frac{}{}, radicali \\sqrt{}, puteri ^{}, indici _{}, √(−2)² → $\\sqrt{(-2)^2}$). NU rezolva, NU completa răspunsuri, NU inventa exerciții, NU schimba numerele sau notațiile.
instruction = cerința comună a grupului, dacă e scrisă o singură dată (ex. „Calculați:"); altfel null.
Exercițiile așezate pe mai multe coloane se iau în ordinea numerelor (1, 2, 3 …), nu pe rânduri.
Dacă primele exerciții de pe aceste pagini continuă un grup început mai devreme (nu au niciun titlu deasupra lor pe aceste pagini), pune-le într-un grup cu title null — se lipesc de grupul anterior.
Ignoră antetul și subsolul paginii, numerele de pagină și răspunsurile / soluțiile (dacă fișa le are, nu le transcrie). Dacă un exercițiu depinde de o figură, pune figure: true.`;

const clean = (s, max = MAX_TEXT) => String(s || '').replace(/[ \t\r\f\v]+/g, ' ').replace(/\s*\n\s*/g, '\n').trim().slice(0, max);
const norm = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/gi, '').toLowerCase();

// Îmbină bucățile citite (în ordinea paginilor) în grupele fișei:
//   • un grup fără titlu (title null) se lipește de grupul anterior;
//   • un grup cu ACELAȘI titlu ca anteriorul (modelul l-a repetat la începutul
//     bucății) — tot lipit;
//   • grupele goale se scot; cheile devin g1, g2, … (stabile pentru selecție).
function mergeChunks(chunks) {
  const out = [];
  for (const ch of chunks || []) {
    for (const g of (ch && Array.isArray(ch.groups) ? ch.groups : [])) {
      const exercises = (Array.isArray(g.exercises) ? g.exercises : [])
        .map((e) => ({ n: clean(e && e.n, 20), text: clean(e && e.text), ...(e && e.figure ? { figure: true } : {}) }))
        .filter((e) => e.text.length > 0);
      const title = clean(g.title, 160);
      const last = out[out.length - 1];
      if (last && (!title || norm(title) === norm(last.title))) {
        last.exercises.push(...exercises);
        if (!last.instruction && g.instruction) last.instruction = clean(g.instruction, 400) || null;
        continue;
      }
      out.push({
        title: title || 'Exerciții',
        kind: KINDS.includes(g.kind) ? g.kind : 'lista',
        instruction: clean(g.instruction, 400) || null,
        exercises,
      });
    }
  }
  return out.filter((g) => g.exercises.length)
    .map((g, i) => ({ key: `g${i + 1}`, ...g, exercises: g.exercises.slice(0, MAX_EX_PER_GROUP) }));
}

// Rezumatul pentru listă (fără enunțuri)
const summarize = (groups) => (groups || []).map((g) => ({
  key: g.key, title: g.title, kind: g.kind, count: (g.exercises || []).length,
  figures: (g.exercises || []).filter((e) => e.figure).length,
}));
const countExercises = (groups) => (groups || []).reduce((n, g) => n + (g.exercises || []).length, 0);

// Ordinea fișelor în listă: cea din site (sort_order); la egalitate, ALGEBRĂ
// înaintea GEOMETRIEI, apoi după numărul fișei („Fișă 2" înaintea lui „Fișă 10"),
// apoi alfabetic.
function sheetSortKey(title) {
  const t = String(title || '');
  const area = /^\s*algebr/i.test(t) ? 0 : /^\s*geometr/i.test(t) ? 1 : 0;
  const m = /fi[sș][aă]\s*(?:nr\.?\s*)?(\d+)/i.exec(t);
  return [area, m ? Number(m[1]) : 999, t.toLowerCase()];
}
function sortSheets(rows) {
  return [...(rows || [])].sort((a, b) => {
    const so = (Number(a.sort_order) || 0) - (Number(b.sort_order) || 0);
    if (so) return so;
    const A = sheetSortKey(a.title), B = sheetSortKey(b.title);
    return (A[0] - B[0]) || (A[1] - B[1]) || A[2].localeCompare(B[2], 'ro');
  });
}

// Bucățile de pagini: [[0,1],[2,3],…] (indici de la 0), cel mult MAX_PAGES pagini
function pageChunks(nPages, per = PAGES_PER_CHUNK) {
  const n = Math.max(0, Math.min(MAX_PAGES, nPages | 0));
  const out = [];
  for (let p = 0; p < n; p += per) out.push(Array.from({ length: Math.min(per, n - p) }, (_, i) => p + i));
  return out;
}

const CLASS_LABEL = (c) => {
  const n = Number(String(c || '').replace('clasa-', ''));
  const roman = { 5: 'a V-a', 6: 'a VI-a', 7: 'a VII-a', 8: 'a VIII-a', 9: 'a IX-a', 10: 'a X-a', 11: 'a XI-a', 12: 'a XII-a' }[n];
  return roman ? `clasa ${roman}` : '';
};

// Citește fișa (octeții PDF-ului) cu modelul cu vedere → { groups, exercises,
// pages, status, usage, failed }. Dependențele vin din apelant (testabil):
//   chatJson, S (ai.S), extractPagesPdf, filePart, pageCount(buf) → număr.
async function transcribeSheet(buf, { title = '', category = '', model, chatJson, S, extractPagesPdf, filePart = sheetPart, pageCount, log = () => {} } = {}) {
  const nPages = await pageCount(buf);
  const chunks = pageChunks(nPages);
  if (!chunks.length) throw Object.assign(new Error('Fișa nu are pagini.'), { status: 422 });
  const schema = schemaFor(S);
  const usage = { in: 0, out: 0, model };
  const results = new Array(chunks.length).fill(null);
  let failed = 0;
  let next = 0;
  const span = (idx) => (idx.length > 1 ? `paginile ${idx[0] + 1}–${idx[idx.length - 1] + 1}` : `pagina ${idx[0] + 1}`);
  async function readChunk(i) { return readPages(chunks[i]); }
  async function readPages(idx) {
    const sub = await extractPagesPdf(buf, idx);
    const part = filePart(sub, `fisa-${idx.length > 1 ? `pagini-${idx[0] + 1}-${idx[idx.length - 1] + 1}` : `pagina-${idx[0] + 1}`}.pdf`);
    if (!part) {
      // bucată prea mare (poze) → pagină cu pagină; grupele se lipesc la îmbinare
      if (idx.length > 1) {
        const groups = [];
        for (const p of idx) groups.push(...(((await readPages([p])) || {}).groups || []));
        return { groups };
      }
      throw new Error(`${span(idx)} e prea mare pentru citire`);
    }
    const text = `Fișa: „${title}"${category ? ` (${CLASS_LABEL(category)})` : ''}. ${span(idx).replace(/^p/, 'P')} din ${nPages}. Transcrie-le acum, după regulile de mai sus.`;
    const r = await chatJson({
      system: SYSTEM,
      messages: [{ role: 'user', content: [{ type: 'text', text }, part] }],
      schema, schemaName: 'fisa_exercitii', maxTokens: 6000, model,
      // e o transcriere, nu o rezolvare — gândirea scurtă ajunge (și costă puțin)
      reasoningEffort: 'low',
    });
    usage.in += r.usage?.in || 0; usage.out += r.usage?.out || 0;
    return r.data;
  }
  async function worker() {
    while (next < chunks.length) {
      const i = next++;
      let lastErr = null;
      for (let attempt = 0; attempt < 2; attempt++) {
        try { results[i] = await readChunk(i); lastErr = null; break; } catch (e) {
          lastErr = e;
          if (e && e.usage) { usage.in += e.usage.in || 0; usage.out += e.usage.out || 0; }
        }
      }
      if (lastErr) { failed++; log(`fise: ${span(chunks[i])} n-au putut fi citite: ${lastErr.message}`); }
    }
  }
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, chunks.length) }, worker));
  if (failed === chunks.length) throw Object.assign(new Error('Fișa nu a putut fi citită. Mai încearcă peste puțin timp.'), { status: 502, usage });
  const groups = mergeChunks(results.filter(Boolean));
  return { groups, exercises: countExercises(groups), pages: nPages, status: failed ? 'partial' : 'ok', usage, failed };
}

module.exports = {
  CLASS_CATS, KINDS, PAGES_PER_CHUNK, MAX_PAGES, SYSTEM, MAX_SHEET_PART_BYTES,
  schemaFor, mergeChunks, summarize, countExercises, sortSheets, sheetSortKey, pageChunks, transcribeSheet, sheetPart, CLASS_LABEL,
};
