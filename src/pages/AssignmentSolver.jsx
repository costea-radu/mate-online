// =====================================================================
// src/pages/AssignmentSolver.jsx — pagina „/tema?id=..."
// Elevul deschide tema primită de la profesor și o rezolvă.
// Rezultatul se salvează și apare în raportul profesorului/părintelui.
// =====================================================================
import { useState, useEffect } from 'react';
import { useSearchParams, Link } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { aiClient } from '../lib/aiClient';
import { MathText } from '../components/AITutor';
import { renderQuiz } from '../lib/quizRender';

export default function AssignmentSolver() {
  const [params] = useSearchParams();
  const id = params.get('id');
  const { user, loading: authLoading } = useAuth();

  const [task, setTask] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  // practice
  const [answer, setAnswer] = useState('');
  const [work, setWork] = useState('');
  const [result, setResult] = useState(null);
  const [submitting, setSubmitting] = useState(false);
  // interactive
  const [savedScore, setSavedScore] = useState(null);

  useEffect(() => {
    if (authLoading) return;
    if (!user) { setLoading(false); return; }
    if (!id) { setError('Link invalid.'); setLoading(false); return; }
    (async () => {
      try { setTask(await aiClient.assignmentGet({ id })); }
      catch (e) { setError(e.message); }
      finally { setLoading(false); }
    })();
  }, [authLoading, user, id]);

  // interactiv: preia scorul din iframe și îl trimite
  useEffect(() => {
    if (!task || task.kind !== 'interactive') return;
    async function onMsg(e) {
      if (e.source === window || !e.data || e.data.type !== 'MATE_SCORE') return;
      const { score, maxScore } = e.data;
      if (typeof score !== 'number' || typeof maxScore !== 'number' || maxScore <= 0) return;
      setSavedScore({ score, maxScore });
      try { await aiClient.assignmentSubmit({ id, score, maxScore }); } catch { /* ignore */ }
    }
    window.addEventListener('message', onMsg);
    return () => window.removeEventListener('message', onMsg);
  }, [task, id]);

  async function submitPractice() {
    setSubmitting(true); setError(null);
    try { setResult(await aiClient.assignmentSubmit({ id, answer, work })); }
    catch (e) { setError(e.message); }
    finally { setSubmitting(false); }
  }

  const wrap = { maxWidth: 800, margin: '0 auto', padding: '32px 20px 60px' };
  const card = { background: '#fff', border: '1px solid var(--border)', borderRadius: 'var(--radius-lg)', padding: 22, marginBottom: 18 };
  const inp = { border: '1px solid var(--border)', borderRadius: 8, padding: '9px 11px', fontSize: '.95rem', width: '100%' };

  if (authLoading || loading) return <div style={{ padding: 60, textAlign: 'center' }}><div className="spinner" /></div>;

  if (!user) return (
    <div style={wrap}><div style={{ ...card, textAlign: 'center' }}>
      <div style={{ fontSize: '2.5rem', marginBottom: 10 }}>🔒</div>
      <p style={{ color: 'var(--text-light)', marginBottom: 16 }}>Autentifică-te ca să rezolvi tema primită de la profesor.</p>
      <Link to={`/autentificare?redirect=${encodeURIComponent(`/tema?id=${id || ''}`)}`} className="btn btn-primary">Autentificare</Link>
    </div></div>
  );

  if (error && !task) return <div style={wrap}><div style={{ ...card, color: '#b71c1c' }}>⚠️ {error}</div></div>;
  if (!task) return null;

  return (
    <div style={wrap}>
      <div style={{ marginBottom: 18 }}>
        <div style={{ fontSize: '.78rem', color: 'var(--gold-dim)', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.04em' }}>
          Temă de la {task.creatorRole === 'parinte' ? 'părintele' : 'profesorul'} {task.creator || ''}
        </div>
        <h1 style={{ fontFamily: 'var(--font-display)', color: 'var(--navy)', fontSize: '1.6rem' }}>{task.title}</h1>
      </div>

      {task.kind === 'interactive' ? (
        <div style={card}>
          {savedScore && (
            <div style={{ marginBottom: 12, padding: '10px 12px', borderRadius: 8, background: 'rgba(39,174,96,.1)', color: '#1e7e34', fontWeight: 700 }}>
              ✓ Rezultat trimis profesorului: {savedScore.score}/{savedScore.maxScore}
            </div>
          )}
          <iframe title="tema" sandbox="allow-scripts" srcDoc={task.questions ? renderQuiz(task.title, task.questions) : task.html} style={{ width: '100%', height: 560, border: '1px solid var(--border)', borderRadius: 10, background: '#fff' }} />
        </div>
      ) : (
        <div style={card}>
          <div style={{ fontSize: '1.1rem', color: 'var(--navy)', lineHeight: 1.6, marginBottom: 18 }}><MathText text={task.statement} /></div>

          {error && <div style={{ padding: 10, background: '#fdecea', color: '#b71c1c', borderRadius: 8, fontSize: '.85rem', marginBottom: 12 }}>⚠️ {error}</div>}

          {!result ? (
            <>
              {task.answer_type === 'choice' && task.options?.length ? (
                <div style={{ marginBottom: 12 }}>
                  {task.options.map((o, i) => (
                    <label key={i} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '9px 11px', border: '1px solid var(--border)', borderRadius: 8, marginBottom: 6, cursor: 'pointer', background: answer === o ? 'rgba(232,185,49,.12)' : '#fff' }}>
                      <input type="radio" name="opt" checked={answer === o} onChange={() => setAnswer(o)} />
                      <strong style={{ color: 'var(--navy)' }}>{String.fromCharCode(65 + i)})</strong>
                      <span style={{ flex: 1 }}><MathText text={o} /></span>
                    </label>
                  ))}
                </div>
              ) : (
                <input value={answer} onChange={(e) => setAnswer(e.target.value)}
                  inputMode={task.answer_type === 'numeric' ? 'decimal' : 'text'}
                  placeholder={task.answer_type === 'numeric' ? 'Răspunsul tău (număr)' : 'Răspunsul tău final'}
                  style={{ ...inp, marginBottom: 10 }} />
              )}
              <textarea value={work} onChange={(e) => setWork(e.target.value)} placeholder="Pașii tăi (opțional)" rows={4} style={{ ...inp, marginBottom: 12, resize: 'vertical' }} />
              <button className="btn btn-primary" onClick={submitPractice} disabled={submitting || !answer.trim()}>
                {submitting ? 'Se trimite...' : '✓ Trimite rezolvarea'}
              </button>
            </>
          ) : (
            <div style={{ padding: 16, borderRadius: 12, background: result.correct ? 'rgba(39,174,96,.1)' : 'rgba(231,76,60,.08)', border: `1px solid ${result.correct ? 'rgba(39,174,96,.3)' : 'rgba(231,76,60,.25)'}` }}>
              <div style={{ fontWeight: 800, fontSize: '1.1rem', color: result.correct ? '#1e7e34' : '#c0392b', marginBottom: 8 }}>
                {result.correct ? '🎉 Corect!' : '❌ Nu chiar'} · {result.score}/{result.maxScore} <span style={{ fontWeight: 500, fontSize: '.8rem', color: 'var(--text-muted)' }}>(trimis profesorului)</span>
              </div>
              {result.feedback && <div style={{ fontSize: '.92rem', marginBottom: 12 }}><MathText text={result.feedback} /></div>}
              {result.solution && (
                <details>
                  <summary style={{ cursor: 'pointer', fontWeight: 600, color: 'var(--navy)', fontSize: '.9rem' }}>Vezi rezolvarea</summary>
                  <div style={{ marginTop: 8, fontSize: '.9rem', lineHeight: 1.6 }}><MathText text={result.solution} /></div>
                </details>
              )}
            </div>
          )}
        </div>
      )}

      <Link to="/profesor-virtual" style={{ fontSize: '.85rem', color: 'var(--navy)', fontWeight: 600 }}>← Profesor Virtual</Link>
    </div>
  );
}
