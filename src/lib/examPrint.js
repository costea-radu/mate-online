// =====================================================================
// src/lib/examPrint.js — export „PDF" prin fereastra de print a browserului
// Redă frumos formulele (KaTeX din CDN) și oferă „Salvează ca PDF".
// =====================================================================

import { autoMath } from './katex';
import { renderFigure } from './figureRender';

function esc(s = '') {
  // (numerele itemilor pot veni ca numere din JSON-ul generat — autoMath cere text)
  return String(autoMath(s == null ? '' : String(s))).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

// ── Figura itemului (SVG generat determinist din specificația AI) ────────────
function itemFigure(it, scale = 1) {
  try {
    const f = it && it.figure ? renderFigure(it.figure) : null;
    if (!f) return null;
    const w = Math.round(f.w * scale);
    return { svg: f.svg.replace(`width="${f.w}"`, `width="${w}"`), w, h: Math.round(f.h * scale) };
  } catch { return null; }
}
const figFloat = (f) => (f ? `<div class="fig" style="width:${f.w}px">${f.svg}</div>` : '');

// ── Spațiu de redactare a rezolvării (caroiaj discret, ca în modelele
//    oficiale; fiind conținut SVG, se tipărește sigur — spre deosebire de
//    fundalurile CSS, pe care browserele nu le printează implicit). ──────────
let gridSeq = 0;
function solutionSpace(h) {
  const id = 'sgrid' + (++gridSeq);
  return `<div class="solspace"><svg width="100%" height="${h}" xmlns="http://www.w3.org/2000/svg"><defs><pattern id="${id}" width="15" height="15" patternUnits="userSpaceOnUse"><path d="M15 0H0V15" fill="none" stroke="#e2e2e2" stroke-width="0.7"/></pattern></defs><rect x="0.5" y="0.5" width="99.7%" height="${h - 1}" fill="url(#${id})" stroke="#cfcfcf" stroke-width="0.8"/></svg></div>`;
}

// Documentul tipăribil, autonom, cu KaTeX (HTML complet). `embedded`: fără bara
// „Printează / Închide" — pentru vizualizatorul cu Profesorul Virtual alături
// (testele generate din Biblioteca utilizatorilor, /pdf-viewer?lib=<id>).
export function printDocumentHtml(title, bodyHtml, { embedded = false } = {}) {
  return `<!DOCTYPE html>
<html lang="ro"><head>
<meta charset="utf-8"/>
<meta name="viewport" content="width=device-width, initial-scale=1"/>
<title>${esc(title)}</title>
<link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/katex@0.16.11/dist/katex.min.css">
<style>
  * { box-sizing: border-box; }
  body { font-family: Georgia, 'Times New Roman', serif; color: #111; margin: 0; background: #f3f4f6; }
  .sheet { background: #fff; max-width: 820px; margin: 20px auto; padding: 48px 56px; box-shadow: 0 2px 12px rgba(0,0,0,.12); }
  .topbar { position: sticky; top: 0; display: flex; gap: 10px; justify-content: center; padding: 12px; background: #0f2b44; }
  .topbar button { background: #e8b931; color: #0f2b44; border: none; border-radius: 8px; padding: 10px 18px; font-weight: 700; font-size: 15px; cursor: pointer; font-family: system-ui, sans-serif; }
  .topbar button.ghost { background: transparent; color: #fff; border: 1px solid rgba(255,255,255,.4); }
  h1.exam-title { text-align: center; font-size: 20px; margin: 0 0 4px; }
  .exam-sub { text-align: center; font-size: 13px; color: #444; margin-bottom: 2px; }
  .rules { border-top: 1px solid #ccc; border-bottom: 1px solid #ccc; padding: 8px 0; margin: 16px 0 22px; font-size: 13px; text-align: center; color: #333; }
  .subject { margin: 22px 0; }
  .subject-head { font-weight: bold; text-transform: uppercase; border-bottom: 2px solid #0f2b44; padding-bottom: 4px; margin-bottom: 10px; display: flex; justify-content: space-between; font-size: 14px; letter-spacing: .02em; }
  .item { margin: 10px 0; display: flex; gap: 10px; }
  .item .num { font-weight: bold; min-width: 26px; }
  .item .body { flex: 1; }
  .pts { color: #666; font-size: 12px; white-space: nowrap; }
  .stmt { white-space: pre-wrap; line-height: 1.6; }
  /* Formulele KaTeX nu se mai taie sus (numărătorul fracțiilor): fiecare
     formulă devine un bloc propriu — rândul crește cât formula — și primește
     aer de protecție deasupra, compensat cu margin negativ (spațierea
     vizibilă rămâne neschimbată, dar nimic nu mai iese din cutia formulei). */
  .katex { display: inline-block; padding: .4em .05em .25em; margin: -.4em -.05em -.25em; }
  .katex-display .katex { display: block; }
  .barem-item { margin: 10px 0; padding: 10px 12px; background: #f7f9fc; border-radius: 8px; }
  .barem-item .ans { color: #1e7e34; font-weight: bold; }
  /* Figura geometrică: sub enunț, în dreapta paginii; textul și variantele
     curg în stânga ei (ca în subiectele oficiale). */
  .fig { float: right; margin: 2px 0 8px 16px; }
  .fig svg { display: block; }
  .item .body::after, .barem-item::after, .bp::after { content: ""; display: block; clear: both; }
  /* Spațiul de redactare a rezolvării (Subiectul al III-lea) */
  .solspace { margin: 6px 0 4px; }
  .solspace svg { display: block; width: 100%; }
  .solrow { display: flex; gap: 14px; align-items: flex-start; margin: 6px 0 0; }
  .solrow .space { flex: 1; min-width: 0; }
  .solrow .solspace { margin: 0; }
  .solrow .figcell { flex: 0 0 auto; }
  .solrow .figcell svg { display: block; }
  .opts { margin: 6px 0 2px 8px; }
  .opt { margin: 2px 0; line-height: 1.5; }
  /* variantele scurte pe un rând (ca în subiectele oficiale): 4 sau 2 coloane
     — o grilă nu mai ocupă jumătate de pagină (4 nov. 2026) */
  .opts.cols-4, .opts.cols-2 { display: grid; column-gap: 18px; row-gap: 2px; }
  .opts.cols-4 { grid-template-columns: repeat(4, minmax(0, 1fr)); }
  .opts.cols-2 { grid-template-columns: repeat(2, minmax(0, 1fr)); }
  /* BAREMUL, așezat ca baremele oficiale: grilele într-un tabel (nr. · răspuns ·
     punctaj · justificare), problemele cu subpunctele și rezolvarea lor */
  .bt { width: 100%; border-collapse: collapse; margin: 4px 0 8px; font-size: 13.5px; }
  .bt th, .bt td { border: 1px solid #cfd6df; padding: 4px 8px; text-align: left; vertical-align: top; line-height: 1.45; }
  .bt th { background: #eef2f7; color: #0f2b44; font-size: 12px; text-transform: uppercase; letter-spacing: .02em; }
  .bt td.n { width: 34px; font-weight: bold; text-align: center; }
  .bt td.r { width: 26%; }
  .bt td.p { width: 52px; text-align: center; white-space: nowrap; }
  .bt td.s { color: #333; font-size: 12.5px; }
  .bt tr { break-inside: avoid; }
  .bp { margin: 8px 0 10px; padding: 0 0 8px; border-bottom: 1px solid #e3e8ee; }
  .bp:last-child { border-bottom: none; }
  .bp .bh { display: flex; gap: 8px; align-items: baseline; }
  .bp .bh b.nr { min-width: 22px; }
  .bp .bst { color: #333; font-size: 13.5px; line-height: 1.5; white-space: pre-wrap; }
  .bp .bpart { margin: 5px 0 0 22px; font-size: 13.5px; line-height: 1.5; }
  .bp .bpart .sol, .bp .bsol { margin: 2px 0 0; padding-left: 10px; border-left: 3px solid #cfe3d3; font-size: 13px; }
  .bp .fig { margin: 0 0 6px 12px; }
  .ans { color: #1e7e34; font-weight: bold; }
  .part { margin: 6px 0 6px 8px; line-height: 1.6; }
  .part > b { color: #0f2b44; }
  .sol { white-space: pre-wrap; line-height: 1.55; color: #333; font-size: 14px; margin-top: 4px; }
  .foot { text-align: center; font-size: 11px; color: #888; margin-top: 30px; border-top: 1px solid #eee; padding-top: 8px; }
  .nameline { display: flex; gap: 18px; flex-wrap: wrap; justify-content: space-between; font-size: 13px; color: #222; margin: 12px 0 0; }
  .nameline span { white-space: nowrap; }
  /* mai multe teste într-un singur document (printExams): fiecare de la pagină nouă */
  .exam-doc + .exam-doc { border-top: 2px dashed #c9cdd3; margin-top: 40px; padding-top: 34px; }
  /* pe telefon (și în panoul îngust al vizualizatorului) foaia își strânge marginile */
  @media screen and (max-width: 640px) { .sheet { margin: 8px; padding: 22px 16px; } }
  @media print {
    body { background: #fff; }
    .topbar { display: none; }
    .sheet { box-shadow: none; margin: 0; max-width: none; padding: 0; }
    /* subiectele curg de la o pagină la alta (nu mai sar întregi pe pagina
       următoare, lăsând jumătăți de pagină goale); doar exercițiile nu se rup,
       iar titlul subiectului rămâne lângă primul exercițiu */
    .subject-head, .subject-instr { break-after: avoid; page-break-after: avoid; }
    .item, .barem-item, .bp { break-inside: avoid; }
    /* problemele cu spațiu de redactare pot curge pe mai multe pagini,
       dar caroiajele și figurile nu se taie la mijloc */
    .item.written { break-inside: auto; }
    .solrow, .solspace, .fig, .part, .wblock { break-inside: avoid; }
    .exam-doc + .exam-doc { border-top: none; margin-top: 0; padding-top: 0; break-before: page; page-break-before: always; }
  }
</style>
</head><body>
${embedded ? '' : `<div class="topbar">
  <button onclick="window.print()">🖨️ Printează / Salvează ca PDF</button>
  <button class="ghost" onclick="window.close()">Închide</button>
</div>`}
<div class="sheet">${bodyHtml}</div>
<script src="https://cdn.jsdelivr.net/npm/katex@0.16.11/dist/katex.min.js"></script>
<script src="https://cdn.jsdelivr.net/npm/katex@0.16.11/dist/contrib/auto-render.min.js"></script>
<script>
  function go(){ try { renderMathInElement(document.body, { delimiters: [
    {left:'$$',right:'$$',display:true},{left:'\\\\[',right:'\\\\]',display:true},
    {left:'$',right:'$',display:false},{left:'\\\\(',right:'\\\\)',display:false}
  ], throwOnError:false }); } catch(e){} }
  if (window.renderMathInElement) go(); else window.addEventListener('load', go);
</script>
</body></html>`;
}

// Deschide un document tipăribil, autonom, cu KaTeX.
export function openPrintDocument(title, bodyHtml) {
  const w = window.open('', '_blank');
  if (!w) { alert('Permite ferestrele pop-up pentru a deschide varianta PDF.'); return; }
  const doc = printDocumentHtml(title, bodyHtml);
  w.document.open();
  w.document.write(doc);
  w.document.close();
}

// ─── Așezarea în pagină (4 nov. 2026) ─────────────────────────────────────────
// Cererea: testele făcute de AI („🔢 Schimbă numerele și notațiile") să se
// „aranjeze în pagină mai bine". Un test de EN ocupa 8 pagini: prima doar cu
// antetul (subiectul întreg sărea pe pagina următoare), variantele grilelor una
// sub alta, baremul de 7 pagini. Acum: variantele scurte stau pe un rând (4 sau
// 2 coloane, ca în subiectele oficiale), subiectele curg de la o pagină la alta,
// iar baremul e așezat ca baremele oficiale (tabel la grile).

// cât text are o variantă, fără LaTeX: „$\frac{3}{5}$" ≈ „3/5"
export function plainLen(s) {
  let t = String(s == null ? '' : s);
  t = t.replace(/\\[dt]?frac\s*\{([^{}]*)\}\s*\{([^{}]*)\}/g, '$1/$2')
    .replace(/\\sqrt\s*\{([^{}]*)\}/g, 'v$1')
    .replace(/\\(?:left|right|,|;|!|quad|qquad)/g, '')
    .replace(/\\[a-zA-Z]+/g, 'x')
    .replace(/[$\\{}^_]/g, '')
    .replace(/\s+/g, ' ');
  return t.trim().length;
}
// câte coloane au variantele unui item: 4 (scurte), 2 (medii) sau 1 (lungi)
export function optCols(options) {
  const list = Array.isArray(options) ? options : [];
  if (!list.length) return 1;
  const L = Math.max(...list.map(plainLen));
  if (list.length <= 2) return L <= 34 ? 2 : 1;        // Adevărat / Fals
  if (L <= 13) return 4;
  if (L <= 34) return 2;
  return 1;
}

// testul generat „fără barem" (doar enunțurile — 4 nov. 2026)
export const examNoBarem = (exam) => !!(exam && exam.noBarem);

// ─── Test de examen ──────────────────────────────────────────────────────────
// `workSpace` (spațiul de lucru = caroiajul de sub probleme): implicit cel ales
// la generare și păstrat în test (`exam.workSpace === false` → fără); un apel
// îl poate cere explicit. Fără spațiu, testul încape pe mai puține pagini, iar
// elevii scriu rezolvările pe o foaie separată.
export function printExam(exam, { withSolutions = false, workSpace } = {}) {
  // titlul ferestrei = numele fișierului la „Salvează ca PDF" (la un set de
  // variante: „25 de teste grilă diferite, pentru 25 de elevi" / „Barem · …")
  const t = exam.title || 'Model de test';
  const title = withSolutions && Array.isArray(exam.variants) && exam.variants.length ? `Barem · ${t}` : t;
  openPrintDocument(title, examBodyHtml(exam, { withSolutions, workSpace }));
}
// MAI MULTE TESTE într-un singur document, fiecare de la pagină nouă (1 nov.
// 2026: „👥 Teste diferite / elev" → „🖨 Tipărește toate testele" — câte un
// test pentru fiecare elev, la o singură tipărire).
export function examsBodyHtml(exams, { withSolutions = false, workSpace } = {}) {
  return (exams || []).filter(Boolean)
    .map((ex) => `<section class="exam-doc">${examBodyHtml(ex, { withSolutions, workSpace })}</section>`).join('');
}
export function printExams(exams, { withSolutions = false, workSpace, title = null } = {}) {
  const list = (exams || []).filter(Boolean);
  if (!list.length) return;
  openPrintDocument(title || (list.length === 1 ? list[0].title : `${list.length} teste`), examsBodyHtml(list, { withSolutions, workSpace }));
}
// Același test, ca document HTML întreg (vizualizatorul cu Profesorul Virtual)
export function examDocumentHtml(exam, { withSolutions = false, embedded = true, workSpace } = {}) {
  return printDocumentHtml(exam.title || 'Model de test', examBodyHtml(exam, { withSolutions, workSpace }), { embedded });
}

// Testul are spațiu de lucru? (opțiunea apelului > alegerea salvată în test > da)
export function hasWorkSpace(exam, workSpace) {
  if (typeof workSpace === 'boolean') return workSpace;
  return !(exam && exam.workSpace === false);
}

export function examBodyHtml(exam, { withSolutions = false, workSpace } = {}) {
  // un SET de teste diferite („25 de teste grilă diferite, pentru 25 de elevi",
  // 1 nov. 2026 — src/lib/testeSet.js): fiecare variantă e un test întreg, cu
  // titlul „Varianta k", de la pagină nouă
  if (Array.isArray(exam && exam.variants) && exam.variants.length) {
    return exam.variants.filter(Boolean)
      .map((v) => `<section class="exam-doc">${examBodyHtml(v, { withSolutions, workSpace })}</section>`).join('');
  }
  const subjects = Array.isArray(exam.subjects) ? exam.subjects : [];
  // fără spațiu de lucru, dar cu probleme de redactat → elevul află unde scrie
  const anyWritten = subjects.some((s) => (Array.isArray(s.items) ? s.items : []).some((it) =>
    (Array.isArray(it.parts) && it.parts.length) || !(Array.isArray(it.options) && it.options.length)));
  const separateSheet = !withSolutions && exam.oficiu != null && !hasWorkSpace(exam, workSpace) && anyWritten;
  // `subtitle` (ex. „Exerciții din fișa …") și `nameLine` (rândul pentru numele
  // elevului) — testele din fișele claselor, tipărite câte unul pentru fiecare elev
  const header = `
    <h1 class="exam-title">${esc(exam.title || 'Model de test')}</h1>
    <div class="exam-sub">${exam.subtitle ? esc(exam.subtitle) : 'Model de pregătire · generat de Profesorul Virtual'}</div>
    ${exam.nameLine && !withSolutions ? '<div class="nameline"><span>Numele și prenumele: ______________________________</span><span>Clasa: ________</span><span>Data: ____________</span></div>' : ''}
    <div class="rules">
      Toate subiectele sunt obligatorii.${exam.oficiu === 0 ? '' : ` Se acordă ${exam.oficiu ?? 10} puncte din oficiu.`}<br/>
      Timp de lucru: ${exam.durationMin || 120} de minute · Total: ${exam.totalPoints || 100} de puncte
      ${withSolutions ? ' · <strong>BAREM DE CORECTARE</strong>' : ''}
      ${separateSheet ? '<br/>Rezolvările complete se scriu pe o foaie separată.' : ''}
    </div>`;

  // punctajul itemului; la problemele punctate doar pe subpuncte (BAC) — suma lor
  const ptsOf = (it) => {
    if (it.points != null && it.points !== '') return it.points;
    const ps = Array.isArray(it.parts) ? it.parts.map((p) => Number(p && p.points)).filter((x) => Number.isFinite(x)) : [];
    return ps.length ? ps.reduce((a, b) => a + b, 0) : null;
  };
  const ptsCell = (it) => { const v = ptsOf(it); return `<div class="pts">${v != null ? `${v}p` : ''}</div>`; };
  const optsHtml = (options) => {
    const c = optCols(options);
    return `<div class="opts${c > 1 ? ` cols-${c}` : ''}">${options.map((o, i) => `<div class="opt"><b>${String.fromCharCode(97 + i)})</b> ${esc(o)}</div>`).join('')}</div>`;
  };
  const partsHtml = (parts, withSol) =>
    parts.map((p) => `<div class="part"><b>${esc(p.label || '')})</b> ${esc(p.text || '')}${(withSol && p.points != null) ? ` <span class="pts">(${p.points}p)</span>` : ''}${(withSol && p.solution) ? `<div class="sol">${esc(p.solution)}</div>` : ''}</div>`).join('');

  // Subiect „oficial" (are puncte din oficiu) → problemele cu rezolvare scrisă
  // primesc spațiu de redactare, ca în modelele reale de examen — dacă
  // profesorul nu l-a generat „fără spațiu de lucru".
  const isOfficial = exam.oficiu != null && hasWorkSpace(exam, workSpace);

  // Problemă cu rezolvare scrisă (Subiectul al III-lea / itemii fără grilă):
  // figura în dreapta, spațiu de redactare în stânga figurii și dedesubtul ei,
  // respectiv sub fiecare cerință la problemele fără figură.
  // (4 nov. 2026) fiecare cerință stă într-un bloc cu caroiajul ei (`.wblock`, nu
  // se rupe la tipărire): enunțul nu mai rămâne singur jos pe pagină, cu spațiul
  // de lucru pe pagina următoare; enunțul problemei stă cu prima cerință.
  const writtenBody = (it, fig) => {
    const parts = Array.isArray(it.parts) ? it.parts : [];
    const st = `<span class="stmt">${esc(it.statement || '')}</span>`;
    const figRow = fig
      ? `<div class="solrow"><div class="space">${solutionSpace(Math.max(fig.h, 120))}</div><div class="figcell">${fig.svg}</div></div>`
      : '';
    if (!parts.length) {
      return `<div class="wblock">${st}${fig ? figRow + solutionSpace(90) : solutionSpace(235)}</div>`;
    }
    return parts.map((p, pi) => {
      const head = pi === 0 ? st : '';
      const line = `<div class="part"><b>${p.points != null ? `(${p.points}p) ` : ''}${esc(p.label || '')})</b> ${esc(p.text || '')}</div>`;
      const space = pi === 0 && fig ? figRow + solutionSpace(66) : solutionSpace(pi === 0 ? 150 : 215);
      return `<div class="wblock">${head}${line}${space}</div>`;
    }).join('');
  };

  // ── BAREMUL, așezat ca baremele oficiale ──
  // grilele: un tabel (nr. · răspunsul corect · punctaj · justificarea scurtă);
  // problemele: enunțul, apoi fiecare subpunct cu punctajul și rezolvarea lui
  const optLetter = (it) => {
    const a = String(it.answer == null ? '' : it.answer).trim();
    const k = /^[a-j]$/i.test(a) ? a.toLowerCase().charCodeAt(0) - 97 : -1;
    const val = k >= 0 && Array.isArray(it.options) ? it.options[k] : null;
    return a ? `<b>${esc(a)})</b>${val != null ? ` ${esc(val)}` : ''}` : '—';
  };
  const baremGrila = (items) => {
    const withSol = items.some((it) => it.solution && String(it.solution).trim());
    return `<table class="bt"><thead><tr><th>Nr.</th><th>Răspuns corect</th><th>Punctaj</th>${withSol ? '<th>Justificare</th>' : ''}</tr></thead><tbody>${items.map((it) => `<tr>
      <td class="n">${esc(it.number || '')}.</td><td class="r">${optLetter(it)}</td><td class="p">${it.points ?? ''}p</td>${withSol ? `<td class="s">${esc(it.solution || '')}</td>` : ''}
    </tr>`).join('')}</tbody></table>`;
  };
  const baremProblema = (it) => {
    const hasOptions = Array.isArray(it.options) && it.options.length;
    const hasParts = Array.isArray(it.parts) && it.parts.length;
    const fig = itemFigure(it, 0.6);
    const parts = hasParts ? it.parts.map((p) => `<div class="bpart"><b>${esc(p.label || '')})</b>${p.points != null ? ` <span class="pts">(${p.points}p)</span>` : ''} ${esc(p.text || '')}${p.solution ? `<div class="sol">${esc(p.solution)}</div>` : ''}</div>`).join('') : '';
    return `<div class="bp">
      ${figFloat(fig)}
      <div class="bh"><b class="nr">${esc(it.number || '')}.</b><span class="bst">${esc(it.statement || '')}</span>${ptsOf(it) != null ? ` <span class="pts">(${ptsOf(it)}p)</span>` : ''}</div>
      ${hasOptions ? optsHtml(it.options) : ''}
      ${hasOptions && it.answer ? `<div class="ans" style="margin-left:22px">Răspuns corect: ${optLetter(it)}</div>` : ''}
      ${parts}
      ${(!hasOptions && it.answer) ? `<div class="ans" style="margin-left:22px">Răspuns: ${esc(it.answer)}</div>` : ''}
      ${(!hasParts && it.solution) ? `<div class="bsol sol" style="margin-left:22px">${esc(it.solution)}</div>` : ''}
    </div>`;
  };

  const body = subjects.map((s) => {
    const items = Array.isArray(s.items) ? s.items : [];
    if (withSolutions) {
      const allGrila = items.length > 0 && items.every((it) => Array.isArray(it.options) && it.options.length && !(Array.isArray(it.parts) && it.parts.length));
      return `<div class="subject">
      <div class="subject-head"><span>${esc(s.label || '')}</span><span class="pts">${s.points ?? ''} puncte</span></div>
      ${allGrila ? baremGrila(items) : items.map(baremProblema).join('')}
    </div>`;
    }
    const rows = items.map((it) => {
      const hasOptions = Array.isArray(it.options) && it.options.length;
      const hasParts = Array.isArray(it.parts) && it.parts.length;
      // la grile, figura puțin mai mică (exercițiul nu mai crește cât figura)
      const fig = itemFigure(it, hasOptions && !hasParts ? 0.78 : 1);
      const written = isOfficial && (hasParts || !hasOptions);
      if (written) {
        return `<div class="item written">
          <div class="num">${esc(it.number || '')}.</div>
          <div class="body">${writtenBody(it, fig)}</div>
          ${ptsCell(it)}
        </div>`;
      }
      return `<div class="item">
        <div class="num">${esc(it.number || '')}.</div>
        <div class="body">
          <span class="stmt">${esc(it.statement || '')}</span>
          ${figFloat(fig)}
          ${hasOptions ? optsHtml(it.options) : ''}
          ${hasParts ? partsHtml(it.parts, false) : ''}
        </div>
        ${ptsCell(it)}
      </div>`;
    }).join('');
    return `<div class="subject">
      <div class="subject-head"><span>${esc(s.label || '')}</span><span class="pts">${s.points ?? ''} puncte</span></div>
      ${s.instructions ? `<div class="subject-instr" style="font-size:13px;color:#444;margin-bottom:8px">${esc(s.instructions)}</div>` : ''}
      ${rows}
    </div>`;
  }).join('');

  const foot = `<div class="foot">${exam.footNote ? esc(exam.footNote) : 'Material de pregătire generat automat — poate conține mici erori. Nu este un subiect oficial.'}</div>`;
  return header + body + foot;
}

