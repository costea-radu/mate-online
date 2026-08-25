// =====================================================================
// src/components/TemeDate.jsx — „📝 Temele date" (rolldown, contul profesorului)
//
// Lista temelor trimise cu butonul „Dă temă" (pe grupă sau pe elev):
// cât s-a rezolvat, raportul elev × exercițiu, denumirea (se poate schimba),
// trimiterea linkului pe mesageria grupei și ștergerea.
//
// Montată în src/components/TeacherResults.jsx, sub bara de grupe.
// =====================================================================
import { useCallback, useEffect, useState } from 'react';
import { aiClient } from '../lib/aiClient';

const td = { padding: '6px 8px', fontSize: '.8rem', borderBottom: '1px solid var(--border)' };
const color = (p) => (p == null ? 'var(--text-muted)' : p >= 80 ? '#2e7d32' : p >= 50 ? '#e65100' : '#c62828');

export default function TemeDate({ seed = 0 }) {
  const [open, setOpen] = useState(false);
  const [list, setList] = useState(null);
  const [error, setError] = useState(null);
  const [openReport, setOpenReport] = useState(null);
  const [renaming, setRenaming] = useState(null);
  const [name, setName] = useState('');

  const load = useCallback(async () => {
    try { const r = await aiClient.homeworkMine(); setList(r.homework || []); }
    catch (e) { setError(e.message); setList([]); }
  }, []);
  useEffect(() => { load(); }, [load, seed]);

  async function saveName(h) {
    const t = name.trim();
    if (!t) return;
    try {
      await aiClient.homeworkRename({ id: h.id, title: t });
      setList((l) => (l || []).map((x) => (x.id === h.id ? { ...x, title: t } : x)));
      setRenaming(null);
    } catch (e) { setError(e.message); }
  }

  async function remove(h) {
    if (!window.confirm(`Ștergi tema „${h.title}"? Elevii nu o vor mai vedea, iar rezolvările se șterg.`)) return;
    try { await aiClient.homeworkDelete({ id: h.id }); setList((l) => (l || []).filter((x) => x.id !== h.id)); }
    catch (e) { setError(e.message); }
  }

  async function sendToChat(h) {
    try {
      const { threads } = await aiClient.chatThreads();
      const t = (threads || []).find((x) => x.kind === 'group');
      if (!t) throw new Error('Nu ai încă o conversație de grupă (fă o grupă cu elevi).');
      await aiClient.chatSend({
        threadId: t.id, body: 'V-am dat o temă nouă:',
        attachment: { type: 'tema', url: h.url, title: h.title },
      });
      window.alert('Tema a fost trimisă pe mesageria grupei.');
    } catch (e) { setError(e.message); }
  }

  if (!list || !list.length) return null;

  return (
    <div style={{ background: 'var(--cream)', borderRadius: 'var(--radius)', marginBottom: 16, overflow: 'hidden' }}>
      <button type="button" onClick={() => setOpen((v) => !v)}
        style={{ width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, padding: '12px 16px', background: 'transparent', border: 'none', cursor: 'pointer', fontFamily: 'var(--font-body)', textAlign: 'left' }}>
        <strong style={{ fontSize: '0.85rem', color: 'var(--navy)' }}>
          📝 Temele date
          <span style={{ fontWeight: 500, color: 'var(--text-muted)', marginLeft: 6 }}>({list.length})</span>
        </strong>
        <span style={{ color: 'var(--text-muted)', fontSize: '0.8rem' }}>{open ? '▾ ascunde' : '▸ vezi'}</span>
      </button>

      {open && (
        <div style={{ padding: '0 16px 14px', display: 'flex', flexDirection: 'column', gap: 8 }}>
          {error && <div style={{ fontSize: '.8rem', color: '#b71c1c' }}>⚠️ {error}</div>}
          {list.map((h) => (
            <div key={h.id} style={{ background: '#fff', borderRadius: 10, padding: '9px 12px', display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
              <div style={{ flex: '1 1 200px', minWidth: 0 }}>
                {renaming === h.id ? (
                  <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                    <input value={name} onChange={(e) => setName(e.target.value)} maxLength={120} autoFocus
                      style={{ flex: '1 1 160px', border: '1px solid var(--border)', borderRadius: 8, padding: '6px 9px', fontSize: '.83rem' }} />
                    <button className="btn btn-sm btn-primary" onClick={() => saveName(h)}>Salvează</button>
                    <button className="btn btn-sm btn-outline" onClick={() => setRenaming(null)}>Renunță</button>
                  </div>
                ) : (
                  <>
                    <div style={{ fontWeight: 600, color: 'var(--navy)', fontSize: '.87rem' }}>{h.title}</div>
                    <div style={{ fontSize: '.73rem', color: 'var(--text-muted)' }}>
                      {h.student_name ? `elevul ${h.student_name}` : (h.group_name || 'toți elevii')} ·{' '}
                      {h.items} {h.items === 1 ? 'exercițiu' : 'exerciții'} · {h.students} {h.students === 1 ? 'elev' : 'elevi'} ·{' '}
                      {new Date(h.created_at).toLocaleDateString('ro-RO')}
                      {h.due_at ? ` · termen ${new Date(h.due_at).toLocaleDateString('ro-RO')}` : ''}
                    </div>
                  </>
                )}
              </div>
              <div style={{ fontSize: '.75rem', fontWeight: 700, color: color(h.percent), whiteSpace: 'nowrap' }}>
                {h.done}/{h.need} rezolvate ({h.percent}%)
              </div>
              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                <button className="btn btn-sm btn-outline" onClick={() => setOpenReport(openReport === h.id ? null : h.id)}>
                  {openReport === h.id ? '✕ Închide' : '📊 Raport'}
                </button>
                <button className="btn btn-sm btn-outline" title="Schimbă denumirea"
                  onClick={() => { setRenaming(h.id); setName(h.title); }}>✎</button>
                <button className="btn btn-sm btn-outline" title="Copiază linkul"
                  onClick={() => navigator.clipboard?.writeText(`${window.location.origin}${h.url}`)}>🔗</button>
                <button className="btn btn-sm btn-outline" title="Trimite pe mesageria grupei"
                  onClick={() => sendToChat(h)}>💬</button>
                <button className="btn btn-sm" style={{ color: '#c0392b' }} onClick={() => remove(h)}>🗑</button>
              </div>
              {openReport === h.id && <div style={{ flexBasis: '100%' }}><Raport id={h.id} /></div>}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Raportul unei teme: elev × exercițiu ───────────────────────────────────
function Raport({ id }) {
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  useEffect(() => { aiClient.homeworkReport({ id }).then(setData).catch((e) => setError(e.message)); }, [id]);

  if (error) return <div style={{ fontSize: '.82rem', color: '#b71c1c', marginTop: 10 }}>⚠️ {error}</div>;
  if (!data) return <div style={{ padding: 14, textAlign: 'center' }}><div className="spinner" /></div>;

  return (
    <div style={{ marginTop: 12, background: '#fff', border: '1px solid var(--border)', borderRadius: 10, padding: 12, overflowX: 'auto' }}>
      {!data.rows?.length ? (
        <div style={{ fontSize: '.82rem', color: 'var(--text-muted)' }}>Niciun elev vizat (grupa e goală).</div>
      ) : (
        <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 420 }}>
          <thead>
            <tr style={{ textAlign: 'left', color: 'var(--text-muted)', fontSize: '.72rem', textTransform: 'uppercase' }}>
              <th style={td}>Elev</th>
              {(data.items || []).map((it, i) => (
                <th key={it.id} style={{ ...td, textAlign: 'center' }} title={it.title}>{i + 1}</th>
              ))}
              <th style={{ ...td, textAlign: 'right' }}>Rezolvate</th>
              <th style={{ ...td, textAlign: 'right' }}>Media</th>
            </tr>
          </thead>
          <tbody>
            {data.rows.map((r) => (
              <tr key={r.studentId}>
                <td style={{ ...td, fontWeight: 600, color: 'var(--navy)' }}>{r.name}</td>
                {r.cells.map((c) => (
                  <td key={c.itemId} style={{ ...td, textAlign: 'center' }} title={`${c.title}${c.percent != null ? ` — ${c.percent}%` : ''}`}>
                    {c.done ? <span style={{ color: '#2e7d32', fontWeight: 700 }}>✓</span>
                      : c.opened ? <span style={{ color: '#e65100' }}>👀</span>
                        : <span style={{ color: 'var(--text-muted)' }}>—</span>}
                  </td>
                ))}
                <td style={{ ...td, textAlign: 'right' }}>{r.done}/{r.total}</td>
                <td style={{ ...td, textAlign: 'right', fontWeight: 700, color: color(r.avg) }}>
                  {r.avg != null ? `${r.avg}%` : '—'}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      <div style={{ fontSize: '.72rem', color: 'var(--text-muted)', marginTop: 6 }}>
        Coloanele numerotate sunt exercițiile temei (treci cu mausul peste ele pentru titlu). ✓ rezolvat · 👀 deschis.
      </div>
    </div>
  );
}
