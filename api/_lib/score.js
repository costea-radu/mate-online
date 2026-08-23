// =====================================================================
// api/_lib/score.js — SCORUL testelor interactive RECALCULAT PE SERVER
// (Etapa 3 din AUDIT_AGENTI_AI.md — restanța 2.1 din Etapa 1)
//
// Până acum iframe-ul HTML trimitea `{score, maxScore}` prin postMessage, iar
// browserul scria scorul direct în `progress` (și în meditații: session_score /
// homework_score). Un elev putea trimite 100% din consolă. De acum HTML-ul
// generat trimite ȘI RĂSPUNSURILE (`answers`), iar serverul:
//   1. ia CHEILE din content.interactive_data.exercise (exercițiile generate
//      de platformă) sau, pentru HTML-urile generate mai demult, din fișierul
//      HTML al materialului (`var D=[...]` / `var ANS = [...]`);
//   2. recalculează punctajul cu aceeași echivalență matematică ca în
//      browser (mathcheck.answersEquivalent) — sau mai tolerantă;
//   3. întoarce scorul VERIFICAT (procent, maxScore 100) sau, dacă nu are
//      cheile (teste încărcate manual, fără `answers`), scorul trimis,
//      plafonat (clampScore) și marcat `verified:false`.
// Folosit de api/ai-score.js (progress) și de ai-meditatii (session_score,
// homework_score).
// =====================================================================
const mathcheck = require('./mathcheck');

const MAX_ITEMS = 60;

// Cheile din exercițiul structurat (exgen.normalize → {kind, questions|steps})
function keysFromExercise(ex) {
  if (!ex || typeof ex !== 'object') return null;
  const list = ex.kind === 'etape' ? ex.steps : ex.questions;
  if (!Array.isArray(list) || !list.length) return null;
  const items = list.slice(0, MAX_ITEMS).map((q) => {
    const choice = Array.isArray(q.options) && q.options.length > 0;
    return {
      type: choice ? 'choice' : 'open',
      answer: choice ? Number(q.answer) : String(q.answer ?? ''),
      points: Math.max(0, Number(q.points) || 0) || 1,
    };
  });
  return { items, source: 'exercise' };
}

// Tabloul JSON care începe imediat după `marker` (scanare cu paranteze
// echilibrate, conștientă de stringuri — explicațiile pot conține „];")
function jsonArrayAfter(s, marker) {
  const at = s.indexOf(marker);
  if (at < 0) return null;
  let i = s.indexOf('[', at + marker.length);
  if (i < 0 || i - (at + marker.length) > 3) return null;
  let depth = 0, inStr = false, esc = false;
  for (let j = i; j < s.length && j < i + 2_000_000; j++) {
    const c = s[j];
    if (inStr) { if (esc) esc = false; else if (c === '\\') esc = true; else if (c === '"') inStr = false; continue; }
    if (c === '"') inStr = true;
    else if (c === '[') depth++;
    else if (c === ']') { depth--; if (depth === 0) { try { return JSON.parse(s.slice(i, j + 1)); } catch { return null; } } }
  }
  return null;
}

// Cheile din HTML-ul generat: exgen (`var D=[{t,a,p,e}]`) sau quizRender (`var ANS = [{type, answer}]`)
function keysFromHtml(html) {
  const s = String(html || '');
  let D = jsonArrayAfter(s, 'var D=');
  if (D) {
    try {
      if (Array.isArray(D) && D.length) {
        return {
          source: 'html',
          items: D.slice(0, MAX_ITEMS).map((d) => ({
            type: d.t === 'c' ? 'choice' : 'open',
            answer: d.t === 'c' ? Number(d.a) : String(d.a ?? ''),
            points: Math.max(0, Number(d.p) || 0) || 1,
          })),
        };
      }
    } catch { /* alt format */ }
  }
  const A = jsonArrayAfter(s, 'var ANS =');
  if (A) {
    try {
      if (Array.isArray(A) && A.length) {
        return {
          source: 'html',
          items: A.slice(0, MAX_ITEMS).map((a) => ({
            type: a.type === 'choice' ? 'choice' : 'open',
            answer: a.type === 'choice' ? Number(a.answer) : String(a.answer ?? ''),
            points: 1,
          })),
        };
      }
    } catch { /* alt format */ }
  }
  return null;
}

