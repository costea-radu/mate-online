import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import './styles/global.css';
import { installErrorReporting } from './lib/errorReport';
import { reloadForNewVersion } from './lib/chunkReload';

// erorile JavaScript reale ale vizitatorilor → agentul de debug din Admin (fără date personale)
installErrorReporting();

// După un redeploy, un tab vechi (mai ales pe mobil, la redeschidere) poate cere
// un chunk JS/CSS cu hash vechi care nu mai există → pagină albă. Reîncărcăm
// automat O SINGURĂ dată ca să luăm versiunea nouă (lib/chunkReload.js, anti-buclă).
window.addEventListener('vite:preloadError', () => { reloadForNewVersion(); });

// Service worker-ul (aplicația instalabilă + cache-ul): înregistrat AICI, cu eroarea
// prinsă (vite.config.js → injectRegister: false). În unele browsere — aplicații cu
// browser intern, rețea căzută la încărcare, blocante de conținut — descărcarea /sw.js
// eșuează („An unknown error occurred when fetching the script"); site-ul merge și
// fără el. O singură reîncercare, după 30 de secunde.
if (import.meta.env.PROD && 'serviceWorker' in navigator) {
  const register = (retry) => navigator.serviceWorker.register('/sw.js', { scope: '/' })
    .catch(() => { if (retry) setTimeout(() => register(false), 30000); });
  if (document.readyState === 'complete') register(true);
  else window.addEventListener('load', () => register(true), { once: true });
}

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
