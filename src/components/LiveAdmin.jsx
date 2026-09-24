// =====================================================================
// src/components/LiveAdmin.jsx — ADMIN: Meditațiile live
//
// Programul unei zile: la aceeași oră, câte o sală pe examen (EN, BAC Mate-Info,
// BAC Științele Naturii, BAC Tehnologic) — ce subiect se predă în fiecare (doar
// subiecte CU BAREM, ale examenului sălii), starea lecției (scriptul + vocea), cine
// e în sală; pregătirea/regenerarea lecțiilor, anularea unei ședințe, o notă.
// Lecțiile recente: durata, costul (text + voce), erorile, scriptul complet.
// =====================================================================
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { liveApi } from '../lib/live/api';

const LESSON_LABEL = { nou: 'nepregătită (se scrie când intră primul elev)', script: 'scriptul e gata, urmează vocea', audio: 'vocea se generează…', gata: '✓ gata', gata_fara_voce: '✓ gata · vocea browserului', eroare: '⚠ eroare' };
const PHASE_LABEL = { viitoare: 'urmează', sala_asteptare: 'sala e deschisă', live: '🔴 LIVE', incheiata: 'încheiată', anulata: 'anulată' };

const box = { background: '#fff', borderRadius: 12, padding: '20px 24px', boxShadow: '0 1px 4px rgba(0,0,0,0.08)', marginBottom: 20 };
const btn = { padding: '6px 12px', borderRadius: 8, border: '1px solid #d0d7e2', background: '#f6f8fb', fontSize: '.82rem', cursor: 'pointer', whiteSpace: 'nowrap' };
const btnMain = { ...btn, background: 'var(--navy)', color: '#fff', borderColor: 'var(--navy)' };
const th = { textAlign: 'left', fontSize: '.74rem', textTransform: 'uppercase', letterSpacing: '.04em', color: '#6b7280', padding: '6px 8px', borderBottom: '2px solid #eef1f5' };
const td = { padding: '10px 8px', borderBottom: '1px solid #eef1f5', verticalAlign: 'top', fontSize: '.88rem' };

