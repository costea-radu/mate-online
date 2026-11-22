// =====================================================================
// test/rezolva-meditatie-live.test.js — „✏️ Rezolvă ▾": meditația live cu Prof. Tudor și ordinea
// metodelor (22 nov. 2026)
//   „pune la fiecare test PDF în «rezolvă» și varianta de rezolvare în meditație live cu Prof.
//    Virtual Tudor. ordinea în «rezolvă» la testele de evaluare națională și la testele de la
//    clase care sunt grilă: 1) pe PDF; 2) Interactiv; 3) meditație live cu Prof. virtual Tudor;
//    4) cu poză; 5) în chat; 6) în foaia de lucru. La celelalte teste, BAC și clase, care nu sunt
//    grilă, ordinea să fie: 1) Interactiv; 2) meditație live cu Prof. virtual Tudor; 3) cu poză;
//    4) în chat; 5) în foaia de lucru; 6) pe PDF"
//
// src/lib/metodeRezolvare.js, src/pages/PDFViewer.jsx, api/live.js (private_start),
// src/pages/MeditatiiLive.jsx, src/pages/LiveRoom.jsx, src/components/live/PreJoin.jsx.
// Rulare: npm test
// =====================================================================
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { createFakeSupabase, fakeRes } = require('./tools/fakeSupabase');
const ai = require('../api/_lib/ai');
const handler = require('../api/live');

const read = (f) => fs.readFileSync(path.join(__dirname, '..', f), 'utf8');
let libMR = null;
const MR = async () => { if (!libMR) libMR = await import('../src/lib/metodeRezolvare.js'); return libMR; };
const ids = (l) => l.map((m) => m.id);

// ═══════════════════════════ ordinea metodelor ═══════════════════════════
test('ordinea: EN și clasele grilă — Pe PDF, Interactiv, Meditație live, Cu poză, În chat, În foaia de lucru', async () => {
  const { ordineMetode, ORDINE_GRILA } = await MR();
  assert.deepStrictEqual(ORDINE_GRILA, ['pdf', 'interactiv', 'live', 'poza', 'chat', 'foaie']);
  assert.deepStrictEqual(ids(ordineMetode({ grila: true, pdf: true, interactiv: true, live: true })), ['pdf', 'interactiv', 'live', 'poza', 'chat', 'foaie']);
  // fără test interactiv asociat — metoda lipsește, restul își păstrează locul
  assert.deepStrictEqual(ids(ordineMetode({ grila: true, pdf: true, interactiv: false, live: true })), ['pdf', 'live', 'poza', 'chat', 'foaie']);
  // PDF-ul încă se încarcă — „Pe PDF" vine după
  assert.deepStrictEqual(ids(ordineMetode({ grila: true, pdf: false, interactiv: true, live: true })), ['interactiv', 'live', 'poza', 'chat', 'foaie']);
});

test('ordinea: BAC și clasele care nu sunt grilă — Interactiv, Meditație live, Cu poză, În chat, În foaia de lucru, Pe PDF', async () => {
  const { ordineMetode, ORDINE_ALTE } = await MR();
  assert.deepStrictEqual(ORDINE_ALTE, ['interactiv', 'live', 'poza', 'chat', 'foaie', 'pdf']);
  assert.deepStrictEqual(ids(ordineMetode({ grila: false, pdf: true, interactiv: true, live: true })), ['interactiv', 'live', 'poza', 'chat', 'foaie', 'pdf']);
  assert.deepStrictEqual(ids(ordineMetode({ grila: false, pdf: true, interactiv: false, live: true })), ['live', 'poza', 'chat', 'foaie', 'pdf']);
  // Biblioteca utilizatorilor / testul pe grupă: fără meditația live
  assert.deepStrictEqual(ids(ordineMetode({ grila: false, pdf: true, interactiv: false, live: false })), ['poza', 'chat', 'foaie', 'pdf']);
});

