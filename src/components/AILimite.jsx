// =====================================================================
// src/components/AILimite.jsx — consumul AI al utilizatorului.
//
// Structura (Contul meu → „⚡ Consum AI"):
//   1. CONSUMUL TOTAL — cât din creditele lunii ai folosit, o singură bară.
//   2. COTELE LUNARE — rolldown cu fiecare funcție (corectări, exerciții…),
//      cu mențiunea explicită că se REPORTEAZĂ și se COMPLETEAZĂ ÎNTRE ELE:
//      când una se termină, continui CONTINUU din rezerva celorlalte.
//   3. PACHETELE SUPLIMENTARE — ce primești e scris în CREDITE AI, nu în lei
//      (pachetul de 10 lei = „+400 credite AI"). Conversia: src/lib/aiCredit.js.
//
// Datele vin din /api/ai-progress → câmpul `budget` (vezi GHID_LIMITE_AI.md).
//
// Folosire:
//   <AILimite budget={data.budget} />   — cu datele deja încărcate (ProgressTab)
//   <AILimite />                        — se încarcă singură
//   <AILimite bare />                   — fără card propriu și fără titlu, pentru
//                                         rolldown-ul „⚡ Consum AI" din Contul meu
//                                         (titlul îl dă <summary>-ul de acolo)
// Dacă budget e null (migrarea SQL nerulată): nimic (normal) / o notă scurtă (bare).
// =====================================================================
import { useEffect, useState } from 'react';
import { aiClient } from '../lib/aiClient';
import { fmtCredits, leiToCredits } from '../lib/aiCredit';

const card = { background: '#fff', border: '1px solid var(--border)', borderRadius: 'var(--radius-lg)', padding: 20, marginBottom: 18 };

function Bar({ value, max, color, tall = false }) {
  const pct = max > 0 ? Math.min(100, Math.round((value / max) * 100)) : 0;
  return (
    <div style={{ height: tall ? 12 : 8, background: 'var(--border)', borderRadius: 99, overflow: 'hidden' }}>
      <div style={{ height: '100%', width: `${pct}%`, background: color || (pct >= 100 ? '#e74c3c' : pct >= 75 ? '#e8b931' : '#27ae60'), borderRadius: 99, transition: 'width .4s' }} />
    </div>
  );
}

