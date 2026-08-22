// =====================================================================
// test/etapa1-chat-corectare.test.js — Etapa 1 (AUDIT_AGENTI_AI.md):
//   · „Regenerează": istoricul fără răspunsul înlocuit (dropLastTurn, loadHistory)
//   · formularul de corectare SEMNAT (signForm / verifyForm) — 2.1
//   · scorurile din browser validate (clampScore) — 2.1
//   · cache-ul PDF ai_pdf_text (getPdfContext) — 2.1 / 3.1
//   · costul Opus din meditații (toUsage păstrează modelul) — 2.4
// Rulare: npm test   (node --test test/*.test.js)
// =====================================================================
const test = require('node:test');
const assert = require('node:assert');
const ai = require('../api/_lib/ai.js');
const correct = require('../api/ai-correct.js');
const medApi = require('../api/ai-meditatii.js');
const med = require('../api/_lib/meditatii.js');
const pdfCtx = require('../api/ai-pdf-context.js');

// ─── Regenerează ─────────────────────────────────────────────────────────────
test('dropLastTurn: scoate răspunsul anterior + întrebarea identică (regenerated=true)', () => {
  const hist = [
    { role: 'user', content: 'Q1' }, { role: 'assistant', content: 'A1', id: 'm1' },
    { role: 'user', content: 'Explică-mi ex 3 ' }, { role: 'assistant', content: 'A2', id: 'm2' },
  ];
  const r = ai.dropLastTurn(hist, 'Explică-mi ex 3');
  assert.strictEqual(r.regenerated, true);
  assert.deepStrictEqual(r.msgs.map((m) => m.content), ['Q1', 'A1']);
  assert.deepStrictEqual(r.removedAssistant.map((m) => m.id), ['m2']);
});

test('dropLastTurn: altă întrebare decât ultima → răspunsul iese, întrebarea rămâne (regenerated=false)', () => {
  const hist = [{ role: 'user', content: 'Q1' }, { role: 'assistant', content: 'A1', id: 'm1' }];
  const r = ai.dropLastTurn(hist, 'Altceva');
  assert.strictEqual(r.regenerated, false);
  assert.deepStrictEqual(r.msgs.map((m) => m.content), ['Q1']);
  assert.strictEqual(r.removedAssistant.length, 1);
});

test('dropLastTurn: fără răspuns la coadă → nimic de scos', () => {
  const r = ai.dropLastTurn([{ role: 'user', content: 'Q1' }], 'Q1');
  assert.strictEqual(r.regenerated, false);
  assert.strictEqual(r.msgs.length, 1);
});

// Un supabase fals mai simplu: fiecare tabelă are o funcție care primește
// operațiile înlănțuite și întoarce { data, error }.
function supaStub(handlers) {
  function make(table) {
    const ops = [];
    const p = new Proxy(function () {}, {
      get(_, prop) {
        if (prop === 'then') {
          const out = handlers[table] ? handlers[table](ops) : { data: null, error: null };
          return (res, rej) => Promise.resolve(out).then(res, rej);
        }
        return (...args) => { ops.push([prop, args]); return p; };
      },
    });
    return p;
  }
  return { from: (table) => make(table) };
}

test('loadHistory: filtrul superseded; la eroare de filtru recade pe filtrare în memorie', async () => {
  let call = 0;
  const rows = [
    { id: '3', role: 'assistant', content: 'A2', metadata: { superseded: true } },
    { id: '2', role: 'assistant', content: 'A1', metadata: {} },
    { id: '1', role: 'user', content: 'Q', metadata: null },
  ];
  const supa = supaStub({
    ai_messages: (ops) => {
      call++;
      const usesOr = ops.some(([op]) => op === 'or');
      if (usesOr) return { data: null, error: { message: 'filtru nesuportat' } };
      return { data: rows, error: null };
    },
  });
  const hist = await ai.loadHistory(supa, 'conv', 10);
  assert.strictEqual(call, 2); // prima cu filtru (eșuează), a doua fără
  assert.deepStrictEqual(hist.map((m) => m.id), ['1', '2']); // cronologic, fără cel superseded
});

// ─── formularul semnat ───────────────────────────────────────────────────────
const items = [
  { id: 'I.1', eticheta: 'Subiectul I, ex. 1', cerinta: 'x', puncte: 5 },
  { id: 'III.1', eticheta: 'Subiectul III, pr. 1', cerinta: 'y', subpuncte: [{ id: 'a', eticheta: 'a)', puncte: 2 }, { id: 'b', eticheta: 'b)', puncte: 3 }] },
];

test('signForm/verifyForm: formularul semnat trece neschimbat', () => {
  const token = correct.signForm({ items, contentId: 'c1', hasBarem: true, total: 10, oficiu: 10 });
  const d = correct.verifyForm(token, { items: JSON.parse(JSON.stringify(items)), contentId: 'c1' });
  assert.ok(d && d.b === true && d.c === 'c1' && d.tot === 10);
});

test('verifyForm: punctele umflate sau un alt contentId sunt respinse', () => {
  const token = correct.signForm({ items, contentId: 'c1', hasBarem: true, total: 10, oficiu: 10 });
  const umflat = JSON.parse(JSON.stringify(items)); umflat[0].puncte = 50;
  assert.strictEqual(correct.verifyForm(token, { items: umflat, contentId: 'c1' }), null);
  assert.strictEqual(correct.verifyForm(token, { items, contentId: 'c2' }), null);
  assert.strictEqual(correct.verifyForm(null, { items, contentId: 'c1' }), null);
  assert.strictEqual(correct.verifyForm('x.y', { items, contentId: 'c1' }), null);
});

