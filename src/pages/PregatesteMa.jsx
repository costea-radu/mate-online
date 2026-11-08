// =====================================================================
// src/pages/PregatesteMa.jsx — „🎯 PREGĂTEȘTE-MĂ DE EXAMEN" (8 nov. 2026)
// Ruta: /pregateste-ma
//
// Cererea: un buton care amintește zilnic, printr-o notificare, să rezolvi un
// test; progresul cu XP în Arena și clasament, simplu ca pe Duolingo, cu
// promovare și alte răsplăți; contează și o parte dintr-un test.
//
// Pagina: examenul ales · TESTUL DE AZI (interactiv sau — cu Premium — subiect
// oficial pe PDF) · seria de zile și săptămâna · „🔔 Amintește-mi" · răsplățile
// (XP, 🪙, liga din Arenă, insignele) · ultimele zile (nota se vede doar aici).
// Ziua se bifează pe server (api/_lib/pregatireZilnica.js), când elevul a lucrat
// la câteva exerciții dintr-un test de examen — oricare, nu neapărat întreg.
// API: /api/gamificare → 'pregatire', 'pregatire_alege', 'pregatire_alt_test',
// 'pregatire_notificari' / 'pregatire_notificari_proba'.
// (Altceva decât „Pregătirea de examen" cu Prof. Tudor, /meditatii/pregatire —
// ședințele live pe barem; pagina trimite și acolo.)
// =====================================================================
import { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { aiClient } from '../lib/aiClient';
import { arenaChanged, onArenaChange } from '../lib/arena';
import { AmintireZilnica } from '../components/MisiuneZilnica';
import '@fontsource/caveat/700.css';   // nota „de mână" din ultimele zile

const card = {
  background: 'var(--white)', border: '1px solid var(--border)',
  borderRadius: 'var(--radius-lg)', padding: '18px 20px', boxShadow: 'var(--shadow-sm)',
};
const eticheta = { fontSize: '0.72rem', letterSpacing: '0.06em', textTransform: 'uppercase', fontWeight: 800 };
const fmtNota = (n) => Number(n).toFixed(2).replace('.', ',');
const ziua = (iso) => {
  try { return new Date(`${iso}T12:00:00`).toLocaleDateString('ro-RO', { weekday: 'short', day: 'numeric', month: 'short' }); }
  catch { return iso; }
};

const TEXTE_AMINTIRE = {
  actiune: 'pregatire_notificari', actiuneProba: 'pregatire_notificari_proba', pushLs: 'pz_push_ep',
  intrebare: 'Vrei să-ți amintesc de testul zilei?',
  dacaNu: 'dacă n-ai lucrat încă la test',
  doarCand: 'doar în zilele în care n-ai lucrat încă la test',
  sql: 'supabase/pregatire_zilnica.sql', inactiv: 'Amintirile testului zilei nu sunt active',
};

// cerculețul unei zile din săptămână
function Zi({ z }) {
  const facut = z.stare === 'facut', azi = z.stare === 'azi', ratat = z.stare === 'ratat';
  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4, minWidth: 30 }}
      title={facut ? `${z.day}: ziua bifată` : azi ? 'Azi — testul te așteaptă' : ratat ? `${z.day}: fără test` : z.day}>
      <span style={{ fontSize: '.68rem', fontWeight: 700, color: azi ? 'var(--navy)' : 'var(--text-muted)' }}>{z.label}</span>
      <span aria-hidden style={{
        width: 32, height: 32, borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center',
        fontSize: '.9rem', fontWeight: 800,
        background: facut ? 'linear-gradient(135deg, var(--gold), var(--gold-light))' : azi ? '#fff' : ratat ? 'var(--cream-dark)' : 'var(--cream)',
        color: facut ? 'var(--navy)' : 'var(--text-muted)',
        border: azi ? '2px solid var(--navy)' : '2px solid transparent',
        animation: azi ? 'pzPuls 2s ease-in-out infinite' : 'none',
      }}>{facut ? '✓' : ratat ? '·' : ''}</span>
    </div>
  );
}

