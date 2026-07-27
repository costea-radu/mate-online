// =====================================================================
// src/lib/examPrint.js — export „PDF" prin fereastra de print a browserului
// Redă frumos formulele (KaTeX din CDN) și oferă „Salvează ca PDF".
// =====================================================================

import { autoMath } from './katex';
import { renderFigure } from './figureRender';

function esc(s = '') {
  return String(autoMath(s || '')).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
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

// Deschide un document tipăribil, autonom, cu KaTeX.
export function openPrintDocument(title, bodyHtml) {
  const w = window.open('', '_blank');
  if (!w) { alert('Permite ferestrele pop-up pentru a deschide varianta PDF.'); return; }
  const doc = `<!DOCTYPE html>
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
  .item { margin: 12px 0; display: flex; gap: 10px; }
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
  .item .body::after, .barem-item::after { content: ""; display: block; clear: both; }
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
  .part { margin: 6px 0 6px 8px; line-height: 1.6; }
  .part > b { color: #0f2b44; }
  .sol { white-space: pre-wrap; line-height: 1.55; color: #333; font-size: 14px; margin-top: 4px; }
  .foot { text-align: center; font-size: 11px; color: #888; margin-top: 30px; border-top: 1px solid #eee; padding-top: 8px; }
  @media print {
    body { background: #fff; }
    .topbar { display: none; }
    .sheet { box-shadow: none; margin: 0; max-width: none; padding: 0; }
    .subject { break-inside: avoid; }
    .item, .barem-item { break-inside: avoid; }
    /* problemele cu spațiu de redactare pot curge pe mai multe pagini,
       dar caroiajele și figurile nu se taie la mijloc */
    .item.written { break-inside: auto; }
    .solrow, .solspace, .fig, .part { break-inside: avoid; }
  }
</style>
</head><body>
<div class="topbar">
  <button onclick="window.print()">🖨️ Printează / Salvează ca PDF</button>
  <button class="ghost" onclick="window.close()">Închide</button>
</div>
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
  w.document.open();
  w.document.write(doc);
  w.document.close();
}

// ─── Test de examen ──────────────────────────────────────────────────────────
export function printExam(exam, { withSolutions = false } = {}) {
  const subjects = Array.isArray(exam.subjects) ? exam.subjects : [];
  const header = `
    <h1 class="exam-title">${esc(exam.title || 'Model de test')}</h1>
    <div class="exam-sub">Model de pregătire · generat de Profesorul Virtual</div>
    <div class="rules">
      Toate subiectele sunt obligatorii. Se acordă ${exam.oficiu ?? 10} puncte din oficiu.<br/>
      Timp de lucru: ${exam.durationMin || 120} de minute · Total: ${exam.totalPoints || 100} de puncte
      ${withSolutions ? ' · <strong>BAREM DE CORECTARE</strong>' : ''}
    </div>`;

  const optsHtml = (options) =>
    `<div class="opts">${options.map((o, i) => `<div class="opt"><b>${String.fromCharCode(97 + i)})</b> ${esc(o)}</div>`).join('')}</div>`;
  const partsHtml = (parts, withSol) =>
    parts.map((p) => `<div class="part"><b>${esc(p.label || '')})</b> ${esc(p.text || '')}${(withSol && p.points != null) ? ` <span class="pts">(${p.points}p)</span>` : ''}${(withSol && p.solution) ? `<div class="sol">${esc(p.solution)}</div>` : ''}</div>`).join('');

  // Subiect „oficial" (are puncte din oficiu) → problemele cu rezolvare scrisă
  // primesc spațiu de redactare, ca în modelele reale de examen.
  const isOfficial = exam.oficiu != null;

  // Problemă cu rezolvare scrisă (Subiectul al III-lea / itemii fără grilă):
  // figura în dreapta, spațiu de redactare în stânga figurii și dedesubtul ei,
  // respectiv sub fiecare cerință la problemele fără figură.
  const writtenBody = (it, fig) => {
    const parts = Array.isArray(it.parts) ? it.parts : [];
    let out = `<span class="stmt">${esc(it.statement || '')}</span>`;
    const figRow = fig
      ? `<div class="solrow"><div class="space">${solutionSpace(Math.max(fig.h, 120))}</div><div class="figcell">${fig.svg}</div></div>`
      : '';
    if (!parts.length) {
      out += fig ? figRow + solutionSpace(90) : solutionSpace(235);
      return out;
    }
    parts.forEach((p, pi) => {
      out += `<div class="part"><b>${p.points != null ? `(${p.points}p) ` : ''}${esc(p.label || '')})</b> ${esc(p.text || '')}</div>`;
      if (pi === 0 && fig) out += figRow + solutionSpace(66);
      else out += solutionSpace(pi === 0 ? 150 : 215);
    });
    return out;
  };

  const body = subjects.map((s) => {
    const items = Array.isArray(s.items) ? s.items : [];
    const rows = items.map((it) => {
      const hasOptions = Array.isArray(it.options) && it.options.length;
      const hasParts = Array.isArray(it.parts) && it.parts.length;
      if (withSolutions) {
        const fig = itemFigure(it, 0.82);
        return `<div class="barem-item">
          ${figFloat(fig)}
          <div><strong>${esc(it.number || '')}.</strong> <span class="stmt">${esc(it.statement || '')}</span> <span class="pts">(${it.points ?? ''}p)</span></div>
          ${hasOptions ? optsHtml(it.options) : ''}
          ${hasOptions && it.answer ? `<div class="ans">Răspuns corect: ${esc(it.answer)}</div>` : ''}
          ${hasParts ? partsHtml(it.parts, true) : ''}
          ${(!hasOptions && it.answer) ? `<div class="ans">Răspuns: ${esc(it.answer)}</div>` : ''}
          ${(!hasParts && it.solution) ? `<div class="sol">${esc(it.solution)}</div>` : ''}
        </div>`;
      }
      const fig = itemFigure(it);
      const written = isOfficial && (hasParts || !hasOptions);
      if (written) {
        return `<div class="item written">
          <div class="num">${esc(it.number || '')}.</div>
          <div class="body">${writtenBody(it, fig)}</div>
          <div class="pts">${it.points ?? ''}p</div>
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
        <div class="pts">${it.points ?? ''}p</div>
      </div>`;
    }).join('');
    return `<div class="subject">
      <div class="subject-head"><span>${esc(s.label || '')}</span><span class="pts">${s.points ?? ''} puncte</span></div>
      ${s.instructions ? `<div style="font-size:13px;color:#444;margin-bottom:8px">${esc(s.instructions)}</div>` : ''}
      ${rows}
    </div>`;
  }).join('');

  const foot = `<div class="foot">Material de pregătire generat automat — poate conține mici erori. Nu este un subiect oficial.</div>`;
  openPrintDocument(exam.title || 'Model de test', header + body + foot);
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
