import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';

export default function Asociere() {
  const [params] = useSearchParams();
  const code = params.get('cod') || params.get('code') || '';
  const { user, loading, fetchProfile } = useAuth();
  const navigate = useNavigate();
  const [status, setStatus] = useState('working'); // working | success | error | need-auth
  const [teacherName, setTeacherName] = useState('');
  const [mentorRole, setMentorRole] = useState('profesor');
  const [message, setMessage] = useState('');
  const ran = useRef(false);

  useEffect(() => {
    if (loading) return;

    if (!code) {
      setStatus('error');
      setMessage('Link invalid: lipsește codul de asociere.');
      return;
    }

    // Neautentificat: păstrăm codul și trimitem spre autentificare.
    if (!user) {
      try { localStorage.setItem('pending_teacher_code', code); } catch { /* ignore */ }
      setStatus('need-auth');
      return;
    }

    if (ran.current) return;
    ran.current = true;

    (async () => {
      try {
        const res = await fetch('/api/asociere', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ userId: user.id, code }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'A apărut o eroare la asociere.');
        try { localStorage.removeItem('pending_teacher_code'); } catch { /* ignore */ }
        setTeacherName(data.mentor_name || data.teacher_name || 'Profesor');
        setMentorRole(data.mentor_role || 'profesor');
        setStatus('success');
        await fetchProfile(user.id);
      } catch (e) {
        setStatus('error');
        setMessage(e.message || 'A apărut o eroare la asociere.');
      }
    })();
  }, [user, loading, code, fetchProfile]);

  return (
    <div className="auth-page">
      <div className="auth-card" style={{ textAlign: 'center' }}>
        {status === 'working' && (
          <>
            <div className="spinner" style={{ margin: '0 auto 18px' }} />
            <h2>Te asociem cu contul…</h2>
            <p className="auth-sub">Durează doar o clipă.</p>
          </>
        )}

        {status === 'need-auth' && (
          <>
            <div style={{ fontSize: '3rem', marginBottom: 12 }}>🔗</div>
            <h2>Aproape gata!</h2>
            <p className="auth-sub">
              Autentifică-te sau creează-ți un cont. Imediat după aceea vei fi
              asociat automat contului care ți-a trimis acest link.
            </p>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginTop: 18 }}>
              <Link to="/autentificare" className="btn btn-primary" style={{ width: '100%' }}>
                Autentificare
              </Link>
              <Link to="/inregistrare" className="btn btn-outline" style={{ width: '100%' }}>
                Creează cont
              </Link>
            </div>
          </>
        )}

        {status === 'success' && (
          <>
            <div style={{ fontSize: '3rem', marginBottom: 12 }}>✅</div>
            <h2>Asociere reușită!</h2>
            <p className="auth-sub">
              {mentorRole === 'parinte' ? (
                <>Ai fost asociat cu <strong>{teacherName}</strong> (părinte). Acesta îți va putea vedea rezultatele la testele interactive.</>
              ) : (
                <>Ai fost asociat cu <strong>Prof. {teacherName}</strong>. Profesorul îți va putea vedea rezultatele la testele interactive.</>
              )}
            </p>
            <button className="btn btn-primary" style={{ marginTop: 16 }} onClick={() => navigate('/profil')}>
              Mergi la contul meu
            </button>
          </>
        )}

        {status === 'error' && (
          <>
            <div style={{ fontSize: '3rem', marginBottom: 12 }}>⚠️</div>
            <h2>Asocierea nu a reușit</h2>
            <p className="auth-sub">{message}</p>
            <Link to="/profil" className="btn btn-outline" style={{ marginTop: 16 }}>
              Mergi la contul meu
            </Link>
          </>
        )}
      </div>
    </div>
  );
}
