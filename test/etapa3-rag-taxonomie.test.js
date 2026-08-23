// =====================================================================
// test/etapa3-rag-taxonomie.test.js — Etapa 3 (AUDIT_AGENTI_AI.md):
//   · 1.5 — fragmentele din baza de cunoștințe: exerciții reale din PDF-uri,
//     itemii exercițiilor interactive, paragrafe din manuale, capitolul din
//     programă pe fiecare fragment;
//   · 1.5 — căutarea hibridă (match_ai_knowledge_hybrid) + revenirea pe
//     căutarea veche fără migrare;
//   · 5.1 — taxonomia fixă: clasificarea unui enunț + aducerea subiectelor
//     libere ale modelului la eticheta din programă.
// Rulare: npm test   (node --test test/*.test.js)
// =====================================================================
const test = require('node:test');
const assert = require('node:assert');
const taxonomy = require('../api/_lib/taxonomy.js');
const ingest = require('../api/_lib/ingest.js');
const ai = require('../api/_lib/ai.js');

// ─── 5.1 Taxonomia ───────────────────────────────────────────────────────────
test('taxonomy: capitolele din programă (cls. 5–12) + recapitulările EN', () => {
  assert.ok(taxonomy.CHAPTERS.length >= 44, `doar ${taxonomy.CHAPTERS.length} capitole`);
  assert.ok(taxonomy.CHAPTERS.every((c) => c.id && c.title && Array.isArray(c.topics)));
  assert.ok(taxonomy.CHAPTERS.some((c) => c.id === 'c7-metrice'));
  assert.ok(taxonomy.CHAPTERS.some((c) => c.id.startsWith('en-rec-')));
  assert.strictEqual(taxonomy.chapterTitle('c7-metrice'), 'Relații metrice în triunghiul dreptunghic');
  assert.strictEqual(taxonomy.chapterTitle('nu-exista'), null);
});

test('taxonomy.classify: enunțul → capitolul + subiectul din programă', () => {
  const cases = [
    ['Fie triunghiul ABC dreptunghic în A, cu AB = 6 cm și AC = 8 cm. Calculați ipotenuza BC cu teorema lui Pitagora.', 'evaluare-nationala', 'c7-metrice'],
    ['Calculați 25% din 840 lei; prețul a crescut cu 10 procente.', 'evaluare-nationala', 'c6-rapoarte'],
    ['Rezolvați în mulțimea numerelor reale ecuația 2x + 5 = 11.', 'clasa-7', 'c7-ecuatii'],
    ['Calculați determinantul matricei A și inversa ei.', 'bacalaureat', 'c11-matrice'],
    ['Determinați primitiva funcției f(x) = x^2 + 1.', 'bacalaureat', 'c12-primitive'],
    ['Un paralelipiped dreptunghic are dimensiunile 3, 4 și 5. Aflați volumul și aria totală.', 'evaluare-nationala', 'c8-corpuri'],
  ];
  for (const [text, cat, chapter] of cases) {
    const r = taxonomy.classify(text, cat);
    assert.ok(r, `neclasificat: ${text.slice(0, 40)}`);
    assert.strictEqual(r.chapterId, chapter, `${text.slice(0, 40)} → ${r.chapterId}`);
    assert.ok(r.topic && r.topic.length > 2);
  }
});

test('taxonomy.classify: text fără matematică → null (nu inventează capitol)', () => {
  assert.strictEqual(taxonomy.classify('bună ziua, ce mai faceți?', 'clasa-5'), null);
  assert.strictEqual(taxonomy.classify('', 'clasa-5'), null);
  assert.strictEqual(taxonomy.classify(null), null);
});

test('taxonomy.classify: categoria restrânge clasele (BAC nu primește capitole de gimnaziu)', () => {
  const bac = taxonomy.classify('Calculați suma primilor 10 termeni ai unei progresii aritmetice cu rația 3.', 'bacalaureat');
  assert.strictEqual(bac.chapterId, 'c9-siruri');
  const en = taxonomy.classify('Calculați suma primilor 10 termeni ai unei progresii aritmetice cu rația 3.', 'evaluare-nationala');
  assert.ok(!en || !en.chapterId.startsWith('c9'), 'un capitol de liceu nu are ce căuta la EN');
});

