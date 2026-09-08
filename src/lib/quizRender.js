// =====================================================================
// src/lib/quizRender.js — construiește un exercițiu interactiv (HTML autonom)
// dintr-o listă STRUCTURATĂ de întrebări, ca să poată fi editat ca text
// (fără HTML) și completat cu adăugare/ștergere de întrebări.
//
// questions: [{ statement, options?: string[], answer, explanation? }]
//   - dacă are options → grilă; answer = indexul variantei corecte (0..n-1)
//   - fără options → răspuns liber; answer = textul corect (comparație simplă)
// meta (opțional): { durationMin, oficiu } — timpul de lucru (cronometru cu
//   numărătoare inversă, care oprește testul la expirare) și punctele din
//   oficiu (intră în scorul final, ca la lucrările din clasă).
// Scorul se raportează prin postMessage({type:'MATE_SCORE', score, maxScore}).
// =====================================================================
import { autoMath } from './katex';
import { ANS_EQ_SRC } from './ansEq'; // echivalența răspunsurilor („1/2” = „0,5”, „x=3” = „3”) — Etapa 2

function esc(s = '') {
  return String(autoMath(s || '')).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
function escAttr(s = '') {
  return String(s).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
}

export function renderQuiz(title, questions, meta = {}) {
  const qs = Array.isArray(questions) ? questions : [];
  // timpul de lucru și punctele din oficiu (alese de profesor la generare)
  const durationMin = Number.isFinite(Number(meta?.durationMin)) && Number(meta.durationMin) > 0
    ? Math.min(180, Math.round(Number(meta.durationMin))) : null;
  const oficiu = Number.isFinite(Number(meta?.oficiu)) && Number(meta.oficiu) >= 0
    ? Math.min(20, Math.round(Number(meta.oficiu))) : 0;
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
  .bar{display:flex;align-items:center;gap:14px;flex-wrap:wrap;border:1px solid #e6e9ef;border-radius:12px;padding:10px 14px;margin-bottom:14px;background:#f7f9fc}
  .clock{font-variant-numeric:tabular-nums;font-weight:800;font-size:1.15rem;color:#0f2b44}
  .clock.warn{color:#c25e00}.clock.over{color:#c0392b}
  .meta{font-size:.82rem;color:#5b6b7d}
  /* fracțiile KaTeX nu se mai taie sus: rândul crește cât formula + aer de
     protecție deasupra (compensat cu margin negativ — spațierea nu se schimbă) */
  .katex{display:inline-block;padding:.4em .05em .25em;margin:-.4em -.05em -.25em}
  .katex-display .katex{display:block}
</style></head><body>
  <h1>${esc(title || 'Exercițiu interactiv')}</h1>
  ${(durationMin || oficiu) ? `<div class="bar">
    ${durationMin ? '<span>⏱ Timp de lucru: <b class="clock" id="clock">--:--</b></span>' : ''}
    ${oficiu ? `<span class="meta">Se acordă <b>${oficiu} puncte</b> din oficiu · total 100 de puncte</span>` : ''}
    ${durationMin ? '<button id="start" style="margin-top:0;padding:7px 14px;font-size:.85rem">▶ Pornește timpul</button>' : ''}
  </div>` : ''}
  <div id="quiz">${qHtml}</div>
  <button id="check">Verifică</button>
  <div class="res" id="res"></div>
<script src="https://cdn.jsdelivr.net/npm/katex@0.16.11/dist/katex.min.js"></script>
<script src="https://cdn.jsdelivr.net/npm/katex@0.16.11/dist/contrib/auto-render.min.js"></script>
<script>
  var ANS = ${JSON.stringify(answers)};
  var EXP = ${JSON.stringify(explanations)};
  var DUR = ${durationMin || 0};   // minutele de lucru (0 = fără cronometru)
  var OFICIU = ${oficiu};          // puncte din oficiu (intră în scorul final)
  function norm(s){return String(s||'').trim().toLowerCase().replace(',','.').replace(/\\s+/g,'');}
  ${ANS_EQ_SRC}
  function render(){ if(window.renderMathInElement) renderMathInElement(document.body,{delimiters:[{left:'$$',right:'$$',display:true},{left:'$',right:'$',display:false}],throwOnError:false}); }
  if(window.renderMathInElement) render(); else window.addEventListener('load', render);
  document.getElementById('check').addEventListener('click', function(){
    var correct=0, A=[];
    for(var i=0;i<ANS.length;i++){
      var fb=document.getElementById('fb'+i); var ok=false;
      if(ANS[i].type==='choice'){
        var sel=document.querySelector('input[name="q'+i+'"]:checked');
        ok = sel && Number(sel.value)===ANS[i].answer; A.push(sel?Number(sel.value):null);
      } else {
        var el=document.querySelector('input[name="q'+i+'"]');
        ok = el && ansEq(el.value, ANS[i].answer); A.push(el?String(el.value||''):'');
      }
      if(ok) correct++;
      fb.className='fb '+(ok?'ok':'bad');
      fb.innerHTML=(ok?'✓ Corect':'✗ Greșit')+(EXP[i]?'<div class="exp">'+EXP[i]+'</div>':'');
    }
    render();
    var total=ANS.length||1;
    // cu puncte din oficiu, itemii împart restul până la 100 (ca la lucrări)
    var score=Math.round(OFICIU + correct/total*(100-OFICIU));
    document.getElementById('res').textContent='Scor: '+correct+'/'+total+' — '+score+' puncte'
      +(OFICIU?' (din care '+OFICIU+' din oficiu)':'')+' · nota '+(score/10).toFixed(2).replace('.',',');
    var MSG={type:'MATE_SCORE',score:score,maxScore:100,answers:A,raw:{got:correct,max:total}}; // answers: serverul recalculează scorul (Etapa 3)
    try{ parent.postMessage(MSG,'*'); }catch(e){}
    try{ if(window.opener) window.opener.postMessage(MSG,'*'); }catch(e){}
    stopClock();
  });

  // ── Cronometru (numărătoare inversă) ──────────────────────────────────
  // Pornește la primul răspuns dat sau la apăsarea butonului; la expirare
  // testul se verifică singur, ca la o lucrare de clasă.
  var left=DUR*60, tick=null, started=false;
  function fmt(s){ var m=Math.floor(Math.abs(s)/60), r=Math.abs(s)%60; return (s<0?'-':'')+m+':'+(r<10?'0':'')+r; }
  function paint(){ var el=document.getElementById('clock'); if(!el) return;
    el.textContent=fmt(left);
    el.className='clock'+(left<=0?' over':(left<=60?' warn':'')); }
  function stopClock(){ if(tick){ clearInterval(tick); tick=null; } }
  function startClock(){
    if(started||!DUR) return; started=true;
    var b=document.getElementById('start'); if(b) b.style.display='none';
    paint();
    tick=setInterval(function(){
      left--; paint();
      if(left<=0){ stopClock();
        var c=document.getElementById('check');
        if(c && !c.disabled){ c.click(); }
        var el=document.getElementById('clock'); if(el) el.textContent='0:00 — timpul a expirat';
      }
    },1000);
  }
  if(DUR){
    paint();
    var sb=document.getElementById('start'); if(sb) sb.addEventListener('click', startClock);
    document.getElementById('quiz').addEventListener('input', startClock);
    document.getElementById('quiz').addEventListener('change', startClock);
  }
</script></body></html>`;
}
