// =====================================================================
// src/components/AITeacherReport.jsx
// Raport agregat pentru profesor: media stăpânirii pe clasă/grupă,
// subiectele cele mai grele și elevii în dificultate.
// Se montează în zona de profesor: <AITeacherReport />
// =====================================================================
import { useState, useEffect } from 'react';
import { aiClient } from '../lib/aiClient';
import EinsteinIcon from './EinsteinIcon';

const color = (m) => (m >= 0.75 ? '#27ae60' : m >= 0.4 ? '#e8b931' : '#e74c3c');
const pct = (m) => Math.round((m || 0) * 100) + '%';
const medal = (i) => (i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : `${i + 1}.`);

export default function AITeacherReport() {
  const [groupId, setGroupId] = useState('');
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [assignments, setAssignments] = useState([]);
  const [students, setStudents] = useState([]);

  async function load(gid) {
    setLoading(true); setError(null);
    try { setData(await aiClient.teacherReport({ groupId: gid || null })); }
    catch (e) { setError(e.message); }
    finally { setLoading(false); }
  }
  useEffect(() => { load(groupId); /* eslint-disable-next-line */ }, [groupId]);
  useEffect(() => { (async () => { try { const { assignments } = await aiClient.assignmentResults(); setAssignments(assignments || []); } catch { /* ignore */ } try { const { students } = await aiClient.assignmentStudents(); setStudents(students || []); } catch { /* ignore */ } })(); }, []);

  async function deleteAssignment(id) {
    if (!window.confirm('Ștergi tema și rezultatele ei?')) return;
    try { await aiClient.assignmentDelete({ id }); setAssignments((a) => a.filter((x) => x.id !== id)); } catch { /* ignore */ }
  }

  const card = { background: '#fff', border: '1px solid var(--border)', borderRadius: 'var(--radius-lg)', padding: 20, marginBottom: 16 };

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 10, marginBottom: 14 }}>
        <h3 style={{ fontFamily: 'var(--font-display)', color: 'var(--navy)', margin: 0, display: 'flex', alignItems: 'center', gap: 8 }}><EinsteinIcon size={26} /> Raport AI — activități cu Prof. Virtual</h3>
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

      {/* Teme trimise elevilor — rolldown */}
      <details style={card}>
        <summary style={{ cursor: 'pointer', fontWeight: 700, color: 'var(--navy)', fontSize: '1rem', fontFamily: 'var(--font-display)' }}>📤 Exerciții trimise elevilor</summary>
        <p style={{ fontSize: '.8rem', color: 'var(--text-muted)', margin: '10px 0 12px' }}>
          Generează exerciții de antrenament sau interactive și trimite-le elevilor cu butonul „Trimite elevilor". Rezultatele apar aici.
        </p>
        {assignments.length === 0 ? (
          <p style={{ fontSize: '.85rem', color: 'var(--text-muted)', margin: 0 }}>Încă nu ai trimis nicio temă.</p>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {assignments.map((a) => (
              <details key={a.id} style={{ border: '1px solid var(--border)', borderRadius: 10, padding: '10px 12px' }}>
                <summary style={{ cursor: 'pointer', display: 'flex', justifyContent: 'space-between', flexWrap: 'wrap', gap: 6, alignItems: 'center' }}>
                  <span style={{ fontWeight: 600, color: 'var(--navy)', fontSize: '.88rem' }}>{a.kind === 'interactive' ? '🧩' : '✍️'} {a.title}</span>
                  <span style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                    <span style={{ fontSize: '.8rem', color: 'var(--text-muted)' }}>{a.solvedCount} rezolvări{a.avgPercent != null ? ` · medie ${a.avgPercent}%` : ''}</span>
                    <CopyLinkButton id={a.id} />
                  </span>
                </summary>
                {a.results.length > 0 ? (
                  <div style={{ marginTop: 8, display: 'flex', flexDirection: 'column', gap: 4 }}>
                    {a.results.map((r) => (
                      <div key={r.studentId} style={{ display: 'flex', justifyContent: 'space-between', fontSize: '.82rem', padding: '4px 8px', background: '#f7f9fc', borderRadius: 6 }}>
                        <span style={{ color: 'var(--navy)' }}>{r.name}</span>
                        <span style={{ color: 'var(--text-muted)' }}>{r.score}/{r.maxScore} · {r.attempts} încercări</span>
                      </div>
                    ))}
                  </div>
                ) : <div style={{ marginTop: 8, fontSize: '.8rem', color: 'var(--text-muted)' }}>Niciun elev nu a rezolvat încă.</div>}

                <div style={{ marginTop: 10, paddingTop: 10, borderTop: '1px dashed var(--border)', display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
                  <button onClick={() => deleteAssignment(a.id)}
                    style={{ marginLeft: 'auto', background: 'none', border: '1px solid #f5c6cb', color: '#c0392b', borderRadius: 7, padding: '4px 9px', fontSize: '.76rem', fontWeight: 600, cursor: 'pointer' }}>
                    🗑 Șterge tema
                  </button>
                </div>
              </details>
            ))}
          </div>
        )}
      </details>

      {/* Clasamente — rolldown, după „Exerciții trimise elevilor" */}
      {data && data.leaderboard && (data.leaderboard.groupRanking.length > 0 || data.leaderboard.ungrouped.length > 0) && (
        <details style={card}>
          <summary style={{ cursor: 'pointer', fontWeight: 700, color: 'var(--navy)', fontSize: '1rem', fontFamily: 'var(--font-display)' }}>🏆 Clasamente</summary>
          <div style={{ marginTop: 10 }}>
            {data.leaderboard.groupRanking.length > 0 && (
              <div style={{ marginBottom: 14 }}>
                <div style={{ fontWeight: 700, color: 'var(--navy)', fontSize: '.85rem', marginBottom: 6 }}>Clasament grupe (după stăpânirea medie)</div>
                {data.leaderboard.groupRanking.map((g, i) => (
                  <div key={g.id} style={{ display: 'flex', justifyContent: 'space-between', padding: '5px 10px', background: i === 0 ? 'rgba(232,185,49,.15)' : '#f7f9fc', borderRadius: 7, marginBottom: 4, fontSize: '.85rem' }}>
                    <span style={{ color: 'var(--navy)', fontWeight: 600 }}>{medal(i)} {g.name} <span style={{ color: 'var(--text-muted)', fontWeight: 400 }}>({g.count} elevi)</span></span>
                    <span style={{ color: 'var(--text-muted)' }}>{g.avgMastery != null ? pct(g.avgMastery) : '—'}</span>
                  </div>
                ))}
              </div>
            )}
            {data.leaderboard.groups.map((g) => (
              <details key={g.id} style={{ border: '1px solid var(--border)', borderRadius: 10, padding: '8px 12px', marginBottom: 8 }}>
                <summary style={{ cursor: 'pointer', fontWeight: 600, color: 'var(--navy)', fontSize: '.85rem' }}>{g.name} — clasament elevi</summary>
                <div style={{ marginTop: 8 }}>
                  {g.students.map((s, i) => (
                    <div key={s.id} style={{ display: 'flex', justifyContent: 'space-between', padding: '4px 8px', background: '#f7f9fc', borderRadius: 6, marginBottom: 3, fontSize: '.83rem' }}>
                      <span style={{ color: 'var(--navy)' }}>{medal(i)} {s.name}</span>
                      <span style={{ color: 'var(--text-muted)' }}>{s.avgMastery != null ? pct(s.avgMastery) : '— (fără date)'}</span>
                    </div>
                  ))}
                </div>
              </details>
            ))}
            {data.leaderboard.ungrouped.length > 0 && (
              <details style={{ border: '1px solid var(--border)', borderRadius: 10, padding: '8px 12px' }}>
                <summary style={{ cursor: 'pointer', fontWeight: 600, color: 'var(--navy)', fontSize: '.85rem' }}>Fără grupă — clasament elevi</summary>
                <div style={{ marginTop: 8 }}>
                  {data.leaderboard.ungrouped.map((s, i) => (
                    <div key={s.id} style={{ display: 'flex', justifyContent: 'space-between', padding: '4px 8px', background: '#f7f9fc', borderRadius: 6, marginBottom: 3, fontSize: '.83rem' }}>
                      <span style={{ color: 'var(--navy)' }}>{medal(i)} {s.name}</span>
                      <span style={{ color: 'var(--text-muted)' }}>{s.avgMastery != null ? pct(s.avgMastery) : '— (fără date)'}</span>
                    </div>
                  ))}
                </div>
              </details>
            )}
          </div>
        </details>
      )}
    </div>
  );
}

