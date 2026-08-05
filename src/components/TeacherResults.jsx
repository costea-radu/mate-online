import { authHeaders } from '../lib/api';
import { useEffect, useMemo, useRef, useState } from 'react';
import StudentAIMastery from './StudentAIMastery';
import AITeacherReport from './AITeacherReport';

const PER_PAGE = 10; // elevi pe pagină

function pct(score, max) { if (!max) return 0; return Math.round((score / max) * 100); }
function scoreColor(p) { return p >= 80 ? '#2e7d32' : p >= 50 ? '#e65100' : '#c62828'; }
function fmtDate(iso) {
  if (!iso) return '';
  try { return new Date(iso).toLocaleDateString('ro-RO', { day: '2-digit', month: 'short', year: 'numeric' }); }
  catch { return ''; }
}
function fmtTime(sec) {
  if (!sec || sec <= 0) return '—';
  const m = Math.floor(sec / 60), s = sec % 60;
  if (m === 0) return `${s}s`;
  if (s === 0) return `${m} min`;
  return `${m} min ${s}s`;
}
const typeLabel = { interactive: 'Test interactiv', manual: 'Manual', pdf: 'PDF' };

function copyText(value, done) {
  if (navigator.clipboard?.writeText) {
    navigator.clipboard.writeText(value).then(done).catch(() => fallbackCopy(value, done));
  } else { fallbackCopy(value, done); }
}
function fallbackCopy(value, done) {
  try {
    const ta = document.createElement('textarea');
    ta.value = value; ta.style.position = 'fixed'; ta.style.opacity = '0';
    document.body.appendChild(ta); ta.select(); document.execCommand('copy');
    document.body.removeChild(ta); done();
  } catch { /* ignore */ }
}

// ─── Bloc link de invitație (profesor sau părinte) ──────────────────────────
function InviteBox({ inviteCode, displayName, role }) {
  const [copied, setCopied] = useState('');
  const [showMailOpts, setShowMailOpts] = useState(false);
  const isParent = role === 'parinte';
  const roleWord = isParent ? 'părinte' : 'profesor';
  const link = inviteCode ? `${window.location.origin}/asociere?cod=${inviteCode}` : '';
  const shareMsg = `Salut! Asociază-te contului meu de ${roleWord}${displayName ? ` (${displayName})` : ''} pe ExamenMate cu un singur clic: ${link}`;
  const subject = encodeURIComponent('Invitație ExamenMate');
  const body = encodeURIComponent(shareMsg);
  const mailHref = `mailto:?subject=${subject}&body=${body}`;
  const gmailUrl = `https://mail.google.com/mail/?view=cm&fs=1&su=${subject}&body=${body}`;
  const outlookUrl = `https://outlook.live.com/mail/0/deeplink/compose?subject=${subject}&body=${body}`;
  const yahooUrl = `https://compose.mail.yahoo.com/?subject=${subject}&body=${body}`;
  const waHref = `https://wa.me/?text=${encodeURIComponent(shareMsg)}`;
  const isMobile = typeof navigator !== 'undefined' && /Mobi|Android|iPhone|iPad|iPod/i.test(navigator.userAgent || '');

  function copy(value, key) { copyText(value, () => { setCopied(key); setTimeout(() => setCopied(''), 1800); }); }
  const copyBtn = (active) => ({
    padding: '8px 14px', borderRadius: 8, fontWeight: 600, fontSize: '0.82rem',
    border: '1.5px solid var(--navy)', background: active ? 'var(--navy)' : 'transparent',
    color: active ? '#fff' : 'var(--navy)', cursor: 'pointer', whiteSpace: 'nowrap', transition: 'all 0.15s',
  });
  const altMailBtn = {
    padding: '8px 14px', borderRadius: 8, fontWeight: 600, fontSize: '0.8rem',
    border: '1.5px solid var(--border)', background: '#fff', color: 'var(--navy)', cursor: 'pointer',
    display: 'inline-flex', alignItems: 'center',
  };
  // Deschide direct fereastra de „Scriere" din webmail (în browser) + copiază mesajul.
  function openMail(url) {
    copy(shareMsg, 'mail');
    window.open(url, '_blank', 'noopener,noreferrer');
    setShowMailOpts(false);
  }

  const title = isParent ? '🔗 Asociază-te cu copilul tău' : '🔗 Invită elevi';
  const intro = isParent
    ? 'Trimite linkul de mai jos copilului tău, pe e-mail sau WhatsApp. Când dă clic pe link și se autentifică, este asociat automat contului tău și îi vei vedea rezultatele mai jos.'
    : 'Trimite linkul de mai jos elevilor tăi, pe e-mail sau WhatsApp. Când dau clic pe link și se autentifică, sunt asociați automat contului tău și le vei vedea rezultatele mai jos.';

  return (
    <div className="card" style={{ marginBottom: 24 }}>
      <h3 style={{ fontFamily: 'var(--font-display)', marginBottom: 6, color: 'var(--navy)' }}>{title}</h3>
      <p style={{ color: 'var(--text-light)', fontSize: '0.9rem', marginBottom: 18 }}>{intro}</p>

      {!inviteCode ? (
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, color: 'var(--text-muted)', fontSize: '0.88rem' }}>
          <span className="spinner" style={{ width: 18, height: 18, borderWidth: 2 }} /> Se generează linkul…
        </div>
      ) : (
        <>
          <div style={{ marginBottom: 16 }}>
            <div style={{ fontSize: '0.78rem', fontWeight: 600, color: 'var(--text)', marginBottom: 6 }}>Link de asociere</div>
            <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
              <input
                readOnly value={link} onFocus={(e) => e.target.select()}
                style={{
                  flex: '1 1 240px', minWidth: 0, padding: '9px 12px', borderRadius: 8,
                  border: '1.5px solid var(--border)', background: 'var(--cream)', color: 'var(--text)',
                  fontSize: '0.84rem', fontFamily: 'monospace',
                }}
              />
              <button style={copyBtn(copied === 'link')} onClick={() => copy(link, 'link')}>
                {copied === 'link' ? '✓ Copiat' : 'Copiază linkul'}
              </button>
            </div>
          </div>

          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center' }}>
            {isMobile ? (
              <a href={mailHref} onClick={() => copy(shareMsg, 'mail')} style={{
                display: 'inline-flex', alignItems: 'center', gap: 8, padding: '9px 16px', borderRadius: 8,
                fontWeight: 600, fontSize: '0.85rem', background: 'var(--navy)', color: '#fff',
              }}>✉️ Trimite pe e-mail</a>
            ) : (
              <>
                <button type="button" onClick={() => openMail(gmailUrl)} style={{
                  display: 'inline-flex', alignItems: 'center', gap: 8, padding: '9px 16px', borderRadius: 8,
                  fontWeight: 600, fontSize: '0.85rem', background: 'var(--navy)', color: '#fff', border: 'none', cursor: 'pointer',
                }}>✉️ Trimite pe e-mail</button>
                <button type="button" onClick={() => setShowMailOpts((v) => !v)} style={{
                  padding: '9px 12px', borderRadius: 8, fontWeight: 600, fontSize: '0.8rem',
                  background: 'transparent', color: 'var(--navy)', border: '1.5px solid var(--navy)', cursor: 'pointer', whiteSpace: 'nowrap',
                }}>alt opțiuni {showMailOpts ? '▴' : '▾'}</button>
              </>
            )}
            <a href={waHref} target="_blank" rel="noopener noreferrer" style={{
              display: 'inline-flex', alignItems: 'center', gap: 8, padding: '9px 16px', borderRadius: 8,
              fontWeight: 600, fontSize: '0.85rem', background: '#25D366', color: '#fff',
            }}>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><path d="M.057 24l1.687-6.163a11.867 11.867 0 0 1-1.587-5.946C.16 5.335 5.495 0 12.05 0a11.817 11.817 0 0 1 8.413 3.488 11.824 11.824 0 0 1 3.48 8.414c-.003 6.557-5.338 11.892-11.893 11.892a11.9 11.9 0 0 1-5.688-1.448L.057 24zm6.597-3.807c1.676.995 3.276 1.591 5.392 1.592 5.448 0 9.886-4.434 9.889-9.885.002-5.462-4.415-9.89-9.881-9.892-5.452 0-9.887 4.434-9.889 9.884a9.86 9.86 0 0 0 1.515 5.26l-.999 3.648 3.736-.98a9.875 9.875 0 0 0 .238.173z"/></svg>
              Trimite pe WhatsApp
            </a>
          </div>

          {!isMobile && showMailOpts && (
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 10, alignItems: 'center' }}>
              <span style={{ fontSize: '0.78rem', color: 'var(--text-muted)' }}>Deschide „Scriere" în:</span>
              <button type="button" onClick={() => openMail(gmailUrl)} style={altMailBtn}>Gmail</button>
              <button type="button" onClick={() => openMail(outlookUrl)} style={altMailBtn}>Outlook</button>
              <button type="button" onClick={() => openMail(yahooUrl)} style={altMailBtn}>Yahoo Mail</button>
              <a href={mailHref} onClick={() => copy(shareMsg, 'mail')} style={{ ...altMailBtn, textDecoration: 'none' }}>Aplicația de e-mail</a>
            </div>
          )}

          {copied === 'mail' && (
            <div style={{ marginTop: 8, fontSize: '0.78rem', color: '#2e7d32', fontWeight: 600 }}>
              ✓ Mesajul a fost copiat. Dacă fereastra de e-mail se deschide goală (de ex. după autentificare), lipește-l cu Ctrl+V.
            </div>
          )}
        </>
      )}
    </div>
  );
}

