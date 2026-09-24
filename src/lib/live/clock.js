// =====================================================================
// src/lib/live/clock.js — ceasul comun al sălii (sincronizat cu serverul)
//
// Toți elevii dintr-o ședință de grup trebuie să audă aceeași frază în
// aceeași secundă. Ceasul calculatorului poate fi decalat cu minute întregi,
// deci măsurăm decalajul față de server din fiecare răspuns API (`now`) și
// păstrăm eșantionul cu drumul cel mai scurt (eroarea ≤ jumătate din el).
// =====================================================================
let offset = 0;        // ms: ora serverului − ora locală
let bestRtt = Infinity;
let samples = 0;

export const clock = {
  sample(serverIso, sentAt, receivedAt) {
    const server = Date.parse(serverIso);
    if (!Number.isFinite(server)) return;
    const rtt = Math.max(0, receivedAt - sentAt);
    // eșantioanele vechi „expiră" treptat: rețeaua se poate schimba
    if (rtt <= bestRtt * 1.15 || samples < 3) {
      offset = server + rtt / 2 - receivedAt;
      bestRtt = Math.min(bestRtt, rtt);
    }
    samples++;
    if (samples % 20 === 0) bestRtt *= 1.5;
  },
  now() { return Date.now() + offset; },
  offset() { return offset; },
};
