// Planurile de abonament afișate (pagina /preturi și lista de prețuri a
// meditațiilor live). Prețurile REALE se stabilesc pe server
// (api/create-checkout.js — PRICE_MONTHLY_LEI / PRICE_ANNUAL_LEI);
// aici sunt doar pentru afișare, ca să nu depindă paginile de un apel în plus.
export const PLANS = [
  {
    id: 'lunar',
    eticheta: 'Lunar',
    pret: 50,
    perioada: 'pe lună',
    subtitlu: 'Plătești lună de lună. Renunți când vrei.',
  },
  {
    id: 'anual',
    eticheta: 'Anual',
    pret: 500,
    perioada: 'pe an',
    subtitlu: 'Plătești 10 luni, primești 12. Adică 41,67 lei pe lună.',
    economie: '2 luni cadou',
    recomandat: true,
  },
];
