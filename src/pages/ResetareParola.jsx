// =====================================================================
// src/pages/ResetareParola.jsx — pagina unde aterizează linkul din emailul
// „Resetare parolă" (Supabase Auth). Linkul din email conține un token care
// creează automat o sesiune temporară de recuperare; aici utilizatorul își
// setează parola nouă. IMPORTANT: https://examenmate.com/resetare-parola
// trebuie adăugat în Supabase → Authentication → URL Configuration →
// Redirect URLs (altfel linkul duce doar la pagina principală).
// =====================================================================
import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { supabase } from '../lib/supabase';

export default function ResetareParola() {
  const [checking, setChecking] = useState(true);   // verificăm linkul/sesiunea
  const [ready, setReady] = useState(false);        // avem sesiune → putem seta parola
  const [linkError, setLinkError] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [done, setDone] = useState(false);
  const navigate = useNavigate();

  useEffect(() => {
    // Linkul expirat/deja folosit vine cu #error_description=... în URL.
    const hash = new URLSearchParams(window.location.hash.replace(/^#/, ''));
    if (hash.get('error_description') || hash.get('error')) {
      setLinkError('Linkul de resetare a expirat sau a fost deja folosit. Cere unul nou din pagina de autentificare.');
      setChecking(false);
      return;
    }

    // Clientul Supabase procesează automat tokenul din URL și creează sesiunea.
    // Așteptăm fie sesiunea existentă, fie evenimentul PASSWORD_RECOVERY/SIGNED_IN.
    let settled = false;
    const finish = (ok) => {
      if (settled) return;
      settled = true;
      setReady(ok);
      setChecking(false);
      if (!ok) setLinkError('Nu am găsit o sesiune de resetare validă. Deschide linkul din email pe același dispozitiv, sau cere un link nou.');
    };

    supabase.auth.getSession().then(({ data: { session } }) => { if (session) finish(true); });
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
      if (event === 'PASSWORD_RECOVERY' || (event === 'SIGNED_IN' && session)) finish(true);
    });
    const timer = setTimeout(() => finish(false), 5000);
    return () => { subscription.unsubscribe(); clearTimeout(timer); };
  }, []);

  async function handleSubmit(e) {
    e.preventDefault();
    setError('');
    if (password.length < 6) { setError('Parola trebuie să aibă cel puțin 6 caractere.'); return; }
    if (password !== confirm) { setError('Parolele nu coincid.'); return; }
    setSaving(true);
    try {
      const { error: updErr } = await supabase.auth.updateUser({ password });
      if (updErr) throw updErr;
      setDone(true);
      setTimeout(() => navigate('/profil'), 1800);
    } catch (err) {
      setError(/different from the old|same_password/i.test(err?.message || '')
        ? 'Parola nouă trebuie să fie diferită de cea veche.'
        : (err?.message || 'Nu am putut salva parola. Încearcă din nou.'));
    } finally { setSaving(false); }
  }

  return (
    <div className="auth-page">
      <div className="auth-card">
        <h2>Setează o parolă nouă</h2>
        <p className="auth-sub">Alege o parolă nouă pentru contul tău ExamenMate.</p>

        {checking && (
          <div style={{ display:'flex', justifyContent:'center', padding:24 }}>
            <div className="spinner" />
          </div>
        )}

        {!checking && linkError && (
          <>
            <div style={{ background:'#fce4ec', color:'var(--danger)', padding:'12px 16px', borderRadius:'var(--radius)', marginBottom:20, fontSize:'0.88rem', lineHeight:1.6 }}>
              ⚠️ {linkError}
            </div>
            <Link to="/autentificare" className="btn btn-primary" style={{ width:'100%', textAlign:'center' }}>
              Înapoi la autentificare
            </Link>
          </>
        )}

        {!checking && ready && done && (
          <div style={{ background:'rgba(46,160,67,0.08)', border:'1px solid rgba(46,160,67,0.35)', color:'#1a7f37', padding:'16px 18px', borderRadius:'var(--radius)', fontSize:'0.9rem', lineHeight:1.6 }}>
            ✅ Parola a fost schimbată! Te ducem în contul tău…
          </div>
        )}

        {!checking && ready && !done && (
          <>
            {error && <div style={{ background:'#fce4ec', color:'var(--danger)', padding:'12px 16px', borderRadius:'var(--radius)', marginBottom:20, fontSize:'0.88rem' }}>{error}</div>}
            <form onSubmit={handleSubmit}>
              <div className="form-group">
                <label htmlFor="new-password">Parola nouă</label>
                <div style={{ position:'relative' }}>
                  <input id="new-password" type={showPassword ? 'text' : 'password'} value={password}
                    onChange={e => setPassword(e.target.value)} placeholder="••••••••" required minLength={6}
                    autoComplete="new-password" style={{ paddingRight:44 }} autoFocus />
                  <button type="button" onClick={() => setShowPassword(v => !v)} tabIndex={-1}
                    style={{ position:'absolute', right:12, top:'50%', transform:'translateY(-50%)', background:'none', border:'none', cursor:'pointer', padding:4, color:'var(--text-muted)', display:'flex', alignItems:'center' }}>
                    {showPassword ? (
                      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94"/><path d="M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19"/><line x1="1" y1="1" x2="23" y2="23"/></svg>
                    ) : (
                      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>
                    )}
                  </button>
                </div>
              </div>
              <div className="form-group">
                <label htmlFor="confirm-password">Repetă parola nouă</label>
                <input id="confirm-password" type={showPassword ? 'text' : 'password'} value={confirm}
                  onChange={e => setConfirm(e.target.value)} placeholder="••••••••" required minLength={6}
                  autoComplete="new-password" />
              </div>
              <button type="submit" className="btn btn-primary" style={{ width:'100%', marginTop:8 }} disabled={saving}>
                {saving ? 'Se salvează...' : 'Salvează parola nouă'}
              </button>
            </form>
          </>
        )}
      </div>
    </div>
  );
}