function addDays(key, n) {
  const d = new Date(`${key}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

export default function LiveAdmin() {
  const [day, setDay] = useState(null);
  const [data, setData] = useState(null);
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState('');
  const [msg, setMsg] = useState('');
  const [script, setScript] = useState(null);

  const load = useCallback(async (d = day) => {
    setErr('');
    try {
      const r = await liveApi.adminOverview(d || undefined);
      setData(r);
      if (!d) setDay(r.day);
    } catch (e) { setErr(e.message); }
  }, [day]);
  useEffect(() => { load(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const slotLabel = useMemo(() => Object.fromEntries((data?.slots || []).map((s) => [s.id, s.label])), [data]);
  const subjectsFor = (s) => (s.exam === 'bac' ? (data?.subjects?.bac || []).filter((x) => !s.profile || x.profile === s.profile) : (data?.subjects?.en || []));
  const teacherName = useMemo(() => Object.fromEntries((data?.teachers || []).map((t) => [t.id, t.name])), [data]);

  async function run(key, fn, okText) {
    setBusy(key); setMsg(''); setErr('');
    try { await fn(); if (okText) setMsg(okText); await load(); }
    catch (e) { setErr(e.message); }
    finally { setBusy(''); }
  }

  const go = (n) => { const d = addDays(day, n); setDay(d); setData(null); load(d); };

  return (
    <div>
      <div style={box}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
          <div>
            <h2 style={{ fontFamily: 'var(--font-display)', color: 'var(--navy)', fontSize: '1.25rem' }}>🎥 Meditații live — programul</h2>
            <div style={{ color: '#6b7280', fontSize: '.85rem', marginTop: 4 }}>
              Profesor: {(data?.teachers || []).map((t) => t.name).join(', ') || '—'} · Vocea: <b>{data ? (data.tts || 'lipsă') : '…'}</b>
              {data && !data.tts && <span style={{ color: '#b3261e' }}> — fără cheie TTS (OPENAI_API_KEY sau AZURE_SPEECH_KEY), lecțiile folosesc vocea browserului</span>}
            </div>
          </div>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <button type="button" style={btn} onClick={() => go(-1)} disabled={!day}>←</button>
            <input type="date" value={day || ''} onChange={(e) => { setDay(e.target.value); setData(null); load(e.target.value); }} style={{ ...btn, background: '#fff' }} />
            <button type="button" style={btn} onClick={() => go(1)} disabled={!day}>→</button>
            <button type="button" style={btn} onClick={() => load()}>↻</button>
            <Link to="/meditatii/demo" style={{ ...btn, textDecoration: 'none', color: 'inherit' }}>Demo sală</Link>
          </div>
        </div>
        {err && <div style={{ marginTop: 12, color: '#b3261e', fontSize: '.88rem' }}>⚠ {err}</div>}
        {msg && <div style={{ marginTop: 12, color: '#137333', fontSize: '.88rem' }}>✓ {msg}</div>}
      </div>

      <div style={box}>
        <h3 style={{ color: 'var(--navy)', marginBottom: 10 }}>Ședințele zilei</h3>
        {data?.rooms?.length > 0 && (
          <div style={{ color: '#6b7280', fontSize: '.84rem', marginBottom: 10 }}>
            Subiecte cu barem, pe săli:{' '}
            {data.rooms.map((r, i) => (
              <span key={r.id} style={{ color: r.subjects ? '#374151' : '#b3261e', fontWeight: r.subjects ? 400 : 700 }}>
                {i ? ' · ' : ''}{r.label} {r.subjects}{r.subjects ? '' : ' ⚠'}
              </span>
            ))}
            {data.rooms.some((r) => !r.subjects) && <span> — sala fără subiecte așteaptă; cronul citește baremele întâi pentru ea (sau încarcă subiecte cu barem pentru acel profil).</span>}
          </div>
        )}
        {!data && !err && <div className="spinner" />}
        {data && (
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead><tr><th style={th}>Ora</th><th style={th}>Examen</th><th style={th}>Subiectul (cu barem)</th><th style={th}>Lecția</th><th style={th}>Sala</th><th style={th}>Acțiuni</th></tr></thead>
              <tbody>
                {data.sessions.map((s) => {
                  const list = subjectsFor(s);
                  const inList = s.subject && list.some((x) => x.id === s.subject.id);
                  return (
                    <tr key={s.id} style={{ opacity: s.status === 'anulata' ? 0.55 : 1 }}>
                      <td style={td}><b>{s.label || slotLabel[s.slot] || s.slot}</b><div style={{ color: '#6b7280', fontSize: '.78rem' }}>{s.room ? `Sala ${s.room.n} · ` : ''}{teacherName[s.teacher] || s.teacher}</div></td>
                      <td style={td}>{s.examLabel}</td>
                      <td style={{ ...td, minWidth: 260 }}>
                        <select value={s.subject?.id || ''} disabled={busy === `subj-${s.id}`} style={{ width: '100%', padding: 6, borderRadius: 8, border: '1px solid #d0d7e2' }}
                          onChange={(e) => run(`subj-${s.id}`, () => liveApi.adminSetSubject(s.id, { subjectId: e.target.value || null }), 'Subiectul a fost schimbat.')}>
                          <option value="">— alege automat —</option>
                          {s.subject && !inList && <option value={s.subject.id}>{s.subject.title}</option>}
                          {list.map((x) => <option key={x.id} value={x.id}>{x.title}</option>)}
                        </select>
                        <input type="text" defaultValue={s.note || ''} placeholder="Notă (opțional, doar pentru admin)" style={{ width: '100%', marginTop: 6, padding: 6, borderRadius: 8, border: '1px solid #e3e8ef', fontSize: '.8rem' }}
                          onBlur={(e) => { if ((e.target.value || '') !== (s.note || '')) run(`note-${s.id}`, () => liveApi.adminSetSubject(s.id, { note: e.target.value })); }} />
                      </td>
                      <td style={td}>{s.subject ? (LESSON_LABEL[s.lesson] || s.lesson) : '—'}</td>
                      <td style={td}>{PHASE_LABEL[s.phase] || s.phase}<div style={{ color: '#6b7280', fontSize: '.78rem' }}>{s.present} acum · {s.participants} în total</div></td>
                      <td style={{ ...td, display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                        {s.subject && s.lesson === 'gata_fara_voce' && data.tts && (
                          <button type="button" style={btnMain} disabled={!!busy} onClick={() => run(`voce-${s.id}`, () => liveApi.adminPrepare({ subjectId: s.subject.id, teacher: s.teacher, revoice: true }), 'Vocea se generează (reapasă dacă nu e gata).')}>
                            {busy === `voce-${s.id}` ? 'Se generează…' : 'Generează vocea'}
                          </button>
                        )}
                        {s.subject && s.lesson !== 'gata' && s.lesson !== 'gata_fara_voce' && (
                          <button type="button" style={btnMain} disabled={!!busy} onClick={() => run(`prep-${s.id}`, () => liveApi.adminPrepare({ subjectId: s.subject.id, teacher: s.teacher }), 'Pregătirea a înaintat (reapasă dacă nu e gata).')}>
                            {busy === `prep-${s.id}` ? 'Se pregătește…' : 'Pregătește lecția'}
                          </button>
                        )}
                        <Link to={`/meditatii/sala/${s.id}`} style={{ ...btn, textDecoration: 'none', color: 'inherit' }}>Intră</Link>
                        {s.status === 'anulata'
                          ? <button type="button" style={btn} disabled={!!busy} onClick={() => run(`c-${s.id}`, () => liveApi.adminSetSubject(s.id, { cancel: false }), 'Ședința a fost reactivată.')}>Reactivează</button>
                          : s.phase !== 'incheiata' && <button type="button" style={btn} disabled={!!busy} onClick={() => { if (window.confirm('Anulezi această ședință? Elevii o vor vedea „Anulată".')) run(`c-${s.id}`, () => liveApi.adminSetSubject(s.id, { cancel: true }), 'Ședința a fost anulată.'); }}>Anulează</button>}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            <p style={{ color: '#6b7280', fontSize: '.8rem', marginTop: 10 }}>
              Programul și subiectele se completează singure (cron, la 15 minute): în fiecare zi, câte o ședință în fiecare sală, la aceeași oră
              (LIVE_INTERVALE, implicit 17-19; LIVE_SALI). O lecție NOUĂ se scrie abia când intră primul elev în sala de
              așteptare sau cumpără bilet (fără elevi, fără cost; LIVE_PREGATIRE_AUTO=1 le pregătește pe toate din timp). La ora de început, cu cel
              puțin 2 elevi pornește ședința comună; cu unul singur, ședința devine 1-la-1. Sunt propuse doar subiectele care au barem găsit.
            </p>
          </div>
        )}
      </div>

      {data?.lessons?.length > 0 && (
        <div style={box}>
          <h3 style={{ color: 'var(--navy)', marginBottom: 10 }}>Lecțiile recente</h3>
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead><tr><th style={th}>Lecția</th><th style={th}>Starea</th><th style={th}>Durata</th><th style={th}>Cost</th><th style={th}>Actualizată</th><th style={th} /></tr></thead>
              <tbody>
                {data.lessons.map((l) => (
                  <tr key={l.id}>
                    <td style={td}><b>{l.title || '(fără titlu încă)'}</b><div style={{ color: '#6b7280', fontSize: '.78rem' }}>{teacherName[l.teacher] || l.teacher} · v{l.version}</div>{l.error && <div style={{ color: '#b3261e', fontSize: '.78rem' }}>{l.error}</div>}</td>
                    <td style={td}>{l.status === 'gata' && l.noVoice ? LESSON_LABEL.gata_fara_voce : (LESSON_LABEL[l.status] || l.status)}</td>
                    <td style={td}>{l.duration_sec ? `${Math.round(l.duration_sec / 60)} min` : '—'}</td>
                    <td style={td}>{l.cost_lei ? `${l.cost_lei} lei` : '—'}</td>
                    <td style={td}>{new Date(l.updated_at).toLocaleString('ro-RO')}</td>
                    <td style={{ ...td, display: 'flex', gap: 6 }}>
                      <button type="button" style={btn} onClick={async () => { try { setScript((await liveApi.adminLesson(l.id)).lesson); } catch (e) { setErr(e.message); } }}>Scriptul</button>
                      <button type="button" style={btn} disabled={!!busy} onClick={() => { if (window.confirm('Regenerezi lecția (script + voce nouă)? Costă din nou.')) run(`re-${l.id}`, () => liveApi.adminPrepare({ subjectId: l.subject_id, teacher: l.teacher, regenerate: true }), 'Regenerarea a pornit.'); }}>
                        {busy === `re-${l.id}` ? '…' : 'Regenerează'}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {script && (
        <div role="dialog" aria-modal="true" onClick={() => setScript(null)} style={{ position: 'fixed', inset: 0, background: 'rgba(10,20,40,.55)', zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 }}>
          <div onClick={(e) => e.stopPropagation()} style={{ background: '#fff', borderRadius: 14, width: 'min(920px, 100%)', maxHeight: '88vh', overflow: 'auto', padding: 24 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, marginBottom: 12 }}>
              <h3 style={{ color: 'var(--navy)' }}>{script.title} · {script.duration ? `${Math.round(script.duration / 60)} min` : ''} · {script.cost_lei ? `${script.cost_lei} lei` : ''}</h3>
              <button type="button" style={btn} onClick={() => setScript(null)}>Închide</button>
            </div>
            {!script.script && <p>Scriptul nu e gata încă.</p>}
            {script.script && (script.script.items || []).map((it) => (
              <div key={it.ref} style={{ borderTop: '1px solid #eef1f5', padding: '10px 0' }}>
                <b>{it.title}</b> {it.points ? `· ${it.points}p` : ''} {it.tryPoll ? `· sondaj (${it.tryPoll.type}, răspuns: ${it.tryPoll.answer})` : ''}
                <div style={{ color: '#374151', fontSize: '.86rem', margin: '4px 0' }}>{it.statement}</div>
                {Object.entries(it.modes || {}).map(([m, segs]) => (
                  <details key={m} style={{ fontSize: '.84rem', margin: '4px 0' }}>
                    <summary>{m} · {segs.length} fraze</summary>
                    <ol style={{ paddingLeft: 20 }}>{segs.map((g) => <li key={g.id}>{g.say}{g.board?.length ? <span style={{ color: '#1f5faa' }}> [tablă: {g.board.join(' | ')}]</span> : null}</li>)}</ol>
                  </details>
                ))}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
