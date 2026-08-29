// =====================================================================
// src/pages/Harta.jsx — „🗺️ Harta capitolelor" (pasul 5 din gamificare)
// Capitolele programei în ordine, cu deblocare pe bază de STĂPÂNIRE.
// API: /api/harta (state · unlock)
// =====================================================================
import { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { aiClient } from '../lib/aiClient';
import { arenaChanged } from '../lib/arena';

const CATEGORII = [
  { id: 'clasa-5', label: 'Clasa a V-a' },
  { id: 'clasa-6', label: 'Clasa a VI-a' },
  { id: 'clasa-7', label: 'Clasa a VII-a' },
  { id: 'clasa-8', label: 'Clasa a VIII-a' },
  { id: 'evaluare-nationala', label: 'Evaluare Națională' },
  { id: 'clasa-9', label: 'Clasa a IX-a' },
  { id: 'clasa-10', label: 'Clasa a X-a' },
  { id: 'clasa-11', label: 'Clasa a XI-a' },
  { id: 'clasa-12', label: 'Clasa a XII-a' },
  { id: 'bacalaureat', label: 'Bacalaureat' },
];

const card = {
  background: 'var(--white)', border: '1px solid var(--border)',
  borderRadius: 'var(--radius-lg)', padding: '16px 18px', boxShadow: 'var(--shadow-sm)',
};

export default function Harta() {
  const { user, loading: authLoading } = useAuth();
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const categorie = params.get('c') || 'clasa-8';
  const [d, setD] = useState(null);
  const [err, setErr] = useState(null);
  const [loading, setLoading] = useState(true);
  const [deschis, setDeschis] = useState(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    if (!user) { setLoading(false); return; }
    setLoading(true); setErr(null);
    try {
      const r = await aiClient.harta({ action: 'state', categorie });
      setD(r);
      if (r.premii?.length) arenaChanged(); // s-a dat bonus de capitol → actualizează XP-ul din navbar
    } catch (e) { setErr(e?.message || 'Nu am putut încărca harta.'); }
    finally { setLoading(false); }
  }, [user, categorie]);

  useEffect(() => { load(); }, [load]);

  async function sarPeste(id) {
    setBusy(true);
    try { await aiClient.harta({ action: 'unlock', chapterId: id }); await load(); }
    catch (e) { setErr(e?.message || 'Nu am putut debloca capitolul.'); }
    finally { setBusy(false); }
  }

  if (authLoading || loading) {
    return <div className="content-list"><div className="container" style={{ padding: '60px 0', textAlign: 'center', color: 'var(--text-light)' }}>Se încarcă harta…</div></div>;
  }

  if (!user) {
    return (
      <>
        <div className="page-header"><div className="container"><h1>🗺️ Harta capitolelor</h1><p>Vezi unde ai ajuns și ce urmează.</p></div></div>
        <div className="content-list"><div className="container">
          <div style={{ ...card, textAlign: 'center', padding: 40 }}>
            <p style={{ marginBottom: 16 }}>Intră în cont ca să-ți vezi harta.</p>
            <Link to="/autentificare" className="btn btn-primary">Autentificare</Link>
          </div>
        </div></div>
      </>
    );
  }

  const capitole = d?.capitole || [];
  const stapanite = capitole.filter((c) => c.stapanit).length;

  return (
    <>
      <div className="page-header">
        <div className="container">
          <div className="breadcrumb"><Link to="/">Acasă</Link><span>›</span><Link to="/arena">Arena</Link><span>›</span><span>Harta</span></div>
          <h1>🗺️ Harta capitolelor</h1>
          <p>Treci mai departe când stăpânești capitolul: minimum {d?.prag || 70}% la {capitole[0]?.tinta || 2} exerciții. Fiecare capitol stăpânit aduce {d?.xpCapitol || 80} XP.</p>
        </div>
      </div>

      <div className="content-list">
        <div className="container" style={{ display: 'grid', gap: 16 }}>

          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
            {CATEGORII.map((c) => (
              <button key={c.id}
                onClick={() => setParams({ c: c.id })}
                className={`btn btn-sm ${c.id === categorie ? 'btn-primary' : 'btn-outline'}`}
                style={{ fontSize: '0.8rem' }}>
                {c.label}
              </button>
            ))}
          </div>

          {err && <div style={{ ...card, borderColor: 'var(--danger)', color: 'var(--danger)' }}>{err}</div>}

          {!!capitole.length && (
            <div style={{ fontSize: '0.86rem', color: 'var(--text-light)' }}>
              {stapanite} din {capitole.length} capitole stăpânite
            </div>
          )}

          {!capitole.length && !err && (
            <div style={card}>
              Nu am găsit capitole pentru această secțiune. Alege altă clasă.
            </div>
          )}

          {capitole.map((c, i) => {
            const culoare = c.stapanit ? 'var(--success)' : c.blocat ? 'var(--border)' : 'var(--gold)';
            return (
              <div key={c.id} style={{
                ...card,
                opacity: c.blocat ? 0.62 : 1,
                borderLeft: `4px solid ${culoare}`,
              }}>
                <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 10 }}>
                  <span style={{ fontSize: '1.2rem' }}>
                    {c.stapanit ? '✅' : c.blocat ? '🔒' : '▶️'}
                  </span>
                  <strong style={{ fontSize: '1.02rem' }}>{i + 1}. {c.titlu}</strong>
                  {c.clasa > 0 && <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>clasa {c.clasa}</span>}
                  <span style={{ marginLeft: 'auto', fontSize: '0.82rem', color: 'var(--text-light)' }}>
                    {c.total === 0 ? 'fără exerciții încă' : `${c.bune}/${c.tinta} exerciții stăpânite`}
                    {c.rezolvate > 0 && ` · media ${c.medie}%`}
                  </span>
                </div>

                {c.total > 0 && (
                  <div style={{ background: 'var(--cream-dark)', borderRadius: 999, height: 7, marginTop: 10, overflow: 'hidden' }}>
                    <div style={{ width: `${c.procent}%`, height: '100%', background: culoare, borderRadius: 999 }} />
                  </div>
                )}

                {!c.blocat && c.total > 0 && (
                  <>
                    <button onClick={() => setDeschis(deschis === c.id ? null : c.id)}
                      style={{ background: 'none', border: 'none', padding: 0, marginTop: 10, cursor: 'pointer', font: 'inherit', color: 'var(--navy)', fontWeight: 700, fontSize: '0.85rem' }}>
                      {deschis === c.id ? '▾' : '▸'} {c.total} {c.total === 1 ? 'exercițiu' : 'exerciții'}
                    </button>
                    {deschis === c.id && (
                      <div style={{ display: 'grid', gap: 4, marginTop: 8 }}>
                        {c.exercitii.map((x) => (
                          <button key={x.id} onClick={() => navigate(`/exercitiu?id=${x.id}`)}
                            style={{
                              display: 'flex', gap: 10, alignItems: 'center', textAlign: 'left',
                              padding: '7px 10px', borderRadius: 8, cursor: 'pointer',
                              background: 'var(--cream)', border: '1px solid var(--border)', font: 'inherit', fontSize: '0.86rem',
                            }}>
                            <span>{x.scor == null ? '○' : x.scor >= (d?.prag || 70) ? '✅' : '◔'}</span>
                            <span>{x.titlu}</span>
                            <span style={{ marginLeft: 'auto', color: 'var(--text-muted)', fontSize: '0.78rem' }}>
                              {x.scor == null ? (x.gratuit ? 'gratuit' : 'premium') : `${x.scor}%`}
                            </span>
                          </button>
                        ))}
                      </div>
                    )}
                  </>
                )}

                {c.blocat && (
                  <div style={{ marginTop: 10, display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 10 }}>
                    <span style={{ fontSize: '0.84rem', color: 'var(--text-light)' }}>
                      Se deschide când stăpânești capitolul dinainte.
                    </span>
                    <button onClick={() => sarPeste(c.id)} disabled={busy} className="btn btn-sm btn-outline" style={{ fontSize: '0.78rem' }}>
                      Știu deja — sar peste
                    </button>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </>
  );
}
