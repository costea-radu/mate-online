// =====================================================================
// test/pregen-cache.test.js — pasul 3: prompt caching + pre-generare
// (vezi GHID_LIMITE_AI.md). Rulare: npm test  (node --test test/*.test.js)
// =====================================================================
const test = require('node:test');
const assert = require('node:assert');
const ai = require('../api/_lib/ai.js');
const pregen = require('../api/_lib/pregen.js');

// ─── Prompt caching: prefixul static trebuie să fie IDENTIC între cereri ─────
test('systemFor: același mod → același prefix static, indiferent de contextul RAG', () => {
  const a = ai.systemFor('tutor', 'CONTEXT UNU: fracții și procente');
  const b = ai.systemFor('tutor', 'CONTEXT DOI: geometrie, cu totul alt text', '\nEXTRA VARIABIL');
  const marker = '=== MATERIALE DIN BAZA DE DATE (context RAG) ===';
  const ia = a.indexOf(marker), ib = b.indexOf(marker);
  assert.ok(ia > 0 && ib > 0, 'markerul de context există în ambele');
  assert.strictEqual(a.slice(0, ia), b.slice(0, ib), 'prefixul dinaintea contextului e identic (cacheabil)');
});

test('systemFor: contextul RAG stă DUPĂ partea statică (nu sparge prefixul)', () => {
  const s = ai.systemFor('explain', 'CTX_MARCAJ_UNIC_12345');
  const role = 'Rol: explică TEORIA';
  assert.ok(s.indexOf(role) < s.indexOf('CTX_MARCAJ_UNIC_12345'),
    'rolul (static) apare înaintea contextului (variabil)');
  assert.ok(s.indexOf('CONTEXT_INEXISTENT') === -1);
});

test('systemFor: prefixul static al elevului e destul de mare pentru caching (≥1024 tokeni)', () => {
  const s = ai.systemFor('tutor', 'X');
  const prefix = s.slice(0, s.indexOf('=== MATERIALE'));
  // estimare conservatoare: ~3,5 caractere/token pentru română → pragul OpenAI
  // de 1024 tokeni ≈ 3.600 caractere
  assert.ok(prefix.length >= 3500, `prefixul are ${prefix.length} caractere (~${Math.round(prefix.length / 3.5)} tokeni)`);
});

test('systemFor: modurile diferite au prefixe diferite (cache separat, corect)', () => {
  const marker = '=== MATERIALE DIN BAZA DE DATE (context RAG) ===';
  const t = ai.systemFor('tutor', 'X'), h = ai.systemFor('hint', 'X');
  const pt = t.slice(0, t.indexOf(marker)), ph = h.slice(0, h.indexOf(marker));
  assert.notStrictEqual(pt, ph, 'rolul diferă → prefixul static diferă între moduri');
  assert.ok(t.includes('Rol: profesor') && h.includes('Rol: dai UN SINGUR indiciu'));
});

// ─── Pre-generare: matcherul cererilor canonice ──────────────────────────────
test('isCanonicalAsk: cereri generice de explicație → da', () => {
  for (const m of ['Explică-mi exercițiul', 'explica', 'Nu înțeleg exercițiul ăsta', 'Cum se rezolvă?', 'teoria', 'nu stiu cum sa incep, ajuta-ma']) {
    assert.ok(pregen.isCanonicalAsk(m, 'explain'), `"${m}" trebuia acceptat (explain)`);
  }
});

test('isCanonicalAsk: cereri generice de indiciu → da', () => {
  for (const m of ['Dă-mi un indiciu', 'un hint te rog', 'De unde încep?', 'primul pas?']) {
    assert.ok(pregen.isCanonicalAsk(m, 'hint'), `"${m}" trebuia acceptat (hint)`);
  }
});

test('isCanonicalAsk: întrebări SPECIFICE → nu (merg pe fluxul normal)', () => {
  const specifice = [
    'De ce la punctul b) rezultatul e 3/4 și nu 3/8, dacă am simplificat cu 2 înainte să adun fracțiile din paranteziile respective?', // lungă
    'cat face 2+2', // nu e cerere de explicație
    'care e nota mea', // altceva
  ];
  for (const m of specifice) {
    assert.ok(!pregen.isCanonicalAsk(m, 'explain'), `"${m.slice(0, 40)}..." trebuia respins`);
  }
  // modul greșit: cerere de indiciu în mod explain nu se servește din explain
  assert.ok(!pregen.isCanonicalAsk('dă-mi un indiciu', 'tutor'), 'modul tutor nu servește pre-generare');
});

test('canServe: doar prima întrebare, doar cu contentId, fără agentul PDF', () => {
  const base = { mode: 'explain', context: { contentId: 'abc' }, conversationId: null, message: 'explica-mi' };
  assert.ok(pregen.canServe(base));
  assert.ok(!pregen.canServe({ ...base, conversationId: 'conv1' }), 'conversație existentă → nu');
  assert.ok(!pregen.canServe({ ...base, context: {} }), 'fără contentId → nu');
  assert.ok(!pregen.canServe({ ...base, context: { contentId: 'abc', pdf: true } }), 'agentul PDF → nu');
  assert.ok(!pregen.canServe({ ...base, mode: 'tutor' }), 'modul tutor → nu');
});
