// =====================================================================
// api/_lib/pdfTestPotrivire.js — potrivirea PDF ↔ testul interactiv făcut după el
// (21 nov. 2026, cererea: „fă în admin o rubrică în care pot asocia manual un PDF de un
// test interactiv. Fă ca PDF-urile să se asocieze automat cu un test interactiv generat
// după modelul lui")
//
// Logica PURĂ (fără rețea, fără require): o folosesc serverul (api/content-admin.js →
// perechi / asociaza) și browserul (Admin → 🔗 PDF ↔ Interactiv, Admin → 🧩 Adaugă
// Interactiv), ca propunerile să fie aceleași peste tot. Testată în
// test/pdf-interactiv-admin.test.js.
//
// De unde știm că un test e făcut după un PDF, în ordinea încrederii:
//   1. generatorul a notat PDF-ul-sursă (task „pe rând" — api/_lib/exgen.js → asociazaPdf,
//      agentul Claude cu un PDF de pe site ca model) → asociere directă, fără potrivire;
//   2. jurnalul generatorului (agent_task_runs.combined_from) — un singur PDF din rubrica
//      task-ului → „sigur"; mai multe → test combinat, fără PDF (ex. EN „Test 32–61");
//   3. titlul (aici): cuvintele și numerele comune („2021 Varianta 02" ↔ „BAC 2021 ·
//      M_tehnologic · Varianta 2", „Fișă 9: Metoda mersului invers" ↔ „Fișă 9 — Metoda
//      mersului invers (clasa a V-a)"). Doar numerele („Test interactiv EN - 9" ↔ „2021
//      model 9") nu ajung niciodată la o propunere: sunt prea multe titluri cu același număr.
// Clasa și examenul trebuie să coincidă (o legătură între categorii nu apare pe site la
// fel pe ambele părți), iar la BAC profilul (dacă ambele îl au).
// =====================================================================

const PRAG_SIGUR = 0.85;      // și cel puțin MARJA_SIGUR peste al doilea candidat
const MARJA_SIGUR = 0.2;
const PRAG_PROBABIL = 0.55;   // „de verificat": propus, dar nebifat
const MARJA_PROBABIL = 0.05;

const fara = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
const normTitlu = (s) => fara(s).replace(/[^a-z0-9]+/g, ' ').trim();

// cuvinte care nu spun ce test e (tipul materialului, examenul, profilul, clasa, legături)
const STOP = new Set([
  'test', 'teste', 'testul', 'testului', 'interactiv', 'interactiva', 'interactive', 'interactivi',
  'rezolvare', 'rezolvarea', 'rezolvari', 'matematica', 'matematici', 'mate', 'info', 'stiinte', 'stiintele',
  'naturii', 'nat', 'st', 'tehnologic', 'tehnologica', 'bac', 'bacalaureat', 'bacalaureatul', 'evaluare',
  'evaluarea', 'nationala', 'en', 'clasa', 'clasei', 'cls', 'al', 'ale', 'ai', 'de', 'la', 'cu', 'si',
  'sau', 'din', 'pentru', 'in', 'pe', 'prin', 'un', 'fisa', 'fise', 'fisei', 'lucru', 'exercitiu',
  'exercitiul', 'exercitii', 'exercitiile', 'ex', 'geometrie', 'algebra', 'chestionar', 'etc',
]);
const SINONIME = { v: 'varianta', var: 'varianta', nr: 'numere' };
const ROMAN = { i: '1', ii: '2', iii: '3', iv: '4' };

