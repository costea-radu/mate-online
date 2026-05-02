import { useState, useEffect, createContext, useContext, useCallback } from 'react';

const ToastContext = createContext(null);

export function ToastProvider({ children }) {
  const [toasts, setToasts] = useState([]);

  const addToast = useCallback((message, type = 'success', duration = 3000) => {
    const id = Date.now();
    setToasts(prev => [...prev, { id, message, type }]);
    setTimeout(() => setToasts(prev => prev.filter(t => t.id !== id)), duration);
  }, []);

  const colors = { success: '#2e7d32', error: '#c62828', info: 'var(--navy)', warning: '#e65100' };
  const icons  = { success: '✓', error: '✕', info: 'ℹ', warning: '⚠' };

  return (
    <ToastContext.Provider value={{ toast: addToast }}>
      {children}
      <div style={{ position:'fixed', bottom:24, right:24, zIndex:9999, display:'flex', flexDirection:'column', gap:10, pointerEvents:'none' }}>
        {toasts.map(t => (
          <div key={t.id} style={{
            display:'flex', alignItems:'center', gap:10,
            padding:'12px 18px', borderRadius:10,
            background: colors[t.type] || colors.info,
            color:'#fff', fontWeight:600, fontSize:'0.9rem',
            boxShadow:'0 4px 20px rgba(0,0,0,0.2)',
            animation:'slideIn 0.3s ease',
            pointerEvents:'auto', maxWidth:320,
          }}>
            <span style={{ fontSize:'1.1rem' }}>{icons[t.type]}</span>
            {t.message}
          </div>
        ))}
      </div>
      <style>{`@keyframes slideIn { from { opacity:0; transform:translateX(40px); } to { opacity:1; transform:translateX(0); } }`}</style>
    </ToastContext.Provider>
  );
}

export function useToast() {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error('useToast must be inside ToastProvider');
  return ctx;
}
