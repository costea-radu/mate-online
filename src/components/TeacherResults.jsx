import { useEffect, useMemo, useRef, useState } from 'react';

const PER_PAGE = 10; // elevi pe listă

function pct(score, max) {
  if (!max) return 0;
  return Math.round((score / max) * 100);
}
function scoreColor(p) {
  return p >= 80 ? '#2e7d32' : p >= 50 ? '#e65100' : '#c62828';
}
function fmtDate(iso) {
  if (!iso) return '';
  try { return new Date(iso).toLocaleDateString('ro-RO', { day: '2-digit', month: 'short', year: 'numeric' }); }
  catch { return ''; }
}
const typeLabel = { interactive: 'Test interactiv', manual: 'Manual', pdf: 'PDF' };

// ─── Bloc cod/link de invitație ─────────────────────────────────────────────
function InviteBox({ teacherCode, teacherName }) {
  const [copied, setCopied] = useState('');
  const link = teacherCode
    ? `${window.location.origin}/asociere?cod=${teacherCode}`
    : '';

  const shareMsg = `Salut! Asociază-te contului meu de profesor${teacherName ? ` (${teacherName})` : ''} pe ExamenMate cu un singur clic: ${link}`;

  function copy(value, key) {
    const done = () => { setCopied(key); setTimeout(() => setCopied(''), 1800); };
    if (navigator.clipboard?.writeText) {
      navigator.clipboard.writeText(value).then(done).catch(() => fallbackCopy(value, done));
    } else {
      fallbackCopy(value, done);
    }
  }
  function fallbackCopy(value, done) {
    try {
      const ta = document.createElement('textarea');
      ta.value = value; ta.style.position = 'fixed'; ta.style.opacity = '0';
      document.body.appendChild(ta); ta.select();
      document.execCommand('copy'); document.body.removeChild(ta); done();
    } catch { /* ignore */ }
  }

  const mailHref = `mailto:?subject=${encodeURIComponent('Invitație ExamenMate')}&body=${encodeURIComponent(shareMsg)}`;
  const waHref = `https://wa.me/?text=${encodeURIComponent(shareMsg)}`;

  const copyBtn = (active) => ({
    padding: '8px 14px', borderRadius: 8, fontWeight: 600, fontSize: '0.82rem',
    border: '1.5px solid var(--navy)', background: active ? 'var(--navy)' : 'transparent',
    color: active ? '#fff' : 'var(--navy)', cursor: 'pointer', whiteSpace: 'nowrap', transition: 'all 0.15s',
  });

  return (
    <div className="card" style={{ marginBottom: 24 }}>
      <h3 style={{ fontFamily: 'var(--font-display)', marginBottom: 6, color: 'var(--navy)' }}>
        🔗 Invită elevi
      </h3>
      <p style={{ color: 'var(--text-light)', fontSize: '0.9rem', marginBottom: 18 }}>
        Trimite linkul de mai jos elevilor tăi, pe e-mail sau WhatsApp. Când dau
        clic pe link și se autentifică, sunt <strong>asociați automat</strong> contului tău și
        le vei vedea rezultatele în tabelul de mai jos.
      </p>

      {!teacherCode ? (
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, color: 'var(--text-muted)', fontSize: '0.88rem' }}>
          <span className="spinner" style={{ width: 18, height: 18, borderWidth: 2 }} /> Se generează linkul…
        </div>
      ) : (
        <>
          {/* Link */}
          <div style={{ marginBottom: 16 }}>
            <div style={{ fontSize: '0.78rem', fontWeight: 600, color: 'var(--text)', marginBottom: 6 }}>Link de asociere</div>
            <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
              <input
                readOnly
                value={link}
                onFocus={(e) => e.target.select()}
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

          {/* Share */}
          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
            <a href={mailHref} style={{
              display: 'inline-flex', alignItems: 'center', gap: 8, padding: '9px 16px', borderRadius: 8,
              fontWeight: 600, fontSize: '0.85rem', background: 'var(--navy)', color: '#fff',
            }}>
              ✉️ Trimite pe e-mail
            </a>
            <a href={waHref} target="_blank" rel="noopener noreferrer" style={{
              display: 'inline-flex', alignItems: 'center', gap: 8, padding: '9px 16px', borderRadius: 8,
              fontWeight: 600, fontSize: '0.85rem', background: '#25D366', color: '#fff',
            }}>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><path d="M.057 24l1.687-6.163a11.867 11.867 0 0 1-1.587-5.946C.16 5.335 5.495 0 12.05 0a11.817 11.817 0 0 1 8.413 3.488 11.824 11.824 0 0 1 3.48 8.414c-.003 6.557-5.338 11.892-11.893 11.892a11.9 11.9 0 0 1-5.688-1.448L.057 24zm6.597-3.807c1.676.995 3.276 1.591 5.392 1.592 5.448 0 9.886-4.434 9.889-9.885.002-5.462-4.415-9.89-9.881-9.892-5.452 0-9.887 4.434-9.889 9.884a9.86 9.86 0 0 0 1.515 5.26l-.999 3.648 3.736-.98a9.875 9.875 0 0 0 .238.173z"/></svg>
              Trimite pe WhatsApp
            </a>
          </div>
        </>
      )}
    </div>
  );
}

