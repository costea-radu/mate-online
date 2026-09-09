import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import OAuthButtons from '../components/OAuthButtons';

export default function Login() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [googleLoading, setGoogleLoading] = useState(false);
  const [discordLoading, setDiscordLoading] = useState(false);
  const [mode, setMode] = useState('login'); // 'login' | 'forgot'
  const [resetSent, setResetSent] = useState(false);
  // Cont creat, dar neconfirmat — Supabase refuză autentificarea cu
  // „Email not confirmed”. Fără tratare separată, utilizatorul vedea doar
  // „A apărut o eroare” și rămânea blocat (mai ales cei fără Gmail, care nu
  // au scurtătura Google). Îi arătăm cauza reală + retrimiterea linkului.
  const [needsConfirm, setNeedsConfirm] = useState(false);
  const [resendLoading, setResendLoading] = useState(false);
  const [resendDone, setResendDone] = useState(false);
  const [cooldown, setCooldown] = useState(0);
  const { signIn, signInWithGoogle, signInWithDiscord, resetPassword, resendConfirmation } = useAuth();
  const navigate = useNavigate();

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

  useEffect(() => {
    if (cooldown <= 0) return undefined;
    const t = setTimeout(() => setCooldown(c => c - 1), 1000);
    return () => clearTimeout(t);
  }, [cooldown]);

  async function handleSubmit(e) {
    e.preventDefault();
    setError('');
    setNeedsConfirm(false);
    setResendDone(false);
    setLoading(true);
    try {
      await signIn(email, password);
      navigate('/profil');
    } catch (err) {
      const msg = err?.message || '';
      const code = err?.code || '';
      if (/email not confirmed/i.test(msg) || code === 'email_not_confirmed') {
        setNeedsConfirm(true);
        setError('Contul există, dar adresa nu e confirmată încă. Deschide linkul din emailul de confirmare — sau cere unul nou mai jos.');
      } else if (/invalid login/i.test(msg)) {
        setError('Email sau parolă incorectă.');
      } else if (/rate limit|too many/i.test(msg)) {
        setError('Prea multe încercări. Așteaptă un minut și reîncearcă.');
      } else {
        setError('A apărut o eroare. Încearcă din nou.');
      }
    } finally { setLoading(false); }
  }

  // Retrimite linkul de confirmare — pentru ORICE adresă de email
  // (yahoo.com, icloud.com, outlook.com, domeniu propriu etc.).
  async function handleResendConfirm() {
    setError(''); setResendDone(false); setResendLoading(true);
    try {
      await resendConfirmation(email);
      setResendDone(true);
      setCooldown(60);
    } catch (err) {
      const msg = err?.message || '';
      if (/rate limit|after \d+ seconds|security purposes|too many/i.test(msg)) {
        setError('Poți cere un email nou o dată pe minut. Așteaptă puțin și reîncearcă.');
        setCooldown(60);
      } else if (/already confirmed|already been confirmed/i.test(msg)) {
        setNeedsConfirm(false);
        setError('Adresa e deja confirmată. Încearcă din nou autentificarea.');
      } else {
        setError('Nu am putut retrimite emailul. Verifică adresa și încearcă din nou.');
      }
    } finally { setResendLoading(false); }
  }

  // „Am uitat parola": trimite pe email linkul de resetare (Supabase Auth).
  // Emailul pleacă de pe adresa configurată la SMTP (admin.examenmate@gmail.com),
  // iar linkul duce la pagina /resetare-parola.
  async function handleForgot(e) {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      await resetPassword(email);
      setResetSent(true);
    } catch (err) {
      setError(/rate limit|60 seconds|security purposes|too many/i.test(err?.message || '')
        ? 'Din motive de securitate, poți cere un nou link doar o dată pe minut. Așteaptă puțin și reîncearcă.'
        : 'Nu am putut trimite emailul. Verifică adresa și încearcă din nou.');
    } finally { setLoading(false); }
  }

  function switchMode(next) {
    setMode(next);
    setError('');
    setResetSent(false);
    setNeedsConfirm(false);
    setResendDone(false);
  }

  async function handleGoogle() {
    setError(''); setGoogleLoading(true);
    try { await signInWithGoogle(); }
    catch { setError('Eroare la autentificarea cu Google.'); setGoogleLoading(false); }
  }

  async function handleDiscord() {
    setError(''); setDiscordLoading(true);
    try { await signInWithDiscord(); }
    catch { setError('Eroare la autentificarea cu Discord.'); setDiscordLoading(false); }
  }

  // ─── Modul „Am uitat parola" ────────────────────────────────────────────────
  if (mode === 'forgot') {
    return (
      <div className="auth-page">
        <div className="auth-card">
          <h2>Resetare parolă</h2>
          <p className="auth-sub">Îți trimitem pe email un link cu care îți setezi o parolă nouă.</p>

          {error && <div style={{ background:'#fce4ec', color:'var(--danger)', padding:'12px 16px', borderRadius:'var(--radius)', marginBottom:20, fontSize:'0.88rem' }}>{error}</div>}

          {resetSent ? (
            <div style={{ background:'rgba(46,160,67,0.08)', border:'1px solid rgba(46,160,67,0.35)', color:'#1a7f37', padding:'16px 18px', borderRadius:'var(--radius)', fontSize:'0.9rem', lineHeight:1.6 }}>
              ✅ Dacă există un cont pentru <strong>{email}</strong>, linkul de resetare e pe drum.
              Verifică inboxul (și folderul Spam). Linkul e valabil o oră.
            </div>
          ) : (
            <form onSubmit={handleForgot}>
              <div className="form-group">
                <label htmlFor="email">Email</label>
                <input id="email" type="email" value={email} onChange={e => setEmail(e.target.value)} placeholder="adresa@email.com" required autoFocus />
              </div>
              <button type="submit" className="btn btn-primary" style={{ width:'100%', marginTop:8 }} disabled={loading}>
                {loading ? 'Se trimite...' : 'Trimite linkul de resetare'}
              </button>
            </form>
          )}

          <div className="auth-footer">
            <button type="button" onClick={() => switchMode('login')}
              style={{ background:'none', border:'none', cursor:'pointer', color:'var(--navy)', fontWeight:600, fontSize:'inherit', fontFamily:'inherit', padding:0 }}>
              ← Înapoi la autentificare
            </button>
          </div>
        </div>
      </div>
    );
  }

  // ─── Modul normal de autentificare ──────────────────────────────────────────
  return (
    <div className="auth-page">
      <div className="auth-card">
        <h2>Bine ai revenit!</h2>
        <p className="auth-sub">Autentifică-te pentru a accesa contul tău.</p>

        {error && <div style={{ background:'#fce4ec', color:'var(--danger)', padding:'12px 16px', borderRadius:'var(--radius)', marginBottom:20, fontSize:'0.88rem' }}>{error}</div>}

        {/* Cont neconfirmat — cauza reală + retrimiterea linkului. Disponibil
            pentru ORICE furnizor de email, nu doar Gmail. */}
        {needsConfirm && (
          <div style={{ border:'2px solid var(--gold)', background:'rgba(232,185,49,0.08)', borderRadius:'var(--radius)', padding:'14px 16px', marginBottom:20 }}>
            <p style={{ margin:'0 0 10px', fontSize:'0.84rem', lineHeight:1.55, color:'var(--text-muted)' }}>
              Caută emailul și în <strong>Spam</strong> / <strong>Nedorite</strong> / <strong>Junk</strong> — la Yahoo, iCloud și Outlook ajunge des acolo.
            </p>
            {resendDone && (
              <div style={{ background:'rgba(46,160,67,0.10)', border:'1px solid rgba(46,160,67,0.35)', color:'#1a7f37', padding:'10px 12px', borderRadius:'var(--radius)', marginBottom:10, fontSize:'0.85rem', lineHeight:1.5 }}>
                ✅ Am retrimis linkul la <strong>{email}</strong>.
              </div>
            )}
            <button
              type="button"
              onClick={handleResendConfirm}
              disabled={resendLoading || cooldown > 0}
              className="btn btn-outline"
              style={{ width:'100%', opacity: (resendLoading || cooldown > 0) ? 0.6 : 1 }}
            >
              {resendLoading
                ? 'Se trimite...'
                : cooldown > 0
                  ? `Poți retrimite în ${cooldown}s`
                  : 'Retrimite emailul de confirmare'}
            </button>
          </div>
        )}

        <OAuthButtons onGoogle={handleGoogle} onDiscord={handleDiscord} googleLoading={googleLoading} discordLoading={discordLoading} busy={loading} />

        <form onSubmit={handleSubmit}>
          <div className="form-group">
            <label htmlFor="email">Email</label>
            <input id="email" type="email" value={email} onChange={e => setEmail(e.target.value)} placeholder="adresa@email.com" required />
          </div>
          <div className="form-group">
            <label htmlFor="password">Parolă</label>
            <div style={{ position:'relative' }}>
              <input id="password" type={showPassword ? 'text' : 'password'} value={password} onChange={e => setPassword(e.target.value)} placeholder="••••••••" required minLength={6} style={{ paddingRight:44 }} />
              <button type="button" onClick={() => setShowPassword(v => !v)} style={{ position:'absolute', right:12, top:'50%', transform:'translateY(-50%)', background:'none', border:'none', cursor:'pointer', padding:4, color:'var(--text-muted)', display:'flex', alignItems:'center' }} tabIndex={-1}>
                {showPassword ? (
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94"/><path d="M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19"/><line x1="1" y1="1" x2="23" y2="23"/></svg>
                ) : (
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>
                )}
              </button>
            </div>
            <div style={{ textAlign:'right', marginTop:6 }}>
              <button type="button" onClick={() => switchMode('forgot')}
                style={{ background:'none', border:'none', cursor:'pointer', color:'var(--text-muted)', fontSize:'0.83rem', fontFamily:'inherit', padding:0, textDecoration:'underline' }}>
                Ai uitat parola?
              </button>
            </div>
          </div>
          <button type="submit" className="btn btn-primary" style={{ width:'100%', marginTop:8 }} disabled={loading||googleLoading||discordLoading}>
            {loading ? 'Se autentifică...' : 'Autentificare'}
          </button>
        </form>

        <div className="auth-footer">
          Nu ai cont? <Link to="/inregistrare">Înregistrează-te</Link>
        </div>
      </div>
    </div>
  );
}
