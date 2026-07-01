// =====================================================================
// src/components/AITeacherReport.jsx
// Raport agregat pentru profesor: media stăpânirii pe clasă/grupă,
// subiectele cele mai grele și elevii în dificultate.
// Se montează în zona de profesor: <AITeacherReport />
// =====================================================================
import { useState, useEffect } from 'react';
import { aiClient } from '../lib/aiClient';

const color = (m) => (m >= 0.75 ? '#27ae60' : m >= 0.4 ? '#e8b931' : '#e74c3c');
const pct = (m) => Math.round((m || 0) * 100) + '%';

export default function AITeacherReport() {
  const [groupId, setGroupId] = useState('');
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  async function load(gid) {
    setLoading(true); setError(null);
    try { setData(await aiClient.teacherReport({ groupId: gid || null })); }
    catch (e) { setError(e.message); }
    finally { setLoading(false); }
  }
  useEffect(() => { load(groupId); /* eslint-disable-next-line */ }, [groupId]);

  const card = { background: '#fff', border: '1px solid var(--border)', borderRadius: 'var(--radius-lg)', padding: 20, marginBottom: 16 };

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 10, marginBottom: 14 }}>
        <h3 style={{ fontFamily: 'var(--font-display)', color: 'var(--navy)', margin: 0 }}>🎓 Raport AI — stăpânirea pe clasă</h3>
        {data?.groups?.length > 0 && (
          <select value={groupId} onChange={(e) => setGroupId(e.target.value)}
            style={{ border: '1px solid var(--border)', borderRadius: 8, padding: '7px 10px', fontSize: '.85rem' }}>
            <option value="">Toți elevii</option>
            {data.groups.map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}
          </select>
        )}
      </div>

      {loading && <div style={{ padding: 30, textAlign: 'center' }}><div className="spinner" /></div>}
      {error && <div style={{ ...card, background: '#fdecea', color: '#b71c1c' }}>⚠️ {error}</div>}

      {data && !loading && (
        <>
          {/* Sumar */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(140px,1fr))', gap: 12, marginBottom: 16 }}>
            <Stat label="Elevi" value={data.totals.students} />
            <Stat label="Au exersat cu AI" value={data.totals.practiced} />
            <Stat label="Stăpânire medie" value={data.totals.avgMastery != null ? pct(data.totals.avgMastery) : '—'} />
            <Stat label="În dificultate" value={data.totals.atRisk} highlight={data.totals.atRisk > 0} />
          </div>

          {data.totals.practiced === 0 && (
            <div style={card}><p style={{ color: 'var(--text-muted)', fontSize: '.9rem', margin: 0 }}>Niciun elev nu a folosit încă antrenamentul AI. Datele apar pe măsură ce elevii exersează.</p></div>
          )}

          {/* Subiecte (cele mai grele primele) */}
          {data.topics.length > 0 && (
            <div style={card}>
              <h4 style={{ color: 'var(--navy)', marginBottom: 12 }}>Subiecte după dificultate (media clasei)</h4>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                {data.topics.map((t) => (
                  <div key={t.category + t.topic}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '.85rem', marginBottom: 3 }}>
                      <span style={{ fontWeight: 600, color: 'var(--navy)' }}>{t.topic} <span style={{ color: 'var(--text-muted)', fontWeight: 400 }}>· {t.category}</span></span>
                      <span style={{ color: 'var(--text-muted)' }}>{pct(t.avgMastery)} · {t.studentsPracticed} elevi{t.strugglingStudents.length ? ` · ${t.strugglingStudents.length} în dificultate` : ''}</span>
                    </div>
                    <div style={{ height: 8, background: 'var(--border)', borderRadius: 99, overflow: 'hidden' }}>
                      <div style={{ height: '100%', width: pct(t.avgMastery), background: color(t.avgMastery), borderRadius: 99 }} />
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Elevi în dificultate */}
          {data.students.some((s) => s.atRisk) && (
            <div style={card}>
              <h4 style={{ color: 'var(--navy)', marginBottom: 12 }}>Elevi care au nevoie de atenție</h4>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {data.students.filter((s) => s.atRisk).map((s) => (
                  <div key={s.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '9px 12px', background: 'rgba(231,76,60,.06)', borderRadius: 10, fontSize: '.88rem' }}>
                    <span style={{ fontWeight: 600, color: 'var(--navy)' }}>{s.name}</span>
                    <span style={{ color: 'var(--text-muted)', fontSize: '.82rem' }}>
                      medie {pct(s.avgMastery)}{s.strugglingTopics.length ? ` · slab la: ${s.strugglingTopics.slice(0, 3).join(', ')}` : ''}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}

function Stat({ label, value, highlight }) {
  return (
    <div style={{ background: highlight ? 'rgba(231,76,60,.1)' : 'var(--navy)', color: highlight ? '#c0392b' : '#fff', borderRadius: 'var(--radius-lg)', padding: 16 }}>
      <div style={{ fontSize: '1.8rem', fontWeight: 800, fontFamily: 'var(--font-display)', color: highlight ? '#c0392b' : 'var(--gold)' }}>{value}</div>
      <div style={{ fontSize: '.78rem', opacity: 0.85 }}>{label}</div>
    </div>
  );
}