// Titlul → { cuvinte, numere, subiecte }: „BAC 2014 tehnologic v1" → { [varianta], [2014, 1], [] };
// „SUBIECTUL II, EX. 5: Cercul" → { [cercul], [5], [2] }. Numerele fără zerouri în față (02 → 2).
function tokeni(titlu) {
  let t = fara(titlu);
  // „clasa a V-a", „clasa a 7-a", „cls 11" — clasa e deja categoria materialului
  t = t.replace(/\bclasa\s+a\s+(?:[ivx]+|\d+)\s*-?\s*a\b/g, ' ').replace(/\bcls\.?\s*\d+\b/g, ' ');
  const subiecte = [];
  t = t.replace(/\bsubiectul\s+(?:al\s+)?(iv|iii|ii|i|\d)\b(?:\s*-?\s*lea)?/g, (m, r) => { subiecte.push(ROMAN[r] || r); return ' '; });
  const cuvinte = [];
  const numere = [];
  for (const tok of t.match(/[a-z]+|\d+/g) || []) {
    if (/^\d+$/.test(tok)) { numere.push(String(Number(tok))); continue; }
    const c = SINONIME[tok] || tok;
    if (c.length < 2 || STOP.has(c)) continue;
    cuvinte.push(c);
  }
  return { cuvinte, numere, subiecte };
}

// același cuvânt, cu altă terminație: „cercul" ~ „cerc", „variantă" ~ „variante", „numerelor" ~ „numere"
function acelasiCuvant(a, b) {
  if (a === b) return true;
  if (Math.min(a.length, b.length) >= 4 && (a.startsWith(b) || b.startsWith(a))) return true;
  return a.length >= 6 && b.length >= 6 && a.slice(0, 6) === b.slice(0, 6);
}
function cuvinteComune(A, B) {
  const folosit = new Array(B.length).fill(false);
  let n = 0;
  for (const a of A) {
    const j = B.findIndex((b, k) => !folosit[k] && acelasiCuvant(a, b));
    if (j >= 0) { folosit[j] = true; n += 1; }
  }
  return n;
}
function numereComune(A, B) {
  const rest = [...B];
  let n = 0;
  for (const a of A) {
    const j = rest.indexOf(a);
    if (j >= 0) { rest.splice(j, 1); n += 1; }
  }
  return n;
}
const rotunjit = (x) => Math.round(x * 1000) / 1000;

// Cât de sigur e că două titluri numesc același test (0…1):
//   • subiecte diferite („Subiectul I" ↔ „Subiectul II") sau numere fără niciunul comun → 0;
//   • cuvinte pe ambele părți: cuvintele comune (și numerele, dacă le au amândouă);
//   • doar numere: cel mult 0,5 — sub pragul oricărei propuneri.
function scorTitluri(a, b) {
  const A = tokeni(a);
  const B = tokeni(b);
  if (A.subiecte.length && B.subiecte.length) {
    if (!A.subiecte.some((x) => B.subiecte.includes(x))) return 0;
    // același subiect pe ambele părți e un indiciu ca un cuvânt comun
    A.cuvinte.push(...A.subiecte.map((x) => `s${x}`));
    B.cuvinte.push(...B.subiecte.map((x) => `s${x}`));
  }
  let k = null;
  if (A.numere.length && B.numere.length) {
    k = numereComune(A.numere, B.numere) / Math.max(A.numere.length, B.numere.length);
    if (k === 0) return 0;
  }
  if (!A.cuvinte.length || !B.cuvinte.length) return k == null ? 0 : rotunjit(0.5 * k);
  const w = cuvinteComune(A.cuvinte, B.cuvinte) / Math.max(A.cuvinte.length, B.cuvinte.length);
  return rotunjit(k == null ? w : 0.5 * w + 0.5 * k);
}

// ─── cine se poate lega de cine ───────────────────────────────────────────────
const profilCompatibil = (a, b) => !a || !b || a === b;
// motivul pentru care testul nu se poate lega de PDF (null = se poate)
function motivIncompatibil(test, pdf) {
  if (!test || !pdf) return 'Alege și PDF-ul, și testul.';
  if (!test.category || test.category !== pdf.category) return 'PDF-ul și testul sunt din categorii diferite (clasă / examen) — alege un PDF din aceeași categorie.';
  if (!profilCompatibil(test.profile, pdf.profile)) return 'PDF-ul și testul sunt de la profiluri de Bacalaureat diferite.';
  return null;
}
const compatibili = (test, pdf) => motivIncompatibil(test, pdf) === null;