// ─── Grafic „bursă" pentru progresul elevului ──────────────────────────────
function ProgressChart({ rows }) {
  const [active, setActive] = useState(null);
  const data = useMemo(() => {
    const arr = [...rows].sort((a, b) => new Date(a.completed_at || 0) - new Date(b.completed_at || 0));
    return arr.map((r) => ({ p: pct(r.score, r.max_score), title: r.test_title, date: r.completed_at, score: r.score, max: r.max_score }));
  }, [rows]);

  const W = 480, H = 150, padL = 26, padR = 12, padT = 22, padB = 14;
  const innerW = W - padL - padR, innerH = H - padT - padB;
  const n = data.length;
  const x = (i) => (n <= 1 ? padL + innerW / 2 : padL + (innerW * i) / (n - 1));
  const y = (p) => padT + (1 - p / 100) * innerH;
  const linePts = data.map((d, i) => `${x(i)},${y(d.p)}`).join(' ');
  const act = active != null ? data[active] : null;

  return (
    <div style={{ width: '100%', maxWidth: 480 }}>
      <svg viewBox={`0 0 ${W} ${H}`} width="100%" style={{ display: 'block', overflow: 'visible' }} role="img" aria-label="Grafic progres">
        {[0, 50, 100].map((g) => (
          <g key={g}>
            <line x1={padL} x2={W - padR} y1={y(g)} y2={y(g)} stroke="var(--border)" strokeWidth="1" strokeDasharray={g === 0 ? '0' : '3 4'} />
            <text x={padL - 6} y={y(g) + 3} fontSize="9" fill="var(--text-muted)" textAnchor="end">{g}%</text>
          </g>
        ))}
        {act && <line x1={x(active)} x2={x(active)} y1={padT} y2={H - padB} stroke="var(--border)" strokeWidth="1" />}
        {n > 1 && <polyline points={linePts} fill="none" stroke="var(--navy)" strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />}
        {data.map((d, i) => (
          <circle
            key={i} cx={x(i)} cy={y(d.p)} r={active === i ? 6 : 4}
            fill={scoreColor(d.p)} stroke="#fff" strokeWidth={active === i ? 2 : 1}
            style={{ cursor: 'pointer' }}
            onClick={() => setActive(active === i ? null : i)}
          />
        ))}
        {act && (() => {
          const tx = x(active), ty = y(act.p), boxW = 34, boxH = 16;
          let bx = Math.max(padL, Math.min(tx - boxW / 2, W - padR - boxW));
          let by = ty - boxH - 8; if (by < 0) by = ty + 8;
          return (
            <g>
              <rect x={bx} y={by} width={boxW} height={boxH} rx={4} fill="var(--navy)" />
              <text x={bx + boxW / 2} y={by + boxH - 4} fontSize="10" fill="#fff" textAnchor="middle" fontWeight="700">{act.p}%</text>
            </g>
          );
        })()}
      </svg>
      {act ? (
        <div style={{ fontSize: '0.74rem', color: 'var(--text)', marginTop: 6 }}>
          <strong>{act.title}</strong>
          <span style={{ color: 'var(--text-muted)' }}>{act.date ? ` · ${fmtDate(act.date)}` : ''} · {act.score}/{act.max} ({act.p}%)</span>
        </div>
      ) : (
        <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)', marginTop: 6 }}>Apasă pe un punct pentru a vedea procentul.</div>
      )}
    </div>
  );
}

