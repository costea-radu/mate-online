// =====================================================================
// src/components/FiseTestGenerator.jsx — „📚 Fișele cu exerciții ale clasei"
// (1 nov. 2026, în „🧩 Generează exerciții/teste interactive/PDF" → „👥 Teste
// diferite / elev", src/components/TesteDiferite.jsx)
//
// Cererea: „sa ia exercitiile din fisele cu exercitii clase 5-12 si sa poata fi
// selectate prin bifare «nivele» sau «tipuri», dupa cum sunt scrise in fisiere".
//
//   1. lista fișelor PDF ale clasei (api/fise.js → list);
//   2. la deschiderea unei fișe: grupele ei, exact cum sunt scrise în fișă —
//      „Nivel 3: Raționalizare", „Triunghiuri asemenea · MODEL 2", „Exercițiul 1
//      — ecuații de forma x² + bx = 0"… O fișă necitită o citește AI-ul ACUM,
//      o singură dată pentru toți profesorii (1–3 minute; banca e comună —
//      supabase/fise_banca.sql). Adminul poate citi deodată toate fișele clasei;
//   3. profesorul bifează grupele și alege câte exerciții ia din fiecare, în
//      fiecare test (se pot amesteca grupe din mai multe fișe);
//   4. se fac N teste (N = „Nr. teste diferite / elev"), DIFERITE între ele cât
//      permite fișa (src/lib/fiseTeste.js → planFiseTests):
//        · datele păstrate + PDF → fără AI și fără cost (kind 'exam', fără barem);
//        · „🔢 Schimbă numerele și notațiile" sau formatul interactiv → un apel AI
//          pe test (aiClient.generateInteractive, cu exercițiile testului ca
//          material, 1:1) — cu răspunsuri / barem.
//      Fiecare test se salvează în „Testele și exercițiile mele" și (opțional) se
//      publică în „Biblioteca utilizatorilor"; se tipăresc toate deodată.
// =====================================================================
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { aiClient } from '../lib/aiClient';
import { useAuth } from '../context/AuthContext';
import { ensureKatex, renderMath } from '../lib/katex';
import OptiuneSpatiuLucru from './OptiuneSpatiuLucru';
import ListaTesteExam, { SetSalvat } from './ListaTesteExam';
import VerificationNote from './VerificationNote';
import { estimeazaCredite, fmtEstimare, crediteDinCost, invatăDinReal } from '../lib/aiCost';
import { renderQuiz } from '../lib/quizRender';
import { printExam, printExams } from '../lib/examPrint';
import { setTitle, variantLabel, variantTitle, buildExamSet, examIsGrila, quizIsGrila } from '../lib/testeSet';
import {
  planFiseTests, maxDistinctFiseTests, exercisesPerTest, testToExam, sourceTextOf, topicFor,
  aiExamFromQuestions, quizToExam, compositionLabel, usableExercises, shortSheetTitle, clasaLabel,
  AI_MIN_EX, AI_MAX_EX, MAX_EX,
} from '../lib/fiseTeste';

const KIND = { nivel: 'nivel', tip: 'tip', sectiune: 'secțiune', lista: 'listă' };
const POLL_MS = 8000;                 // o fișă citită de alt profesor: reîntreb la 8 s
const POLL_MAX_MS = 12 * 60 * 1000;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
// „1 grupă · 3 grupe · 20 de grupe" (pluralul românesc cu „de" de la 20 în sus)
const plural = (n, unu, multe) => `${n} ${n === 1 ? unu : (n && (n % 100 === 0 || n % 100 >= 20) ? `de ${multe}` : multe)}`;

// textul cu formule ($…$), pe rând (titlul grupei, cerința, exercițiile din previzualizare)
function MathInline({ text }) {
  const ref = useRef(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.textContent = text || '';
    if (/[$\\]/.test(text || '')) ensureKatex().then(() => { if (ref.current === el) renderMath(el); });
  }, [text]);
  return <span ref={ref} />;
}

const chip = (active) => ({
  padding: '6px 11px', borderRadius: 999, cursor: 'pointer', fontSize: '.8rem', fontWeight: 600,
  border: `1.5px solid ${active ? 'var(--navy)' : 'var(--border)'}`,
  background: active ? 'var(--navy)' : '#fff', color: active ? '#fff' : 'var(--navy)',
});
const numInput = { width: 64, border: '1px solid var(--border)', borderRadius: 7, padding: '4px 6px', fontSize: '.8rem' };