test('metoda nouă: „🎥 Meditație live cu Prof. Virtual Tudor" — nu se ține minte ca metodă implicită; sub buton, primele trei', async () => {
  const { METODA_LIVE, METODE_REZOLVARE, ordineMetode, rezumatMetode, PE_SCURT } = await MR();
  assert.deepStrictEqual(METODA_LIVE, { id: 'live', icon: '🎥', label: 'Meditație live cu Prof. Virtual Tudor', scurt: 'Live' });
  assert.ok(!METODE_REZOLVARE.some((m) => m.id === 'live' || m.id === 'interactiv'), 'de pe harta pregătirii nu pleacă singur din PDF');
  assert.strictEqual(PE_SCURT.live, 'meditație live');
  assert.strictEqual(rezumatMetode(ordineMetode({ grila: true, pdf: true, interactiv: true, live: true })), 'pe PDF · interactiv · meditație live · …');
  assert.strictEqual(rezumatMetode(ordineMetode({ grila: false, pdf: true, interactiv: true, live: true })), 'interactiv · meditație live · poză · …');
  assert.strictEqual(rezumatMetode([{ id: 'poza' }, { id: 'chat' }]), 'poză · chat');
});

// ═══════════════════════════ testele grilă de la clase ═══════════════════════════
test('grilă: instrucțiunea testului (și cu cuvintele rupte la diacritice de PDF); subpunctele a) b) c) d) nu fac un test grilă', async () => {
  const { esteTestGrila } = await MR();
  // textul real scos din PDF-urile de EN de pe site
  assert.strictEqual(esteTestGrila('SUBIECTUL I\nÎncercuie ște litera corespunz ătoare r ăspunsului corect. (30 de puncte)'), true);
  assert.strictEqual(esteTestGrila('Subiectul I (30 puncte)\nIncercuie \u0327ste litera corespunz \u0306atoare r \u0306aspunsului corect.^{ˆ}'), true);
  assert.strictEqual(esteTestGrila('Pentru itemii 1-6 scrieţi pe foaia de examen litera corespunzătoare răspunsului corect.'), true);
  assert.strictEqual(esteTestGrila('Pentru fiecare item, un singur răspuns este corect.'), true);
  assert.strictEqual(esteTestGrila('Alegeți varianta corectă:'), true);
  assert.strictEqual(esteTestGrila('Marchează cu X varianta corectă.'), true);
  assert.strictEqual(esteTestGrila('Itemi de tip grilă: 1. ...'), true);
  assert.strictEqual(esteTestGrila('', 'Test grilă — Fracții'), true, 'în titlu');
  // fișele claselor (textul real): subpuncte, nu variante
  assert.strictEqual(esteTestGrila('Divizibilitate\nMatematică · clasa a VI-a · fișă de exerciții\nModel 1: Calculați c.m.m.d.c. și c.m.m.m.c. ale numerelor\n1. Calculați:\na) 24 și 40;\nb) 24 și 60;\nc) 48 și 100;\nd) 20, 24 și 40.', 'ALGEBRĂ - Fișă 2: CMMDC și CMMMC. Divizibilitate'), false);
  assert.strictEqual(esteTestGrila('Grilaj metalic de 3 m; trei pixeli negri la margine', 'Fișă 5: Puteri'), false);
  assert.strictEqual(esteTestGrila('', 'Grilaj'), false);
  assert.strictEqual(esteTestGrila(null, null), false);
  // instrucțiunea e la început: se citesc doar primele 15.000 de caractere (fișe de peste 1 milion)
  assert.strictEqual(esteTestGrila(`${'x '.repeat(9000)}Încercuiește litera corespunzătoare`), false);
});

