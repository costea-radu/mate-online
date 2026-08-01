// =====================================================================
// src/pages/ProfesorVirtual.jsx — pagina dedicată a tutorelui AI
// Tab-uri: Întreabă profesorul · Antrenament · Progresul meu
// =====================================================================
import { useState, useEffect } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { ChatPanel, MathText } from '../components/AITutor';
import { aiClient } from '../lib/aiClient';
import { useAuth } from '../context/AuthContext';
import { aiAssistantLabel, askAiLabel } from '../lib/aiLabel';
import { printExam, printExercise } from '../lib/examPrint';
import ExamGenerator from '../components/ExamGenerator';
import EinsteinIcon from '../components/EinsteinIcon';
import SendToStudents from '../components/SendToStudents';
import { renderQuiz } from '../lib/quizRender';

const CATEGORIES = [
  { id: '', label: 'Toate' },
  { id: 'clasa-5', label: 'Clasa 5' }, { id: 'clasa-6', label: 'Clasa 6' },
  { id: 'clasa-7', label: 'Clasa 7' }, { id: 'clasa-8', label: 'Clasa 8' },
  { id: 'evaluare-nationala', label: 'Evaluare Națională' },
  { id: 'bacalaureat', label: 'Bacalaureat' },
];
const DIFFS = ['ușor', 'mediu', 'greu'];

export default function ProfesorVirtual() {
  const { user, loading, isStudent, isTeacher, isParent } = useAuth();
  const [tab, setTab] = useState('chat');
  const navigate = useNavigate();

  if (loading) return <div style={{ padding: 60, textAlign: 'center' }}><div className="spinner" /></div>;

  // Contul de ELEV: „Întreabă profesorul" + „Meditații cu Prof. Virtual" + „Progresul meu".
  // (Generatoarele de subiecte/interactive și biblioteca rămân pentru profesori/părinți.)
  const isStudentView = isStudent || (!isTeacher && !isParent);
  const TABS = isStudentView
    ? [
        { id: 'chat', label: `💬 ${askAiLabel({ isTeacher, isParent })}` },
        { id: 'meditatii', label: '🎓 Meditații cu Prof. Virtual' },
        { id: 'progress', label: '📈 Progresul meu' },
      ]
    : [
        { id: 'chat', label: `💬 ${askAiLabel({ isTeacher, isParent })}` },
        { id: 'exam', label: '📄 Generează subiect examen' },
        { id: 'interactive', label: '🧩 Generează interactiv' },
        { id: 'library', label: '📚 Testele și exercițiile mele' },
      ];

  return (
    <div style={{ maxWidth: 'var(--container)', margin: '0 auto', padding: '32px 20px 60px' }}>
      {/* Hero */}
      <div style={{ marginBottom: 24 }}>
        <h1 style={{ fontFamily: 'var(--font-display)', fontSize: 'clamp(1.8rem,4vw,2.6rem)', color: 'var(--navy)', marginBottom: 6, display:'flex', alignItems:'center', gap:12 }}>
          <EinsteinIcon size={48} /> {aiAssistantLabel({ isTeacher, isParent })}
        </h1>
        <p style={{ color: 'var(--text-light)', maxWidth: 620 }}>
          Tutorele tău AI care învață din toate exercițiile și explicațiile de pe ExamenMate.
          Cere explicații, indicii, exerciții noi de antrenament și urmărește-ți progresul.
        </p>
      </div>

      {/* Tab-uri */}
      <div style={{ display: 'flex', gap: 8, borderBottom: '2px solid var(--border)', marginBottom: 24, flexWrap: 'wrap' }}>
        {TABS.map((t) => (
          <button key={t.id} onClick={() => (t.id === 'meditatii' ? navigate('/meditatii') : setTab(t.id))}
            style={{
              background: 'none', border: 'none', padding: '10px 4px', marginBottom: -2,
              borderBottom: '3px solid', borderColor: tab === t.id ? 'var(--gold)' : 'transparent',
              color: tab === t.id ? 'var(--navy)' : 'var(--text-muted)',
              fontWeight: 700, fontSize: '.95rem', cursor: 'pointer',
            }}>
            {t.label}
          </button>
        ))}
      </div>

      {!user ? (
        <div style={{ textAlign: 'center', padding: 50, background: '#f7f9fc', borderRadius: 'var(--radius-lg)' }}>
          <div style={{ fontSize: '3rem', marginBottom: 12 }}>🔒</div>
          <p style={{ color: 'var(--text-light)', marginBottom: 18 }}>Autentifică-te pentru a folosi Profesorul Virtual.</p>
          <Link to="/autentificare" className="btn btn-primary">Autentificare</Link>
        </div>
      ) : (
        <>
          {tab === 'chat' && (
            <div style={{ height: 560, border: '1px solid var(--border)', borderRadius: 'var(--radius-lg)', overflow: 'hidden', background: '#fff' }}>
              <ChatPanel />
            </div>
          )}
          {tab === 'interactive' && <InteractiveTab />}
          {tab === 'exam' && <ExamGenerator canManage={isTeacher} />}
          {tab === 'library' && <LibraryTab />}
          {tab === 'progress' && <ProgressTab />}
        </>
      )}
    </div>
  );
}

