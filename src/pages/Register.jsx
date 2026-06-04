import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';

const DiscordIcon = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="#fff">
    <path d="M20.317 4.37a19.791 19.791 0 0 0-4.885-1.515.074.074 0 0 0-.079.037c-.21.375-.444.864-.608 1.25a18.27 18.27 0 0 0-5.487 0 12.64 12.64 0 0 0-.617-1.25.077.077 0 0 0-.079-.037A19.736 19.736 0 0 0 3.677 4.37a.07.07 0 0 0-.032.027C.533 9.046-.32 13.58.099 18.057a.082.082 0 0 0 .031.057 19.9 19.9 0 0 0 5.993 3.03.078.078 0 0 0 .084-.028c.462-.63.874-1.295 1.226-1.994a.076.076 0 0 0-.041-.106 13.107 13.107 0 0 1-1.872-.892.077.077 0 0 1-.008-.128 10.2 10.2 0 0 0 .372-.292.074.074 0 0 1 .077-.01c3.928 1.793 8.18 1.793 12.062 0a.074.074 0 0 1 .078.01c.12.098.246.198.373.292a.077.077 0 0 1-.006.127 12.299 12.299 0 0 1-1.873.892.077.077 0 0 0-.041.107c.36.698.772 1.362 1.225 1.993a.076.076 0 0 0 .084.028 19.839 19.839 0 0 0 6.002-3.03.077.077 0 0 0 .032-.054c.5-5.177-.838-9.674-3.549-13.66a.061.061 0 0 0-.031-.03zM8.02 15.33c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.956-2.419 2.157-2.419 1.21 0 2.176 1.096 2.157 2.42 0 1.333-.956 2.418-2.157 2.418zm7.975 0c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.955-2.419 2.157-2.419 1.21 0 2.176 1.096 2.157 2.42 0 1.333-.946 2.418-2.157 2.418z"/>
  </svg>
);

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

  const oauthBtnStyle = {
    width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center',
    gap: 10, padding: '10px 16px', border: 'none', borderRadius: 'var(--radius)',
    fontWeight: 600, fontSize: '0.92rem', cursor: 'pointer', marginBottom: 10, transition: 'all 0.2s',
  };

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
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
            {[
              { value: 'elev', icon: '🎒', title: 'Elev', tag: 'doar rezolv' },
              { value: 'profesor', icon: '🧑‍🏫', title: 'Profesor', tag: 'rezolv || corectez' },
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

        {/* Google */}
        <button onClick={handleGoogle} disabled={googleLoading||loading||discordLoading}
          style={{ ...oauthBtnStyle, background:'#fff', color:'var(--text)', border:'1.5px solid var(--border)' }}>
          <svg width="18" height="18" viewBox="0 0 48 48">
            <path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"/>
            <path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"/>
            <path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"/>
            <path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"/>
          </svg>
          {googleLoading ? 'Se redirecționează...' : 'Continuă cu Google'}
        </button>

        {/* Discord */}
        <button onClick={handleDiscord} disabled={discordLoading||loading||googleLoading}
          style={{ ...oauthBtnStyle, background:'#5865F2', color:'#fff' }}>
          <DiscordIcon />
          {discordLoading ? 'Se redirecționează...' : 'Continuă cu Discord'}
        </button>

        <div style={{ display:'flex', alignItems:'center', gap:12, marginBottom:20, marginTop:6, color:'var(--text-muted)', fontSize:'0.85rem' }}>
          <div style={{ flex:1, height:1, background:'var(--border)' }} />sau<div style={{ flex:1, height:1, background:'var(--border)' }} />
        </div>

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
