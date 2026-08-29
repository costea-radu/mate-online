// =====================================================================
// src/components/ChatAlerts.jsx — ALERTA DE MESAJ NOU
//
// Când numărul de mesaje necitite crește (src/lib/chatUnread.js), se întâmplă
// trei lucruri deodată:
//   • sunet scurt (Web Audio, fără fișier);
//   • vibrație pe telefon (Android; iPhone o ignoră);
//   • o bulă pe ecran, sus, cu cine a scris și începutul mesajului — clic pe
//     ea deschide mesageria.
//
// Nu alertăm la PRIMA citire (altfel ar suna la fiecare încărcare de pagină
// pentru mesaje vechi) și nici când e doar o schimbare de conținut, fără
// mesaje noi.
//
// Sunetul și vibrația se pot opri din bulă („🔕"), pe browserul acesta.
// Butonul „🔔 Alerte și când site-ul e în fundal" cere permisiunea de
// notificări de sistem — apare doar dacă browserul o acceptă și nu s-a
// răspuns încă.
//
// Se montează în bara de sus (Navbar), deci nu apare în vizualizatoarele pe
// tot ecranul — în timpul unui test pe grupă nu sare nimic peste exerciții.
// =====================================================================
import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { useChatUnread } from '../lib/chatUnread';
import {
  alertePornite, setAlerte, pregatesteSunetul, sunaMesajNou, vibreaza,
  alertaSistem, stareNotificari, cereNotificari,
} from '../lib/chatAlert';

const DURATA = 8000;     // cât stă bula pe ecran

export default function ChatAlerts() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const { count, last, loaded } = useChatUnread(!!user);

  const [bula, setBula] = useState(null);           // { senderName, roleLabel, body }
  const [sunet, setSunet] = useState(alertePornite);
  const [permisiune, setPermisiune] = useState(stareNotificari);
  const anterior = useRef(null);                    // numărul de la citirea trecută

  useEffect(() => { pregatesteSunetul(); }, []);

  // Deconectare / repornire: uităm reperul, ca să nu alerteze la re-logare.
  useEffect(() => { if (!loaded) anterior.current = null; }, [loaded]);

  // Numărul a crescut → mesaj nou.
  useEffect(() => {
    if (!loaded) return;                            // n-avem încă un număr real
    const inainte = anterior.current;
    anterior.current = count;
    if (inainte === null) return;                   // primul număr real: mesaje vechi, nu alertăm
    if (count <= inainte) return;

    sunaMesajNou();
    vibreaza();
    const cine = last?.senderName || 'Cineva';
    alertaSistem({ title: `💬 Mesaj nou de la ${cine}`, body: last?.body || 'Ai un mesaj nou pe ExamenMate.' });
    setBula({
      senderName: cine,
      roleLabel: last?.roleLabel || '',
      body: last?.body || '',
      cheie: last?.at || Date.now(),
    });
  }, [count, last, loaded]);

  // Se închide singură.
  useEffect(() => {
    if (!bula) return undefined;
    const t = setTimeout(() => setBula(null), DURATA);
    return () => clearTimeout(t);
  }, [bula]);

  // Nu mai are rost să stea dacă între timp ai citit tot.
  useEffect(() => { if (count === 0) setBula(null); }, [count]);

  const comutaSunet = useCallback((e) => {
    e.stopPropagation();
    const nou = !sunet;
    setAlerte(nou);
    setSunet(nou);
    if (nou) sunaMesajNou();
  }, [sunet]);

  const cerePermisiune = useCallback(async (e) => {
    e.stopPropagation();
    setPermisiune(await cereNotificari());
  }, []);

  if (!user || !bula) return null;

  return (
    <div
      role="alert"
      onClick={() => { setBula(null); navigate('/mesagerie'); }}
      className="chat-alerta"
      style={{
        position: 'fixed', zIndex: 2000, cursor: 'pointer',
        background: 'var(--navy)', color: '#fff',
        border: '1px solid rgba(255,255,255,.16)', borderLeft: '4px solid #e74c3c',
        borderRadius: 12, boxShadow: '0 10px 34px rgba(0,0,0,.32)',
        padding: '11px 13px', display: 'flex', gap: 10, alignItems: 'flex-start',
        fontFamily: 'var(--font-body)',
      }}
    >
      <span style={{ fontSize: '1.25rem', lineHeight: 1.1 }}>💬</span>

      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontWeight: 800, fontSize: '.85rem', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {bula.senderName}
          {bula.roleLabel && <span style={{ fontWeight: 500, opacity: .7 }}> ({bula.roleLabel})</span>}
        </div>
        {bula.body && (
          <div style={{
            fontSize: '.8rem', opacity: .9, marginTop: 2, lineHeight: 1.35,
            display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden',
          }}>
            {bula.body}
          </div>
        )}
        <div style={{ fontSize: '.72rem', color: 'var(--gold)', marginTop: 4, fontWeight: 700 }}>
          Apasă ca să deschizi mesageria →
        </div>

        {permisiune === 'default' && (
          <button type="button" onClick={cerePermisiune}
            style={{
              marginTop: 7, background: 'transparent', border: '1px solid rgba(255,255,255,.3)',
              color: '#fff', borderRadius: 20, padding: '3px 10px', fontSize: '.7rem',
              cursor: 'pointer', fontFamily: 'var(--font-body)',
            }}>
            🔔 Alerte și când site-ul e în fundal
          </button>
        )}
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 4, alignItems: 'center' }}>
        <button type="button" onClick={(e) => { e.stopPropagation(); setBula(null); }}
          title="Închide" aria-label="Închide alerta"
          style={{ background: 'none', border: 'none', color: 'rgba(255,255,255,.65)', fontSize: '.95rem', cursor: 'pointer', lineHeight: 1, padding: 0 }}>✕</button>
        <button type="button" onClick={comutaSunet}
          title={sunet ? 'Oprește sunetul și vibrația' : 'Pornește sunetul și vibrația'}
          aria-label={sunet ? 'Oprește sunetul' : 'Pornește sunetul'}
          style={{ background: 'none', border: 'none', fontSize: '.95rem', cursor: 'pointer', lineHeight: 1, padding: 0 }}>
          {sunet ? '🔔' : '🔕'}
        </button>
      </div>

      <style>{`
        .chat-alerta { top: 80px; right: 16px; width: min(340px, calc(100vw - 32px)); }
        @media (max-width: 768px) {
          .chat-alerta { top: 76px; right: 12px; left: 12px; width: auto; }
        }
        @keyframes chatAlertaIntra {
          from { opacity: 0; transform: translateY(-10px); }
          to   { opacity: 1; transform: translateY(0); }
        }
        .chat-alerta { animation: chatAlertaIntra .22s ease-out; }
      `}</style>
    </div>
  );
}
