import { useEffect, useState } from 'react';
import { getInstallPrompt, clearInstallPrompt, onInstallChange, isInstalled, markInstalled, isIOS } from '../lib/installPrompt';

// Buton „Instalează aplicația” (PWA).
// Android/desktop: folosește evenimentul beforeinstallprompt (instalare cu 1 tap).
// iOS: Safari nu are prompt nativ → afișăm pași de instalare.
// Nu apare dacă aplicația e deja instalată (rulează standalone, a fost
// instalată cândva — flag memorat — sau getInstalledRelatedApps o confirmă)
// și nici dacă a fost refuzată recent.

const DISMISS_KEY = 'em_install_dismissed_at';
const DISMISS_DAYS = 14;

export default function InstallPrompt() {
  const [deferred, setDeferred] = useState(null);
  const [visible, setVisible] = useState(false);
  const [iosHelp, setIosHelp] = useState(false);
  // Pe ecrane înguste (telefon) butonul plutitor „Prof. Virtual" + eticheta lui
  // ocupă colțul dreapta-jos și se suprapuneau peste butonul „Nu acum" al
  // cardului. Sub 600px ridicăm cardul DEASUPRA zonei butonului plutitor
  // (care are ~82px + eticheta) și îl lăsăm să folosească toată lățimea.
  const [narrow, setNarrow] = useState(() => (typeof window !== 'undefined' ? window.innerWidth < 600 : false));

  useEffect(() => {
    const onResize = () => setNarrow(window.innerWidth < 600);
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  useEffect(() => {
    const dismissedAt = Number(localStorage.getItem(DISMISS_KEY) || 0);
    const recentlyDismissed = Date.now() - dismissedAt < DISMISS_DAYS * 864e5;

    // evenimentul e captat central în lib/installPrompt.js
    const evaluate = () => {
      // deja instalată (chiar dacă aflăm abia acum, prin getInstalledRelatedApps) → ascundem
      if (isInstalled()) { setDeferred(null); setVisible(false); return; }
      const d = getInstallPrompt();
      setDeferred(d);
      if (d) setVisible(!recentlyDismissed);
      else if (!isIOS()) setVisible(false);
    };
    evaluate();
    const off = onInstallChange(evaluate);

    let t;
    if (isIOS() && !isInstalled() && !recentlyDismissed) {
      t = setTimeout(() => { if (!isInstalled()) setVisible(true); }, 3000);
    }

    return () => { off(); clearTimeout(t); };
  }, []);

  if (!visible) return null;

  const dismiss = () => {
    localStorage.setItem(DISMISS_KEY, String(Date.now()));
    setVisible(false);
  };

  const install = async () => {
    if (!deferred) { setIosHelp((v) => !v); return; }
    deferred.prompt();
    const { outcome } = await deferred.userChoice;
    clearInstallPrompt(); setDeferred(null);
    if (outcome === 'accepted') { markInstalled(); setVisible(false); }
    else dismiss();
  };

  return (
    <div style={{
      position: 'fixed', left: 16, bottom: narrow ? 96 : 16, zIndex: 998,
      width: narrow ? 'min(340px, calc(100vw - 32px))' : 'min(340px, calc(100vw - 110px))',
      background: 'var(--navy, #0f2b44)', color: 'var(--cream, #faf6ec)',
      borderRadius: 14, boxShadow: '0 8px 30px rgba(0,0,0,.35)', padding: '14px 16px',
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
        <img src="/pwa-192x192.png" alt="" width="40" height="40" style={{ borderRadius: 9, flexShrink: 0 }} />
        <div style={{ lineHeight: 1.3 }}>
          <div style={{ fontWeight: 700, fontFamily: 'var(--font-display, serif)' }}>Instalează aplicația</div>
          <div style={{ fontSize: '.82rem', opacity: .85 }}>ExamenMate pe ecranul tău, fullscreen.</div>
        </div>
      </div>

      {iosHelp && (
        <div style={{ fontSize: '.82rem', marginTop: 10, background: 'rgba(255,255,255,.08)', borderRadius: 8, padding: '8px 10px', lineHeight: 1.45 }}>
          1. Deschide site-ul în <strong>Safari</strong><br />
          2. Apasă butonul <strong>Share</strong> (pătratul cu săgeată ↑)<br />
          3. Alege <strong>„Adaugă la ecranul principal”</strong>
        </div>
      )}

      <div style={{ display: 'flex', gap: 10, marginTop: 12 }}>
        <button onClick={install} style={{
          flex: 1, background: 'var(--gold, #e8b931)', color: 'var(--navy, #0f2b44)',
          border: 'none', borderRadius: 8, padding: '9px 12px', fontWeight: 700, cursor: 'pointer', fontSize: '.9rem',
        }}>
          {deferred ? 'Instalează' : 'Cum instalez?'}
        </button>
        <button onClick={dismiss} style={{
          background: 'transparent', color: 'var(--cream, #faf6ec)', opacity: .75,
          border: '1px solid rgba(255,255,255,.35)', borderRadius: 8, padding: '9px 12px', cursor: 'pointer', fontSize: '.9rem',
        }}>
          Nu acum
        </button>
      </div>
    </div>
  );
}
