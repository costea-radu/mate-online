// =====================================================================
// src/pages/Arena.jsx — „⚔️ Arena matematică" (pașii 1-2 din gamificare)
//
// Ce arată: nivelul și XP-ul, seria de zile (streak), misiunea zilei și
// LIGA săptămânală (cohorta ta, cu zonele de promovare/retrogradare).
// Datele vin din /api/gamificare (action=state) — vezi api/_lib/xp.js.
//
// Dueluri, turnee și harta capitolelor sunt pașii 3-5; aici doar le anunțăm.
// =====================================================================
import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { arenaState, onArenaChange } from '../lib/arena';

const cardStyle = {
  background: 'var(--white)', border: '1px solid var(--border)',
  borderRadius: 'var(--radius-lg)', padding: '18px 20px', boxShadow: 'var(--shadow-sm)',
};

function Bara({ pct, culoare = 'var(--gold)', inaltime = 8 }) {
  return (
    <div style={{ background: 'var(--cream-dark)', borderRadius: 999, height: inaltime, overflow: 'hidden' }}>
      <div style={{ width: `${Math.max(0, Math.min(100, pct))}%`, height: '100%', background: culoare, borderRadius: 999, transition: 'width .4s ease' }} />
    </div>
  );
}

function Eticheta({ children, culoare = 'var(--text-muted)' }) {
  return <div style={{ fontSize: '0.72rem', letterSpacing: '0.06em', textTransform: 'uppercase', color: culoare, fontWeight: 700, marginBottom: 6 }}>{children}</div>;
}

