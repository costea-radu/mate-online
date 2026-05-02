import { useState, useEffect } from 'react';

export function useDarkMode() {
  const [dark, setDark] = useState(() => {
    try { return localStorage.getItem('mate_dark') === 'true'; } catch { return false; }
  });

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', dark ? 'dark' : 'light');
    try { localStorage.setItem('mate_dark', dark); } catch {}
  }, [dark]);

  return [dark, setDark];
}