test('canonicalTopic: subiectele libere ale modelului → o singură etichetă per competență', () => {
  const en = { category: 'evaluare-nationala' };
  assert.strictEqual(taxonomy.canonicalTopic('teorema lui pitagora', en), 'teorema lui Pitagora');
  assert.strictEqual(taxonomy.canonicalTopic('Teorema lui Pitagora', en), 'teorema lui Pitagora');
  assert.strictEqual(taxonomy.canonicalTopic('fractii ordinare', en), 'Fracții ordinare');
  assert.strictEqual(taxonomy.canonicalTopic('Fracții ordinare', en), 'Fracții ordinare');
  // aceeași competență, trei scrieri → aceeași cheie
  const forms = ['ecuatii_gradul_1', 'Ecuații de gradul I', 'ecuatii gradul 1'];
  const mapped = forms.map((f) => taxonomy.canonicalTopic(f, { chapterId: 'c7-ecuatii' }));
  assert.strictEqual(new Set(mapped).size, 1, JSON.stringify(mapped));
  assert.strictEqual(mapped[0], 'ecuația de gradul I cu o necunoscută');
});

test('canonicalTopic: gol → titlul capitolului; necunoscut → textul curățat', () => {
  assert.strictEqual(taxonomy.canonicalTopic('', { chapterId: 'c7-ecuatii' }), 'Ecuații și sisteme de ecuații liniare');
  assert.strictEqual(taxonomy.canonicalTopic(null), 'general');
  assert.strictEqual(taxonomy.canonicalTopic('qwertyuiop', { category: 'clasa-5' }), 'qwertyuiop');
});

test('topicsFor: lista pentru enum — subiectele capitolului + titlul lui', () => {
  const t = taxonomy.topicsFor({ chapterId: 'c7-ecuatii' });
  assert.ok(t.includes('ecuația de gradul I cu o necunoscută'));
  assert.ok(t.includes('Ecuații și sisteme de ecuații liniare'));
  const cat = taxonomy.topicsFor({ category: 'evaluare-nationala' });
  assert.ok(cat.length > 40 && cat.length < 200);
  assert.ok(taxonomy.topicsFor({}).length > cat.length);
});

// ─── 1.5 Fragmentele (chunks) ────────────────────────────────────────────────
const PDF_TEXT = `EVALUARE NAȚIONALĂ 2024
SUBIECTUL I
1. Rezultatul calculului 2+3·4 este:
a) 14  b) 20  c) 24  d) 11
2. Numărul 25% din 840 este:
a) 21 b) 210 c) 84 d) 2100
SUBIECTUL al II-lea
1. În triunghiul ABC dreptunghic în A, AB = 6 cm și AC = 8 cm. Ipotenuza BC este:
2. Aria pătratului cu latura 4 cm este:
SUBIECTUL al III-lea
1. Fie f(x) = 2x + 1. a) Calculați f(2). b) Reprezentați grafic funcția.`;

test('chunksForContent (PDF): un fragment per EXERCIȚIU, cu subiectul și numărul în titlu', () => {
  const row = { id: 'p1', title: 'Varianta 3', description: 'model EN', category: 'evaluare-nationala', content_type: 'pdf', is_free: true };
  const ch = ingest.chunksForContent(row, { pdfText: PDF_TEXT });
  assert.strictEqual(ch.length, 5);
  assert.ok(ch.every((c) => c.source_type === 'exercise' && c.source_id === 'p1' && c.is_free === true));
  assert.deepStrictEqual(ch.map((c) => c.chunk_index), [0, 1, 2, 3, 4]);
  assert.match(ch[0].content, /Subiectul I · 1/);
  assert.match(ch[0].content, /2\+3·4/);
  assert.match(ch[2].content, /Subiectul II · 1/);
  assert.match(ch[4].content, /Subiectul III · 1/);
  // capitolul din programă, acolo unde enunțul îl trădează
  assert.strictEqual(ch[2].chapter_id, 'c7-metrice');
  assert.strictEqual(ch[3].chapter_id, 'c7-patrulatere');
});

test('chunksForContent (PDF barem): fragmentele devin „solution"', () => {
  const row = { id: 'b1', title: 'Barem varianta 3', category: 'evaluare-nationala', content_type: 'pdf', is_free: true, subcategory: 'bareme' };
  const ch = ingest.chunksForContent(row, { pdfText: PDF_TEXT, isBarem: true });
  assert.ok(ch.length >= 2);
  assert.ok(ch.every((c) => c.source_type === 'solution'));
});

