// =====================================================================
// src/lib/examPrint.js — export „PDF" prin fereastra de print a browserului
// Redă frumos formulele (KaTeX din CDN) și oferă „Salvează ca PDF".
// =====================================================================

function esc(s = '') {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
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
  .barem-item { margin: 10px 0; padding: 10px 12px; background: #f7f9fc; border-radius: 8px; }
  .barem-item .ans { color: #1e7e34; font-weight: bold; }
  .sol { white-space: pre-wrap; line-height: 1.55; color: #333; font-size: 14px; margin-top: 4px; }
  .foot { text-align: center; font-size: 11px; color: #888; margin-top: 30px; border-top: 1px solid #eee; padding-top: 8px; }
  @media print {
    body { background: #fff; }
    .topbar { display: none; }
    .sheet { box-shadow: none; margin: 0; max-width: none; padding: 0; }
    .subject { break-inside: avoid; }
    .item, .barem-item { break-inside: avoid; }
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

  const body = subjects.map((s) => {
    const items = Array.isArray(s.items) ? s.items : [];
    const rows = items.map((it) => {
      if (withSolutions) {
        return `<div class="barem-item">
          <div><strong>${esc(it.number || '')}.</strong> <span class="stmt">${esc(it.statement || '')}</span> <span class="pts">(${it.points ?? ''}p)</span></div>
          ${it.answer ? `<div class="ans">Răspuns: ${esc(it.answer)}</div>` : ''}
          ${it.solution ? `<div class="sol">${esc(it.solution)}</div>` : ''}
        </div>`;
      }
      return `<div class="item">
        <div class="num">${esc(it.number || '')}.</div>
        <div class="body"><span class="stmt">${esc(it.statement || '')}</span></div>
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
