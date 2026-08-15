// =====================================================================
// src/lib/exerciseRender.js — randează exercițiile AGENTULUI CLAUDE
// (grilă sau cu etape de rezolvare) ca HTML autonom, jucabil în iframe.
// Suportă: indicii la cerere, punctaj per item (barem), explicații după
// verificare, raportare scor prin postMessage({type:'MATE_SCORE'}).
// Formatul `exercise` = cel produs de api/ai-exercise-agent.js.
// =====================================================================
import { autoMath } from './katex';

function esc(s = '') {
  return String(autoMath(s || '')).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

const HEAD = `<!doctype html><html lang="ro"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/katex@0.16.11/dist/katex.min.css">
<style>
  body{font-family:system-ui,-apple-system,'Segoe UI',sans-serif;color:#0f2b44;margin:0;padding:16px;background:#fff;line-height:1.6}
  h1{font-size:1.15rem;margin:0 0 6px}
  .total{font-size:.82rem;color:#667;margin-bottom:14px}
  .enunt{background:#f7f9fc;border:1px solid #e6e9ef;border-radius:12px;padding:14px;margin-bottom:14px}
  .q{border:1px solid #e6e9ef;border-radius:12px;padding:14px;margin-bottom:12px}
  .stmt{font-size:1.02rem;margin-bottom:10px}
  .pts{float:right;font-size:.75rem;font-weight:700;color:#8a6d00;background:#fff4e5;border-radius:20px;padding:2px 10px;margin-left:8px}
  .opt{display:flex;align-items:center;gap:8px;padding:8px 10px;border:1px solid #e6e9ef;border-radius:8px;margin-bottom:6px;cursor:pointer}
  .opt:hover{background:#f7f9fc}
  .txt{width:100%;padding:9px 11px;border:1px solid #ccd3dd;border-radius:8px;font-size:.95rem;box-sizing:border-box}
  .hintBtn{background:none;border:1px dashed #c49a1a;color:#8a6d00;border-radius:8px;padding:5px 10px;font-size:.78rem;cursor:pointer;margin-top:8px}
  .hint{display:none;margin-top:8px;font-size:.85rem;background:#fff9e8;border-radius:8px;padding:8px 10px;color:#6b5400}
  .fb{margin-top:8px;font-size:.9rem;font-weight:600}
  .ok{color:#1e7e34}.bad{color:#c0392b}
  .exp{margin-top:6px;font-weight:400;color:#444;font-size:.86rem;background:#f7f9fc;border-radius:8px;padding:8px 10px}
  button.main{background:#e8b931;color:#0f2b44;border:none;border-radius:10px;padding:11px 20px;font-weight:700;font-size:.95rem;cursor:pointer;margin-top:6px}
  .res{font-size:1.1rem;font-weight:800;margin:12px 0}
  .barem{font-size:.85rem;color:#445;margin-top:4px}
  .final{background:#eef7f0;border:1px solid #cde8d4;border-radius:10px;padding:10px 12px;margin-top:10px;display:none}
</style></head><body>`;

const KATEX = `<script src="https://cdn.jsdelivr.net/npm/katex@0.16.11/dist/katex.min.js"><\/script>
<script src="https://cdn.jsdelivr.net/npm/katex@0.16.11/dist/contrib/auto-render.min.js"><\/script>
<script>
  function rmath(){ if(window.renderMathInElement) renderMathInElement(document.body,{delimiters:[{left:'$$',right:'$$',display:true},{left:'$',right:'$',display:false}],throwOnError:false}); }
  if(window.renderMathInElement) rmath(); else window.addEventListener('load', rmath);
  function norm(s){return String(s||'').trim().toLowerCase().replace(',','.').replace(/\\s+/g,'');}
  function showHint(i){var h=document.getElementById('hint'+i);h.style.display=h.style.display==='block'?'none':'block';rmath();}
<\/script>`;

export function renderExercise(exercise) {
  const ex = exercise || {};
  return ex.kind === 'etape' ? renderEtape(ex) : renderGrila(ex);
}

function itemShell(i, inner, pts, hint) {
  return `<div class="q">
    <span class="pts">${pts} p</span>
    ${inner}
    ${hint ? `<button class="hintBtn" onclick="showHint(${i})">💡 Indiciu</button><div class="hint" id="hint${i}">${esc(hint)}</div>` : ''}
    <div class="fb" id="fb${i}"></div>
  </div>`;
}

function renderGrila(ex) {
  const qs = Array.isArray(ex.questions) ? ex.questions : [];
  const total = qs.reduce((s, q) => s + (Number(q.points) || 0), 0);
  const items = qs.map((q, i) => {
    const hasOpts = Array.isArray(q.options) && q.options.length > 0;
    const body = hasOpts
      ? `<div>${q.options.map((o, oi) => `<label class="opt"><input type="radio" name="q${i}" value="${oi}"> <b>${String.fromCharCode(65 + oi)})</b> <span>${esc(o)}</span></label>`).join('')}</div>`
      : `<input class="txt" type="text" name="q${i}" placeholder="Răspunsul tău">`;
    return itemShell(i, `<div class="stmt"><b>${i + 1}.</b> ${esc(q.statement)}</div>${body}`, q.points || 0, q.hint);
  }).join('');

  const data = qs.map((q) => ({
    t: Array.isArray(q.options) && q.options.length ? 'c' : 'o',
    a: Array.isArray(q.options) && q.options.length ? Number(q.answer) : String(q.answer ?? ''),
    p: Number(q.points) || 0,
    e: esc(q.explanation || ''), // escapat: se afișează prin innerHTML (matematica $..$ rămâne)
  }));

  return `${HEAD}
  <h1>${esc(ex.title || 'Exercițiu grilă')}</h1>
  <div class="total">Barem: ${total} puncte</div>
  ${ex.statement ? `<div class="enunt">${esc(ex.statement)}</div>` : ''}
  ${items}
  <button class="main" id="check">Verifică</button>
  <div class="res" id="res"></div>
  ${KATEX}
<script>
  var D=${JSON.stringify(data).replace(/</g, '\\u003c')};
  document.getElementById('check').addEventListener('click', function(){
    var got=0, max=0;
    for(var i=0;i<D.length;i++){
      max+=D[i].p; var ok=false;
      if(D[i].t==='c'){ var s=document.querySelector('input[name="q'+i+'"]:checked'); ok=s&&Number(s.value)===D[i].a; }
      else { var el=document.querySelector('input[name="q'+i+'"]'); ok=el&&norm(el.value)===norm(D[i].a); }
      if(ok) got+=D[i].p;
      var fb=document.getElementById('fb'+i);
      fb.className='fb '+(ok?'ok':'bad');
      fb.innerHTML=(ok?'✓ Corect (+'+D[i].p+' p)':'✗ Greșit (0 p)')+(D[i].e?'<div class="exp"><b>Rezolvare:</b> '+D[i].e+'</div>':'');
    }
    rmath();
    var pct=max?Math.round(got/max*100):0;
    document.getElementById('res').innerHTML='Punctaj: '+got+' / '+max+' puncte ('+pct+'%)';
    var MSG={type:'MATE_SCORE',score:pct,maxScore:100};
    try{ parent.postMessage(MSG,'*'); }catch(e){}
    try{ if(window.opener) window.opener.postMessage(MSG,'*'); }catch(e){}
  });
<\/script></body></html>`;
}