test('vizualizatorul: EN mereu grilă, BAC niciodată, clasele după instrucțiune (textul de pe server sau primele pagini)', () => {
  const v = read('src/pages/PDFViewer.jsx');
  assert.match(v, /const esteClasa = \/\^clasa-\/\.test\(item\?\.category \|\| ''\);/);
  assert.match(v, /const grilaDinText = useMemo\(\(\) => \(esteClasa && pdfText \? esteTestGrila\(pdfText, item\?\.title\) : null\), \[esteClasa, pdfText, item\?\.title\]\);/);
  assert.match(v, /const testGrila = isEnPdf \|\| \(esteClasa && \(grilaDinText \?\? grilaDinPagini \?\? esteTestGrila\('', item\?\.title\)\)\);/);
  // fără textul de pe server (fără cont): primele 3 pagini, citite cu pdf.js la deschiderea meniului
  assert.match(v, /async function textPrimelePagini\(data, cate = 3\) \{/);
  assert.match(v, /if \(esteClasa && !pdfText && grilaDinPagini === null && pdfData\) \{\s*\n\s*textPrimelePagini\(pdfData\)\.then\(\(t\) => setGrilaDinPagini\(esteTestGrila\(t, item\?\.title\)\), \(\) => setGrilaDinPagini\(false\)\);/);
  assert.match(v, /const metodeVazute = ordineMetode\(\{ grila: testGrila, pdf: canSolve \|\| solveGeneric, interactiv: !!interactivId, live: liveInMeniu \}\);/);
});

// ═══════════════════════════ pe ce teste se poate meditația live ═══════════════════════════
test('meditația live: EN / BAC cu barem — da; clase, fără barem, profilul pedagogic — nu, cu motivul', async () => {
  const { stareLive, subtitluLive, mesajLiveIndisponibil, BAREM_OK_LIVE } = await MR();
  const L = require('../api/_lib/live');
  assert.deepStrictEqual([...L.BAREM_OK].sort(), [...BAREM_OK_LIVE].sort(), 'aceleași stări ale baremului ca serverul');
  assert.deepStrictEqual(stareLive({ category: 'evaluare-nationala', baremStatus: 'ok' }), { ok: true, motiv: null });
  assert.deepStrictEqual(stareLive({ category: 'bacalaureat', profile: 'mate-info', baremStatus: 'inclus' }), { ok: true, motiv: null });
  assert.deepStrictEqual(stareLive({ category: 'bacalaureat', profile: 'tehnologic' }), { ok: true, motiv: null }, 'baremul încă necunoscut → hotărăște serverul');
  assert.deepStrictEqual(stareLive({ category: 'evaluare-nationala', baremStatus: 'negasit' }), { ok: false, motiv: 'fara-barem' });
  assert.deepStrictEqual(stareLive({ category: 'clasa-6', baremStatus: 'ok_admin' }), { ok: false, motiv: 'clasa' });
  assert.deepStrictEqual(stareLive({ category: 'bacalaureat', profile: 'pedagogic', baremStatus: 'ok' }), { ok: false, motiv: 'pedagogic' });
  assert.deepStrictEqual(stareLive({ category: 'manuale' }), { ok: false, motiv: 'alt' });
  assert.match(subtitluLive({ ok: true }), /1-la-1, în sala live: încerci tu, apoi Prof\. Tudor îți explică pe barem/);
  assert.match(subtitluLive({ ok: false, motiv: 'clasa' }), /la testele de la clase, încă nu/);
  assert.match(subtitluLive({ ok: false, motiv: 'fara-barem' }), /acest test nu are barem/);
  assert.match(mesajLiveIndisponibil('clasa'), /strict pe baremul oficial\. La testele de la clase nu există încă meditații live\./);
  assert.match(mesajLiveIndisponibil('fara-barem'), /nu îl poate preda live/);
  assert.match(mesajLiveIndisponibil('pedagogic'), /profilul pedagogic/);
});

test('lobby-ul și întoarcerea: examenul subiectului, linkul cu testul ales, doar PDF-urile site-ului', async () => {
  const { examenLobby, linkLobbyLive, RE_INAPOI_LA_TEST, cheieInapoi } = await MR();
  assert.strictEqual(examenLobby({ exam: 'en' }), 'en');
  assert.strictEqual(examenLobby({ exam: 'bac', profile: 'stiinte-naturii' }), 'stiinte-naturii');
  assert.strictEqual(examenLobby({ exam: 'bac', profile: 'pedagogic' }), null);
  assert.strictEqual(examenLobby({}), null);
  const id = 'aaaaaaaa-0000-4000-8000-000000000001';
  assert.strictEqual(linkLobbyLive(id, 'mate-info'), `/meditatii?mod=subiect&examen=mate-info&subiect=${id}`);
  assert.strictEqual(linkLobbyLive(null, 'en'), '/meditatii?mod=subiect&examen=en');
  assert.ok(RE_INAPOI_LA_TEST.test(`/pdf-viewer?id=${id}`));
  for (const rau of ['https://rau.example/pdf-viewer?id=x', `//rau.example/pdf-viewer?id=${id}`, `/pdf-viewer?id=${id}&x=1`, '/meditatii']) {
    assert.ok(!RE_INAPOI_LA_TEST.test(rau), rau);
  }
  assert.strictEqual(cheieInapoi('s1'), 'live:inapoi:s1');
});

// ═══════════════════════════ vizualizatorul: clicul pe meditația live ═══════════════════════════
test('vizualizatorul: meditația live apare la PDF-urile site-ului, pornește ședința 1-la-1 pe acest test și deschide sala', () => {
  const v = read('src/pages/PDFViewer.jsx');
  assert.match(v, /import \{ liveApi \} from '\.\.\/lib\/live\/api';/);
  assert.match(v, /const liveInMeniu = !isLib && !modTest && !!item\?\.id && item\.content_type === 'pdf' && !isBaremItem && baremStatus !== 'este_barem';/);
  assert.match(v, /const liveStare = stareLive\(\{ category: item\?\.category, profile: item\?\.profile, baremStatus \}\);/);
  assert.match(v, /if \(m === METODA_LIVE\.id\) \{ deschideLive\(\); return; \}/);
  const live = v.slice(v.indexOf('async function deschideLive() {'), v.indexOf('// „✕ Închide rezolvarea" din meniu'));
  assert.match(live, /if \(!liveStare\.ok\) \{ arataLiveIndisponibil\(liveStare\.motiv\); return; \}/);
  assert.match(live, /Autentifică-te ca să intri la meditația live cu Prof\. Tudor\./);
  assert.match(live, /if \(solveOn\) \{ solve\.store\.flush\(\); setSolveOn\(false\); \}/, 'scrisul de pe PDF rămâne în ciornă');
  assert.match(live, /const r = await liveApi\.privateStart\(null, item\.id\);/);
  assert.match(live, /sessionStorage\.setItem\(cheieInapoi\(r\.sessionId\), inapoi\);/);
  assert.match(live, /navigate\(`\/meditatii\/sala\/\$\{r\.sessionId\}`\);/);
  // fără drept la ședință → lobby-ul, cu testul ales și plata (păstrat și după Stripe)
  assert.match(live, /if \(e\.code === 'LIVE_PAYMENT'\) \{/);
  assert.match(live, /sessionStorage\.setItem\('live:subiect', JSON\.stringify\(\{ id: item\.id, inapoi \}\)\);/);
  assert.match(live, /navigate\(linkLobbyLive\(item\.id, ex\), \{ state: \{ banner: \{ kind: 'info', text: `🎥 „\$\{item\.title \|\| 'Testul'\}": \$\{e\.message\}`, pay: 'privat' \} \} \}\);/);
  for (const [cod, motiv] of [['NO_BAREM', 'fara-barem'], ['NOT_LIVE', 'pedagogic'], ['NOT_EXAM', 'clasa']]) {
    assert.ok(live.includes(`if (e.code === '${cod}') { arataLiveIndisponibil('${motiv}'); return; }`), cod);
  }
  // la clase, fără barem: estompată în meniu, dar apăsabilă (spune de ce); interactivul ca alternativă
  assert.match(v, /const stins = m\.id === METODA_LIVE\.id && !liveStare\.ok;/);
  assert.match(v, /opacity: stins \? 0\.55 : 1/);
  assert.match(v, /data-indisponibil=\{stins \? '1' : undefined\}/);
  assert.ok(!/aria-disabled=\{stins/.test(v), 'nu „disabled": clicul spune de ce nu se poate');
  assert.match(v, /else if \(interactivId\) setNote\(\{ text, ms: 12000, action: \{ label: '🧩 Rezolvă interactiv', onClick: \(\) => \{ setNote\(null\); deschideInteractiv\(\); \} \} \}\);/);
  assert.match(v, /const t = setTimeout\(\(\) => setNote\(null\), note\.ms \|\| 6000\);/);
  assert.match(v, /\{note\.action && \(/);
  assert.match(v, /live: liveBusy \? 'pregătesc sala…' : subtitluLive\(liveStare\),/);
});

// ═══════════════════════════ lobby-ul și sala ═══════════════════════════
test('lobby: ?examen= și ?subiect= aleg examenul și testul (și după plata Stripe); banda vine din vizualizator', () => {
  const lv = read('src/pages/MeditatiiLive.jsx');
  assert.match(lv, /import \{ Link, useLocation, useNavigate, useSearchParams \} from 'react-router-dom';/);
  assert.match(lv, /const q = params\.get\('examen'\);\s*\n\s*if \(EXAMS\.some\(\(x\) => x\.id === q\)\) \{ store\.set\(EXAM_KEY, q\); return q; \}/);
  assert.match(lv, /const \[wanted\] = useState\(\(\) => readWantedSubject\(params\)\);/);
  assert.match(lv, /if \(!params\.get\('plata'\)\) return null;   \/\/ doar la întoarcerea de la plată/);
  assert.match(lv, /if \(wanted && list\.some\(\(s\) => s\.id === wanted\.id\)\) \{\s*\n\s*setSubjectId\(wanted\.id\);/);
  assert.match(lv, /useState\(\(\) => \(location\.state && location\.state\.banner && location\.state\.banner\.text \? location\.state\.banner : null\)\)/);
  assert.match(lv, /if \(wanted\.inapoi\) sessionStorage\.setItem\(`live:inapoi:\$\{r\.sessionId\}`, wanted\.inapoi\);/);
  assert.match(lv, /sessionStorage\.removeItem\(SUBJ_KEY\);/);
  // banda are tot ce trebuie (plata, apoi „▶ Începe meditația"), deci pagina rămâne sus
  assert.match(lv, /if \(!bannerRef\.current\) \{\s*\n\s*setTimeout\(\(\) => \{/);
  // după plată: testul venit din PDF pornește din bandă; webhookul Stripe poate întârzia → reîncercări
  assert.match(lv, /const dinPdf = tip === 'privat' && !!wanted;/);
  assert.match(lv, /sessionId: ses \|\| null, start: dinPdf \? wanted\.id : null,/);
  assert.match(lv, /\{banner\.start && <button type="button" className="lv-btn-primary" disabled=\{busy === 'private'\} onClick=\{\(\) => startPrivate\(banner\.start, null, 'private', \{ retryPay: 4 \}\)\}>/);
  assert.match(lv, /if \(retryPay > 0\) \{ await new Promise\(\(ok\) => setTimeout\(ok, 2500\)\); return startPrivate\(sid, ref, busyKey, \{ retryPay: retryPay - 1 \}\); \}/);
});

test('sala: pornită din PDF, „Ieși" și „↩ Înapoi la test" duc înapoi la PDF; altfel, la program', () => {
  const r = read('src/pages/LiveRoom.jsx');
  assert.match(r, /import \{ RE_INAPOI_LA_TEST, cheieInapoi \} from '\.\.\/lib\/metodeRezolvare';/);
  assert.match(r, /const v = sessionStorage\.getItem\(cheieInapoi\(routeId\)\);\s*\n\s*return v && RE_INAPOI_LA_TEST\.test\(v\) \? v : null;/);
  assert.match(r, /navigate\(inapoiLaTest \|\| '\/meditatii', \{ replace: true \}\);/);
  assert.match(r, /back=\{inapoiLaTest \? \{ to: inapoiLaTest, label: '↩ Înapoi la test' \} : null\}/);
  const pj = read('src/components/live/PreJoin.jsx');
  assert.match(pj, /<Link to=\{back\?\.to \|\| '\/meditatii'\} className="lv-btn-soft">\{back\?\.label \|\| 'Înapoi la program'\}<\/Link>/);
});

// ═══════════════════════════ serverul: private_start ═══════════════════════════
const U = {
  free: '11111111-1111-4111-8111-111111111111',
  prem: '22222222-2222-4222-8222-222222222222',
};
const C = {
  en: 'aaaaaaaa-0000-4000-8000-000000000001',
  enFaraBarem: 'aaaaaaaa-0000-4000-8000-000000000002',
  bacMi: 'bbbbbbbb-0000-4000-8000-000000000001',
  bacPed: 'bbbbbbbb-0000-4000-8000-000000000002',
  clasa: 'cccccccc-0000-4000-8000-000000000001',
};
const BAREM_TEXT = 'BAREM DE EVALUARE ȘI DE NOTARE. SUBIECTUL I. Rezultate: 1. b 2. c 3. a. Se punctează orice modalitate corectă de rezolvare.';
const content = (id, title, category, extra = {}) => ({ id, title, category, subcategory: null, profile: null, content_type: 'pdf', file_url: `https://x/${id}.pdf`, is_free: true, created_at: '2026-01-01T00:00:00Z', ...extra });
const pdfRow = (id, status = 'ok') => ({ content_id: id, barem_status: status, barem: { title: 'Barem' }, barem_text: BAREM_TEXT, text: 'SUBIECTUL I ...' });
function seed() {
  return {
    profiles: [
      { id: U.free, full_name: 'Ioana Popescu', email: 'ioana@example.com', subscription_status: null, role: 'elev', is_admin: false },
      { id: U.prem, full_name: 'Andrei Ionescu', email: 'andrei@example.com', subscription_status: 'active', role: 'elev', is_admin: false },
    ],
    content: [
      content(C.en, 'EN 2024 Varianta 7', 'evaluare-nationala', { subcategory: 'variante' }),
      content(C.enFaraBarem, 'EN — Ecuații (fișă)', 'evaluare-nationala', { subcategory: 'capitole' }),
      content(C.bacMi, 'BAC 2024 M1 Mate-Info Varianta 3', 'bacalaureat', { profile: 'mate-info', subcategory: 'variante' }),
      content(C.bacPed, 'BAC 2024 M_pedagogic Varianta 2', 'bacalaureat', { profile: 'pedagogic', subcategory: 'variante' }),
      content(C.clasa, 'ALGEBRĂ - Fișă 4: Proporții', 'clasa-6'),
    ],
    ai_pdf_text: [pdfRow(C.en), pdfRow(C.enFaraBarem, 'negasit'), pdfRow(C.bacMi), pdfRow(C.bacPed), pdfRow(C.clasa, 'ok_admin')],
    app_settings: [{ key: 'live_free_lessons', value: { subjects: [] } }],   // fără meditații gratuite aici
  };
}
let fake = null;
ai.admin = () => fake;
ai.authUser = async (req) => {
  const u = req.headers['x-user'];
  if (!u) { const e = new Error('Neautentificat.'); e.status = 401; throw e; }
  return u;
};
ai.logUsage = async () => {};
delete process.env.SUPABASE_URL; delete process.env.VITE_SUPABASE_URL;
test.beforeEach(() => handler._internals.resetFree());
async function call(action, body = {}, user = null) {
  const res = fakeRes();
  await handler({ method: 'POST', headers: user ? { 'x-user': user } : {}, query: {}, body: { action, ...body } }, res);
  return res;
}

test('private_start din vizualizator: fără profesor ales → Prof. Tudor; ședința 1-la-1 pe acest test; a doua oară se reia', async () => {
  fake = createFakeSupabase(seed());
  const st = await call('private_start', { teacher: null, subjectId: C.en }, U.prem);
  assert.strictEqual(st.statusCode, 200, JSON.stringify(st.body));
  const s = fake.db.tables.live_sessions.find((x) => x.id === st.body.sessionId);
  assert.deepStrictEqual([s.kind, s.teacher, s.subject_id, s.exam, s.owner_id], ['privat', 'radu', C.en, 'en', U.prem]);
  const again = await call('private_start', { subjectId: C.en }, U.prem);
  assert.strictEqual(again.body.resumed, true);
  assert.strictEqual(again.body.sessionId, st.body.sessionId);
  // un profesor ales greșit rămâne o eroare (lobby-ul trimite mereu unul valid)
  assert.strictEqual((await call('private_start', { teacher: 'nimeni', subjectId: C.en }, U.prem)).statusCode, 400);
});

test('private_start: refuzurile au cod — NOT_EXAM (clase), NOT_LIVE (pedagogic), NO_BAREM; 402 spune examenul pentru lobby', async () => {
  fake = createFakeSupabase(seed());
  const clasa = await call('private_start', { subjectId: C.clasa }, U.prem);
  assert.strictEqual(clasa.statusCode, 400);
  assert.strictEqual(clasa.body.code, 'NOT_EXAM', 'testele de la clase n-au meditații live (nici cu barem)');
  const ped = await call('private_start', { subjectId: C.bacPed }, U.prem);
  assert.strictEqual(ped.statusCode, 400);
  assert.strictEqual(ped.body.code, 'NOT_LIVE');
  const faraBarem = await call('private_start', { subjectId: C.enFaraBarem }, U.prem);
  assert.strictEqual(faraBarem.statusCode, 409);
  assert.strictEqual(faraBarem.body.code, 'NO_BAREM');
  // elevul fără abonament și fără bilet: plata, cu examenul subiectului (lobby-ul îl deschide pe el)
  const plata = await call('private_start', { subjectId: C.bacMi }, U.free);
  assert.strictEqual(plata.statusCode, 402);
  assert.strictEqual(plata.body.code, 'LIVE_PAYMENT');
  assert.strictEqual(plata.body.price, 30);
  assert.deepStrictEqual([plata.body.exam, plata.body.profile], ['bac', 'mate-info']);
  assert.strictEqual(fake.db.tables.live_sessions?.length || 0, 0, 'niciun refuz nu creează ședință');
});
