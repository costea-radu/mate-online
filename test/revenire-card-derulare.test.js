// =====================================================================
// test/revenire-card-derulare.test.js — „Înapoi" din PDF / testul interactiv:
// pagina revine exact la cardul testului (ca înainte), dar derularea nu mai e
// „înghețată" câteva secunde: de cum elevul derulează, re-centrarea se oprește
// (src/lib/scrollToCard.js; re-exportat din src/components/ContentPage.jsx).
// =====================================================================
'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

let mod = null;
const load = async () => { if (!mod) mod = await import('../src/lib/scrollToCard.js').catch(() => null); return mod; };

// fereastra + documentul, în memorie: timpul îl dăm noi înainte. `smooth`: derularea
// spre card e lină (ca pe site: html { scroll-behavior: smooth }), cât durează `smooth` ms
function fakeEnv({ cardTop = 3000, smooth = 0 } = {}) {
  let now = 0, seq = 0, calls = 0, present = false;
  let y = 0, anim = null;
  const timers = [];
  const listeners = {};
  const curY = () => {
    if (!anim) return y;
    const k = Math.min(1, (now - anim.start) / anim.dur);
    if (k >= 1) { y = anim.to; anim = null; return y; }
    return anim.from + (anim.to - anim.from) * k;
  };
  const win = {
    innerHeight: 800,
    get scrollY() { return curY(); },
    set scrollY(v) { anim = null; y = v; },            // derularea elevului oprește animația (ca în browser)
    setTimeout: (fn, ms) => { const id = ++seq; timers.push({ id, at: now + ms, fn }); return id; },
    clearTimeout: (id) => { const i = timers.findIndex((t) => t.id === id); if (i >= 0) timers.splice(i, 1); },
    addEventListener: (ev, fn) => { (listeners[ev] = listeners[ev] || new Set()).add(fn); },
    removeEventListener: (ev, fn) => { if (listeners[ev]) listeners[ev].delete(fn); },
  };
  const card = { top: cardTop, h: 180 };
  const target = () => card.top + card.h / 2 - win.innerHeight / 2;
  const el = {
    getBoundingClientRect: () => ({ top: card.top - curY(), height: card.h }),
    scrollIntoView: (o) => {
      assert.deepStrictEqual(o, { block: 'center' }, 'tot derularea de până acum (lină, din CSS)');
      calls++;
      if (smooth) { anim = { from: curY(), to: target(), start: now, dur: smooth }; } else { anim = null; y = target(); }
    },
  };
  const doc = { getElementById: (id) => (present && id === 'card-T1' ? el : null) };
  const advance = (ms) => {
    const end = now + ms;
    for (;;) {
      timers.sort((a, b) => a.at - b.at);
      const t = timers[0];
      if (!t || t.at > end) break;
      timers.shift(); now = t.at; t.fn();
    }
    now = end;
  };
  const fire = (ev, e = {}) => { for (const fn of [...(listeners[ev] || [])]) fn(e); };
  const nListeners = () => Object.values(listeners).reduce((a, st) => a + st.size, 0);
  return { env: { window: win, document: doc }, win, card, advance, fire, show: () => { present = true; }, calls: () => calls, pending: () => timers.length, centeredY: target, nListeners };
}

test('revenirea: cardul apare după încărcare → e centrat; lista se mai mișcă → re-centrat; apoi se oprește singur', async (t) => {
  const m = await load(); if (!m) return t.skip('Node fără import ESM');
  const f = fakeEnv();
  m.scrollToCard('T1', { initialDelay: 50, env: f.env });
  f.advance(300);                       // lista încă se încarcă: cardul nu e
  assert.strictEqual(f.calls(), 0);
  f.show();
  f.advance(100);
  assert.strictEqual(f.calls(), 1, 'centrat de cum apare');
  assert.strictEqual(f.win.scrollY, f.centeredY());
  f.card.top += 400;                    // se deschide o secțiune deasupra: cardul coboară
  f.advance(250);
  assert.strictEqual(f.calls(), 2, 're-centrat');
  assert.strictEqual(f.win.scrollY, f.centeredY());
  f.advance(250); f.advance(250);       // nimic nu se mai mișcă: două verificări → gata
  assert.strictEqual(f.pending(), 0, 'nu mai rulează nimic');
  assert.strictEqual(f.nListeners(), 0, 'ascultătorii scoși');
  assert.strictEqual(f.calls(), 2);
});

test('derularea: după revenire, rotița / degetul / tastele / un clic opresc imediat re-centrarea (nu mai e „înghețată")', async (t) => {
  const m = await load(); if (!m) return t.skip('Node fără import ESM');
  for (const [ev, e] of [['wheel', {}], ['touchstart', {}], ['touchmove', {}], ['keydown', { key: 'ArrowDown' }], ['keydown', { key: 'PageDown' }], ['keydown', { key: ' ' }], ['pointerdown', {}], ['mousedown', {}]]) {
    const f = fakeEnv();
    f.show();
    m.scrollToCard('T1', { initialDelay: 50, env: f.env });
    f.advance(60);
    assert.strictEqual(f.calls(), 1);
    f.fire(ev, e);                       // elevul derulează…
    f.win.scrollY += 900;                //   …în jos
    f.card.top += 300;                   // lista încă se mișcă
    f.advance(3000);
    assert.strictEqual(f.calls(), 1, `${ev} ${e.key || ''}: nu-l mai trage înapoi la card`);
    assert.strictEqual(f.pending(), 0);
    assert.strictEqual(f.nListeners(), 0);
  }
  // o tastă care nu derulează nu oprește nimic
  const f = fakeEnv(); f.show();
  m.scrollToCard('T1', { initialDelay: 50, env: f.env });
  f.advance(60);
  f.fire('keydown', { key: 'a' });
  f.card.top += 300;
  f.advance(250);
  assert.strictEqual(f.calls(), 2);
});