export default function PregatesteMa() {
  const { user, isAdmin, isPremium, loading: authLoading } = useAuth();
  const navigate = useNavigate();
  const [p, setP] = useState(null);
  const [notif, setNotif] = useState(null);
  const [err, setErr] = useState(null);
  const [busy, setBusy] = useState(false);
  const [schimba, setSchimba] = useState(false);
  const [info, setInfo] = useState(null);

  const load = useCallback(async () => {
    if (!user) return;
    try {
      const r = await aiClient.gamificare({ action: 'pregatire' });
      setP(r?.pregatire || null);
      if (r?.notificari) setNotif(r.notificari);
      setErr(null);
    } catch (e) { setErr(e?.message || 'Nu am putut încărca pregătirea.'); }
  }, [user]);

  useEffect(() => { load(); }, [load]);
  useEffect(() => onArenaChange(() => load()), [load]);
  useEffect(() => {
    const reia = () => { if (document.visibilityState === 'visible') load(); };
    document.addEventListener('visibilitychange', reia);
    return () => document.removeEventListener('visibilitychange', reia);
  }, [load]);

  async function alege(payload) {
    setBusy(true); setErr(null); setInfo(null);
    try {
      const r = await aiClient.gamificare({ action: 'pregatire_alege', ...payload });
      setP(r?.pregatire || null);
      setSchimba(false);
      arenaChanged();
    } catch (e) { setErr(e?.message || 'Nu am putut salva alegerea.'); }
    finally { setBusy(false); }
  }

  async function altTest() {
    setBusy(true); setErr(null); setInfo(null);
    try {
      const r = await aiClient.gamificare({ action: 'pregatire_alt_test' });
      setP(r?.pregatire || null);
      if (r?.faraAltul) setInfo('Nu mai am alt test în această listă — încearcă celălalt format sau revino mâine.');
    } catch (e) { setErr(e?.message || 'Nu am putut schimba testul.'); }
    finally { setBusy(false); }
  }

  const header = (
    <div className="page-header pz-header">
      <div className="container">
        <div className="breadcrumb"><Link to="/">Acasă</Link><span>›</span><span>Pregătește-mă de examen</span></div>
        <h1>🎯 Pregătește-mă de examen</h1>
        <p>Un test pe zi, ca la Duolingo: rezolvi cât poți — contează și o parte din test —, primești XP, urci în ligă și nu-ți pierzi seria.</p>
      </div>
    </div>
  );

  const stil = (
    <style>{`
@keyframes pzPuls{0%,100%{box-shadow:0 0 0 0 rgba(15,43,68,.35)}50%{box-shadow:0 0 0 6px rgba(15,43,68,0)}}
.pz-grid{display:grid;gap:18px}
.pz-top{display:grid;grid-template-columns:minmax(0,1.6fr) minmax(0,1fr);gap:18px;align-items:start}
@media (max-width: 900px){.pz-top{grid-template-columns:1fr}}
.pz-chip{padding:10px 14px;border-radius:12px;font-weight:800;font-size:.9rem;border:2px solid var(--border);background:#fff;color:var(--navy);cursor:pointer;text-align:left}
.pz-chip.on{border-color:var(--gold);background:rgba(232,185,49,.14)}
.pz-chip small{display:block;font-weight:600;color:var(--text-muted);font-size:.72rem;margin-top:2px}
.pz-fmt{display:inline-flex;border:1px solid var(--border);border-radius:999px;overflow:hidden}
.pz-fmt button{background:#fff;border:none;padding:6px 12px;font-weight:700;font-size:.8rem;color:var(--navy);cursor:pointer}
.pz-fmt button.on{background:var(--navy);color:#fff}
.pz-fmt button:disabled{cursor:not-allowed;opacity:.6}
.pz-ins{display:flex;align-items:center;gap:8px;border-radius:12px;padding:8px 10px;border:1.5px solid var(--border);background:var(--cream)}
.pz-ins.on{border-color:var(--gold);background:rgba(232,185,49,.10)}
.pz-ins.off{filter:grayscale(1);opacity:.55}
`}</style>
  );

  if (authLoading) {
    return <>{header}<div className="content-list"><div className="container" style={{ padding: '40px 0', textAlign: 'center', color: 'var(--text-light)' }}>Se încarcă…</div></div></>;
  }

  if (!user) {
    return (
      <>
        {header}
        <div className="content-list"><div className="container">
          <div style={{ ...card, textAlign: 'center', padding: 36 }}>
            <div style={{ fontSize: '2.2rem' }}>📝🔥🏆</div>
            <h2 style={{ fontFamily: 'var(--font-display)', color: 'var(--navy)', margin: '10px 0 6px' }}>Un test pe zi până la examen</h2>
            <p style={{ color: 'var(--text-light)', maxWidth: 560, margin: '0 auto 18px', lineHeight: 1.6 }}>
              Îți alegi examenul (Evaluarea Națională sau BAC), primești în fiecare zi un test, iar noi îți amintim de el.
              Fiecare zi lucrată îți aduce XP și monede, o serie de zile la rând și un loc mai bun în liga săptămânii.
            </p>
            <div style={{ display: 'flex', gap: 10, justifyContent: 'center', flexWrap: 'wrap' }}>
              <Link to="/inregistrare" className="btn btn-primary">Creează cont gratuit</Link>
              <Link to="/autentificare" className="btn btn-outline">Am deja cont</Link>
            </div>
          </div>
        </div></div>
      </>
    );
  }

  if (!p && !err) {
    return <>{header}<div className="content-list"><div className="container"><div style={{ ...card, color: 'var(--text-light)' }}>🎯 Se pregătește testul de azi…</div></div></div></>;
  }

  if (p && p.activ === false) {
    return (
      <>
        {header}
        <div className="content-list"><div className="container">
          <div style={{ ...card, borderColor: isAdmin ? 'var(--danger)' : 'var(--border)' }}>
            {isAdmin
              ? <><strong style={{ color: 'var(--danger)' }}>Pregătirea zilnică nu e activă.</strong> Rulează <code>supabase/pregatire_zilnica.sql</code> în Supabase → SQL Editor.{p.mesaj && <div style={{ fontSize: '.8rem', color: 'var(--text-muted)', marginTop: 6 }}>{p.mesaj}</div>}</>
              : 'Pregătirea zilnică pornește în curând. Până atunci, testele de examen le găsești la Evaluarea Națională și Bacalaureat.'}
          </div>
        </div></div>
      </>
    );
  }

  const alegereExamen = (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(190px, 1fr))', gap: 10, marginTop: 12 }}>
      {(p?.examene || []).map((e) => (
        <button key={e.id} type="button" disabled={busy}
          className={`pz-chip${p?.examen?.id === e.id ? ' on' : ''}`} onClick={() => alege({ examen: e.id })}>
          {e.id === 'evaluare-nationala' ? '📘' : '🎓'} {e.label}
          <small>{e.id === 'evaluare-nationala' ? 'clasa a VIII-a' : 'clasa a XII-a'}{p?.sugestie === e.id ? ' · ales în „Planul meu"' : ''}</small>
        </button>
      ))}
    </div>
  );

  const lucrat = !!p?.lucrat;
  const t = p?.test;
  const r = p?.recompensa || {};
  const deschide = () => { if (t?.url) navigate(t.url); };

  return (
    <>
      {header}
      {stil}
      <div className="content-list">
        <div className="container pz-grid">
          {err && <div style={{ ...card, borderColor: 'var(--danger)', color: 'var(--danger)' }}>{err}</div>}

          {p?.alegeExamen ? (
            <div style={{ ...card, borderColor: 'var(--gold)', borderWidth: 2 }}>
              <div style={{ ...eticheta, color: 'var(--gold-dim)' }}>Primul pas</div>
              <h2 style={{ fontFamily: 'var(--font-display)', color: 'var(--navy)', margin: '6px 0 4px', fontSize: '1.35rem' }}>Pentru ce examen te pregătești?</h2>
              <p style={{ color: 'var(--text-light)', margin: 0, fontSize: '.92rem' }}>
                În fiecare zi îți dau un test din examenul tău. Ziua se bifează de la {p.prag || 3} exerciții lucrate — nu trebuie să-l termini.
              </p>
              {alegereExamen}
            </div>
          ) : p && (
            <div className="pz-top">
              {/* ─── Testul de azi ─── */}
              <div style={{ ...card, borderColor: lucrat ? 'var(--success)' : 'var(--gold)', borderWidth: 2 }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, flexWrap: 'wrap' }}>
                  <div style={{ ...eticheta, color: lucrat ? 'var(--success)' : 'var(--gold-dim)' }}>
                    📝 Testul de azi{lucrat ? ' · ziua e bifată' : ''}
                  </div>
                  <button type="button" onClick={() => setSchimba((v) => !v)}
                    style={{ background: 'none', border: '1px solid var(--border)', borderRadius: 999, padding: '3px 10px', fontSize: '.76rem', fontWeight: 700, color: 'var(--navy)', cursor: 'pointer' }}
                    title="Schimbă examenul">
                    {p.examen?.label} ✎
                  </button>
                </div>

                {schimba && (
                  <div style={{ background: 'var(--cream)', borderRadius: 12, padding: '10px 12px', marginTop: 10 }}>
                    <div style={{ fontSize: '.82rem', color: 'var(--text-light)' }}>
                      Alege alt examen{lucrat ? ' — testul se schimbă, ziua de azi rămâne bifată.' : ' — testul de azi se schimbă pe loc.'}
                    </div>
                    {alegereExamen}
                  </div>
                )}

                <div style={{ display: 'flex', gap: 18, flexWrap: 'wrap', alignItems: 'center', marginTop: 12 }}>
                  <div style={{ textAlign: 'center', minWidth: 92 }}>
                    <div style={{ fontSize: '2.1rem', fontWeight: 800, color: 'var(--navy)', lineHeight: 1 }}>🔥 {p.serie || 0}</div>
                    <div style={{ fontSize: '.74rem', color: 'var(--text-muted)', marginTop: 4 }}>{p.serie === 1 ? 'zi la rând' : 'zile la rând'}</div>
                  </div>
                  <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }} aria-label="Zilele din săptămâna aceasta">
                    {(p.saptamana || []).map((z) => <Zi key={z.day} z={z} />)}
                  </div>
                </div>

                <div style={{ marginTop: 14, padding: '14px 16px', borderRadius: 14, background: lucrat ? 'rgba(39,174,96,0.08)' : 'rgba(232,185,49,0.10)' }}>
                  {t ? (
                    <>
                      <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                        <span style={{ fontSize: '.72rem', fontWeight: 800, borderRadius: 999, padding: '2px 8px', background: '#fff', border: '1px solid var(--border)', color: 'var(--navy)' }}>
                          {t.tip === 'pdf' ? '📄 Subiect pe PDF, ca la examen' : '🧩 Test interactiv'}
                        </span>
                      </div>
                      <div style={{ fontWeight: 800, color: 'var(--navy)', fontSize: '1.08rem', margin: '8px 0 6px' }}>{t.titlu}</div>
                      {lucrat ? (
                        <div style={{ fontSize: '.88rem', color: '#1e7e34', fontWeight: 600, marginBottom: 10, lineHeight: 1.5 }}>
                          ✅ Ziua e bifată{p.xpPrimit ? ` · +${p.xpPrimit} XP` : ''}{p.undeA ? ` · ai lucrat la: ${p.undeA}` : ''}.
                          {' '}Poți continua testul — fiecare exercițiu rezolvat contează la XP. Revino mâine pentru următorul!
                        </div>
                      ) : p.itemi > 0 ? (
                        <div style={{ fontSize: '.88rem', color: '#9a5b00', fontWeight: 600, marginBottom: 10 }}>
                          Ai lucrat la {p.itemi} {p.itemi === 1 ? 'exercițiu' : 'exerciții'} — încă {Math.max(1, (p.prag || 3) - p.itemi)} și ziua e bifată.
                        </div>
                      ) : (
                        <div style={{ fontSize: '.88rem', color: 'var(--text-light)', marginBottom: 10, lineHeight: 1.5 }}>
                          Rezolvă măcar <strong>{p.prag || 3} exerciții</strong> ca să bifezi ziua — contează și o parte din test.
                          {t.tip === 'pdf' ? ' Încercuiești grilele și scrii pe PDF, apoi „✅ Corectează".' : ' Profesorul Virtual te ajută pe parcurs.'}
                        </div>
                      )}
                      {p.nota != null && (
                        <div style={{ fontSize: '.84rem', marginBottom: 10, color: 'var(--navy)' }}>
                          Nota de azi: <strong style={{ color: '#c62828', fontFamily: '"Caveat", cursive', fontSize: '1.25rem' }}>{fmtNota(p.nota)}</strong>
                          <span style={{ color: 'var(--text-muted)' }}> · o vezi doar tu (în Arenă nu apar note)</span>
                        </div>
                      )}
                      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center' }}>
                        <button type="button" className={lucrat ? 'btn btn-outline' : 'btn btn-primary btn-lg'} onClick={deschide}>
                          {lucrat ? '↻ Mai lucrează la test' : p.itemi > 0 ? '▶ Continuă testul' : '▶ Începe testul de azi'}
                        </button>
                        <button type="button" className="btn btn-sm btn-outline" disabled={busy} onClick={altTest} title="Alt test din același examen">
                          🔀 Alt test
                        </button>
                      </div>
                    </>
                  ) : (
                    <div style={{ fontSize: '.9rem', color: 'var(--text-light)' }}>
                      Nu am găsit încă un test {p.format === 'pdf' ? 'PDF' : 'interactiv'} pentru {p.examen?.label}
                      {!p.premium ? ' printre cele gratuite' : ''}. Încearcă alt format sau alt examen.
                    </div>
                  )}
                  {info && <div style={{ fontSize: '.8rem', color: 'var(--text-light)', marginTop: 8 }}>{info}</div>}
                </div>

                {/* formatul: interactiv (oricine) sau subiect oficial pe PDF (Premium — corectarea scrisului) */}
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', marginTop: 12, fontSize: '.82rem', color: 'var(--text-light)' }}>
                  <span>Format:</span>
                  <span className="pz-fmt" role="group" aria-label="Formatul testului zilei">
                    <button type="button" className={p.format !== 'pdf' ? 'on' : ''} disabled={busy} onClick={() => alege({ format: 'interactiv' })}>🧩 Interactiv</button>
                    <button type="button" className={p.format === 'pdf' ? 'on' : ''} disabled={busy || !p.premium}
                      onClick={() => alege({ format: 'pdf' })}
                      title={p.premium ? 'Subiecte oficiale pe PDF: rezolvi direct pe PDF și corectezi' : 'Subiectele oficiale pe PDF, corectate de profesorul virtual, sunt cu Premium'}>
                      📄 PDF ca la examen{p.premium ? '' : ' ⭐'}
                    </button>
                  </span>
                  {!p.premium && !isPremium && <Link to="/preturi" style={{ color: 'var(--navy)', fontWeight: 700 }}>⭐ Premium</Link>}
                </div>

                <AmintireZilnica notif={notif} setNotif={setNotif} isAdmin={isAdmin} texte={TEXTE_AMINTIRE} />
              </div>

              {/* ─── Răsplățile ─── */}
              <div style={{ display: 'grid', gap: 18 }}>
                <div style={card}>
                  <div style={{ ...eticheta, color: 'var(--text-muted)' }}>🏆 Ce câștigi</div>
                  <ul style={{ margin: '10px 0 0', paddingLeft: 18, fontSize: '.88rem', color: 'var(--text-light)', lineHeight: 1.65 }}>
                    <li><strong>+{r.xp ?? 25} XP și {r.coins ?? 5} 🪙</strong> pentru fiecare zi bifată (+{r.bun ?? 10} XP la {r.pragBun ?? 80}% sau mai mult).</li>
                    <li>La fiecare <strong>{r.seriePas ?? 7} zile la rând</strong>: încă +{r.serieXp ?? 40} XP și {r.serieMonede ?? 15} 🪙.</li>
                    <li>Punctele intră în <strong>liga săptămânii</strong> din Arenă: primii 3 promovează luni (🥉 → 🥈 → 🥇 → 💎 → 👑).</li>
                    <li>Insigne pentru serii și pentru zilele de pregătire.</li>
                  </ul>
                  <div style={{ marginTop: 12, display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                    <Link to="/arena" className="btn btn-sm btn-primary">⚔️ Clasamentul din Arenă</Link>
                  </div>
                  <div style={{ fontSize: '.76rem', color: 'var(--text-muted)', marginTop: 10 }}>
                    Zile bifate: <strong>{p.total || 0}</strong>{p.record ? ` · record: ${p.record} ${p.record === 1 ? 'zi' : 'zile'} la rând` : ''}.
                  </div>
                </div>

                <div style={card}>
                  <div style={{ ...eticheta, color: 'var(--text-muted)' }}>🏅 Insignele pregătirii</div>
                  <div style={{ display: 'grid', gap: 8, marginTop: 10 }}>
                    {(p.insigneToate || []).map((b) => {
                      const are = (p.insigne || []).some((x) => x.id === b.id);
                      return (
                        <div key={b.id} className={`pz-ins ${are ? 'on' : 'off'}`} title={b.desc}>
                          <span style={{ fontSize: '1.3rem' }}>{b.icon}</span>
                          <div style={{ lineHeight: 1.3 }}>
                            <div style={{ fontWeight: 800, fontSize: '.84rem', color: 'var(--navy)' }}>{b.name}{are ? ' ✓' : ''}</div>
                            <div style={{ fontSize: '.72rem', color: 'var(--text-muted)' }}>{b.desc}</div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* ─── Ultimele zile (doar pentru elev; nota nu apare nicăieri altundeva public) ─── */}
          {p && !p.alegeExamen && (p.ultimele || []).length > 0 && (
            <div style={card}>
              <div style={{ ...eticheta, color: 'var(--text-muted)' }}>🗓️ Ultimele zile de pregătire</div>
              <div style={{ display: 'grid', gap: 2, marginTop: 10 }}>
                {p.ultimele.map((u) => (
                  <div key={u.zi} style={{ display: 'grid', gridTemplateColumns: '110px 1fr auto', gap: 10, alignItems: 'center', padding: '7px 8px', borderRadius: 8, background: 'var(--cream)', fontSize: '.86rem' }}>
                    <span style={{ color: 'var(--text-muted)' }}>{ziua(u.zi)}</span>
                    <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', color: 'var(--navy)', fontWeight: 600 }}>✓ {u.titlu}</span>
                    <span style={{ color: 'var(--text-light)', whiteSpace: 'nowrap' }}>{u.itemi} ex.{u.nota != null ? ` · ${fmtNota(u.nota)}` : ''}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* ─── Altfel de pregătire: cu Prof. Tudor (ședințele pe barem) ─── */}
          <div style={{ ...card, background: 'var(--cream)', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
            <div style={{ fontSize: '.9rem', color: 'var(--text-light)', maxWidth: 640 }}>
              <strong style={{ color: 'var(--navy)' }}>Vrei să lucrezi cu un profesor?</strong>{' '}
              La „Pregătirea de examen" cu Prof. Tudor treci prin examen exercițiu cu exercițiu, explicat pe baremul oficial,
              iar la Meditații live rezolvă zilnic câte un subiect la tablă.
            </div>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              <Link to="/meditatii/pregatire" className="btn btn-sm btn-outline">🎓 Cu Prof. Tudor</Link>
              <Link to="/meditatii" className="btn btn-sm btn-outline">🔴 Meditații live</Link>
            </div>
          </div>
        </div>
      </div>
    </>
  );
}
