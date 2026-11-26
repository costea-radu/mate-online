// =====================================================================
// src/lib/live/nota.js — NOTA de la sfârșitul meditației live (26 nov. 2026)
//
// Cererea lui Radu: „la sfârșitul meditației live elevul să primească notă pe cât a rezolvat
// pe ecran". Nota se calculează ca la examen, doar din itemii la care profesorul l-a întrebat
// pe ecran în această ședință:
//   · fiecare item are punctajul lui din barem (scena „item" din cronologie, `points`; 5 implicit);
//   · întrebările lui „de rezolvat" sunt încercarea (tryPoll) și întrebările pe pași; doar dacă
//     itemul n-are niciuna, contează întrebarea de verificare (cea de după explicație);
//   · elevul ia din punctajul itemului partea întrebărilor la care a răspuns corect
//     (o întrebare apărută pe ecran și lăsată fără răspuns = greșită);
//   · nota = 1 + 9 · puncte obținute / puncte ale itemilor apăruți — exact (10 + puncte) / 10 la
//     un subiect întreg de 90 de puncte; cu două zecimale, ca la Evaluarea Națională.
// Itemii la care n-a apărut nicio întrebare (elevul a intrat mai târziu, ședința s-a oprit) nu intră.
// =====================================================================

// tipul unei scene-întrebare din cronologie (api/_lib/live.js → buildTimeline)
export function felIntrebare(scene) {
  if (!scene) return null;
  if (scene.verificare) return 'verificare';
  if (scene.step) return 'pas';
  return 'incercare';
}

// { timeline, raspunsuri: { pollId: { correct } }, vazute: Iterable<pollId> }
// → { nota, puncte, total, intrebari, corecte, itemi } sau null (nicio întrebare pe ecran)
export function notaLectie({ timeline, raspunsuri = {}, vazute = [] } = {}) {
  const scene = (timeline && Array.isArray(timeline.scenes)) ? timeline.scenes : [];
  const puncte = new Map();       // item → punctajul lui
  const intrebari = new Map();    // pollId → { item, fel }
  for (const s of scene) {
    if (!s || s.item == null) continue;
    if (s.type === 'item') puncte.set(s.item, Number(s.points) > 0 ? Number(s.points) : 5);
    if (s.type === 'sondaj' && s.poll && s.poll.id) intrebari.set(s.poll.id, { item: s.item, fel: felIntrebare(s) });
  }
  const ids = new Set([...(vazute || []), ...Object.keys(raspunsuri || {})]);
  const peItem = new Map();       // item → { rezolvare: [ids], verificare: [ids] }
  for (const id of ids) {
    const q = intrebari.get(id);
    if (!q) continue;
    if (!peItem.has(q.item)) peItem.set(q.item, { rezolvare: [], verificare: [] });
    peItem.get(q.item)[q.fel === 'verificare' ? 'verificare' : 'rezolvare'].push(id);
  }
  let obtinute = 0, total = 0, nIntrebari = 0, nCorecte = 0;
  for (const [item, g] of peItem) {
    const lista = g.rezolvare.length ? g.rezolvare : g.verificare;
    if (!lista.length) continue;
    const p = puncte.get(item) || 5;
    const ok = lista.filter((id) => raspunsuri[id] && raspunsuri[id].correct).length;
    obtinute += (p * ok) / lista.length;
    total += p;
    nIntrebari += lista.length;
    nCorecte += ok;
  }
  if (!total) return null;
  const nota = Math.round((1 + (9 * obtinute) / total) * 100) / 100;
  return {
    nota,
    puncte: Math.round(obtinute * 100) / 100,
    total,
    intrebari: nIntrebari,
    corecte: nCorecte,
    itemi: peItem.size,
  };
}

// „7,45" (virgula românească, două zecimale)
export const fmtNota = (n) => (n == null ? '' : Number(n).toFixed(2).replace('.', ','));
export const fmtPuncte = (n) => (n == null ? '' : String(Math.round(Number(n) * 100) / 100).replace('.', ','));