// Recalculul: answers[i] = indexul ales (grilă) sau textul scris (liber)
function recompute(keys, answers) {
  const items = keys && Array.isArray(keys.items) ? keys.items : [];
  if (!items.length) return null;
  const A = Array.isArray(answers) ? answers : [];
  let got = 0, max = 0, correct = 0;
  const details = items.map((k, i) => {
    max += k.points;
    const a = A[i];
    let ok = false;
    if (k.type === 'choice') ok = a != null && a !== '' && Number(a) === k.answer;
    else if (a != null && String(a).trim()) ok = mathcheck.answersEquivalent(String(a), k.answer) === true;
    if (ok) { got += k.points; correct++; }
    return ok;
  });
  const pct = max ? Math.round((got / max) * 100) : 0;
  return { got, max, pct, correct, total: items.length, details };
}

// Scorul verificat al unui material pentru răspunsurile trimise.
// Întoarce { score, maxScore, verified, pct, source } — score/maxScore în forma
// folosită peste tot (procent, 100), ca HTML-urile generate.
async function verifiedScore(supa, content, { answers = null, score = 0, maxScore = 100, loadHtml = null } = {}) {
  const clamp = clampScore(score, maxScore);
  const fallback = { score: clamp.sc, maxScore: clamp.mx, verified: false, hasKeys: false, pct: clamp.mx ? Math.round((clamp.sc / clamp.mx) * 100) : 0, source: null };
  if (!content) return fallback;
  // CHEILE se caută ÎNTOTDEAUNA, înaintea răspunsurilor: altfel era destul ca
  // cererea să vină fără `answers` ca scorul din browser să fie crezut orbește.
  let keys = keysFromExercise(content.interactive_data && content.interactive_data.exercise);
  if (!keys && typeof loadHtml === 'function') {
    try { keys = keysFromHtml(await loadHtml(content)); } catch { keys = null; }
  }
  if (!keys) return fallback; // material fără chei citibile (test încărcat manual)
  if (!Array.isArray(answers) || !answers.length) {
    // materialul ARE chei, dar nu am primit răspunsuri (pagină veche în cache,
    // test care nu le trimite): scorul rămâne cel din browser, dar plafonat la
    // maximul răspunsurilor pe care le-am putut verifica — adică 0 puncte
    // acordate „pe încredere". Apelantul decide ce face cu `hasKeys`.
    return { ...fallback, hasKeys: true, source: keys.source };
  }
  const r = recompute(keys, answers);
  if (!r) return { ...fallback, hasKeys: true, source: keys.source };
  return { score: r.pct, maxScore: 100, verified: true, hasKeys: true, pct: r.pct, source: keys.source, correct: r.correct, total: r.total };
}

// 0 ≤ scor ≤ maxim, maximul între 1 și 1000 (ca ai-meditatii.clampScore)
function clampScore(score, maxScore) {
  const mx = Math.min(1000, Math.max(1, parseInt(maxScore, 10) || 100));
  const sc = Math.min(mx, Math.max(0, parseInt(score, 10) || 0));
  return { sc, mx };
}

// HTML-ul unui material interactiv (din Storage) — pentru cheile din `var D=`
async function loadContentHtml(supa, content) {
  const { storagePath } = require('./pdftext');
  if (!content || !content.file_url) return '';
  const { bucket, filePath } = storagePath(content.file_url);
  const { data: blob } = await supa.storage.from(bucket).download(filePath);
  if (!blob) return '';
  const buf = Buffer.from(await blob.arrayBuffer());
  return buf.toString('utf8');
}

module.exports = { keysFromExercise, keysFromHtml, recompute, verifiedScore, clampScore, loadContentHtml };
