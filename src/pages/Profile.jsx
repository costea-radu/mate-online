import { useEffect, useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { supabase } from '../lib/supabase';

export default function Profile() {
  const { user, profile, isPremium, signOut, loading, fetchProfile } = useAuth();
  const navigate = useNavigate();
  const [checkoutSuccess, setCheckoutSuccess] = useState(false);
  const [deleteLoading, setDeleteLoading] = useState(false);
  const [deleteError, setDeleteError] = useState('');

  useEffect(() => {
    if (!loading && !user) {
      navigate('/autentificare');
    }
  }, [user, loading, navigate]);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get('session_id') && user) {
      setCheckoutSuccess(true);
      window.history.replaceState({}, '', '/profil');
      fetchProfile(user.id);
    }
  }, [user, fetchProfile]);

  if (loading) {
    return (
      <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', minHeight: '60vh' }}>
        <div className="spinner" />
      </div>
    );
  }

  if (!user) {
    return null;
  }

  const avatarUrl = user.user_metadata?.avatar_url || user.user_metadata?.picture || null;
  const displayName = profile?.full_name
    || user.user_metadata?.name
    || user.user_metadata?.full_name
    || 'Utilizator';
  const initials = displayName === 'Utilizator'
    ? (user.email?.[0] || '?').toUpperCase()
    : displayName.split(' ').map(w => w[0]).join('').toUpperCase().slice(0, 2);

  async function handleManageSubscription() {
    try {
      const response = await fetch('/api/create-portal', {
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

  async function handleDeleteAccount() {
    const confirmed = window.confirm(
      'Ești sigur că vrei să îți ștergi contul? Această acțiune este ireversibilă.'
    );
    if (!confirmed) return;
    const doubleConfirmed = window.confirm(
      'Ultima confirmare: contul și toate datele vor fi șterse permanent. Continui?'
    );
    if (!doubleConfirmed) return;

    setDeleteLoading(true);
    setDeleteError('');
    try {
      const { error } = await supabase.rpc('delete_user_account');
      if (error) throw error;
      await signOut();
      navigate('/');
    } catch (err) {
      console.error('Delete account error:', err);
      setDeleteError('A apărut o eroare. Contactează suportul la costea.radu.ioan@gmail.com.');
      setDeleteLoading(false);
    }
  }

  return (
    <section className="profile-section">
      <div className="container">

        {checkoutSuccess && (
          <div style={{
            background: '#e8f5e9',
            color: '#2e7d32',
            padding: '16px 24px',
            borderRadius: 'var(--radius)',
            marginBottom: 24,
            display: 'flex',
            alignItems: 'center',
            gap: 12,
            fontWeight: 500
          }}>
            <span style={{ fontSize: '1.3rem' }}>🎉</span>
            <span>Abonamentul tău Premium a fost activat! Acum ai acces complet la toate materialele.</span>
          </div>
        )}

        <div className="profile-grid">
          {/* Sidebar */}
          <div className="profile-sidebar">
            <div className="card">
              {avatarUrl ? (
                <img
                  src={avatarUrl}
                  alt="Avatar"
                  className="profile-avatar"
                  style={{ objectFit: 'cover', padding: 0 }}
                  onError={e => { e.currentTarget.style.display = 'none'; e.currentTarget.nextSibling.style.display = 'flex'; }}
                />
              ) : null}
              <div className="profile-avatar" style={{ display: avatarUrl ? 'none' : 'flex' }}>{initials}</div>
              <h3 style={{ fontFamily: 'var(--font-display)', marginBottom: 4 }}>
                {displayName}
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
                      <span style={{ fontSize: '0.85rem', opacity: 0.8 }}>Ai acces complet la toate materialele</span>
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
                    Vezi abonamentul
                  </Link>
                </div>
              )}
            </div>

            {/* Quick links */}
            <div className="card">
              <h3 style={{ fontFamily: 'var(--font-display)', marginBottom: 16 }}>Accesează materialele</h3>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: 12 }}>
                {[
                  { to: '/evaluare-nationala', label: 'Evaluare Națională', icon: '📝' },
                  { to: '/bacalaureat', label: 'Bacalaureat', icon: '🎓' },
                  { to: '/clase/5',  label: 'Clasa a V-a',    icon: '5️⃣' },
                  { to: '/clase/6',  label: 'Clasa a VI-a',   icon: '6️⃣' },
                  { to: '/clase/7',  label: 'Clasa a VII-a',  icon: '7️⃣' },
                  { to: '/clase/8',  label: 'Clasa a VIII-a', icon: '8️⃣' },
                  { to: '/clase/9',  label: 'Clasa a IX-a',   icon: '9️⃣' },
                  { to: '/clase/10', label: 'Clasa a X-a',    icon: '🔟' },
                  { to: '/clase/11', label: 'Clasa a XI-a',   icon: '📘' },
                  { to: '/clase/12', label: 'Clasa a XII-a',  icon: '📗' },
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
            <div style={{ marginTop: 24, display: 'flex', flexDirection: 'column', gap: 12 }}>
              <button className="btn btn-outline btn-sm" onClick={handleSignOut}>
                Deconectare
              </button>
              <div style={{ borderTop: '1px solid var(--border)', paddingTop: 16 }}>
                <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)', marginBottom: 10 }}>
                  <strong style={{ color: 'var(--danger)' }}>Zonă periculoasă</strong>
                </div>
                {deleteError && (
                  <div style={{ background: '#fce4ec', color: 'var(--danger)', padding: '10px 14px', borderRadius: 8, fontSize: '0.83rem', marginBottom: 10 }}>
                    {deleteError}
                  </div>
                )}
                <button
                  onClick={handleDeleteAccount}
                  disabled={deleteLoading}
                  style={{
                    padding: '8px 18px', borderRadius: 8, fontWeight: 600, fontSize: '0.85rem',
                    background: 'transparent', color: 'var(--danger)',
                    border: '1.5px solid var(--danger)', cursor: 'pointer',
                    opacity: deleteLoading ? 0.6 : 1,
                  }}
                >
                  {deleteLoading ? 'Se șterge...' : '🗑 Șterge contul'}
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