test('chunksForContent (PDF scanat, fără text): rămâne fragmentul de metadate (ca înainte)', () => {
  const row = { id: 'p2', title: 'Scanat', description: 'test', category: 'clasa-6', content_type: 'pdf', is_free: false };
  const ch = ingest.chunksForContent(row, { pdfText: '' });
  assert.strictEqual(ch.length, 1);
  assert.match(ch[0].content, /Tip: pdf/);
  assert.strictEqual(ch[0].is_free, false);
});

test('chunksForContent (interactiv): un fragment per item, cu variante, răspuns și rezolvare', () => {
  const row = {
    id: 'i1', title: 'Test fracții', category: 'clasa-5', content_type: 'interactive', is_free: true,
    interactive_data: { exercise: { kind: 'grila', statement: '', questions: [
      { statement: 'Calculați $1/2 + 1/3$', options: ['5/6', '2/5', '1/6', '1'], answer: 0, explanation: 'aducem la același numitor' },
      { statement: 'Scrieți 0,75 ca fracție ireductibilă', answer: '3/4', explanation: '' },
    ] } },
  };
  const ch = ingest.chunksForContent(row);
  assert.strictEqual(ch.length, 2);
  assert.match(ch[0].content, /itemul 1/);
  assert.match(ch[0].content, /Variante: a\) 5\/6/);
  assert.match(ch[0].content, /Răspuns corect: a/);
  assert.match(ch[0].content, /Rezolvare: aducem/);
  assert.match(ch[1].content, /Răspuns: 3\/4/);
  assert.strictEqual(ch[0].chapter_id, 'c5-fractii-ordinare');
});

test('chunksForContent (interactiv fără JSON): enunțurile se scot din HTML', () => {
  const html = `<html><body><h1>Test</h1><script>var D=[1]</script>
    <div class="q">1. Calculați aria dreptunghiului cu lungimea 8 cm și lățimea 5 cm.</div>
    <div class="q">2. Perimetrul pătratului cu latura 3 cm este:</div>
    <div class="q">3. Un romb are diagonalele 6 și 8. Aria lui este:</div></body></html>`;
  const row = { id: 'i2', title: 'Patrulatere', category: 'clasa-7', content_type: 'interactive', is_free: true };
  const ch = ingest.chunksForContent(row, { html });
  assert.ok(ch.length >= 2, JSON.stringify(ch.map((c) => c.content)));
  assert.ok(ch.every((c) => !/var D=/.test(c.content)), 'scriptul nu intră în fragmente');
  assert.match(ch[0].content, /aria dreptunghiului/);
});

test('chunksForContent (manual): paragrafe cu suprapunere, nu felii de 1100 de caractere', () => {
  const body = '<h2>Radicali</h2><p>' + 'Rădăcina pătrată a unui număr pozitiv. '.repeat(60) + '</p><p>' + 'Teorema lui Pitagora în triunghiul dreptunghic. '.repeat(40) + '</p>';
  const row = { id: 'm1', title: 'Manual clasa a VII-a', category: 'manuale', content_type: 'manual', is_free: true, manual_content: body };
  const ch = ingest.chunksForContent(row);
  assert.ok(ch.length >= 2);
  assert.ok(ch.every((c) => c.source_type === 'manual'));
  assert.ok(ch.every((c) => c.content.length <= ingest.CHUNK_MAX + 200));
  assert.ok(ch.every((c) => !/<[a-z]/i.test(c.content)), 'HTML-ul e curățat');
});

test('splitExercises: fără structură de exerciții → null (se taie pe paragrafe)', () => {
  assert.strictEqual(ingest.splitExercises('Un text oarecare, fără numerotare.\nAl doilea rând.'), null);
  assert.ok(ingest.splitParagraphs('x'.repeat(3000)).length >= 2);
});

// ─── 1.5 Căutarea hibridă ────────────────────────────────────────────────────
function rpcStub(handlers) {
  const calls = [];
  return {
    calls,
    supa: {
      rpc: async (name, args) => {
        calls.push({ name, args });
        const h = handlers[name];
        // mesajul real al PostgREST când funcția lipsește (migrarea nerulată)
        if (!h) return { data: null, error: { message: `Could not find the function public.${name} in the schema cache` } };
        return h(args);
      },
    },
  };
}

