import { authHeaders } from '../lib/api';
import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { AI_STACK } from '../lib/aiModels';
import AIPoweredBy from '../components/AIPoweredBy';
import { trackBeginCheckout } from '../lib/analytics';

// Planurile afișate. Prețurile REALE se stabilesc pe server
// (api/create-checkout.js — PRICE_MONTHLY_LEI / PRICE_ANNUAL_LEI);
// aici sunt doar pentru afișare, ca să nu depindă pagina de un apel în plus.
const PLANS = [
  {
    id: 'lunar',
    eticheta: 'Lunar',
    pret: 50,
    perioada: 'pe lună',
    subtitlu: 'Plătești lună de lună. Renunți când vrei.',
  },
  {
    id: 'anual',
    eticheta: 'Anual',
    pret: 500,
    perioada: 'pe an',
    subtitlu: 'Plătești 10 luni, primești 12. Adică 41,67 lei pe lună.',
    economie: '2 luni cadou',
    recomandat: true,
  },
];

const TRIAL_ZILE = 2;

export default function Pricing() {
  const { user, isPremium } = useAuth();
  const [loading, setLoading] = useState(false);
  const [plan, setPlan] = useState('anual');
  const navigate = useNavigate();

  async function handleSubscribe() {
    const ales = PLANS.find((p) => p.id === plan) || PLANS[0];
    if (!user) {
      // Reținem planul ales, ca după înregistrare să revină exact aici.
      try { sessionStorage.setItem('em_plan', ales.id); } catch { /* mod privat */ }
      navigate('/inregistrare');
      return;
    }

    trackBeginCheckout(ales.id, ales.pret);
    setLoading(true);
    try {
      const response = await fetch('/api/create-checkout', {
        method: 'POST',
        headers: await authHeaders(),
        body: JSON.stringify({ userId: user.id, email: user.email, plan: ales.id }),
      });

      let data;
      try {
        data = await response.json();
      } catch {
        throw new Error(`Răspuns invalid de la server (status ${response.status})`);
      }

      if (!response.ok || data.error) {
        throw new Error(data.error || `Eroare server: ${response.status}`);
      }

      if (data.url) {
        window.location.href = data.url;
      } else {
        throw new Error('Nu s-a primit URL de plată de la server.');
      }
    } catch (err) {
      console.error('Checkout error:', err);
      alert(`A apărut o eroare: ${err.message}`);
    } finally {
      setLoading(false);
    }
  }

  async function handleManage() {
    if (!user) return;
    setLoading(true);
    try {
      const response = await fetch('/api/create-portal', {
        method: 'POST',
        headers: await authHeaders(),
        body: JSON.stringify({ userId: user.id }),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || `Server error: ${response.status}`);
      }

      if (data.error) throw new Error(data.error);
      if (data.url) window.location.href = data.url;
    } catch (err) {
      console.error('Portal error:', err);
      alert('A apărut o eroare la deschiderea portalului. Încearcă din nou.');
    } finally {
      setLoading(false);
    }
  }

  return (
    <>
      <div className="page-header" style={{ textAlign: 'center' }}>
        <div className="container">
          <h1>Abonament Premium</h1>
          <p>Acces complet la toate materialele ExamenMate. Poți anula oricând abonamentul</p>
        </div>
      </div>

      <section className="section">
        <div className="container">

          {isPremium ? (
            <div className="pricing-card">
              <span className="badge badge-premium" style={{ fontSize: '0.85rem', padding: '6px 20px' }}>
                ⭐ Premium
              </span>
              <div style={{
                background: '#e8f5e9', color: '#2e7d32', padding: '12px 20px',
                borderRadius: 'var(--radius)', margin: '24px 0 16px', fontWeight: 600,
              }}>
                ✓ Ești abonat Premium
              </div>
              <button className="btn btn-outline" style={{ width: '100%' }} onClick={handleManage} disabled={loading}>
                {loading ? 'Se încarcă...' : 'Gestionează abonamentul'}
              </button>
            </div>
          ) : (
            <>
              {/* ── Alegerea planului ─────────────────────────────────────── */}
              <div style={{
                display: 'grid', gap: 16, maxWidth: 720, margin: '0 auto 28px',
                gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))',
              }}>
                {PLANS.map((p) => {
                  const activ = plan === p.id;
                  return (
                    <button
                      key={p.id}
                      type="button"
                      onClick={() => setPlan(p.id)}
                      aria-pressed={activ}
                      style={{
                        position: 'relative', textAlign: 'left', cursor: 'pointer',
                        background: 'var(--white)',
                        border: activ ? '2px solid var(--gold)' : '2px solid var(--border)',
                        borderRadius: 'var(--radius-lg)',
                        padding: '26px 24px 22px',
                        boxShadow: activ ? 'var(--shadow-gold)' : 'var(--shadow-sm)',
                        transition: 'border-color .18s ease, box-shadow .18s ease',
                        font: 'inherit', color: 'inherit', width: '100%',
                      }}
                    >
                      {p.economie && (
                        <span style={{
                          position: 'absolute', top: -12, right: 18,
                          background: 'var(--gold)', color: 'var(--navy)',
                          fontSize: '.72rem', fontWeight: 800, letterSpacing: '.04em',
                          padding: '4px 12px', borderRadius: 999, textTransform: 'uppercase',
                        }}>
                          {p.economie}
                        </span>
                      )}

                      <div style={{ display: 'flex', alignItems: 'center', gap: 9, marginBottom: 10 }}>
                        <span aria-hidden="true" style={{
                          width: 18, height: 18, borderRadius: '50%', flexShrink: 0,
                          border: activ ? '5px solid var(--gold)' : '2px solid var(--border)',
                          background: 'var(--white)', display: 'inline-block',
                        }} />
                        <span style={{ fontWeight: 700, color: 'var(--navy)' }}>{p.eticheta}</span>
                      </div>

                      <div style={{
                        fontFamily: 'var(--font-display)', fontSize: '2.3rem',
                        fontWeight: 800, color: 'var(--navy)', lineHeight: 1.05,
                      }}>
                        {p.pret} lei
                      </div>
                      <div style={{ color: 'var(--text-muted)', fontSize: '.86rem', marginBottom: 10 }}>
                        {p.perioada}
                      </div>
                      <div style={{ fontSize: '.88rem', color: 'var(--text-light)', lineHeight: 1.5 }}>
                        {p.subtitlu}
                      </div>
                    </button>
                  );
                })}
              </div>

              {/* ── Ce include ────────────────────────────────────────────── */}
              <div className="pricing-card" style={{ maxWidth: 560 }}>
                <span className="badge badge-premium" style={{ fontSize: '0.85rem', padding: '6px 20px' }}>
                  ⭐ Ce primești
                </span>

                <ul className="pricing-features" style={{ marginTop: 22 }}>
                  <li><span className="pricing-check">✓</span> Toate exercițiile și testele PDF (gratuite + premium)</li>
                  <li><span className="pricing-check">✓</span> Exerciții interactive cu feedback</li>
                  <li><span className="pricing-check">✓</span> Meditații cu Profesorul Virtual: test inițial, plan personalizat, lecții, teme corectate și simulări</li>
                  <li><span className="pricing-check">✓</span> Inteligența Artificială - Prof. Virtual ({AI_STACK.clienti.furnizor} {AI_STACK.clienti.modele.join(', ')}): învățare cu AI, generare de teste, exerciții</li>
                  <li><span className="pricing-check">✓</span> Manuale online</li>
                  <li><span className="pricing-check">✓</span> Teste interactive pentru Evaluarea Națională</li>
                  <li><span className="pricing-check">✓</span> Teste interactive pentru Bacalaureat</li>
                  <li><span className="pricing-check">✓</span> Materiale noi adăugate regulat</li>
                  <li><span className="pricing-check">✓</span> Acces complet la toate rezolvările</li>
                  <li><span className="pricing-check">✓</span> Fără angajamente: te poți dezabona oricând, direct din contul tău</li>
                </ul>

                <button
                  className="btn btn-primary btn-lg"
                  style={{ width: '100%' }}
                  onClick={handleSubscribe}
                  disabled={loading}
                >
                  {loading
                    ? 'Se procesează...'
                    : user
                      ? `Începe cu ${TRIAL_ZILE} zile gratuite`
                      : 'Creează cont și începe'}
                </button>

                <p style={{ fontSize: '.8rem', color: 'var(--text-muted)', marginTop: 12, lineHeight: 1.5 }}>
                  Primele {TRIAL_ZILE} zile sunt gratuite. Nu se percepe nimic dacă anulezi până la
                  finalul lor, direct din contul tău. Proba se acordă o singură dată per cont.
                </p>
              </div>

              {/* ── Reper de preț ─────────────────────────────────────────── */}
              <p style={{
                textAlign: 'center', maxWidth: 560, margin: '22px auto 0',
                fontSize: '.9rem', color: 'var(--text-light)', lineHeight: 1.6,
              }}>
                Pentru comparație: o singură oră de meditații costă în 2026 între 70 și 120 de lei.
                Abonamentul anual înseamnă mai puțin decât o oră pe lună — cu meditator disponibil
                în fiecare zi.
              </p>
            </>
          )}

          {/* ── Test inițial gratuit (elev + părinte) ───────────────────── */}
          {!isPremium && (
            <div style={{
              marginTop: 40, padding: '26px 24px', background: 'var(--cream)',
              border: '1px solid var(--cream-dark)', borderRadius: 'var(--radius-lg)',
              maxWidth: 560, marginInline: 'auto', textAlign: 'center',
            }}>
              <h3 style={{ fontFamily: 'var(--font-display)', marginBottom: 8, fontSize: '1.1rem' }}>
                🧭 Vrei să vezi întâi unde stă copilul?
              </h3>
              <p style={{ color: 'var(--text-light)', fontSize: '0.92rem', marginBottom: 14, lineHeight: 1.6 }}>
                <strong>Testul inițial este gratuit</strong> pentru orice elev al cărui cont e asociat
                cu al unui părinte. Primești nivelul, capitolele cu lacune și planul de învățare —
                fără abonament și fără card.
              </p>
              <Link to="/asociere" className="btn btn-outline">Asociază contul cu un părinte →</Link>
            </div>
          )}

          {/* Free tier info */}
          <div style={{
            textAlign: 'center',
            marginTop: 40,
            padding: '32px 24px',
            background: 'var(--white)',
            borderRadius: 'var(--radius-lg)',
            border: '1px solid var(--border)',
            maxWidth: 540,
            marginInline: 'auto',
          }}>
            <h3 style={{ fontFamily: 'var(--font-display)', marginBottom: 8 }}>
              Conținut gratuit
            </h3>
            <p style={{ color: 'var(--text-light)', fontSize: '0.92rem' }}>
              Majoritatea exercițiilor PDF sunt disponibile gratuit, fără abonament.
              Creează un cont pentru acces nelimitat.
            </p>
            {/* Modelele AI din abonament (src/lib/aiModels.js → AI_STACK) */}
            <div style={{ marginTop: 14 }}>
              <AIPoweredBy variant="inline" />
            </div>
          </div>
        </div>
      </section>
    </>
  );
}
