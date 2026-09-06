import { authHeaders } from '../lib/api';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import StudentAIMastery from './StudentAIMastery';
import AITeacherReport from './AITeacherReport';
import { DaTemaButton } from './TemaPicker';
import TemeDate from './TemeDate';
import { notaDinScor } from '../lib/nota';

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

// ─── NOTELE ELEVULUI ȘI MEDIILE ÎNCHEIATE ───────────────────────────────────
// „Notele" sunt exact cele afișate mai jos: nota fiecărui test sau exercițiu
// rezolvat, plus notele temelor de la Meditații cu Profesorul Virtual.
//
// Butonul „🔒 Încheie media" strânge notele de PÂNĂ ÎN ACEL MOMENT într-o
// medie salvată (Media 1). Notele care vin după intră singure în perioada
// următoare, care își primește propriul buton (Media 2) — ca în catalog.
function gradesOf(student) {
  const out = [];
  (student.rows || []).forEach((r) => {
    const n = notaDinScor(r.score, r.max_score);
    if (n == null) return;
    out.push({ nota: Number(n), at: new Date(r.completed_at || 0).getTime(), title: r.test_title });
  });
  (student.meditatii || []).forEach((h) => {
    if (!h.max_score) return;
    const n = h.grade != null ? h.grade : notaDinScor(h.score, h.max_score);
    if (n == null) return;
    out.push({ nota: Number(n), at: new Date(h.completed_at || h.assigned_at || 0).getTime(), title: h.title });
  });
  return out.sort((a, b) => a.at - b.at);
}
function medieDin(list) {
  if (!list || !list.length) return null;
  return Math.round((list.reduce((a, g) => a + g.nota, 0) / list.length) * 100) / 100;
}
const fmtMedie = (v) => (v == null ? '—' : Number(v).toFixed(2));
const closedMs = (p) => new Date(p?.closed_at || 0).getTime();
// notele de după ultima medie încheiată = perioada curentă
const dupaUltima = (grades, periods) => {
  const last = periods && periods.length ? periods[periods.length - 1] : null;
  const since = last ? closedMs(last) : 0;
  return since ? grades.filter((g) => g.at > since) : grades;
};
function medieColor(v) {
  if (v == null) return 'var(--text-muted)';
  return v >= 8 ? '#2e7d32' : v >= 5 ? '#e65100' : '#c62828';
}
const notaChip = (v) => ({
  fontWeight: 800, color: medieColor(v), background: 'rgba(232,185,49,.16)',
  border: '1px solid rgba(232,185,49,.5)', borderRadius: 12, padding: '2px 9px',
  fontSize: '.76rem', whiteSpace: 'nowrap',
});

