// =====================================================================
// test/tools/lectieLiveSkill.js — procedura 7 a skill-ului „examenmate-continut" (22 nov. 2026):
// un subiect de EN de test (textul și baremul, pe secțiuni, ca în ai_pdf_text) și itemii lecției
// live scriși ca de skill (forma din liveLesson.SCHEMA). Folosit de test/continut-generat.test.js.
// =====================================================================
function subiectEN() {
  const lines = ['SUBIECTUL I (30 de puncte)', 'Încercuiește litera corespunzătoare răspunsului corect.'];
  for (let n = 1; n <= 6; n++) lines.push(`${n}. Rezultatul calculului ${n} + ${n} este egal cu:`, `a) ${2 * n + 1} b) ${2 * n + 2} c) ${2 * n + 3} d) ${2 * n}`);
  lines.push('SUBIECTUL al II-lea (30 de puncte)', 'Încercuiește litera corespunzătoare răspunsului corect.');
  for (let n = 1; n <= 6; n++) lines.push(`${n}. În figura alăturată, segmentul AB are ${2 * n} cm. Jumătatea lui este:`, `a) ${n} cm b) ${n + 1} cm c) ${n + 2} cm d) ${n + 3} cm`);
  lines.push('SUBIECTUL al III-lea (30 de puncte)', 'Scrie rezolvările complete.');
  for (let n = 1; n <= 6; n++) lines.push(`${n}. Se consideră numărul a = ${n} + ${n}.`, `(2p) a) Calculează a.`, `(3p) b) Calculează 3a.`);
  return lines.join('\n');
}
function baremEN() {
  const lines = ['BAREM DE EVALUARE ȘI DE NOTARE', 'SUBIECTUL I (30 de puncte)'];
  for (let n = 1; n <= 6; n++) lines.push(`${n}. d) 5p`);
  lines.push('SUBIECTUL al II-lea (30 de puncte)');
  for (let n = 1; n <= 6; n++) lines.push(`${n}. a) 5p`);
  lines.push('SUBIECTUL al III-lea (30 de puncte)');
  for (let n = 1; n <= 6; n++) lines.push(`${n}. a) a = ${2 * n} 2p`, `b) 3a = ${6 * n} 3p`);
  return lines.join('\n');
}
const seg = (say, board = []) => ({ say, board });
function itemiEN({ fara = [] } = {}) {
  const items = [];
  for (let n = 1; n <= 6; n++) {
    items.push({
      ref: `I.${n}`, title: `Subiectul I, exercițiul ${n}`, kind: 'grila',
      statement: `Rezultatul calculului $${n} + ${n}$ este egal cu:`, statementTry: null,
      options: [String(2 * n + 1), String(2 * n + 2), String(2 * n + 3), String(2 * n)], answer: 'd', points: 5, barem: 'd) — 5p',
      intro: [seg(`Trecem la Subiectul întâi, exercițiul ${n}.`)],
      tryPoll: { type: 'grila', question: `Rezultatul calculului $${n} + ${n}$ este egal cu:`, options: [String(2 * n + 1), String(2 * n + 2), String(2 * n + 3), String(2 * n)], answer: 'd', explain: `${n} plus ${n} fac ${2 * n}.` },
      afterTry: [seg('Să vedem răspunsul corect.')],
      modes: {
        barem: [seg(`Adunăm: ${n} plus ${n} egal ${2 * n}.`, [`$${n} + ${n} = ${2 * n}$`]), seg('Varianta corectă este d. Se acordă cinci puncte.', ['d) (5p)'])],
        intuitiv: [seg(`Puneți ${n} obiecte lângă alte ${n}: aveți ${2 * n}.`), seg('De aceea alegem varianta d.')],
        greseli: [seg('Atenție la calculul în grabă.'), seg('O variantă greșită înseamnă zero puncte.')],
        alta_metoda: null,
      },
      check: null, afterCheck: [],
    });
  }
  for (let n = 1; n <= 6; n++) {
    items.push({
      ref: `II.${n}`, title: `Subiectul al II-lea, exercițiul ${n}`, kind: 'grila',
      statement: `În figura alăturată, segmentul $AB$ are $${2 * n}$ cm. Jumătatea lui este:`, statementTry: null,
      options: [`${n} cm`, `${n + 1} cm`, `${n + 2} cm`, `${n + 3} cm`], answer: 'a', points: 5, barem: 'a) — 5p',
      intro: [seg(`Trecem la Subiectul al doilea, exercițiul ${n}.`)],
      tryPoll: { type: 'grila', question: `Segmentul $AB$ are $${2 * n}$ cm. Jumătatea lui este:`, options: [`${n} cm`, `${n + 1} cm`, `${n + 2} cm`, `${n + 3} cm`], answer: 'a', explain: `${2 * n} împărțit la 2 fac ${n}.` },
      afterTry: [seg('Să vedem răspunsul corect.')],
      modes: {
        barem: [seg(`Împărțim lungimea la doi: ${2 * n} supra 2 egal ${n}.`, [`$${2 * n} : 2 = ${n}$ cm`]), seg('Varianta corectă este a. Cinci puncte.', ['a) (5p)'])],
        intuitiv: [seg('Jumătate înseamnă două părți egale.'), seg('Deci varianta a.')],
        greseli: [seg('Nu confundați jumătatea cu dublul.'), seg('Varianta greșită nu primește puncte.')],
        alta_metoda: null,
      },
      check: null, afterCheck: [],
    });
  }
  for (let n = 1; n <= 6; n++) {
    items.push({
      ref: `III.${n}`, title: `Subiectul al III-lea, exercițiul ${n}`, kind: 'rezolvare',
      statement: `Se consideră numărul $a = ${n} + ${n}$. a) Calculează $a$. b) Calculează $3a$.`, statementTry: null,
      options: null, answer: `a) $${2 * n}$; b) $${6 * n}$`, points: 5, barem: `a) a = ${2 * n} (2p); b) 3a = ${6 * n} (3p)`,
      intro: [seg(`Trecem la Subiectul al treilea, exercițiul ${n}.`), seg(`Se consideră numărul a egal ${n} plus ${n}.`)],
      tryPoll: null, afterTry: [],
      modes: {
        barem: [
          { say: `La punctul a, adunăm cele două numere.`, board: [`a) $a = ${n} + ${n}$`], ask: { type: 'completare', question: `Cât este $a = ${n} + ${n}$?`, options: null, answer: String(2 * n), hint: 'Adună cele două numere.', explain: `${n} + ${n} = ${2 * n}.`, say: 'Încercați voi: cât este a? Scrieți pe ecran.' } },
          { say: `Obținem a egal ${2 * n}. Pentru acest calcul se acordă două puncte.`, board: [`$a = ${2 * n}$ (2p)`], ask: null },
          { say: 'La punctul b, înmulțim cu trei.', board: [`b) $3a = 3 \\cdot ${2 * n}$`], ask: { type: 'completare', question: `Cât este $3 \\cdot ${2 * n}$?`, options: null, answer: String(6 * n), hint: 'Înmulțește cu 3.', explain: `3 · ${2 * n} = ${6 * n}.`, say: 'Calculați voi produsul și scrieți rezultatul pe ecran.' } },
          { say: `Rezultă trei a egal ${6 * n}. Se acordă trei puncte.`, board: [`$3a = ${6 * n}$ (3p)`], ask: null },
        ],
        intuitiv: [seg('Întâi aflăm a, apoi îl triplăm.'), seg('Triplul înseamnă de trei ori.')],
        greseli: [seg('Nu uitați să calculați întâi a.'), seg('Un calcul greșit la a pierde și punctele de la b.')],
        alta_metoda: null,
      },
      check: null, afterCheck: [],
    });
  }
  return items.filter((it) => !fara.includes(it.ref));
}
module.exports = { subiectEN, baremEN, itemiEN };
