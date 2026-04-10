import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';

export default function Pricing() {
  const { user, isPremium } = useAuth();
  const [loading, setLoading] = useState(false);
  const navigate = useNavigate();

  async function handleSubscribe() {
    // Dacă nu e logat, trimite la pagina de înregistrare
    if (!user) {
      navigate('/inregistrare');
      return;
    }

    setLoading(true);
    try {
      const response = await fetch('/.netlify/functions/create-checkout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId: user.id, email: user.email }),
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
      const response = await fetch('/.netlify/functions/create-portal', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
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
          <p>Acces complet la toate materialele Mate-Online</p>
        </div>
      </div>

      <section className="section">
        <div className="container">
          <div className="pricing-card">
            <span className="badge badge-premium" style={{ fontSize: '0.85rem', padding: '6px 20px' }}>
              ⭐ Premium
            </span>
            <div className="pricing-price">50 lei</div>
            <div className="pricing-period">pe lună</div>

            <ul className="pricing-features">
              <li><span className="pricing-check">✓</span> Toate exercițiile PDF (gratuite + premium)</li>
              <li><span className="pricing-check">✓</span> Exerciții interactive cu feedback</li>
              <li><span className="pricing-check">✓</span> Manuale online</li>
              <li><span className="pricing-check">✓</span> Teste Evaluare Națională</li>
              <li><span className="pricing-check">✓</span> Teste Bacalaureat</li>
              <li><span className="pricing-check">✓</span> Materiale noi adăugate regulat</li>
            </ul>

            {isPremium ? (
              <div>
                <div style={{
                  background: '#e8f5e9',
                  color: '#2e7d32',
                  padding: '12px 20px',
                  borderRadius: 'var(--radius)',
                  marginBottom: 16,
                  fontWeight: 600
                }}>
                  ✓ Ești abonat Premium
                </div>
                <button
                  className="btn btn-outline"
                  style={{ width: '100%' }}
                  onClick={handleManage}
                  disabled={loading}
                >
                  {loading ? 'Se încarcă...' : 'Gestionează abonamentul'}
                </button>
              </div>
            ) : (
              <button
                className="btn btn-primary btn-lg"
                style={{ width: '100%' }}
                onClick={handleSubscribe}
                disabled={loading}
              >
                {loading ? 'Se procesează...' : user ? 'Abonează-te acum' : 'Creează cont și abonează-te'}
              </button>
            )}
          </div>

          {/* Free tier info */}
          <div style={{
            textAlign: 'center',
            marginTop: 48,
            padding: '32px 24px',
            background: 'var(--white)',
            borderRadius: 'var(--radius-lg)',
            border: '1px solid var(--border)',
            maxWidth: 540,
            margin: '48px auto 0'
          }}>
            <h3 style={{ fontFamily: 'var(--font-display)', marginBottom: 8 }}>
              Conținut gratuit
            </h3>
            <p style={{ color: 'var(--text-light)', fontSize: '0.92rem' }}>
              Jumătate din exercițiile PDF sunt disponibile gratuit, fără abonament.
              Creează un cont pentru a le accesa.
            </p>
          </div>
        </div>
      </section>
    </>
  );
}
