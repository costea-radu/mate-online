import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';

export default function Register() {
  const [fullName, setFullName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [success, setSuccess] = useState(false);
  const { signUp } = useAuth();
  const navigate = useNavigate();

  async function handleSubmit(e) {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      await signUp(email, password, fullName);
      setSuccess(true);
    } catch (err) {
      if (err.message?.includes('already registered')) {
        setError('Acest email este deja înregistrat.');
      } else {
        setError(err.message || 'A apărut o eroare. Încearcă din nou.');
      }
    } finally {
      setLoading(false);
    }
  }

  if (success) {
    return (
      <div className="auth-page">
        <div className="auth-card" style={{ textAlign: 'center' }}>
          <div style={{ fontSize: '3rem', marginBottom: 16 }}>✉️</div>
          <h2>Verifică-ți emailul</h2>
          <p className="auth-sub">
            Am trimis un link de confirmare la <strong>{email}</strong>.
            Apasă pe link pentru a-ți activa contul.
          </p>
          <Link to="/autentificare" className="btn btn-primary" style={{ marginTop: 16 }}>
            Mergi la autentificare
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="auth-page">
      <div className="auth-card">
        <h2>Creează un cont</h2>
        <p className="auth-sub">Înregistrează-te pentru a accesa exerciții gratuite și premium.</p>

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
            <label htmlFor="fullName">Nume complet</label>
            <input
              id="fullName"
              type="text"
              value={fullName}
              onChange={e => setFullName(e.target.value)}
              placeholder="Ion Popescu"
              required
            />
          </div>
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
              placeholder="Minim 6 caractere"
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
