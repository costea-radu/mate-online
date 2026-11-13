// =====================================================================
// src/components/BaraJos.jsx — bara de jos de pe TELEFON, ca într-o aplicație
// (11 nov. 2026, seara)
//
// Cererea: „fă site-ul ușor de folosit ca aplicație; fiecare tip de cont să aibă
// butoane simple către funcțiile lui". Pe telefon, singura navigare era ☰ (peste
// 20 de intrări). Bara de jos ține la un deget cele 5 locuri ale contului:
//   · elev:      Acasă · Materiale · Pregătire · Mesaje · Cont
//   · părinte:   Acasă · Rezultate · Temă · Mesaje · Cont
//   · profesor:  Acasă · Materiale · Elevi · Mesaje · Cont   (13 nov. 2026: Materiale în loc de Teste)
//   · vizitator: Acasă · Materiale · Pregătire · Abonament · Cont nou
// Intrările vin din src/lib/meniu.js (baraJos) — același loc din care se
// construiesc meniul lateral și butoanele din Home. Doar sub 769 px (CSS);
// paginile pe tot ecranul (teste, PDF, sala live, admin) nu o au (App.jsx).
// =====================================================================
import { useEffect } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { useChatUnread } from '../lib/chatUnread';
import { baraJos, activInBara, rolDin } from '../lib/meniu';

export default function BaraJos() {
  const { user, isTeacher, isParent, loading } = useAuth();
  const loc = useLocation();
  const { count } = useChatUnread(!!user);

  // conținutul paginii, fereastra Profesorului Virtual și bannerele îi lasă loc
  useEffect(() => {
    document.body.classList.add('cu-bara-jos');
    return () => document.body.classList.remove('cu-bara-jos');
  }, []);

  // cât se află cine e (o clipă), bara e goală: nu arătăm butoanele vizitatorului unui cont
  const intrari = loading ? [] : baraJos(rolDin({ user, isTeacher, isParent }));
  const activ = activInBara(intrari, loc);

  return (
    <nav className="bara-jos" aria-label="Navigare rapidă">
      {intrari.map((it, i) => (
        <Link key={it.to} to={it.to} className={`bj-item${i === activ ? ' activ' : ''}`} aria-current={i === activ ? 'page' : undefined}>
          <span className="bj-ic" aria-hidden="true">
            {it.icon}
            {it.badge === 'chat' && count > 0 && <span className="bj-badge">{count > 99 ? '99+' : count}</span>}
          </span>
          <span className="bj-txt">{it.label}{it.badge === 'chat' && count > 0 ? <span className="sr-only"> — {count} noi</span> : null}</span>
        </Link>
      ))}
    </nav>
  );
}