// ─── Caseta mediilor (aceeași pentru un elev și pentru o grupă) ─────────────
function MediiBox({ titlu, hint, periods, curente, onClose, onDelete, busy, compact = false }) {
  const [open, setOpen] = useState(false);
  const mediaCurenta = medieDin(curente);
  const n = curente.length;

  return (
    <div style={{
      background: '#fff', border: '1px solid var(--border)', borderRadius: 'var(--radius)',
      overflow: 'hidden', marginBottom: compact ? 0 : 14,
    }}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        style={{ width: '100%', display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, padding: '12px 14px', background: 'transparent', border: 'none', cursor: 'pointer', fontFamily: 'var(--font-body)', textAlign: 'left' }}
      >
        <strong style={{ fontSize: '.85rem', color: 'var(--navy)' }}>
          🎓 {titlu}
          {periods.length > 0 && (
            <span style={{ fontWeight: 600, color: 'var(--text-muted)', marginLeft: 8 }}>
              {periods.length} {periods.length === 1 ? 'medie încheiată' : 'medii încheiate'}
            </span>
          )}
        </strong>
        <span style={{ color: 'var(--text-muted)', fontSize: '.8rem' }}>{open ? '▾ ascunde' : '▸ vezi'}</span>
      </button>

      {open && (
        <div style={{ padding: '0 14px 14px' }}>
          {hint && <div style={{ fontSize: '.76rem', color: 'var(--text-muted)', marginBottom: 10 }}>{hint}</div>}

          {/* mediile deja încheiate */}
          {periods.length > 0 && (
            <div style={{ display: 'grid', gap: 6, marginBottom: 12 }}>
              {periods.map((p) => (
                <div key={p.id} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, flexWrap: 'wrap', background: 'var(--cream)', borderRadius: 8, padding: '6px 10px' }}>
                  <span style={{ fontSize: '.8rem', color: 'var(--text)' }}>
                    <strong style={{ color: 'var(--navy)' }}>Media {p.period_no}</strong>
                    <span style={{ color: 'var(--text-muted)' }}>
                      {' · '}{p.grades} {p.grades === 1 ? 'notă' : 'note'}
                      {p.scope === 'group' && p.students ? ` · ${p.students} elevi` : ''}
                      {' · '}încheiată {fmtDate(p.closed_at)}
                    </span>
                  </span>
                  <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
                    <span style={notaChip(p.average)}>{fmtMedie(p.average)}</span>
                    <button
                      type="button" onClick={() => onDelete(p)} disabled={busy}
                      title="Șterge media — notele ei se întorc în perioada curentă"
                      style={{ background: 'none', border: 'none', cursor: busy ? 'default' : 'pointer', color: 'var(--danger)', fontSize: '.85rem', opacity: busy ? 0.5 : 1 }}
                    >🗑</button>
                  </span>
                </div>
              ))}
            </div>
          )}

          {/* perioada curentă + butonul de încheiere */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
            <span style={{ fontSize: '.8rem', color: 'var(--text)' }}>
              {n === 0 ? (
                <span style={{ color: 'var(--text-muted)' }}>
                  {periods.length ? 'Nicio notă nouă după ultima medie.' : 'Nicio notă încă.'}
                </span>
              ) : (
                <>
                  <strong style={{ color: 'var(--navy)' }}>{periods.length ? `Media ${periods.length + 1}` : 'Media în curs'}</strong>
                  <span style={{ color: 'var(--text-muted)' }}> · {n} {n === 1 ? 'notă nouă' : 'note noi'}</span>
                </>
              )}
            </span>
            {n > 0 && <span style={notaChip(mediaCurenta)}>{fmtMedie(mediaCurenta)}</span>}
            <button
              type="button" onClick={onClose} disabled={busy || n === 0}
              title={n === 0 ? 'Nu sunt note noi de încheiat' : 'Închide media notelor de până acum; notele următoare intră într-o medie nouă'}
              style={{
                padding: '6px 14px', borderRadius: 8, fontWeight: 700, fontSize: '.8rem',
                border: 'none', background: n === 0 ? 'var(--cream-dark)' : 'var(--navy)',
                color: n === 0 ? 'var(--text-muted)' : '#fff',
                cursor: busy || n === 0 ? 'default' : 'pointer', opacity: busy ? 0.6 : 1,
              }}
            >🔒 Încheie media{n > 0 ? ` (${n} ${n === 1 ? 'notă' : 'note'})` : ''}</button>
          </div>
        </div>
      )}
    </div>
  );
}

const typeLabel = { interactive: 'Test interactiv', manual: 'Manual', pdf: 'PDF' };
// eticheta din paranteză, lângă titlul fiecărui exercițiu: (interactiv) / (PDF)
const parenType = (t) => (t === 'interactive' ? 'interactiv' : t === 'pdf' ? 'PDF' : t === 'manual' ? 'manual' : t || '?');

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
  const navigate = useNavigate();
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

  // „Trimite pe mesageria site-ului": copiază linkul ȘI deschide mesageria cu
  // mesajul deja scris în bara de trimitere. Profesorului nu-i mai rămâne
  // decât să aleagă elevul sau grupa din stânga și să apese „Trimite".
  function openChat() {
    copyText(link, () => {});
    navigate('/mesagerie', { state: { draft: shareMsg, draftHint: 'invitatie' } });
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
            {/* Mesageria site-ului: se deschide cu mesajul gata scris, iar
                profesorul alege doar elevul sau grupa. */}
            <button type="button" onClick={openChat} style={{
              display: 'inline-flex', alignItems: 'center', gap: 8, padding: '9px 16px', borderRadius: 8,
              fontWeight: 600, fontSize: '0.85rem', background: 'var(--gold)', color: 'var(--navy-dark)',
              border: 'none', cursor: 'pointer', fontFamily: 'var(--font-body)',
            }}>💬 Trimite pe mesageria site-ului</button>
          </div>

          <div style={{ fontSize: '0.76rem', color: 'var(--text-muted)', marginTop: 8 }}>
            „💬 Trimite pe mesageria site-ului" deschide mesageria cu mesajul deja scris — tu alegi doar
            elevul sau grupa și apeși „Trimite". Linkul rămâne și copiat, dacă vrei să-l lipești altundeva.
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
          <span style={{ color: 'var(--text-muted)' }}>{act.date ? ` · ${fmtDate(act.date)}` : ''} · {act.score}/{act.max} ({act.p}%){notaDinScor(act.score, act.max) != null ? ` · nota ${notaDinScor(act.score, act.max)}` : ''}</span>
        </div>
      ) : (
        <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)', marginTop: 6 }}>Apasă pe un punct pentru a vedea procentul.</div>
      )}
    </div>
  );
}

