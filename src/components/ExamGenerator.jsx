// =====================================================================
// src/components/ExamGenerator.jsx — generator de subiecte de examen (PDF)
// Reutilizat în pagina „Profesor Virtual" și în widgetul plutitor.
// prop compact=true → stil mic (widget). prop canManage=true (profesor) →
// permite EDITAREA subiectului și PUBLICAREA în „Biblioteca utilizatorilor".
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

export default function ExamGenerator({ compact = false, canManage = false }) {
  const [examType, setExamType] = useState('evaluare-nationala');
  const [exam, setExam] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [upsell, setUpsell] = useState(false);
  const [editing, setEditing] = useState(false);
  const [publishMsg, setPublishMsg] = useState(null);
  const [publishing, setPublishing] = useState(false);

  async function gen() {
    setLoading(true); setError(null); setUpsell(false); setExam(null); setEditing(false); setPublishMsg(null);
    try {
      const res = await aiClient.generateExam({ examType });
      setExam(res.exam);
      try { await aiClient.saveLibraryItem({ kind: 'exam', title: res.exam.title, category: examType, payload: { exam: res.exam } }); } catch { /* ignore */ }
    } catch (e) { setError(e.message); if (e.premium) setUpsell(true); }
    finally { setLoading(false); }
  }

  function patchItem(si, ii, patch) {
    setExam((ex) => { const c = structuredClone(ex); c.subjects[si].items[ii] = { ...c.subjects[si].items[ii], ...patch }; return c; });
  }
  function patchOption(si, ii, oi, val) {
    setExam((ex) => { const c = structuredClone(ex); c.subjects[si].items[ii].options[oi] = val; return c; });
  }
  function patchPart(si, ii, pi, patch) {
    setExam((ex) => { const c = structuredClone(ex); c.subjects[si].items[ii].parts[pi] = { ...c.subjects[si].items[ii].parts[pi], ...patch }; return c; });
  }
  function addItem(si) {
    setExam((ex) => { const c = structuredClone(ex); const items = c.subjects[si].items; items.push({ number: String(items.length + 1), statement: 'Enunț nou', options: ['', '', '', ''], answer: 'a', solution: '' }); return c; });
  }
  function delItem(si, ii) {
    setExam((ex) => { const c = structuredClone(ex); c.subjects[si].items.splice(ii, 1); return c; });
  }

  async function publish() {
    if (!exam) return;
    setPublishing(true); setPublishMsg(null);
    try {
      const r = await aiClient.publicPublish({ kind: 'exam', title: exam.title, category: examType, topic: null, payload: { exam } });
      setPublishMsg(r && r.alreadyPublished ? 'ℹ️ Testul e deja publicat în „Biblioteca utilizatorilor".' : '✅ Publicat în „Biblioteca utilizatorilor".');
    } catch (e) { setPublishMsg('Eroare: ' + e.message); }
    finally { setPublishing(false); }
  }

  const card = { background: '#fff', border: '1px solid var(--border)', borderRadius: 'var(--radius-lg, 14px)', padding: compact ? 12 : 20, marginBottom: compact ? 12 : 18 };
  const ta = { width: '100%', border: '1px solid var(--border)', borderRadius: 6, padding: '6px 8px', fontSize: '.82rem', fontFamily: 'var(--font-body)', marginTop: 3, resize: 'vertical' };
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
              style={{ textAlign: 'left', padding: compact ? '8px 10px' : '12px 14px', borderRadius: 10, cursor: 'pointer', border: '2px solid', borderColor: examType === t.id ? 'var(--gold)' : 'var(--border)', background: examType === t.id ? 'rgba(232,185,49,.1)' : '#fff' }}>
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

          {canManage && editing && (
            <div style={{ marginBottom: 16, maxHeight: 420, overflowY: 'auto', border: '1px solid var(--border)', borderRadius: 10, padding: 12 }}>
              {(exam.subjects || []).map((s, si) => (
                <div key={si} style={{ marginBottom: 14 }}>
                  <div style={{ fontWeight: 700, color: 'var(--navy)', fontSize: '.85rem', marginBottom: 6 }}>{s.label}</div>
                  {(s.items || []).map((it, ii) => (
                    <div key={ii} style={{ padding: 8, background: '#f7f9fc', borderRadius: 8, marginBottom: 8 }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 2 }}>
                        <span style={{ fontSize: '.72rem', color: 'var(--text-muted)', fontWeight: 700 }}>Item {it.number}</span>
                        <button onClick={() => delItem(si, ii)} style={{ background: 'none', border: '1px solid #f5c6cb', color: '#c0392b', borderRadius: 6, padding: '1px 7px', fontSize: '.72rem', cursor: 'pointer' }}>🗑</button>
                      </div>
                      <label style={{ fontSize: '.74rem', color: 'var(--text-muted)' }}>Enunț
                        <textarea rows={2} value={it.statement || ''} onChange={(e) => patchItem(si, ii, { statement: e.target.value })} style={ta} />
                      </label>
                      {Array.isArray(it.options) && it.options.length > 0 && (
                        <div style={{ marginTop: 4 }}>
                          {it.options.map((o, oi) => (
                            <input key={oi} value={o} onChange={(e) => patchOption(si, ii, oi, e.target.value)} placeholder={`Varianta ${String.fromCharCode(97 + oi)})`} style={{ ...ta, marginTop: 2 }} />
                          ))}
                          <input value={it.answer || ''} onChange={(e) => patchItem(si, ii, { answer: e.target.value })} placeholder="Răspuns corect (litera: a/b/c/d)" style={{ ...ta, marginTop: 2 }} />
                        </div>
                      )}
                      {Array.isArray(it.parts) && it.parts.length > 0 ? (
                        it.parts.map((p, pi) => (
                          <div key={pi} style={{ marginTop: 4 }}>
                            <textarea rows={1} value={p.text || ''} onChange={(e) => patchPart(si, ii, pi, { text: e.target.value })} placeholder={`Cerința ${p.label})`} style={ta} />
                            <textarea rows={2} value={p.solution || ''} onChange={(e) => patchPart(si, ii, pi, { solution: e.target.value })} placeholder={`Rezolvare ${p.label})`} style={ta} />
                          </div>
                        ))
                      ) : (!it.options && (
                        <textarea rows={2} value={it.solution || ''} onChange={(e) => patchItem(si, ii, { solution: e.target.value })} placeholder="Rezolvare / răspuns" style={ta} />
                      ))}
                    </div>
                  ))}
                  <button className="btn btn-sm btn-outline" onClick={() => addItem(si)}>➕ Adaugă item la {s.label}</button>
                </div>
              ))}
            </div>
          )}

          {!compact && !editing && (
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
            {canManage && <button className="btn btn-outline btn-sm" onClick={() => setEditing((e) => !e)}>{editing ? '✓ Gata editarea' : '✏️ Editează'}</button>}
            {canManage && <button className="btn btn-outline btn-sm" onClick={publish} disabled={publishing}>{publishing ? 'Se publică...' : '🏛️ Publică'}</button>}
            <button className="btn btn-outline btn-sm" onClick={gen} disabled={loading}>🔄 Alt subiect</button>
          </div>
          {publishMsg && <div style={{ marginTop: 8, fontSize: '.82rem', color: publishMsg.startsWith('✅') ? '#1e7e34' : '#b71c1c' }}>{publishMsg}</div>}
          <p style={{ fontSize: '.72rem', color: 'var(--text-muted)', marginTop: 10 }}>
            {canManage ? 'Poți edita enunțurile și răspunsurile, apoi salva ca PDF sau publica pentru toți elevii. ' : ''}Se deschide într-o filă nouă; apasă „Printează / Salvează ca PDF".
          </p>
        </div>
      )}
    </div>
  );
}