// ─── ANTRENAMENT ─────────────────────────────────────────────────────────────
function PracticeTab() {
  const { isPremium, isTeacher, isParent } = useAuth();
  const [category, setCategory] = useState('');
  const [topic, setTopic] = useState('');
  const [difficulty, setDifficulty] = useState('mediu');
  const [items, setItems] = useState([]); // [{ exercise, token, id }]
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [upsell, setUpsell] = useState(false);
  const [exporting, setExporting] = useState(false);

  const COUNT = isPremium ? 5 : 1;

  async function gen() {
    setLoading(true); setError(null); setUpsell(false); setItems([]);
    try {
      const results = await Promise.allSettled(
        Array.from({ length: COUNT }, () => aiClient.generate({ category: category || null, topic, difficulty }))
      );
      const ok = [];
      let premiumErr = false, otherErr = null;
      results.forEach((r, i) => {
        if (r.status === 'fulfilled') ok.push({ ...r.value, id: `${Date.now()}_${i}` });
        else if (r.reason?.premium) premiumErr = true;
        else otherErr = r.reason?.message || 'Eroare la generare';
      });
      setItems(ok);
      if (!ok.length && premiumErr) setUpsell(true);
      else if (!ok.length && otherErr) setError(otherErr);
      else if (premiumErr) setUpsell(true);
    } catch (e) { setError(e.message); if (e.premium) setUpsell(true); }
    finally { setLoading(false); }
  }

  async function addOne() {
    setLoading(true); setError(null); setUpsell(false);
    try {
      const r = await aiClient.generate({ category: category || null, topic, difficulty });
      setItems((arr) => [...arr, { ...r, id: `${Date.now()}_${arr.length}` }]);
    } catch (e) { if (e.premium) setUpsell(true); else setError(e.message); }
    finally { setLoading(false); }
  }

  async function exportAll() {
    if (!items.length) return;
    setExporting(true); setError(null);
    try {
      const revealed = await Promise.all(items.map((it) => aiClient.reveal({ token: it.token }).catch(() => null)));
      const exItems = revealed.filter(Boolean).map((full, i) => ({
        number: String(i + 1), statement: full.statement, options: items[i]?.exercise?.options,
        answer: full.answer, solution: full.solution, points: null,
      }));
      const exam = {
        title: `Exerciții de antrenament${topic ? ' · ' + topic : ''}`, durationMin: 50, totalPoints: null, oficiu: null,
        subjects: [{ label: 'Exerciții', points: null, items: exItems }],
      };
      printExam(exam, { withSolutions: true });
    } catch (e) { setError(e.message); if (e.premium) setUpsell(true); }
    finally { setExporting(false); }
  }

  // „Trimite elevilor tot": împachetează cele 5 exerciții într-o singură temă interactivă.
  async function sendAllCreate() {
    const nrm = (s) => String(s || '').trim().toLowerCase().replace(',', '.').replace(/\s+/g, '');
    const revealed = await Promise.all(items.map((it) => aiClient.reveal({ token: it.token }).catch(() => null)));
    const questions = revealed.map((full, i) => {
      if (!full) return null;
      const ex = items[i]?.exercise || {};
      if (ex.answer_type === 'choice' && Array.isArray(ex.options) && ex.options.length) {
        const idx = ex.options.findIndex((o) => nrm(o) === nrm(full.answer));
        if (idx >= 0) return { statement: full.statement, options: ex.options, answer: idx, explanation: full.solution };
      }
      return { statement: full.statement, answer: String(full.answer ?? ''), explanation: full.solution };
    }).filter(Boolean);
    if (!questions.length) throw new Error('Nu s-au putut pregăti exercițiile.');
    return aiClient.assignmentCreateInteractive({ questions, title: `Set de exerciții de antrenament${topic ? ' · ' + topic : ''}` });
  }

  // Deschide exercițiul într-o fereastră nouă; scorul revine prin window.opener
  function openInNewWindow(docHtml) {
    const w = window.open('', '_blank');
    if (!w) { setError('Browserul a blocat fereastra — permite pop-up-urile pentru acest site.'); return; }
    w.document.write(docHtml); w.document.close();
  }

  const card = { background: '#fff', border: '1px solid var(--border)', borderRadius: 'var(--radius-lg)', padding: 20, marginBottom: 18 };
  const inp = { border: '1px solid var(--border)', borderRadius: 8, padding: '9px 11px', fontSize: '.9rem', fontFamily: 'var(--font-body)' };

  return (
    <div>
      <div style={card}>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(150px,1fr))', gap: 12, marginBottom: 14 }}>
          <label style={{ fontSize: '.85rem', color: 'var(--text-light)' }}>Categorie
            <select value={category} onChange={(e) => setCategory(e.target.value)} style={{ ...inp, width: '100%', marginTop: 4 }}>
              {CATEGORIES.map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}
            </select>
          </label>
          <label style={{ fontSize: '.85rem', color: 'var(--text-light)' }}>Subiect (opțional)
            <input value={topic} onChange={(e) => setTopic(e.target.value)} placeholder="ex: ecuații, fracții, arii" style={{ ...inp, width: '100%', marginTop: 4 }} />
          </label>
          <label style={{ fontSize: '.85rem', color: 'var(--text-light)' }}>Dificultate
            <select value={difficulty} onChange={(e) => setDifficulty(e.target.value)} style={{ ...inp, width: '100%', marginTop: 4 }}>
              {DIFFS.map((d) => <option key={d} value={d}>{d}</option>)}
            </select>
          </label>
        </div>
        <button className="btn btn-primary" onClick={gen} disabled={loading}>
          {loading ? 'Se generează...' : (isPremium ? '✨ Generează 5 exerciții' : '✨ Generează un exercițiu')}
        </button>
        {items.length > 0 && (
          <button className="btn btn-outline" onClick={exportAll} disabled={exporting} style={{ marginLeft: 8 }}>
            {exporting ? 'Se pregătește...' : '📄 Exportă toate (PDF)'}
          </button>
        )}
        {items.length > 0 && (isTeacher || isParent) && (
          <div style={{ display: 'inline-block', marginLeft: 8, verticalAlign: 'top' }}>
            <SendToStudents label="📤 Trimite elevilor tot" create={sendAllCreate} />
          </div>
        )}
      </div>

      {error && <div style={{ ...card, background: '#fdecea', color: '#b71c1c', borderColor: '#f5c6cb' }}>⚠️ {error}</div>}
      {upsell && (
        <div style={{ ...card, background: '#fff4e5', borderColor: 'var(--gold)', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
          <span style={{ color: 'var(--navy)', fontWeight: 600 }}>🔒 Antrenamentul (5 exerciții + export PDF) face parte din abonament.</span>
          <Link to="/preturi" className="btn btn-primary">Abonează-te →</Link>
        </div>
      )}

      {items.map((it, idx) => <PracticeCard key={it.id} item={it} index={idx} canSend={isTeacher || isParent} canEdit={isTeacher} onRemove={() => setItems((arr) => arr.filter((x) => x.id !== it.id))} />)}

      {items.length > 0 && (
        <button className="btn btn-outline" onClick={addOne} disabled={loading}>
          {loading ? 'Se generează...' : '➕ Mai generează un exercițiu'}
        </button>
      )}
    </div>
  );
}

function PracticeCard({ item, index, canSend, canEdit, onRemove }) {
  const [answer, setAnswer] = useState('');
  const [work, setWork] = useState('');
  const [result, setResult] = useState(null);
  const [revealedHints, setRevealedHints] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [editing, setEditing] = useState(false);
  const [edited, setEdited] = useState(null);
  const [revealing, setRevealing] = useState(false);
  const [publishMsg, setPublishMsg] = useState(null);
  const exercise = item.exercise;
  const editTa = { width: '100%', border: '1px solid var(--border)', borderRadius: 6, padding: '6px 8px', fontSize: '.82rem', fontFamily: 'var(--font-body)', marginTop: 3, marginBottom: 4, resize: 'vertical' };

  async function openEditor() {
    if (edited) { setEditing((e) => !e); return; }
    setRevealing(true); setError(null);
    try {
      const full = await aiClient.reveal({ token: item.token });
      setEdited({
        statement: full.statement || exercise.statement || '', options: exercise.options || [],
        answer: full.answer || '', answer_type: exercise.answer_type || 'text',
        solution: full.solution || '', topic: exercise.topic, category: exercise.category,
      });
      setEditing(true);
    } catch (e) { setError(e.premium ? 'Editarea face parte din abonament.' : e.message); }
    finally { setRevealing(false); }
  }

  async function verify() {
    setLoading(true); setError(null);
    try {
      const res = await aiClient.check({ token: item.token, studentAnswer: answer, studentWork: work });
      setResult(res);
    } catch (e) { setError(e.message); }
    finally { setLoading(false); }
  }

  const card = { background: '#fff', border: '1px solid var(--border)', borderRadius: 'var(--radius-lg)', padding: 20, marginBottom: 18 };
  const inp = { border: '1px solid var(--border)', borderRadius: 8, padding: '9px 11px', fontSize: '.9rem', fontFamily: 'var(--font-body)' };

  return (
    <div style={card}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
        <span style={{ fontSize: '.72rem', fontWeight: 700, color: 'var(--gold-dim)', textTransform: 'uppercase', letterSpacing: '.04em' }}>
          Exercițiul {index + 1} · {exercise.topic || 'exercițiu'} · {exercise.difficulty}
        </span>
        {onRemove && (
          <button onClick={onRemove} title="Șterge exercițiul"
            style={{ background: 'none', border: '1px solid #f5c6cb', color: '#c0392b', borderRadius: 6, padding: '2px 8px', fontSize: '.75rem', cursor: 'pointer' }}>🗑 Șterge</button>
        )}
      </div>
      <div style={{ fontSize: '1.05rem', color: 'var(--navy)', lineHeight: 1.6, marginBottom: 16 }}><MathText text={exercise.statement} /></div>

      {exercise.hints?.length > 0 && (
        <div style={{ marginBottom: 16 }}>
          {revealedHints < exercise.hints.length && (
            <button onClick={() => setRevealedHints((h) => h + 1)}
              style={{ background: 'none', border: '1px dashed var(--gold)', color: 'var(--gold-dim)', borderRadius: 8, padding: '6px 12px', fontSize: '.82rem', fontWeight: 600 }}>
              💡 Arată un indiciu ({revealedHints}/{exercise.hints.length})
            </button>
          )}
          {exercise.hints.slice(0, revealedHints).map((h, i) => (
            <div key={i} style={{ marginTop: 8, padding: '8px 12px', background: 'rgba(232,185,49,.1)', borderRadius: 8, fontSize: '.88rem', color: 'var(--text)' }}>💡 <MathText text={h} /></div>
          ))}
        </div>
      )}

      {error && <div style={{ padding: 10, background: '#fdecea', color: '#b71c1c', borderRadius: 8, fontSize: '.85rem', marginBottom: 10 }}>⚠️ {error}</div>}

      {!result && (
        <>
          {exercise.answer_type === 'choice' && exercise.options?.length ? (
            <div style={{ marginBottom: 12 }}>
              {exercise.options.map((o, i) => (
                <label key={i} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 10px', border: '1px solid var(--border)', borderRadius: 8, marginBottom: 6, cursor: 'pointer', background: answer === o ? 'rgba(232,185,49,.12)' : '#fff' }}>
                  <input type="radio" name={`opt-${item.id}`} checked={answer === o} onChange={() => setAnswer(o)} />
                  <strong style={{ color: 'var(--navy)' }}>{String.fromCharCode(65 + i)})</strong>
                  <span style={{ flex: 1 }}><MathText text={o} /></span>
                </label>
              ))}
            </div>
          ) : (
            <input value={answer} onChange={(e) => setAnswer(e.target.value)}
              inputMode={exercise.answer_type === 'numeric' ? 'decimal' : 'text'}
              placeholder={exercise.answer_type === 'numeric' ? 'Răspunsul tău (număr)' : 'Răspunsul tău final'}
              style={{ ...inp, width: '100%', marginBottom: 10 }} />
          )}
          <textarea value={work} onChange={(e) => setWork(e.target.value)} placeholder="Pașii tăi (opțional)"
            rows={3} style={{ ...inp, width: '100%', marginBottom: 12, resize: 'vertical' }} />
          <button className="btn btn-primary" onClick={verify} disabled={loading || !answer.trim()}>
            {loading ? 'Se verifică...' : '✓ Verifică'}
          </button>
        </>
      )}

      {result && (
        <div style={{ marginTop: 6, padding: 16, borderRadius: 12, background: result.correct ? 'rgba(39,174,96,.1)' : 'rgba(231,76,60,.08)', border: `1px solid ${result.correct ? 'rgba(39,174,96,.3)' : 'rgba(231,76,60,.25)'}` }}>
          <div style={{ fontWeight: 800, fontSize: '1.1rem', color: result.correct ? '#1e7e34' : '#c0392b', marginBottom: 8 }}>
            {result.correct ? '🎉 Corect!' : '❌ Nu chiar'} · {result.score}/100
          </div>
          <div style={{ fontSize: '.92rem', marginBottom: 12 }}><MathText text={result.feedback} /></div>
          <details>
            <summary style={{ cursor: 'pointer', fontWeight: 600, color: 'var(--navy)', fontSize: '.9rem' }}>Vezi rezolvarea completă</summary>
            <div style={{ marginTop: 8, fontSize: '.9rem', color: 'var(--text)', lineHeight: 1.6 }}><MathText text={result.solution} /></div>
          </details>
        </div>
      )}

      {canSend && (
        <SendToStudents create={() => (edited
          ? aiClient.assignmentCreatePractice({ exercise: edited, title: `Exercițiu de antrenament · ${edited.topic || exercise.topic || 'matematică'}` })
          : aiClient.assignmentCreatePractice({ token: item.token, title: `Exercițiu de antrenament · ${exercise.topic || 'matematică'}` }))} />
      )}

      {canEdit && (
        <div style={{ marginTop: 10, display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <button className="btn btn-outline btn-sm" onClick={openEditor} disabled={revealing}>
            {revealing ? 'Se încarcă...' : editing ? '✓ Gata editarea' : '✏️ Editează'}
          </button>
          {edited && (
            <button className="btn btn-outline btn-sm" onClick={async () => { setPublishMsg(null); try { await aiClient.publicPublish({ kind: 'practice', title: `Exercițiu · ${edited.topic || 'matematică'}`, category: edited.category || null, topic: edited.topic || null, payload: edited }); setPublishMsg('✅ Publicat în „Biblioteca utilizatorilor".'); } catch (e) { setPublishMsg('Eroare: ' + e.message); } }}>🏛️ Publică</button>
          )}
        </div>
      )}
      {canEdit && editing && edited && (
        <div style={{ marginTop: 10, padding: 10, background: '#f7f9fc', borderRadius: 8 }}>
          <label style={{ fontSize: '.74rem', color: 'var(--text-muted)' }}>Enunț
            <textarea rows={2} value={edited.statement} onChange={(e) => setEdited({ ...edited, statement: e.target.value })} style={editTa} />
          </label>
          {Array.isArray(edited.options) && edited.options.length > 0 && edited.options.map((o, oi) => (
            <input key={oi} value={o} onChange={(e) => { const opts = [...edited.options]; opts[oi] = e.target.value; setEdited({ ...edited, options: opts }); }} placeholder={`Varianta ${String.fromCharCode(97 + oi)})`} style={editTa} />
          ))}
          <label style={{ fontSize: '.74rem', color: 'var(--text-muted)' }}>Răspuns corect
            <input value={edited.answer} onChange={(e) => setEdited({ ...edited, answer: e.target.value })} style={editTa} />
          </label>
          <label style={{ fontSize: '.74rem', color: 'var(--text-muted)' }}>Rezolvare
            <textarea rows={3} value={edited.solution} onChange={(e) => setEdited({ ...edited, solution: e.target.value })} style={editTa} />
          </label>
        </div>
      )}
      {publishMsg && <div style={{ marginTop: 8, fontSize: '.82rem', color: publishMsg.startsWith('✅') ? '#1e7e34' : '#b71c1c' }}>{publishMsg}</div>}
    </div>
  );
}

function InteractiveTab() {
  const { isTeacher, isParent } = useAuth();
  const [category, setCategory] = useState('');
  const [topic, setTopic] = useState('');
  const [difficulty, setDifficulty] = useState('mediu');
  const [questions, setQuestions] = useState(null); // listă structurată
  const [title, setTitle] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [upsell, setUpsell] = useState(false);
  const [editing, setEditing] = useState(false);
  const [publishMsg, setPublishMsg] = useState(null);
  const [savedScore, setSavedScore] = useState(null);
  const [dataMode, setDataMode] = useState('modify');
  const navigate = useNavigate();

  // Câmpul „Subiect + instrucțiuni" poate fi lung — pentru titluri și
  // metadate (bibliotecă, teme, publicare) folosim doar prima linie, scurtă.
  const topicShort = (topic || '').split(/\r?\n/)[0].replace(/\s+/g, ' ').trim().slice(0, 120) || null;

  const html = questions ? renderQuiz(title, questions) : '';

  // Revenire din pagina exercițiului: restaurăm ultimul exercițiu generat
  useEffect(() => {
    try {
      const raw = sessionStorage.getItem('pv_last_interactive');
      if (raw) {
        const p = JSON.parse(raw);
        if (p.questions?.length) { setQuestions(p.questions); setTitle(p.title || 'Exercițiu interactiv'); }
      }
    } catch { /* ignore */ }
    // eslint-disable-next-line
  }, []);

  useEffect(() => {
    function onMsg(e) {
      if (e.source === window || !e.data || e.data.type !== 'MATE_SCORE') return;
      const { score, maxScore } = e.data;
      if (typeof score === 'number' && typeof maxScore === 'number' && maxScore > 0) setSavedScore({ score, maxScore });
    }
    window.addEventListener('message', onMsg);
    return () => window.removeEventListener('message', onMsg);
  }, []);

  async function gen() {
    setLoading(true); setError(null); setUpsell(false); setQuestions(null); setSavedScore(null); setEditing(false); setPublishMsg(null);
    try {
      const res = await aiClient.generateInteractive({ category: category || null, topic, difficulty, dataMode });
      const qs = res.questions || [];
      const t = res.title || 'Exercițiu interactiv';
      setQuestions(qs); setTitle(t);
      // salvează în „Testele și exercițiile mele"
      try { await aiClient.saveLibraryItem({ kind: 'interactive', title: t, category: category || null, topic: topicShort, payload: { questions: qs } }); } catch { /* ignore */ }
      // păstrăm exercițiul pentru revenire și îl deschidem DIRECT în pagina nouă
      sessionStorage.setItem('pv_last_interactive', JSON.stringify({ questions: qs, title: t }));
      navigate('/exercitiu-ai', { state: { html: renderQuiz(t, qs), title: t } });
    } catch (e) { setError(e.message); if (e.premium) setUpsell(true); }
    finally { setLoading(false); }
  }

  // Export PDF al întrebărilor (fostul „antrenament" e integrat aici)
  function exportPdf(withSolutions) {
    if (!questions || !questions.length) return;
    const exItems = questions.map((qq, i) => {
      const hasOpts = Array.isArray(qq.options) && qq.options.length;
      return {
        number: String(i + 1), statement: qq.statement, options: hasOpts ? qq.options : undefined,
        answer: hasOpts ? String.fromCharCode(97 + (Number(qq.answer) || 0)) : String(qq.answer ?? ''),
        solution: qq.explanation || '', points: null,
      };
    });
    printExam({ title, durationMin: 30, totalPoints: null, oficiu: null, subjects: [{ label: 'Exerciții', points: null, items: exItems }] }, { withSolutions });
  }

  // editare structurată
  function patchQ(i, patch) { setQuestions((qs) => qs.map((q, idx) => (idx === i ? { ...q, ...patch } : q))); }
  function patchOpt(i, oi, val) { setQuestions((qs) => qs.map((q, idx) => { if (idx !== i) return q; const opts = [...(q.options || [])]; opts[oi] = val; return { ...q, options: opts }; })); }
  function addQ() { setQuestions((qs) => [...(qs || []), { statement: 'Enunț nou', options: ['', '', '', ''], answer: 0, explanation: '' }]); }
  function delQ(i) { setQuestions((qs) => qs.filter((_, idx) => idx !== i)); }
  function toggleType(i) {
    setQuestions((qs) => qs.map((q, idx) => {
      if (idx !== i) return q;
      if (Array.isArray(q.options)) { const { options, ...rest } = q; return { ...rest, answer: '' }; }
      return { ...q, options: ['', '', '', ''], answer: 0 };
    }));
  }

  const card = { background: '#fff', border: '1px solid var(--border)', borderRadius: 'var(--radius-lg)', padding: 20, marginBottom: 18 };
  const inp = { border: '1px solid var(--border)', borderRadius: 8, padding: '9px 11px', fontSize: '.9rem', fontFamily: 'var(--font-body)' };
  const eta = { width: '100%', border: '1px solid var(--border)', borderRadius: 6, padding: '6px 8px', fontSize: '.82rem', marginTop: 3, marginBottom: 4, resize: 'vertical' };

  return (
    <div>
      <div style={card}>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(150px,1fr))', gap: 12, marginBottom: 14 }}>
          <label style={{ fontSize: '.85rem', color: 'var(--text-light)' }}>Categorie
            <select value={category} onChange={(e) => setCategory(e.target.value)} style={{ ...inp, width: '100%', marginTop: 4 }}>
              {CATEGORIES.map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}
            </select>
          </label>
          <label style={{ fontSize: '.85rem', color: 'var(--text-light)' }}>Dificultate
            <select value={difficulty} onChange={(e) => setDifficulty(e.target.value)} style={{ ...inp, width: '100%', marginTop: 4 }}>
              {DIFFS.map((d) => <option key={d} value={d}>{d}</option>)}
            </select>
          </label>
        </div>
        {/* Subiect + instrucțiuni: prompt amplu pentru AI — temă, număr de
            întrebări, tipuri de itemi, restricții etc. (nu doar un cuvânt-cheie). */}
        <label style={{ display: 'block', fontSize: '.85rem', color: 'var(--text-light)', marginBottom: 14 }}>Subiect + instrucțiuni pentru AI (opțional)
          <textarea value={topic} onChange={(e) => setTopic(e.target.value)} rows={3}
            placeholder={'ex: ecuații de gradul I cu o necunoscută; 6 întrebări, de la ușor la greu; doar numere naturale; ultima întrebare să fie o problemă cu text, în stilul Evaluării Naționale'}
            style={{ ...inp, width: '100%', marginTop: 4, resize: 'vertical', fontFamily: 'inherit', boxSizing: 'border-box' }} />
        </label>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginBottom: 12, fontSize: '.85rem', color: 'var(--text-light)' }}>
          <label style={{ display: 'flex', alignItems: 'flex-start', gap: 8, cursor: 'pointer' }}>
            <input type="radio" checked={dataMode === 'keep'} onChange={() => setDataMode('keep')} style={{ marginTop: 3 }} />
            <span><strong>Păstrează datele problemelor</strong> — preia exercițiile din subiectele site-ului fără să schimbe valorile</span>
          </label>
          <label style={{ display: 'flex', alignItems: 'flex-start', gap: 8, cursor: 'pointer' }}>
            <input type="radio" checked={dataMode === 'modify'} onChange={() => setDataMode('modify')} style={{ marginTop: 3 }} />
            <span><strong>Modifică numerele și notațiile</strong> (verifică problemele — poate greși!)</span>
          </label>
        </div>
        <button className="btn btn-primary" onClick={gen} disabled={loading}>{loading ? 'Se generează... (~20s)' : '✨ Generează exercițiu interactiv'}</button>
      </div>

      {error && <div style={{ ...card, background: '#fdecea', color: '#b71c1c', borderColor: '#f5c6cb' }}>⚠️ {error}</div>}
      {upsell && (
        <div style={{ ...card, background: '#fff4e5', borderColor: 'var(--gold)', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
          <span style={{ color: 'var(--navy)', fontWeight: 600 }}>🔒 Generatorul de exerciții interactive face parte din abonament.</span>
          <Link to="/preturi" className="btn btn-primary">Abonează-te →</Link>
        </div>
      )}

      {questions && (
        <div style={card}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10, flexWrap: 'wrap', gap: 8 }}>
            <strong style={{ color: 'var(--navy)' }}>{title}</strong>
            {savedScore && <span style={{ fontSize: '.85rem', color: '#1e7e34', fontWeight: 700 }}>Scor test: {savedScore.score}/{savedScore.maxScore}</span>}
          </div>

          {!editing && (
            <div style={{ border: '2px dashed var(--border)', borderRadius: 12, padding: 26, textAlign: 'center' }}>
              <div style={{ fontSize: '2rem', marginBottom: 6 }}>🗗</div>
              <div style={{ color: 'var(--text-light)', fontSize: '.9rem', marginBottom: 12 }}>
                Exercițiul se deschide în pagină separată, cu buton „Închide” — ca la PDF-uri.
              </div>
              <button className="btn btn-primary" onClick={() => navigate('/exercitiu-ai', { state: { html, title } })}>🗗 Deschide exercițiul</button>
            </div>
          )}

          {isTeacher && editing && (
            <div style={{ maxHeight: 460, overflowY: 'auto', border: '1px solid var(--border)', borderRadius: 10, padding: 12 }}>
              {questions.map((q, i) => (
                <div key={i} style={{ padding: 10, background: '#f7f9fc', borderRadius: 8, marginBottom: 10 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
                    <span style={{ fontSize: '.78rem', fontWeight: 700, color: 'var(--navy)' }}>Întrebarea {i + 1}</span>
                    <span style={{ display: 'flex', gap: 6 }}>
                      <button className="btn btn-sm btn-outline" onClick={() => toggleType(i)}>{Array.isArray(q.options) ? 'Fă răspuns liber' : 'Fă grilă'}</button>
                      <button onClick={() => delQ(i)} style={{ background: 'none', border: '1px solid #f5c6cb', color: '#c0392b', borderRadius: 6, padding: '2px 8px', fontSize: '.75rem', cursor: 'pointer' }}>🗑 Șterge</button>
                    </span>
                  </div>
                  <textarea rows={2} value={q.statement} onChange={(e) => patchQ(i, { statement: e.target.value })} placeholder="Enunț" style={eta} />
                  {Array.isArray(q.options) ? (
                    <>
                      {q.options.map((o, oi) => (
                        <div key={oi} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                          <input type="radio" checked={Number(q.answer) === oi} onChange={() => patchQ(i, { answer: oi })} title="corect" />
                          <input value={o} onChange={(e) => patchOpt(i, oi, e.target.value)} placeholder={`Varianta ${String.fromCharCode(97 + oi)})`} style={{ ...eta, marginTop: 0, marginBottom: 0 }} />
                        </div>
                      ))}
                      <div style={{ fontSize: '.72rem', color: 'var(--text-muted)', marginTop: 2 }}>Bifează varianta corectă.</div>
                    </>
                  ) : (
                    <input value={q.answer} onChange={(e) => patchQ(i, { answer: e.target.value })} placeholder="Răspuns corect (text)" style={eta} />
                  )}
                  <textarea rows={1} value={q.explanation || ''} onChange={(e) => patchQ(i, { explanation: e.target.value })} placeholder="Explicație (opțional)" style={eta} />
                </div>
              ))}
              <button className="btn btn-sm btn-outline" onClick={addQ}>➕ Adaugă întrebare</button>
            </div>
          )}

          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 12 }}>
            <button className="btn btn-outline btn-sm" onClick={() => exportPdf(false)}>📄 Export PDF</button>
            <button className="btn btn-outline btn-sm" onClick={() => exportPdf(true)}>📝 Cu răspunsuri</button>
            {(isTeacher || isParent) && (
              <SendToStudents create={() => aiClient.assignmentCreateInteractive({ questions, title, category: category || null, topic: topicShort })} />
            )}
            {isTeacher && <button className="btn btn-outline btn-sm" onClick={() => setEditing((e) => !e)}>{editing ? '✓ Gata editarea' : '✏️ Editează (text)'}</button>}
            {isTeacher && <button className="btn btn-outline btn-sm" onClick={async () => { setPublishMsg(null); try { const r = await aiClient.publicPublish({ kind: 'interactive', title, category: category || null, topic: topicShort, payload: { questions } }); setPublishMsg('✅ Publicat ca „' + (r?.title || title) + '".'); } catch (e) { setPublishMsg('Eroare: ' + e.message); } }}>🏛️ Publică</button>}
            <button className="btn btn-outline btn-sm" onClick={gen} disabled={loading}>🔄 Altul</button>
          </div>
          {publishMsg && <div style={{ marginTop: 8, fontSize: '.82rem', color: publishMsg.startsWith('✅') ? '#1e7e34' : '#b71c1c' }}>{publishMsg}</div>}
          <p style={{ fontSize: '.76rem', color: 'var(--text-muted)', marginTop: 10 }}>
            {isTeacher ? 'Editezi întrebările ca text (fără cod), poți adăuga sau șterge întrebări, apoi trimiți elevilor sau publici. ' : ''}
          </p>
        </div>
      )}
    </div>
  );
}