export default function FiseTestGenerator({
  n = 10,               // câte teste diferite (unul pentru fiecare elev)
  category,             // clasa-5 … clasa-12
  dataMode = 'keep',    // 'keep' = exact din fișă · 'modify' = AI, alte numere și notații
  publish = true,       // se publică și în „Biblioteca utilizatorilor"
  onDone,               // (items, { format, category }) → testele generate
  onError,
}) {
  const { isAdmin } = useAuth();
  const navigate = useNavigate();
  const [sheets, setSheets] = useState(null);   // fișele clasei (cu starea băncii)
  const [listErr, setListErr] = useState(null);
  const [bankErr, setBankErr] = useState(null); // banca nepregătită (SQL nerulat)
  const [banks, setBanks] = useState({});       // id → { groups, status, … } | { loading, reading } | { error }
  const [open, setOpen] = useState({});         // fișele desfăcute
  const [counts, setCounts] = useState({});     // `${fișă}:${grupă}` → câte exerciții / test (0 = nebifată)
  const [preview, setPreview] = useState(null); // grupa cu exercițiile arătate
  const [q, setQ] = useState('');
  const [withFigures, setWithFigures] = useState(false);
  const [output, setOutput] = useState('pdf');  // 'pdf' | 'interactive'
  const [qtype, setQtype] = useState('mixt');
  const [durationMin, setDurationMin] = useState(50);
  const [oficiu, setOficiu] = useState(10);
  const [workSpace, setWorkSpace] = useState(true);
  const [busy, setBusy] = useState(null);
  const [err, setErr] = useState(null);
  const [rezultat, setRezultat] = useState(null);
  const [readAll, setReadAll] = useState(null); // admin: „citește toate" în curs
  const viu = useRef(true);
  useEffect(() => { viu.current = true; return () => { viu.current = false; }; }, []);

  const loadList = useCallback(async () => {
    setSheets(null); setListErr(null); setBankErr(null);
    try {
      const r = await aiClient.fiseList({ category });
      if (!viu.current) return;
      setSheets(r.sheets || []);
      setBankErr(r.bankError || null);
    } catch (e) { if (viu.current) { setListErr(e.message); setSheets([]); } }
  }, [category]);
  useEffect(() => {
    setBanks({}); setOpen({}); setCounts({}); setRezultat(null); setErr(null); setPreview(null);
    if (category) loadList();
  }, [category, loadList]);

  // Grupele unei fișe; o fișă necitită se citește acum (o dată, pentru toți).
  async function loadBank(sheet, { refresh = false } = {}) {
    const id = sheet.id;
    setBanks((b) => ({ ...b, [id]: { ...(b[id] || {}), loading: true, error: null, reading: false } }));
    const t0 = Date.now();
    let ref = refresh;
    try {
      for (;;) {
        // eslint-disable-next-line no-await-in-loop
        const r = await aiClient.fiseBank({ contentId: id, refresh: ref });
        if (!viu.current) return null;
        ref = false;
        if (r.bank) {
          setBanks((b) => ({ ...b, [id]: { ...r.bank, loading: false, reading: false, error: null, read: r.read || null } }));
          setSheets((list) => (list || []).map((s) => (s.id === id ? {
            ...s, reading: false, stale: false,
            bank: { status: r.bank.status, exercises: r.bank.exercises, updatedAt: r.bank.updatedAt, groups: (r.bank.groups || []).map((g) => ({ key: g.key, title: g.title, kind: g.kind, count: (g.exercises || []).length })) },
          } : s)));
          return r.bank;
        }
        // o citește chiar acum alt profesor → revin singur
        setBanks((b) => ({ ...b, [id]: { loading: true, reading: true, since: r.since || null } }));
        if (Date.now() - t0 > POLL_MAX_MS) throw new Error('Fișa se citește de prea mult timp — mai încearcă peste câteva minute.');
        // eslint-disable-next-line no-await-in-loop
        await sleep(POLL_MS);
      }
    } catch (e) {
      if (!viu.current) return null;
      setBanks((b) => ({ ...b, [id]: { loading: false, error: e.message || 'Fișa nu a putut fi citită.' } }));
      if (e.code === 'FISE_SQL') setBankErr(e.message);
      return null;
    }
  }
  function toggleSheet(s) {
    const deschide = !open[s.id];
    setOpen((o) => ({ ...o, [s.id]: deschide }));
    const b = banks[s.id];
    if (deschide && (!b || (!b.groups && !b.loading))) loadBank(s);
  }
  async function citesteToate() {
    const todo = (sheets || []).filter((s) => !s.bank);
    for (let i = 0; i < todo.length; i++) {
      if (!viu.current) return;
      setReadAll({ i: i + 1, n: todo.length, title: todo[i].title });
      // eslint-disable-next-line no-await-in-loop
      await loadBank(todo[i]);
    }
    setReadAll(null);
  }

  const keyOf = (sid, gk) => `${sid}:${gk}`;
  const defaultCount = (g) => Math.max(1, Math.min(2, usableExercises(g, withFigures).length || 1));
  function toggleGroup(s, g) {
    const k = keyOf(s.id, g.key);
    setCounts((c) => ({ ...c, [k]: c[k] > 0 ? 0 : defaultCount(g) }));
  }
  function setCount(s, g, v) {
    const max = Math.max(1, usableExercises(g, withFigures).length);
    const k = keyOf(s.id, g.key);
    setCounts((c) => ({ ...c, [k]: Math.max(0, Math.min(max, parseInt(v, 10) || 0)) }));
  }
  function setAll(s, on) {
    const b = banks[s.id];
    if (!b?.groups) return;
    setCounts((c) => {
      const x = { ...c };
      b.groups.forEach((g) => { x[keyOf(s.id, g.key)] = on ? (x[keyOf(s.id, g.key)] || defaultCount(g)) : 0; });
      return x;
    });
  }

  // alegerile: grupele bifate (în ordinea fișelor și a grupelor din fișă)
  const picks = useMemo(() => {
    const out = [];
    for (const s of sheets || []) {
      const b = banks[s.id];
      if (!b || !Array.isArray(b.groups)) continue;
      for (const g of b.groups) {
        const c = counts[keyOf(s.id, g.key)] || 0;
        if (c > 0) out.push({ ...g, sheetId: s.id, sheetTitle: s.title, count: c });
      }
    }
    return out;
  }, [sheets, banks, counts]);

  const perTest = exercisesPerTest(picks, withFigures);
  const maxDist = maxDistinctFiseTests(picks, withFigures);
  const aiNeeded = dataMode === 'modify' || output === 'interactive';
  const minEx = aiNeeded ? AI_MIN_EX : 1;
  const maxEx = aiNeeded ? AI_MAX_EX : MAX_EX;
  const effQtype = output === 'pdf' ? 'redactare' : qtype;
  const crediteTest = aiNeeded ? estimeazaCredite({ kind: 'test', count: Math.max(AI_MIN_EX, perTest || AI_MIN_EX), qtype: effQtype }) : 0;
  const cuFigura = picks.reduce((s, p) => s + (p.exercises || []).filter((e) => e.figure).length, 0);
  const problema = !picks.length ? 'Bifează cel puțin un nivel / tip de exerciții dintr-o fișă.'
    : perTest < minEx ? `Cu AI, un test are cel puțin ${AI_MIN_EX} exerciții — mărește numărul de exerciții de la grupele bifate (acum: ${perTest}).`
      : perTest > maxEx ? `Un test are cel mult ${maxEx} exerciții${aiNeeded ? ' când lucrează AI-ul' : ''} (acum: ${perTest}).`
        : null;

  // `publica`: un test singur se publică acum; variantele unui set — nu (setul se
  // publică o singură dată, întreg, la final)
  async function salveaza({ kind, title, topic, payload, publica = publish }) {
    const privateId = await aiClient.saveLibraryItem({ kind, title, category, topic, payload });
    let publicId = null; let publishError = null;
    if (publica) {
      try {
        const r = await aiClient.publicPublish({ kind, title, category, topic, payload });
        publicId = r?.id || null;
        if (publicId) aiClient.updateLibraryItem(privateId, { payload: { ...payload, publicId } }).catch(() => {});
      } catch (e) { publishError = e.message || 'publicarea a eșuat'; }
    }
    return { privateId, publicId, publishError, payload };
  }

  async function genereaza() {
    setErr(null); setRezultat(null);
    if (problema) { setErr(problema); return; }
    const plan = planFiseTests(picks, { tests: n, seed: (Date.now() % 2147483646) + 1, withFigures });
    const kind = output === 'interactive' ? 'interactive' : 'exam';
    // mai multe teste → un SET: „Varianta 1…N", salvat ca un singur PDF (src/lib/testeSet.js)
    const multe = plan.length > 1;
    const teste = [];
    let cost = 0;
    const fise = [...new Set(picks.map((p) => shortSheetTitle(p.sheetTitle)))];
    const eticheta = `${clasaLabel(category)} · ${fise.slice(0, 2).join(' + ')}${fise.length > 2 ? ' …' : ''}${dataMode === 'modify' ? ' · numere schimbate' : ''}`;
    const topic = `${fise.join(' + ')} — ${picks.map((p) => p.title).join(', ')}`.slice(0, 200);
    const gata = async (extra = {}) => {
      let set = null;
      if (multe && teste.length > 1 && viu.current) {
        setBusy(`Salvez cele ${teste.length} teste într-un singur PDF…`);
        try {
          // la interactive, PDF-ul setului e varianta lor de tipărit (cu barem)
          const exams = teste.map((t) => t.exam || quizToExam(t.title, t.questions, t.meta || {}));
          const grila = kind === 'interactive' ? teste.every((t) => quizIsGrila(t.questions)) : exams.every(examIsGrila);
          const title = setTitle(teste.length, grila);
          const examSet = buildExamSet(exams, { title, context: `Test din fișe — ${eticheta}` });
          const r = await aiClient.saveTestSet({
            kind: 'exam', title, category, topic, exam: examSet, grila, publish,
            children: teste.map((t) => ({ id: t.privateId, payload: t.payload })),
          });
          set = { ...r, exam: examSet };
        } catch (e) { set = { error: e.message || 'setul nu s-a putut salva' }; }
      }
      setRezultat({ kind, teste: [...teste], gata: true, total: teste.length, cost: cost || null, set, ...extra });
      if (viu.current && teste.length) {
        onDone?.(teste.map((t) => ({ source: 'personal', refId: t.privateId, title: t.title, isFree: true })),
          { format: kind === 'interactive' ? 'interactive' : 'pdf', category });
      }
    };
    try {
      let nr = multe ? 0 : await aiClient.nextNumberedTitle('Test din fișe nr.').catch(() => 1);
      for (const t of plan) {
        if (!viu.current) return;
        const titlu = multe ? variantTitle(`Test din fișe — ${eticheta}`, t.index) : `Test din fișe nr. ${nr} — ${eticheta}`;
        // pe foaia fiecărei variante: „Varianta k" (o primește un elev, prin testul pe grupă)
        const pe = multe ? variantLabel(t.index) : titlu;
        const cine = multe ? variantLabel(t.index) : `Testul ${t.index}`;
        if (!aiNeeded) {
          setBusy(`${cine} din ${plan.length}: o compun din banca fișei și o salvez…`);
          const exam = testToExam(t, { title: pe, durationMin, oficiu, workSpace, category });
          // eslint-disable-next-line no-await-in-loop
          const e = await salveaza({ kind: 'exam', title: titlu, topic, payload: { exam }, publica: publish && !multe });
          teste.push({ ...e, title: titlu, exam, repeats: t.repeats, nr });
        } else {
          setBusy(`${cine} din ${plan.length}: AI-ul ${dataMode === 'modify' ? 'schimbă numerele și notațiile' : 'adaugă răspunsurile'}… (~20–60 s)`);
          // eslint-disable-next-line no-await-in-loop
          const res = await aiClient.generateInteractive({
            category, topic: topicFor(t, { dataMode }), difficulty: 'mediu', dataMode, chapters: [],
            kind: 'test', count: perTest, qtype: effQtype, durationMin, oficiu,
            sourceText: sourceTextOf(t, { category }),
          });
          const c = crediteDinCost(res.cost);
          if (c) cost += c;
          invatăDinReal(res.cost, { kind: 'test', count: perTest, qtype: effQtype });
          const qs = res.questions || [];
          if (!qs.length) throw new Error('AI-ul nu a întors niciun item. Mai încearcă o dată.');
          setBusy(`${cine} din ${plan.length}: o salvez…`);
          if (kind === 'exam') {
            const exam = aiExamFromQuestions(t, qs, { title: pe, durationMin, oficiu, workSpace, category });
            // eslint-disable-next-line no-await-in-loop
            const e = await salveaza({ kind: 'exam', title: titlu, topic, payload: { exam }, publica: publish && !multe });
            teste.push({ ...e, title: titlu, exam, repeats: t.repeats, nr, verification: res.verification || null });
          } else {
            const meta = { durationMin, oficiu, ...(workSpace ? {} : { workSpace: false }) };
            // eslint-disable-next-line no-await-in-loop
            const e = await salveaza({ kind: 'interactive', title: titlu, topic, payload: { questions: qs, meta, source: { kind: 'fise', category } }, publica: publish && !multe });
            teste.push({ ...e, title: titlu, questions: qs, meta, repeats: t.repeats, nr, verification: res.verification || null });
          }
        }
        setRezultat({ kind, teste: [...teste], gata: false, total: plan.length, cost: cost || null });
        nr += 1;
      }
      await gata();
    } catch (e) {
      setErr(e.message || 'Generarea testelor a eșuat.');
      onError?.(e);
      if (teste.length) await gata({ intrerupt: true });
    } finally { setBusy(null); }
  }

  const filtrate = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return (sheets || []).filter((s) => !needle || (s.title || '').toLowerCase().includes(needle));
  }, [sheets, q]);
  const necitite = (sheets || []).filter((s) => !s.bank).length;

  const box = { border: '2px dashed var(--gold)', borderRadius: 12, background: 'rgba(232,185,49,.06)', padding: 14, marginTop: 12 };
  const lbl = { fontSize: '.78rem', fontWeight: 700, color: 'var(--navy)', margin: '12px 0 6px' };

  return (
    <div style={box}>
      <div style={{ fontSize: '.86rem', fontWeight: 700, color: 'var(--navy)', marginBottom: 4 }}>
        📚 {n} {n === 1 ? 'test' : 'teste diferite'} din fișele cu exerciții — {clasaLabel(category)}
      </div>
      <p style={{ fontSize: '.79rem', color: 'var(--text-light)', margin: '0 0 6px', lineHeight: 1.55 }}>
        Deschide o fișă și <strong>bifează nivelele sau tipurile de exerciții</strong> — exact cum sunt scrise în fișă —
        apoi alege câte exerciții intră din fiecare, în fiecare test. Testele <strong>diferă între ele</strong>: un exercițiu
        se repetă abia după ce s-au folosit toate exercițiile grupei lui. Poți amesteca grupe din mai multe fișe.
        {dataMode === 'modify'
          ? <> Cu <strong>„🔢 Schimbă numerele și notațiile"</strong>, AI-ul rescrie fiecare test (un apel pe test), cu barem.</>
          : <> Cu <strong>datele păstrate</strong>, exercițiile intră exact ca în fișă{output === 'pdf' ? ' — fără AI și fără cost' : ''}.</>}
      </p>

      {bankErr && <div style={{ fontSize: '.8rem', color: '#b71c1c', margin: '6px 0' }}>⚠️ {bankErr}</div>}
      {listErr && <div style={{ fontSize: '.8rem', color: '#b71c1c', margin: '6px 0' }}>⚠️ {listErr}</div>}

      <div style={lbl}>Fișele clasei{sheets ? ` (${sheets.length})` : ''}</div>
      {!sheets ? (
        <div style={{ padding: 12, textAlign: 'center' }}><div className="spinner" /></div>
      ) : !sheets.length ? (
        <div style={{ fontSize: '.8rem', color: 'var(--text-muted)' }}>Clasa aceasta nu are încă fișe PDF pe site.</div>
      ) : (
        <>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center', marginBottom: 8 }}>
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Caută fișa după titlu…"
              style={{ flex: '1 1 200px', border: '1px solid var(--border)', borderRadius: 8, padding: '7px 10px', fontSize: '.82rem' }} />
            {isAdmin && necitite > 0 && (
              <button type="button" className="btn btn-sm btn-outline" onClick={citesteToate} disabled={!!readAll || !!busy}
                title="O singură dată, din contul platformei — apoi toți profesorii aleg din bancă fără cost">
                {readAll ? `📖 Citesc fișa ${readAll.i} din ${readAll.n}…` : `📖 Admin: citește toate fișele necitite (${necitite})`}
              </button>
            )}
          </div>
          <div style={{ display: 'grid', gap: 6, maxHeight: 560, overflowY: 'auto', paddingRight: 2 }}>
            {filtrate.map((s) => {
              const b = banks[s.id];
              const deschis = !!open[s.id];
              const bifate = (b?.groups || []).filter((g) => (counts[keyOf(s.id, g.key)] || 0) > 0).length;
              return (
                <div key={s.id} style={{ background: '#fff', border: `1px solid ${bifate ? 'var(--navy)' : 'var(--border)'}`, borderRadius: 9 }}>
                  <button type="button" onClick={() => toggleSheet(s)} aria-expanded={deschis}
                    style={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: '2px 8px', width: '100%', background: 'none', border: 'none', padding: '8px 10px', cursor: 'pointer', textAlign: 'left', fontFamily: 'inherit' }}>
                    <span aria-hidden="true" style={{ fontSize: '.7rem', color: 'var(--gold)', transform: deschis ? 'rotate(90deg)' : 'none', transition: 'transform .15s' }}>▶</span>
                    <span style={{ flex: '1 1 180px', minWidth: 0, fontSize: '.83rem', fontWeight: 600, color: 'var(--navy)' }}>{s.title}{s.isFree === false ? ' ⭐' : ''}</span>
                    <span style={{ fontSize: '.72rem', color: 'var(--text-muted)', marginLeft: 'auto', textAlign: 'right' }}>
                      {bifate ? <strong style={{ color: 'var(--navy)' }}>{bifate} bifate · </strong> : null}
                      {s.bank
                        ? <>{plural(s.bank.groups.length, 'grupă', 'grupe')} · {plural(s.bank.exercises, 'exercițiu', 'exerciții')}{s.bank.status === 'partial' ? ' · ⚠️ citită parțial' : ''}</>
                        : s.reading ? '⏳ se citește…' : '📖 necitită'}
                    </span>
                  </button>
                  {deschis && (
                    <div style={{ padding: '0 10px 10px 18px', minWidth: 0 }}>
                      {(!b || b.loading) && (
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: '.79rem', color: 'var(--text-muted)', padding: '6px 0' }}>
                          <div className="spinner" style={{ width: 16, height: 16 }} />
                          {b?.reading
                            ? 'Fișa o citește chiar acum alt profesor — revin singur cu nivelele și tipurile ei…'
                            : s.bank ? 'Încarc nivelele și tipurile fișei…' : 'AI-ul citește fișa — o singură dată, pentru toți profesorii (1–3 minute)…'}
                        </div>
                      )}
                      {b?.error && (
                        <div style={{ fontSize: '.79rem', color: '#b71c1c', padding: '6px 0' }}>
                          ⚠️ {b.error}{' '}
                          <button type="button" className="btn btn-sm btn-outline" onClick={() => loadBank(s)}>Încearcă din nou</button>
                        </div>
                      )}
                      {b?.groups && (
                        <>
                          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center', margin: '2px 0 6px' }}>
                            <button type="button" className="btn btn-sm btn-outline" onClick={() => setAll(s, true)}>☑ Bifează toate</button>
                            <button type="button" className="btn btn-sm btn-outline" onClick={() => setAll(s, false)}>☐ Debifează</button>
                            {isAdmin && (
                              <button type="button" className="btn btn-sm btn-outline" onClick={() => loadBank(s, { refresh: true })}
                                title="Admin: citește fișa din nou (de exemplu după o corectură a fișierului)">🔄 Citește din nou</button>
                            )}
                            {b.read?.lei ? <span style={{ fontSize: '.72rem', color: 'var(--text-muted)' }}>citită acum · {String(b.read.lei).replace('.', ',')} lei, din contul platformei</span> : null}
                            {b.status === 'partial' && <span style={{ fontSize: '.72rem', color: '#b26a00' }}>⚠️ câteva pagini n-au putut fi citite</span>}
                          </div>
                          {!b.groups.length && <div style={{ fontSize: '.79rem', color: 'var(--text-muted)' }}>Fișa nu are exerciții recunoscute.</div>}
                          <div style={{ display: 'grid', gap: 4 }}>
                            {b.groups.map((g) => {
                              const k = keyOf(s.id, g.key);
                              const c = counts[k] || 0;
                              const usable = usableExercises(g, withFigures).length;
                              const fig = (g.exercises || []).filter((e) => e.figure).length;
                              return (
                                <div key={g.key} style={{ border: '1px solid var(--border)', borderRadius: 8, padding: '5px 8px', background: c ? 'rgba(15,43,68,.05)' : '#fff' }}>
                                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                                    <label style={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: '2px 6px', flex: '1 1 200px', minWidth: 0, cursor: usable ? 'pointer' : 'default', fontSize: '.81rem', color: 'var(--navy)' }}>
                                      <input type="checkbox" checked={c > 0} disabled={!usable} onChange={() => toggleGroup(s, g)}
                                        aria-label={`${g.title} — bifează`} />
                                      <span style={{ fontWeight: 700, minWidth: 0, overflowWrap: 'anywhere' }}><MathInline text={g.title} /></span>
                                      <span style={{ fontSize: '.7rem', color: 'var(--text-muted)' }}>
                                        {KIND[g.kind] || ''} · {plural((g.exercises || []).length, 'exercițiu', 'exerciții')}{fig ? ` · ${fig} cu figură` : ''}
                                      </span>
                                    </label>
                                    {c > 0 && (
                                      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: '.76rem', color: 'var(--navy)' }}>
                                        <input type="number" min={1} max={Math.max(1, usable)} value={c} onChange={(e) => setCount(s, g, e.target.value)}
                                          aria-label={`${g.title} — exerciții în fiecare test`} style={numInput} />
                                        / test
                                      </span>
                                    )}
                                    <button type="button" onClick={() => setPreview(preview === k ? null : k)}
                                      style={{ background: 'none', border: 'none', color: 'var(--text-muted)', fontSize: '.74rem', cursor: 'pointer', padding: 0 }}>
                                      {preview === k ? '▾ ascunde' : '▸ exercițiile'}
                                    </button>
                                  </div>
                                  {g.instruction && (
                                    <div style={{ display: 'flex', gap: 5, alignItems: 'baseline', fontSize: '.74rem', color: 'var(--text-muted)', marginTop: 2 }}>
                                      <span style={{ flexShrink: 0 }}>Cerința:</span>
                                      <span style={{ minWidth: 0 }}><MathInline text={g.instruction} /></span>
                                    </div>
                                  )}
                                  {preview === k && (
                                    <div style={{ margin: '6px 0 2px', maxHeight: 240, overflowY: 'auto', fontSize: '.79rem', color: 'var(--text)', display: 'grid', gap: 3 }}>
                                      {(g.exercises || []).slice(0, 80).map((e, i) => (
                                        <div key={i} style={{ display: 'flex', gap: 6, alignItems: 'baseline', opacity: e.figure && !withFigures ? 0.55 : 1 }}>
                                          <span style={{ color: 'var(--text-muted)', minWidth: 26, textAlign: 'right', flexShrink: 0 }}>{e.n || i + 1}{/[).]$/.test(e.n || '') ? '' : '.'}</span>
                                          <span style={{ minWidth: 0, flex: 1, overflowWrap: 'anywhere' }}><MathInline text={e.text} /></span>
                                          {e.figure ? <span style={{ fontSize: '.7rem', color: '#b26a00', flexShrink: 0 }}>cu figură</span> : null}
                                        </div>
                                      ))}
                                      {(g.exercises || []).length > 80 && <div style={{ color: 'var(--text-muted)', paddingLeft: 32 }}>… încă {(g.exercises || []).length - 80}</div>}
                                    </div>
                                  )}
                                </div>
                              );
                            })}
                          </div>
                        </>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
            {!filtrate.length && <div style={{ fontSize: '.8rem', color: 'var(--text-muted)' }}>Nicio fișă nu se potrivește căutării.</div>}
          </div>
        </>
      )}

      {/* Compoziția unui test */}
      {picks.length > 0 && (
        <div style={{ marginTop: 10, background: '#fff', border: '1px solid var(--border)', borderRadius: 9, padding: '8px 10px', fontSize: '.79rem', color: 'var(--navy)', lineHeight: 1.55 }}>
          🧮 Fiecare test: <strong>{plural(perTest, 'exercițiu', 'exerciții')}</strong> — {compositionLabel(picks, withFigures)}.
          {' '}{maxDist >= n
            ? <span style={{ color: '#1e7e34' }}>Ajung pentru {n} {n === 1 ? 'test' : 'teste'} fără nicio repetare (până la {maxDist}).</span>
            : dataMode === 'modify'
              ? <span style={{ color: 'var(--text-muted)' }}>Fără repetări ies {maxDist} {maxDist === 1 ? 'test' : 'teste'}; la {n}, unele exerciții-sursă se repetă de la un test la altul — dar AI-ul le schimbă numerele și notațiile, deci testele rămân diferite.</span>
              : <span style={{ color: '#b26a00' }}>Fără repetări ies {maxDist} {maxDist === 1 ? 'test' : 'teste'}; la {n}, unele exerciții se repetă de la un test la altul (niciodată în același test). Bifează mai multe grupe sau ia mai puține exerciții din fiecare.</span>}
          {cuFigura > 0 && (
            <label style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 6, fontSize: '.76rem', color: 'var(--text-muted)', cursor: 'pointer' }}>
              <input type="checkbox" checked={withFigures} onChange={(e) => setWithFigures(e.target.checked)} />
              🖼 {plural(cuFigura, 'exercițiu', 'exerciții')} din grupele bifate {cuFigura === 1 ? 'are' : 'au'} nevoie de figura din fișă și {withFigures ? 'intră' : 'nu intră'} în teste — figura nu se copiază. Include-le totuși
            </label>
          )}
        </div>
      )}

      {/* Formatul și opțiunile testelor */}
      <div style={lbl}>Formatul testelor</div>
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
        <button type="button" style={chip(output === 'pdf')} onClick={() => setOutput('pdf')} disabled={!!busy}>📄 PDF — de tipărit (și în testul pe grupă PDF)</button>
        <button type="button" style={chip(output === 'interactive')} onClick={() => setOutput('interactive')} disabled={!!busy}>🧩 Interactiv — se rezolvă în site, cu scor</button>
      </div>
      {output === 'interactive' && (
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 8, alignItems: 'center' }}>
          <span style={{ fontSize: '.76rem', fontWeight: 700, color: 'var(--navy)' }}>Itemii:</span>
          {[['mixt', '🔀 Mixt'], ['grila', '🔘 Doar grilă'], ['redactare', '✍️ Cu redactarea răspunsului']].map(([id, l]) => (
            <button key={id} type="button" style={chip(qtype === id)} onClick={() => setQtype(id)} disabled={!!busy}>{l}</button>
          ))}
        </div>
      )}
      <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap', alignItems: 'center', marginTop: 10, fontSize: '.78rem', color: 'var(--navy)', fontWeight: 600 }}>
        <label style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
          ⏳ Timp de lucru
          <input type="number" min={5} max={180} value={durationMin} onChange={(e) => setDurationMin(Math.max(5, Math.min(180, parseInt(e.target.value, 10) || 50)))} style={numInput} /> min
        </label>
        <label style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
          Puncte din oficiu
          <input type="number" min={0} max={30} value={oficiu} onChange={(e) => setOficiu(Math.max(0, Math.min(30, parseInt(e.target.value, 10) || 0)))} style={numInput} />
        </label>
      </div>
      {output === 'pdf' && <OptiuneSpatiuLucru value={workSpace} onChange={setWorkSpace} compact style={{ marginTop: 10 }} />}

      <div style={{ fontSize: '.76rem', color: 'var(--text-muted)', marginTop: 10, lineHeight: 1.5 }}>
        {aiNeeded
          ? <>✨ Un apel AI pe test{dataMode === 'modify' ? ' (alte numere și notații, recalculate, cu barem)' : ' (exercițiile rămân exact ca în fișă; AI-ul le adaugă răspunsurile și variantele de grilă)'}: ~{fmtEstimare(crediteTest)} pe test → ~{fmtEstimare(crediteTest * n)} pentru {n} {n === 1 ? 'test' : 'teste'}.</>
          : <>✅ Fără AI și fără cost: testele se compun din banca fișei, cu exercițiile exact ca în fișă (fără barem).</>}
      </div>

      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center', marginTop: 10 }}>
        <button type="button" className="btn btn-primary" onClick={genereaza} disabled={!!busy || !!problema}>
          {busy ? 'Se generează…' : `${aiNeeded ? '✨' : '📚'} Generează ${n} ${n === 1 ? 'test' : 'teste'} ${output === 'pdf' ? 'PDF' : 'interactive'}${dataMode === 'modify' ? ' cu numerele schimbate' : ''}`}
        </button>
        {rezultat?.gata && !busy && <button type="button" className="btn btn-outline btn-sm" onClick={genereaza} disabled={!!problema}>🔄 Generează alt set</button>}
      </div>
      {problema && picks.length > 0 && <div style={{ fontSize: '.78rem', color: '#b26a00', marginTop: 6 }}>{problema}</div>}
      {busy && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 10, fontSize: '.8rem', color: 'var(--text-muted)' }}>
          <div className="spinner" style={{ width: 16, height: 16 }} /> {busy}
        </div>
      )}
      {err && <div style={{ marginTop: 10, fontSize: '.82rem', color: '#b71c1c' }}>⚠️ {err}</div>}

      {rezultat && rezultat.kind === 'exam' && (
        <ListaTesteExam rezultat={rezultat} publish={publish} workSpace={workSpace}
          titlu={`${clasaLabel(category)}${rezultat.cost ? ` · au costat ${fmtEstimare(rezultat.cost)}` : ''}`} />
      )}
      {rezultat && rezultat.kind === 'interactive' && rezultat.teste.length > 0 && (
        <TesteInteractive rezultat={rezultat} publish={publish} onOpen={(t) => navigate('/exercitiu-ai', { state: { html: renderQuiz(t.title, t.questions, t.meta), title: t.title } })} />
      )}
    </div>
  );
}