export default function Arena() {
  const { user, loading: authLoading } = useAuth();
  const [s, setS] = useState(null);
  const [err, setErr] = useState(null);
  const [loading, setLoading] = useState(true);
  const [explicatie, setExplicatie] = useState(false);

  const load = useCallback(async (force = false) => {
    if (!user) { setLoading(false); return; }
    try {
      setErr(null);
      const r = await arenaState({ force });
      setS(r);
    } catch (e) {
      setErr(e?.message || 'Nu am putut încărca Arena.');
    } finally {
      setLoading(false);
    }
  }, [user]);

  useEffect(() => { load(); }, [load]);
  useEffect(() => onArenaChange(() => load(true)), [load]);

  if (authLoading || loading) {
    return (
      <div className="content-list"><div className="container" style={{ padding: '60px 0', textAlign: 'center', color: 'var(--text-light)' }}>Se încarcă Arena…</div></div>
    );
  }

  if (!user) {
    return (
      <>
        <div className="page-header"><div className="container"><h1>⚔️ Arena matematică</h1><p>XP, serie de zile, misiunea zilei și liga săptămânală.</p></div></div>
        <div className="content-list"><div className="container">
          <div style={{ ...cardStyle, textAlign: 'center', padding: 40 }}>
            <p style={{ marginBottom: 16 }}>Intră în cont ca să-ți vezi nivelul, seria de zile și clasamentul din ligă.</p>
            <Link to="/autentificare" className="btn btn-primary">Autentificare</Link>
          </div>
        </div></div>
      </>
    );
  }

  const nivel = s?.nivel || { level: 1, name: 'Începător', progressPct: 0, xpNext: 100, xpStart: 0 };
  const stats = s?.stats || { totalXp: 0, streak: 0, monede: 0, scuturi: 0, streakRecord: 0 };
  const azi = s?.azi || { xp: 0, liga: 0, plafon: 200, pragStreak: 20 };
  const misiune = s?.misiune;
  const liga = s?.liga;
  const st = s?.saptamanaTrecuta;

  return (
    <>
      <div className="page-header">
        <div className="container">
          <div className="breadcrumb"><Link to="/">Acasă</Link><span>›</span><span>Arena</span></div>
          <h1>⚔️ Arena matematică</h1>
          <p>Rezolvi exerciții → câștigi XP → urci în ligă. Contează constanța și precizia, nu cât de mult stai pe site.</p>
        </div>
      </div>

      <div className="content-list">
        <div className="container" style={{ display: 'grid', gap: 18 }}>

          {err && (
            <div style={{ ...cardStyle, borderColor: 'var(--danger)', color: 'var(--danger)' }}>
              {err}
            </div>
          )}

          {st && (
            <div style={{ ...cardStyle, background: st.rezultat === 'promovat' ? 'rgba(39,174,96,0.08)' : 'var(--cream)', borderColor: st.rezultat === 'promovat' ? 'var(--success)' : 'var(--border)' }}>
              <strong>
                {st.rezultat === 'promovat' && `🎉 Săptămâna trecută ai terminat pe locul ${st.loc} și ai promovat în Liga ${st.name} ${st.icon}`}
                {st.rezultat === 'ramas' && `Săptămâna trecută: locul ${st.loc} în Liga ${st.name} ${st.icon}. Mai ai puțin până la promovare.`}
                {st.rezultat === 'retrogradat' && `Săptămâna trecută ai terminat pe locul ${st.loc}. Reiei din Liga ${st.name} ${st.icon} — se recuperează repede.`}
              </strong>
            </div>
          )}

          {/* ─── Rândul de sus: nivel · serie · monede ─── */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: 14 }}>
            <div style={cardStyle}>
              <Eticheta>Nivel {nivel.level}</Eticheta>
              <div style={{ fontFamily: 'var(--font-display)', fontSize: '1.35rem', marginBottom: 10 }}>{nivel.name}</div>
              <Bara pct={nivel.progressPct} />
              <div style={{ fontSize: '0.82rem', color: 'var(--text-light)', marginTop: 8 }}>
                {stats.totalXp} XP{nivel.xpNext ? ` · încă ${nivel.xpNext - stats.totalXp} până la nivelul ${nivel.level + 1}` : ' · nivel maxim'}
              </div>
            </div>

            <div style={cardStyle}>
              <Eticheta>Serie de zile</Eticheta>
              <div style={{ fontFamily: 'var(--font-display)', fontSize: '1.35rem', marginBottom: 10 }}>
                🔥 {stats.streak} {stats.streak === 1 ? 'zi' : 'zile'}
              </div>
              <div style={{ fontSize: '0.82rem', color: 'var(--text-light)' }}>
                {stats.streakAzi ? 'Ziua de azi e bifată. '
                  : azi.xp >= azi.pragStreak
                    ? 'Rezolvă un exercițiu ca să se bifeze ziua de azi. '
                    : `Mai ai nevoie de ${azi.pragStreak - azi.xp} XP azi ca să se bifeze. `}
                {stats.scuturi > 0 && <>🛡️ {stats.scuturi} {stats.scuturi === 1 ? 'scut' : 'scuturi'} (acoperă o zi ratată). </>}
                {stats.streakRecord > stats.streak && <>Record: {stats.streakRecord}.</>}
              </div>
            </div>

            <div style={cardStyle}>
              <Eticheta>Azi</Eticheta>
              <div style={{ fontFamily: 'var(--font-display)', fontSize: '1.35rem', marginBottom: 10 }}>{azi.xp} XP</div>
              <Bara pct={(azi.liga / azi.plafon) * 100} culoare="var(--navy-light)" />
              <div style={{ fontSize: '0.82rem', color: 'var(--text-light)', marginTop: 8 }}>
                {azi.liga}/{azi.plafon} puncte de ligă azi
                {azi.liga >= azi.plafon && ' — plafon atins, revino mâine 🙂'}
                {' · 🪙 '}{stats.monede}
              </div>
            </div>
          </div>

          {/* ─── Misiunea zilei ─── */}
          {misiune && (
            <div style={{ ...cardStyle, borderColor: misiune.done ? 'var(--success)' : 'var(--border)' }}>
              <Eticheta culoare={misiune.done ? 'var(--success)' : 'var(--text-muted)'}>
                🎯 Misiunea zilei {misiune.done && '· terminată'}
              </Eticheta>
              <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', gap: 12, marginBottom: 10 }}>
                <strong style={{ fontSize: '1.05rem' }}>{misiune.label}</strong>
                <span style={{ fontSize: '0.85rem', color: 'var(--text-light)' }}>
                  {misiune.done ? `+${misiune.reward_xp} XP · +${misiune.reward_coins} 🪙 primite` : `Recompensă: ${misiune.reward_xp} XP + ${misiune.reward_coins} 🪙`}
                </span>
              </div>
              <Bara pct={(misiune.progress / misiune.target) * 100} culoare={misiune.done ? 'var(--success)' : 'var(--gold)'} inaltime={10} />
              <div style={{ fontSize: '0.82rem', color: 'var(--text-light)', marginTop: 8 }}>{misiune.progress} / {misiune.target}</div>
            </div>
          )}

          {/* ─── Liga ─── */}
          <div style={cardStyle}>
            {liga ? (
              <>
                <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'baseline', justifyContent: 'space-between', gap: 10, marginBottom: 4 }}>
                  <div>
                    <Eticheta>Liga săptămânii</Eticheta>
                    <div style={{ fontFamily: 'var(--font-display)', fontSize: '1.35rem' }}>
                      {liga.icon} Liga {liga.name} <span style={{ fontSize: '0.9rem', color: 'var(--text-muted)' }}>· grupa {liga.cohorta}</span>
                    </div>
                  </div>
                  <div style={{ textAlign: 'right', fontSize: '0.85rem', color: 'var(--text-light)' }}>
                    {liga.loc ? <>Locul <strong style={{ fontSize: '1.1rem', color: 'var(--text)' }}>{liga.loc}</strong> din {liga.membri}</> : 'Nu ai puncte încă'}
                    <div>{liga.puncte} puncte</div>
                  </div>
                </div>
                <p style={{ fontSize: '0.82rem', color: 'var(--text-light)', margin: '4px 0 14px' }}>
                  Primii {liga.promoveaza} promovează luni
                  {liga.retrogradeaza > 0 ? `, ultimii ${liga.retrogradeaza} coboară o divizie` : ''}.
                  Maximum {azi.plafon} de puncte pe zi — cine intră des câștigă, nu cine stă mult.
                </p>

                <div style={{ display: 'grid', gap: 2 }}>
                  {liga.clasament.map((r) => (
                    <div key={r.loc} style={{
                      display: 'grid', gridTemplateColumns: '34px 1fr auto', alignItems: 'center', gap: 10,
                      padding: '8px 10px', borderRadius: 8,
                      background: r.eu ? 'rgba(232,185,49,0.16)' : (r.loc % 2 ? 'transparent' : 'var(--cream)'),
                      borderLeft: `3px solid ${r.zona === 'promovare' ? 'var(--success)' : r.zona === 'retrogradare' ? 'var(--danger)' : 'transparent'}`,
                      fontWeight: r.eu ? 700 : 400,
                    }}>
                      <span style={{ color: 'var(--text-muted)' }}>{r.loc}</span>
                      <span>{r.nume}</span>
                      <span>{r.puncte}</span>
                    </div>
                  ))}
                  {liga.clasament.length === 0 && (
                    <div style={{ color: 'var(--text-light)', fontSize: '0.9rem' }}>Încă nimeni nu are puncte în grupa ta. Rezolvă un exercițiu și ești primul.</div>
                  )}
                </div>
              </>
            ) : (
              <div style={{ color: 'var(--text-light)' }}>
                <Eticheta>Liga săptămânii</Eticheta>
                Liga pornește la primul exercițiu rezolvat.
              </div>
            )}
          </div>

          {/* ─── Cum se calculează XP-ul (transparență) ─── */}
          <div style={cardStyle}>
            <button
              onClick={() => setExplicatie((v) => !v)}
              style={{ background: 'none', border: 'none', padding: 0, cursor: 'pointer', font: 'inherit', color: 'var(--navy)', fontWeight: 700 }}
            >
              {explicatie ? '▾' : '▸'} Cum se calculează XP-ul?
            </button>
            {explicatie && (
              <div style={{ fontSize: '0.9rem', color: 'var(--text-light)', marginTop: 12, lineHeight: 1.7 }}>
                <p style={{ margin: '0 0 8px' }}><strong>XP = itemi corecți × dificultate × precizie × penalizare de reluare.</strong></p>
                <ul style={{ margin: 0, paddingLeft: 20 }}>
                  <li>Un item corect valorează 5 XP la dificultate medie.</li>
                  <li>Peste 90% corect: +25% XP. Peste 70%: +10%. Sub 40%: primești doar 60%.</li>
                  <li>Același exercițiu reluat dă mai puțin (a doua oară jumătate, a treia o treime) — ca să nu se poată aduna XP repetând ceva ușor.</li>
                  <li>Dacă îl reiei și te îmbunătățești cu peste 20 de puncte procentuale, primești un bonus de progres.</li>
                  <li>În ligă intră cel mult {azi.plafon} de puncte pe zi. XP-ul peste plafon se adună la total, dar nu în clasament.</li>
                </ul>
              </div>
            )}
          </div>

          {/* ─── Ce urmează ─── */}
          <div style={{ ...cardStyle, background: 'var(--cream)' }}>
            <Eticheta>În curând</Eticheta>
            <div style={{ fontSize: '0.92rem', color: 'var(--text-light)' }}>
              ⚔️ Dueluri 1-la-1 cu colegii · 🏆 Turnee de grupă și pe site · 🗺️ Harta capitolelor
            </div>
            <div style={{ marginTop: 14, display: 'flex', gap: 10, flexWrap: 'wrap' }}>
              <Link to="/evaluare-nationala" className="btn btn-sm btn-primary">Exerciții · Evaluare Națională</Link>
              <Link to="/bacalaureat" className="btn btn-sm btn-outline">Exerciții · Bacalaureat</Link>
              <Link to="/profil" className="btn btn-sm btn-outline">Insignele mele</Link>
            </div>
          </div>

        </div>
      </div>
    </>
  );
}