test('retrieve: folosește căutarea hibridă (vector + lexical) și trimite pragul + capitolul', async () => {
  const { supa, calls } = rpcStub({
    match_ai_knowledge_hybrid: () => ({ data: [
      { id: '1', source_type: 'exercise', title: 'Ex A', content: 'a', score: 0.03, similarity: 0.7 },
      { id: '2', source_type: 'solution', title: 'Barem B', content: 'b', score: 0.028, similarity: 0.8 },
    ], error: null }),
  });
  const docs = await ai.retrieve(supa, { query: 'teorema lui Pitagora', category: 'clasa-7', allowPremium: true, k: 5, prefer: 'solution', chapterId: 'c7-metrice' });
  assert.strictEqual(calls.length, 1);
  assert.strictEqual(calls[0].name, 'match_ai_knowledge_hybrid');
  assert.strictEqual(calls[0].args.filter_chapter, 'c7-metrice');
  assert.strictEqual(calls[0].args.filter_category, 'clasa-7');
  assert.strictEqual(calls[0].args.allow_premium, true);
  assert.ok(calls[0].args.min_similarity > 0);
  assert.strictEqual(calls[0].args.query_text, 'teorema lui Pitagora');
  // prefer='solution' → baremul urcă peste exercițiu, deși are scorul RRF mai mic
  assert.deepStrictEqual(docs.map((d) => d.id), ['2', '1']);
});

test('retrieve: query gol → fără apeluri; hibrid cu 0 rezultate → [] (fără a doua căutare)', async () => {
  const { supa, calls } = rpcStub({ match_ai_knowledge_hybrid: () => ({ data: [], error: null }) });
  assert.deepStrictEqual(await ai.retrieve(supa, { query: '  ' }), []);
  assert.strictEqual(calls.length, 0);
  assert.deepStrictEqual(await ai.retrieve(supa, { query: 'ceva' }), []);
  assert.strictEqual(calls.length, 1, 'nu reluăm căutarea veche dacă hibridul chiar n-a găsit nimic');
});

test('retrieve: o eroare TRECĂTOARE a hibridului nu dezactivează căutarea hibridă', async () => {
  let first = true;
  const { supa, calls } = rpcStub({
    match_ai_knowledge_hybrid: () => (first ? ((first = false), { data: null, error: { message: 'canceling statement due to statement timeout' } })
      : { data: [{ id: 'h', source_type: 'exercise', title: 'ok', content: 'x', score: 0.02 }], error: null }),
    match_ai_knowledge_lexical: () => ({ data: [], error: null }),
  });
  assert.deepStrictEqual(await ai.retrieve(supa, { query: 'fracții' }), []);
  const docs = await ai.retrieve(supa, { query: 'fracții' });
  assert.deepStrictEqual(docs.map((d) => d.id), ['h']);
  assert.strictEqual(calls.filter((c) => c.name === 'match_ai_knowledge_hybrid').length, 2);
});

test('retrieve: fără migrarea RAG v2 → revine pe căutarea veche (vector, apoi lexical)', async () => {
  // hibridul lipsește; embeddings nu sunt configurate în teste → rămâne lexicalul
  const { supa, calls } = rpcStub({
    match_ai_knowledge_lexical: () => ({ data: [{ id: '9', source_type: 'exercise', title: 'vechi', content: 'x', similarity: 0.4 }], error: null }),
  });
  const docs = await ai.retrieve(supa, { query: 'fracții', k: 3 });
  assert.deepStrictEqual(docs.map((d) => d.id), ['9']);
  assert.ok(calls.some((c) => c.name === 'match_ai_knowledge_hybrid'));
  assert.ok(calls.some((c) => c.name === 'match_ai_knowledge_lexical'));
  // a doua oară nu mai încearcă hibridul (memorat pe instanță)
  const before = calls.length;
  await ai.retrieve(supa, { query: 'procente', k: 3 });
  assert.ok(!calls.slice(before).some((c) => c.name === 'match_ai_knowledge_hybrid'));
});


