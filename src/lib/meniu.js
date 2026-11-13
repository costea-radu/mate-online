// =====================================================================
// src/lib/meniu.js — structura UNICĂ a navigării, PE TIPUL DE CONT
//
// De aici se construiesc, pentru fiecare tip de cont (vizitator / elev /
// părinte / profesor):
//   · meniul lateral de pe calculator (src/components/Sidebar.jsx) și drawer-ul ☰
//     de pe telefon (MobileMenu din src/components/Navbar.jsx) → sectiuniMeniu();
//   · bara de jos de pe telefon, ca într-o aplicație (src/components/BaraJos.jsx)
//     → baraJos();
//   · butoanele din Home („Tot ce poți face") → scurtaturi().
// Un singur loc: cele trei nu mai pot să se despartă una de alta.
//
// REGULA (11 nov. 2026, seara — „să nu aibă în contul de un anumit tip butoane în
// plus de la alt tip de cont"): fiecare cont vede DOAR funcțiile lui.
//   · ale elevului: „🎯 Pregătește-mă de examen", „Meditații live", „⚔️ Arena",
//     temele și rezultatele LUI;
//   · ale părintelui: rezultatele copilului, asocierea, tema pentru copil;
//   · ale profesorului: generatoarele de teste, rezultatele elevilor, catalogul,
//     invitația, mesageria grupei.
// Materialele (examene, clase, auxiliare, blog, bibliotecă), mesageria, forumul,
// recenziile, abonamentul și contul sunt comune. Adminul le vede pe toate (le
// verifică pe toate). Listele de mai jos — DOAR_* — sunt verificate în
// test/navigare-pe-cont.test.js.
//
// Un element de meniu:
//   { tip: 'link',    to, icon, label, badge?, badgeTitlu?, punct?, accent? }
//   { tip: 'pliabil', cheie, icon, label, copii: [{to,label,accent?}], prefixe: [] }
//   { tip: 'iesire',  icon, label }     — butonul de deconectare
//
// Conturile de PROFESOR au în „🎓 Examene" (bara de sus, meniul lateral și
// drawer-ul ☰) și „📄 Generează subiect examen", care deschide „Asistent AI
// pentru profesori" direct pe fila generatorului (cerut pe 31 oct. 2026).
//
// „🎯 Pregătește-mă de examen" (8 nov. 2026) e PRIMA intrare din „Învățare cu
// AI", înaintea „Meditațiilor live" — testul zilei (src/pages/PregatesteMa.jsx);
// doar la elevi și la vizitatori (și în bara de sus, și în meniu).
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

// Doar pentru profesori: generatorul de subiecte din „Asistent AI pentru profesori"
// (src/pages/ProfesorVirtual.jsx deschide fila din ?tab=exam).
export const EXAMEN_GENERATOR = { to: '/profesor-virtual?tab=exam', label: '📄 Generează subiect examen', accent: true };

// Intrările din „🎓 Examene" pentru un cont: examenele + generatorul, la profesori.
export const examenePentru = ({ isTeacher = false } = {}) => (isTeacher ? [...EXAMENE, EXAMEN_GENERATOR] : EXAMENE);

// „🎯 Pregătește-mă de examen" — testul zilei, amintirea zilnică, XP în Arenă
export const PREGATESTE_MA = { to: '/pregateste-ma', icon: '🎯', label: 'Pregătește-mă de examen' };

export const INFORMATII = [
  { to: '/despre-noi',                 icon: 'ℹ️', label: 'Despre noi' },
  { to: '/faq',                        icon: '❓', label: 'Întrebări frecvente' },
  { to: '/contact',                    icon: '✉️', label: 'Contact' },
  { to: '/termeni-conditii',           icon: '📜', label: 'Termeni și condiții' },
  { to: '/politica-confidentialitate', icon: '🔒', label: 'Confidențialitate' },
  { to: '/politica-cookies',           icon: '🍪', label: 'Politica de cookie-uri' },
  { to: '/politica-retur',             icon: '↩️', label: 'Politica de retur' },
];

// ─── Tipul de cont ───────────────────────────────────────────────────────────
// Un cont fără rol ales încă (prima intrare cu Google) e tratat ca al unui elev.
export const ROLURI = ['vizitator', 'elev', 'parinte', 'profesor'];
export function rolDin({ user = null, isTeacher = false, isParent = false } = {}) {
  if (!user) return 'vizitator';
  if (isTeacher) return 'profesor';
  if (isParent) return 'parinte';
  return 'elev';
}

