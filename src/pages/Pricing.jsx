import { authHeaders } from '../lib/api';
import { useEffect, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { track, trackBeginCheckout } from '../lib/analytics';
// Planurile afișate (doar pentru afișare — prețurile reale sunt pe server)
import { PLANS } from '../lib/plans';
import { tineMintePlanul } from '../lib/continuare';

// =====================================================================
// /preturi — abonamentul, pe scurt (rescrisă pe 11 nov. 2026, seara)
//
// Ce s-a schimbat față de pagina veche (o listă de 13 rânduri, cu numele
// modelelor AI, și butonul de plată abia la capătul ei):
//   · planul și butonul de plată sunt primele, unul sub altul;
//   · „Ce primești": cinci rânduri, pe tipul de cont (elev / părinte / profesor);
//   · PĂRINTELE alege copilul și plătește pentru contul LUI (api/create-checkout
//     → pentruElev; api/_lib/abonamentCopil.js) — până acum abonamentul se punea
//     pe contul părintelui, iar copilul rămânea pe gratuit;
//   · ELEVUL îi trimite părintelui un link („📲 Trimite părintelui"): părintele
//     îl deschide, se asociază cu contul copilului și îi face abonamentul;
//   · vizitatorul care apasă „Creează cont și continuă" revine aici după
//     înregistrare, cu planul ales (src/lib/continuare.js).
// =====================================================================

const CE_PRIMESTI = {
  elev: [
    ['🤖', 'Profesorul Virtual explică orice exercițiu, pas cu pas'],
    ['✍️', 'Corectarea rezolvărilor scrise de mână, după barem'],
    ['🔴', 'Meditații live zilnice (EN și BAC) și 8 ședințe 1-la-1 pe lună'],
    ['🧭', 'Plan de învățare: test inițial, lecții, teme corectate, simulări'],
    ['📄', 'Toate fișele și subiectele PDF, cu rezolvări'],
  ],
  profesor: [
    ['🧩', 'Generator de teste interactive și PDF, după modelele oficiale'],
    ['📄', 'Subiecte de examen generate, cu barem'],
    ['👥', 'Teste diferite pentru fiecare elev, corectate automat'],
    ['🤖', 'Asistentul AI pentru profesori'],
    ['📚', 'Toate fișele și subiectele PDF, cu rezolvări'],
  ],
};

async function cere(url, body) {
  const response = await fetch(url, { method: 'POST', headers: await authHeaders(), body: JSON.stringify(body) });
  let data;
  try { data = await response.json(); } catch { throw new Error(`Răspuns invalid de la server (status ${response.status})`); }
  if (!response.ok || data.error) throw new Error(data.error || `Eroare server: ${response.status}`);
  return data;
}

export default function Pricing() {
  const { user, isPremium, isSubscribed, isAdmin, isTeacher, isParent } = useAuth();
  const [params] = useSearchParams();
  const [loading, setLoading] = useState(false);
  const [eroare, setEroare] = useState('');
  const [plan, setPlan] = useState(() => (PLANS.some((p) => p.id === params.get('plan')) ? params.get('plan') : 'anual'));
  const navigate = useNavigate();
  const anulat = params.get('anulat') === '1';

  // PĂRINTE: copiii asociați, cu starea abonamentului fiecăruia
  const [copii, setCopii] = useState(null);          // null = se încarcă
  const [copilAles, setCopilAles] = useState(params.get('copil') || null);
  useEffect(() => {
    if (!user || !isParent) return undefined;
    let viu = true;
    cere('/api/create-checkout', { type: 'copii' })
      .then((r) => {
        if (!viu) return;
        const lista = r.copii || [];
        setCopii(lista);
        setCopilAles((ales) => (lista.some((c) => c.id === ales && !c.premium) ? ales : (lista.find((c) => !c.premium) || {}).id || null));
      })
      .catch(() => { if (viu) setCopii([]); });
    return () => { viu = false; };
  }, [user, isParent]);

  // ELEV: linkul pe care îl trimite părintelui
  const [invitatie, setInvitatie] = useState(null);  // { link, text } | { trimis: true }
  const [copiat, setCopiat] = useState(false);

  // planul selectat — prețul lui apare pe butonul de abonare
  const planAles = PLANS.find((p) => p.id === plan) || PLANS[0];
  const lunar = PLANS.find((p) => p.id === 'lunar') || PLANS[0];
  const anual = PLANS.find((p) => p.id === 'anual') || PLANS[0];
  const copil = (copii || []).find((c) => c.id === copilAles) || null;
  const parinte = !!user && isParent;
  const elev = !!user && !isParent && !isTeacher;

  async function handleSubscribe() {
    setEroare('');
    if (!user) {
      // Reținem planul ales: după înregistrare utilizatorul revine exact aici (src/lib/continuare.js)
      tineMintePlanul(planAles.id);
      navigate('/inregistrare');
      return;
    }
    if (parinte && !copil) { setEroare('Alege copilul pentru care faci abonamentul.'); return; }
    trackBeginCheckout(planAles.id, planAles.pret);
    setLoading(true);
    try {
      const data = await cere('/api/create-checkout', { userId: user.id, email: user.email, plan: planAles.id, ...(parinte ? { pentruElev: copil.id } : {}) });
      if (!data.url) throw new Error('Nu s-a primit adresa de plată de la server.');
      window.location.href = data.url;
    } catch (err) {
      console.error('Checkout error:', err);
      setEroare(err.message || 'Plata nu a putut porni. Mai încearcă.');
      setLoading(false);
    }
  }

  async function handleManage(pentruElev = null) {
    if (!user) return;
    setEroare('');
    setLoading(true);
    try {
      const data = await cere('/api/create-portal', { userId: user.id, ...(pentruElev ? { pentruElev } : {}) });
      if (data.url) window.location.href = data.url;
      else setLoading(false);
    } catch (err) {
      console.error('Portal error:', err);
      setEroare(err.message || 'Portalul de plată nu s-a putut deschide. Mai încearcă.');
      setLoading(false);
    }
  }

  async function trimiteParintelui() {
    setEroare('');
    try {
      const d = await cere('/api/asociere', { action: 'invita_parinte' });
      const link = `${window.location.origin}/asociere?elev=${d.token}`;
      const text = `Mă pregătesc la matematică pe ExamenMate. Îmi poți face tu abonamentul (${lunar.pret} lei pe lună sau ${anual.pret} lei pe an)? Intră aici:`;
      track('invita_parinte', {});
      if (navigator.share) {
        try { await navigator.share({ title: 'ExamenMate', text, url: link }); setInvitatie({ link, text, trimis: true }); return; } catch { /* a închis fereastra de trimitere → arătăm linkul */ }
      }
      setInvitatie({ link, text });
    } catch (err) {
      setEroare(err.message || 'Linkul nu s-a putut face. Mai încearcă.');
    }
  }
  function copiaza(text) {
    const gata = () => { setCopiat(true); setTimeout(() => setCopiat(false), 1800); };
    if (navigator.clipboard?.writeText) navigator.clipboard.writeText(text).then(gata).catch(() => {});
  }

  const beneficii = CE_PRIMESTI[isTeacher ? 'profesor' : 'elev'];
  const butonPlata = loading
    ? 'Se deschide plata…'
    : !user
      ? 'Creează cont și continuă'
      : parinte
        ? (copil ? `Abonează-l pe ${copil.nume} · ${planAles.pret} lei ${planAles.perioada}` : 'Alege copilul')
        : `Abonează-te · ${planAles.pret} lei ${planAles.perioada}`;

  return (
    <>
      <div className="page-header" style={{ textAlign: 'center' }}>
        <div className="container">
          <h1>Abonament Premium</h1>
          <p>{parinte ? 'Pentru copilul tău. Plătești tu, primește el.' : 'Renunți oricând, direct din cont.'}</p>
        </div>
      </div>

      <section className="section pret">
        <div className="container pret-in">

          {anulat && !isPremium && (
            <div className="pret-nota" role="status">Plata a fost oprită — nu s-a retras nimic. Poți relua oricând.</div>
          )}
          {eroare && <div className="pret-nota pret-eroare" role="alert">{eroare}</div>}

          {isPremium && !parinte ? (
            <div className="pricing-card">
              <span className="badge badge-premium" style={{ fontSize: '0.85rem', padding: '6px 20px' }}>
                {isSubscribed ? '⭐ Premium' : '🛡️ Administrator'}
              </span>
              <div style={{
                background: '#e8f5e9', color: '#2e7d32', padding: '12px 20px',
                borderRadius: 'var(--radius)', margin: '24px 0 16px', fontWeight: 600,
              }}>
                {isSubscribed ? '✓ Ești abonat Premium' : '✓ Ai acces complet ca administrator, fără abonament'}
              </div>
              {/* Adminul nu are nevoie de abonament: dacă mai are unul activ,
                  îl poate anula de aici, iar accesul rămâne neschimbat. */}
              {isAdmin && isSubscribed && (
                <p style={{ fontSize: '.85rem', color: 'var(--text-light)', lineHeight: 1.5, marginBottom: 16 }}>
                  Contul de administrator are acces la toate funcțiile și fără abonament.
                  Îl poți anula din „Gestionează abonamentul" — accesul tău rămâne neschimbat.
                </p>
              )}
              {isSubscribed && (
                <button className="btn btn-outline" style={{ width: '100%' }} onClick={() => handleManage()} disabled={loading}>
                  {loading ? 'Se încarcă...' : 'Gestionează abonamentul'}
                </button>
              )}
            </div>
          ) : (
            <>
              {/* ── PĂRINTE: pentru cine e abonamentul ───────────────────── */}
              {parinte && (
                <div className="pret-copii">
                  <h2>Pentru cine?</h2>
                  {copii === null && <p className="pret-mic">Se încarcă…</p>}
                  {copii && copii.length === 0 && (
                    <div className="pret-nota">
                      Întâi asociază-te cu contul copilului: trimite-i linkul tău de asociere sau roagă-l să apese
                      „Trimite părintelui" pe pagina lui de abonament.
                      <div style={{ marginTop: 10 }}>
                        <Link to="/profil?asociere=1" className="btn btn-outline btn-sm">Linkul meu de asociere</Link>
                      </div>
                    </div>
                  )}
                  {copii && copii.length > 0 && (
                    <div className="pret-copii-lista" role="radiogroup" aria-label="Copilul">
                      {copii.map((c) => (c.premium ? (
                        <div key={c.id} className="pret-copil are">
                          <span><b>{c.nume}</b><small>⭐ are abonament</small></span>
                          <button type="button" className="btn btn-outline btn-sm" onClick={() => handleManage(c.id)} disabled={loading}>Gestionează</button>
                        </div>
                      ) : (
                        <button key={c.id} type="button" role="radio" aria-checked={copilAles === c.id}
                          className={`pret-copil${copilAles === c.id ? ' ales' : ''}`} onClick={() => setCopilAles(c.id)}>
                          <span className="pret-radio" aria-hidden="true" />
                          <span><b>{c.nume}</b><small>cont gratuit</small></span>
                        </button>
                      )))}
                    </div>
                  )}
                </div>
              )}

              {/* ── Alegerea planului ─────────────────────────────────────── */}
              <div className="pret-planuri" role="radiogroup" aria-label="Planul">
                {PLANS.map((p) => {
                  const activ = plan === p.id;
                  return (
                    <button key={p.id} type="button" role="radio" aria-checked={activ}
                      className={`pret-plan${activ ? ' ales' : ''}`} onClick={() => setPlan(p.id)}>
                      {p.economie && <span className="pret-economie">{p.economie}</span>}
                      <span className="pret-plan-sus"><span className="pret-radio" aria-hidden="true" />{p.eticheta}</span>
                      <span className="pret-suma">{p.pret} lei <small>{p.perioada}</small></span>
                      <span className="pret-plan-sub">{p.subtitlu}</span>
                    </button>
                  );
                })}
              </div>

              {/* ── Plata: imediat sub plan ──────────────────────────────── */}
              <div className="pret-plata">
                <button className="btn btn-primary btn-lg" onClick={handleSubscribe} disabled={loading || (parinte && !copil)}>
                  {butonPlata}
                </button>
                <p className="pret-mic">Plată cu cardul, prin Stripe. Factura vine pe e-mail. Renunți oricând.</p>

                {/* ELEV: abonamentul îl face de obicei părintele — un link de trimis */}
                {elev && (
                  <div className="pret-parinte">
                    {!invitatie && (
                      <button type="button" className="btn btn-outline" onClick={trimiteParintelui}>📲 Trimite părintelui</button>
                    )}
                    {invitatie && (
                      <>
                        <p className="pret-mic" style={{ marginBottom: 8 }}>
                          {invitatie.trimis ? '✓ Trimis. ' : ''}Părintele deschide linkul, își face cont și îți poate face abonamentul. Linkul e valabil 14 zile.
                        </p>
                        <div className="pret-link">
                          <code>{invitatie.link.replace(/^https?:\/\//, '')}</code>
                          <button type="button" onClick={() => copiaza(`${invitatie.text} ${invitatie.link}`)}>{copiat ? '✓ Copiat' : 'Copiază'}</button>
                          <a href={`https://wa.me/?text=${encodeURIComponent(`${invitatie.text} ${invitatie.link}`)}`} target="_blank" rel="noopener noreferrer">WhatsApp</a>
                        </div>
                      </>
                    )}
                    {!invitatie && <p className="pret-mic">Abonamentul îl poate face și părintele tău, din contul lui.</p>}
                  </div>
                )}
              </div>

              {/* ── Ce primești ───────────────────────────────────────────── */}
              <div className="pret-ce">
                <h2>{parinte ? 'Ce primește copilul' : 'Ce primești'}</h2>
                <ul>
                  {beneficii.map(([ic, text]) => (
                    <li key={text}><span aria-hidden="true">{ic}</span>{text}</li>
                  ))}
                </ul>
                <p className="pret-mic">
                  Rămân gratuite: testele interactive, fișele PDF gratuite, testul zilei și Arena.
                  {' '}O oră de meditații costă 70–120 de lei; abonamentul pe un an înseamnă {(anual.pret / 12).toFixed(2).replace('.', ',')} lei pe lună.
                </p>
              </div>
            </>
          )}

          {/* ── Întrebări scurte ───────────────────────────────────────── */}
          {!isPremium && (
            <div className="pret-intrebari">
              <details>
                <summary>Sunt părinte. Cum îi fac abonament copilului?</summary>
                <p>Intri cu contul tău de părinte, alegi copilul și plătești. Abonamentul se activează pe contul lui, iar factura vine la tine. Copilul îți poate trimite un link din pagina lui de abonament („Trimite părintelui").</p>
              </details>
              <details>
                <summary>Pot încerca înainte să plătesc?</summary>
                <p>Da. Testele interactive, testul zilei și Arena sunt gratuite, iar elevul asociat cu un părinte primește gratuit testul inițial, cu nivelul lui și capitolele cu lacune.</p>
              </details>
              <details>
                <summary>Cum renunț?</summary>
                <p>Oricând, cu „Gestionează abonamentul" — din această pagină sau din „Contul meu". Vezi și <Link to="/politica-retur">politica de retur</Link>.</p>
              </details>
            </div>
          )}
        </div>
      </section>
    </>
  );
}
