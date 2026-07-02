// =====================================================================
// src/components/ExamGenerator.jsx — generator de subiecte de examen (PDF)
// Reutilizat în pagina „Profesor Virtual" și în widgetul plutitor.
// prop compact=true → stil mai mic pentru fereastra widgetului.
// =====================================================================
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { aiClient } from '../lib/aiClient';
import { printExam } from '../lib/examPrint';

export const EXAM_TYPES = [
  { id: 'evaluare-nationala', label: 'Evaluare Națională', desc: 'Matematică · clasa a VIII-a' },
  { id: 'bac-tehnologic', label: 'BAC · Tehnologic', desc: 'M_tehnologic' },
  { id: 'bac-stiinte', label: 'BAC · Științele Naturii', desc: 'M_științele-naturii' },
  { id: 'bac-mate-info', label: 'BAC · Mate-Info', desc: 'M_mate-info' },
];

export default function ExamGenerator({ compact = false }) {
  const [examType, setExamType] = useState('evaluare-nationala');
  const [exam, setExam] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [upsell, setUpsell] = useState(false);

  async function gen() {
    setLoading(true); setError(null); setUpsell(false); setExam(null);
    try {
      const res = await aiClient.generateExam({ examType });
      setExam(res.exam);
      try { await aiClient.saveLibraryItem({ kind: 'exam', title: res.exam.title, category: examType, payload: { exam: res.exam } }); } catch { /* ignore */ }
    } catch (e) { setError(e.message); if (e.premium) setUpsell(true); }
    finally { setLoading(false); }
  }

  const card = { background: '#fff', border: '1px solid var(--border)', borderRadius: 'var(--radius-lg, 14px)', padding: compact ? 12 : 20, marginBottom: compact ? 12 : 18 };
  const totalItems = exam ? (exam.subjects || []).reduce((a, s) => a + (s.items?.length || 0), 0) : 0;

  return (
    <div>
      <div style={card}>
        <p style={{ color: 'var(--text-light)', fontSize: compact ? '.82rem' : '.9rem', marginBottom: 12 }}>
          Generează un <strong>model de subiect</strong> după structura oficială, în format PDF. Construit din exercițiile de pe site — material de pregătire, nu subiect oficial.
        </p>
        <div style={{ display: 'grid', gridTemplateColumns: compact ? '1fr 1fr' : 'repeat(auto-fit,minmax(180px,1fr))', gap: 8, marginBottom: 14 }}>
          {EXAM_TYPES.map((t) => (
            <button key={t.id} onClick={() => setExamType(t.id)}
              style={{
                textAlign: 'left', padding: compact ? '8px 10px' : '12px 14px', borderRadius: 10, cursor: 'pointer',
                border: '2px solid', borderColor: examType === t.id ? 'var(--gold)' : 'var(--border)',
                background: examType === t.id ? 'rgba(232,185,49,.1)' : '#fff',
              }}>
              <div style={{ fontWeight: 700, color: 'var(--navy)', fontSize: compact ? '.8rem' : '.92rem' }}>{t.label}</div>
              <div style={{ fontSize: compact ? '.68rem' : '.76rem', color: 'var(--text-muted)' }}>{t.desc}</div>
            </button>
          ))}
        </div>
        <button className="btn btn-primary" onClick={gen} disabled={loading} style={compact ? { width: '100%' } : undefined}>
          {loading ? 'Se generează... (~30s)' : '✨ Generează subiectul'}
        </button>
      </div>

      {error && <div style={{ ...card, background: '#fdecea', color: '#b71c1c', borderColor: '#f5c6cb' }}>⚠️ {error}</div>}
      {upsell && (
        <div style={{ ...card, background: '#fff4e5', borderColor: 'var(--gold)', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, flexWrap: 'wrap' }}>
          <span style={{ color: 'var(--navy)', fontWeight: 600, fontSize: '.85rem' }}>🔒 Generatorul de subiecte face parte din abonament.</span>
          <Link to="/preturi" className="btn btn-primary btn-sm">Abonează-te →</Link>
        </div>
      )}

      {exam && (
        <div style={card}>
          <h3 style={{ fontFamily: 'var(--font-display)', color: 'var(--navy)', marginBottom: 4, fontSize: compact ? '1rem' : undefined }}>{exam.title}</h3>
          <div style={{ fontSize: '.8rem', color: 'var(--text-muted)', marginBottom: 12 }}>
            {exam.durationMin} min · {exam.totalPoints} puncte ({exam.oficiu} oficiu) · {(exam.subjects || []).length} subiecte · {totalItems} itemi
          </div>
          {!compact && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 16 }}>
              {(exam.subjects || []).map((s, i) => (
                <div key={i} style={{ display: 'flex', justifyContent: 'space-between', padding: '8px 12px', background: '#f7f9fc', borderRadius: 8, fontSize: '.85rem' }}>
                  <strong style={{ color: 'var(--navy)' }}>{s.label}</strong>
                  <span style={{ color: 'var(--text-muted)' }}>{s.items?.length || 0} itemi · {s.points} puncte</span>
                </div>
              ))}
            </div>
          )}
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <button className="btn btn-primary btn-sm" onClick={() => printExam(exam, { withSolutions: false })}>📄 Varianta elev (PDF)</button>
            <button className="btn btn-outline btn-sm" onClick={() => printExam(exam, { withSolutions: true })}>📝 Barem (PDF)</button>
            <button className="btn btn-outline btn-sm" onClick={gen} disabled={loading}>🔄 Alt subiect</button>
          </div>
          <p style={{ fontSize: '.72rem', color: 'var(--text-muted)', marginTop: 10 }}>
            Se deschide într-o filă nouă; apasă „Printează / Salvează ca PDF".
          </p>
        </div>
      )}
    </div>
  );
}