function LibraryTab() {
  const { isTeacher } = useAuth();
  const [items, setItems] = useState(null);
  const [loading, setLoading] = useState(true);

  async function load() { setLoading(true); setItems(await aiClient.listLibrary()); setLoading(false); }
  useEffect(() => { load(); }, []);

  async function remove(id) { await aiClient.deleteLibraryItem(id); setItems((x) => (x || []).filter((i) => i.id !== id)); }

  const card = { background: '#fff', border: '1px solid var(--border)', borderRadius: 'var(--radius-lg)', padding: 20, marginBottom: 18 };
  if (loading) return <div style={{ padding: 40, textAlign: 'center' }}><div className="spinner" /></div>;

  return (
    <div>
      {(!items || items.length === 0) ? (
        <div style={card}><p style={{ color: 'var(--text-muted)', fontSize: '.9rem', margin: 0 }}>Aici apar testele și exercițiile interactive pe care le generezi. Încă nu ai niciunul.</p></div>
      ) : (
        <div style={card}>
          <h3 style={{ fontFamily: 'var(--font-display)', color: 'var(--navy)', marginBottom: 4 }}>📚 Testele și exercițiile mele</h3>
          <p style={{ fontSize: '.8rem', color: 'var(--text-muted)', marginBottom: 14 }}>Private — vizibile doar pentru tine. {isTeacher ? 'Le poți deschide, edita și trimite elevilor ca temă.' : ''}</p>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {items.map((it) => <LibItem key={it.id} it={it} isTeacher={isTeacher} onRemove={() => remove(it.id)} />)}
          </div>
        </div>
      )}
    </div>
  );
}

