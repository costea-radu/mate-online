// =====================================================================
// src/lib/live/demoScript.js — o mini-lecție pentru DEMONSTRAȚIA sălii
// (/meditatii/demo): doi itemi de EN explicați pe barem, fără voce generată
// (în demonstrație vorbește vocea browserului). Cronologia gata calculată
// (demo.json) se obține cu: node test/tools/live-demo.js
// La problema de la Subiectul al III-lea, profesorul pune ÎNTREBĂRI PE PAȘI (câte
// una la fiecare subpunct, înaintea rezultatelor intermediare din barem).
// Matematica e verificată: 2 + 3·4 = 14; E(2) = 3² − 2·4 = 9 − 8 = 1;
// (x+1)² = x² + 2x + 1; x(x+2) = x² + 2x; E(x) = (x+1)² − x(x+2) = 1.
// =====================================================================
const seg = (id, say, board = []) => ({ id, say, board });

export const DEMO_SCRIPT = {
  v: 1, title: 'Demonstrație — Evaluarea Națională, doi itemi', exam: 'en', profile: null, teacher: 'radu',
  intro: [
    seg('d-in0', 'Bine ați venit la meditație! Sunt profesorul vostru virtual de matematică.'),
    seg('d-in1', 'Astăzi lucrăm doi itemi de Evaluare Națională, strict după barem. Întâi încercați singuri, iar la problema grea vă întreb la fiecare pas din barem.'),
  ],
  items: [
    {
      ref: 'I.1', section: 'I', title: 'Subiectul I, exercițiul 1', kind: 'grila', points: 5,
      statement: 'Rezultatul calculului $2 + 3 \\cdot 4$ este egal cu:',
      options: ['20', '14', '24', '9'], answer: 'b',
      intro: [seg('d-11i', 'Subiectul I, exercițiul 1. Rezultatul calculului doi plus trei ori patru este egal cu: douăzeci, paisprezece, douăzeci și patru sau nouă?')],
      tryPoll: { id: 'd-p1', type: 'grila', question: 'Rezultatul calculului $2 + 3 \\cdot 4$ este:', options: ['20', '14', '24', '9'], answer: 'b', explain: 'Înmulțirea se face înaintea adunării.' },
      afterTry: [seg('d-11t', 'Să vedem răspunsul corect.')],
      modes: {
        barem: [
          seg('d-11b0', 'Ordinea operațiilor: înmulțirea se face înaintea adunării.', ['$2 + 3 \\cdot 4$']),
          seg('d-11b1', 'Calculăm întâi trei ori patru, adică doisprezece.', ['$= 2 + 12$']),
          seg('d-11b2', 'Apoi adunăm: doi plus doisprezece egal paisprezece. Răspunsul corect este b, iar baremul dă cinci puncte pentru litera corectă.', ['$= 14 \\Rightarrow$ **b)** — 5p']),
        ],
        intuitiv: [seg('d-11n0', 'Gândiți-vă la bani: aveți doi lei și primiți trei monede de câte patru lei. Aveți paisprezece lei, nu douăzeci.', ['$2 + 3\\cdot 4 = 2 + 12$'])],
        greseli: [seg('d-11g0', 'Greșeala clasică: adunați întâi, doi plus trei egal cinci, apoi ori patru, și ieșiți douăzeci. Asta e varianta a, capcana subiectului!', ['✗ $(2+3)\\cdot 4 = 20$'])],
        alta_metoda: [],
      },
      check: null, afterCheck: [],
    },
    {
      ref: 'III.1', section: 'III', title: 'Subiectul al III-lea, problema 1', kind: 'rezolvare', points: 5,
      statement: 'Se consideră expresia $E(x) = (x+1)^2 - x(x+2)$, unde $x$ este număr real.\na) Calculați $E(2)$.\nb) Arătați că $E(x) = 1$ pentru orice număr real $x$.',
      options: null, answer: '1',
      intro: [seg('d-31i', 'Subiectul al treilea, problema 1. Avem expresia E de x egal x plus unu, totul la pătrat, minus x ori x plus doi. La punctul a calculăm E de doi, iar la punctul b arătăm că E de x este unu.')],
      tryPoll: null, afterTry: [],
      modes: {
        barem: [
          seg('d-31b0', 'La punctul a înlocuim x cu doi: doi plus unu, totul la pătrat, minus doi ori doi plus doi.', ['a) $E(2) = (2+1)^2 - 2 \\cdot (2+2)$']),
          seg('d-31b1', 'Trei la pătrat este nouă, iar doi ori patru este opt. Deci E de doi este nouă minus opt, adică unu. Baremul dă două puncte.', ['$E(2) = 9 - 8 = 1$ (2p)']),
          seg('d-31b2', 'La punctul b desfacem pătratul: x plus unu, la pătrat, este x la pătrat plus doi x plus unu. Încă două puncte.', ['b) $(x+1)^2 = x^2 + 2x + 1$ (2p)']),
          seg('d-31b3', 'Apoi x ori x plus doi este x la pătrat plus doi x. Scădem: termenii se reduc și rămâne unu. Ultimul punct.', ['$x(x+2) = x^2 + 2x$', '$E(x) = x^2 + 2x + 1 - x^2 - 2x = 1$ (1p)']),
        ],
        intuitiv: [seg('d-31n0', 'Verificați cu un număr: pentru x egal trei, patru la pătrat este șaisprezece, iar trei ori cinci este cincisprezece. Diferența este unu!', ['$x = 3$: $16 - 15 = 1$ ✓'])],
        greseli: [seg('d-31g0', 'Atenție la semnul minus din fața parantezei: minus x ori x plus doi înseamnă minus x la pătrat minus doi x, nu plus.', ['$-x(x+2) = -x^2 - 2x$'])],
        alta_metoda: [],
      },
      // întrebările pe pași: înaintea segmentului `at` din explicația pe barem
      steps: [
        {
          id: 'd-s1', at: 1, part: 'a', type: 'completare', question: 'Cât este $(2+1)^2$?', options: null, answer: '9',
          hint: 'Calculați întâi paranteza, apoi ridicați la pătrat.', explain: '$(2+1)^2 = 3^2 = 9$',
          ask: [seg('d-31q1', 'Înainte să scriu, încercați voi: cât este doi plus unu, totul la pătrat? Scrieți rezultatul pe ecran.')],
        },
        {
          id: 'd-s2', at: 2, part: 'b', type: 'completare', question: 'Desfaceți pătratul: $(x+1)^2 = \\;?$', options: null, answer: 'x^2+2x+1',
          hint: '$(a+b)^2 = a^2 + 2ab + b^2$', explain: '$(x+1)^2 = x^2 + 2 \\cdot x \\cdot 1 + 1^2 = x^2 + 2x + 1$',
          ask: [seg('d-31q2', 'La punctul b, desfaceți voi pătratul lui x plus unu. Scrieți pe ecran ce obțineți.')],
        },
        {
          id: 'd-s3', at: 3, part: 'b', type: 'grila', question: 'Cât este $x(x+2)$?', options: ['$x^2 + 2$', '$x^2 + 2x$', '$2x^2$', '$x + 2x$'], answer: 'b',
          hint: 'Înmulțiți $x$ cu fiecare termen din paranteză.', explain: '$x \\cdot x + x \\cdot 2 = x^2 + 2x$',
          ask: [seg('d-31q3', 'Acum alegeți voi: cât este x ori x plus doi?')],
        },
      ],
      check: { id: 'd-p2', type: 'completare', question: 'Cât este $E(5)$?', options: null, answer: '1', explain: '36 − 35 = 1' },
      afterCheck: [seg('d-31k', 'Exact: oricare ar fi x, rezultatul este unu.')],
    },
  ],
  qna: [seg('d-qa', 'Acum e momentul pentru întrebări. Scrieți în chat ce nu a fost clar.')],
  breakSay: [seg('d-pz', 'Facem o pauză scurtă.')],
  outro: [seg('d-fi0', 'Asta a fost demonstrația. Vă aștept la ședințele live!')],
};