export default function AILimite({ budget: budgetProp = undefined, bare = false }) {
  const selfLoad = budgetProp === undefined;
  const [budget, setBudget] = useState(selfLoad ? null : budgetProp);
  const [loading, setLoading] = useState(selfLoad);
  const [buying, setBuying] = useState(null);
  const [error, setError] = useState(null);
  const [notice, setNotice] = useState(null);
  // cotele lunare stau pliate: privirea cade întâi pe consumul TOTAL
  const [quotasOpen, setQuotasOpen] = useState(() => {
    try { return localStorage.getItem('ai_quotas_open') === '1'; } catch { return false; }
  });
  function toggleQuotas() {
    setQuotasOpen((o) => {
      const next = !o;
      try { localStorage.setItem('ai_quotas_open', next ? '1' : '0'); } catch { /* ignore */ }
      return next;
    });
  }

  useEffect(() => {
    if (!selfLoad) { setBudget(budgetProp); return; }
    aiClient.progress()
      .then((d) => setBudget(d.budget || null))
      .catch(() => setBudget(null))
      .finally(() => setLoading(false));
  }, [selfLoad, budgetProp]);

  // feedback după întoarcerea de la Stripe (?topup=succes / ?topup=anulat)
  useEffect(() => {
    const p = new URLSearchParams(window.location.search).get('topup');
    if (p === 'succes') setNotice('🎉 Mulțumim! Creditele se activează în câteva secunde, imediat ce plata e confirmată — reîncarcă pagina dacă nu le vezi încă.');
    else if (p === 'anulat') setNotice('Plata a fost anulată — nu s-a încasat nimic.');
  }, []);

  if (loading) return bare ? <div style={{ padding: 10, textAlign: 'center' }}><div className="spinner" /></div> : null;
  if (!budget) {
    // limitele nu sunt activate (migrarea SQL nerulată): în rolldown lăsăm o
    // notă scurtă (altfel secțiunea ar părea goală); în rest nu afișăm nimic
    return bare
      ? <p style={{ color: 'var(--text-muted)', fontSize: '.88rem' }}>Statisticile de consum AI nu sunt disponibile momentan.</p>
      : null;
  }

  const lim = budget.limits || {};
  const monthMax = budget.effectiveMonthLei || lim.monthLei || 0;
  const monthPct = monthMax > 0 ? Math.min(100, Math.round((budget.monthLei / monthMax) * 100)) : 0;
  const packs = budget.packs || [];
  const features = (budget.features || []).filter((f) => f.limitMonth || f.limitDay);
  const monthlyFeatures = features.filter((f) => f.window === 'month' || (f.limitMonth && !f.limitDay));
  const nearLimit = monthMax > 0 && monthPct >= 75;

  // creditele: cifrele pe care le vede utilizatorul (100 credite = 1 leu buget)
  const creditsTotal = budget.creditsTotal != null ? budget.creditsTotal : leiToCredits(monthMax);
  const creditsUsed = budget.creditsUsed != null ? budget.creditsUsed : leiToCredits(budget.monthLei);
  const creditsLeft = Math.max(0, creditsTotal - creditsUsed);
  const nrRo = (n) => Number(n || 0).toLocaleString('ro-RO');

  async function buy(packId) {
    setBuying(packId); setError(null);
    try {
      const { url } = await aiClient.topupCheckout(packId);
      if (!url) throw new Error('Nu s-a primit URL de plată de la server.');
      window.location.href = url;
    } catch (e) {
      setError(e.message);
      setBuying(null);
    }
  }

  return (
    <div style={bare ? undefined : card}>
      {!bare && <h3 style={{ fontFamily: 'var(--font-display)', color: 'var(--navy)', marginBottom: 4 }}>⚡ Consumul tău AI</h3>}
      <p style={{ color: 'var(--text-muted)', fontSize: '.82rem', marginBottom: 14 }}>
        Abonamentul include un pachet generos de <strong>credite AI</strong> pentru Profesorul Virtual, reîmprospătate continuu
        (fereastră de 30 de zile).
        {budget.exempt ? ' (Cont de administrator — fără limite.)' : ''}
      </p>

      {notice && (
        <div style={{ background: '#e8f5e9', color: '#2e7d32', padding: '10px 14px', borderRadius: 10, fontSize: '.88rem', marginBottom: 14, fontWeight: 600 }}>
          {notice}
        </div>
      )}

      {/* ── 1. CONSUMUL TOTAL ────────────────────────────────────────────── */}
      {monthMax > 0 && !budget.exempt && (
        <div style={{ marginBottom: 16, background: '#f7f9fc', border: '1px solid var(--border)', borderRadius: 12, padding: '14px 16px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 10, flexWrap: 'wrap', marginBottom: 8 }}>
            <span style={{ fontWeight: 800, color: 'var(--navy)', fontSize: '.95rem' }}>Consumul AI total</span>
            <span style={{ color: 'var(--text-muted)', fontSize: '.85rem' }}>
              {monthPct}% · {budget.monthActions} acțiuni
            </span>
          </div>
          <Bar tall value={budget.monthLei} max={monthMax} />
          <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10, flexWrap: 'wrap', marginTop: 7, fontSize: '.85rem' }}>
            <span style={{ color: 'var(--text-muted)' }}>
              Folosite: <strong style={{ color: 'var(--navy)' }}>{nrRo(creditsUsed)}</strong> din {nrRo(creditsTotal)} credite
            </span>
            <span style={{ color: creditsLeft > 0 ? '#1e7e34' : '#e74c3c', fontWeight: 700 }}>
              {creditsLeft > 0 ? `Îți mai rămân ${nrRo(creditsLeft)} credite` : 'Creditele lunii s-au terminat'}
            </span>
          </div>
          {budget.topup?.creditLei > 0 && (
            <div style={{ fontSize: '.78rem', color: '#27ae60', marginTop: 6, fontWeight: 600 }}>
              ✓ Pachet suplimentar activ: +{fmtCredits(budget.topup.creditLei)} credite AI
              {budget.topup.expiresAt ? ` (până pe ${new Date(budget.topup.expiresAt).toLocaleDateString('ro-RO')})` : ''}
            </div>
          )}
          {budget.degraded && (
            <div style={{ fontSize: '.78rem', color: '#b8860b', marginTop: 6 }}>
              ⚡ Azi ai folosit AI-ul intens — până la miezul nopții răspunsurile vin de la modelul rapid.
            </div>
          )}
        </div>
      )}

      {/* ── 2. COTELE LUNARE (rolldown) ──────────────────────────────────── */}
      {features.length > 0 && !budget.exempt && (
        <div style={{ marginBottom: packs.length ? 16 : 0, border: '1px solid var(--border)', borderRadius: 12, overflow: 'hidden' }}>
          <button type="button" onClick={toggleQuotas} aria-expanded={quotasOpen}
            title={quotasOpen ? 'Închide cotele lunare' : 'Vezi cotele lunare, pe funcții'}
            style={{
              display: 'flex', alignItems: 'center', gap: 9, width: '100%', textAlign: 'left',
              background: '#fff', border: 'none', padding: '11px 14px', cursor: 'pointer',
            }}>
            <span aria-hidden="true" style={{
              display: 'inline-block', fontSize: '.72rem', color: 'var(--gold, #e8b931)', flexShrink: 0,
              transform: quotasOpen ? 'rotate(90deg)' : 'none', transition: 'transform .15s',
            }}>▶</span>
            <span style={{ fontWeight: 700, color: 'var(--navy)', fontSize: '.9rem' }}>Cotele lunare, pe funcții</span>
            <span style={{ fontSize: '.72rem', color: 'var(--text-muted)', fontWeight: 400 }}>
              — {features.length} {features.length === 1 ? 'funcție' : 'funcții'} · se completează între ele
            </span>
          </button>

          <div style={{ display: quotasOpen ? 'block' : 'none', padding: '4px 14px 14px', borderTop: '1px solid var(--border)' }}>
            {/* mențiunea explicită: cotele NU se pierd și NU te opresc una câte una */}
            {monthlyFeatures.length > 0 && (
              <div style={{
                background: 'rgba(232,185,49,.10)', border: '1px solid rgba(232,185,49,.45)', borderRadius: 10,
                padding: '9px 12px', margin: '12px 0 14px', fontSize: '.8rem', color: '#7a611a', lineHeight: 1.55,
              }}>
                🔄 <strong>Cotele lunare se reportează și se completează între ele.</strong> Ce nu folosești la o funcție
                nu se pierde: rămâne în rezerva comună. Când o cotă se termină, <strong>continui neîntrerupt din rezerva
                celorlalte</strong>, până la epuizarea creditelor lunii — nu ești oprit cotă cu cotă.
              </div>
            )}

            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              {features.map((f) => {
                const isDay = f.window === 'day' || (!f.limitMonth && f.limitDay);
                const max = isDay ? f.limitDay : f.limitMonth;
                const shown = isDay ? f.usedDay : (f.effUsedMonth != null ? f.effUsedMonth : f.usedMonth);
                const borrowedIn = (f.borrowedIn || []).reduce((s, b) => s + b.n, 0);
                const label = isDay
                  ? `${f.usedDay}/${max} azi`
                  : borrowedIn > 0
                  ? `${max}/${max} +${borrowedIn} din rezervă · luna aceasta`
                  : `${shown}/${max} luna aceasta`;
                return (
                  <div key={f.key}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '.85rem', marginBottom: 4, gap: 8 }}>
                      <span style={{ fontWeight: 600, color: 'var(--navy)' }}>{f.emoji} {f.label}</span>
                      <span style={{ color: shown >= max ? '#e74c3c' : 'var(--text-muted)', textAlign: 'right' }}>{label}</span>
                    </div>
                    <Bar value={Math.min(shown, max)} max={max} />
                    {(f.borrowedOut || []).length > 0 && (
                      <div style={{ fontSize: '.75rem', color: '#b8860b', marginTop: 3 }}>
                        ↪ {f.borrowedOut.map((b) => `${b.n} completate din rezerva pentru „${b.toLabel || b.to}"`).join(' · ')}
                      </div>
                    )}
                    {isDay && (
                      <div style={{ fontSize: '.72rem', color: 'var(--text-muted)', marginTop: 3 }}>
                        Cotă zilnică — se resetează la miezul nopții (nu se reportează).
                      </div>
                    )}
                  </div>
                );
              })}
            </div>

            {budget.topup?.active && (
              <div style={{ fontSize: '.78rem', color: '#27ae60', fontWeight: 600, marginTop: 12 }}>
                ✓ Cu pachetul activ, cotele de mai sus nu te opresc — le poți depăși cât timp mai ai credite.
              </div>
            )}
          </div>
        </div>
      )}

      {/* ── 3. PACHETE SUPLIMENTARE (în CREDITE, nu în lei) ──────────────── */}
      {packs.length > 0 && !budget.exempt && (
        <div style={{ borderTop: '1px dashed var(--border)', paddingTop: 14 }}>
          <div style={{ fontWeight: 700, color: 'var(--navy)', fontSize: '.9rem', marginBottom: 4 }}>
            {nearLimit ? 'Se apropie limita? Continuă fără pauză:' : 'Ai nevoie de mai mult într-o lună anume?'}
          </div>
          <p style={{ color: 'var(--text-muted)', fontSize: '.8rem', marginBottom: 10 }}>
            Un pachet adaugă <strong>credite AI</strong> peste cele incluse în abonament, valabile {budget.topup?.days || 30} de zile —
            plată unică, fără abonament în plus.
          </p>
          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
            {packs.map((p) => (
              <button key={p.id} onClick={() => buy(p.id)} disabled={!!buying}
                className="btn btn-outline"
                style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-start', gap: 2, padding: '10px 16px', cursor: buying ? 'wait' : 'pointer' }}>
                <span style={{ fontWeight: 800 }}>
                  {p.nume} — <span style={{ color: '#1e7e34' }}>+{p.credits != null ? nrRo(p.credits) : fmtCredits(p.creditLei)} credite AI</span>
                </span>
                <span style={{ fontSize: '.75rem', color: 'var(--text-muted)' }}>
                  {buying === p.id ? 'Se deschide plata…' : `${p.pretLei} lei · toate cotele deblocate`}
                </span>
              </button>
            ))}
          </div>
          {error && <div style={{ color: '#b71c1c', fontSize: '.82rem', marginTop: 10 }}>⚠️ {error}</div>}
        </div>
      )}
    </div>
  );
}
