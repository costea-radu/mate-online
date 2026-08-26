// =====================================================================
// src/components/TemeNefacute.jsx — tabul „📌 Teme" (contul elevului)
//
// (Numele fișierului a rămas cel vechi; tabul se numește acum „Teme" și are
//  DOUĂ secțiuni: „Teme nefăcute" și „Teme rezolvate".)
//
// Apare DOAR dacă elevul e asociat cu un profesor, imediat DEASUPRA
// rolldown-ului „📊 Rezultatele mele" din „Contul meu".
//
// Adună tot ce a primit elevul de rezolvat:
//   📝 temele date de profesor (exercițiile bifate — api/homework.js);
//   🧩 testele pe grupă (un link, alt test per elev);
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

  const row = (t, rezolvata = false) => {
    const k = KIND[t.kind] || KIND.tema;
    const late = !rezolvata && t.dueAt && new Date(t.dueAt) < new Date();
    return (
      <Link key={`${t.kind}:${t.id}`} to={t.url}
        style={{
          display: 'flex', alignItems: 'center', gap: 10, padding: '10px 12px',
          border: '1px solid var(--border)', borderRadius: 10,
          background: rezolvata ? 'rgba(39,174,96,.05)' : '#fff',
          borderColor: rezolvata ? 'rgba(39,174,96,.3)' : 'var(--border)',
          textDecoration: 'none',
        }}>
        <span style={{ fontSize: '1.15rem' }}>{rezolvata ? '✅' : k.icon}</span>
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
        <span style={{ color: rezolvata ? '#2e7d32' : 'var(--gold-dim, #b8860b)', fontWeight: 700, fontSize: '.8rem', whiteSpace: 'nowrap' }}>
          {rezolvata ? 'Reia →' : 'Rezolvă →'}
        </span>
      </Link>
    );
  };

  const titluSectiune = (text, n, culoare) => (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, margin: '0 0 10px' }}>
      <h4 style={{ fontFamily: 'var(--font-display)', color: 'var(--navy)', margin: 0, fontSize: '.98rem' }}>{text}</h4>
      <span style={{
        background: culoare, color: '#fff', borderRadius: 12,
        fontSize: '.7rem', fontWeight: 700, padding: '1px 8px',
      }}>{n}</span>
    </div>
  );

  return (
    <details className="card" style={{ marginBottom: 24 }} open={pending.length > 0}>
      <summary style={{ cursor: 'pointer', fontWeight: 700, color: 'var(--navy)', fontFamily: 'var(--font-display)', fontSize: '1.05rem', listStyle: 'none' }}>
        📌 Teme
        {pending.length > 0 && (
          <span style={{ marginLeft: 8, background: '#e74c3c', color: '#fff', borderRadius: 12, fontSize: '.72rem', fontWeight: 700, padding: '2px 9px' }}>
            {pending.length} de făcut
          </span>
        )}
      </summary>

      <div style={{ marginTop: 16 }}>
        {/* ── Secțiunea 1: nefăcute ─────────────────────────────────────── */}
        <section style={{ marginBottom: 22 }}>
          {titluSectiune('📌 Teme nefăcute', pending.length, pending.length ? '#e74c3c' : '#9aa4ae')}
          {pending.length === 0 ? (
            <p style={{ color: 'var(--text-muted)', fontSize: '.88rem', margin: 0 }}>
              🎉 Nu ai nicio temă nefăcută. Bravo!
            </p>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {pending.map((t) => row(t, false))}
            </div>
          )}
        </section>

        {/* ── Secțiunea 2: rezolvate ────────────────────────────────────── */}
        <section style={{ borderTop: '1px solid var(--border)', paddingTop: 16 }}>
          {titluSectiune('✅ Teme rezolvate', done.length, done.length ? '#27ae60' : '#9aa4ae')}
          {done.length === 0 ? (
            <p style={{ color: 'var(--text-muted)', fontSize: '.88rem', margin: 0 }}>
              Încă nicio temă rezolvată. Prima apare aici imediat ce o termini.
            </p>
          ) : (
            <div style={{
              display: 'flex', flexDirection: 'column', gap: 8,
              maxHeight: 340, overflowY: 'auto',
            }}>
              {done.map((t) => row(t, true))}
            </div>
          )}
        </section>
      </div>
    </details>
  );
}