function LibItem({ it, isTeacher, onRemove }) {
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [full, setFull] = useState(null);
  const [editing, setEditing] = useState(false);
  const [qs, setQs] = useState(null);
  const [msg, setMsg] = useState(null);

  async function toggle() {
    if (open) { setOpen(false); return; }
    if (!full) { const f = await aiClient.getLibraryItem(it.id); setFull(f); setQs(f?.payload?.questions ? structuredClone(f.payload.questions) : null); }
    setOpen(true);
  }
  function openExamPdf(withSol) { aiClient.getLibraryItem(it.id).then((f) => { if (f?.payload?.exam) printExam(f.payload.exam, { withSolutions: withSol }); }); }

  // Publică un subiect generat (kind 'exam' — JSON printabil; kind 'pdf' —
  // fișier combinat exact; serverul face o copie publică a fișierului).
  const [publishing, setPublishing] = useState(false);
  async function publishPdf() {
    setMsg(null); setPublishing(true);
    try {
      const f = full || await aiClient.getLibraryItem(it.id);
      if (!full) setFull(f);
      const payload = it.kind === 'exam' ? { exam: f?.payload?.exam } : (f?.payload || {});
      if (it.kind === 'exam' && !payload.exam) throw new Error('Subiectul nu a putut fi încărcat.');
      if (it.kind === 'pdf' && !payload.pdfPath && !payload.pdfBase64) throw new Error('PDF-ul nu a putut fi încărcat.');
      const r = await aiClient.publicPublish({ kind: it.kind, title: it.title || f?.title || 'Subiect', category: f?.category || null, topic: f?.topic || null, payload });
      setMsg('✅ Publicat în „Biblioteca utilizatorilor" ca „' + (r?.title || it.title) + '".');
    } catch (e) { setMsg('Eroare: ' + e.message); }
    finally { setPublishing(false); }
  }

  // scor la re-rezolvarea interactivului
  useEffect(() => {
    function onMsg(e) {
      if (e.source === window || !e.data || e.data.type !== 'MATE_SCORE' || !open) return;
      const { score, maxScore } = e.data;
      if (typeof score === 'number' && typeof maxScore === 'number' && maxScore > 0) aiClient.updateLibraryScore(it.id, score, maxScore).catch(() => {});
    }
    window.addEventListener('message', onMsg);
    return () => window.removeEventListener('message', onMsg);
  }, [open, it.id]);

  const patchQ = (i, patch) => setQs((a) => a.map((q, idx) => (idx === i ? { ...q, ...patch } : q)));
  const patchOpt = (i, oi, v) => setQs((a) => a.map((q, idx) => { if (idx !== i) return q; const o = [...(q.options || [])]; o[oi] = v; return { ...q, options: o }; }));
  const addQ = () => setQs((a) => [...(a || []), { statement: 'Enunț nou', options: ['', '', '', ''], answer: 0, explanation: '' }]);
  const delQ = (i) => setQs((a) => a.filter((_, idx) => idx !== i));

  const row = { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, flexWrap: 'wrap' };
  const box = { background: '#f7f9fc', borderRadius: 10, padding: '10px 12px' };
  const ta = { width: '100%', border: '1px solid var(--border)', borderRadius: 6, padding: '5px 7px', fontSize: '.8rem', marginTop: 3, marginBottom: 3 };
  const icon = it.kind === 'exam' ? '📄' : it.kind === 'practice' ? '✍️' : '🧩';

  return (
    <div style={box}>
      <div style={row}>
        <div>
          <div style={{ fontWeight: 600, color: 'var(--navy)', fontSize: '.9rem' }}>{icon} {it.title || 'Exercițiu'}</div>
          <div style={{ fontSize: '.75rem', color: 'var(--text-muted)' }}>
            {new Date(it.created_at).toLocaleDateString('ro-RO')}{it.score != null && it.max_score ? ` · scor ${it.score}/${it.max_score}` : ''}
          </div>
        </div>
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          {it.kind === 'exam' ? (
            <>
              <button className="btn btn-sm btn-outline" onClick={() => openExamPdf(false)}>📄 PDF</button>
              <button className="btn btn-sm btn-outline" onClick={() => openExamPdf(true)}>📝 Barem</button>
            </>
          ) : (
            <button className="btn btn-sm btn-outline" onClick={toggle}>{open ? '✕ Închide' : '▶ Deschide'}</button>
          )}
          {isTeacher && (it.kind === 'exam' || it.kind === 'pdf') && (
            <button className="btn btn-sm btn-outline" disabled={publishing} onClick={publishPdf}>
              {publishing ? '⏳ Se publică...' : '🏛️ Publică'}
            </button>
          )}
          <button className="btn btn-sm" style={{ color: '#c0392b' }} onClick={onRemove}>🗑</button>
        </div>
      </div>
      {!open && msg && <div style={{ marginTop: 8, fontSize: '.82rem', color: msg.startsWith('✅') ? '#1e7e34' : '#b71c1c' }}>{msg}</div>}

      {open && full && (
        <div style={{ marginTop: 10, paddingTop: 10, borderTop: '1px dashed var(--border)' }}>
          {full.kind === 'pdf' && (full.payload?.pdfPath || full.payload?.pdfBase64) && (
            <button className="btn btn-primary btn-sm" style={{ marginBottom: 8 }} onClick={async () => {
              // fereastra se deschide SINCRON (altfel browserul o blochează),
              // apoi primește PDF-ul descărcat din Storage sau din base64 (vechi)
              const w = window.open('', '_blank');
              try {
                const blob = await aiClient.getLibraryPdfBlob(full.payload);
                const url = URL.createObjectURL(blob);
                if (w) w.location = url; else window.open(url, '_blank');
              } catch (e) { if (w) w.close(); setMsg('Eroare: ' + (e?.message || 'PDF indisponibil')); }
            }}>📄 Deschide PDF-ul</button>
          )}

          {full.kind === 'interactive' && !editing && (full.payload?.questions || full.payload?.html) && (
            <>
              <button className="btn btn-outline btn-sm" style={{ marginBottom: 8 }} onClick={() => {
                const doc = full.payload.questions ? renderQuiz(full.title, qs || full.payload.questions) : full.payload.html;
                navigate('/exercitiu-ai', { state: { html: doc, title: full.title, mode: 'library', id: full.id } });
              }}>🗗 Deschide în pagină nouă</button>
              <iframe title="reluare" sandbox="allow-scripts" srcDoc={full.payload.questions ? renderQuiz(full.title, qs || full.payload.questions) : full.payload.html} style={{ width: '100%', height: 500, border: '1px solid var(--border)', borderRadius: 10, background: '#fff' }} />
            </>
          )}

          {full.kind === 'interactive' && editing && qs && (
            <div style={{ maxHeight: 380, overflowY: 'auto', border: '1px solid var(--border)', borderRadius: 8, padding: 10 }}>
              {qs.map((q, i) => (
                <div key={i} style={{ padding: 8, background: '#fff', borderRadius: 8, marginBottom: 8, border: '1px solid var(--border)' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                    <span style={{ fontSize: '.74rem', color: 'var(--text-muted)' }}>Întrebarea {i + 1}</span>
                    <button onClick={() => delQ(i)} style={{ background: 'none', border: '1px solid #f5c6cb', color: '#c0392b', borderRadius: 6, padding: '1px 7px', fontSize: '.72rem', cursor: 'pointer' }}>🗑</button>
                  </div>
                  <textarea rows={2} value={q.statement} onChange={(e) => patchQ(i, { statement: e.target.value })} style={ta} placeholder="Enunț" />
                  {Array.isArray(q.options) && q.options.map((o, oi) => (
                    <input key={oi} value={o} onChange={(e) => patchOpt(i, oi, e.target.value)} style={ta} placeholder={`Varianta ${String.fromCharCode(97 + oi)})`} />
                  ))}
                  {Array.isArray(q.options) && (
                    <input value={q.answer} onChange={(e) => patchQ(i, { answer: Number(e.target.value) })} style={ta} placeholder="Index răspuns corect (0-3)" />
                  )}
                </div>
              ))}
              <button className="btn btn-sm btn-outline" onClick={addQ}>➕ Adaugă întrebare</button>
            </div>
          )}

          {full.kind === 'practice' && (
            <div>
              <div style={{ fontSize: '.95rem', color: 'var(--navy)', marginBottom: 10 }}><MathText text={full.payload?.statement || ''} /></div>
              {full.payload?.solution && <details><summary style={{ cursor: 'pointer', fontWeight: 600, color: 'var(--navy)', fontSize: '.88rem' }}>Vezi rezolvarea</summary><div style={{ marginTop: 8 }}><MathText text={full.payload.solution} /></div></details>}
            </div>
          )}

          {/* Control profesor pentru interactive: editează + trimite + publică */}
          {isTeacher && full.kind === 'interactive' && qs && (
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 10 }}>
              <button className="btn btn-sm btn-outline" onClick={() => setEditing((e) => !e)}>{editing ? '✓ Gata editarea' : '✏️ Editează (text)'}</button>
              {editing && (
                <button className="btn btn-sm btn-primary" onClick={async () => {
                  setMsg(null);
                  try {
                    await aiClient.updateLibraryItem(it.id, { payload: { ...(full.payload || {}), questions: qs }, title: full.title });
                    setFull((f) => ({ ...f, payload: { ...(f.payload || {}), questions: qs } }));
                    setMsg('✅ Modificările au fost salvate.');
                  } catch (e) { setMsg('Eroare: ' + e.message); }
                }}>💾 Salvează modificările</button>
              )}
              <SendToStudents label="📤 Trimite elevilor" create={() => aiClient.assignmentCreateInteractive({ questions: qs, title: full.title, category: full.category || null, topic: full.topic || null })} />
              <button className="btn btn-sm btn-outline" onClick={async () => { setMsg(null); try { const r = await aiClient.publicPublish({ kind: 'interactive', title: full.title, category: full.category || null, topic: full.topic || null, payload: { questions: qs } }); setMsg('✅ Publicat ca „' + (r?.title || full.title) + '".'); } catch (e) { setMsg('Eroare: ' + e.message); } }}>🏛️ Publică</button>
            </div>
          )}
          {msg && <div style={{ marginTop: 8, fontSize: '.82rem', color: msg.startsWith('✅') ? '#1e7e34' : '#b71c1c' }}>{msg}</div>}
        </div>
      )}
    </div>
  );
}

