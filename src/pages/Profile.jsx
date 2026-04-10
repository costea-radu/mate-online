import { useNavigate, Link } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';

export default function Profile() {
  const { user, profile, isPremium, signOut, loading } = useAuth();
  const navigate = useNavigate();

  if (loading) {
    return (
      <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', minHeight: '60vh' }}>
        <div className="spinner" />
      </div>
    );
  }

  if (!user) {
    navigate('/autentificare');
    return null;
  }

  const initials = (profile?.full_name || user.email || '?')
    .split(' ')
    .map(w => w[0])
    .join('')
    .toUpperCase()
    .slice(0, 2);

  async function handleManageSubscription() {
    try {
      const response = await fetch('/.netlify/functions/create-portal', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId: user.id }),
      });

      if (!response.ok) {
        throw new Error(`Server error: ${response.status}`);
      }

      const { url, error } = await response.json();
      if (error) throw new Error(error);
      if (url) window.location.href = url;
    } catch (err) {
      console.error('Portal error:', err);
      alert('A apărut o eroare la deschiderea portalului. Încearcă din nou.');
    }
  }

  async function handleSignOut() {
    await signOut();
    navigate('/');
  }

  return (
    <section className="profile-section">
      <div className="container">
        <div className="profile-grid">
          {/* Sidebar */}
          <div className="profile-sidebar">
            <div className="card">
              <div className="profile-avatar">{initials}</div>
              <h3 style={{ fontFamily: 'var(--font-display)', marginBottom: 4 }}>
                {profile?.full_name || 'Utilizator'}
              </h3>
              <p style={{ color: 'var(--text-muted)', fontSize: '0.88rem' }}>
                {user.email}
              </p>
              <div className={`subscription-badge ${isPremium ? 'premium' : 'free'}`}>
                {isPremium ? '⭐ Premium' : 'Cont gratuit'}
              </div>
            </div>
          </div>

          {/* Main */}
          <div>
            {/* Subscription */}
            <div className="card" style={{ marginBottom: 24 }}>
              <h3 style={{ fontFamily: 'var(--font-display)', marginBottom: 16 }}>Abonament</h3>
              {isPremium ? (
                <div>
                  <div style={{
                    background: '#e8f5e9',
                    color: '#2e7d32',
                    padding: '16px 20px',
                    borderRadius: 'var(--radius)',
                    marginBottom: 16,
                    display: 'flex',
                    alignItems: 'center',
                    gap: 12
                  }}>
                    <span style={{ fontSize: '1.3rem' }}>⭐</span>
                    <div>
                      <strong>Abonament Premium activ</strong>
                      <br />
                      <span style={{ fontSize: '0.85rem', opacity: 0.8 }}>50 lei/lună – acces complet</span>
                    </div>
                  </div>
                  <button className="btn btn-outline btn-sm" onClick={handleManageSubscription}>
                    Gestionează abonamentul
                  </button>
                </div>
              ) : (
                <div>
                  <p style={{ color: 'var(--text-light)', marginBottom: 16 }}>
                    Ai acces doar la exercițiile PDF gratuite. Abonează-te pentru acces complet la toate materialele.
                  </p>
                  <Link to="/preturi" className="btn btn-primary btn-sm">
                    Abonează-te – 50 lei/lună
                  </Link>
                </div>
              )}
            </div>

            {/* Quick links */}
            <div className="card">
              <h3 style={{ fontFamily: 'var(--font-display)', marginBottom: 16 }}>Accesează materialele</h3>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: 12 }}>
                {[
                  { to: '/clase/5', label: 'Clasa a V-a', icon: '5️⃣' },
                  { to: '/clase/6', label: 'Clasa a VI-a', icon: '6️⃣' },
                  { to: '/clase/7', label: 'Clasa a VII-a', icon: '7️⃣' },
                  { to: '/clase/8', label: 'Clasa a VIII-a', icon: '8️⃣' },
                  { to: '/evaluare-nationala', label: 'Evaluare Națională', icon: '📝' },
                  { to: '/bacalaureat', label: 'Bacalaureat', icon: '🎓' },
                  { to: '/manuale', label: 'Manuale Online', icon: '📖' },
                ].map(item => (
                  <Link
                    key={item.to}
                    to={item.to}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 10,
                      padding: '12px 16px',
                      background: 'var(--cream)',
                      borderRadius: 'var(--radius)',
                      fontSize: '0.9rem',
                      fontWeight: 500,
                      transition: 'all 0.2s',
                    }}
                  >
                    <span>{item.icon}</span> {item.label}
                  </Link>
                ))}
              </div>
            </div>

            {/* Logout */}
            <button
              className="btn btn-outline btn-sm"
              style={{ marginTop: 24 }}
              onClick={handleSignOut}
            >
              Deconectare
            </button>
          </div>
        </div>
      </div>
    </section>
  );
}