// ─── Rând elev (antet rolldown + detaliu cu Punctaj/Încercări/Timp/Progres) ──
function StudentRow({ student, isOpen, onToggle, isTeacher, isParent, groups, onMove, onRemove, busy, onHomework, periods = [], onCloseAvg, onDeleteAvg }) {
  const hasRows = student.count > 0;
  const [showProgress, setShowProgress] = useState(false);
  const note = useMemo(() => gradesOf(student), [student]);
  const noteNoi = useMemo(() => dupaUltima(note, periods), [note, periods]);
  const ultimaMedie = periods.length ? periods[periods.length - 1] : null;
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
          <div style={{ display: 'inline-flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
            {student.avg !== null
              ? <span style={{ fontWeight: 700, color: scoreColor(student.avg) }}>media {student.avg}%</span>
              : <span style={{ color: 'var(--text-muted)' }}>—</span>}
            {/* ultima medie ÎNCHEIATĂ a elevului (nota 1–10), lângă media în procente */}
            {ultimaMedie && (
              <span style={notaChip(ultimaMedie.average)} title={`Media ${ultimaMedie.period_no}, încheiată ${fmtDate(ultimaMedie.closed_at)} · ${ultimaMedie.grades} note`}>
                media {ultimaMedie.period_no}: {fmtMedie(ultimaMedie.average)}
              </span>
            )}
            {/* „🔒 Încheie media" LÂNGĂ ELEV — notele de până acum se închid într-o medie */}
            {!student.archived && onCloseAvg && (
              <button
                type="button"
                disabled={busy || noteNoi.length === 0}
                title={noteNoi.length === 0
                  ? 'Nu sunt note noi de încheiat pentru acest elev'
                  : `Încheie media celor ${noteNoi.length} note de până acum (${fmtMedie(medieDin(noteNoi))}). Notele următoare intră într-o medie nouă.`}
                onClick={(e) => { e.stopPropagation(); onCloseAvg(student, noteNoi); }}
                style={{
                  padding: '5px 11px', borderRadius: 8, fontWeight: 700, fontSize: '.76rem',
                  border: `1.5px solid ${noteNoi.length ? 'var(--navy)' : 'var(--border)'}`,
                  background: 'transparent', color: noteNoi.length ? 'var(--navy)' : 'var(--text-muted)',
                  cursor: busy || !noteNoi.length ? 'default' : 'pointer', whiteSpace: 'nowrap',
                  opacity: busy ? 0.6 : 1,
                }}
              >🔒 Încheie media{noteNoi.length ? ` (${noteNoi.length})` : ''}</button>
            )}
            {/* „Dă temă" LÂNGĂ ELEV — tema merge doar lui */}
            {isTeacher && !student.archived && (
              <DaTemaButton small studentId={student.id} studentName={student.name} onDone={onHomework} />
            )}
          </div>
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

            {/* Mediile elevului: cele încheiate + notele care intră în cea următoare */}
            {!student.archived && onCloseAvg && (
              <MediiBox
                titlu={`Mediile lui ${student.name.split(' ')[0]}`}
                hint="Fiecare medie strânge notele de până în momentul în care ai apăsat butonul. Notele care vin după intră singure în media următoare."
                periods={periods}
                curente={noteNoi}
                busy={busy}
                onClose={() => onCloseAvg(student, noteNoi)}
                onDelete={(pp) => onDeleteAvg(pp)}
              />
            )}

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
                            <span style={{ color: 'var(--text)', fontWeight: 500 }}>
                              {r.test_title}{' '}
                              <span style={{ color: 'var(--text-muted)', fontWeight: 600, fontSize: '0.74rem' }}>({parenType(r.content_type)})</span>
                            </span>
                            <span style={{ display: 'block', fontSize: '0.7rem', color: 'var(--text-muted)', marginTop: 2 }}>
                              {(typeLabel[r.content_type] || r.content_type)}{r.upload ? ' · încărcat de elev în chat' : ''}{r.completed_at ? ` · ${fmtDate(r.completed_at)}` : ''}
                            </span>
                            <span style={{ display: 'block', marginTop: 4, background: 'var(--cream-dark)', borderRadius: 20, height: 5, maxWidth: 180, overflow: 'hidden' }}>
                              <span style={{ display: 'block', width: `${p}%`, height: '100%', background: scoreColor(p), borderRadius: 20 }} />
                            </span>
                          </td>
                          <td style={{ padding: '7px 10px', textAlign: 'right', whiteSpace: 'nowrap' }}>
                            <span style={{ fontWeight: 700, color: scoreColor(p) }}>{r.score}/{r.max_score}</span>
                            <span style={{ color: scoreColor(p), fontSize: '0.74rem', marginLeft: 5 }}>({p}%)</span>
                            {notaDinScor(r.score, r.max_score) != null && (
                              <span style={{ display: 'block', fontSize: '0.72rem', fontWeight: 700, color: '#8a6d00', marginTop: 2 }} title="Nota include 10 puncte din oficiu">
                                nota {notaDinScor(r.score, r.max_score)}
                              </span>
                            )}
                          </td>
                          <td style={{ padding: '7px 10px', textAlign: 'right', color: 'var(--text)' }}>{r.attempts}</td>
                          <td style={{ padding: '7px 10px', textAlign: 'right', color: 'var(--text)', whiteSpace: 'nowrap' }}>{fmtTime(r.time_spent)}</td>
                          <td style={{ padding: '7px 10px', textAlign: 'right', whiteSpace: 'nowrap' }}>
                            {r.ai_questions > 0 ? (
                              <span style={{ fontWeight: 700, color: '#8a6d00', background: 'rgba(232,185,49,.18)', border: '1px solid rgba(232,185,49,.5)', borderRadius: 12, padding: '2px 9px', fontSize: '0.76rem' }}>
                                Da, {r.ai_questions} {r.ai_questions === 1 ? 'întrebare' : 'întrebări'}
                              </span>
                            ) : r.used_tutor ? (
                              <span title="Rezolvat și corectat în chatul Profesorului Virtual"
                                style={{ fontWeight: 700, color: '#8a6d00', background: 'rgba(232,185,49,.18)', border: '1px solid rgba(232,185,49,.5)', borderRadius: 12, padding: '2px 9px', fontSize: '0.76rem' }}>
                                Da (corectare AI)
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

            {/* Meditații cu Prof. Virtual: temele + seturile lucrate (exerciții,
                recapitulări, simulări) — rezultatele complete pentru mentor */}
            {(student.meditatii || []).length > 0 && (
              <div style={{ background: '#fff', borderRadius: 'var(--radius)', border: '1.5px solid rgba(232,185,49,.55)', padding: '12px 14px', marginBottom: 14 }}>
                <strong style={{ fontSize: '0.85rem', color: 'var(--navy)' }}>🎓 Meditații cu Prof. Virtual — teme și seturi lucrate</strong>
                <div style={{ display: 'grid', gap: 5, marginTop: 8 }}>
                  {student.meditatii.slice(0, 12).map((h, i) => {
                    // finalizată INCOMPLET = elevul a închis tema fără toate problemele
                    // (o poate relua oricând); apare cu eticheta ei și cu scorul, dacă există
                    const incomplete = !!h.incomplete || h.status === 'incompleta';
                    const solved = h.status === 'rezolvata' || incomplete;
                    const p = solved && h.max_score ? pct(h.score, h.max_score) : null;
                    const icon = { content: '🧩', interactive: '📚', exercitii: '✍️', remediere: '🩹', recapitulare: '🔁', simulare: '🎯', evaluare: '🧭' }[h.kind] || '📚';
                    return (
                      <div key={i} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10, fontSize: '0.8rem', padding: '5px 8px', background: 'var(--cream)', borderRadius: 7, flexWrap: 'wrap' }}>
                        <span style={{ color: 'var(--text)', fontWeight: 500 }}>
                          {icon} {h.title}
                          <span style={{ color: 'var(--text-muted)', fontWeight: 400 }}>{h.completed_at ? ` · ${fmtDate(h.completed_at)}` : h.assigned_at ? ` · dată pe ${fmtDate(h.assigned_at)}` : ''}</span>
                          {incomplete && (
                            <span title="Tema a fost finalizată fără toate problemele rezolvate — elevul o poate relua oricând"
                              style={{ marginLeft: 8, fontWeight: 700, color: '#b9590f', background: 'rgba(230,126,34,.14)', border: '1px solid rgba(230,126,34,.45)', borderRadius: 12, padding: '1px 8px', fontSize: '0.72rem', whiteSpace: 'nowrap' }}>
                              ◐ incompletă{h.total ? ` · ${h.answered ?? 0}/${h.total} rezolvate` : ''}
                            </span>
                          )}
                        </span>
                        {solved && !h.max_score ? (
                          <span style={{ color: 'var(--text-muted)', fontStyle: 'italic', whiteSpace: 'nowrap' }}>închisă fără scor</span>
                        ) : solved ? (
                          <span style={{ whiteSpace: 'nowrap' }}>
                            <span style={{ fontWeight: 700, color: scoreColor(p) }}>{h.score}/{h.max_score} ({p}%)</span>
                            {/* nota vine de la server dacă există; altfel se calculează aici — niciodată ambele */}
                            {(h.grade != null || notaDinScor(h.score, h.max_score) != null) && (
                              <span style={{ marginLeft: 8, fontWeight: 700, color: '#8a6d00', background: 'rgba(232,185,49,.18)', border: '1px solid rgba(232,185,49,.5)', borderRadius: 12, padding: '1px 8px', fontSize: '0.74rem' }}>
                                nota {h.grade != null ? h.grade : notaDinScor(h.score, h.max_score)}
                              </span>
                            )}
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
                  ...student.rows.filter((r) => r.ai_questions > 0 || r.used_tutor),
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
                {student.assignmentsArchived.map((t) => `${t.title}${t.score != null ? ` (${t.score}/${t.max_score}${notaDinScor(t.score, t.max_score) != null ? ` · nota ${notaDinScor(t.score, t.max_score)}` : ''})` : ''}`).join(' · ')}
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
  const [data, setData] = useState({ students: [], results: [], groups: [], aiUsage: [], archived: [], meditatii: [], averages: [] });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [page, setPage] = useState(0);
  const [expanded, setExpanded] = useState({});
  const [selectedGroup, setSelectedGroup] = useState(null); // null = Toți
  const [busy, setBusy] = useState(false);
  const [showLeaderboard, setShowLeaderboard] = useState(false);
  const [temeSeed, setTemeSeed] = useState(0);   // reîncarcă „Temele date" după o temă nouă
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
      setData({ students: json.students || [], results: json.results || [], groups: json.groups || [], aiUsage: json.aiUsage || [], archived: json.archived || [], meditatii: json.meditatii || [], averages: json.averages || [] });
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
      // cele mai noi rezultate primele (progress + corectările PDF, amestecate)
      g.rows.sort((a, b) => new Date(b.completed_at || 0) - new Date(a.completed_at || 0));
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

  // ─── MEDIILE ÎNCHEIATE ────────────────────────────────────────────────────
  // Mediile vin de la server (`averages`), grupate pe elev și pe grupă. Cifra
  // salvată e calculată aici, din exact notele afișate mai jos, ca ce vede
  // profesorul pe ecran și ce se salvează să fie același lucru.
  const averages = useMemo(() => data.averages || [], [data]);
  const periodsByStudent = useMemo(() => {
    const m = {};
    averages.filter((a) => a.scope === 'student' && a.student_id).forEach((a) => {
      (m[a.student_id] || (m[a.student_id] = [])).push(a);
    });
    Object.values(m).forEach((arr) => arr.sort((a, b) => new Date(a.closed_at) - new Date(b.closed_at)));
    return m;
  }, [averages]);

  // mediile grupei selectate (null = „Toți elevii mei")
  const groupPeriods = useMemo(
    () => averages
      .filter((a) => a.scope === 'group' && (a.group_id || null) === (selectedGroup || null))
      .sort((a, b) => new Date(a.closed_at) - new Date(b.closed_at)),
    [averages, selectedGroup]
  );

  // toate notele elevilor din selecția curentă, de după ultima medie a grupei
  const groupGrades = useMemo(() => {
    const last = groupPeriods.length ? groupPeriods[groupPeriods.length - 1] : null;
    const since = last ? new Date(last.closed_at).getTime() : 0;
    const out = [];
    inGroup.filter((s) => !s.archived).forEach((s) => {
      const g = gradesOf(s).filter((x) => (since ? x.at > since : true));
      if (g.length) out.push({ id: s.id, name: s.name, note: g });
    });
    return out;
  }, [inGroup, groupPeriods]);
  const groupGradeCount = groupGrades.reduce((a, x) => a + x.note.length, 0);
  const groupAvg = medieDin(groupGrades.flatMap((x) => x.note));

  async function closeStudentAverage(student, note) {
    if (!note.length) return;
    const m = medieDin(note);
    if (!window.confirm(
      `Închizi media lui ${student.name}?\n\n${note.length} ${note.length === 1 ? 'notă' : 'note'} · media ${fmtMedie(m)}\n\n`
      + 'Notele primite după acest moment vor intra automat în media următoare.'
    )) return;
    await manage('close_average', {
      scope: 'student', studentId: student.id, average: m, grades: note.length,
      details: { note: note.map((g) => ({ nota: g.nota, titlu: g.title, la: g.at ? new Date(g.at).toISOString() : null })) },
    });
  }

  async function closeGroupAverage() {
    if (!groupGradeCount) return;
    const eticheta = selectedGroup === null ? 'toți elevii tăi' : `grupa „${selectedGroupObj?.name}"`;
    if (!window.confirm(
      `Închizi media pentru ${eticheta}?\n\n${groupGradeCount} note de la ${groupGrades.length} elevi · media ${fmtMedie(groupAvg)}\n\n`
      + 'Notele primite după acest moment vor intra automat în media următoare a grupei.'
    )) return;
    await manage('close_average', {
      scope: 'group', groupId: selectedGroup || null, groupName: selectedGroupObj?.name || null,
      average: groupAvg, grades: groupGradeCount, students: groupGrades.length,
      details: { elevi: groupGrades.map((x) => ({ id: x.id, nume: x.name, note: x.note.length, medie: medieDin(x.note) })) },
    });
  }

  async function deleteAverage(period) {
    if (!window.confirm(`Ștergi „Media ${period.period_no}"? Notele ei se întorc în perioada curentă.`)) return;
    await manage('delete_average', { periodId: period.id });
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

                {/* „Dă temă" LÂNGĂ GRUPĂ — tema merge la toți elevii ei
                    (sau la toți elevii mei, când e selectat „Toți"). */}
                <div style={{ display: 'flex', gap: 10, marginTop: 10, alignItems: 'center', flexWrap: 'wrap' }}>
                  <DaTemaButton
                    groupId={selectedGroup}
                    groupName={selectedGroupObj?.name || 'toți elevii mei'}
                    onDone={() => setTemeSeed((n) => n + 1)}
                  />
                  <span style={{ fontSize: '0.78rem', color: 'var(--text-muted)' }}>
                    exercițiile bifate merg la {selectedGroup === null ? 'toți elevii tăi' : `grupa „${selectedGroupObj?.name}"`}
                  </span>
                </div>

                {/* MEDIA GRUPEI — media notelor tuturor elevilor grupei până acum */}
                <div style={{ marginTop: 10 }}>
                  <MediiBox
                    compact
                    titlu={`Mediile ${selectedGroup === null ? 'tuturor elevilor' : `grupei „${selectedGroupObj?.name || ''}"`}`}
                    hint={`Media tuturor notelor luate de elevii ${selectedGroup === null ? 'tăi' : 'grupei'} până în momentul în care apeși butonul. Notele care vin după intră singure în media următoare.`}
                    periods={groupPeriods}
                    curente={groupGrades.flatMap((x) => x.note)}
                    busy={busy}
                    onClose={closeGroupAverage}
                    onDelete={deleteAverage}
                  />
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

            {/* Temele date (rolldown) — cu raport, redenumire și ștergere */}
            {isTeacher && !loading && !error && <TemeDate seed={temeSeed} />}

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
                          onHomework={() => setTemeSeed((n) => n + 1)}
                          periods={periodsByStudent[s.id] || []}
                          onCloseAvg={closeStudentAverage}
                          onDeleteAvg={deleteAverage}
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