function renderEtape(ex) {
  const steps = Array.isArray(ex.steps) ? ex.steps : [];
  const total = steps.reduce((s, x) => s + (Number(x.points) || 0), 0);
  const items = steps.map((s, i) => itemShell(
    i,
    `<div class="stmt"><b>Etapa ${i + 1}.</b> ${esc(s.prompt)}</div><input class="txt" type="text" name="q${i}" placeholder="Răspunsul etapei">`,
    s.points || 0, s.hint,
  )).join('');

  const data = steps.map((s) => ({ a: String(s.answer ?? ''), p: Number(s.points) || 0, e: esc(s.explanation || '') }));

  return `${HEAD}
  <h1>${esc(ex.title || 'Problemă cu etape de rezolvare')}</h1>
  <div class="total">Barem: ${total} puncte · ${steps.length} etape</div>
  <div class="enunt"><b>Enunț.</b> ${esc(ex.statement || '')}</div>
  ${items}
  <button class="main" id="check">Verifică rezolvarea</button>
  <div class="res" id="res"></div>
  <div class="final" id="final"><b>Răspuns final:</b> <span>${esc(ex.final_answer || '')}</span></div>
  ${KATEX}
<script>
  var D=${JSON.stringify(data).replace(/</g, '\\u003c')};
  document.getElementById('check').addEventListener('click', function(){
    var got=0, max=0;
    for(var i=0;i<D.length;i++){
      max+=D[i].p;
      var el=document.querySelector('input[name="q'+i+'"]');
      var ok=el&&norm(el.value)===norm(D[i].a);
      if(ok) got+=D[i].p;
      var fb=document.getElementById('fb'+i);
      fb.className='fb '+(ok?'ok':'bad');
      var ad=String(D[i].a).replace(/[&<>]/g,function(c){return c==='&'?'&amp;':c==='<'?'&lt;':'&gt;';}); // răspunsul escapat DOAR pt. afișare (comparația rămâne pe D[i].a brut)
      fb.innerHTML=(ok?'✓ Corect (+'+D[i].p+' p)':'✗ Greșit (0 p) — răspuns corect: '+ad)+(D[i].e?'<div class="exp"><b>Barem/rezolvare:</b> '+D[i].e+'</div>':'');
    }
    rmath();
    document.getElementById('final').style.display='block';
    var pct=max?Math.round(got/max*100):0;
    document.getElementById('res').innerHTML='Punctaj: '+got+' / '+max+' puncte ('+pct+'%)';
    var MSG={type:'MATE_SCORE',score:pct,maxScore:100};
    try{ parent.postMessage(MSG,'*'); }catch(e){}
    try{ if(window.opener) window.opener.postMessage(MSG,'*'); }catch(e){}
  });
<\/script></body></html>`;
}

