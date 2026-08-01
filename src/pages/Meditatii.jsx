// =====================================================================
// src/pages/Meditatii.jsx — „Meditații cu Profesorul Virtual"
// Meditații reale cu un profesor AI cu memorie pedagogică:
//   înscriere (clasă + examen) → test inițial adaptiv → plan personalizat
//   → teorie → exerciții → analiza greșelilor → remediere („încă 10 la fel")
//   → teme → repetiție inteligentă (1 zi / 7 / 30) → simulări → predicție.
// Materialele din site au prioritate; generarea intervine în completare.
// =====================================================================
import { useState, useEffect, useRef, useCallback } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { aiClient } from '../lib/aiClient';
import { ChatPanel, MathText } from '../components/AITutor';
import EinsteinIcon from '../components/EinsteinIcon';
import ExamGenerator from '../components/ExamGenerator';
import { openPrintDocument } from '../lib/examPrint';

const card = { background: '#fff', border: '1px solid var(--border)', borderRadius: 'var(--radius-lg)', padding: 20, marginBottom: 18 };
const inp = { border: '1px solid var(--border)', borderRadius: 8, padding: '9px 11px', fontSize: '.9rem', fontFamily: 'var(--font-body)' };
const chip = (bg, color) => ({ display: 'inline-flex', alignItems: 'center', gap: 5, background: bg, color, borderRadius: 20, padding: '4px 12px', fontSize: '.78rem', fontWeight: 700 });

const ERROR_LABELS = {
  calcul: '🔢 Greșeală de calcul', formula: '📐 Formulă aplicată greșit',
  concept: '💭 Confuzie între concepte', regula: '📏 Regulă uitată',
  neatentie: '👀 Neatenție', necunoscut: '❓ De analizat',
};
const STATUS_LABELS = {
  de_parcurs: { label: 'De parcurs', bg: '#eef1f6', color: '#5a6675' },
  teorie: { label: 'Teoria citită', bg: 'rgba(232,185,49,.15)', color: '#8a6d1a' },
  in_lucru: { label: 'În lucru', bg: 'rgba(52,152,219,.12)', color: '#1f6dab' },
  finalizat: { label: '✓ Finalizat', bg: 'rgba(39,174,96,.12)', color: '#1e7e34' },
};
const EXAM_LABELS = {
  'evaluare-nationala': 'Evaluarea Națională',
  'bac-mate-info': 'BAC Mate-Info', 'bac-stiinte': 'BAC Științele Naturii', 'bac-tehnologic': 'BAC Tehnologic',
};
const fmtMin = (sec) => {
  const m = Math.round((sec || 0) / 60);
  return m < 60 ? `${m} min` : `${Math.floor(m / 60)}h ${m % 60}min`;
};

