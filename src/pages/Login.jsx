import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';

export default function Login() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const { signIn } = useAuth();
  const navigate = useNavigate();

  async function handleSubmit(e) {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      await signIn(email, password);
      navigate('/profil');
    } catch (err) {
      if (err.message?.includes('Invalid login')) {
        setError('Email sau parolă incorectă.');
      } else {
        setError('A apărut o eroare. Încearcă din nou.');
      }
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="auth-page">
      <div className="auth-card">
        <h2>Bine ai revenit!</h2>
        <p className="auth-sub">Autentifică-te pentru a accesa contul tău.</p>

        {error && (
          <div style={{
            background: '#fce4ec',
            color: 'var(--danger)',
            padding: '12px 16px',
            borderRadius: 'var(--radius)',
            marginBottom: 20,
            fontSize: '0.88rem'
          }}>
            {error}
          </div>
        )}

        <form onSubmit={handleSubmit}>
          <div className="form-group">
            <label htmlFor="email">Email</label>
            <input
              id="email"
              type="email"
              value={email}
              onChange={e => setEmail(e.target.value)}
              placeholder="adresa@email.com"
              required
            />
          </div>
          <div className="form-group">
            <label htmlFor="password">Parolă</label>
            <input
              id="password"
              type="password"
              value={password}
              onChange={e => setPassword(e.target.value)}
              placeholder="••••••••"
              required
              minLength={6}
            />
          </div>
          <button
            type="submit"
            className="btn btn-primary"
            style={{ width: '100%', marginTop: 8 }}
            disabled={loading}
          >
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
