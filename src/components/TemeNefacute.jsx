// =====================================================================
// src/components/TemeNefacute.jsx — „📌 Teme nefăcute" (contul elevului)
//
// Apare DOAR dacă elevul e asociat cu un profesor, imediat DEASUPRA
// rolldown-ului „📊 Rezultatele mele" din „Contul meu".
//
// Adună tot ce are elevul de rezolvat:
//   📝 temele date de profesor (exercițiile bifate — api/homework.js);
//   🧩 testele pe grupă nerezolvate (un link, alt test per elev);
//   📄 temele primite prin link (/tema?id=…).
// =====================================================================
import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { aiClient } from '../lib/aiClient';

const KIND = {
  tema: { icon: '📝', label: 'temă' },
  test: { icon: '🧩', label: 'test pe grupă' },
  'tema-link': { icon: '📄', label: 'temă primită pe link' },
};

function fmtDate(iso) {
  if (!iso) return '';
  return new Date(iso).toLocaleDateString('ro-RO', { day: '2-digit', month: 'short', year: 'numeric' });
}

export default function TemeNefacute() {
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [showDone, setShowDone] = useState(false);

  const load = useCallback(async () => {
    try { setData(await aiClient.homeworkStudentList()); }
    catch (e) { setError(e.message); setData({ pending: [], done: [], hasTeacher: false }); }
  }, []);
  useEffect(() => { load(); }, [load]);

  // fără profesor asociat, tabul nu are ce afișa — nici nu apare
  if (!data || (!data.hasTeacher && !error)) return null;
  if (error && !data.pending?.length) return null;

  const pending = data.pending || [];
  const done = data.done || [];

  const row = (t) => {
    const k = KIND[t.kind] || KIND.tema;
    const late = t.dueAt && new Date(t.dueAt) < new Date();
    return (
      <Link key={`${t.kind}:${t.id}`} to={t.url}
        style={{
          display: 'flex', alignItems: 'center', gap: 10, padding: '10px 12px',
          border: '1px solid var(--border)', borderRadius: 10, background: '#fff',
          textDecoration: 'none',
        }}>
        <span style={{ fontSize: '1.15rem' }}>{k.icon}</span>
        <span style={{ flex: 1, minWidth: 0 }}>
          <span style={{ display: 'block', fontWeight: 700, color: 'var(--navy)', fontSize: '.88rem' }}>
            {t.title}{' '}
            <span style={{ fontWeight: 500, color: 'var(--text-muted)', fontSize: '.74rem' }}>({k.label})</span>
          </span>
          <span style={{ display: 'block', fontSize: '.74rem', color: 'var(--text-muted)', marginTop: 2 }}>
            {t.teacher ? `de la ${t.teacher}` : ''}{t.group ? ` · grupa ${t.group}` : ''}
            {t.items > 1 ? ` · ${t.doneItems}/${t.items} rezolvate` : ''}
            {t.at ? ` · ${fmtDate(t.at)}` : ''}
            {t.dueAt ? ` · termen ${fmtDate(t.dueAt)}` : ''}
          </span>
          {t.note && <span style={{ display: 'block', fontSize: '.74rem', color: 'var(--text-light)', marginTop: 2, fontStyle: 'italic' }}>„{t.note}"</span>}
        </span>
        {late && (
          <span style={{ fontSize: '.68rem', fontWeight: 700, color: '#c62828', background: 'rgba(198,40,40,.08)', border: '1px solid rgba(198,40,40,.3)', borderRadius: 12, padding: '2px 8px', whiteSpace: 'nowrap' }}>
            termen depășit
          </span>
        )}
        <span style={{ color: 'var(--gold-dim, #b8860b)', fontWeight: 700, fontSize: '.8rem', whiteSpace: 'nowrap' }}>Rezolvă →</span>
      </Link>
    );
  };

  return (
    <details className="card" style={{ marginBottom: 24 }} open={pending.length > 0}>
      <summary style={{ cursor: 'pointer', fontWeight: 700, color: 'var(--navy)', fontFamily: 'var(--font-display)', fontSize: '1.05rem', listStyle: 'none' }}>
        📌 Teme nefăcute
        {pending.length > 0 && (
          <span style={{ marginLeft: 8, background: '#e74c3c', color: '#fff', borderRadius: 12, fontSize: '.72rem', fontWeight: 700, padding: '2px 9px' }}>
            {pending.length}
          </span>
        )}
      </summary>
      <div style={{ marginTop: 14 }}>
        {pending.length === 0 ? (
          <p style={{ color: 'var(--text-muted)', fontSize: '.88rem', margin: 0 }}>
            🎉 Nu ai nicio temă nefăcută. Bravo!
          </p>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {pending.map(row)}
          </div>
        )}

        {done.length > 0 && (
          <div style={{ marginTop: 14 }}>
            <button type="button" onClick={() => setShowDone((v) => !v)}
              style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--navy)', fontSize: '.82rem', fontWeight: 700, padding: 0, fontFamily: 'var(--font-body)' }}>
              {showDone ? '▾' : '▸'} Teme rezolvate ({done.length})
            </button>
            {showDone && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 8, opacity: .75 }}>
                {done.map(row)}
              </div>
            )}
          </div>
        )}
      </div>
    </details>
  );
}
