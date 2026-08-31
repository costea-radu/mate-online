// =====================================================================
// src/lib/meniu.js — structura UNICĂ a meniului de navigare
//
// Aceleași categorii, aceeași ordine și aceleași pictograme sunt folosite
// în DOUĂ locuri: bara laterală de pe desktop (src/components/Sidebar.jsx)
// și drawer-ul ☰ de pe telefon (MobileMenu din src/components/Navbar.jsx).
// Înainte fiecare avea lista lui și cele două o luau razna una față de alta;
// acum se descriu o singură dată, aici.
//
// Un element de meniu:
//   { tip: 'link',    to, icon, label, badge?, badgeTitlu?, punct?, accent? }
//   { tip: 'pliabil', cheie, icon, label, copii: [{to,label}], prefixe: [] }
//   { tip: 'iesire',  icon, label }     — butonul de deconectare
// =====================================================================

export const CLASE = [
  { to: '/clase/5',  label: 'Clasa a V-a' },
  { to: '/clase/6',  label: 'Clasa a VI-a' },
  { to: '/clase/7',  label: 'Clasa a VII-a' },
  { to: '/clase/8',  label: 'Clasa a VIII-a' },
  { to: '/clase/9',  label: 'Clasa a IX-a' },
  { to: '/clase/10', label: 'Clasa a X-a' },
  { to: '/clase/11', label: 'Clasa a XI-a' },
  { to: '/clase/12', label: 'Clasa a XII-a' },
];

export const EXAMENE = [
  { to: '/evaluare-nationala',          label: 'Evaluare Națională' },
  { to: '/bacalaureat/mate-info',       label: 'Bacalaureat Mate-Info' },
  { to: '/bacalaureat/stiinte-naturii', label: 'Bacalaureat Șt. Naturii' },
  { to: '/bacalaureat/tehnologic',      label: 'Bacalaureat Tehnologic' },
];

export const INFORMATII = [
  { to: '/despre-noi',                 icon: 'ℹ️', label: 'Despre noi' },
  { to: '/faq',                        icon: '❓', label: 'Întrebări frecvente' },
  { to: '/contact',                    icon: '✉️', label: 'Contact' },
  { to: '/termeni-conditii',           icon: '📜', label: 'Termeni și condiții' },
  { to: '/politica-confidentialitate', icon: '🔒', label: 'Confidențialitate' },
  { to: '/politica-cookies',           icon: '🍪', label: 'Politica de cookie-uri' },
  { to: '/politica-retur',             icon: '↩️', label: 'Politica de retur' },
];

// Pagina curentă: potrivire exactă sau pe prefix de secțiune (/clase/7 etc.).
export function esteActiv(pathname, to) {
  if (!to) return false;
  if (to === '/') return pathname === '/';
  return pathname === to || pathname.startsWith(`${to}/`);
}

// ─── Secțiunile meniului, în ordinea în care se afișează ─────────────────────
export function sectiuniMeniu({
  user = null,
  isAdmin = false,
  isPremium = false,
  aiLabel = 'Profesor Virtual',
  chatUnread = 0,
  forumUnread = 0,
  forumHasNew = false,
} = {}) {
  return [
    // fără titlu: prima intrare stă singură, deasupra categoriilor
    { titlu: null, items: [{ tip: 'link', to: '/', icon: '🏠', label: 'Acasă' }] },

    {
      titlu: 'Materiale',
      items: [
        { tip: 'pliabil', cheie: 'examene', icon: '🎓', label: 'Examene', copii: EXAMENE, prefixe: ['/evaluare-nationala', '/bacalaureat'] },
        { tip: 'pliabil', cheie: 'clase',   icon: '📚', label: 'Clase',   copii: CLASE,   prefixe: ['/clase'] },
        { tip: 'link', to: '/manuale',                  icon: '📖',  label: 'Auxiliare' },
        { tip: 'link', to: '/rezolvari',                icon: '📝',  label: 'Blog / Rezolvări / Teorie' },
        { tip: 'link', to: '/biblioteca-utilizatorilor', icon: '🏛️', label: 'Biblioteca utilizatorilor' },
      ],
    },

    {
      titlu: 'Învățare cu AI',
      items: [
        { tip: 'link', to: '/meditatii',        icon: 'einstein', label: 'Meditații cu AI' },
        { tip: 'link', to: '/profesor-virtual', icon: 'einstein', label: aiLabel },
      ],
    },

    {
      titlu: 'Comunitate',
      items: [
        { tip: 'link', to: '/mesagerie', icon: '💬', label: 'Mesagerie', badge: chatUnread },
        { tip: 'link', to: '/discutii',  icon: '💬', label: 'Forum', badge: forumUnread, badgeTitlu: 'răspunsuri noi', punct: forumHasNew },
        { tip: 'link', to: '/arena',     icon: '⚔️', label: 'Arena matematică' },
        { tip: 'link', to: '/recenzii',  icon: '⭐', label: 'Recenzii' },
      ],
    },

    {
      titlu: 'Cont',
      items: [
        { tip: 'link', to: '/preturi', icon: '💳', label: 'Abonament' },
        ...(isAdmin ? [{ tip: 'link', to: '/admin', icon: '⚙', label: 'Admin', accent: true }] : []),
        ...(user
          ? [
            { tip: 'link', to: '/profil', icon: isPremium ? '⭐' : '👤', label: 'Contul meu' },
            { tip: 'iesire', icon: '🚪', label: 'Ieșire' },
          ]
          : [
            { tip: 'link', to: '/autentificare', icon: '🔑', label: 'Autentificare' },
            { tip: 'link', to: '/inregistrare',  icon: '✨', label: 'Înregistrare', accent: true },
          ]),
      ],
    },

    {
      titlu: 'Informații',
      items: INFORMATII.map((i) => ({ tip: 'link', ...i })),
    },
  ];
}