// ─── Tabel rezultate ────────────────────────────────────────────────────────
export default function TeacherResults({ user, teacherCode, teacherName }) {
  const [data, setData] = useState({ students: [], results: [] });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [page, setPage] = useState(0);
  const [expanded, setExpanded] = useState({});
  const fetchedFor = useRef(null);
  const searchRef = useRef(null);

  async function load() {
    if (!user?.id) return;
    setLoading(true); setError('');
    try {
      const res = await fetch('/api/teacher-students', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId: user.id }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || `Eroare server (${res.status})`);
      setData({ students: json.students || [], results: json.results || [] });
    } catch (e) {
      setError(e.message || 'Nu s-au putut încărca rezultatele.');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (fetchedFor.current === user?.id) return;
    fetchedFor.current = user?.id;
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id]);

  // Grupează rezultatele pe elev (include și elevii fără rezultate)
  const groups = useMemo(() => {
    const map = new Map();
    (data.students || []).forEach((s) => {
      map.set(s.id, { id: s.id, name: s.full_name || 'Elev', email: s.email || '', rows: [] });
    });
    (data.results || []).forEach((r) => {
      if (!map.has(r.student_id)) {
        map.set(r.student_id, { id: r.student_id, name: r.student_name || 'Elev', email: r.student_email || '', rows: [] });
      }
      map.get(r.student_id).rows.push(r);
    });
    const arr = Array.from(map.values());
    arr.forEach((g) => {
      g.count = g.rows.length;
      g.avg = g.count ? Math.round(g.rows.reduce((a, r) => a + pct(r.score, r.max_score), 0) / g.count) : null;
    });
    arr.sort((a, b) => a.name.localeCompare(b.name, 'ro'));
    return arr;
  }, [data]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return groups;
    return groups.filter((g) =>
      g.name.toLowerCase().includes(q) || g.email.toLowerCase().includes(q));
  }, [groups, query]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / PER_PAGE));
  const safePage = Math.min(page, totalPages - 1);
  const pageGroups = filtered.slice(safePage * PER_PAGE, safePage * PER_PAGE + PER_PAGE);

  function onQueryChange(v) {
    setQuery(v);
    setPage(0);
    if (v && !open) setOpen(true);
  }
  function toggleStudent(id) {
    setExpanded((prev) => ({ ...prev, [id]: !prev[id] }));
  }

  const totalStudents = groups.length;

  return (
    <>
      <InviteBox teacherCode={teacherCode} teacherName={teacherName} />

      <div className="card" style={{ marginBottom: 24 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
          <h3 style={{ fontFamily: 'var(--font-display)', color: 'var(--navy)', margin: 0 }}>
            📊 Rezultate elevi{' '}
            <span style={{ fontSize: '0.82rem', fontWeight: 500, color: 'var(--text-muted)' }}>
              ({totalStudents} {totalStudents === 1 ? 'elev asociat' : 'elevi asociați'})
            </span>
          </h3>
          <div style={{ display: 'flex', gap: 8 }}>
            <button
              onClick={load}
              title="Reîmprospătează"
              style={{ padding: '8px 12px', borderRadius: 8, border: '1.5px solid var(--border)', background: 'transparent', color: 'var(--text-light)', cursor: 'pointer', fontSize: '0.82rem', fontWeight: 600 }}
            >
              ↻
            </button>
            <button
              onClick={() => setOpen((o) => !o)}
              style={{ padding: '8px 16px', borderRadius: 8, border: 'none', background: 'var(--navy)', color: '#fff', cursor: 'pointer', fontSize: '0.85rem', fontWeight: 600 }}
            >
              {open ? 'Ascunde rezultatele ▴' : 'Vezi rezultatele ▾'}
            </button>
          </div>
        </div>

        {open && (
          <div style={{ marginTop: 18 }}>
            {/* Căutare elev */}
            <form
              onSubmit={(e) => { e.preventDefault(); searchRef.current?.blur(); }}
              style={{ display: 'flex', gap: 8, marginBottom: 16, flexWrap: 'wrap' }}
            >
              <div style={{ position: 'relative', flex: '1 1 220px', minWidth: 0 }}>
                <span style={{ position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)', fontSize: '0.9rem', opacity: 0.6 }}>🔍</span>
                <input
                  ref={searchRef}
                  value={query}
                  onChange={(e) => onQueryChange(e.target.value)}
                  placeholder="Caută elev după nume sau e-mail…"
                  style={{
                    width: '100%', padding: '10px 36px 10px 34px', borderRadius: 8,
                    border: '1.5px solid var(--border)', background: 'var(--cream)', fontSize: '0.9rem',
                    fontFamily: 'var(--font-body)',
                  }}
                />
                {query && (
                  <button
                    type="button"
                    onClick={() => onQueryChange('')}
                    style={{ position: 'absolute', right: 8, top: '50%', transform: 'translateY(-50%)', background: 'none', border: 'none', cursor: 'pointer', color: '#aaa', fontSize: '1rem' }}
                  >
                    ✕
                  </button>
                )}
              </div>
              <button
                type="submit"
                style={{ padding: '10px 18px', borderRadius: 8, border: 'none', background: 'var(--gold)', color: 'var(--navy-dark)', fontWeight: 700, fontSize: '0.85rem', cursor: 'pointer' }}
              >
                🔍 Caută
              </button>
            </form>

            {/* Conținut */}
            {loading ? (
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, color: 'var(--text-muted)', padding: '20px 0', fontSize: '0.9rem' }}>
                <span className="spinner" style={{ width: 20, height: 20, borderWidth: 2 }} /> Se încarcă rezultatele…
              </div>
            ) : error ? (
              <div style={{ background: '#fce4ec', color: 'var(--danger)', padding: '14px 16px', borderRadius: 'var(--radius)', fontSize: '0.86rem' }}>
                {error}{' '}
                <button onClick={load} style={{ background: 'none', border: 'none', color: 'var(--danger)', textDecoration: 'underline', cursor: 'pointer', fontWeight: 600 }}>
                  Reîncearcă
                </button>
              </div>
            ) : totalStudents === 0 ? (
              <div style={{ textAlign: 'center', color: 'var(--text-muted)', padding: '28px 16px', fontSize: '0.92rem', background: 'var(--cream)', borderRadius: 'var(--radius)' }}>
                Niciun elev asociat încă. Trimite linkul de invitație de mai sus elevilor tăi.
              </div>
            ) : filtered.length === 0 ? (
              <div style={{ textAlign: 'center', color: 'var(--text-muted)', padding: '24px 16px', fontSize: '0.9rem' }}>
                Niciun elev găsit pentru „{query}".
              </div>
            ) : (
              <>
                <div style={{ overflowX: 'auto', WebkitOverflowScrolling: 'touch', maxWidth: '100%', border: '1px solid var(--border)', borderRadius: 'var(--radius)' }}>
                  <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.88rem', minWidth: 460 }}>
                    <thead>
                      <tr style={{ background: 'var(--cream)', textAlign: 'left' }}>
                        <th style={{ padding: '11px 14px', fontWeight: 700, color: 'var(--navy)', whiteSpace: 'nowrap' }}>Nume elev</th>
                        <th style={{ padding: '11px 14px', fontWeight: 700, color: 'var(--navy)' }}>Test sau exercițiu</th>
                        <th style={{ padding: '11px 14px', fontWeight: 700, color: 'var(--navy)', whiteSpace: 'nowrap', textAlign: 'right' }}>Punctaj</th>
                      </tr>
                    </thead>
                    <tbody>
                      {pageGroups.map((g) => {
                        const isOpen = !!expanded[g.id];
                        const hasRows = g.count > 0;
                        return (
                          <FragmentGroup
                            key={g.id}
                            group={g}
                            isOpen={isOpen}
                            hasRows={hasRows}
                            onToggle={() => hasRows && toggleStudent(g.id)}
                          />
                        );
                      })}
                    </tbody>
                  </table>
                </div>

                {/* Paginare */}
                {totalPages > 1 && (
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 14, marginTop: 16 }}>
                    <button
                      onClick={() => setPage((p) => Math.max(0, p - 1))}
                      disabled={safePage === 0}
                      style={{ padding: '7px 14px', borderRadius: 8, border: '1.5px solid var(--border)', background: 'transparent', color: 'var(--navy)', cursor: safePage === 0 ? 'default' : 'pointer', opacity: safePage === 0 ? 0.4 : 1, fontWeight: 600, fontSize: '0.84rem' }}
                    >
                      ← Înapoi
                    </button>
                    <span style={{ fontSize: '0.84rem', color: 'var(--text-light)' }}>
                      Pagina {safePage + 1} / {totalPages}
                    </span>
                    <button
                      onClick={() => setPage((p) => Math.min(totalPages - 1, p + 1))}
                      disabled={safePage >= totalPages - 1}
                      style={{ padding: '7px 14px', borderRadius: 8, border: '1.5px solid var(--border)', background: 'transparent', color: 'var(--navy)', cursor: safePage >= totalPages - 1 ? 'default' : 'pointer', opacity: safePage >= totalPages - 1 ? 0.4 : 1, fontWeight: 600, fontSize: '0.84rem' }}
                    >
                      Înainte →
                    </button>
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

// Grup pentru un elev: rând antet (rolldown) + rândurile cu rezultate.
function FragmentGroup({ group, isOpen, hasRows, onToggle }) {
  const headerBg = 'transparent';
  return (
    <>
      <tr
        onClick={onToggle}
        style={{
          borderTop: '1px solid var(--border)', cursor: hasRows ? 'pointer' : 'default',
          background: headerBg, transition: 'background 0.12s',
        }}
        onMouseEnter={(e) => { if (hasRows) e.currentTarget.style.background = 'var(--cream)'; }}
        onMouseLeave={(e) => { e.currentTarget.style.background = headerBg; }}
      >
        <td style={{ padding: '11px 14px', verticalAlign: 'top' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{ fontSize: '0.7rem', color: 'var(--text-muted)', width: 12, display: 'inline-block' }}>
              {hasRows ? (isOpen ? '▾' : '▸') : ''}
            </span>
            <span>
              <span style={{ fontWeight: 600, color: 'var(--navy)' }}>{group.name}</span>
              {group.email && (
                <span style={{ display: 'block', fontSize: '0.72rem', color: 'var(--text-muted)', marginLeft: 0 }}>
                  {group.email}
                </span>
              )}
            </span>
          </div>
        </td>
        <td style={{ padding: '11px 14px', color: 'var(--text-light)', verticalAlign: 'top' }}>
          {hasRows
            ? `${group.count} ${group.count === 1 ? 'rezultat' : 'rezultate'}`
            : <span style={{ color: 'var(--text-muted)', fontStyle: 'italic' }}>Niciun rezultat încă</span>}
        </td>
        <td style={{ padding: '11px 14px', textAlign: 'right', verticalAlign: 'top', whiteSpace: 'nowrap' }}>
          {group.avg !== null
            ? <span style={{ fontWeight: 700, color: scoreColor(group.avg) }}>media {group.avg}%</span>
            : <span style={{ color: 'var(--text-muted)' }}>—</span>}
        </td>
      </tr>

      {isOpen && hasRows && group.rows.map((r, i) => {
        const p = pct(r.score, r.max_score);
        return (
          <tr key={r.content_id + '-' + i} style={{ background: 'var(--cream)', borderTop: '1px solid var(--border)' }}>
            <td style={{ padding: '8px 14px' }} />
            <td style={{ padding: '8px 14px' }}>
              <span style={{ color: 'var(--text)', fontWeight: 500 }}>{r.test_title}</span>
              <span style={{ display: 'block', fontSize: '0.72rem', color: 'var(--text-muted)', marginTop: 2 }}>
                {(typeLabel[r.content_type] || r.content_type)}{r.completed_at ? ` · ${fmtDate(r.completed_at)}` : ''}
              </span>
            </td>
            <td style={{ padding: '8px 14px', textAlign: 'right', whiteSpace: 'nowrap' }}>
              <span style={{ fontWeight: 700, color: scoreColor(p) }}>
                {r.score}/{r.max_score}
              </span>
              <span style={{ color: scoreColor(p), fontSize: '0.78rem', marginLeft: 6 }}>({p}%)</span>
            </td>
          </tr>
        );
      })}
    </>
  );
}