// lecția (markdown simplu) → HTML pentru documentul tipăribil
function lessonHtml(title, text) {
  const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const body = esc(text)
    .replace(/^## (.+)$/gm, '<h2 style="font-size:17px;color:#0f2b44;border-bottom:1px solid #ddd;padding-bottom:4px;margin:20px 0 8px">$1</h2>')
    .replace(/^### (.+)$/gm, '<h3 style="font-size:15px;color:#0f2b44;margin:14px 0 6px">$1</h3>')
    .replace(/\*\*(.+?)\*\*/g, '<b>$1</b>')
    .replace(/^[-•] (.+)$/gm, '<div style="margin:3px 0 3px 18px">• $1</div>')
    .split(/\n{2,}/).map((p) => `<p style="margin:.5em 0;line-height:1.65">${p.replace(/\n/g, '<br/>')}</p>`).join('');
  return `<h1 class="exam-title">${esc(title)}</h1><div class="exam-sub">Lecție pregătită de Profesorul Virtual · ExamenMate</div><div class="rules">Meditații cu Profesorul Virtual</div>${body}`;
}

// ─── Rulează un set de întrebări (evaluare/exerciții/temă/recapitulare/simulare)
function QuizRunner({ title, subtitle, questions, submitLabel = '✓ Trimite spre corectare', onSubmit, onClose, onAskTeacher }) {
  const [answers, setAnswers] = useState(() => questions.map(() => null));
  const [result, setResult] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const startRef = useRef(Date.now());

  const answered = answers.filter((a) => a !== null && String(a).trim() !== '').length;

  async function submit() {
    setLoading(true); setError(null);
    try {
      const durationSec = Math.round((Date.now() - startRef.current) / 1000);
      const r = await onSubmit(answers, durationSec);
      setResult(r);
      window.scrollTo({ top: 0, behavior: 'smooth' });
    } catch (e) { setError(e.message); }
    finally { setLoading(false); }
  }

  return (
    <div>
      <div style={{ ...card, display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
        <div>
          <div style={{ fontWeight: 800, color: 'var(--navy)', fontSize: '1.05rem' }}>{title}</div>
          {subtitle && <div style={{ fontSize: '.82rem', color: 'var(--text-muted)', marginTop: 2 }}>{subtitle}</div>}
        </div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          {!result && <span style={{ fontSize: '.82rem', color: 'var(--text-muted)' }}>{answered}/{questions.length} completate</span>}
          <button className="btn btn-outline btn-sm" onClick={() => onClose(!!result)}>✕ {result ? 'Închide' : 'Renunț'}</button>
        </div>
      </div>

      {result && (
        <div style={{ ...card, background: result.pct >= 70 ? 'rgba(39,174,96,.08)' : 'rgba(232,185,49,.1)', borderColor: result.pct >= 70 ? 'rgba(39,174,96,.35)' : 'var(--gold)' }}>
          <div style={{ fontSize: '1.15rem', fontWeight: 800, color: 'var(--navy)', marginBottom: 6 }}>
            {result.pct >= 90 ? '🎉' : result.pct >= 70 ? '👏' : result.pct >= 50 ? '💪' : '🤝'} Rezultat: {result.score}/{result.maxScore} ({result.pct}%)
            {result.grade != null && <span> · Nota {result.grade}</span>}
          </div>
          {result.feedback && <div style={{ fontSize: '.92rem', color: 'var(--text)', marginBottom: 4 }}>{result.feedback}</div>}
          {result.nextStep && <div style={{ fontSize: '.88rem', color: 'var(--text)' }}>👉 {result.nextStep.label}</div>}
          {result.chapterDone && <div style={{ fontSize: '.88rem', color: '#1e7e34', fontWeight: 700, marginTop: 4 }}>🏁 Capitol finalizat! L-am programat pentru recapitulare (după 1 zi, 7 zile și 30 de zile).</div>}
          {result.reviewAdvanced && !result.reviewAdvanced.retry && <div style={{ fontSize: '.88rem', color: '#1e7e34', marginTop: 4 }}>🔁 Recapitulare reușită{result.reviewAdvanced.done ? ' — capitolul e bine fixat!' : ' — următoarea vine mai târziu.'}</div>}
          {result.reviewAdvanced?.retry && <div style={{ fontSize: '.88rem', color: '#8a6d1a', marginTop: 4 }}>🔁 Mai reluăm o dată capitolul — recapitularea revine mâine.</div>}
          {result.streakDays > 1 && <div style={{ fontSize: '.85rem', color: 'var(--text-muted)', marginTop: 4 }}>🔥 Serie de studiu: {result.streakDays} zile consecutive!</div>}
          {result.levelInfo && <div style={{ fontSize: '.9rem', marginTop: 6 }}>{result.levelInfo}</div>}
        </div>
      )}

      {error && <div style={{ ...card, background: '#fdecea', color: '#b71c1c', borderColor: '#f5c6cb' }}>⚠️ {error}</div>}

      {questions.map((q, i) => {
        const r = result?.results?.[i];
        return (
          <div key={i} style={{ ...card, borderColor: r ? (r.correct ? 'rgba(39,174,96,.4)' : 'rgba(231,76,60,.35)') : 'var(--border)' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, marginBottom: 10 }}>
              <div style={{ fontSize: '1rem', color: 'var(--navy)', lineHeight: 1.6, flex: 1 }}>
                <strong>{i + 1}.</strong> <MathText text={q.statement} />
              </div>
              {r && <span style={{ fontSize: '1.2rem' }}>{r.correct ? '✅' : '❌'}</span>}
            </div>

            {q.options ? (
              <div>
                {q.options.map((o, oi) => {
                  const chosen = answers[i] === oi;
                  const isCorrect = r && Number(r.answer) === oi;
                  return (
                    <label key={oi} style={{
                      display: 'flex', alignItems: 'center', gap: 8, padding: '8px 10px', borderRadius: 8, marginBottom: 6, cursor: result ? 'default' : 'pointer',
                      border: `1px solid ${isCorrect ? 'rgba(39,174,96,.5)' : chosen && r && !r.correct ? 'rgba(231,76,60,.45)' : 'var(--border)'}`,
                      background: isCorrect ? 'rgba(39,174,96,.08)' : chosen ? 'rgba(232,185,49,.12)' : '#fff',
                    }}>
                      <input type="radio" disabled={!!result} checked={chosen} onChange={() => setAnswers((a) => a.map((v, k) => (k === i ? oi : v)))} />
                      <strong style={{ color: 'var(--navy)' }}>{String.fromCharCode(65 + oi)})</strong>
                      <span style={{ flex: 1 }}><MathText text={o} /></span>
                    </label>
                  );
                })}
              </div>
            ) : (
              <input value={answers[i] ?? ''} disabled={!!result}
                onChange={(e) => setAnswers((a) => a.map((v, k) => (k === i ? e.target.value : v)))}
                placeholder="Răspunsul tău" style={{ ...inp, width: '100%' }} />
            )}

            {r && !r.correct && (
              <div style={{ marginTop: 10, padding: '10px 12px', background: 'rgba(231,76,60,.06)', borderRadius: 10, fontSize: '.88rem' }}>
                {r.errorType && <div style={{ fontWeight: 700, color: '#c0392b', marginBottom: 4 }}>{ERROR_LABELS[r.errorType] || ''}</div>}
                {r.analysis && <div style={{ marginBottom: 6 }}><MathText text={r.analysis} /></div>}
                <div style={{ color: 'var(--text)' }}><strong>Răspunsul corect:</strong> <MathText text={q.options ? q.options[r.answer] : String(r.answer)} /></div>
              </div>
            )}
            {r && r.explanation && (
              <details style={{ marginTop: 8 }}>
                <summary style={{ cursor: 'pointer', fontWeight: 600, color: 'var(--navy)', fontSize: '.86rem' }}>Vezi rezolvarea pas cu pas</summary>
                <div style={{ marginTop: 6, fontSize: '.9rem', lineHeight: 1.6 }}><MathText text={r.explanation} /></div>
              </details>
            )}
            {onAskTeacher && !result && (
              <button onClick={() => onAskTeacher(q, i)} style={{ marginTop: 10, background: 'none', border: '1px dashed var(--gold)', color: 'var(--gold-dim)', borderRadius: 8, padding: '5px 11px', fontSize: '.8rem', fontWeight: 600, cursor: 'pointer' }}>
                🎓 Nu înțeleg — întreabă profesorul
              </button>
            )}
          </div>
        );
      })}

      {!result ? (
        <button className="btn btn-primary btn-lg" onClick={submit} disabled={loading || answered === 0}>
          {loading ? 'Profesorul corectează...' : submitLabel}
        </button>
      ) : (
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <button className="btn btn-primary" onClick={() => onClose(true)}>✓ Am înțeles — continuăm</button>
          {(result.mistakeIds || []).length > 0 && result.onRemediate && (
            <button className="btn btn-outline" onClick={() => result.onRemediate(result.mistakeIds[0])}>🔁 Încă 10 exerciții ca acelea greșite</button>
          )}
        </div>
      )}
    </div>
  );
}

// ─── Înscrierea: clasa + examenul ────────────────────────────────────────────
function SetupWizard({ onStart, starting, error }) {
  const [grade, setGrade] = useState(8);
  const [exam, setExam] = useState('');
  const examOptions = grade >= 9
    ? [['', 'Fără examen (materia clasei)'], ['bac-mate-info', 'Bacalaureat Mate-Info'], ['bac-stiinte', 'Bacalaureat Științele Naturii'], ['bac-tehnologic', 'Bacalaureat Tehnologic']]
    : grade >= 7
    ? [['', 'Fără examen (materia clasei)'], ['evaluare-nationala', 'Evaluarea Națională']]
    : [['', 'Materia clasei']];
  useEffect(() => { setExam(grade === 8 ? 'evaluare-nationala' : ''); }, [grade]);

  return (
    <div style={{ ...card, maxWidth: 640 }}>
      <h3 style={{ fontFamily: 'var(--font-display)', color: 'var(--navy)', marginBottom: 6 }}>Hai să ne cunoaștem! 👋</h3>
      <p style={{ fontSize: '.9rem', color: 'var(--text-light)', marginBottom: 16 }}>
        Spune-mi în ce clasă ești și pentru ce te pregătești. Îți dau apoi un <strong>scurt test inițial</strong> ca să văd
        exact ce știi și unde te pot ajuta — apoi îți construiesc <strong>planul tău de învățare</strong>.
      </p>
      <div style={{ marginBottom: 14 }}>
        <div style={{ fontSize: '.85rem', fontWeight: 700, color: 'var(--navy)', marginBottom: 8 }}>Clasa</div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          {[5, 6, 7, 8, 9, 10, 11, 12].map((g) => (
            <button key={g} onClick={() => setGrade(g)} style={{
              width: 46, height: 46, borderRadius: 12, fontWeight: 800, fontSize: '1rem', cursor: 'pointer',
              border: `2px solid ${grade === g ? 'var(--gold)' : 'var(--border)'}`,
              background: grade === g ? 'var(--gold)' : '#fff', color: 'var(--navy)',
            }}>{g}</button>
          ))}
        </div>
      </div>
      <div style={{ marginBottom: 18 }}>
        <div style={{ fontSize: '.85rem', fontWeight: 700, color: 'var(--navy)', marginBottom: 8 }}>Mă pregătesc pentru</div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          {examOptions.map(([val, label]) => (
            <label key={val} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '9px 12px', border: `1px solid ${exam === val ? 'var(--gold)' : 'var(--border)'}`, borderRadius: 10, cursor: 'pointer', background: exam === val ? 'rgba(232,185,49,.1)' : '#fff', fontSize: '.9rem' }}>
              <input type="radio" checked={exam === val} onChange={() => setExam(val)} /> {label}
            </label>
          ))}
        </div>
      </div>
      {error && <div style={{ padding: 10, background: '#fdecea', color: '#b71c1c', borderRadius: 8, fontSize: '.85rem', marginBottom: 10 }}>⚠️ {error}</div>}
      <button className="btn btn-primary btn-lg" disabled={starting} onClick={() => onStart({ grade, examTarget: exam || null })}>
        {starting ? 'Pregătesc testul inițial... (~30s)' : '🚀 Începe cu testul inițial'}
      </button>
      <p style={{ fontSize: '.76rem', color: 'var(--text-muted)', marginTop: 10 }}>
        Testul are ~12 întrebări, de la ușor la greu, și acoperă și materia anilor anteriori — ca să găsesc eventualele lacune. Nu e o notă, e busola noastră. 🧭
      </p>
    </div>
  );
}

// ═════════════════════════════════════════════════════════════════════════════
export default function Meditatii() {
  const { user, loading, isPremium, isTeacher, isParent } = useAuth();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const [st, setSt] = useState(null);          // starea de pe server
  const [stError, setStError] = useState(null);
  const [tab, setTab] = useState(searchParams.get('tab') || 'azi');
  const [quiz, setQuiz] = useState(null);      // { kind, sessionId|homeworkId, title, subtitle, questions }
  const [lessonView, setLessonView] = useState(null); // { chapter, lesson, materials }
  const [busy, setBusy] = useState(null);      // eticheta acțiunii în curs
  const [actionError, setActionError] = useState(null);
  const [chatOpen, setChatOpen] = useState(false);
  const [autoPrompt, setAutoPrompt] = useState(null);
  const [chatCtxText, setChatCtxText] = useState('');

  const refresh = useCallback(async () => {
    try { setSt(await aiClient.meditatii({ action: 'state' })); setStError(null); }
    catch (e) { setStError(e.message); }
  }, []);
  useEffect(() => { if (user) refresh(); }, [user, refresh]);

  const category = st?.profile
    ? (st.profile.examTarget === 'evaluare-nationala' ? 'evaluare-nationala'
      : st.profile.examTarget ? 'bacalaureat' : `clasa-${st.profile.grade}`)
    : null;
  const chatContext = { meditatii: true, category, ...(chatCtxText ? { exerciseText: chatCtxText } : {}) };

  function askTeacher(q) {
    setChatCtxText(q?.statement || '');
    setChatOpen(true);
    if (q) setAutoPrompt({ id: Date.now(), text: 'Nu înțeleg acest exercițiu. Dă-mi un indiciu, fără să-mi spui răspunsul.', mode: 'hint' });
  }

  async function run(label, fn) {
    setBusy(label); setActionError(null);
    try { await fn(); }
    catch (e) { setActionError(e.message); }
    finally { setBusy(null); }
  }

  // ── acțiunile principale ──
  const startSetup = ({ grade, examTarget }) => run('setup', async () => {
    const r = await aiClient.meditatii({ action: 'setup', grade, examTarget });
    setQuiz({
      kind: 'evaluare', sessionId: r.sessionId, questions: r.questions,
      title: '🧭 Testul inițial', subtitle: 'Fără stres: îl folosesc doar ca să-ți construiesc planul potrivit ție.',
    });
  });

  const openLesson = (chapterId) => run('lesson', async () => {
    const r = await aiClient.meditatii({ action: 'lesson', chapterId });
    setLessonView(r); setQuiz(null);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  });

  const startExercises = (chapterId, difficulty = null) => run('exercises', async () => {
    const r = await aiClient.meditatii({ action: 'exercises', chapterId, difficulty });
    setLessonView(null);
    setQuiz({
      kind: 'exercitii', sessionId: r.sessionId, questions: r.questions,
      title: `✍️ Exerciții · ${r.chapter.title}`, subtitle: `Dificultate: ${r.difficulty}. Rezolvă în ritmul tău — la final îți explic tot.`,
      siteExercises: r.siteExercises,
    });
    window.scrollTo({ top: 0, behavior: 'smooth' });
  });

  const startRemediation = (mistakeId) => run('remediation', async () => {
    const r = await aiClient.meditatii({ action: 'remediation', mistakeId });
    setQuiz({
      kind: 'remediere', sessionId: r.sessionId, questions: r.questions,
      title: '🔁 Exerciții de remediere (același tip)', subtitle: 'Fixăm exact procedeul la care ai greșit — 10 exerciții de același fel.',
    });
    window.scrollTo({ top: 0, behavior: 'smooth' });
  });

  const startReview = (reviewId, chapterTitle) => run('review', async () => {
    const r = await aiClient.meditatii({ action: 'review_start', reviewId });
    setQuiz({
      kind: 'recapitulare', sessionId: r.sessionId, questions: r.questions,
      title: `🔁 Recapitulare · ${r.chapterTitle || chapterTitle}`, subtitle: 'Scurt și la obiect — ca să nu uiți materia.',
    });
    window.scrollTo({ top: 0, behavior: 'smooth' });
  });

  const startSimulare = () => run('simulare', async () => {
    const r = await aiClient.meditatii({ action: 'simulare' });
    setQuiz({
      kind: 'simulare', sessionId: r.sessionId, questions: r.questions,
      title: `🎯 Simulare interactivă · ${EXAM_LABELS[r.examType] || r.examType}`, subtitle: 'Construită după modelul subiectelor din site, cu punctele tale slabe incluse.',
    });
    window.scrollTo({ top: 0, behavior: 'smooth' });
  });

  const askHomework = () => run('homework', async () => {
    const r = await aiClient.meditatii({ action: 'homework_assign' });
    await refresh();
    if (r.skipped) setActionError(r.skipped === 'are deja teme nefăcute' ? 'Ai deja teme nefăcute — rezolvă-le întâi pe acelea. 😊' : 'Nu am găsit acum un material potrivit — mai încearcă după ce avansezi în plan.');
    else setTab('teme');
  });

  const openHomework = (hw) => run('homework', async () => {
    const r = await aiClient.meditatii({ action: 'homework_start', id: hw.id });
    if (r.kind === 'content') { navigate(r.url); return; }
    setQuiz({
      kind: 'tema', homeworkId: r.homeworkId, questions: r.questions,
      title: `📚 ${r.title}`, subtitle: 'Tema ta de la Profesorul Virtual. O corectez, o notez și îți explic greșelile.',
    });
    window.scrollTo({ top: 0, behavior: 'smooth' });
  });

  const setStyle = (style) => run('style', async () => {
    await aiClient.meditatii({ action: 'set_style', style });
    await refresh();
  });

  // trimiterea unui set → acțiunea corectă pe server
  async function submitQuiz(answers, durationSec) {
    let r;
    if (quiz.kind === 'evaluare') {
      r = await aiClient.meditatii({ action: 'assessment_submit', sessionId: quiz.sessionId, answers, durationSec });
      r.levelInfo = `🧭 Nivelul tău: ${r.level === 'incepator' ? 'începător — pornim de la bază, pas cu pas' : r.level === 'avansat' ? 'avansat — mergem pe exerciții serioase' : 'mediu — consolidăm și creștem'}. ${r.gaps?.length ? `Am găsit lacune la: ${r.gaps.map((g) => g.title).join('; ')} — le-am pus primele în plan.` : 'Nu am găsit lacune mari — bravo!'}`;
      r.pct = r.pct ?? Math.round((r.score / Math.max(1, r.maxScore)) * 100);
    } else if (quiz.kind === 'tema') {
      r = await aiClient.meditatii({ action: 'homework_submit', id: quiz.homeworkId, answers, durationSec });
    } else {
      r = await aiClient.meditatii({ action: 'submit_set', sessionId: quiz.sessionId, answers, durationSec });
    }
    r.onRemediate = (mid) => startRemediation(mid);
    return r;
  }

  // ── stările speciale ──
  if (loading) return <div style={{ padding: 60, textAlign: 'center' }}><div className="spinner" /></div>;

  if (!user) {
    return (
      <div style={{ maxWidth: 'var(--container)', margin: '0 auto', padding: '32px 20px 60px' }}>
        <Hero />
        <div style={{ textAlign: 'center', padding: 50, background: '#f7f9fc', borderRadius: 'var(--radius-lg)' }}>
          <div style={{ fontSize: '3rem', marginBottom: 12 }}>🔒</div>
          <p style={{ color: 'var(--text-light)', marginBottom: 18 }}>Autentifică-te pentru meditații cu Profesorul Virtual.</p>
          <Link to="/autentificare" className="btn btn-primary">Autentificare</Link>
        </div>
      </div>
    );
  }

  if (isTeacher || isParent) {
    return (
      <div style={{ maxWidth: 'var(--container)', margin: '0 auto', padding: '32px 20px 60px' }}>
        <Hero />
        <div style={card}>
          <p style={{ fontSize: '.95rem', color: 'var(--text)', marginBottom: 10 }}>
            Meditațiile cu Profesorul Virtual sunt pentru <strong>conturile de elev</strong>: profesorul ține minte fiecare elev,
            îi face evaluarea inițială, planul de învățare, îi dă teme și recapitulări.
          </p>
          <p style={{ fontSize: '.9rem', color: 'var(--text-light)' }}>
            Ca {isTeacher ? 'profesor' : 'părinte'}, vezi progresul elevilor asociați (plan, timp de studiu, capitole, dificultăți și recomandări)
            în <Link to="/profil" style={{ color: 'var(--navy)', fontWeight: 700 }}>Contul meu → Raport AI</Link>.
          </p>
        </div>
      </div>
    );
  }

  const premium = st ? st.premium : isPremium;

  return (
    <div style={{ maxWidth: 'var(--container)', margin: '0 auto', padding: '32px 20px 60px' }}>
      <Hero profile={st?.profile} />

      {stError && <div style={{ ...card, background: '#fdecea', color: '#b71c1c', borderColor: '#f5c6cb' }}>⚠️ {stError}</div>}
      {!st && !stError && <div style={{ padding: 40, textAlign: 'center' }}><div className="spinner" /></div>}

      {st && !premium && (
        <div style={{ ...card, background: '#fff4e5', borderColor: 'var(--gold)' }}>
          <div style={{ fontWeight: 800, color: 'var(--navy)', fontSize: '1.05rem', marginBottom: 8 }}>🔒 Meditațiile fac parte din abonament</div>
          <p style={{ fontSize: '.92rem', color: 'var(--text)', marginBottom: 12 }}>
            Un meditator personal, disponibil oricând: <strong>test inițial</strong> care îți găsește lacunele, <strong>plan de învățare</strong> cu obiective
            săptămânale, <strong>teorie + exerciții</strong> din materialele site-ului, <strong>analiza greșelilor</strong> („de ce ai greșit, nu doar că ai greșit"),
            <strong> teme corectate și notate</strong>, <strong>recapitulări programate</strong> ca să nu uiți materia și <strong>simulări de examen</strong> cu predicția notei.
          </p>
          <Link to="/preturi" className="btn btn-primary">Abonează-te pentru meditații →</Link>
        </div>
      )}

      {st && premium && st.needsSetup && !quiz && (
        <SetupWizard onStart={startSetup} starting={busy === 'setup'} error={actionError} />
      )}

      {/* Chat cu profesorul — sertar lateral */}
      {st && premium && !st.needsSetup && !chatOpen && (
        <button onClick={() => askTeacher(null)} style={{
          position: 'fixed', right: 18, bottom: 92, zIndex: 900,
          background: 'var(--navy)', color: '#fff', border: 'none', borderRadius: 24,
          padding: '10px 16px', fontWeight: 700, fontSize: '.85rem', cursor: 'pointer', boxShadow: '0 6px 18px rgba(0,0,0,.25)',
        }}>💬 Întreabă profesorul</button>
      )}
      {chatOpen && (
        <div style={{
          position: 'fixed', right: 12, bottom: 12, zIndex: 1200, width: 'min(400px, 94vw)', height: 'min(600px, 80vh)',
          background: '#fff', borderRadius: 16, border: '1px solid var(--border)', boxShadow: '0 16px 48px rgba(0,0,0,.3)',
          display: 'flex', flexDirection: 'column', overflow: 'hidden',
        }}>
          <div style={{ background: 'var(--navy)', color: '#fff', padding: '9px 14px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span style={{ fontWeight: 700, fontSize: '.9rem', display: 'flex', alignItems: 'center', gap: 6 }}><EinsteinIcon size={20} /> Meditatorul tău</span>
            <button onClick={() => { setChatOpen(false); setAutoPrompt(null); }} style={{ background: 'none', border: 'none', color: '#fff', fontSize: '1.1rem', cursor: 'pointer' }}>✕</button>
          </div>
          <div style={{ flex: 1, minHeight: 0 }}>
            <ChatPanel compact context={chatContext} autoPrompt={autoPrompt} onNavigate={() => setChatOpen(false)} />
          </div>
        </div>
      )}

      {/* Lecția deschisă */}
      {st && premium && lessonView && !quiz && (
        <LessonView data={lessonView} busyLabel={busy}
          onClose={() => setLessonView(null)}
          onExercises={() => startExercises(lessonView.chapter.id)} />
      )}

      {/* Un set în lucru (test/exerciții/temă/recapitulare/simulare) */}
      {st && premium && quiz && (
        <QuizRunner key={quiz.sessionId || quiz.homeworkId} title={quiz.title} subtitle={quiz.subtitle}
          questions={quiz.questions} onSubmit={submitQuiz} onAskTeacher={askTeacher}
          onClose={async (finished) => { setQuiz(null); setChatCtxText(''); if (finished) await refresh(); }} />
      )}
      {st && premium && quiz?.siteExercises?.length > 0 && (
        <div style={{ ...card, background: '#f7f9fc' }}>
          <div style={{ fontWeight: 700, color: 'var(--navy)', fontSize: '.9rem', marginBottom: 8 }}>🧩 Din materialele site-ului, la același capitol:</div>
          {quiz.siteExercises.map((s) => (
            <Link key={s.id} to={s.url} style={{ display: 'block', padding: '7px 10px', background: '#fff', border: '1px solid var(--border)', borderRadius: 8, marginBottom: 6, fontSize: '.86rem', color: 'var(--navy)', fontWeight: 600 }}>
              🧩 {s.title} →
            </Link>
          ))}
        </div>
      )}

      {/* Dashboardul cu taburi */}
      {st && premium && !st.needsSetup && !quiz && !lessonView && (
        <>
          <div style={{ display: 'flex', gap: 8, borderBottom: '2px solid var(--border)', marginBottom: 20, flexWrap: 'wrap' }}>
            {[
              ['azi', '🎓 Astăzi'], ['plan', `🗺️ Planul meu${st.plan?.progress != null ? ` · ${st.plan.progress}%` : ''}`],
              ['teme', `📚 Teme${st.pendingHomework ? ` (${st.pendingHomework})` : ''}`],
              ['recapitulari', `🔁 Recapitulări${st.dueReviews?.length ? ` (${st.dueReviews.length})` : ''}`],
              ['simulari', '🎯 Simulări'],
            ].map(([id, label]) => (
              <button key={id} onClick={() => setTab(id)} style={{
                background: 'none', border: 'none', padding: '10px 4px', marginBottom: -2,
                borderBottom: '3px solid', borderColor: tab === id ? 'var(--gold)' : 'transparent',
                color: tab === id ? 'var(--navy)' : 'var(--text-muted)', fontWeight: 700, fontSize: '.92rem', cursor: 'pointer',
              }}>{label}</button>
            ))}
          </div>

          {actionError && <div style={{ ...card, background: '#fff4e5', color: '#8a6d1a', borderColor: 'var(--gold)' }}>{actionError}</div>}

          {tab === 'azi' && <TodayTab st={st} busy={busy} onLesson={openLesson} onExercises={startExercises} onReview={startReview} onRemediation={startRemediation} onHomeworkTab={() => setTab('teme')} onStyle={setStyle} />}
          {tab === 'plan' && <PlanTab st={st} busy={busy} onLesson={openLesson} onExercises={startExercises} onReset={async () => { if (window.confirm('Sigur reluăm totul de la zero? Planul și evaluarea inițială se șterg.')) { await aiClient.meditatii({ action: 'reset' }); await refresh(); } }} />}
          {tab === 'teme' && <HomeworkTab st={st} busy={busy} onOpen={openHomework} onAsk={askHomework} />}
          {tab === 'recapitulari' && <ReviewsTab st={st} busy={busy} onReview={startReview} />}
          {tab === 'simulari' && <SimTab st={st} busy={busy} onSimulare={startSimulare} />}
        </>
      )}
    </div>
  );
}

function Hero({ profile }) {
  return (
    <div style={{ marginBottom: 22 }}>
      <h1 style={{ fontFamily: 'var(--font-display)', fontSize: 'clamp(1.7rem,4vw,2.4rem)', color: 'var(--navy)', marginBottom: 6, display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
        <EinsteinIcon size={46} /> Meditații cu Profesorul Virtual
      </h1>
      <p style={{ color: 'var(--text-light)', maxWidth: 680, marginBottom: profile ? 10 : 0 }}>
        Meditatorul tău personal, disponibil oricând: îți cunoaște nivelul, îți construiește planul, îți explică teoria,
        îți dă exerciții și teme din materialele site-ului, îți analizează greșelile și te readuce la ele până le stăpânești.
      </p>
      {profile && (
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <span style={chip('rgba(15,43,68,.08)', 'var(--navy)')}>🎒 Clasa a {profile.grade}-a</span>
          {profile.examTarget && <span style={chip('rgba(15,43,68,.08)', 'var(--navy)')}>🎯 {EXAM_LABELS[profile.examTarget]}</span>}
          {profile.level && <span style={chip('rgba(232,185,49,.18)', '#8a6d1a')}>📊 Nivel: {profile.level}</span>}
          {profile.streakDays > 0 && <span style={chip('rgba(231,76,60,.1)', '#c0392b')}>🔥 {profile.streakDays} {profile.streakDays === 1 ? 'zi' : 'zile'} la rând</span>}
          {profile.totalSeconds > 60 && <span style={chip('rgba(39,174,96,.1)', '#1e7e34')}>⏱ {fmtMin(profile.totalSeconds)} de studiu</span>}
        </div>
      )}
    </div>
  );
}

function LessonView({ data, onClose, onExercises, busyLabel }) {
  return (
    <div>
      <div style={{ ...card, display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
        <div style={{ fontWeight: 800, color: 'var(--navy)', fontSize: '1.05rem' }}>📖 Teoria · {data.chapter.title}</div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <button className="btn btn-outline btn-sm" onClick={() => openPrintDocument(`Lecție · ${data.chapter.title}`, lessonHtml(`Lecție · ${data.chapter.title}`, data.lesson))}>📄 Salvează lecția PDF</button>
          <button className="btn btn-outline btn-sm" onClick={onClose}>✕ Închide</button>
        </div>
      </div>
      {data.materials?.length > 0 && (
        <div style={{ ...card, background: '#f7f9fc' }}>
          <div style={{ fontWeight: 700, color: 'var(--navy)', fontSize: '.9rem', marginBottom: 8 }}>📚 Întâi din materialele site-ului:</div>
          {data.materials.map((m, i) => (
            <Link key={i} to={m.url} style={{ display: 'block', padding: '7px 10px', background: '#fff', border: '1px solid var(--border)', borderRadius: 8, marginBottom: 6, fontSize: '.86rem', color: 'var(--navy)', fontWeight: 600 }}>
              {m.kind === 'pdf' ? '📄' : m.kind === 'articol' ? '📝' : m.kind === 'manual' ? '📖' : '🧩'} {m.title}{m.is_free === false ? ' ⭐' : ''} →
            </Link>
          ))}
        </div>
      )}
      <div style={{ ...card, fontSize: '.95rem', lineHeight: 1.7 }}>
        <MathText text={data.lesson} />
      </div>
      <button className="btn btn-primary btn-lg" onClick={onExercises} disabled={busyLabel === 'exercises'}>
        {busyLabel === 'exercises' ? 'Pregătesc exercițiile...' : '✍️ Am citit — trecem la exerciții'}
      </button>
    </div>
  );
}

function TodayTab({ st, busy, onLesson, onExercises, onReview, onRemediation, onHomeworkTab, onStyle }) {
  const next = st.nextChapter;
  const styles = ['mai simplu, cu cuvinte de zi cu zi', 'vizual, cu desene și scheme', 'prin exemple din viața reală', 'pas cu pas, foarte mărunt'];
  const preferred = st.profile?.memory?.preferredStyle;
  return (
    <div>
      {/* Pasul recomandat — profesorul decide singur ce urmează */}
      {next ? (
        <div style={{ ...card, borderLeft: '4px solid var(--gold)' }}>
          <div style={{ fontSize: '.78rem', fontWeight: 800, color: 'var(--gold-dim)', textTransform: 'uppercase', letterSpacing: '.04em', marginBottom: 6 }}>Profesorul îți recomandă azi</div>
          <div style={{ fontWeight: 800, color: 'var(--navy)', fontSize: '1.1rem', marginBottom: 4 }}>{next.title}</div>
          <div style={{ fontSize: '.85rem', color: 'var(--text-light)', marginBottom: 12 }}>
            {next.status === 'de_parcurs' ? 'Începem cu teoria, apoi exersăm.' : next.status === 'teorie' ? 'Ai citit teoria — acum exersăm!' : 'Continuăm exercițiile până stăpânești capitolul (80%+).'}
            {next.mastery != null && ` Stăpânire actuală: ${Math.round(next.mastery * 100)}%.`}
          </div>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <button className="btn btn-primary" onClick={() => (next.status === 'de_parcurs' ? onLesson(next.id) : onExercises(next.id))} disabled={!!busy}>
              {busy === 'lesson' || busy === 'exercises' ? 'Se pregătește...' : next.status === 'de_parcurs' ? '📖 Începe cu teoria' : '✍️ Exersează acum'}
            </button>
            {next.status !== 'de_parcurs' && (
              <button className="btn btn-outline" onClick={() => onLesson(next.id)} disabled={!!busy}>📖 Recitesc teoria</button>
            )}
          </div>
        </div>
      ) : (
        <div style={{ ...card, borderLeft: '4px solid #27ae60' }}>
          <div style={{ fontWeight: 800, color: '#1e7e34', fontSize: '1.05rem' }}>🏆 Ai parcurs toate capitolele din plan!</div>
          <div style={{ fontSize: '.88rem', color: 'var(--text-light)', marginTop: 4 }}>Continuă cu recapitulările și simulările de examen ca să rămâi în formă.</div>
        </div>
      )}

      {/* Recapitulări scadente */}
      {st.dueReviews?.length > 0 && (
        <div style={{ ...card, background: 'rgba(52,152,219,.06)', borderColor: 'rgba(52,152,219,.3)' }}>
          <div style={{ fontWeight: 700, color: '#1f6dab', marginBottom: 8 }}>🔁 Ca să nu uiți materia, azi recapitulăm:</div>
          {st.dueReviews.slice(0, 3).map((r) => (
            <div key={r.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, padding: '8px 10px', background: '#fff', borderRadius: 8, marginBottom: 6, flexWrap: 'wrap' }}>
              <span style={{ fontSize: '.88rem', color: 'var(--navy)', fontWeight: 600 }}>{r.chapterTitle}</span>
              <button className="btn btn-sm btn-outline" disabled={!!busy} onClick={() => onReview(r.id, r.chapterTitle)}>{busy === 'review' ? '...' : '▶ 5 întrebări rapide'}</button>
            </div>
          ))}
        </div>
      )}

      {/* Teme în așteptare */}
      {st.pendingHomework > 0 && (
        <div style={{ ...card, background: 'rgba(232,185,49,.08)', borderColor: 'var(--gold)', display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
          <span style={{ fontWeight: 700, color: 'var(--navy)' }}>📚 Ai {st.pendingHomework} {st.pendingHomework === 1 ? 'temă nefăcută' : 'teme nefăcute'} de la profesor.</span>
          <button className="btn btn-primary btn-sm" onClick={onHomeworkTab}>Vezi temele →</button>
        </div>
      )}

      {/* Greșeli de remediat */}
      {st.openMistakes?.length > 0 && (
        <div style={card}>
          <div style={{ fontWeight: 700, color: 'var(--navy)', marginBottom: 4 }}>🩹 Greșeli de vindecat (exerciții de același fel)</div>
          <p style={{ fontSize: '.8rem', color: 'var(--text-muted)', marginBottom: 10 }}>La fiecare greșeală îți dau 10 exerciții de exact același tip, până stăpânești procedeul.</p>
          {st.openMistakes.slice(0, 4).map((m) => (
            <div key={m.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, padding: '8px 10px', background: '#f7f9fc', borderRadius: 8, marginBottom: 6, flexWrap: 'wrap' }}>
              <div style={{ flex: 1, minWidth: 200 }}>
                <div style={{ fontSize: '.8rem', fontWeight: 700, color: '#c0392b' }}>{ERROR_LABELS[m.error_type] || m.error_type}{m.topic ? ` · ${m.topic}` : ''}</div>
                <div style={{ fontSize: '.82rem', color: 'var(--text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 460 }}><MathText text={m.statement || ''} /></div>
              </div>
              <button className="btn btn-sm btn-outline" disabled={!!busy} onClick={() => onRemediation(m.id)}>{busy === 'remediation' ? '...' : '🔁 10 la fel'}</button>
            </div>
          ))}
        </div>
      )}

      {/* Predicția notei */}
      {st.prediction && (
        <div style={{ ...card, display: 'flex', alignItems: 'center', gap: 16, flexWrap: 'wrap' }}>
          <div style={{ fontSize: '2.2rem', fontWeight: 800, fontFamily: 'var(--font-display)', color: 'var(--navy)', background: 'rgba(232,185,49,.15)', borderRadius: 14, padding: '10px 18px' }}>
            {st.prediction.grade}
          </div>
          <div style={{ flex: 1, minWidth: 220 }}>
            <div style={{ fontWeight: 700, color: 'var(--navy)' }}>Nota estimată la {st.profile?.examTarget ? EXAM_LABELS[st.profile.examTarget] : 'următorul test'}</div>
            <div style={{ fontSize: '.8rem', color: 'var(--text-muted)' }}>
              Estimare {st.prediction.confidence} — din stăpânirea subiectelor, teme și simulări.
              {st.prediction.weakChapters?.length ? ` Pentru o notă mai mare, consolidează: ${st.prediction.weakChapters.join('; ')}.` : ''}
            </div>
          </div>
        </div>
      )}

      {/* Cum îți explic cel mai bine? (memorie pedagogică) */}
      <div style={card}>
        <div style={{ fontWeight: 700, color: 'var(--navy)', marginBottom: 8 }}>💡 Cum îți explic cel mai bine?</div>
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          {styles.map((s) => (
            <button key={s} disabled={!!busy} onClick={() => onStyle(s)} style={{
              border: `1px solid ${preferred === s ? 'var(--gold)' : 'var(--border)'}`,
              background: preferred === s ? 'rgba(232,185,49,.15)' : '#fff',
              color: 'var(--navy)', borderRadius: 18, padding: '6px 12px', fontSize: '.8rem', fontWeight: 600, cursor: 'pointer',
            }}>{preferred === s ? '✓ ' : ''}{s}</button>
          ))}
        </div>
        <p style={{ fontSize: '.75rem', color: 'var(--text-muted)', marginTop: 8, marginBottom: 0 }}>Țin minte alegerea ta și explic mereu așa — în lecții, la exerciții și în chat.</p>
      </div>
    </div>
  );
}

function PlanTab({ st, busy, onLesson, onExercises, onReset }) {
  const plan = st.plan || {};
  const chapters = plan.chapters || [];
  return (
    <div>
      <div style={card}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8, flexWrap: 'wrap', gap: 8 }}>
          <h3 style={{ fontFamily: 'var(--font-display)', color: 'var(--navy)', margin: 0 }}>Planul tău de învățare</h3>
          <span style={{ fontWeight: 800, color: 'var(--navy)' }}>{plan.progress || 0}%</span>
        </div>
        <div style={{ height: 12, background: 'var(--border)', borderRadius: 99, overflow: 'hidden', marginBottom: 10 }}>
          <div style={{ height: '100%', width: `${plan.progress || 0}%`, background: 'linear-gradient(90deg, var(--gold), #27ae60)', borderRadius: 99, transition: 'width .5s' }} />
        </div>
        <div style={{ fontSize: '.83rem', color: 'var(--text-light)' }}>
          🎯 Obiectivul săptămânal: <strong>{plan.weeklyGoal?.chapters || 2} capitole</strong>, ~{plan.weeklyGoal?.exercises || 20} exerciții, ~{plan.weeklyGoal?.minutes || 180} minute.
          {plan.estWeeks ? <> · Timp estimat pentru tot planul: <strong>~{plan.estWeeks} săptămâni</strong>.</> : null}
        </div>
      </div>

      {chapters.map((c, i) => {
        const stl = STATUS_LABELS[c.status] || STATUS_LABELS.de_parcurs;
        return (
          <div key={c.id} style={{ ...card, padding: '14px 18px', display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
            <div style={{ width: 30, height: 30, borderRadius: '50%', background: c.status === 'finalizat' ? '#27ae60' : 'var(--navy)', color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 800, fontSize: '.85rem', flexShrink: 0 }}>
              {c.status === 'finalizat' ? '✓' : i + 1}
            </div>
            <div style={{ flex: 1, minWidth: 220 }}>
              <div style={{ fontWeight: 700, color: 'var(--navy)', fontSize: '.95rem' }}>{c.title}</div>
              <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginTop: 4, flexWrap: 'wrap' }}>
                <span style={chip(stl.bg, stl.color)}>{stl.label}</span>
                {c.mastery != null && <span style={{ fontSize: '.76rem', color: 'var(--text-muted)' }}>stăpânire {Math.round(c.mastery * 100)}%</span>}
              </div>
            </div>
            <div style={{ display: 'flex', gap: 6 }}>
              <button className="btn btn-sm btn-outline" disabled={!!busy} onClick={() => onLesson(c.id)}>📖 Teorie</button>
              <button className="btn btn-sm btn-primary" disabled={!!busy} onClick={() => onExercises(c.id)}>✍️ Exerciții</button>
            </div>
          </div>
        );
      })}

      <button onClick={onReset} style={{ background: 'none', border: 'none', color: 'var(--text-muted)', fontSize: '.78rem', textDecoration: 'underline', cursor: 'pointer', marginTop: 6 }}>
        Reia evaluarea inițială de la zero
      </button>
    </div>
  );
}

function HomeworkTab({ st, busy, onOpen, onAsk }) {
  const hw = st.homework || [];
  return (
    <div>
      <div style={{ ...card, display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
        <div>
          <div style={{ fontWeight: 700, color: 'var(--navy)' }}>Temele tale de la Profesorul Virtual</div>
          <div style={{ fontSize: '.8rem', color: 'var(--text-muted)' }}>Întâi primești exerciții din site; când le termini, îți generez altele pe nivelul tău. Le corectez, le notez și îți explic greșelile.</div>
        </div>
        <button className="btn btn-primary btn-sm" disabled={!!busy} onClick={onAsk}>{busy === 'homework' ? '...' : '➕ Dă-mi o temă acum'}</button>
      </div>
      {hw.length === 0 && <div style={card}><p style={{ color: 'var(--text-muted)', fontSize: '.9rem', margin: 0 }}>Încă nu ai teme. Cere una acum sau așteaptă — profesorul îți dă teme pe măsură ce lucrați împreună.</p></div>}
      {hw.map((h) => (
        <div key={h.id} style={{ ...card, padding: '14px 18px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
            <div style={{ flex: 1, minWidth: 220 }}>
              <div style={{ fontWeight: 700, color: 'var(--navy)', fontSize: '.93rem' }}>
                {h.kind === 'content' ? '🧩' : '📚'} {h.title}
              </div>
              <div style={{ fontSize: '.76rem', color: 'var(--text-muted)', marginTop: 3 }}>
                {h.kind === 'content' ? 'Exercițiu interactiv din site' : 'Set pregătit de profesor'} · dată pe {new Date(h.assigned_at).toLocaleDateString('ro-RO')}
                {h.due_at && h.status === 'data' ? ` · termen ${new Date(h.due_at).toLocaleDateString('ro-RO')}` : ''}
              </div>
              {h.status === 'rezolvata' && (
                <div style={{ marginTop: 6, display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                  <span style={chip('rgba(39,174,96,.12)', '#1e7e34')}>✓ Rezolvată · {h.score}/{h.max_score}</span>
                  {h.feedback?.grade != null && <span style={chip('rgba(232,185,49,.18)', '#8a6d1a')}>Nota {h.feedback.grade}</span>}
                </div>
              )}
            </div>
            {h.status === 'data'
              ? <button className="btn btn-sm btn-primary" disabled={!!busy} onClick={() => onOpen(h)}>▶ Rezolvă</button>
              : h.kind !== 'content' && <button className="btn btn-sm btn-outline" disabled={!!busy} onClick={() => onOpen(h)}>↺ Reia</button>}
          </div>
        </div>
      ))}
    </div>
  );
}

function ReviewsTab({ st, busy, onReview }) {
  const due = st.dueReviews || [];
  return (
    <div>
      <div style={card}>
        <div style={{ fontWeight: 700, color: 'var(--navy)', marginBottom: 4 }}>Repetiția inteligentă</div>
        <p style={{ fontSize: '.85rem', color: 'var(--text-light)', margin: 0 }}>
          După fiecare capitol finalizat revin cu recapitulări scurte: <strong>după 1 zi → după 7 zile → după 30 de zile</strong>.
          Așa creierul fixează materia pe termen lung și nu o mai uiți. 🧠
        </p>
      </div>
      {due.length === 0 ? (
        <div style={card}><p style={{ color: 'var(--text-muted)', fontSize: '.9rem', margin: 0 }}>Nimic de recapitulat azi. 🎉 Finalizează capitole din plan și recapitulările apar aici la momentul potrivit (te anunț și la clopoțel).</p></div>
      ) : due.map((r) => (
        <div key={r.id} style={{ ...card, padding: '14px 18px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
          <div>
            <div style={{ fontWeight: 700, color: 'var(--navy)', fontSize: '.93rem' }}>{r.chapterTitle}</div>
            <div style={{ fontSize: '.76rem', color: 'var(--text-muted)', marginTop: 3 }}>
              Etapa {r.stage + 1}/3 · {r.stage === 0 ? 'recapitularea de a doua zi' : r.stage === 1 ? 'recapitularea de după o săptămână' : 'recapitularea de după o lună'}
            </div>
          </div>
          <button className="btn btn-sm btn-primary" disabled={!!busy} onClick={() => onReview(r.id, r.chapterTitle)}>{busy === 'review' ? '...' : '▶ Începe (5 întrebări)'}</button>
        </div>
      ))}
    </div>
  );
}

function SimTab({ st, busy, onSimulare }) {
  const sims = (st.sessions || []).filter((s) => s.kind === 'simulare' && s.status === 'finalizata');
  const examLabel = EXAM_LABELS[st.examType] || 'examen';
  return (
    <div>
      <div style={{ ...card, borderLeft: '4px solid var(--navy)' }}>
        <div style={{ fontWeight: 800, color: 'var(--navy)', fontSize: '1.05rem', marginBottom: 4 }}>🎯 Simulare interactivă · {examLabel}</div>
        <p style={{ fontSize: '.86rem', color: 'var(--text-light)', marginBottom: 12 }}>
          Test în stilul subiectelor oficiale din site, cu <strong>punctele tale slabe incluse</strong>. Îl corectez pe loc și îți spun exact unde mai ai de lucrat.
        </p>
        <button className="btn btn-primary" disabled={!!busy} onClick={onSimulare}>{busy === 'simulare' ? 'Pregătesc simularea... (~30s)' : '▶ Începe simularea'}</button>
        {sims.length > 0 && (
          <div style={{ marginTop: 14, fontSize: '.83rem', color: 'var(--text)' }}>
            <strong>Simulările tale:</strong>{' '}
            {sims.slice(0, 5).map((s, i) => (
              <span key={s.id} style={{ marginRight: 8 }}>
                {new Date(s.created_at).toLocaleDateString('ro-RO')}: <strong>{s.max_score ? Math.round((s.score / s.max_score) * 100) : 0}%</strong>{i < Math.min(sims.length, 5) - 1 ? ' ·' : ''}
              </span>
            ))}
          </div>
        )}
      </div>
      <details style={{ ...card }}>
        <summary style={{ cursor: 'pointer', fontWeight: 700, color: 'var(--navy)' }}>📄 Vreau un subiect de examen PDF (ca la examen, cu barem)</summary>
        <p style={{ fontSize: '.8rem', color: 'var(--text-muted)', margin: '8px 0 14px' }}>Generatorul de subiecte în format oficial — se deschide ca document tipăribil, cu variantă de elev și barem.</p>
        <ExamGenerator />
      </details>
    </div>
  );
}
