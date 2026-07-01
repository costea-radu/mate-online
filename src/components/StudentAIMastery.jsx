// =====================================================================
// src/components/StudentAIMastery.jsx
// Mic bloc pentru panoul EXISTENT al profesorului (TeacherResults).
// Arată stăpânirea pe subiecte (din antrenamentele AI) a unui elev.
// Folosire: <StudentAIMastery studentId={student.id} />
// =====================================================================
import { useState } from 'react';
import { aiClient } from '../lib/aiClient';

const color = (m) => (m >= 0.75 ? '#27ae60' : m >= 0.4 ? '#e8b931' : '#e74c3c');

export default function StudentAIMastery({ studentId }) {
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
        🎓 Progres AI pe subiecte {open ? '▲' : '▼'}
      </button>

      {open && (
        <div style={{ marginTop: 8, padding: 12, background: '#f7f9fc', borderRadius: 10 }}>
          {loading && <span style={{ fontSize: '.82rem', color: 'var(--text-muted)' }}>Se încarcă…</span>}
          {error && <span style={{ fontSize: '.82rem', color: '#b71c1c' }}>⚠️ {error}</span>}
          {rows && rows.length === 0 && <span style={{ fontSize: '.82rem', color: 'var(--text-muted)' }}>Elevul nu a folosit încă antrenamentul AI.</span>}
          {rows && rows.length > 0 && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 9 }}>
              {rows.map((m) => (
                <div key={m.category + m.topic}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '.8rem', marginBottom: 3 }}>
                    <span style={{ fontWeight: 600, color: 'var(--navy)' }}>{m.topic} <span style={{ color: 'var(--text-muted)', fontWeight: 400 }}>· {m.category}</span></span>
                    <span style={{ color: 'var(--text-muted)' }}>{Math.round(m.mastery * 100)}% · {m.correct}/{m.attempts}</span>
                  </div>
                  <div style={{ height: 7, background: 'var(--border)', borderRadius: 99, overflow: 'hidden' }}>
                    <div style={{ height: '100%', width: `${Math.round(m.mastery * 100)}%`, background: color(m.mastery), borderRadius: 99 }} />
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
