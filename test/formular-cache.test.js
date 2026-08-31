// =====================================================================
// test/formular-cache.test.js — CACHE-ul formularelor de răspuns
// („Răspunde în chat" pe un test PDF; supabase/ai_correct_forms.sql)
//
// Ce garantăm aici: același material → o singură generare, formular
// refolosit de toți utilizatorii; material schimbat → regenerare; iar
// formularul servit din cache rămâne semnat valid pentru „Corectează".
// Rulare: npm test  (node --test test/*.test.js)
// =====================================================================
const test = require('node:test');
const assert = require('node:assert');
const correct = require('../api/ai-correct.js');

// ─── Supabase de test: o „tabelă" în memorie ────────────────────────────────
function fakeSupa(rows = {}, opts = {}) {
  const store = { ...rows };
  const calls = { select: 0, upsert: 0 };
  return {
    store, calls,
    from() {
      return {
        select() {
          return {
            eq(_col, key) {
              return {
                async maybeSingle() {
                  calls.select++;
                  if (opts.readError) return { data: null, error: { message: opts.readError } };
                  return { data: store[key] || null, error: null };
                },
              };
            },
          };
        },
        async upsert(row) {
          calls.upsert++;
          if (opts.writeError) return { error: { message: opts.writeError } };
          store[row.cache_key] = row;
          return { error: null };
        },
      };
    },
  };
}

const SRC_PDF = { contentId: '11111111-2222-3333-4444-555555555555', test: 'Subiectul I. 1) Calculați 2+2.', barem: 'I.1 — 5p rezultat corect.', category: 'evaluare-nationala' };
const SRC_UPLOAD = { contentId: null, test: 'Exercițiul 1. Rezolvați ecuația x+3=7.', barem: '', category: 'clasa-7' };
const ITEMS = [{ id: 'I.1', eticheta: 'Subiectul I, ex. 1', cerinta: 'Calculați $2+2$', puncte: 5, subpuncte: null }];
const FORM = { items: ITEMS, hasBarem: true, total: 5, oficiu: 10, title: 'Test EN — numere' };

// ─── Cheia: un test din platformă e ACELAȘI pentru toți elevii ──────────────
test('formCacheKey: testul din platformă se cheie pe contentId (comun tuturor)', () => {
  const h = correct.formSourceHash(SRC_PDF);
  assert.strictEqual(correct.formCacheKey(SRC_PDF, h), `c:${SRC_PDF.contentId}`);
});

test('formCacheKey: materialul încărcat se cheie pe amprenta textului (nu pe utilizator)', () => {
  const h = correct.formSourceHash(SRC_UPLOAD);
  assert.strictEqual(correct.formCacheKey(SRC_UPLOAD, h), `u:${h}`);
  // alt elev, același material → aceeași cheie, deci aceeași intrare din cache
  const acelasiMaterial = { ...SRC_UPLOAD };
  assert.strictEqual(correct.formCacheKey(acelasiMaterial, correct.formSourceHash(acelasiMaterial)), `u:${h}`);
});

// ─── Amprenta sursei: se schimbă doar când se schimbă materialul ────────────
test('formSourceHash: același test + barem + categorie → aceeași amprentă', () => {
  assert.strictEqual(correct.formSourceHash(SRC_PDF), correct.formSourceHash({ ...SRC_PDF }));
});

test('formSourceHash: baremul apărut între timp / alt text / altă categorie → amprentă nouă', () => {
  const baza = correct.formSourceHash(SRC_PDF);
  assert.notStrictEqual(baza, correct.formSourceHash({ ...SRC_PDF, barem: '' }), 'baremul schimbat → regenerare');
  assert.notStrictEqual(baza, correct.formSourceHash({ ...SRC_PDF, test: 'alt test' }), 'fișierul schimbat → regenerare');
  assert.notStrictEqual(baza, correct.formSourceHash({ ...SRC_PDF, category: 'bacalaureat' }), 'categoria schimbată → alte punctaje oficiale');
});

// ─── Scriere → citire: al doilea elev primește formularul deja construit ────
test('write + read: al doilea elev ia formularul din cache, fără generare', async () => {
  const supa = fakeSupa();
  const h = correct.formSourceHash(SRC_PDF);
  const key = correct.formCacheKey(SRC_PDF, h);

  assert.strictEqual(await correct.readFormCache(supa, key, h), null, 'primul elev: cache gol');
  await correct.writeFormCache(supa, key, h, SRC_PDF, FORM);

  const hit = await correct.readFormCache(supa, key, h);
  assert.ok(hit, 'al doilea elev: intrare găsită');
  assert.deepStrictEqual(hit.items, ITEMS);
  assert.strictEqual(hit.hasBarem, true);
  assert.strictEqual(hit.total, 5);
  assert.strictEqual(hit.oficiu, 10);
  assert.strictEqual(hit.title, 'Test EN — numere');
  assert.strictEqual(supa.calls.upsert, 1, 'o singură scriere pentru ambii elevi');
});

test('read: materialul s-a schimbat (altă amprentă) → cache ratat, se regenerează', async () => {
  const supa = fakeSupa();
  const h = correct.formSourceHash(SRC_PDF);
  const key = correct.formCacheKey(SRC_PDF, h);
  await correct.writeFormCache(supa, key, h, SRC_PDF, FORM);

  const hAlt = correct.formSourceHash({ ...SRC_PDF, test: 'testul a fost înlocuit' });
  assert.strictEqual(await correct.readFormCache(supa, key, hAlt), null);
});

// ─── Tokenul: formularul din cache trebuie să treacă la „Corectează" ────────
test('formularul servit din cache se re-semnează și trece verificarea la corectare', () => {
  const token = correct.signForm({
    items: FORM.items, contentId: SRC_PDF.contentId, testText: SRC_PDF.test,
    hasBarem: FORM.hasBarem, total: FORM.total, oficiu: FORM.oficiu,
  });
  const ok = correct.verifyForm(token, { items: FORM.items, contentId: SRC_PDF.contentId, testText: SRC_PDF.test });
  assert.ok(ok, 'tokenul re-semnat e valid pentru aceleași cerințe');
  assert.strictEqual(ok.tot, 5);

  // punctele umflate din browser rămân respinse și pe formularul din cache
  const umflat = JSON.parse(JSON.stringify(FORM.items));
  umflat[0].puncte = 100;
  assert.strictEqual(correct.verifyForm(token, { items: umflat, contentId: SRC_PDF.contentId, testText: SRC_PDF.test }), null);
});

// ─── Fără tabelă / cu erori de DB: nimic nu se blochează ────────────────────
test('tabela lipsă sau eroare de DB → cache ratat, nu excepție (se generează ca înainte)', async () => {
  const supaR = fakeSupa({}, { readError: 'relation "public.ai_correct_forms" does not exist' });
  assert.strictEqual(await correct.readFormCache(supaR, 'c:x', 'h'), null);

  const supaW = fakeSupa({}, { writeError: 'permission denied' });
  await correct.writeFormCache(supaW, 'c:x', 'h', SRC_PDF, FORM); // nu aruncă
});