// ─── Regresie: octeții pe care Postgres nu-i poate stoca ─────────────────────
// „Reindexează tot" pica cu „Upsert ai_knowledge: unsupported Unicode escape
// sequence": textul REAL extras din PDF-uri (nou în Etapa 3) conține NUL,
// salturi de pagină și surogați nepereche. PostgREST le trimite ca JSON, iar
// Postgres refuză \u0000 la conversia în `text` — și pică LOTUL ÎNTREG, nu
// doar rândul vinovat, deci coada se relua la infinit (re-embedding pe bani).
const NUL = String.fromCharCode(0);
const FF = String.fromCharCode(12);
const BEL = String.fromCharCode(7);
const LONE_HI = String.fromCharCode(0xd800);
const LONE_LO = String.fromCharCode(0xdc00);

const hasCtrl = (v) => typeof v === 'string' && [...v].some((ch) => {
  const c = ch.charCodeAt(0);
  return c < 32 && c !== 10 && c !== 9 && c !== 13;
});
const hasLoneSurrogate = (v) => {
  if (typeof v !== 'string') return false;
  for (let i = 0; i < v.length; i++) {
    const c = v.charCodeAt(i);
    if (c >= 0xd800 && c <= 0xdbff) { const n = v.charCodeAt(i + 1); if (!(n >= 0xdc00 && n <= 0xdfff)) return true; i++; }
    else if (c >= 0xdc00 && c <= 0xdfff) return true;
  }
  return false;
};

test('ingest: textul de PDF cu NUL / controale / surogați nepereche iese CURAT', () => {
  const pdfText = [
    'SUBIECTUL I',
    '1. Rezultatul calculului ' + NUL + '2 + 3' + BEL + ' este:',
    FF,
    '2. Media numerelor ' + LONE_HI + '4 și 6' + LONE_LO + ' este:',
    '3. Un triunghi are laturile de 3, 4 și 5 cm. Aria lui este:',
  ].join('\n');
  const chunks = ingest.chunksForContent(
    { id: 'c1', title: 'EN 2025 ' + NUL + 'Varianta 3', description: 'test',
      category: 'evaluare-nationala', content_type: 'pdf', is_free: true },
    { pdfText },
  );
  assert.ok(chunks.length >= 2, `doar ${chunks.length} fragmente`);
  for (const c of chunks) {
    for (const [k, v] of Object.entries(c)) {
      assert.ok(!hasCtrl(v), `caracter de control rămas în ${k}`);
      assert.ok(!hasLoneSurrogate(v), `surogat nepereche rămas în ${k}`);
    }
  }
  // conținutul rămâne lizibil, nu doar curat
  assert.match(chunks[0].content, /Rezultatul calculului 2 \+ 3/);
  assert.ok(!chunks[0].title.includes(NUL));
});

test('ingest: fragmentele curățate supraviețuiesc drumului prin JSON (ca la PostgREST)', () => {
  const chunks = ingest.chunksForContent(
    { id: 'c2', title: 'Test' + NUL, description: '', category: 'bacalaureat',
      content_type: 'pdf', is_free: false },
    { pdfText: '1. Calculați ' + NUL + 'derivata.\n2. Aflați limita.\n3. Rezolvați ecuația.' },
  );
  const json = JSON.stringify(chunks);
  // \u0000 în JSON = exact ce respinge Postgres („unsupported Unicode escape sequence")
  assert.ok(!/\\u000[0-8]|\\u000[bcefBCEF]|\\u001[0-9a-fA-F]/.test(json),
    'JSON-ul încă are secvențe de control pe care Postgres le refuză');
  assert.deepEqual(JSON.parse(json).length, chunks.length);
});

test('ingest: safeText păstrează diacriticele, tabul și liniile noi', () => {
  const t = 'Fracții\tordinare\nși zecimale ' + NUL + 'â îț';
  const out = ingest.safeText(t);
  assert.ok(out.includes('Fracții'), 'diacriticele s-au pierdut');
  assert.ok(out.includes('\t'), 'tabul s-a pierdut');
  assert.ok(out.includes('\n'), 'linia nouă s-a pierdut');
  assert.ok(!out.includes(NUL), 'NUL a rămas');
});

test('ingest: fragmentele goale după curățare sunt aruncate, nu scrise', () => {
  const chunks = ingest.chunksForContent(
    { id: 'c3', title: '', description: '', category: 'evaluare-nationala',
      content_type: 'pdf', is_free: true },
    { pdfText: NUL + BEL + FF },
  );
  for (const c of chunks) assert.ok(c.content.length >= 10, 'fragment gol scris în baza de cunoștințe');
});
