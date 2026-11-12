// =====================================================================
// test/scor-in-asteptare.test.js — 11 noiembrie 2026 (seara), „de la vizitator la cont":
//   1) rezultatul unui test rezolvat FĂRĂ cont se păstrează 48 h și se salvează
//      în cont după autentificare (verificat de server);
//   2) vizitatorul e invitat să-și facă un cont exact când își află nota;
//   3) „▶ Începe un test" pe paginile de examen; materialul în adresă (?id=);
//   4) conturile noi făcute cu Google / Discord se numără ca „sign_up".
// =====================================================================
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const read = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');
const stocare = () => { const m = new Map(); return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k), m }; };

test('rezultatul fără cont: păstrat 48 h, cu răspunsurile; expirat sau stricat → șters', async () => {
  const S = await import('../src/lib/scorInAsteptare.js');
  const st = stocare();
  const t0 = 1_800_000_000_000;
  assert.strictEqual(S.pastreazaScor({ contentId: 'c1', title: 'Test EN 3', score: 14, maxScore: 18, answers: [0, 2, 'x'], durationSec: 600.4 }, { storage: st, now: t0 }), true);
  const s = S.scorPastrat({ storage: st, now: t0 + 3600_000 });
  assert.deepStrictEqual({ ...s }, { contentId: 'c1', title: 'Test EN 3', score: 14, maxScore: 18, answers: [0, 2, 'x'], durationSec: 600, at: t0, incercari: 0 });
  // după 48 h nu mai e
  assert.strictEqual(S.scorPastrat({ storage: st, now: t0 + S.VALABIL_MS + 1 }), null);
  assert.strictEqual(st.getItem(S.CHEIE), null, 'cel expirat se șterge');
  // date fără rost → nu se păstrează nimic
  for (const rau of [null, {}, { contentId: 'c', score: 3, maxScore: 0 }, { contentId: 'c', score: 'x', maxScore: 10 }, { contentId: 'c', score: -1, maxScore: 10 }, { score: 1, maxScore: 2 }]) {
    assert.strictEqual(S.pastreazaScor(rau, { storage: st, now: t0 }), false);
  }
  assert.strictEqual(S.scorPastrat({ storage: st, now: t0 }), null);
  // scorul nu depășește maximul; cel mult 60 de răspunsuri; fără răspunsuri → null
  S.pastreazaScor({ contentId: 'c2', score: 25, maxScore: 18, answers: Array.from({ length: 80 }, (_, i) => i) }, { storage: st, now: t0 });
  const s2 = S.scorPastrat({ storage: st, now: t0 });
  assert.strictEqual(s2.score, 18);
  assert.strictEqual(s2.answers.length, 60);
  S.pastreazaScor({ contentId: 'c3', score: 5, maxScore: 10, answers: [] }, { storage: st, now: t0 });
  assert.strictEqual(S.scorPastrat({ storage: st, now: t0 }).answers, null);
  // JSON stricat în browser
  st.setItem(S.CHEIE, '{nu e json');
  assert.strictEqual(S.scorPastrat({ storage: st, now: t0 }), null);
  // fără localStorage (mod privat): nimic nu pică
  assert.strictEqual(S.pastreazaScor({ contentId: 'c', score: 1, maxScore: 2 }, { storage: null }), false);
  assert.strictEqual(S.scorPastrat({ storage: null }), null);
});

test('salvarea după autentificare: cel mult 3 încercări; erorile definitive nu se reiau', async () => {
  const S = await import('../src/lib/scorInAsteptare.js');
  const st = stocare();
  const t0 = 1_800_000_000_000;
  S.pastreazaScor({ contentId: 'c1', score: 9, maxScore: 18 }, { storage: st, now: t0 });
  assert.strictEqual(S.incaOIncercare({ storage: st, now: t0 }).incercari, 1);
  assert.strictEqual(S.incaOIncercare({ storage: st, now: t0 }).incercari, 2);
  assert.strictEqual(S.incaOIncercare({ storage: st, now: t0 }).incercari, 3);
  assert.strictEqual(S.incaOIncercare({ storage: st, now: t0 }), null, 'a patra oară renunțăm');
  assert.strictEqual(st.getItem(S.CHEIE), null);
  assert.strictEqual(S.incaOIncercare({ storage: st, now: t0 }), null, 'nimic păstrat');
  assert.ok(S.eroareDefinitiva('Nu am putut verifica răspunsurile. Reîncarcă pagina…'));
  assert.ok(S.eroareDefinitiva('Material negăsit') && S.eroareDefinitiva('Acces interzis. Necesită abonament.'));
  assert.ok(!S.eroareDefinitiva('Failed to fetch') && !S.eroareDefinitiva(''));
  // componenta: după autentificare, prin serverul care verifică răspunsurile
  const c = read('src/components/ScorInAsteptare.jsx');
  assert.match(c, /aiClient\.scoreSubmit\(\{ contentId: s\.contentId, answers: s\.answers, score: s\.score, maxScore: s\.maxScore, durationSec: s\.durationSec \}\)/);
  assert.match(c, /if \(loading \|\| !user\?\.id \|\| pornit\.current === user\.id\) return;/, 'o singură dată per cont');
  assert.match(c, /\.catch\(\(e\) => \{ if \(eroareDefinitiva\(e\?\.message\)\) uitaScorul\(\); \}\)/);
  assert.match(read('src/App.jsx'), /<ScorInAsteptare \/>/);
  // serverul nu salvează „pe încredere" un test cu chei fără răspunsuri
  assert.match(read('api/ai-score.js'), /code: 'ANSWERS_REQUIRED'/);
});

