import { useEffect, useRef } from 'react';
import { useLocation } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';

// Generează un session ID persistent per tab
function getSessionId() {
  let sid = sessionStorage.getItem('mate_sid');
  if (!sid) {
    sid = Math.random().toString(36).slice(2) + Date.now().toString(36);
    sessionStorage.setItem('mate_sid', sid);
  }
  return sid;
}

export function useAnalytics() {
  const location = useLocation();
  const { user } = useAuth();
  const lastPage = useRef('');

  useEffect(() => {
    const page = location.pathname;
    if (page === lastPage.current) return;
    lastPage.current = page;

    // Fire and forget — nu blocăm UI
    fetch('/api/analytics', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action: 'track',
        page,
        userId: user?.id || null,
        sessionId: getSessionId(),
      }),
    }).catch(() => {}); // Ignorăm erorile silențios
  }, [location.pathname, user?.id]);
}