// Trimite tema direct unui elev ales (fără copiere manuală)
function SendToOne({ assignmentId, students }) {
  const [sid, setSid] = useState('');
  const [state, setState] = useState(null); // null | 'sending' | 'ok' | 'err'
  async function send() {
    if (!sid) return;
    setState('sending');
    try { await aiClient.assignmentSend({ assignmentId, studentId: sid }); setState('ok'); setTimeout(() => setState(null), 2500); }
    catch { setState('err'); }
  }
  if (!students.length) return <span style={{ fontSize: '.76rem', color: 'var(--text-muted)' }}>Adaugă elevi în „Rezultate elevi" ca să poți trimite direct.</span>;
  return (
    <span style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
      <span style={{ fontSize: '.78rem', color: 'var(--text-light)' }}>Trimite unui elev:</span>
      <select value={sid} onChange={(e) => setSid(e.target.value)} style={{ border: '1px solid var(--border)', borderRadius: 7, padding: '4px 8px', fontSize: '.8rem' }}>
        <option value="">— alege —</option>
        {students.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
      </select>
      <button className="btn btn-sm btn-primary" onClick={send} disabled={!sid || state === 'sending'}>
        {state === 'sending' ? '...' : state === 'ok' ? '✓ Trimis' : 'Trimite'}
      </button>
      {state === 'err' && <span style={{ fontSize: '.75rem', color: '#c0392b' }}>eroare</span>}
    </span>
  );
}

function CopyLinkButton({ id }) {
  const [copied, setCopied] = useState(false);
  function copy(e) {
    e.preventDefault(); e.stopPropagation();
    const link = `${window.location.origin}/tema?id=${id}`;
    navigator.clipboard?.writeText(link).then(() => { setCopied(true); setTimeout(() => setCopied(false), 2000); }).catch(() => {});
  }
  return (
    <button onClick={copy}
      style={{ background: copied ? 'rgba(39,174,96,.15)' : 'rgba(232,185,49,.15)', color: copied ? '#1e7e34' : 'var(--navy)', border: '1px solid var(--border)', borderRadius: 7, padding: '4px 9px', fontSize: '.75rem', fontWeight: 700, cursor: 'pointer', whiteSpace: 'nowrap' }}>
      {copied ? '✓ Copiat' : '🔗 Copiază link'}
    </button>
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