// ─── PROGRES ─────────────────────────────────────────────────────────────────
function ProgressTab() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    aiClient.progress().then(setData).catch((e) => setError(e.message)).finally(() => setLoading(false));
  }, []);

  if (loading) return <div style={{ padding: 40, textAlign: 'center' }}><div className="spinner" /></div>;
  if (error) return <div style={{ padding: 20, color: '#b71c1c' }}>⚠️ {error}</div>;

  const card = { background: '#fff', border: '1px solid var(--border)', borderRadius: 'var(--radius-lg)', padding: 20, marginBottom: 18 };
  const masteryColor = (m) => (m >= 0.75 ? '#27ae60' : m >= 0.4 ? '#e8b931' : '#e74c3c');

  return (
    <div>
      {/* Stăpânirea pe subiecte */}
      <div style={card}>
        <h3 style={{ fontFamily: 'var(--font-display)', color: 'var(--navy)', marginBottom: 14 }}>Stăpânirea pe subiecte</h3>
        {data.mastery.length === 0 ? (
          <p style={{ color: 'var(--text-muted)', fontSize: '.9rem' }}>
            Încă nu ai exersat. Mergi la tabul <strong>Antrenament</strong> și rezolvă câteva exerciții —
            aici vei vedea progresul pe fiecare subiect.
          </p>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            {data.mastery.map((m) => (
              <div key={m.category + m.topic}>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '.85rem', marginBottom: 4 }}>
                  <span style={{ fontWeight: 600, color: 'var(--navy)' }}>{m.topic} <span style={{ color: 'var(--text-muted)', fontWeight: 400 }}>· {m.category}</span></span>
                  <span style={{ color: 'var(--text-muted)' }}>{Math.round(m.mastery * 100)}% · {m.correct}/{m.attempts}</span>
                </div>
                <div style={{ height: 8, background: 'var(--border)', borderRadius: 99, overflow: 'hidden' }}>
                  <div style={{ height: '100%', width: `${Math.round(m.mastery * 100)}%`, background: masteryColor(m.mastery), borderRadius: 99, transition: 'width .4s' }} />
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Recomandări */}
      {data.recommendations?.length > 0 && (
        <div style={card}>
          <h3 style={{ fontFamily: 'var(--font-display)', color: 'var(--navy)', marginBottom: 14 }}>Recomandări pentru tine</h3>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {data.recommendations.map((r, i) => (
              <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 12px', background: '#f7f9fc', borderRadius: 10, fontSize: '.9rem' }}>
                <span>{r.kind === 'practice' ? '✍️' : '🧩'}</span>
                {r.kind === 'practice'
                  ? <span>Exersează <strong>{r.topic}</strong> ({r.category}) — stăpânire {Math.round(r.mastery * 100)}%</span>
                  : <span>Încearcă exercițiul <strong>{r.title}</strong> ({r.category}){r.is_free ? '' : ' ⭐'}</span>}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function StatCard({ label, value }) {
  return (
    <div style={{ background: 'var(--navy)', color: '#fff', borderRadius: 'var(--radius-lg)', padding: 18 }}>
      <div style={{ fontSize: '2rem', fontWeight: 800, fontFamily: 'var(--font-display)', color: 'var(--gold)' }}>{value}</div>
      <div style={{ fontSize: '.8rem', opacity: 0.8, marginTop: 2 }}>{label}</div>
    </div>
  );
}