test('testul interactiv, fără cont: după corectare — „Creează cont gratuit", rezultatul păstrat', () => {
  const v = read('src/pages/InteractiveViewer.jsx');
  assert.match(v, /if \(!user\) \{\s*\n\s*if \(authLoading \|\| maxScore <= 0\) return;\s*\n\s*const pastrat = pastreazaScor\(\{ contentId: item\.id, title: item\.title, score, maxScore, answers: ans,/);
  assert.match(v, /setInvitatie\(\{ score, maxScore, pastrat \}\);/);
  assert.match(v, /\{invitatie && !user && \(/);
  assert.match(v, /<Link to="\/inregistrare" className="btn btn-primary btn-sm">Creează cont gratuit<\/Link>/);
  assert.ok(v.indexOf('if (!user) {\n        if (authLoading') < v.indexOf("if (temaId) {"), 'înaintea drumurilor care cer cont');
});

test('„▶ Începe un test" pe paginile de examen; materialul deschis are adresa lui (?id=)', () => {
  assert.match(read('src/pages/EvaluareNationala.jsx'), /<StartRapid category="evaluare-nationala" toate="\/evaluare-nationala\?tab=interactive" \/>\s*\n\s*<div className="tabs">/);
  assert.match(read('src/pages/Bacalaureat.jsx'), /<StartRapid category="bacalaureat" profile=\{profile\} \/>\s*\n\s*<div className="tabs">/);
  const sr = read('src/components/StartRapid.jsx');
  assert.match(sr, /testRapid\(\{ category, profile, userId: user\?\.id \|\| null \}\)/);
  assert.match(sr, /if \(test === null && !toate\) return null;/, 'fără teste gratuite în rubrică → fără buton');
  assert.match(sr, /!isParent && <Link to="\/pregateste-ma"/, '„Testul zilei" doar la elevi și vizitatori');
  // materialul în adresă: linkul din bara browserului se poate trimite mai departe, iar
  // „Cele mai accesate materiale" (statistici) numără toate deschiderile
  const cp = read('src/components/ContentPage.jsx');
  assert.match(cp, /navigate\(`\/pdf-viewer\?id=\$\{item\.id\}`, \{ state: \{ item, returnTo:/);
  assert.match(cp, /navigate\(`\/exercitiu\?id=\$\{item\.id\}`, \{ state: \{ item, srcDoc: _overrideSrcDoc, returnTo:/);
  const nav = read('src/components/Navbar.jsx');
  assert.match(nav, /navigate\(`\/pdf-viewer\?id=\$\{item\.id\}`, \{ state: \{ item \} \}\);/);
  assert.match(nav, /navigate\(`\/exercitiu\?id=\$\{item\.id\}`, \{ state: \{ item \} \}\);/);
  assert.ok(!/navigate\('\/(exercitiu|pdf-viewer)',/.test(cp + nav), 'nicio deschidere fără id');
  // vizualizatoarele nu mai cer materialul a doua oară când îl au deja din listă
  assert.match(read('src/pages/InteractiveViewer.jsx'), /if \(item && item\.id === idParam\) return;/);
  assert.match(read('src/pages/PDFViewer.jsx'), /if \(item \|\| !idParam \|\| libId\) return;/);
});

test('cont nou cu Google / Discord → „sign_up" o singură dată (e-mailul e numărat de formular)', async () => {
  const { contNouPrinOAuth, CONT_NOU_MS } = await import('../src/lib/contNou.js');
  const st = stocare();
  const trimise = [];
  const trimite = (f) => trimise.push(f);
  const now = 1_800_000_000_000;
  const u = (o = {}) => ({ id: 'u1', created_at: new Date(now - 60000).toISOString(), app_metadata: { provider: 'google' }, ...o });
  assert.strictEqual(contNouPrinOAuth(u(), { now, storage: st, trimite }), true);
  assert.deepStrictEqual(trimise, ['google']);
  assert.strictEqual(contNouPrinOAuth(u(), { now, storage: st, trimite }), false, 'a doua oară nu');
  assert.strictEqual(contNouPrinOAuth(u({ id: 'u2', app_metadata: { provider: 'email' } }), { now, storage: st, trimite }), false, 'e-mailul: din formular');
  assert.strictEqual(contNouPrinOAuth(u({ id: 'u3', created_at: new Date(now - CONT_NOU_MS - 1000).toISOString() }), { now, storage: st, trimite }), false, 'cont vechi = autentificare');
  assert.strictEqual(contNouPrinOAuth(u({ id: 'u4', created_at: 'x' }), { now, storage: st, trimite }), false);
  assert.strictEqual(contNouPrinOAuth(null, { now, storage: st, trimite }), false);
  assert.strictEqual(contNouPrinOAuth(u({ id: 'u5', app_metadata: { provider: 'discord' } }), { now, storage: st, trimite }), true);
  assert.deepStrictEqual(trimise, ['google', 'discord']);
  const ctx = read('src/context/AuthContext.jsx');
  assert.match(ctx, /if \(event === 'SIGNED_IN'\) contNouPrinOAuth\(session\?\.user, \{ trimite: trackSignUp \}\);/);
  assert.match(read('src/pages/Register.jsx'), /trackSignUp\('email'\);/);
});