// ─── Document PDF (A4, pentru tipărire / „Salvează ca PDF”) ─────────────────
// solutions=true adaugă pagina „Barem de corectare și rezolvări”.
// autoPrint=true deschide automat dialogul de tipărire după randarea formulelor.
export function renderPrintDoc(exercise, { solutions = true, autoPrint = false } = {}) {
  const ex = exercise || {};
  const isEtape = ex.kind === 'etape';
  const items = (isEtape ? ex.steps : ex.questions) || [];
  const total = items.reduce((s, it) => s + (Number(it.points) || 0), 0);

  const body = items.map((it, i) => {
    const pts = `<span class="p">(${it.points || 0} p)</span>`;
    if (isEtape) {
      return `<div class="item"><b>${i + 1}.</b> ${esc(it.prompt)} ${pts}
        <div class="ans">Răspuns: ................................................................</div></div>`;
    }
    const opts = Array.isArray(it.options) && it.options.length
      ? `<div class="opts">${it.options.map((o, oi) => `<span class="o">${String.fromCharCode(97 + oi)}) ${esc(o)}</span>`).join('')}</div>`
      : `<div class="ans">Răspuns: ................................................................</div>`;
    return `<div class="item"><b>${i + 1}.</b> ${esc(it.statement)} ${pts}${opts}</div>`;
  }).join('');

  const sol = solutions ? `<div class="pagebreak"></div>
    <h2>Barem de corectare și rezolvări</h2>
    ${items.map((it, i) => {
      const right = isEtape
        ? esc(String(it.answer ?? ''))
        : (Array.isArray(it.options) && it.options.length
          ? `${String.fromCharCode(97 + (Number(it.answer) || 0))}) ${esc(it.options[Number(it.answer) || 0] || '')}`
          : esc(String(it.answer ?? '')));
      return `<div class="sitem"><b>${i + 1}.</b> <b>Răspuns:</b> ${right} <span class="p">(${it.points || 0} p)</span>
        ${it.explanation ? `<div class="sexp">${esc(it.explanation)}</div>` : ''}</div>`;
    }).join('')}
    ${isEtape && ex.final_answer ? `<div class="sitem"><b>Răspuns final:</b> ${esc(ex.final_answer)}</div>` : ''}` : '';

  return `<!doctype html><html lang="ro"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(ex.title || 'Exercițiu')}</title>
<link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/katex@0.16.11/dist/katex.min.css">
<style>
  @page { size: A4; margin: 16mm; }
  body{font-family:Georgia,'Times New Roman',serif;color:#111;margin:0;padding:24px;line-height:1.65;font-size:12.5pt}
  h1{font-size:1.25rem;margin:0 0 2px} h2{font-size:1.05rem;margin:0 0 12px}
  .sub{font-size:.85rem;color:#555;margin-bottom:16px;border-bottom:1.5px solid #111;padding-bottom:8px}
  .enunt{margin-bottom:14px}
  .item{margin-bottom:14px}
  .p{color:#555;font-size:.85rem;white-space:nowrap}
  .opts{margin:6px 0 0 18px;display:flex;flex-wrap:wrap;gap:6px 26px}
  .ans{margin:8px 0 0 18px;color:#777}
  .sitem{margin-bottom:10px}
  .sexp{margin:4px 0 0 18px;color:#333;font-size:.95em}
  .pagebreak{page-break-before:always}
  @media print { body{padding:0} }
</style></head><body>
  <h1>${esc(ex.title || 'Exercițiu')}</h1>
  <div class="sub">ExamenMate · ${isEtape ? items.length + ' etape' : items.length + ' itemi'} · Barem: ${total} puncte</div>
  ${ex.statement ? `<div class="enunt"><b>${isEtape ? 'Enunț. ' : ''}</b>${esc(ex.statement)}</div>` : ''}
  ${body}
  ${sol}
<script src="https://cdn.jsdelivr.net/npm/katex@0.16.11/dist/katex.min.js"><\/script>
<script src="https://cdn.jsdelivr.net/npm/katex@0.16.11/dist/contrib/auto-render.min.js"><\/script>
<script>
  function rmath(){ if(window.renderMathInElement) renderMathInElement(document.body,{delimiters:[{left:'$$',right:'$$',display:true},{left:'$',right:'$',display:false}],throwOnError:false}); }
  window.addEventListener('load', function(){ rmath(); ${autoPrint ? 'setTimeout(function(){ window.print(); }, 700);' : ''} });
<\/script></body></html>`;
}
