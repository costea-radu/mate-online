import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import './styles/global.css';

// După un redeploy, un tab vechi (mai ales pe mobil, la redeschidere) poate cere
// un chunk JS cu hash vechi care nu mai există (404) → pagină albă. Reîncărcăm
// automat O SINGURĂ dată ca să luăm versiunea nouă (marcaj de timp = anti-buclă).
window.addEventListener('vite:preloadError', () => {
  const key = 'mate_chunk_reload';
  try {
    const last = Number(sessionStorage.getItem(key) || 0);
    if (Date.now() - last < 15000) return; // deja am reîncărcat recent → nu bucla
    sessionStorage.setItem(key, String(Date.now()));
  } catch {
    // storage indisponibil (ex. Safari privat) → marcaj în memorie ca să nu buclăm
    if (window.__mateChunkReloaded) return;
    window.__mateChunkReloaded = true;
  }
  window.location.reload();
});

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