// ─── clasamentul candidaților după titlu ──────────────────────────────────────
function clasament(titlu, candidati) {
  return (Array.isArray(candidati) ? candidati : [])
    .filter((r) => r && r.id)
    .map((row) => ({ row, scor: scorTitluri(titlu, row.title) }))
    .filter((x) => x.scor > 0)
    .sort((x, y) => (y.scor - x.scor) || String(x.row.title || '').localeCompare(String(y.row.title || ''), 'ro'));
}
// 'sigur' (propus și bifat / ales singur) · 'probabil' (propus, de verificat) · null
function nivelPotrivire(lista) {
  const [p, d] = Array.isArray(lista) ? lista : [];
  if (!p) return null;
  const al2 = d ? d.scor : 0;
  if (p.scor >= PRAG_SIGUR && p.scor - al2 >= MARJA_SIGUR) return 'sigur';
  if (p.scor >= PRAG_PROBABIL && p.scor - al2 >= MARJA_PROBABIL) return 'probabil';
  return null;
}

// PDF-ul după care pare făcut un test (titlul, categoria, profilul): { alesul, nivel, lista }
function propunePdf(test, pdfs) {
  const cand = (Array.isArray(pdfs) ? pdfs : []).filter((p) => compatibili(test, p));
  const lista = clasament(test && test.title, cand);
  return { alesul: lista[0] || null, nivel: nivelPotrivire(lista), lista };
}
// testul care pare făcut după un PDF (din testele date — de obicei cele fără PDF)
function propuneTest(pdf, teste) {
  const cand = (Array.isArray(teste) ? teste : []).filter((t) => compatibili(t, pdf));
  const lista = clasament(pdf && pdf.title, cand);
  return { alesul: lista[0] || null, nivel: nivelPotrivire(lista), lista };
}

// ─── jurnalul generatorului (agent_task_runs) ─────────────────────────────────
// Pentru testele fără PDF: ce a notat rularea care le-a făcut. `runs` = { content_id,
// task_id, combined_from }, `tasks` = { id, name, category, subcategory, profile, ctype }.
// → { [testId]: { combinat, n?, din?, pdfId?, sursa?, task? } }
//   • task pe teste interactive (ctype 'interactive') → combinat din alte teste;
//   • titlurile din combined_from care sunt PDF-uri ale rubricii task-ului: unul → pdfId
//     („pe rând"; restul titlurilor sunt contextul, ex. baremele corespondente), mai multe →
//     test combinat din mai multe PDF-uri.
function construiesteJurnal({ runs = [], tasks = [], teste = [], pdfs = [] } = {}) {
  const taskDupaId = new Map((tasks || []).map((t) => [t.id, t]));
  const testDupaId = new Map((teste || []).map((t) => [t.id, t]));
  const out = {};
  for (const r of runs || []) {
    const t = r && testDupaId.get(r.content_id);
    if (!t) continue;
    const surse = Array.isArray(r.combined_from) ? r.combined_from.map((x) => String(x || '')).filter(Boolean) : [];
    const task = taskDupaId.get(r.task_id) || null;
    const numeTask = task ? task.name || null : null;
    if (task && task.ctype === 'interactive') { out[t.id] = { combinat: true, n: surse.length, din: 'teste', task: numeTask }; continue; }
    const subs = task && task.subcategory ? String(task.subcategory).split('+') : null;
    const inRubrica = (p) => p.category === t.category && (!task || (p.category === task.category
      && (!subs || subs.includes(p.subcategory || '')) && (!task.profile || p.profile === task.profile)));
    const ids = new Set();
    for (const titlu of surse) {
      const n = normTitlu(titlu);
      for (const p of pdfs || []) if (p && inRubrica(p) && normTitlu(p.title) === n) ids.add(p.id);
    }
    if (ids.size === 1) out[t.id] = { combinat: false, pdfId: [...ids][0], sursa: surse[0] || null, task: numeTask };
    else if (ids.size > 1) out[t.id] = { combinat: true, n: ids.size, din: 'pdf', task: numeTask };
    else if (surse.length > 1) out[t.id] = { combinat: true, n: surse.length, din: task ? task.ctype || null : null, task: numeTask };
    else out[t.id] = { combinat: false, pdfId: null, sursa: surse[0] || null, task: numeTask };
  }
  return out;
}

