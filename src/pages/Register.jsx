import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import OAuthButtons from '../components/OAuthButtons';

export default function Register() {
  const [fullName, setFullName] = useState('');
  const [accountType, setAccountType] = useState('elev');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [googleLoading, setGoogleLoading] = useState(false);
  const [discordLoading, setDiscordLoading] = useState(false);
  const [success, setSuccess] = useState(false);
  const { signUp, signInWithGoogle, signInWithDiscord } = useAuth();

  // Dacă utilizatorul apasă „Back" din pagina Google/Discord, browserul
  // restaurează pagina din bfcache cu starea veche („Se redirecționează...").
  // Resetăm stările de loading la restaurare, ca butoanele să redevină active.
  useEffect(() => {
    const reset = (e) => {
      if (e.persisted) {
        setGoogleLoading(false);
        setDiscordLoading(false);
        setLoading(false);
      }
    };
    window.addEventListener('pageshow', reset);
    return () => window.removeEventListener('pageshow', reset);
  }, []);

  async function handleSubmit(e) {
    e.preventDefault();
    setError(''); setLoading(true);
    try {
      const data = await signUp(email, password, fullName, accountType);
      if (data?.user && data.user.identities?.length === 0) {
        setError('Acest email este deja înregistrat. Încearcă să te autentifici.');
        return;
      }
      setSuccess(true);
    } catch (err) {
      setError(err.message?.includes('already registered')
        ? 'Acest email este deja înregistrat.'
        : err.message || 'A apărut o eroare. Încearcă din nou.');
    } finally { setLoading(false); }
  }

  function rememberAccountType() {
    try { localStorage.setItem('pending_account_type', accountType); } catch { /* ignore */ }
  }

  async function handleGoogle() {
    setError(''); setGoogleLoading(true); rememberAccountType();
    try { await signInWithGoogle(); }
    catch { setError('Eroare la autentificarea cu Google.'); setGoogleLoading(false); }
  }

  async function handleDiscord() {
    setError(''); setDiscordLoading(true); rememberAccountType();
    try { await signInWithDiscord(); }
    catch { setError('Eroare la autentificarea cu Discord.'); setDiscordLoading(false); }
  }

  if (success) {
    return (
      <div className="auth-page">
        <div className="auth-card" style={{ textAlign: 'center' }}>
          <div style={{ fontSize: '3rem', marginBottom: 16 }}>✉️</div>
          <h2>Verifică-ți emailul</h2>
          <p className="auth-sub">Am trimis un link de confirmare la <strong>{email}</strong>. Apasă pe link pentru a-ți activa contul.</p>
          <Link to="/autentificare" className="btn btn-primary" style={{ marginTop: 16 }}>Mergi la autentificare</Link>
        </div>
      </div>
    );
  }

  return (
    <div className="auth-page">
      <div className="auth-card">
        <h2>Creează un cont gratuit</h2>
        <p className="auth-sub">Înregistrează-te pentru a accesa exerciții gratuite și premium.</p>

        {/* Tip de cont — se aplică atât la înregistrarea cu e-mail, cât și cu Google/Discord */}
        <div style={{ marginBottom: 20 }}>
          <label style={{ display: 'block', fontSize: '0.85rem', fontWeight: 600, color: 'var(--text)', marginBottom: 8 }}>
            Sunt…
          </label>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(120px, 1fr))', gap: 10 }}>
            {[
              { value: 'elev', icon: '🎒', title: 'Elev', tag: 'doar rezolv' },
              { value: 'profesor', icon: '🧑‍🏫', title: 'Profesor', tag: 'rezolv || corectez' },
              { value: 'parinte', icon: '👨‍👩‍👧', title: 'Părinte', tag: 'urmăresc' },
            ].map(opt => {
              const active = accountType === opt.value;
              return (
                <button
                  key={opt.value}
                  type="button"
                  onClick={() => setAccountType(opt.value)}
                  style={{
                    textAlign: 'left', padding: '12px 14px', borderRadius: 'var(--radius)',
                    border: `2px solid ${active ? 'var(--gold)' : 'var(--border)'}`,
                    background: active ? 'rgba(232,185,49,0.08)' : 'var(--white)',
                    cursor: 'pointer', transition: 'all 0.2s',
                  }}
                >
                  <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <span style={{ fontSize: '1.2rem' }}>{opt.icon}</span>
                    <span style={{ fontWeight: 700, color: 'var(--navy)', fontSize: '0.95rem' }}>{opt.title}</span>
                  </span>
                  <span style={{ display: 'block', fontSize: '0.72rem', color: 'var(--text-muted)', marginTop: 4 }}>
                    ({opt.tag})
                  </span>
                </button>
              );
            })}
          </div>
        </div>

        {error && <div style={{ background:'#fce4ec', color:'var(--danger)', padding:'12px 16px', borderRadius:'var(--radius)', marginBottom:20, fontSize:'0.88rem' }}>{error}</div>}

        <OAuthButtons onGoogle={handleGoogle} onDiscord={handleDiscord} googleLoading={googleLoading} discordLoading={discordLoading} busy={loading} />

        <form onSubmit={handleSubmit}>
          <div className="form-group">
            <label htmlFor="fullName">Nume complet</label>
            <input id="fullName" type="text" value={fullName} onChange={e => setFullName(e.target.value)} placeholder="Ion Popescu" required />
          </div>
          <div className="form-group">
            <label htmlFor="email">Email</label>
            <input id="email" type="email" value={email} onChange={e => setEmail(e.target.value)} placeholder="adresa@email.com" required />
          </div>
          <div className="form-group">
            <label htmlFor="password">Parolă</label>
            <div style={{ position:'relative' }}>
              <input id="password" type={showPassword ? 'text' : 'password'} value={password} onChange={e => setPassword(e.target.value)} placeholder="Minim 6 caractere" required minLength={6} style={{ paddingRight:44 }} />
              <button type="button" onClick={() => setShowPassword(v => !v)} style={{ position:'absolute', right:12, top:'50%', transform:'translateY(-50%)', background:'none', border:'none', cursor:'pointer', padding:4, color:'var(--text-muted)', display:'flex', alignItems:'center' }} tabIndex={-1}>
                {showPassword
                  ? <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94"/><path d="M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19"/><line x1="1" y1="1" x2="23" y2="23"/></svg>
                  : <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>
                }
              </button>
            </div>
          </div>
          <button type="submit" className="btn btn-primary" style={{ width:'100%', marginTop:8 }} disabled={loading||googleLoading||discordLoading}>
            {loading ? 'Se creează contul...' : 'Înregistrare'}
          </button>
        </form>

        <div className="auth-footer">
          Ai deja cont? <Link to="/autentificare">Autentifică-te</Link>
        </div>
      </div>
    </div>
  );
}
