// =====================================================================
// api/_lib/punctajCumulat.js — PUNCTAJUL CUMULAT AL UNUI TEST, PE EXERCIȚII (19 nov. 2026)
//
// Cererea: „La schimbarea metodei de rezolvare în timpul rezolvării, să se păstreze
// punctajul acumulat până atunci."
//
// Un test PDF se poate rezolva în mai multe feluri — ✏️ pe PDF, 📷 cu poză, 💬 în chat,
// ✍️ în foaia de lucru, 🧩 în testul interactiv asociat — iar elevul poate trece de la
// unul la altul la jumătatea testului. Până acum fiecare corectare scria în `progress`
// DOAR punctele ei (ce nu se corecta atunci avea 0): exercițiile făcute cu metoda de
// dinainte se pierdeau. De acum rezultatul testului se ține PE EXERCIȚII
// (progress.itemi — supabase/pdf_interactiv.sql):
//   • exercițiile corectate acum le înlocuiesc pe aceleași de dinainte (ultima contează,
//     ca până acum, dar pe fiecare exercițiu în parte);
//   • exercițiile nerezolvate acum își PĂSTREAZĂ punctele de dinainte;
//   • rezultatul testului = suma exercițiilor (din oficiu se adaugă la notă, ca înainte).
// Cumulul ține cât timp elevul lucrează la test: o corectare la mai mult de
// FEREASTRA_ORE după cea de dinainte începe o rezolvare nouă (ca o lucrare nouă).
//
// Cheile exercițiilor sunt aceleași pentru toate metodele: „I.3" (formularul de
// răspuns), „1.3" (harta testului de pe PDF), „Subiectul I, exercițiul 3" (cardurile
// testului interactiv) → „1.3"; subpunctele: „III.2.a" → „3.2.a". Un exercițiu întreg
// („3.2") și subpunctele lui („3.2.a", „3.2.b") se înlocuiesc unele pe altele.
//
// Folosit de api/rezolva-pdf.js (✏️ pe PDF), api/ai-correct.js (formularul: poză, chat,
// foaie, PDF la BAC / clase), api/ai-handwriting.js (✍️ „Cere corectarea" din foaia de
// lucru) și api/ai-score.js (🧩 testul interactiv deschis din PDF).
// =====================================================================

const FEREASTRA_ORE = 24;
const METODE = {
  pdf: 'pe PDF', poza: 'cu poză', chat: 'în chat', foaie: 'în foaia de lucru', interactiv: 'în testul interactiv',
};
const ROMAN = { i: 1, ii: 2, iii: 3, iv: 4 };
const MAX_CHEI = 200;
// testele întregi de examen (Subiectele I–III): la ele se adaugă și exercițiile din
// testul interactiv (aceeași structură); la fișe / capitole, testul interactiv are
// propria numerotare — punctajul PDF-ului rămâne, dar nu se amestecă
const RUBRICI_TEST = new Set(['variante', 'simulari', 'variante-ai', 'teste-antrenament']);

const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100;
const fold = (s) => String(s == null ? '' : s).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
const fmtP = (n) => String(round2(n)).replace('.', ',');
const fmtNota = (n) => Number(n).toFixed(2).replace('.', ',');

// Cheia canonică a unui exercițiu / subpunct (null = nu se poate citi)
function cheie(lbl) {
  const s = fold(lbl).replace(/\s+/g, ' ').trim();
  if (!s) return null;
  // „Subiectul al III-lea, exercițiul 2 a)" / „Subiectul II Geometrie — …, exercițiul 3"
  const sub = s.match(/subiect(?:ul)?\s*(?:al\s*)?(iv|iii|ii|i|[1-4])\b/);
  if (sub) {
    const ex = s.slice(sub.index + sub[0].length).match(/(?:exercitiul|ex\.?|itemul|problema|nr\.?)\s*(\d{1,2})(?:\s*[.)]?\s*([a-h])\))?/);
    if (ex) return `${ROMAN[sub[1]] || +sub[1]}.${+ex[1]}${ex[2] ? `.${ex[2]}` : ''}`;
  }
  // „III.2.a" / „iii.2a" / „3.2.a" / „I-3" / „1.3"
  const c = s.replace(/\s+/g, '').match(/^(iv|iii|ii|i|[1-4])[.\-_:,](\d{1,2})(?:[.\-_]?([a-h])\)?)?$/);
  if (c) return `${ROMAN[c[1]] || +c[1]}.${+c[2]}${c[3] ? `.${c[3]}` : ''}`;
  // formularele claselor / fișelor: id-ul lor, curățat („1.a", „2", „ex.3")
  const g = s.replace(/\s+/g, '').replace(/[^a-z0-9.]/g, '').slice(0, 40);
  return g || null;
}
const deExamen = (k) => /^[1-4]\.\d{1,2}(\.[a-h])?$/.test(String(k || ''));
const inrudite = (a, b) => a === b || a.startsWith(`${b}.`) || b.startsWith(`${a}.`);

