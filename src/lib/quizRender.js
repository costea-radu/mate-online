// =====================================================================
// src/lib/quizRender.js — construiește un exercițiu interactiv (HTML autonom)
// dintr-o listă STRUCTURATĂ de întrebări, ca să poată fi editat ca text
// (fără HTML) și completat cu adăugare/ștergere de întrebări.
//
// questions: [{ statement, options?: string[], answer, explanation? }]
//   - dacă are options → grilă; answer = indexul variantei corecte (0..n-1)
//   - fără options → răspuns liber; answer = textul corect (comparație simplă)
// Scorul se raportează prin postMessage({type:'MATE_SCORE', score, maxScore}).
// =====================================================================
import { autoMath } from './katex';

function esc(s = '') {
  return String(autoMath(s || '')).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
function escAttr(s = '') {
  return String(s).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
}

export function renderQuiz(title, questions) {
  const qs = Array.isArray(questions) ? questions : [];
  const qHtml = qs.map((q, i) => {
    const hasOpts = Array.isArray(q.options) && q.options.length > 0;
    let body;
    if (hasOpts) {
      body = `<div class="opts">${q.options.map((o, oi) => `
        <label class="opt"><input type="radio" name="q${i}" value="${oi}"> <b>${String.fromCharCode(65 + oi)})</b> <span>${esc(o)}</span></label>`).join('')}</div>`;
    } else {
      body = `<input class="txt" type="text" name="q${i}" placeholder="Răspunsul tău">`;
    }
    return `<div class="q" data-i="${i}">
      <div class="stmt"><b>${i + 1}.</b> ${esc(q.statement || '')}</div>
      ${body}
      <div class="fb" id="fb${i}"></div>
    </div>`;
  }).join('');

  const answers = qs.map((q) => (Array.isArray(q.options) && q.options.length
    ? { type: 'choice', answer: Number(q.answer) }
    : { type: 'open', answer: String(q.answer ?? '') }));
  const explanations = qs.map((q) => q.explanation || '');

  return `<!doctype html><html lang="ro"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/katex@0.16.11/dist/katex.min.css">
<style>
  body{font-family:system-ui,-apple-system,'Segoe UI',sans-serif;color:#0f2b44;margin:0;padding:16px;background:#fff;line-height:1.6}
  h1{font-size:1.15rem;margin:0 0 14px}
  .q{border:1px solid #e6e9ef;border-radius:12px;padding:14px;margin-bottom:12px}
  .stmt{font-size:1.02rem;margin-bottom:10px}
  .opt{display:flex;align-items:center;gap:8px;padding:8px 10px;border:1px solid #e6e9ef;border-radius:8px;margin-bottom:6px;cursor:pointer}
  .opt:hover{background:#f7f9fc}
  .txt{width:100%;padding:9px 11px;border:1px solid #ccd3dd;border-radius:8px;font-size:.95rem}
  .fb{margin-top:8px;font-size:.9rem;font-weight:600}
  .ok{color:#1e7e34}.bad{color:#c0392b}
  .exp{margin-top:6px;font-weight:400;color:#444;font-size:.86rem}
  button{background:#e8b931;color:#0f2b44;border:none;border-radius:10px;padding:11px 20px;font-weight:700;font-size:.95rem;cursor:pointer;margin-top:6px}
  .res{font-size:1.1rem;font-weight:800;margin:10px 0}
</style></head><body>
  <h1>${esc(title || 'Exercițiu interactiv')}</h1>
  <div id="quiz">${qHtml}</div>
  <button id="check">Verifică</button>
  <div class="res" id="res"></div>
<script src="https://cdn.jsdelivr.net/npm/katex@0.16.11/dist/katex.min.js"></script>
<script src="https://cdn.jsdelivr.net/npm/katex@0.16.11/dist/contrib/auto-render.min.js"></script>
<script>
  var ANS = ${JSON.stringify(answers)};
  var EXP = ${JSON.stringify(explanations)};
  function norm(s){return String(s||'').trim().toLowerCase().replace(',','.').replace(/\\s+/g,'');}
  function render(){ if(window.renderMathInElement) renderMathInElement(document.body,{delimiters:[{left:'$$',right:'$$',display:true},{left:'$',right:'$',display:false}],throwOnError:false}); }
  if(window.renderMathInElement) render(); else window.addEventListener('load', render);
  document.getElementById('check').addEventListener('click', function(){
    var correct=0;
    for(var i=0;i<ANS.length;i++){
      var fb=document.getElementById('fb'+i); var ok=false;
      if(ANS[i].type==='choice'){
        var sel=document.querySelector('input[name="q'+i+'"]:checked');
        ok = sel && Number(sel.value)===ANS[i].answer;
      } else {
        var el=document.querySelector('input[name="q'+i+'"]');
        ok = el && norm(el.value)===norm(ANS[i].answer);
      }
      if(ok) correct++;
      fb.className='fb '+(ok?'ok':'bad');
      fb.innerHTML=(ok?'✓ Corect':'✗ Greșit')+(EXP[i]?'<div class="exp">'+EXP[i]+'</div>':'');
    }
    render();
    var total=ANS.length||1; var score=Math.round(correct/total*100);
    document.getElementById('res').textContent='Scor: '+correct+'/'+total+' ('+score+'%)';
    try{ parent.postMessage({type:'MATE_SCORE',score:score,maxScore:100},'*'); }catch(e){}
  });
</script></body></html>`;
}
