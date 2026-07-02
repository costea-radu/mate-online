// =====================================================================
// src/pages/ProfesorVirtual.jsx — pagina dedicată a tutorelui AI
// Tab-uri: Întreabă profesorul · Antrenament · Progresul meu
// =====================================================================
import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { ChatPanel, MathText } from '../components/AITutor';
import { aiClient } from '../lib/aiClient';
import { useAuth } from '../context/AuthContext';
import { printExam, printExercise } from '../lib/examPrint';
import ExamGenerator from '../components/ExamGenerator';

const CATEGORIES = [
  { id: '', label: 'Toate' },
  { id: 'clasa-5', label: 'Clasa 5' }, { id: 'clasa-6', label: 'Clasa 6' },
  { id: 'clasa-7', label: 'Clasa 7' }, { id: 'clasa-8', label: 'Clasa 8' },
  { id: 'evaluare-nationala', label: 'Evaluare Națională' },
  { id: 'bacalaureat', label: 'Bacalaureat' },
];
const DIFFS = ['ușor', 'mediu', 'greu'];

export default function ProfesorVirtual() {
  const { user, loading } = useAuth();
  const [tab, setTab] = useState('chat');

  if (loading) return <div style={{ padding: 60, textAlign: 'center' }}><div className="spinner" /></div>;

  return (
    <div style={{ maxWidth: 'var(--container)', margin: '0 auto', padding: '32px 20px 60px' }}>
      {/* Hero */}
      <div style={{ marginBottom: 24 }}>
        <h1 style={{ fontFamily: 'var(--font-display)', fontSize: 'clamp(1.8rem,4vw,2.6rem)', color: 'var(--navy)', marginBottom: 6 }}>
          🎓 Profesor Virtual
        </h1>
        <p style={{ color: 'var(--text-light)', maxWidth: 620 }}>
          Tutorele tău AI care învață din toate exercițiile și explicațiile de pe ExamenMate.
          Cere explicații, indicii, exerciții noi de antrenament și urmărește-ți progresul.
        </p>
      </div>

      {/* Tab-uri */}
      <div style={{ display: 'flex', gap: 8, borderBottom: '2px solid var(--border)', marginBottom: 24, flexWrap: 'wrap' }}>
        {[
          { id: 'chat', label: '💬 Întreabă profesorul' },
          { id: 'exam', label: '📄 Generează subiect examen' },
          { id: 'practice', label: '✍️ Generează exerciții PDF' },
          { id: 'interactive', label: '🧩 Interactiv' },
          { id: 'library', label: '📚 Testele mele' },
          { id: 'progress', label: '📈 Progresul meu' },
        ].map((t) => (
          <button key={t.id} onClick={() => setTab(t.id)}
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
          {tab === 'practice' && <PracticeTab />}
          {tab === 'interactive' && <InteractiveTab />}
          {tab === 'exam' && <ExamGenerator />}
          {tab === 'library' && <LibraryTab />}
          {tab === 'progress' && <ProgressTab />}
        </>
      )}
    </div>
  );
}

// ─── ANTRENAMENT ─────────────────────────────────────────────────────────────
function PracticeTab() {
  const [category, setCategory] = useState('');
  const [topic, setTopic] = useState('');
  const [difficulty, setDifficulty] = useState('mediu');
  const [exercise, setExercise] = useState(null);
  const [token, setToken] = useState(null);
  const [answer, setAnswer] = useState('');
  const [work, setWork] = useState('');
  const [result, setResult] = useState(null);
  const [revealedHints, setRevealedHints] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [upsell, setUpsell] = useState(false);
  const [exporting, setExporting] = useState(false);

  async function gen() {
    setLoading(true); setError(null); setResult(null); setAnswer(''); setWork(''); setRevealedHints(0); setUpsell(false);
    try {
      const res = await aiClient.generate({ category: category || null, topic, difficulty });
      setExercise(res.exercise); setToken(res.token);
    } catch (e) { setError(e.message); if (e.premium) setUpsell(true); }
    finally { setLoading(false); }
  }

  async function verify() {
    if (!token) return;
    setLoading(true); setError(null);
    try {
      const res = await aiClient.check({ token, studentAnswer: answer, studentWork: work });
      setResult(res);
    } catch (e) { setError(e.message); if (e.premium) setUpsell(true); }
    finally { setLoading(false); }
  }

  async function exportPdf() {
    if (!token) return;
    setExporting(true); setError(null);
    try {
      const full = await aiClient.reveal({ token });
      printExercise({ ...full, options: exercise?.options });
    } catch (e) { setError(e.message); if (e.premium) setUpsell(true); }
    finally { setExporting(false); }
  }

  const card = { background: '#fff', border: '1px solid var(--border)', borderRadius: 'var(--radius-lg)', padding: 20, marginBottom: 18 };
  const inp = { border: '1px solid var(--border)', borderRadius: 8, padding: '9px 11px', fontSize: '.9rem', fontFamily: 'var(--font-body)' };

  return (
    <div>
      {/* Configurare */}
      <div style={card}>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(150px,1fr))', gap: 12, marginBottom: 14 }}>
          <label style={{ fontSize: '.85rem', color: 'var(--text-light)' }}>
            Categorie
            <select value={category} onChange={(e) => setCategory(e.target.value)} style={{ ...inp, width: '100%', marginTop: 4 }}>
              {CATEGORIES.map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}
            </select>
          </label>
          <label style={{ fontSize: '.85rem', color: 'var(--text-light)' }}>
            Subiect (opțional)
            <input value={topic} onChange={(e) => setTopic(e.target.value)} placeholder="ex: ecuații, fracții, arii"
              style={{ ...inp, width: '100%', marginTop: 4 }} />
          </label>
          <label style={{ fontSize: '.85rem', color: 'var(--text-light)' }}>
            Dificultate
            <select value={difficulty} onChange={(e) => setDifficulty(e.target.value)} style={{ ...inp, width: '100%', marginTop: 4 }}>
              {DIFFS.map((d) => <option key={d} value={d}>{d}</option>)}
            </select>
          </label>
        </div>
        <button className="btn btn-primary" onClick={gen} disabled={loading}>
          {loading && !exercise ? 'Se generează...' : '✨ Generează un exercițiu nou'}
        </button>
      </div>

      {error && <div style={{ ...card, background: '#fdecea', color: '#b71c1c', borderColor: '#f5c6cb' }}>⚠️ {error}</div>}

      {upsell && (
        <div style={{ ...card, background: '#fff4e5', borderColor: 'var(--gold)', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
          <span style={{ color: 'var(--navy)', fontWeight: 600 }}>🔒 Antrenamentul nelimitat și exportul PDF fac parte din abonament.</span>
          <Link to="/preturi" className="btn btn-primary">Abonează-te →</Link>
        </div>
      )}

      {/* Exercițiul */}
      {exercise && (
        <div style={card}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
            <span style={{ fontSize: '.72rem', fontWeight: 700, color: 'var(--gold-dim)', textTransform: 'uppercase', letterSpacing: '.04em' }}>
              {exercise.topic || 'Exercițiu'} · {exercise.difficulty}
            </span>
          </div>
          <div style={{ fontSize: '1.05rem', color: 'var(--navy)', lineHeight: 1.6, marginBottom: 16 }}>
            <MathText text={exercise.statement} />
          </div>

          {/* Indicii la cerere */}
          {exercise.hints?.length > 0 && (
            <div style={{ marginBottom: 16 }}>
              {revealedHints < exercise.hints.length && (
                <button onClick={() => setRevealedHints((h) => h + 1)}
                  style={{ background: 'none', border: '1px dashed var(--gold)', color: 'var(--gold-dim)', borderRadius: 8, padding: '6px 12px', fontSize: '.82rem', fontWeight: 600 }}>
                  💡 Arată un indiciu ({revealedHints}/{exercise.hints.length})
                </button>
              )}
              {exercise.hints.slice(0, revealedHints).map((h, i) => (
                <div key={i} style={{ marginTop: 8, padding: '8px 12px', background: 'rgba(232,185,49,.1)', borderRadius: 8, fontSize: '.88rem', color: 'var(--text)' }}>
                  💡 <MathText text={h} />
                </div>
              ))}
            </div>
          )}

          {/* Răspuns */}
          {!result && (
            <>
              {exercise.answer_type === 'choice' && exercise.options?.length ? (
                <div style={{ marginBottom: 12 }}>
                  {exercise.options.map((o, i) => (
                    <label key={i} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 10px', border: '1px solid var(--border)', borderRadius: 8, marginBottom: 6, cursor: 'pointer', background: answer === o ? 'rgba(232,185,49,.12)' : '#fff' }}>
                      <input type="radio" name="opt" checked={answer === o} onChange={() => setAnswer(o)} />
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
              <textarea value={work} onChange={(e) => setWork(e.target.value)} placeholder="Pașii tăi (opțional — profesorul îți spune unde greșești)"
                rows={4} style={{ ...inp, width: '100%', marginBottom: 12, resize: 'vertical' }} />
              <button className="btn btn-primary" onClick={verify} disabled={loading || !answer.trim()}>
                {loading ? 'Se verifică...' : '✓ Verifică rezolvarea'}
              </button>
            </>
          )}

          {/* Rezultat */}
          {result && (
            <div style={{
              marginTop: 6, padding: 16, borderRadius: 12,
              background: result.correct ? 'rgba(39,174,96,.1)' : 'rgba(231,76,60,.08)',
              border: `1px solid ${result.correct ? 'rgba(39,174,96,.3)' : 'rgba(231,76,60,.25)'}`,
            }}>
              <div style={{ fontWeight: 800, fontSize: '1.1rem', color: result.correct ? '#1e7e34' : '#c0392b', marginBottom: 8 }}>
                {result.correct ? '🎉 Corect!' : '❌ Nu chiar'} · {result.score}/100
              </div>
              <div style={{ fontSize: '.92rem', marginBottom: 12 }}><MathText text={result.feedback} /></div>
              <details>
                <summary style={{ cursor: 'pointer', fontWeight: 600, color: 'var(--navy)', fontSize: '.9rem' }}>Vezi rezolvarea completă</summary>
                <div style={{ marginTop: 8, fontSize: '.9rem', color: 'var(--text)', lineHeight: 1.6 }}><MathText text={result.solution} /></div>
              </details>
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 14 }}>
                <button className="btn btn-primary" onClick={gen} disabled={loading}>➡️ Următorul exercițiu</button>
                <button className="btn btn-outline" onClick={exportPdf} disabled={exporting}>
                  {exporting ? 'Se pregătește...' : '📄 Exportă PDF'}
                </button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ─── EXERCIȚII INTERACTIVE (generare + rezolvare + scor salvat privat) ───────
function InteractiveTab() {
  const [category, setCategory] = useState('');
  const [topic, setTopic] = useState('');
  const [difficulty, setDifficulty] = useState('mediu');
  const [html, setHtml] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [upsell, setUpsell] = useState(false);
  const [savedScore, setSavedScore] = useState(null);
  const [itemId, setItemId] = useState(null);

  // Capturează scorul din iframe (MATE_SCORE) și îl salvează în biblioteca personală.
  useEffect(() => {
    async function onMsg(e) {
      if (!e.data || e.data.type !== 'MATE_SCORE') return;
      const { score, maxScore } = e.data;
      if (typeof score !== 'number' || typeof maxScore !== 'number' || maxScore <= 0) return;
      setSavedScore({ score, maxScore });
      try {
        if (itemId) await aiClient.updateLibraryScore(itemId, score, maxScore);
        else {
          const id = await aiClient.saveLibraryItem({
            kind: 'interactive', title: `Exercițiu interactiv · ${topic || category || 'matematică'}`,
            category: category || null, topic: topic || null, payload: { html }, score, max_score: maxScore,
            completed_at: new Date().toISOString(),
          });
          setItemId(id);
        }
      } catch { /* ignore */ }
    }
    window.addEventListener('message', onMsg);
    return () => window.removeEventListener('message', onMsg);
  }, [itemId, html, topic, category]);

  async function gen() {
    setLoading(true); setError(null); setUpsell(false); setHtml(''); setSavedScore(null); setItemId(null);
    try { const res = await aiClient.generateInteractive({ category: category || null, topic, difficulty }); setHtml(res.html); }
    catch (e) { setError(e.message); if (e.premium) setUpsell(true); }
    finally { setLoading(false); }
  }

  const card = { background: '#fff', border: '1px solid var(--border)', borderRadius: 'var(--radius-lg)', padding: 20, marginBottom: 18 };
  const inp = { border: '1px solid var(--border)', borderRadius: 8, padding: '9px 11px', fontSize: '.9rem', width: '100%', marginTop: 4 };

  return (
    <div>
      <div style={card}>
        <p style={{ color: 'var(--text-light)', fontSize: '.9rem', marginBottom: 14 }}>
          Generează un exercițiu <strong>interactiv</strong> (cu întrebări și punctaj) și rezolvă-l pe loc. Scorul se salvează automat în <strong>„Testele mele"</strong> — privat, doar pentru tine.
        </p>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(150px,1fr))', gap: 12, marginBottom: 12 }}>
          <label style={{ fontSize: '.85rem', color: 'var(--text-light)' }}>Categorie
            <select value={category} onChange={(e) => setCategory(e.target.value)} style={inp}>
              {CATEGORIES.map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}
            </select>
          </label>
          <label style={{ fontSize: '.85rem', color: 'var(--text-light)' }}>Subiect (opțional)
            <input value={topic} onChange={(e) => setTopic(e.target.value)} placeholder="ex: fracții, ecuații" style={inp} />
          </label>
          <label style={{ fontSize: '.85rem', color: 'var(--text-light)' }}>Dificultate
            <select value={difficulty} onChange={(e) => setDifficulty(e.target.value)} style={inp}>
              {DIFFS.map((d) => <option key={d} value={d}>{d}</option>)}
            </select>
          </label>
        </div>
        <button className="btn btn-primary" onClick={gen} disabled={loading}>
          {loading ? 'Se generează... (~20s)' : '✨ Generează exercițiu interactiv'}
        </button>
      </div>

      {error && <div style={{ ...card, background: '#fdecea', color: '#b71c1c', borderColor: '#f5c6cb' }}>⚠️ {error}</div>}
      {upsell && (
        <div style={{ ...card, background: '#fff4e5', borderColor: 'var(--gold)', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
          <span style={{ color: 'var(--navy)', fontWeight: 600 }}>🔒 Exercițiile interactive AI fac parte din abonament.</span>
          <Link to="/preturi" className="btn btn-primary">Abonează-te →</Link>
        </div>
      )}

      {html && (
        <div style={card}>
          {savedScore && (
            <div style={{ marginBottom: 12, padding: '8px 12px', borderRadius: 8, background: 'rgba(39,174,96,.1)', color: '#1e7e34', fontWeight: 700, fontSize: '.9rem' }}>
              ✓ Scor salvat în „Testele mele": {savedScore.score}/{savedScore.maxScore}
            </div>
          )}
          <iframe title="exercițiu" srcDoc={html} style={{ width: '100%', height: 520, border: '1px solid var(--border)', borderRadius: 10, background: '#fff' }} />
          <p style={{ fontSize: '.76rem', color: 'var(--text-muted)', marginTop: 10 }}>
            Vrei ca acest exercițiu să fie public, pentru toți elevii? Doar un administrator îl poate publica în conținut.
          </p>
        </div>
      )}
    </div>
  );
}

// ─── BIBLIOTECA PERSONALĂ („Testele mele") ───────────────────────────────────
function LibraryTab() {
  const [items, setItems] = useState(null);
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState(null); // item complet deschis (interactiv)

  async function load() { setLoading(true); setItems(await aiClient.listLibrary()); setLoading(false); }
  useEffect(() => { load(); }, []);

  // scor la re-rezolvarea unui interactiv din bibliotecă
  useEffect(() => {
    async function onMsg(e) {
      if (!e.data || e.data.type !== 'MATE_SCORE' || !open) return;
      const { score, maxScore } = e.data;
      if (typeof score !== 'number' || typeof maxScore !== 'number' || maxScore <= 0) return;
      try { await aiClient.updateLibraryScore(open.id, score, maxScore); await load(); } catch { /* ignore */ }
    }
    window.addEventListener('message', onMsg);
    return () => window.removeEventListener('message', onMsg);
  }, [open]);

  async function openItem(it) { setOpen(await aiClient.getLibraryItem(it.id)); }
  async function remove(id) { await aiClient.deleteLibraryItem(id); setItems((x) => (x || []).filter((i) => i.id !== id)); if (open?.id === id) setOpen(null); }
  function openExamPdf(it, withSol) { aiClient.getLibraryItem(it.id).then((full) => { if (full?.payload?.exam) printExam(full.payload.exam, { withSolutions: withSol }); }); }

  const card = { background: '#fff', border: '1px solid var(--border)', borderRadius: 'var(--radius-lg)', padding: 20, marginBottom: 18 };
  if (loading) return <div style={{ padding: 40, textAlign: 'center' }}><div className="spinner" /></div>;

  return (
    <div>
      {(!items || items.length === 0) ? (
        <div style={card}><p style={{ color: 'var(--text-muted)', fontSize: '.9rem', margin: 0 }}>Aici apar testele și exercițiile interactive pe care le generezi și le rezolvi. Încă nu ai niciunul.</p></div>
      ) : (
        <div style={card}>
          <h3 style={{ fontFamily: 'var(--font-display)', color: 'var(--navy)', marginBottom: 4 }}>📚 Testele mele</h3>
          <p style={{ fontSize: '.8rem', color: 'var(--text-muted)', marginBottom: 14 }}>Private — vizibile doar pentru tine.</p>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {items.map((it) => (
              <div key={it.id} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, padding: '10px 12px', background: '#f7f9fc', borderRadius: 10, flexWrap: 'wrap' }}>
                <div>
                  <div style={{ fontWeight: 600, color: 'var(--navy)', fontSize: '.9rem' }}>
                    {it.kind === 'exam' ? '📄' : '🧩'} {it.title || (it.kind === 'exam' ? 'Test' : 'Exercițiu interactiv')}
                  </div>
                  <div style={{ fontSize: '.75rem', color: 'var(--text-muted)' }}>
                    {new Date(it.created_at).toLocaleDateString('ro-RO')}
                    {it.score != null && it.max_score ? ` · scor ${it.score}/${it.max_score}` : ''}
                  </div>
                </div>
                <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                  {it.kind === 'exam' ? (
                    <>
                      <button className="btn btn-sm btn-outline" onClick={() => openExamPdf(it, false)}>📄 PDF</button>
                      <button className="btn btn-sm btn-outline" onClick={() => openExamPdf(it, true)}>📝 Barem</button>
                    </>
                  ) : (
                    <button className="btn btn-sm btn-outline" onClick={() => openItem(it)}>▶ Redeschide</button>
                  )}
                  <button className="btn btn-sm" style={{ color: '#c0392b' }} onClick={() => remove(it.id)}>🗑</button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {open && open.kind === 'interactive' && open.payload?.html && (
        <div style={card}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
            <strong style={{ color: 'var(--navy)' }}>{open.title}</strong>
            <button className="btn btn-sm btn-outline" onClick={() => setOpen(null)}>✕ Închide</button>
          </div>
          <iframe title="reluare" srcDoc={open.payload.html} style={{ width: '100%', height: 520, border: '1px solid var(--border)', borderRadius: 10, background: '#fff' }} />
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
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(160px,1fr))', gap: 14, marginBottom: 18 }}>
        <StatCard label="Exerciții interactive rezolvate" value={data.interactive.completed} />
        <StatCard label="Scor mediu" value={data.interactive.avgPercent != null ? data.interactive.avgPercent + '%' : '—'} />
        <StatCard label="Subiecte exersate cu AI" value={data.mastery.length} />
      </div>

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