function curat(k, p, m) {
  if (!k) return null;
  const mx = round2(Math.max(0, Number(m) || 0));
  const pt = round2(Math.max(0, Math.min(mx || Infinity, Number(p) || 0)));
  if (!isFinite(pt)) return null;
  return { k, p: pt, m: mx };
}

// ✏️ pe PDF (api/rezolva-pdf.js): itemii corectați; subpunctele (a, b) separat
function dinRezolvaPdf(items) {
  const out = [];
  for (const it of Array.isArray(items) ? items : []) {
    if (!it || it.blocat || it.puncte == null || it.verdict === 'necompletat' || it.verdict === 'blocat') continue;
    const k = cheie(it.key);
    if (!k) continue;
    const parti = (Array.isArray(it.parti) ? it.parti : [])
      .filter((p) => p && /^[a-h]$/i.test(String(p.l || '').trim()) && p.puncte != null && isFinite(Number(p.puncte)));
    if (parti.length >= 2) {
      for (const p of parti) {
        if (p.verdict === 'necompletat') continue;
        const x = curat(`${k}.${String(p.l).trim().toLowerCase()}`, p.puncte, p.puncte_max);
        if (x) out.push(x);
      }
      continue;
    }
    const x = curat(k, it.puncte, it.puncte_max);
    if (x) out.push(x);
  }
  return out;
}

// 📷 / 💬 / ✍️ formularul de răspuns (api/ai-correct.js): cerințele completate
function dinFormular(graded) {
  const out = [];
  for (const g of Array.isArray(graded) ? graded : []) {
    if (!g || !g.answered || g.verdict === 'necompletat') continue;
    const x = curat(cheie(g.id), g.puncte, g.maxPuncte);
    if (x) out.push(x);
  }
  return out;
}

// ✍️ foaia de lucru (api/ai-handwriting.js → corectorul): exercițiile cu eticheta lor
// („Subiectul III, ex. 2 a)"); doar cele cu cheie de examen — „Exercițiul" fără număr nu
// se poate așeza în test
function dinFoaie(itemi) {
  const out = [];
  for (const it of Array.isArray(itemi) ? itemi : []) {
    if (!it || it.puncte == null || it.verdict === 'necompletat') continue;
    const k = cheie(it.eticheta);
    if (!deExamen(k)) continue;
    const x = curat(k, it.puncte, it.puncte_max);
    if (x) out.push(x);
  }
  return out;
}

// 🧩 testul interactiv (puntea src/lib/tutorBridge.js → MATE_ITEMS): exercițiile la
// care elevul a răspuns; doar cheile de examen („1.3", „3.2") — altfel nu știm sigur
// căruia din PDF îi corespund
function dinInteractiv(items) {
  const out = [];
  for (const it of (Array.isArray(items) ? items : []).slice(0, 120)) {
    if (!it || typeof it !== 'object') continue;
    const k = cheie(it.lbl);
    if (!deExamen(k)) continue;
    const x = curat(k, it.p, it.m);
    if (x && x.m > 0) out.push(x);
  }
  return out;
}

// cumulul de dinainte mai ține? (aceeași rezolvare: ultima corectare acum < FEREASTRA_ORE)
function valabil(vechi, acum = Date.now(), fereastraOre = FEREASTRA_ORE) {
  if (!vechi || typeof vechi !== 'object' || vechi.v !== 1 || !vechi.itemi || typeof vechi.itemi !== 'object') return false;
  const la = Date.parse(vechi.la);
  return isFinite(la) && la <= acum + 60000 && acum - la < fereastraOre * 3600 * 1000;
}