test('verifyForm: la poza/PDF-ul propriu, textul testului e legat de token (hash)', () => {
  const token = correct.signForm({ items, contentId: null, testText: 'Exercițiul 1: 2+2=?', hasBarem: false });
  assert.ok(correct.verifyForm(token, { items, contentId: null, testText: 'Exercițiul 1: 2+2=?' }));
  assert.strictEqual(correct.verifyForm(token, { items, contentId: null, testText: 'alt test' }), null);
  // un contentId „împrumutat" nu trece cu tokenul unui upload
  assert.strictEqual(correct.verifyForm(token, { items, contentId: 'c1', testText: 'Exercițiul 1: 2+2=?' }), null);
});

test('itemsFingerprint: depinde de id-uri și puncte, nu de etichete/cerințe', () => {
  const a = correct.itemsFingerprint(items);
  const relabel = JSON.parse(JSON.stringify(items)); relabel[0].eticheta = 'altfel'; relabel[1].subpuncte[0].cerinta = 'z';
  assert.strictEqual(correct.itemsFingerprint(relabel), a);
  const repoint = JSON.parse(JSON.stringify(items)); repoint[1].subpuncte[1].puncte = 30;
  assert.notStrictEqual(correct.itemsFingerprint(repoint), a);
});

// ─── scorurile din browser ───────────────────────────────────────────────────
test('clampScore: 0 ≤ scor ≤ maxim, maximul între 1 și 1000', () => {
  assert.deepStrictEqual(medApi.clampScore(7, 10), { sc: 7, mx: 10 });
  assert.deepStrictEqual(medApi.clampScore(500, 100), { sc: 100, mx: 100 });
  assert.deepStrictEqual(medApi.clampScore(-3, 100), { sc: 0, mx: 100 });
  assert.deepStrictEqual(medApi.clampScore(5000, 5000), { sc: 1000, mx: 1000 });
  assert.deepStrictEqual(medApi.clampScore('abc', 'x'), { sc: 0, mx: 100 });
});

// ─── costul Opus ─────────────────────────────────────────────────────────────
test('toUsage: păstrează modelul (Anthropic și formatul intern) — costul nu mai e 0', () => {
  const u = med.toUsage({ prompt_tokens: 1200, completion_tokens: 800, model: 'claude-opus-5' });
  assert.deepStrictEqual(u, { in: 1200, out: 800, model: 'claude-opus-5' });
  assert.ok(ai.costMicroLei(u.model, u) > 0);
  // fără model în usage → modelul dat ca fallback
  assert.strictEqual(med.toUsage({ prompt_tokens: 1, completion_tokens: 1 }, 'claude-opus-5').model, 'claude-opus-5');
  // formatul intern {in,out,model} (fallback-ul fără ANTHROPIC_API_KEY) rămâne neatins
  assert.deepStrictEqual(med.toUsage({ in: 3, out: 4, model: 'gpt-5.6-sol' }), { in: 3, out: 4, model: 'gpt-5.6-sol' });
});

// ─── cache-ul PDF ────────────────────────────────────────────────────────────
const content = { id: 'c1', title: 'Varianta 3', is_free: true, file_url: 'https://x/storage/v1/object/public/content/v3.pdf', category: 'bacalaureat' };

test('getPdfContext: intrare validă în cache → fără descărcare/parsare', async () => {
  const supa = supaStub({
    ai_pdf_text: () => ({ data: { content_id: 'c1', file_url: content.file_url, text: 'TEXT', chars: 4, truncated: false, barem: { id: 'b1', title: 'Barem' }, barem_text: 'BAREM', barem_status: 'ok', updated_at: new Date().toISOString() }, error: null }),
  });
  global.fetch = async () => { throw new Error('nu trebuia să descarce'); };
  const ctx = await pdfCtx.getPdfContext(supa, content);
  assert.strictEqual(ctx.cached, true);
  assert.strictEqual(ctx.text, 'TEXT');
  assert.strictEqual(ctx.baremText, 'BAREM');
  assert.strictEqual(ctx.baremStatus, 'ok');
});

test('getPdfContext: fișier schimbat (file_url diferit) → recalcul (cache ignorat)', async () => {
  const supa = supaStub({
    ai_pdf_text: () => ({ data: { content_id: 'c1', file_url: 'https://x/alt.pdf', text: 'VECHI', barem_status: 'ok', updated_at: new Date().toISOString() }, error: null }),
  });
  let downloaded = false;
  global.fetch = async () => { downloaded = true; return { ok: false, status: 404 }; };
  await assert.rejects(pdfCtx.getPdfContext(supa, content), /Nu am putut descărca/);
  assert.strictEqual(downloaded, true);
});

test('getPdfContext: „negăsit" mai vechi de fereastra de reîncercare → recalcul', async () => {
  const old = new Date(Date.now() - 48 * 3600 * 1000).toISOString();
  const supa = supaStub({
    ai_pdf_text: () => ({ data: { content_id: 'c1', file_url: content.file_url, text: 'T', barem_status: 'negasit', updated_at: old }, error: null }),
  });
  let downloaded = false;
  global.fetch = async () => { downloaded = true; return { ok: false, status: 404 }; };
  await assert.rejects(pdfCtx.getPdfContext(supa, content));
  assert.strictEqual(downloaded, true);
});

test('getPdfContext: tabela lipsă → se continuă fără cache (recalcul)', async () => {
  const supa = supaStub({ ai_pdf_text: () => ({ data: null, error: { message: 'relation "ai_pdf_text" does not exist' } }) });
  let downloaded = false;
  global.fetch = async () => { downloaded = true; return { ok: false, status: 404 }; };
  await assert.rejects(pdfCtx.getPdfContext(supa, content));
  assert.strictEqual(downloaded, true);
});
