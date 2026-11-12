// =====================================================================
// src/components/Continuare.jsx — după autentificare, duce utilizatorul înapoi
// la ce începuse: planul ales pe /preturi sau invitația primită de la copil
// (src/lib/continuare.js). Montat o dată, în App.jsx. O singură dată per cont
// și doar după ce contul are tipul ales (pe care îl pune „Contul meu").
// =====================================================================
import { useEffect, useRef } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { undeContinua } from '../lib/continuare';

export default function Continuare() {
  const { user, profile, loading, isSubscribed } = useAuth();
  const navigate = useNavigate();
  const { pathname, search } = useLocation();
  const facut = useRef(null);

  useEffect(() => {
    if (loading || !user?.id || !profile || !profile.role) return;
    if (facut.current === user.id) return;
    facut.current = user.id;
    // întoarcerea de la plată și pagina de asociere își văd singure de drum
    if (pathname.startsWith('/asociere') || new URLSearchParams(search).has('session_id')) return;
    const spre = undeContinua({ areAbonament: !!isSubscribed });
    if (spre) navigate(spre, { replace: true });
  }, [user?.id, profile, loading]); // eslint-disable-line react-hooks/exhaustive-deps

  return null;
}