// ─── Testele interactive create (deschide · PDF · barem · tipărește toate) ──
function TesteInteractive({ rezultat, publish, onOpen }) {
  const [deschis, setDeschis] = useState(null);
  const teste = rezultat.teste;
  const caExam = (t) => quizToExam(t.title, t.questions, t.meta || {});
  const publicate = teste.filter((t) => t.publicId).length;
  const set = rezultat.set && !rezultat.set.error ? rezultat.set : null;
  return (
    <div style={{ marginTop: 12, background: 'rgba(39,174,96,.08)', border: '1px solid rgba(39,174,96,.35)', borderRadius: 10, padding: 12 }}>
      <div style={{ fontWeight: 700, color: '#1e7e34', fontSize: '.86rem', marginBottom: 4 }}>
        {rezultat.gata ? '✅' : '⏳'} {teste.length}{rezultat.gata ? '' : ` din ${rezultat.total}`} {teste.length === 1 ? 'test interactiv' : (rezultat.gata ? 'teste interactive diferite' : 'variante')}
        {rezultat.cost ? <span style={{ fontWeight: 600, color: 'var(--text-muted)' }}> · au costat {fmtEstimare(rezultat.cost)}</span> : null}
      </div>
      {rezultat.gata && (
        <SetSalvat set={rezultat.set} count={teste.length} publish={publish}>
          {set && set.exam && (
            <>
              <button type="button" className="btn btn-sm btn-primary" onClick={() => printExam(set.exam)}>📄 PDF — toate cele {teste.length} variante</button>
              <button type="button" className="btn btn-sm btn-outline" onClick={() => printExam(set.exam, { withSolutions: true })}>📝 Baremul tuturor variantelor</button>
            </>
          )}
        </SetSalvat>
      )}
      {!set && (
        <p style={{ fontSize: '.77rem', color: 'var(--text-muted)', margin: '0 0 8px', lineHeight: 1.5 }}>
          Salvate în „Testele și exercițiile mele"{publish ? <> · publicate în „Biblioteca utilizatorilor": {publicate} din {teste.length}</> : ''}.
        </p>
      )}
      {set && (
        <p style={{ fontSize: '.77rem', color: 'var(--text-muted)', margin: '0 0 8px', lineHeight: 1.5 }}>
          Variantele interactive se rezolvă în site — le dai elevilor cu „👥 Folosește-le în testul interactiv pe grupă" (mai jos), câte una fiecăruia; le găsești și în „Testele și exercițiile mele", la PDF-ul setului → „▸ Variantele".
        </p>
      )}
      {rezultat.intrerupt && <div style={{ fontSize: '.77rem', color: '#b26a00', marginBottom: 8 }}>⚠️ Generarea s-a oprit înainte de capăt — au rămas {teste.length} teste, folosibile.</div>}
      {rezultat.gata && !set && teste.length > 1 && (
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 8 }}>
          <button type="button" className="btn btn-outline btn-sm" onClick={() => printExams(teste.map(caExam), { title: `${teste.length} teste` })}>🖨 Tipărește toate testele ({teste.length})</button>
          <button type="button" className="btn btn-outline btn-sm" onClick={() => printExams(teste.map(caExam), { withSolutions: true, title: `Barem · ${teste.length} teste` })}>📝 Toate baremele</button>
        </div>
      )}
      <div style={{ display: 'grid', gap: 6, maxHeight: 360, overflowY: 'auto' }}>
        {teste.map((t, i) => (
          <div key={t.privateId || i} style={{ background: '#fff', border: '1px solid var(--border)', borderRadius: 8, padding: '7px 10px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
              <div style={{ flex: '1 1 220px', minWidth: 0 }}>
                <div style={{ fontWeight: 600, color: 'var(--navy)', fontSize: '.83rem' }}>🧩 {t.title}</div>
                <div style={{ fontSize: '.72rem', color: 'var(--text-muted)' }}>
                  {t.questions.length} itemi
                  {t.repeats ? <span style={{ color: '#b26a00' }}> · {t.repeats} {t.repeats === 1 ? 'exercițiu repetat' : 'exerciții repetate'}</span> : null}
                  {t.publicId ? ' · 🏛️ în bibliotecă' : ''}
                  {t.publishError ? <span style={{ color: '#b26a00' }}> · nepublicat ({t.publishError})</span> : null}
                </div>
              </div>
              <div style={{ display: 'flex', gap: 5, flexWrap: 'wrap' }}>
                <button type="button" className="btn btn-sm btn-primary" onClick={() => onOpen(t)}>🗗 Deschide</button>
                <button type="button" className="btn btn-sm btn-outline" onClick={() => printExam(caExam(t))}>📄 PDF</button>
                <button type="button" className="btn btn-sm btn-outline" onClick={() => printExam(caExam(t), { withSolutions: true })}>📝 Barem</button>
                {t.verification && (
                  <button type="button" className="btn btn-sm btn-outline" onClick={() => setDeschis(deschis === i ? null : i)}>{deschis === i ? '▾ Verificarea' : '▸ Verificarea'}</button>
                )}
              </div>
            </div>
            {deschis === i && t.verification && <VerificationNote report={t.verification} style={{ marginTop: 6, marginBottom: 0 }} />}
          </div>
        ))}
      </div>
    </div>
  );
}