// Combină exercițiile corectate acum (`noi`) cu cele de dinainte (`vechi` = progress.itemi).
// → { itemi (de salvat), score, max, acum: punctele corectării de acum, dinAlte, nAlte, metode }
function combina(vechi, noi, { metoda = null, acum = Date.now(), max = null, fereastraOre = FEREASTRA_ORE } = {}) {
  const t = new Date(acum).toISOString();
  const ok = valabil(vechi, acum, fereastraOre);
  const itemi = {};
  // rândul din `progress` îl poate scrie și browserul elevului (RLS) → cifrele vechi se
  // verifică: puncte între 0 și maximul exercițiului, maximul cel mult 100
  if (ok) {
    for (const [k, v] of Object.entries(vechi.itemi)) {
      if (!v || typeof v !== 'object' || String(k).length > 40) continue;
      const m = Number(v.m), p = Number(v.p);
      if (!isFinite(m) || !isFinite(p) || m < 0 || m > 100 || p < 0 || p > m) continue;
      itemi[k] = { p: round2(p), m: round2(m), metoda: METODE[v.metoda] ? v.metoda : null, la: typeof v.la === 'string' ? v.la.slice(0, 40) : null };
    }
  }
  const lista = Array.isArray(noi) ? noi : [];
  for (const it of lista) {
    for (const k of Object.keys(itemi)) if (inrudite(k, it.k) && !lista.some((x) => x.k === k && x !== it)) delete itemi[k];
    itemi[it.k] = { p: it.p, m: it.m, metoda: metoda || null, la: t };
  }
  // plafon de siguranță (formulare uriașe)
  const chei = Object.keys(itemi);
  if (chei.length > MAX_CHEI) chei.sort((a, b) => String(itemi[a].la).localeCompare(String(itemi[b].la))).slice(0, chei.length - MAX_CHEI).forEach((k) => delete itemi[k]);
  const toate = Object.entries(itemi);
  const sumP = round2(toate.reduce((s, [, v]) => s + (Number(v.p) || 0), 0));
  const sumM = round2(toate.reduce((s, [, v]) => s + (Number(v.m) || 0), 0));
  // maximul testului: cel al corectării de acum; altfel cel de dinainte (plafonat), altfel suma
  const vechiMax = ok && Number(vechi.max) > 0 ? Math.min(Number(vechi.max), 1000) : 0;
  const M = round2(Number(max) > 0 ? Number(max) : (vechiMax || sumM));
  const score = round2(Math.min(sumP, M || sumP));
  const acumNoi = new Set(lista.map((x) => x.k));
  const alte = toate.filter(([k]) => !acumNoi.has(k));
  const metode = [...new Set(alte.map(([, v]) => v.metoda).filter((m) => m && m !== metoda))];
  return {
    itemi: { v: 1, la: t, max: M, itemi },
    score, max: M,
    acum: round2(lista.reduce((s, x) => s + x.p, 0)),
    dinAlte: round2(alte.reduce((s, [, v]) => s + (Number(v.p) || 0), 0)),
    nAlte: alte.length,
    metode,
    continuat: ok,
  };
}

// citirea rândului din `progress` (cu itemi, dacă migrarea e rulată)
async function citeste(supa, userId, contentId) {
  if (!supa || !userId || !contentId) return { row: null, itemi: null, coloana: false };
  const cols = 'score, max_score, completed_at, attempts, time_spent';
  try {
    const { data, error } = await supa.from('progress').select(`${cols}, itemi`).eq('user_id', userId).eq('content_id', contentId).maybeSingle();
    if (!error) return { row: data || null, itemi: (data && data.itemi) || null, coloana: true };
  } catch { /* coloana lipsește */ }
  try {
    const { data } = await supa.from('progress').select(cols).eq('user_id', userId).eq('content_id', contentId).maybeSingle();
    return { row: data || null, itemi: null, coloana: false };
  } catch { return { row: null, itemi: null, coloana: false }; }
}

// rândul `progress` cu punctajul cumulat (upsert progresiv: fără coloana itemi /
// fără coloanele-instantaneu pe instalările vechi)
async function salveaza(supa, userId, { contentId, title = null, category = null, contentType = 'pdf', score, max, itemi = null, sessionSeconds = 0, numaraIncercare = true, existent = null }) {
  const attempts = (existent?.attempts || 0) + (numaraIncercare ? 1 : 0);
  const timeSpent = (existent?.time_spent || 0) + Math.max(0, Math.round(Number(sessionSeconds) || 0));
  const base = { user_id: userId, content_id: contentId, score: Math.round(score), max_score: Math.round(max), completed_at: new Date().toISOString(), attempts };
  const snap = { test_title: title || null, content_type: contentType || null, category: category || null };
  const incercari = [
    { ...base, ...snap, time_spent: timeSpent, ...(itemi ? { itemi } : {}) },
    { ...base, ...snap, time_spent: timeSpent },
    { ...base, time_spent: timeSpent },
    base,
  ];
  let error = null;
  for (const row of incercari) {
    ({ error } = await supa.from('progress').upsert(row, { onConflict: 'user_id,content_id' }));
    if (!error) break;
  }
  if (error) throw new Error(error.message);
  return { attempts, timeSpent };
}

// rândul de text din mesajul profesorului / al testului interactiv
function linie(cum, { nota = null } = {}) {
  if (!cum || !cum.nAlte) return '';
  const unde = cum.metode.length ? ` (${cum.metode.map((m) => METODE[m] || m).join(', ')})` : '';
  const ex = cum.nAlte === 1 ? 'exercițiul corectat' : `cele ${cum.nAlte} exerciții corectate`;
  return `📈 **Punctajul testului, cumulat: ${fmtP(cum.score)}/${fmtP(cum.max)}p**${nota != null ? ` · nota **${fmtNota(nota)}**` : ''} — am păstrat și ${ex} mai devreme${unde}: ${fmtP(cum.dinAlte)}p. Poți schimba metoda oricând: punctele rămân.`;
}

// PDF-ul e un test întreg de examen? (la el se adaugă și exercițiile testului interactiv)
function testIntreg(pdf) {
  if (!pdf) return false;
  return (pdf.category === 'evaluare-nationala' || pdf.category === 'bacalaureat') && RUBRICI_TEST.has(pdf.subcategory || '');
}

module.exports = {
  FEREASTRA_ORE, METODE, RUBRICI_TEST,
  cheie, deExamen, dinRezolvaPdf, dinFormular, dinFoaie, dinInteractiv, valabil, combina, citeste, salveaza, linie, testIntreg,
};