// ─── Un singur exercițiu (fișă de lucru) ─────────────────────────────────────
export function printExercise(ex) {
  const header = `
    <h1 class="exam-title">Fișă de exercițiu</h1>
    <div class="exam-sub">${esc(ex.topic || '')} · generat de Profesorul Virtual</div>
    <div class="rules">Rezolvă exercițiul, apoi verifică-te cu rezolvarea de mai jos.</div>`;
  const body = `
    <div class="subject">
      <div class="subject-head"><span>Enunț</span></div>
      <div class="stmt" style="font-size:16px">${esc(ex.statement || '')}</div>
    </div>
    ${Array.isArray(ex.options) && ex.options.length ? `<div class="stmt" style="margin:8px 0">${ex.options.map((o, i) => `${String.fromCharCode(65 + i)}) ${esc(o)}`).join('&nbsp;&nbsp;&nbsp;')}</div>` : ''}
    <div class="subject">
      <div class="subject-head"><span>Rezolvare</span></div>
      ${ex.answer ? `<div class="barem-item"><span class="ans">Răspuns final: ${esc(ex.answer)}</span></div>` : ''}
      <div class="sol" style="font-size:15px">${esc(ex.solution || '')}</div>
    </div>`;
  const foot = `<div class="foot">Generat automat — poate conține mici erori.</div>`;
  openPrintDocument('Fișă de exercițiu', header + body + foot);
}
