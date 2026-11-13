// =====================================================================
// test/rezultate-neterminate.test.js — cererea din 13 nov. 2026 (harta pregătirii):
//   „Să se poată reveni la un exercițiu sau test neterminat, să apară în «rezultate»."
//
// · src/lib/ciornaTest.js: răspunsurile de data trecută (pe dispozitiv, 30 de zile);
// · src/lib/tutorBridge.js: MATE_ANSWERS_SET le pune la loc în test (fără să
//   suprascrie ce a scris elevul și fără să „apese" ceva);
// · src/pages/InteractiveViewer.jsx: ciorna se scrie din salvarea automată, se pune la
//   loc când testul e gata, se șterge la scorul salvat / „Resetează" / reîncărcare;
// · src/pages/Profile.jsx („Rezultatele mele"): neterminatele sus, cu „▶ Continuă";
//   orice test din platformă se redeschide din titlu.
// Rulare: npm test
// =====================================================================
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const read = (f) => fs.readFileSync(path.join(__dirname, '..', f), 'utf8');
let modP = null;
const C = () => (modP || (modP = import('../src/lib/ciornaTest.js')));

function storage() {
  const m = new Map();
  return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k), m };
}

test('ciorna: se scrie doar cu măcar un răspuns, se citește 30 de zile, apoi expiră; se șterge', async () => {
  const { cheieCiorna, scrieCiorna, citesteCiorna, stergeCiorna, areRaspunsuri, ZILE_CIORNA } = await C();
  const s = storage();
  const k = cheieCiorna('u1', 'c1');
  assert.strictEqual(k, 'em_ciorna_u1_c1');
  assert.strictEqual(cheieCiorna(null, 'c1'), null);
  assert.strictEqual(areRaspunsuri([null, '', '  ']), false);
  assert.strictEqual(scrieCiorna(k, [null, ''], { storage: s }), false, 'nimic completat → nimic scris');
  assert.strictEqual(scrieCiorna(k, [2, null, 'x+1'], { storage: s, acum: 1000 }), true);
  assert.deepStrictEqual(citesteCiorna(k, { storage: s, acum: 2000 }), [2, null, 'x+1']);
  assert.strictEqual(ZILE_CIORNA, 30);
  assert.strictEqual(citesteCiorna(k, { storage: s, acum: 1000 + 31 * 864e5 }), null, 'după 30 de zile');
  assert.strictEqual(s.m.size, 0, 'ciorna expirată se șterge');
  scrieCiorna(k, ['a'], { storage: s });
  stergeCiorna(k, { storage: s });
  assert.strictEqual(citesteCiorna(k, { storage: s }), null);
  s.setItem(k, '{nu e json');
  assert.strictEqual(citesteCiorna(k, { storage: s }), null);
});

test('„neterminat" = doar salvarea automată (attempts = 0) la un material din platformă', async () => {
  const { eNeterminat } = await C();
  assert.strictEqual(eNeterminat({ content_id: 'c', attempts: 0 }), true);
  assert.strictEqual(eNeterminat({ content_id: 'c', attempts: 1 }), false);
  assert.strictEqual(eNeterminat({ content_id: 'c', attempts: null }), false, 'rândurile vechi (fără încercări) nu sunt neterminate');
  assert.strictEqual(eNeterminat({ content_id: null, attempts: 0 }), false);
});

// funcțiile din bridge (scriptul injectat în test), rulate pe un DOM de buzunar
async function bridgeFunctii() {
  const { injectTutorBridge } = await import('../src/lib/tutorBridge.js');
  const src = injectTutorBridge('<html><body><p>x</p></body></html>').match(/<script>([\s\S]*)<\/script>/)[1];
  const ia = (nume) => {
    const i = src.indexOf(`function ${nume}(`);
    assert.ok(i >= 0, nume);
    let d = 0, j = src.indexOf('{', i);
    for (let k = j; k < src.length; k++) { if (src[k] === '{') d++; else if (src[k] === '}') { d--; if (d === 0) return src.slice(i, k + 1); } }
    return null;
  };
  return `${ia('fireEv')}\n${ia('setAnswers')}`;
}
function domDeBuzunar(campuri) {
  const ev = [];
  const el = campuri;   // [{ name, type: 'radio'|'text', value, checked }]
  const potrivite = (sel) => {
    const out = [];
    for (const part of sel.split(',').map((x) => x.trim())) {
      const nume = (part.match(/name="([^"]+)"/) || [])[1];
      const radio = /type="radio"/.test(part) && !/:not\(\[type="radio"\]\)/.test(part);
      const textarea = part.startsWith('textarea');
      const faraRadio = /:not\(\[type="radio"\]\)/.test(part);
      const checked = /:checked/.test(part);
      for (const e of el) {
        if (e.name !== nume) continue;
        if (radio && e.type !== 'radio') continue;
        if (!radio && (faraRadio || /type="text"/.test(part) || textarea) && e.type === 'radio') continue;
        if (textarea && e.type !== 'textarea') continue;
        if (checked && !e.checked) continue;
        if (!out.includes(e)) out.push(e);
      }
    }
    return out;
  };
  for (const e of el) e.dispatchEvent = (x) => ev.push(`${e.name}:${x.type}`);
  return { document: { querySelectorAll: (s) => potrivite(s), querySelector: (s) => potrivite(s)[0] || null }, Event: function Event(type) { this.type = type; }, ev };
}

