// =====================================================================
// src/pages/BibliotecaUtilizatorilor.jsx — teste/exerciții publicate de profesori
// Rută: /biblioteca-utilizatorilor (NU în Navbar; e în burger + Home + Căutare)
// Neabonații pot deschide doar primele 3; restul necesită abonament.
// Exercițiul se deschide inline, sub cardul lui.
// =====================================================================
import { useState, useEffect } from 'react';
import { useSearchParams, Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { aiClient } from '../lib/aiClient';
import { printExam } from '../lib/examPrint';
import { MathText } from '../components/AITutor';
import { renderQuiz } from '../lib/quizRender';
import SendToStudents from '../components/SendToStudents';

const CATS = [
  { id: '', label: 'Toate' },
  { id: 'clasa-5', label: 'Clasa a V-a' }, { id: 'clasa-6', label: 'Clasa a VI-a' },
  { id: 'clasa-7', label: 'Clasa a VII-a' }, { id: 'clasa-8', label: 'Clasa a VIII-a' },
  { id: 'evaluare-nationala', label: 'Evaluare Națională' }, { id: 'bacalaureat', label: 'Bacalaureat' },
];
const KIND_ICON = { exam: '📄', practice: '✍️', interactive: '🧩' };
const FREE_LIMIT = 3;

export default function BibliotecaUtilizatorilor() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const { user, isAdmin, isPremium, isStudent } = useAuth();
  const [q, setQ] = useState(params.get('q') || '');
  const [category, setCategory] = useState('');
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState(null); // itemul complet deschis (inline)

  const locked = !isPremium && !isAdmin; // neabonat → acces limitat

  async function load() {
    setLoading(true);
    try { const { items } = await aiClient.publicList({ q, category }); setItems(items || []); }
    catch { setItems([]); }
    finally { setLoading(false); }
  }
  useEffect(() => { load(); /* eslint-disable-next-line */ }, [category]);
  useEffect(() => { const t = setTimeout(load, 350); return () => clearTimeout(t); /* eslint-disable-next-line */ }, [q]);

  // Înregistrează scorul când un elev logat rezolvă un exercițiu interactiv din bibliotecă
  useEffect(() => {
    if (!open || open.kind !== 'interactive' || !user) return;
    function onMsg(e) {
      if (e.source === window || !e.data || e.data.type !== 'MATE_SCORE') return;
      const { score, maxScore } = e.data;
      if (typeof score === 'number' && typeof maxScore === 'number' && maxScore > 0) {
        aiClient.publicRecord({ id: open.id, score, maxScore }).catch(() => {});
      }
    }
    window.addEventListener('message', onMsg);
    return () => window.removeEventListener('message', onMsg);
  }, [open, user]);

  async function del(id) {
    if (!window.confirm('Ștergi acest test din biblioteca publică?')) return;
    try { await aiClient.publicDelete({ id }); setItems((it) => it.filter((x) => x.id !== id)); if (open?.id === id) setOpen(null); } catch { /* ignore */ }
  }

  async function toggleFree(it) {
    const next = !it.is_free;
    try {
      await aiClient.publicSetFree({ id: it.id, isFree: next });
      setItems((arr) => arr.map((x) => (x.id === it.id ? { ...x, is_free: next } : x)));
    } catch (e) { alert('Eroare: ' + e.message); }
  }

  async function openItem(it) {
    if (open?.id === it.id) { setOpen(null); return; } // toggle
    try {
      const { item } = await aiClient.publicGet({ id: it.id });
      if (item.kind === 'exam') { printExam(item.payload.exam, { withSolutions: false }); }
      else if (item.kind === 'interactive' && (item.payload?.questions || item.payload?.html)) {
        // pagină nouă cu buton „Închide”, exact ca la PDF-uri
        const doc = item.payload.questions ? renderQuiz(item.title, item.payload.questions) : item.payload.html;
        navigate('/exercitiu-ai', { state: { html: doc, title: item.title, mode: user ? 'public' : null, id: item.id } });
      }
      else setOpen(item);
    } catch (e) {
      if (e.premium) alert('Acest test necesită abonament. Fără abonament poți deschide doar testele marcate „Gratuit".');
    }
  }

  const wrap = { maxWidth: 900, margin: '0 auto', padding: '32px 20px 60px' };
  const card = { background: '#fff', border: '1px solid var(--border)', borderRadius: 'var(--radius-lg)', padding: 18, marginBottom: 12 };
  const inp = { border: '1px solid var(--border)', borderRadius: 8, padding: '10px 12px', fontSize: '.95rem' };

  function Viewer({ item }) {
    return (
      <div style={{ marginTop: 12, paddingTop: 12, borderTop: '1px dashed var(--border)' }}>
        {item.kind === 'interactive' && (item.payload?.questions || item.payload?.html) && (
          <iframe title="exercițiu" sandbox="allow-scripts" srcDoc={item.payload.questions ? renderQuiz(item.title, item.payload.questions) : item.payload.html} style={{ width: '100%', height: 560, border: '1px solid var(--border)', borderRadius: 10 }} />
        )}
        {item.kind === 'practice' && (
          <div>
            <div style={{ fontSize: '1.05rem', color: 'var(--navy)', marginBottom: 10 }}><MathText text={item.payload?.statement || ''} /></div>
            {Array.isArray(item.payload?.options) && item.payload.options.length > 0 && (
              <div style={{ marginBottom: 10 }}>{item.payload.options.map((o, i) => <div key={i} style={{ padding: '4px 0' }}><strong>{String.fromCharCode(65 + i)})</strong> <MathText text={o} /></div>)}</div>
            )}
            {item.payload?.solution && (
              <details><summary style={{ cursor: 'pointer', fontWeight: 600, color: 'var(--navy)' }}>Vezi rezolvarea</summary>
                <div style={{ marginTop: 8 }}><MathText text={item.payload.solution} /></div>
              </details>
            )}
          </div>
        )}
      </div>
    );
  }

  return (
    <div style={wrap}>
      <h1 style={{ fontFamily: 'var(--font-display)', color: 'var(--navy)', fontSize: 'clamp(1.7rem,4vw,2.4rem)', marginBottom: 6 }}>🏛️ Biblioteca utilizatorilor</h1>
      <p style={{ color: 'var(--text-light)', marginBottom: 16 }}>Teste și exerciții create și publicate de profesori cu Profesorul Virtual.</p>

      {locked && (
        <div style={{ ...card, background: '#fff4e5', borderColor: 'var(--gold)', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
          <span style={{ color: 'var(--navy)', fontWeight: 600, fontSize: '.9rem' }}>🔒 Fără abonament poți deschide doar testele marcate „Gratuit". Restul se deblochează cu abonament.</span>
          <Link to="/preturi" className="btn btn-primary btn-sm">Abonează-te →</Link>
        </div>
      )}

      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginBottom: 18 }}>
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="🔍 Caută după titlu sau conținut..." style={{ ...inp, flex: 1, minWidth: 200 }} />
        <select value={category} onChange={(e) => setCategory(e.target.value)} style={inp}>
          {CATS.map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}
        </select>
      </div>

      {loading ? <div style={{ padding: 40, textAlign: 'center' }}><div className="spinner" /></div>
        : items.length === 0 ? <div style={card}><p style={{ color: 'var(--text-muted)', margin: 0 }}>Niciun rezultat. Profesorii pot publica teste din „Profesor Virtual".</p></div>
        : (
          <div>
            {items.map((it, idx) => {
              const isLocked = locked && !it.is_free;
              const isOpen = open?.id === it.id;
              return (
                <div key={it.id} style={{ ...card, opacity: isLocked ? 0.6 : 1 }}>
                  <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12, flexWrap: 'wrap' }}>
                    <div style={{ fontSize: '1.6rem' }}>{KIND_ICON[it.kind] || '📘'}</div>
                    <div style={{ flex: 1, minWidth: 180 }}>
                      <div style={{ fontWeight: 700, color: 'var(--navy)', fontSize: '.98rem' }}>
                        {it.title}
                        {it.is_free && <span style={{ marginLeft: 8, fontSize: '.68rem', fontWeight: 700, color: '#1e7e34', background: 'rgba(39,174,96,.12)', border: '1px solid rgba(39,174,96,.35)', borderRadius: 6, padding: '1px 6px' }}>GRATUIT</span>}
                      </div>
                      <div style={{ fontSize: '.76rem', color: 'var(--text-muted)' }}>
                        {it.creator_role === 'parinte' ? 'Părinte' : 'Prof.'} {it.creator_name || ''} · {new Date(it.created_at).toLocaleDateString('ro-RO')}
                      </div>
                    </div>
                    <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
                      {isLocked ? (
                        <Link to="/preturi" className="btn btn-sm" style={{ background: 'var(--gold)', color: 'var(--navy)', fontWeight: 700 }}>🔒 Deblochează</Link>
                      ) : (
                        <button className="btn btn-sm btn-primary" onClick={() => openItem(it)}>
                          {it.kind === 'exam' ? '📄 Deschide PDF' : (isOpen ? '✕ Închide' : '▶ Deschide')}
                        </button>
                      )}
                      {user && !isStudent && it.kind !== 'exam' && !isLocked && (
                        <SendToStudents label="📤 Trimite elevilor" create={() => aiClient.assignmentCreateFromPublic({ publicId: it.id })} />
                      )}
                      {isAdmin && (
                        <button onClick={() => toggleFree(it)} title="Comută acces gratuit/premium"
                          style={{ background: it.is_free ? 'rgba(39,174,96,.12)' : 'rgba(232,185,49,.15)', border: '1px solid var(--border)', color: 'var(--navy)', borderRadius: 7, padding: '5px 9px', fontSize: '.74rem', fontWeight: 700, cursor: 'pointer' }}>
                          {it.is_free ? '★ Gratuit' : '☆ Fă gratuit'}
                        </button>
                      )}
                      {(isAdmin || (user && it.created_by === user.id)) && (
                        <button onClick={() => del(it.id)} style={{ background: 'none', border: '1px solid #f5c6cb', color: '#c0392b', borderRadius: 7, padding: '5px 9px', fontSize: '.76rem', fontWeight: 600, cursor: 'pointer' }}>🗑 Șterge</button>
                      )}
                    </div>
                  </div>
                  {isOpen && <Viewer item={open} />}
                </div>
              );
            })}
          </div>
        )}
    </div>
  );
}