// ─── Rând elev (antet rolldown + detaliu cu Punctaj/Încercări/Timp/Progres) ──
function StudentRow({ student, isOpen, onToggle, isTeacher, isParent, groups, onMove, onRemove, busy }) {
  const hasRows = student.count > 0;
  const [showProgress, setShowProgress] = useState(false);
  const headerBg = 'transparent';
  return (
    <>
      <tr
        onClick={onToggle}
        style={{ borderTop: '1px solid var(--border)', cursor: 'pointer', background: headerBg, transition: 'background 0.12s' }}
        onMouseEnter={(e) => { e.currentTarget.style.background = 'var(--cream)'; }}
        onMouseLeave={(e) => { e.currentTarget.style.background = headerBg; }}
      >
        <td style={{ padding: '11px 14px', verticalAlign: 'top' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{ fontSize: '0.7rem', color: 'var(--text-muted)', width: 12, display: 'inline-block' }}>
              {isOpen ? '▾' : '▸'}
            </span>
            <span>
              <span style={{ fontWeight: 600, color: student.archived ? 'var(--text-muted)' : 'var(--navy)' }}>{student.name}</span>
              {student.archived && (
                <span style={{ marginLeft: 8, fontSize: '0.68rem', fontWeight: 700, color: '#8a3b3b', background: 'rgba(198,40,40,.08)', border: '1px solid rgba(198,40,40,.35)', borderRadius: 12, padding: '2px 8px', whiteSpace: 'nowrap', verticalAlign: 'middle' }}>
                  cont șters{student.deletedAt ? ` · ${fmtDate(student.deletedAt)}` : ''}
                </span>
              )}
              {student.email && (
                <span style={{ display: 'block', fontSize: '0.72rem', color: 'var(--text-muted)' }}>{student.email}</span>
              )}
            </span>
          </div>
        </td>
        <td style={{ padding: '11px 14px', color: 'var(--text-light)', verticalAlign: 'top' }}>
          {hasRows
            ? `${student.count} ${student.count === 1 ? 'rezultat' : 'rezultate'}`
            : <span style={{ color: 'var(--text-muted)', fontStyle: 'italic' }}>Niciun rezultat încă</span>}
        </td>
        <td style={{ padding: '11px 14px', textAlign: 'right', verticalAlign: 'top', whiteSpace: 'nowrap' }}>
          {student.avg !== null
            ? <span style={{ fontWeight: 700, color: scoreColor(student.avg) }}>media {student.avg}%</span>
            : <span style={{ color: 'var(--text-muted)' }}>—</span>}
        </td>
      </tr>

      {isOpen && (
        <tr style={{ background: 'var(--cream)', borderTop: '1px solid var(--border)' }}>
          <td colSpan={3} style={{ padding: '14px 16px' }}>
            {/* Opțiuni sub nume: mutare (profesor) + ștergere */}
            {student.archived && (
              <div style={{ fontSize: '0.8rem', color: 'var(--text-light)', background: 'rgba(198,40,40,.06)', border: '1px solid rgba(198,40,40,.25)', borderRadius: 8, padding: '8px 12px', marginBottom: 12 }}>
                Contul acestui elev a fost șters{student.deletedAt ? ` la ${fmtDate(student.deletedAt)}` : ''}
                {student.reason === 'inactivity' ? ' (inactivitate de peste 12 luni)' : student.reason === 'self_delete' ? ' (la cererea lui)' : ''}.
                Rezultatele de mai jos rămân doar aici — le poți elimina definitiv cu butonul de ștergere.
              </div>
            )}
            <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center', marginBottom: 14 }}>
              {isTeacher && !student.archived && (
                <label style={{ display: 'inline-flex', alignItems: 'center', gap: 8, fontSize: '0.82rem', color: 'var(--text)' }}>
                  <span style={{ fontWeight: 600 }}>↪ Mutare în grupă:</span>
                  <select
                    value={student.group_id || ''}
                    disabled={busy}
                    onChange={(e) => onMove(student.id, e.target.value || null)}
                    style={{ padding: '6px 10px', borderRadius: 8, border: '1.5px solid var(--border)', background: '#fff', fontSize: '0.82rem' }}
                  >
                    <option value="">Fără grupă</option>
                    {groups.map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}
                  </select>
                </label>
              )}
              <button
                onClick={() => onRemove(student)}
                disabled={busy}
                style={{
                  padding: '6px 14px', borderRadius: 8, fontWeight: 600, fontSize: '0.8rem',
                  background: 'transparent', color: 'var(--danger)', border: '1.5px solid var(--danger)',
                  cursor: busy ? 'default' : 'pointer', opacity: busy ? 0.6 : 1,
                }}
              >
                {student.archived ? '🗑 Șterge definitiv datele' : '🗑 Ștergere elev'}
              </button>
            </div>

            {/* Zona Progres — buton cu rolldown + grafic „bursă" */}
            <div style={{ background: '#fff', borderRadius: 'var(--radius)', marginBottom: 14, border: '1px solid var(--border)', overflow: 'hidden' }}>
              <button
                type="button"
                onClick={() => setShowProgress((v) => !v)}
                style={{ width: '100%', display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, padding: '12px 14px', background: 'transparent', border: 'none', cursor: 'pointer', fontFamily: 'var(--font-body)', textAlign: 'left' }}
              >
                <strong style={{ fontSize: '0.85rem', color: 'var(--navy)' }}>
                  📈 Progres
                  {student.avg !== null && (
                    <span style={{ fontWeight: 600, color: scoreColor(student.avg), marginLeft: 8 }}>media {student.avg}%</span>
                  )}
                </strong>
                <span style={{ color: 'var(--text-muted)', fontSize: '0.8rem' }}>{showProgress ? '▾ ascunde' : '▸ vezi'}</span>
              </button>
              {showProgress && (
                <div style={{ padding: '0 14px 14px' }}>
                  <div style={{ fontSize: '0.76rem', color: 'var(--text-muted)', marginBottom: 10 }}>
                    {student.count} exerciții · {student.attemptsTotal} încercări · {fmtTime(student.timeTotal)} total
                  </div>
                  {hasRows
                    ? <ProgressChart rows={student.rows} />
                    : <span style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>Niciun rezultat încă.</span>}
                </div>
              )}
            </div>

            {/* Detaliu rezultate: Punctaj / Nr. încercări / Timp / Prof. Virtual */}
            {hasRows && (
              <div style={{ overflowX: 'auto', maxWidth: '100%' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.82rem', minWidth: 540 }}>
                  <thead>
                    <tr style={{ textAlign: 'left', color: 'var(--text-muted)' }}>
                      <th style={{ padding: '6px 10px', fontWeight: 700 }}>Test sau exercițiu</th>
                      <th style={{ padding: '6px 10px', fontWeight: 700, textAlign: 'right', whiteSpace: 'nowrap' }}>Punctaj</th>
                      <th style={{ padding: '6px 10px', fontWeight: 700, textAlign: 'right', whiteSpace: 'nowrap' }}>Nr. încercări</th>
                      <th style={{ padding: '6px 10px', fontWeight: 700, textAlign: 'right', whiteSpace: 'nowrap' }}>Timp</th>
                      <th style={{ padding: '6px 10px', fontWeight: 700, textAlign: 'right', whiteSpace: 'nowrap' }}>A folosit Prof. Virtual</th>
                    </tr>
                  </thead>
                  <tbody>
                    {student.rows.map((r, i) => {
                      const p = pct(r.score, r.max_score);
                      return (
                        <tr key={r.content_id + '-' + i} style={{ borderTop: '1px solid var(--border)' }}>
                          <td style={{ padding: '7px 10px' }}>
                            <span style={{ color: 'var(--text)', fontWeight: 500 }}>{r.test_title}</span>
                            <span style={{ display: 'block', fontSize: '0.7rem', color: 'var(--text-muted)', marginTop: 2 }}>
                              {(typeLabel[r.content_type] || r.content_type)}{r.completed_at ? ` · ${fmtDate(r.completed_at)}` : ''}
                            </span>
                            <span style={{ display: 'block', marginTop: 4, background: 'var(--cream-dark)', borderRadius: 20, height: 5, maxWidth: 180, overflow: 'hidden' }}>
                              <span style={{ display: 'block', width: `${p}%`, height: '100%', background: scoreColor(p), borderRadius: 20 }} />
                            </span>
                          </td>
                          <td style={{ padding: '7px 10px', textAlign: 'right', whiteSpace: 'nowrap' }}>
                            <span style={{ fontWeight: 700, color: scoreColor(p) }}>{r.score}/{r.max_score}</span>
                            <span style={{ color: scoreColor(p), fontSize: '0.74rem', marginLeft: 5 }}>({p}%)</span>
                          </td>
                          <td style={{ padding: '7px 10px', textAlign: 'right', color: 'var(--text)' }}>{r.attempts}</td>
                          <td style={{ padding: '7px 10px', textAlign: 'right', color: 'var(--text)', whiteSpace: 'nowrap' }}>{fmtTime(r.time_spent)}</td>
                          <td style={{ padding: '7px 10px', textAlign: 'right', whiteSpace: 'nowrap' }}>
                            {r.ai_questions > 0 ? (
                              <span style={{ fontWeight: 700, color: '#8a6d00', background: 'rgba(232,185,49,.18)', border: '1px solid rgba(232,185,49,.5)', borderRadius: 12, padding: '2px 9px', fontSize: '0.76rem' }}>
                                Da, {r.ai_questions} {r.ai_questions === 1 ? 'întrebare' : 'întrebări'}
                              </span>
                            ) : (
                              <span style={{ color: 'var(--text-muted)' }}>Nu</span>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}

            {/* Temele de la „Meditații cu Profesorul Virtual" (inclusiv generate) */}
            {(student.meditatii || []).length > 0 && (
              <div style={{ background: '#fff', borderRadius: 'var(--radius)', border: '1.5px solid rgba(232,185,49,.55)', padding: '12px 14px', marginBottom: 14 }}>
                <strong style={{ fontSize: '0.85rem', color: 'var(--navy)' }}>🎓 Teme de la Meditații cu Prof. Virtual</strong>
                <div style={{ display: 'grid', gap: 5, marginTop: 8 }}>
                  {student.meditatii.slice(0, 12).map((h, i) => {
                    const solved = h.status === 'rezolvata';
                    const p = solved && h.max_score ? pct(h.score, h.max_score) : null;
                    return (
                      <div key={i} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10, fontSize: '0.8rem', padding: '5px 8px', background: 'var(--cream)', borderRadius: 7, flexWrap: 'wrap' }}>
                        <span style={{ color: 'var(--text)', fontWeight: 500 }}>
                          {h.kind === 'content' ? '🧩' : '📚'} {h.title}
                          <span style={{ color: 'var(--text-muted)', fontWeight: 400 }}>{h.completed_at ? ` · ${fmtDate(h.completed_at)}` : h.assigned_at ? ` · dată pe ${fmtDate(h.assigned_at)}` : ''}</span>
                        </span>
                        {solved ? (
                          <span style={{ whiteSpace: 'nowrap' }}>
                            <span style={{ fontWeight: 700, color: scoreColor(p) }}>{h.score}/{h.max_score} ({p}%)</span>
                            {h.grade != null && <span style={{ marginLeft: 8, fontWeight: 700, color: '#8a6d00', background: 'rgba(232,185,49,.18)', border: '1px solid rgba(232,185,49,.5)', borderRadius: 12, padding: '1px 8px', fontSize: '0.74rem' }}>nota {h.grade}</span>}
                          </span>
                        ) : (
                          <span style={{ color: 'var(--text-muted)', fontStyle: 'italic', whiteSpace: 'nowrap' }}>nerezolvată încă</span>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            {(isTeacher || isParent) && !student.archived && (
              <StudentAIMastery
                studentId={student.id}
                aiTests={[
                  ...student.rows.filter((r) => r.ai_questions > 0),
                  ...(student.aiOnly || []),
                ]}
              />
            )}

            {/* Pentru conturile șterse: stăpânirea subiectelor din arhivă */}
            {student.archived && (student.masteryArchived || []).length > 0 && (
              <div style={{ background: '#fff', borderRadius: 'var(--radius)', border: '1px solid var(--border)', padding: '12px 14px', marginTop: 14 }}>
                <strong style={{ fontSize: '0.85rem', color: 'var(--navy)' }}>🧠 Stăpânirea subiectelor (arhivă)</strong>
                <div style={{ display: 'grid', gap: 6, marginTop: 10 }}>
                  {student.masteryArchived.slice(0, 12).map((m, i) => {
                    const p = Math.round((Number(m.mastery) || 0) * 100);
                    return (
                      <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 10, fontSize: '0.8rem' }}>
                        <span style={{ flex: '0 0 170px', color: 'var(--text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={m.topic}>{m.topic}</span>
                        <span style={{ flex: 1, background: 'var(--cream-dark)', borderRadius: 20, height: 6, overflow: 'hidden' }}>
                          <span style={{ display: 'block', width: `${p}%`, height: '100%', background: scoreColor(p), borderRadius: 20 }} />
                        </span>
                        <span style={{ fontWeight: 700, color: scoreColor(p), width: 40, textAlign: 'right' }}>{p}%</span>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
            {student.archived && (student.assignmentsArchived || []).length > 0 && (
              <div style={{ marginTop: 12, fontSize: '0.8rem', color: 'var(--text-light)' }}>
                <strong style={{ color: 'var(--navy)' }}>📝 Teme rezolvate:</strong>{' '}
                {student.assignmentsArchived.map((t) => `${t.title}${t.score != null ? ` (${t.score}/${t.max_score})` : ''}`).join(' · ')}
              </div>
            )}
          </td>
        </tr>
      )}
    </>
  );
}

// ─── Dashboard mentor (profesor cu grupe / părinte simplu) ──────────────────
export default function TeacherResults({ user, inviteCode, displayName, role = 'profesor' }) {
  const isTeacher = role === 'profesor';
  const isParent = role === 'parinte';
  const [data, setData] = useState({ students: [], results: [], groups: [], aiUsage: [], archived: [], meditatii: [] });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [page, setPage] = useState(0);
  const [expanded, setExpanded] = useState({});
  const [selectedGroup, setSelectedGroup] = useState(null); // null = Toți
  const [busy, setBusy] = useState(false);
  const [showLeaderboard, setShowLeaderboard] = useState(false);
  const fetchedFor = useRef(null);
  const autoGroupRan = useRef(false);
  const searchRef = useRef(null);

  async function load() {
    if (!user?.id) return;
    setLoading(true); setError('');
    try {
      const res = await fetch('/api/teacher-students', {
        method: 'POST', headers: await authHeaders(),
        body: JSON.stringify({ userId: user.id }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || `Eroare server (${res.status})`);
      setData({ students: json.students || [], results: json.results || [], groups: json.groups || [], aiUsage: json.aiUsage || [], archived: json.archived || [], meditatii: json.meditatii || [] });
    } catch (e) {
      setError(e.message || 'Nu s-au putut încărca rezultatele.');
    } finally { setLoading(false); }
  }

  useEffect(() => {
    if (fetchedFor.current === user?.id) return;
    fetchedFor.current = user?.id;
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id]);

  async function manage(action, payload) {
    setBusy(true);
    try {
      const res = await fetch('/api/teacher-manage', {
        method: 'POST', headers: await authHeaders(),
        body: JSON.stringify({ userId: user.id, action, ...payload }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || 'Eroare');
      await load();
      return json;
    } catch (e) {
      alert(e.message || 'A apărut o eroare.');
      return null;
    } finally { setBusy(false); }
  }

  // Creează automat „Grupa 1" la prima deschidere (cerința: sub butonul de căutare)
  useEffect(() => {
    if (!open || !isTeacher || loading || error || autoGroupRan.current) return;
    if ((data.groups || []).length === 0) {
      autoGroupRan.current = true;
      manage('create_group', { name: 'Grupa 1' });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, isTeacher, loading, error, data.groups]);

  // Construiește lista de elevi cu agregări
  const studentsAll = useMemo(() => {
    const map = new Map();
    (data.students || []).forEach((s) => {
      map.set(s.id, { id: s.id, name: s.full_name || 'Elev', email: s.email || '', group_id: s.group_id || null, rows: [] });
    });
    (data.results || []).forEach((r) => {
      if (!map.has(r.student_id)) {
        map.set(r.student_id, { id: r.student_id, name: r.student_name || 'Elev', email: r.student_email || '', group_id: null, rows: [] });
      }
      map.get(r.student_id).rows.push(r);
    });
    // materiale la care elevul a pus întrebări Prof. Virtual, dar fără punctaj încă
    (data.aiUsage || []).forEach((r) => {
      const s = map.get(r.student_id);
      if (!s) return;
      if (!s.aiOnly) s.aiOnly = [];
      s.aiOnly.push(r);
    });
    // temele de la Meditații cu Profesorul Virtual (inclusiv cele generate)
    (data.meditatii || []).forEach((r) => {
      const s = map.get(r.student_id);
      if (!s) return;
      if (!s.meditatii) s.meditatii = [];
      s.meditatii.push(r);
    });
    // Elevii cu CONT ȘTERS (inactivitate sau la cerere) — rezultatele lor rămân
    // arhivate pentru mentor; apar în aceeași listă, marcați „cont șters".
    (data.archived || []).forEach((a) => {
      const ex = a.extras || {};
      map.set('arh-' + a.id, {
        id: 'arh-' + a.id,
        archived: true,
        archiveId: a.id,
        deletedAt: a.deleted_at,
        reason: a.reason,
        name: a.student_name || 'Elev',
        email: a.student_email || '',
        group_id: null,
        rows: Array.isArray(a.results) ? a.results : [],
        aiOnly: Array.isArray(ex.aiOnly) && ex.aiOnly.length ? ex.aiOnly : undefined,
        masteryArchived: Array.isArray(ex.mastery) ? ex.mastery : [],
        assignmentsArchived: Array.isArray(ex.assignments) ? ex.assignments : [],
      });
    });
    const arr = [...map.values()];
    arr.forEach((g) => {
      g.count = g.rows.length;
      g.avg = g.count ? Math.round(g.rows.reduce((a, r) => a + pct(r.score, r.max_score), 0) / g.count) : null;
      g.attemptsTotal = g.rows.reduce((a, r) => a + (r.attempts || 0), 0);
      g.timeTotal = g.rows.reduce((a, r) => a + (r.time_spent || 0), 0);
    });
    arr.sort((a, b) => a.name.localeCompare(b.name, 'ro'));
    return arr;
  }, [data]);

  const groups = data.groups || [];
  const groupCount = (gid) => studentsAll.filter((s) => s.group_id === gid).length;

  const inGroup = useMemo(() => {
    if (!isTeacher || selectedGroup === null) return studentsAll;
    return studentsAll.filter((s) => s.group_id === selectedGroup);
  }, [studentsAll, selectedGroup, isTeacher]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return inGroup;
    return inGroup.filter((s) => s.name.toLowerCase().includes(q) || s.email.toLowerCase().includes(q));
  }, [inGroup, query]);

  const leaderboard = useMemo(
    () => inGroup.filter((s) => !s.archived && s.avg !== null).sort((a, b) => b.avg - a.avg).slice(0, 20),
    [inGroup]
  );

  const totalPages = Math.max(1, Math.ceil(filtered.length / PER_PAGE));
  const safePage = Math.min(page, totalPages - 1);
  const pageStudents = filtered.slice(safePage * PER_PAGE, safePage * PER_PAGE + PER_PAGE);
  const totalStudents = studentsAll.length;
  const selectedGroupObj = groups.find((g) => g.id === selectedGroup);

  function onQueryChange(v) { setQuery(v); setPage(0); if (v && !open) setOpen(true); }
  function toggleStudent(id) { setExpanded((p) => ({ ...p, [id]: !p[id] })); }

  // Elevii activi ≠ arhivele elevilor șterși (grupele numără doar activii)
  const activeCount = studentsAll.filter((s) => !s.archived).length;
  const archivedCount = totalStudents - activeCount;

  function createGroup() { manage('create_group', { name: `Grupa ${groups.length + 1}` }); }
  function renameGroup(g) {
    const name = window.prompt('Nume grupă:', g.name);
    if (name && name.trim()) manage('rename_group', { groupId: g.id, name: name.trim() });
  }
  function deleteGroup(g) {
    if (window.confirm(`Ștergi grupa „${g.name}"? Elevii nu se șterg, rămân doar fără grupă.`)) {
      if (selectedGroup === g.id) setSelectedGroup(null);
      manage('delete_group', { groupId: g.id });
    }
  }
  function moveStudent(studentId, groupId) { manage('move_student', { studentId, groupId }); }
  function removeStudent(student) {
    if (student.archived) {
      // arhiva unui elev cu cont șters → eliminare DEFINITIVĂ a datelor păstrate
      if (window.confirm(`Ștergi definitiv rezultatele păstrate ale elevului „${student.name}"? Contul lui a fost deja șters — după această acțiune datele nu mai pot fi recuperate.`)) {
        manage('delete_archived', { archiveId: student.archiveId });
      }
      return;
    }
    if (window.confirm('Ștergi elevul din lista ta? Asocierea va fi eliminată (contul elevului rămâne).')) {
      manage('remove_student', { studentId: student.id });
    }
  }

  const chip = (active) => ({
    padding: '6px 12px', borderRadius: 20, fontSize: '0.8rem', fontWeight: 600, cursor: 'pointer',
    border: `1.5px solid ${active ? 'var(--navy)' : 'var(--border)'}`,
    background: active ? 'var(--navy)' : '#fff', color: active ? '#fff' : 'var(--navy)',
    whiteSpace: 'nowrap', transition: 'all 0.15s',
  });

  const countLabel = `${activeCount} ${activeCount === 1 ? 'elev asociat' : 'elevi asociați'}`
    + (archivedCount ? ` · ${archivedCount} ${archivedCount === 1 ? 'cont șters' : 'conturi șterse'}` : '');

  return (
    <>
      <InviteBox inviteCode={inviteCode} displayName={displayName} role={role} />

      <div className="card" style={{ marginBottom: 24 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
          <h3 style={{ fontFamily: 'var(--font-display)', color: 'var(--navy)', margin: 0 }}>
            📊 {isTeacher ? 'Grupe / Rezultate elevi' : 'Rezultate elevi'}{' '}
            <span style={{ fontSize: '0.82rem', fontWeight: 500, color: 'var(--text-muted)' }}>({countLabel})</span>
          </h3>
          <div style={{ display: 'flex', gap: 8 }}>
            <button onClick={load} title="Reîmprospătează"
              style={{ padding: '8px 12px', borderRadius: 8, border: '1.5px solid var(--border)', background: 'transparent', color: 'var(--text-light)', cursor: 'pointer', fontSize: '0.82rem', fontWeight: 600 }}>↻</button>
            <button onClick={() => setOpen((o) => !o)}
              style={{ padding: '8px 16px', borderRadius: 8, border: 'none', background: 'var(--navy)', color: '#fff', cursor: 'pointer', fontSize: '0.85rem', fontWeight: 600 }}>
              {open ? (isTeacher ? 'Ascunde grupe / rezultate ▴' : 'Ascunde rezultatele ▴') : (isTeacher ? 'Vezi grupe / rezultate ▾' : 'Vezi rezultatele ▾')}
            </button>
          </div>
        </div>

        {open && (
          <div style={{ marginTop: 18 }}>
            {/* Căutare */}
            <form onSubmit={(e) => { e.preventDefault(); searchRef.current?.blur(); }}
              style={{ display: 'flex', gap: 8, marginBottom: 14, flexWrap: 'wrap' }}>
              <div style={{ position: 'relative', flex: '1 1 220px', minWidth: 0 }}>
                <span style={{ position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)', fontSize: '0.9rem', opacity: 0.6 }}>🔍</span>
                <input ref={searchRef} value={query} onChange={(e) => onQueryChange(e.target.value)}
                  placeholder="Caută elev după nume sau e-mail…"
                  style={{ width: '100%', padding: '10px 36px 10px 34px', borderRadius: 8, border: '1.5px solid var(--border)', background: 'var(--cream)', fontSize: '0.9rem', fontFamily: 'var(--font-body)' }} />
                {query && (
                  <button type="button" onClick={() => onQueryChange('')}
                    style={{ position: 'absolute', right: 8, top: '50%', transform: 'translateY(-50%)', background: 'none', border: 'none', cursor: 'pointer', color: '#aaa', fontSize: '1rem' }}>✕</button>
                )}
              </div>
              <button type="submit"
                style={{ padding: '10px 18px', borderRadius: 8, border: 'none', background: 'var(--gold)', color: 'var(--navy-dark)', fontWeight: 700, fontSize: '0.85rem', cursor: 'pointer' }}>🔍 Caută</button>
            </form>

            {/* Bara de grupe (doar profesor) */}
            {isTeacher && !loading && !error && (
              <div style={{ marginBottom: 14 }}>
                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
                  <button style={chip(selectedGroup === null)} onClick={() => { setSelectedGroup(null); setPage(0); }}>
                    Toți ({totalStudents})
                  </button>
                  {groups.map((g) => (
                    <button key={g.id} style={chip(selectedGroup === g.id)} onClick={() => { setSelectedGroup(g.id); setPage(0); }}>
                      {g.name} ({groupCount(g.id)})
                    </button>
                  ))}
                  <button
                    onClick={createGroup} disabled={busy} title="Creează grupă nouă"
                    style={{ padding: '6px 12px', borderRadius: 20, border: '1.5px dashed var(--navy)', background: 'transparent', color: 'var(--navy)', cursor: busy ? 'default' : 'pointer', fontWeight: 700, fontSize: '0.9rem', opacity: busy ? 0.6 : 1 }}>
                    +
                  </button>
                </div>

                {/* Opțiuni grupă selectată */}
                {selectedGroupObj && (
                  <div style={{ display: 'flex', gap: 10, marginTop: 10, alignItems: 'center' }}>
                    <span style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>Grupa „{selectedGroupObj.name}":</span>
                    <button onClick={() => renameGroup(selectedGroupObj)} disabled={busy}
                      style={{ background: 'none', border: 'none', color: 'var(--navy)', cursor: 'pointer', fontWeight: 600, fontSize: '0.8rem', textDecoration: 'underline' }}>✎ Redenumește</button>
                    <button onClick={() => deleteGroup(selectedGroupObj)} disabled={busy}
                      style={{ background: 'none', border: 'none', color: 'var(--danger)', cursor: 'pointer', fontWeight: 600, fontSize: '0.8rem', textDecoration: 'underline' }}>🗑 Șterge grupa</button>
                  </div>
                )}
              </div>
            )}

            {/* Clasament (doar profesor) — buton cu rolldown */}
            {isTeacher && !loading && !error && leaderboard.length > 0 && (
              <div style={{ background: 'var(--cream)', borderRadius: 'var(--radius)', marginBottom: 16, overflow: 'hidden' }}>
                <button
                  type="button"
                  onClick={() => setShowLeaderboard((v) => !v)}
                  style={{ width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, padding: '12px 16px', background: 'transparent', border: 'none', cursor: 'pointer', fontFamily: 'var(--font-body)', textAlign: 'left' }}
                >
                  <strong style={{ fontSize: '0.85rem', color: 'var(--navy)' }}>
                    🏆 Clasament — {selectedGroup === null ? 'toți elevii' : (selectedGroupObj?.name || 'grupă')}
                    <span style={{ fontWeight: 500, color: 'var(--text-muted)', marginLeft: 6 }}>({leaderboard.length})</span>
                  </strong>
                  <span style={{ color: 'var(--text-muted)', fontSize: '0.8rem' }}>{showLeaderboard ? '▾ ascunde' : '▸ vezi'}</span>
                </button>
                {showLeaderboard && (
                  <ol style={{ margin: 0, padding: '0 16px 14px', listStyle: 'none', display: 'grid', gap: 4 }}>
                    {leaderboard.map((s, i) => (
                      <li key={s.id} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', fontSize: '0.84rem' }}>
                        <span style={{ color: 'var(--text)' }}>
                          <span style={{ display: 'inline-block', width: 22, fontWeight: 700 }}>
                            {i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : `${i + 1}.`}
                          </span>
                          {s.name}
                        </span>
                        <span style={{ fontWeight: 700, color: scoreColor(s.avg) }}>{s.avg}%</span>
                      </li>
                    ))}
                  </ol>
                )}
              </div>
            )}

            {/* Conținut tabel */}
            {loading ? (
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, color: 'var(--text-muted)', padding: '20px 0', fontSize: '0.9rem' }}>
                <span className="spinner" style={{ width: 20, height: 20, borderWidth: 2 }} /> Se încarcă rezultatele…
              </div>
            ) : error ? (
              <div style={{ background: '#fce4ec', color: 'var(--danger)', padding: '14px 16px', borderRadius: 'var(--radius)', fontSize: '0.86rem' }}>
                {error}{' '}
                <button onClick={load} style={{ background: 'none', border: 'none', color: 'var(--danger)', textDecoration: 'underline', cursor: 'pointer', fontWeight: 600 }}>Reîncearcă</button>
              </div>
            ) : totalStudents === 0 ? (
              <div style={{ textAlign: 'center', color: 'var(--text-muted)', padding: '28px 16px', fontSize: '0.92rem', background: 'var(--cream)', borderRadius: 'var(--radius)' }}>
                Niciun elev asociat încă. Trimite linkul de invitație de mai sus.
              </div>
            ) : filtered.length === 0 ? (
              <div style={{ textAlign: 'center', color: 'var(--text-muted)', padding: '24px 16px', fontSize: '0.9rem' }}>
                {query ? `Niciun elev găsit pentru „${query}".` : 'Niciun elev în această grupă. Mută elevi din „Toți".'}
              </div>
            ) : (
              <>
                <div style={{ overflowX: 'auto', WebkitOverflowScrolling: 'touch', maxWidth: '100%', border: '1px solid var(--border)', borderRadius: 'var(--radius)' }}>
                  <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.88rem', minWidth: 460 }}>
                    <thead>
                      <tr style={{ background: 'var(--cream)', textAlign: 'left' }}>
                        <th style={{ padding: '11px 14px', fontWeight: 700, color: 'var(--navy)', whiteSpace: 'nowrap' }}>Nume elev</th>
                        <th style={{ padding: '11px 14px', fontWeight: 700, color: 'var(--navy)' }}>Rezultate</th>
                        <th style={{ padding: '11px 14px', fontWeight: 700, color: 'var(--navy)', whiteSpace: 'nowrap', textAlign: 'right' }}>Media</th>
                      </tr>
                    </thead>
                    <tbody>
                      {pageStudents.map((s) => (
                        <StudentRow
                          key={s.id}
                          student={s}
                          isOpen={!!expanded[s.id]}
                          onToggle={() => toggleStudent(s.id)}
                          isTeacher={isTeacher}
                          isParent={isParent}
                          groups={groups}
                          onMove={moveStudent}
                          onRemove={removeStudent}
                          busy={busy}
                        />
                      ))}
                    </tbody>
                  </table>
                </div>

                {totalPages > 1 && (
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 14, marginTop: 16 }}>
                    <button onClick={() => setPage((p) => Math.max(0, p - 1))} disabled={safePage === 0}
                      style={{ padding: '7px 14px', borderRadius: 8, border: '1.5px solid var(--border)', background: 'transparent', color: 'var(--navy)', cursor: safePage === 0 ? 'default' : 'pointer', opacity: safePage === 0 ? 0.4 : 1, fontWeight: 600, fontSize: '0.84rem' }}>← Înapoi</button>
                    <span style={{ fontSize: '0.84rem', color: 'var(--text-light)' }}>Pagina {safePage + 1} / {totalPages}</span>
                    <button onClick={() => setPage((p) => Math.min(totalPages - 1, p + 1))} disabled={safePage >= totalPages - 1}
                      style={{ padding: '7px 14px', borderRadius: 8, border: '1.5px solid var(--border)', background: 'transparent', color: 'var(--navy)', cursor: safePage >= totalPages - 1 ? 'default' : 'pointer', opacity: safePage >= totalPages - 1 ? 0.4 : 1, fontWeight: 600, fontSize: '0.84rem' }}>Înainte →</button>
                  </div>
                )}
              </>
            )}
          </div>
        )}
      </div>
    </>
  );
}
