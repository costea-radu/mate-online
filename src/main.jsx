import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import './styles/global.css';
import { installErrorReporting } from './lib/errorReport';
import { reloadForNewVersion } from './lib/chunkReload';
import { verificaVersiunea } from './lib/versiune';

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
  // o versiune nouă (după un deploy) a preluat pagina. Paginile vin din rețea, deci de
  // obicei pagina rulează deja versiunea nouă și nu se întâmplă nimic; dacă rulează una
  // veche (a venit din precache), se actualizează: acum dacă abia s-a deschis, altfel la
  // următoarea schimbare de pagină (src/lib/versiune.js)
  const hadController = !!navigator.serviceWorker.controller;
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (hadController) verificaVersiunea();
  });
  const register = (retry) => navigator.serviceWorker.register('/sw.js', { scope: '/' })
    .catch(() => { if (retry) setTimeout(() => register(false), 30000); });
  if (document.readyState === 'complete') register(true);
  else window.addEventListener('load', () => register(true), { once: true });
  // site-ul ținut deschis pe telefon (Safari „trezește" tab-ul fără să-l reîncarce): la
  // revenire, cel mult o dată la 10 minute, caută versiunea nouă — o ia la următoarea
  // schimbare de pagină, iar service worker-ul o pregătește pentru următoarea deschidere
  let lastCheck = Date.now();
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState !== 'visible' || Date.now() - lastCheck < 10 * 60000) return;
    lastCheck = Date.now();
    navigator.serviceWorker.getRegistration().then((r) => r && r.update()).catch(() => {});
    verificaVersiunea();
  });
}

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
