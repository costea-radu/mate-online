import { useState, useEffect } from 'react';
import { Link, useLocation } from 'react-router-dom';
import EinsteinIcon from './EinsteinIcon';
import { sectiuniMeniu, esteActiv } from '../lib/meniu';

// ─────────────────────────────────────────────────────────────────────────────
// src/components/Sidebar.jsx — MENIUL LATERAL (stil „Admin")
//
// Bară fixă, lipită de marginea din stânga a paginii, imediat sub navbar.
// Structura (categoriile) vine din src/lib/meniu.js — aceeași folosită de
// drawer-ul ☰ de pe telefon, ca cele două să nu mai poată să se despartă.
//
// PLIEREA: bara e PLIATĂ la încărcarea paginii — o bandă îngustă, cu doar
// pictogramele, care se desface la hover peste conținut (fără să-l împingă).
// Săgeata din marginea din dreapta o fixează desfăcută (atunci împinge
// conținutul) sau o pliază la loc.
//
// Pe mobil (≤768px) bara dispare — acolo rămâne drawer-ul ☰.
// Indicatorii (bulina de mesaje, punctul auriu de forum) vin ca props din
// Navbar, ca să nu întrebăm serverul de două ori pentru aceleași numere.
// ─────────────────────────────────────────────────────────────────────────────

// ─── Bulina roșie (mesaje noi) ───────────────────────────────────────────────
function Bulina({ n, titlu = 'mesaje noi' }) {
  if (!n) return null;
  return (
    <span
      className="sb-badge"
      title={`${n} ${titlu}`}
      aria-label={`${n} ${titlu}`}
    >
      {n > 99 ? '99+' : n}
    </span>
  );
}

// Pictograma unei intrări: emoji sau, pentru AI, sigla lui Einstein.
function Icon({ nume }) {
  return (
    <span className="sb-icon" aria-hidden="true">
      {nume === 'einstein' ? <EinsteinIcon size={17} /> : nume}
    </span>
  );
}