test('derularea lină spre card (CSS smooth) nu e luată drept derularea elevului: lista care se mișcă în timpul ei → re-centrat', async (t) => {
  const m = await load(); if (!m) return t.skip('Node fără import ESM');
  const f = fakeEnv({ smooth: 700 }); f.show();
  m.scrollToCard('T1', { initialDelay: 200, env: f.env });
  f.advance(210);
  assert.strictEqual(f.calls(), 1);
  f.advance(250);                        // animația merge încă spre card
  assert.ok(f.win.scrollY > 0 && f.win.scrollY < f.centeredY());
  f.card.top += 500;                     // se deschide o secțiune: cardul coboară
  f.advance(250);
  assert.strictEqual(f.calls(), 2, 're-centrat (nu oprit)');
  f.advance(2000);
  assert.strictEqual(Math.round(f.win.scrollY), Math.round(f.centeredY()), 'ajunge exact la card');
  assert.strictEqual(f.pending(), 0);
  // și cu animația în curs, rotița elevului oprește tot
  const g = fakeEnv({ smooth: 700 }); g.show();
  m.scrollToCard('T1', { initialDelay: 200, env: g.env });
  g.advance(300);
  g.fire('wheel'); g.win.scrollY = 1200;
  g.card.top += 300;
  g.advance(3000);
  assert.strictEqual(g.calls(), 1);
  assert.strictEqual(g.win.scrollY, 1200);
});

test('derularea cu bara de derulare (fără evenimente): oprește la următoarea verificare, fără să sară înapoi', async (t) => {
  const m = await load(); if (!m) return t.skip('Node fără import ESM');
  const f = fakeEnv(); f.show();
  m.scrollToCard('T1', { initialDelay: 50, env: f.env });
  f.advance(60);
  f.win.scrollY -= 1500;                 // elevul trage bara în sus
  const y = f.win.scrollY;
  f.advance(3000);
  assert.strictEqual(f.win.scrollY, y, 'rămâne unde a dus-o elevul');
  assert.strictEqual(f.calls(), 1);
  assert.strictEqual(f.pending(), 0);
});

test('revenirea rămâne sigură: o derulare ÎNAINTE ca cardul să apară nu o anulează; lista care se mișcă mereu → cel mult 12 re-centrări; anularea', async (t) => {
  const m = await load(); if (!m) return t.skip('Node fără import ESM');
  let f = fakeEnv();
  m.scrollToCard('T1', { initialDelay: 50, env: f.env });
  f.advance(100);
  f.fire('wheel');                       // pagina încă goală: derularea nu contează
  f.show();
  f.advance(150);
  assert.strictEqual(f.calls(), 1, 'tot ajunge la card');
  assert.strictEqual(f.win.scrollY, f.centeredY());
  // lista se tot mișcă: re-centrări, dar nu la nesfârșit
  f = fakeEnv(); f.show();
  m.scrollToCard('T1', { initialDelay: 50, env: f.env });
  for (let i = 0; i < 40; i++) { f.advance(250); f.card.top += 10; }
  assert.ok(f.calls() <= 13, String(f.calls()));
  assert.strictEqual(f.pending(), 0);
  // cardul nu apare deloc → renunță după ~6 s
  f = fakeEnv();
  m.scrollToCard('T1', { initialDelay: 50, env: f.env });
  f.advance(10000);
  assert.strictEqual(f.pending(), 0);
  assert.strictEqual(f.nListeners(), 0);
  // anularea (componenta pleacă)
  f = fakeEnv(); f.show();
  const cancel = m.scrollToCard('T1', { initialDelay: 50, env: f.env });
  cancel();
  f.advance(1000);
  assert.strictEqual(f.calls(), 0);
  assert.strictEqual(f.nListeners(), 0);
  assert.strictEqual(typeof m.scrollToCard(null), 'function');
});

test('paginile folosesc tot scrollToCard (re-exportat din ContentPage), cu revenirea la fel', () => {
  const read = (p) => fs.readFileSync(path.join(__dirname, '..', p), 'utf8');
  assert.match(read('src/components/ContentPage.jsx'), /export \{ scrollToCard \} from '\.\.\/lib\/scrollToCard'/);
  for (const p of ['src/pages/EvaluareNationala.jsx', 'src/pages/Bacalaureat.jsx']) {
    const s = read(p);
    assert.match(s, /import \{ ContentCard, scrollToCard \} from '\.\.\/components\/ContentPage'/, p);
    assert.match(s, /scrollToCard\(scrollCardId, \{ initialDelay: 200 \}\)/, p);
  }
  // „Înapoi" din viewere trimite tot cardul de la care s-a plecat
  assert.match(read('src/pages/PDFViewer.jsx'), /scrollToCardId: state\.scrollToCardId/);
  assert.match(read('src/pages/InteractiveViewer.jsx'), /scrollToCardId: state\.scrollToCardId/);
});
