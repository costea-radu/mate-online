// =====================================================================
// src/components/AILimite.jsx — consumul AI al utilizatorului: cote per
// funcție („Corectări: 3/10 luna aceasta"), bugetul lunar și pachetele
// top-up (Stripe). Datele vin din /api/ai-progress → câmpul `budget`
// (vezi GHID_LIMITE_AI.md).
//
// Folosire:
//   <AILimite budget={data.budget} />   — cu datele deja încărcate (ProgressTab)
//   <AILimite />                        — se încarcă singură (tabul „Consum AI")
// Dacă budget e null (migrarea SQL nerulată), componenta nu afișează nimic.
// =====================================================================
import { useEffect, useState } from 'react';
import { aiClient } from '../lib/aiClient';

const card = { background: '#fff', border: '1px solid var(--border)', borderRadius: 'var(--radius-lg)', padding: 20, marginBottom: 18 };

function Bar({ value, max, color }) {
  const pct = max > 0 ? Math.min(100, Math.round((value / max) * 100)) : 0;
  return (
    <div style={{ height: 8, background: 'var(--border)', borderRadius: 99, overflow: 'hidden' }}>
      <div style={{ height: '100%', width: `${pct}%`, background: color || (pct >= 100 ? '#e74c3c' : pct >= 75 ? '#e8b931' : '#27ae60'), borderRadius: 99, transition: 'width .4s' }} />
    </div>
  );
}

export default function AILimite({ budget: budgetProp = undefined }) {
  const selfLoad = budgetProp === undefined;
  const [budget, setBudget] = useState(selfLoad ? null : budgetProp);
  const [loading, setLoading] = useState(selfLoad);
  const [buying, setBuying] = useState(null);
  const [error, setError] = useState(null);
  const [notice, setNotice] = useState(null);

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
    if (p === 'succes') setNotice('🎉 Mulțumim! Pachetul se activează în câteva secunde, imediat ce plata e confirmată — reîncarcă pagina dacă nu-l vezi încă.');
    else if (p === 'anulat') setNotice('Plata a fost anulată — nu s-a încasat nimic.');
  }, []);

  if (loading) return null;
  if (!budget) return null; // limitele nu sunt activate (migrarea SQL nerulată) → nu afișăm nimic

  const lim = budget.limits || {};
  const monthMax = budget.effectiveMonthLei || lim.monthLei || 0;
  const monthPct = monthMax > 0 ? Math.min(100, Math.round((budget.monthLei / monthMax) * 100)) : 0;
  const packs = budget.packs || [];
  const features = (budget.features || []).filter((f) => f.limitMonth || f.limitDay);
  const nearLimit = monthMax > 0 && monthPct >= 75;

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
    <div style={card}>
      <h3 style={{ fontFamily: 'var(--font-display)', color: 'var(--navy)', marginBottom: 4 }}>⚡ Consumul tău AI</h3>
      <p style={{ color: 'var(--text-muted)', fontSize: '.82rem', marginBottom: 14 }}>
        Abonamentul include o utilizare generoasă a Profesorului Virtual, reîmprospătată continuu (fereastră de 30 de zile).
        {budget.exempt ? ' (Cont de administrator — fără limite.)' : ''}
      </p>

      {notice && (
        <div style={{ background: '#e8f5e9', color: '#2e7d32', padding: '10px 14px', borderRadius: 10, fontSize: '.88rem', marginBottom: 14, fontWeight: 600 }}>
          {notice}
        </div>
      )}

      {/* Bugetul lunar (afișat ca procent — elevul nu are nevoie de lei) */}
      {monthMax > 0 && !budget.exempt && (
        <div style={{ marginBottom: 16 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '.85rem', marginBottom: 4 }}>
            <span style={{ fontWeight: 600, color: 'var(--navy)' }}>Utilizare AI luna aceasta</span>
            <span style={{ color: 'var(--text-muted)' }}>{monthPct}% · {budget.monthActions} acțiuni</span>
          </div>
          <Bar value={budget.monthLei} max={monthMax} />
          {budget.topup?.creditLei > 0 && (
            <div style={{ fontSize: '.78rem', color: '#27ae60', marginTop: 4, fontWeight: 600 }}>
              ✓ Pachet suplimentar activ: +{budget.topup.creditLei} lei buget
              {budget.topup.expiresAt ? ` (până pe ${new Date(budget.topup.expiresAt).toLocaleDateString('ro-RO')})` : ''}
            </div>
          )}
          {budget.degraded && (
            <div style={{ fontSize: '.78rem', color: '#b8860b', marginTop: 4 }}>
              ⚡ Azi ai folosit AI-ul intens — până la miezul nopții răspunsurile vin de la modelul rapid.
            </div>
          )}
        </div>
      )}

      {/* Cotele per funcție */}
      {features.length > 0 && !budget.exempt && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginBottom: packs.length ? 16 : 0 }}>
          {features.map((f) => {
            const day = f.limitDay ? { used: f.usedDay, max: f.limitDay, win: 'azi' } : null;
            const month = f.limitMonth ? { used: f.usedMonth, max: f.limitMonth, win: 'luna aceasta' } : null;
            const main = day || month;
            return (
              <div key={f.key}>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '.85rem', marginBottom: 4 }}>
                  <span style={{ fontWeight: 600, color: 'var(--navy)' }}>{f.emoji} {f.label}</span>
                  <span style={{ color: main.used >= main.max ? '#e74c3c' : 'var(--text-muted)' }}>
                    {main.used}/{main.max} {main.win}
                  </span>
                </div>
                <Bar value={main.used} max={main.max} />
              </div>
            );
          })}
          {budget.topup?.active && (
            <div style={{ fontSize: '.78rem', color: '#27ae60', fontWeight: 600 }}>
              ✓ Cu pachetul activ, cotele de mai sus nu te opresc — le poți depăși cât timp ai buget.
            </div>
          )}
        </div>
      )}

      {/* Pachete suplimentare */}
      {packs.length > 0 && !budget.exempt && (
        <div style={{ borderTop: '1px dashed var(--border)', paddingTop: 14 }}>
          <div style={{ fontWeight: 700, color: 'var(--navy)', fontSize: '.9rem', marginBottom: 4 }}>
            {nearLimit ? 'Se apropie limita? Continuă fără pauză:' : 'Ai nevoie de mai mult într-o lună anume?'}
          </div>
          <p style={{ color: 'var(--text-muted)', fontSize: '.8rem', marginBottom: 10 }}>
            Un pachet adaugă buget AI peste cel inclus, valabil {budget.topup?.days || 30} de zile — plată unică, fără abonament în plus.
          </p>
          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
            {packs.map((p) => (
              <button key={p.id} onClick={() => buy(p.id)} disabled={!!buying}
                className="btn btn-outline"
                style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-start', gap: 2, padding: '10px 16px', cursor: buying ? 'wait' : 'pointer' }}>
                <span style={{ fontWeight: 800 }}>{p.nume} — {p.pretLei} lei</span>
                <span style={{ fontSize: '.75rem', color: 'var(--text-muted)' }}>
                  {buying === p.id ? 'Se deschide plata…' : `+${p.creditLei} lei buget AI · toate cotele deblocate`}
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
