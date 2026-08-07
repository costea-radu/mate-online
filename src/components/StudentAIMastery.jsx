// =====================================================================
// src/components/StudentAIMastery.jsx
// Mic bloc pentru panoul EXISTENT al profesorului (TeacherResults).
// Arată: 1) testele la care elevul a folosit Profesorul Virtual (cu
// punctajul obținut și nr. de întrebări puse AI-ului) și
// 2) stăpânirea pe subiecte (din antrenamentele AI).
// Folosire: <StudentAIMastery studentId={student.id} aiTests={[...]} />
// =====================================================================
import { useState } from 'react';
import { aiClient } from '../lib/aiClient';

const color = (m) => (m >= 0.75 ? '#27ae60' : m >= 0.4 ? '#e8b931' : '#e74c3c');
const scorePct = (s, m) => (m ? Math.round((s / m) * 100) : 0);
const scoreCol = (p) => (p >= 80 ? '#2e7d32' : p >= 50 ? '#e65100' : '#c62828');

export default function StudentAIMastery({ studentId, aiTests = [] }) {
  const [open, setOpen] = useState(false);
  const [rows, setRows] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  async function toggle() {
    const next = !open;
    setOpen(next);
    if (next && rows === null) {
      setLoading(true); setError(null);
      try {
        const res = await aiClient.teacherStudentMastery(studentId);
        setRows(res.mastery || []);
      } catch (e) { setError(e.message); }
      finally { setLoading(false); }
    }
  }

  return (
    <div style={{ marginTop: 10 }}>
      <button onClick={toggle}
        style={{ background: 'none', border: '1px solid var(--border)', borderRadius: 8, padding: '5px 11px', fontSize: '.78rem', fontWeight: 600, color: 'var(--navy)' }}>
        🎓 Progres AI {aiTests.length > 0 ? `(${aiTests.length} ${aiTests.length === 1 ? 'test cu Prof. Virtual' : 'teste cu Prof. Virtual'}) ` : ''}{open ? '▲' : '▼'}
      </button>

      {open && (
        <div style={{ marginTop: 8, padding: 12, background: '#f7f9fc', borderRadius: 10 }}>
          {/* Teste la care elevul a pus întrebări Profesorului Virtual */}
          {aiTests.length > 0 && (
            <div style={{ marginBottom: 12 }}>
              <div style={{ fontSize: '.78rem', fontWeight: 700, color: 'var(--navy)', marginBottom: 6 }}>
                🧩 Teste rezolvate cu ajutorul Prof. Virtual
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                {aiTests.map((t, i) => {
                  const hasScore = t.max_score != null && t.max_score > 0;
                  const p = hasScore ? scorePct(t.score, t.max_score) : null;
                  const tip = t.content_type === 'interactive' ? 'interactiv' : t.content_type === 'pdf' ? 'PDF' : t.content_type;
                  return (
                    <div key={(t.content_id || '') + '-' + i}
                      style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, flexWrap: 'wrap', fontSize: '.8rem', background: '#fff', border: '1px solid var(--border)', borderRadius: 8, padding: '6px 10px' }}>
                      <span style={{ color: 'var(--navy)', fontWeight: 600, flex: '1 1 160px', minWidth: 0 }}>
                        {t.test_title}{tip ? <span style={{ color: '#8a94a3', fontWeight: 600, fontSize: '.72rem' }}> ({tip})</span> : null}
                      </span>
                      <span style={{ color: '#8a6d00', fontWeight: 700, whiteSpace: 'nowrap' }}>
                        {t.ai_questions > 0
                          ? `${t.ai_questions} ${t.ai_questions === 1 ? 'întrebare' : 'întrebări'}`
                          : 'corectare AI'}
                      </span>
                      {hasScore
                        ? <span style={{ fontWeight: 700, color: scoreCol(p), whiteSpace: 'nowrap' }}>{t.score}/{t.max_score} ({p}%)</span>
                        : <span style={{ color: 'var(--text-muted)', whiteSpace: 'nowrap' }}>fără punctaj încă</span>}
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* Stăpânirea la antrenamentele AI — DOAR media, fără titlurile
              lecțiilor/subiectelor (cerința 5, runda 5): lista detaliată pe
              subiecte rămâne la Raport AI → „Subiecte după dificultate". */}
          {loading && <span style={{ fontSize: '.82rem', color: 'var(--text-muted)' }}>Se încarcă…</span>}
          {error && <span style={{ fontSize: '.82rem', color: '#b71c1c' }}>⚠️ {error}</span>}
          {rows && rows.length === 0 && aiTests.length === 0 && (
            <span style={{ fontSize: '.82rem', color: 'var(--text-muted)' }}>Elevul nu a folosit încă Profesorul Virtual.</span>
          )}
          {rows && rows.length === 0 && aiTests.length > 0 && (
            <span style={{ fontSize: '.78rem', color: 'var(--text-muted)' }}>Fără antrenamente AI pe subiecte încă.</span>
          )}
          {rows && rows.length > 0 && (() => {
            const avg = rows.reduce((s, m) => s + Number(m.mastery || 0), 0) / rows.length;
            const attempts = rows.reduce((s, m) => s + (m.attempts || 0), 0);
            const correct = rows.reduce((s, m) => s + (m.correct || 0), 0);
            return (
              <div>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '.8rem', marginBottom: 3 }}>
                  <span style={{ fontWeight: 600, color: 'var(--navy)' }}>Stăpânire medie (antrenamente AI)</span>
                  <span style={{ color: 'var(--text-muted)' }}>{Math.round(avg * 100)}% · {correct}/{attempts} corecte</span>
                </div>
                <div style={{ height: 7, background: 'var(--border)', borderRadius: 99, overflow: 'hidden' }}>
                  <div style={{ height: '100%', width: `${Math.round(avg * 100)}%`, background: color(avg), borderRadius: 99 }} />
                </div>
                <div style={{ fontSize: '.72rem', color: 'var(--text-muted)', marginTop: 6 }}>
                  Detaliile pe subiecte sunt la <strong>Raport AI → Subiecte după dificultate</strong>.
                </div>
              </div>
            );
          })()}
        </div>
      )}
    </div>
  );
}