export default function Sidebar({
  user,
  isPremium = false,
  isAdmin = false,
  aiLabel = 'Profesor Virtual',
  chatUnread = 0,
  forumUnread = 0,
  forumHasNew = false,
  onSignOut,
}) {
  const { pathname } = useLocation();

  // Pliată la fiecare încărcare de pagină (cerut explicit, 24 oct. 2026) — nu
  // ținem minte starea între vizite, doar în timpul navigării prin site: cine o
  // fixează desfăcută cu săgeata o găsește așa și pe pagina următoare. EXCEPȚIE:
  // intrarea în „Meditații", unde tabla trebuie să ocupe cât mai mult, o pliază
  // la loc (rămâne la un hover distanță).
  const [pliat, setPliat] = useState(true);
  useEffect(() => {
    if (pathname.startsWith('/meditatii')) setPliat(true);
  }, [pathname]);

  // Conținutul paginii (.app-shell) se decalează cât e bara de lată: implicit
  // (în CSS) cu banda îngustă, iar cât bara e fixată desfăcută, cu toată lățimea
  // ei — clasa de pe <body> e semnalul, ca să nu trebuiască să trecem starea prin
  // App.jsx. Starea de la încărcare (pliată) nu cere nicio clasă, deci conținutul
  // stă din primul cadru unde trebuie, fără să alunece după ce pornește React.
  useEffect(() => {
    document.body.classList.toggle('sidebar-deschis', !pliat);
    return () => document.body.classList.remove('sidebar-deschis');
  }, [pliat]);

  // Clic cu mouse-ul pe o intrare a barei: focusul nu rămâne pe ea. Altfel regula
  // `:focus-within` (cea care ține bara desfăcută la navigarea cu tastatura) o
  // ține desfăcută peste pagină și după ce mouse-ul a plecat de pe ea — după
  // fiecare link ales din meniul de la hover. La tastatură (Enter: `detail` 0)
  // focusul rămâne, ca Tab să continue de unde era.
  function lasaFocusul(e) {
    if (e.detail === 0) return;
    const el = e.target.closest('a, button');
    if (el) el.blur();
  }

  const sectiuni = sectiuniMeniu({ user, isAdmin, isPremium, aiLabel, chatUnread, forumUnread, forumHasNew });

  // Secțiunile pliabile se deschid singure când ești deja înăuntru.
  const deschisInitial = {};
  for (const s of sectiuni) {
    for (const it of s.items) {
      if (it.tip === 'pliabil') deschisInitial[it.cheie] = (it.prefixe || []).some((p) => pathname.startsWith(p));
    }
  }
  const [deschise, setDeschise] = useState(deschisInitial);

  useEffect(() => {
    setDeschise((d) => {
      const nou = { ...d };
      for (const s of sectiuni) {
        for (const it of s.items) {
          if (it.tip === 'pliabil' && (it.prefixe || []).some((p) => pathname.startsWith(p))) nou[it.cheie] = true;
        }
      }
      return nou;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pathname]);

  function randItem(it, i) {
    if (it.tip === 'iesire') {
      return (
        <button key={`iesire-${i}`} type="button" onClick={onSignOut} className="sb-item sb-iesire">
          <Icon nume={it.icon} />
          <span className="sb-text">{it.label}</span>
        </button>
      );
    }

    if (it.tip === 'pliabil') {
      const open = !!deschise[it.cheie];
      const activ = (it.prefixe || []).some((p) => pathname.startsWith(p));
      return (
        <div key={it.cheie}>
          <button
            type="button"
            onClick={() => setDeschise((d) => ({ ...d, [it.cheie]: !d[it.cheie] }))}
            className={`sb-item sb-sectiune${activ ? ' activ' : ''}`}
            aria-expanded={open}
          >
            <Icon nume={it.icon} />
            <span className="sb-text">{it.label}</span>
            <span className="sb-text sb-sageata">{open ? '▲' : '▼'}</span>
          </button>
          {open && it.copii.map((c) => (
            <Link
              key={c.to}
              to={c.to}
              className={`sb-sub${esteActiv(pathname, c.to) ? ' activ' : ''}`}
            >
              {c.label}
            </Link>
          ))}
        </div>
      );
    }

    const activ = esteActiv(pathname, it.to);
    return (
      <Link
        key={it.to}
        to={it.to}
        className={`sb-item${activ ? ' activ' : ''}${it.accent ? ' sb-accent' : ''}`}
        title={it.label}
      >
        <Icon nume={it.icon} />
        <span className="sb-text">{it.label}</span>
        {it.punct && <span className="forum-dot" title="Activitate nouă pe forum" aria-label="Activitate nouă pe forum" />}
        <Bulina n={it.badge} titlu={it.badgeTitlu} />
      </Link>
    );
  }

  return (
    <aside className={`app-sidebar${pliat ? ' pliat' : ''}`} aria-label="Meniu principal" onClick={lasaFocusul}>
      {/* Săgeata din margine: pliază / desface bara */}
      <button
        type="button"
        className="sb-toggle"
        onClick={(e) => {
          setPliat((v) => !v);
          // fără asta butonul rămâne „focusat" după clic, iar regula
          // `:focus-within` (cea care ține bara deschisă la navigarea cu
          // tastatura) ar ține-o desfăcută la nesfârșit
          e.currentTarget.blur();
        }}
        title={pliat ? 'Desfă meniul' : 'Pliază meniul'}
        aria-label={pliat ? 'Desfă meniul' : 'Pliază meniul'}
        aria-expanded={!pliat}
      >
        {pliat ? '›' : '‹'}
      </button>

      <nav className="sb-scroll">
        {sectiuni.map((s, si) => (
          <div key={s.titlu || `sect-${si}`}>
            {s.titlu && <div className="sb-grup"><span className="sb-text">{s.titlu}</span></div>}
            {s.items.map(randItem)}
          </div>
        ))}
      </nav>
    </aside>
  );
}