// Ce NU are ce căuta la alt tip de cont (căile, fără ?…). Verificate în teste.
export const DOAR_ELEV = ['/pregateste-ma', '/meditatii', '/arena', '/arena/harta', '/tema-elev'];
export const DOAR_PROFESOR = ['/profesor-virtual?tab=interactive', '/profesor-virtual?tab=exam', '/profesor-virtual?tab=interactive&mod=elevi', '/profil?invita=1', '/profil?catalog=1'];
export const DOAR_PARINTE = ['/profil?asociere=1'];

// Pagina curentă: potrivire exactă sau pe prefix de secțiune (/clase/7 etc.).
// Intrările cu ?… (ex. /profil?rezultate=1) se potrivesc doar cu `search`-ul lor.
export function esteActiv(pathname, to, search = '') {
  if (!to) return false;
  const [cale, query] = String(to).split('?');
  if (query) {
    if (pathname !== cale) return false;
    const are = new URLSearchParams(search || '');
    for (const [k, v] of new URLSearchParams(query)) if (are.get(k) !== v) return false;
    return true;
  }
  if (cale === '/') return pathname === '/';
  return pathname === cale || pathname.startsWith(`${cale}/`);
}

// ─── Secțiunile meniului, în ordinea în care se afișează ─────────────────────
export function sectiuniMeniu({
  user = null,
  isAdmin = false,
  isTeacher = false,
  isParent = false,
  isPremium = false,
  aiLabel = 'Profesor Virtual',
  chatUnread = 0,
  forumUnread = 0,
  forumHasNew = false,
} = {}) {
  const rol = rolDin({ user, isTeacher, isParent });
  // elevul și vizitatorul; adminul vede și intrările elevului (le verifică)
  const caElev = rol === 'elev' || rol === 'vizitator' || isAdmin;
  const mesagerie = { tip: 'link', to: '/mesagerie', icon: '💬', label: 'Mesagerie', badge: chatUnread };

  return [
    // fără titlu: prima intrare stă singură, deasupra categoriilor
    { titlu: null, items: [{ tip: 'link', to: '/', icon: '🏠', label: 'Acasă' }] },

    // PROFESOR: uneltele lui, primele
    ...(rol === 'profesor' ? [{
      titlu: 'Clasa mea',
      items: [
        { tip: 'link', to: '/profesor-virtual?tab=interactive', icon: '🧩', label: 'Generează teste', accent: true },
        { tip: 'link', to: '/profil?rezultate=1', icon: '📊', label: 'Rezultate elevi' },
        { tip: 'link', to: '/profil?catalog=1',   icon: '📒', label: 'Catalog' },
        { tip: 'link', to: '/profil?invita=1',    icon: '🔗', label: 'Invită elevi' },
        mesagerie,
      ],
    }] : []),

    // PĂRINTE: copilul lui, primul
    ...(rol === 'parinte' ? [{
      titlu: 'Copilul meu',
      items: [
        { tip: 'link', to: '/profil?rezultate=1', icon: '📊', label: 'Rezultate elev', accent: true },
        { tip: 'link', to: '/profil?asociere=1',  icon: '🔗', label: 'Asociază-te cu copilul' },
        mesagerie,
      ],
    }] : []),

    {
      titlu: 'Materiale',
      items: [
        { tip: 'pliabil', cheie: 'examene', icon: '🎓', label: 'Examene', copii: examenePentru({ isTeacher }), prefixe: ['/evaluare-nationala', '/bacalaureat'] },
        { tip: 'pliabil', cheie: 'clase',   icon: '📚', label: 'Clase',   copii: CLASE,   prefixe: ['/clase'] },
        { tip: 'link', to: '/manuale',                  icon: '📖',  label: 'Auxiliare' },
        { tip: 'link', to: '/rezolvari',                icon: '📝',  label: 'Blog / Rezolvări / Teorie' },
        { tip: 'link', to: '/biblioteca-utilizatorilor', icon: '🏛️', label: 'Biblioteca utilizatorilor' },
      ],
    },

    {
      titlu: caElev ? 'Învățare cu AI' : 'Asistent AI',
      items: [
        ...(caElev ? [
          { tip: 'link', ...PREGATESTE_MA, accent: true },
          { tip: 'link', to: '/meditatii',        icon: 'einstein', label: 'Meditații live' },
        ] : []),
        { tip: 'link', to: '/profesor-virtual', icon: 'einstein', label: aiLabel },
      ],
    },

    {
      titlu: 'Comunitate',
      items: [
        // profesorul și părintele au mesageria sus, lângă elevii / copilul lor
        ...(rol === 'elev' ? [mesagerie] : []),
        { tip: 'link', to: '/discutii',  icon: '💬', label: 'Forum', badge: forumUnread, badgeTitlu: 'răspunsuri noi', punct: forumHasNew },
        ...(caElev ? [{ tip: 'link', to: '/arena', icon: '⚔️', label: 'Arena matematică' }] : []),
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

// ─── Bara de jos de pe telefon (ca într-o aplicație): cel mult 5 intrări ─────
// `badge: 'chat'` = bulina mesajelor noi. „Materiale" duce la blocul de materiale
// din Home (/#materiale — examenele și clasele, la un deget distanță).
export function baraJos(rol = 'vizitator') {
  const acasa = { to: '/', icon: '🏠', label: 'Acasă' };
  const materiale = { to: '/#materiale', icon: '📚', label: 'Materiale' };
  const mesaje = { to: '/mesagerie', icon: '💬', label: 'Mesaje', badge: 'chat' };
  const cont = { to: '/profil', icon: '👤', label: 'Cont' };
  // profesorul: „Materiale", ca elevul (13 nov. 2026 — cererea: „în loc de «exerciții»
  // interactive, pune buton «materiale», ca la conturile de elevi"); generatorul de teste
  // rămâne în meniu („Clasa mea" → „Generează teste") și în butoanele din Home
  if (rol === 'profesor') {
    return [acasa, materiale, { to: '/profil?rezultate=1', icon: '📊', label: 'Elevi' }, mesaje, cont];
  }
  if (rol === 'parinte') {
    return [acasa, { to: '/profil?rezultate=1', icon: '📊', label: 'Rezultate' }, { to: '/profesor-virtual', icon: '📝', label: 'Temă' }, mesaje, cont];
  }
  // „Pregătire" (13 nov. 2026): pagina e acum harta pregătirii — pasul de azi din plan
  if (rol === 'elev') {
    return [acasa, materiale, { to: PREGATESTE_MA.to, icon: '🎯', label: 'Pregătire' }, mesaje, cont];
  }
  return [acasa, materiale, { to: PREGATESTE_MA.to, icon: '🎯', label: 'Pregătire' }, { to: '/preturi', icon: '⭐', label: 'Abonament' }, { to: '/inregistrare', icon: '✨', label: 'Cont nou' }];
}

// Intrarea activă a barei de jos: întâi potrivirea exactă cu ?… , apoi calea simplă
// („Cont" = /profil fără secțiune; „Acasă" = / fără #materiale).
export function activInBara(intrari, { pathname = '/', search = '', hash = '' } = {}) {
  const cuQuery = intrari.findIndex((i) => i.to.includes('?') && esteActiv(pathname, i.to, search));
  if (cuQuery >= 0) return cuQuery;
  const cuHash = intrari.findIndex((i) => i.to.includes('#') && pathname === i.to.split('#')[0] && hash === `#${i.to.split('#')[1]}`);
  if (cuHash >= 0) return cuHash;
  return intrari.findIndex((i) => !i.to.includes('?') && !i.to.includes('#') && esteActiv(pathname, i.to));
}

// ─── Butoanele din Home: „Tot ce poți face", pe tipul de cont ────────────────
// Scurte: pictogramă + două-trei cuvinte. Cardurile mari de deasupra lor
// (src/components/AcasaCont.jsx) arată starea (teme de făcut, mesaje noi…);
// aici e restul funcțiilor contului, ca nimic să nu rămână ascuns în meniu.
export function scurtaturi(rol = 'vizitator') {
  if (rol === 'profesor') {
    return [
      { to: '/profesor-virtual?tab=exam', icon: '📄', label: 'Subiect de examen' },
      { to: '/profesor-virtual?tab=interactive&mod=elevi', icon: '👥', label: 'Teste diferite pe elev' },
      { to: '/profil?catalog=1', icon: '📒', label: 'Catalog' },
      { to: '/profesor-virtual', icon: 'einstein', label: 'Asistent AI' },
      { to: '/biblioteca-utilizatorilor', icon: '🏛️', label: 'Biblioteca' },
      { to: '/discutii', icon: '🗣️', label: 'Forum' },
    ];
  }
  if (rol === 'parinte') {
    return [
      { to: '/profesor-virtual', icon: '📝', label: 'Dă-i o temă' },
      { to: '/preturi', icon: '⭐', label: 'Abonament pentru copil' },
      { to: '/discutii', icon: '🗣️', label: 'Forum' },
      { to: '/faq', icon: '❓', label: 'Întrebări' },
    ];
  }
  // elev și vizitator (examenele și clasele stau în blocul „Materiale" din Home)
  return [
    { to: '/profesor-virtual', icon: 'einstein', label: 'Profesor Virtual' },
    { to: '/meditatii', icon: '🔴', label: 'Meditații live' },
    { to: '/arena', icon: '⚔️', label: 'Arena' },
    { to: '/manuale', icon: '📖', label: 'Auxiliare' },
    { to: '/biblioteca-utilizatorilor', icon: '🏛️', label: 'Biblioteca' },
    { to: '/discutii', icon: '🗣️', label: 'Forum' },
  ];
}
