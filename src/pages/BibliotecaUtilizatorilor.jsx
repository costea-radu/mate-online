// =====================================================================
// src/pages/BibliotecaUtilizatorilor.jsx — teste/exerciții publicate de profesori
// Rută: /biblioteca-utilizatorilor (NU în Navbar; e în burger + Home + Căutare)
// =====================================================================
import { useState, useEffect } from 'react';
import { useSearchParams } from 'react-router-dom';
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

export default function BibliotecaUtilizatorilor() {
  const [params] = useSearchParams();
  const { user, isAdmin } = useAuth();
  const [q, setQ] = useState(params.get('q') || '');
  const [category, setCategory] = useState('');
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState(null); // item complet deschis

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
      if (!e.data || e.data.type !== 'MATE_SCORE') return;
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
    try { await aiClient.publicDelete({ id }); setItems((it) => it.filter((x) => x.id !== id)); } catch { /* ignore */ }
  }

  async function openItem(it) {
    try {
      const { item } = await aiClient.publicGet({ id: it.id });
      if (item.kind === 'exam') { printExam(item.payload.exam, { withSolutions: false }); }
      else setOpen(item);
    } catch { /* ignore */ }
  }

  const wrap = { maxWidth: 900, margin: '0 auto', padding: '32px 20px 60px' };
  const card = { background: '#fff', border: '1px solid var(--border)', borderRadius: 'var(--radius-lg)', padding: 18, marginBottom: 16 };
  const inp = { border: '1px solid var(--border)', borderRadius: 8, padding: '10px 12px', fontSize: '.95rem' };

  return (
    <div style={wrap}>
      <h1 style={{ fontFamily: 'var(--font-display)', color: 'var(--navy)', fontSize: 'clamp(1.7rem,4vw,2.4rem)', marginBottom: 6 }}>🏛️ Biblioteca utilizatorilor</h1>
      <p style={{ color: 'var(--text-light)', marginBottom: 20 }}>Teste și exerciții create și publicate de profesori cu Profesorul Virtual.</p>

      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginBottom: 18 }}>
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="🔍 Caută după titlu sau conținut..." style={{ ...inp, flex: 1, minWidth: 200 }} />
        <select value={category} onChange={(e) => setCategory(e.target.value)} style={inp}>
          {CATS.map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}
        </select>
      </div>

      {loading ? <div style={{ padding: 40, textAlign: 'center' }}><div className="spinner" /></div>
        : items.length === 0 ? <div style={card}><p style={{ color: 'var(--text-muted)', margin: 0 }}>Niciun rezultat. Profesorii pot publica teste din „Profesor Virtual".</p></div>
        : (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(260px,1fr))', gap: 12 }}>
            {items.map((it) => (
              <div key={it.id} style={{ ...card, marginBottom: 0, display: 'flex', flexDirection: 'column' }}>
                <div style={{ fontSize: '1.4rem', marginBottom: 6 }}>{KIND_ICON[it.kind] || '📘'}</div>
                <div style={{ fontWeight: 700, color: 'var(--navy)', fontSize: '.95rem', marginBottom: 4 }}>{it.title}</div>
                <div style={{ fontSize: '.76rem', color: 'var(--text-muted)', marginBottom: 10 }}>
                  {it.creator_role === 'parinte' ? 'Părinte' : 'Prof.'} {it.creator_name || ''} · {new Date(it.created_at).toLocaleDateString('ro-RO')}
                </div>
                <div style={{ marginTop: 'auto', display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
                  <button className="btn btn-sm btn-primary" onClick={() => openItem(it)}>{it.kind === 'exam' ? '📄 Deschide PDF' : '▶ Deschide'}</button>
                  {(isAdmin || (user && it.created_by === user.id)) && (
                    <button onClick={() => del(it.id)} style={{ background: 'none', border: '1px solid #f5c6cb', color: '#c0392b', borderRadius: 7, padding: '5px 9px', fontSize: '.76rem', fontWeight: 600, cursor: 'pointer' }}>🗑 Șterge</button>
                  )}
                </div>
                {user && it.kind !== 'exam' && (
                  <SendToStudents label="📤 Trimite elevilor" create={() => aiClient.assignmentCreateFromPublic({ publicId: it.id })} />
                )}
              </div>
            ))}
          </div>
        )}

      {open && (
        <div style={{ ...card, marginTop: 18 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
            <strong style={{ color: 'var(--navy)' }}>{open.title}</strong>
            <button className="btn btn-sm btn-outline" onClick={() => setOpen(null)}>✕ Închide</button>
          </div>
          {open.kind === 'interactive' && (open.payload?.questions || open.payload?.html) && (
            <iframe title="exercițiu" srcDoc={open.payload.questions ? renderQuiz(open.title, open.payload.questions) : open.payload.html} style={{ width: '100%', height: 560, border: '1px solid var(--border)', borderRadius: 10 }} />
          )}
          {open.kind === 'practice' && (
            <div>
              <div style={{ fontSize: '1.05rem', color: 'var(--navy)', marginBottom: 10 }}><MathText text={open.payload?.statement || ''} /></div>
              {Array.isArray(open.payload?.options) && open.payload.options.length > 0 && (
                <div style={{ marginBottom: 10 }}>{open.payload.options.map((o, i) => <div key={i} style={{ padding: '4px 0' }}><strong>{String.fromCharCode(65 + i)})</strong> <MathText text={o} /></div>)}</div>
              )}
              {open.payload?.solution && (
                <details><summary style={{ cursor: 'pointer', fontWeight: 600, color: 'var(--navy)' }}>Vezi rezolvarea</summary>
                  <div style={{ marginTop: 8 }}><MathText text={open.payload.solution} /></div>
                </details>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