test('bridge: MATE_ANSWERS_SET pune la loc grila (indexul variantei) și răspunsul liber; nu suprascrie ce a scris elevul', async () => {
  const cod = await bridgeFunctii();
  const campuri = [
    ...[0, 1, 2, 3].map((v) => ({ name: 'q0', type: 'radio', value: String(v), checked: false })),
    { name: 'q1', type: 'text', value: '' },
    ...[0, 1, 2].map((v) => ({ name: 'q2', type: 'radio', value: String(v), checked: v === 0 })),
    { name: 'q3', type: 'text', value: 'deja scris' },
  ];
  const dom = domDeBuzunar(campuri);
  const ctx = vm.createContext({ document: dom.document, Event: dom.Event, String });
  vm.runInContext(`${cod}; var n = setAnswers([2, 'x+1', 1, 'altceva', null]);`, ctx);
  assert.strictEqual(ctx.n, 2);
  assert.deepStrictEqual(campuri.filter((c) => c.name === 'q0' && c.checked).map((c) => c.value), ['2']);
  assert.strictEqual(campuri.find((c) => c.name === 'q1').value, 'x+1');
  assert.deepStrictEqual(campuri.filter((c) => c.name === 'q2' && c.checked).map((c) => c.value), ['0'], 'grila deja aleasă rămâne');
  assert.strictEqual(campuri.find((c) => c.name === 'q3').value, 'deja scris');
  assert.deepStrictEqual(dom.ev, ['q0:input', 'q0:change', 'q1:input', 'q1:change']);
  const b = read('src/lib/tutorBridge.js');
  assert.match(b, /if \(d\.type === 'MATE_ANSWERS_SET'\) \{\s+var pusi = setAnswers\(d\.answers\);\s+post\('MATE_ANSWERS_SET_ACK', \{ n: pusi \}\);/);
  const fn = cod.slice(cod.indexOf('function setAnswers'));
  assert.ok(!/userActed\s*=/.test(fn), 'nu „apasă" nimic — scorul nu pleacă singur');
});

test('vizualizatorul: ciorna din salvarea automată, pusă la loc când testul e gata; ștearsă la scorul salvat, la „Resetează" și la reîncărcarea de la zero', () => {
  const v = read('src/pages/InteractiveViewer.jsx');
  assert.match(v, /import \{ cheieCiorna, citesteCiorna, scrieCiorna, stergeCiorna, areRaspunsuri \} from '\.\.\/lib\/ciornaTest';/);
  const ready = v.slice(v.indexOf("if (d.type === 'MATE_TUTOR_READY' && fromTest) {"), v.indexOf("if (d.type === 'MATE_ANSWERS_SET_ACK'"));
  assert.match(ready, /const a = citesteCiorna\(c\.cheie\);/);
  assert.match(ready, /postMessage\(\{ type: 'MATE_ANSWERS_SET', answers: a \}, '\*'\)/);
  assert.match(ready, /if \(c\.cheie && !c\.pusa && !c\.salvat\)/);
  assert.match(v, /if \(areRaspunsuri\(d\.answers\)\) scrieCiorna\(c\.cheie, d\.answers\);\s+else stergeCiorna\(c\.cheie\);/);
  assert.match(v, /if \(!scoreSaved\) return;\s+const c = ciornaRef\.current;\s+c\.salvat = true;\s+if \(c\.cheie\) stergeCiorna\(c\.cheie\);/);
  assert.match(v, /if \(!iframeKey\) return;[\s\S]{0,120}stergeCiorna\(c\.cheie\);[\s\S]{0,80}pusa: true/);
  assert.match(v, /↩ continui de unde ai rămas \(\$\{ciornaPusa\}\)/);
});

test('„Rezultatele mele": neterminatele sus, cu „▶ Continuă" (înapoi tot aici); titlul redeschide testul; „—" la încercări', () => {
  const p = read('src/pages/Profile.jsx');
  assert.match(p, /import \{ eNeterminat \} from '\.\.\/lib\/ciornaTest';/);
  assert.match(p, /neterminat: eNeterminat\(p\),/);
  assert.match(p, /⏸ Neterminate \(\{neterminate\.length\}\) — continuă de unde ai rămas/);
  assert.match(p, /<Link to=\{urlRezultat\(r\)\} state=\{inapoi\} className="btn btn-sm btn-primary">▶ Continuă<\/Link>/);
  assert.match(p, /const inapoi = \{ returnTo: '\/profil\?rezultate=1' \};/);
  assert.match(p, /r\.type === 'pdf' \? `\/pdf-viewer\?id=\$\{encodeURIComponent\(r\.contentId\)\}` : `\/exercitiu\?id=\$\{encodeURIComponent\(r\.contentId\)\}`/);
  assert.match(p, /\{r\.neterminat \? '—' : r\.attempts\}/);
  // rezultatele elevului rămân primele în pagină (11 nov. 2026)
  assert.match(p, /<MyCatalog marks=\{marks\} \/>\s+\{neterminate\.length > 0 && \(/);
});