// ─── „🤖 Asociază automat": propunerile pentru testele fără PDF ────────────────
// Un test are un singur PDF, deci se pornește de la teste. Jurnalul cu PDF-ul-sursă → 'sigur';
// altfel titlul. O propunere „sigură" spre un PDF care are deja test devine „de verificat"
// (un al doilea test după același PDF e rar — ex. o versiune nouă a testului).
function propuneri({ pdfs = [], teste = [], jurnal = {} } = {}) {
  const pdfDupaId = new Map((pdfs || []).map((p) => [p.id, p]));
  const cuTeste = new Set();
  for (const t of teste || []) if (t && t.pdf_sursa_id) cuTeste.add(t.pdf_sursa_id);
  const areTest = (p) => !!(p && (p.interactiv_id || cuTeste.has(p.id)));
  const out = [];
  for (const t of teste || []) {
    if (!t || t.pdf_sursa_id) continue;
    const j = (jurnal || {})[t.id];
    if (j && j.combinat) continue;   // combinat din mai multe materiale — nu e făcut după un PDF
    if (j && j.pdfId && pdfDupaId.has(j.pdfId) && compatibili(t, pdfDupaId.get(j.pdfId))) {
      out.push({ testId: t.id, pdfId: j.pdfId, scor: 1, nivel: 'sigur', motiv: 'jurnal' });
      continue;
    }
    const r = propunePdf(t, pdfs);
    if (!r.alesul || !r.nivel) continue;
    const nivel = r.nivel === 'sigur' && areTest(r.alesul.row) ? 'probabil' : r.nivel;
    out.push({ testId: t.id, pdfId: r.alesul.row.id, scor: r.alesul.scor, nivel, motiv: 'titlu', pdfAreTest: areTest(r.alesul.row) });
  }
  const ord = { sigur: 0, probabil: 1 };
  return out.sort((a, b) => (ord[a.nivel] - ord[b.nivel]) || (b.scor - a.scor));
}

// ─── principalul unui PDF ─────────────────────────────────────────────────────
// Testul principal (content.interactiv_id) e cel deschis de „🧩 Deschide interactiv" /
// „✏️ Rezolvă ▾" → „🧩 Interactiv". Un PDF rămas fără principal, dar cu alte teste făcute
// după el, îl primește pe cel mai nou (altfel PDF-ul și-ar pierde butonul de pe site).
function alegePrincipal(teste) {
  const lista = (Array.isArray(teste) ? teste : []).filter((t) => t && t.id);
  if (!lista.length) return null;
  return [...lista].sort((a, b) => String(b.created_at || '').localeCompare(String(a.created_at || '')))[0].id;
}

// procentul afișat lângă o propunere („92%")
const procent = (scor) => `${Math.round(Math.max(0, Math.min(1, Number(scor) || 0)) * 100)}%`;

module.exports = {
  PRAG_SIGUR, MARJA_SIGUR, PRAG_PROBABIL, MARJA_PROBABIL,
  normTitlu, tokeni, scorTitluri, acelasiCuvant,
  profilCompatibil, motivIncompatibil, compatibili,
  clasament, nivelPotrivire, propunePdf, propuneTest,
  construiesteJurnal, propuneri, alegePrincipal, procent,
};
