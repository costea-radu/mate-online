// =====================================================================
// src/lib/tutorBridge.js — puntea dintre exercițiul interactiv (iframe)
// și Profesorul Virtual (ChatPanel din pagina-părinte).
//
// NU este nevoie să modifici exercițiile HTML din baza de date:
// scriptul de mai jos este INJECTAT automat în HTML înainte de a fi
// afișat în iframe (vezi InteractiveViewer.jsx → injectTutorBridge).
//
// Ce face scriptul în interiorul exercițiului:
//  1. Înlocuiește butonul „💡 Arată indiciile" cu „🎓 Întreabă profesorul
//     virtual" — la apăsare trimite starea exercițiului către părinte.
//  2. Raportează permanent starea (enunț, pas curent, indicația oficială,
//     răspunsurile elevului, răspunsurile corecte — marcate secret).
//  3. Execută acțiuni cerute de AI (DOAR la cererea explicită a elevului):
//     completare răspuns, alegere opțiune grilă, adevărat/fals, confirmare.
//
// Protocol postMessage:
//  iframe → părinte: MATE_TUTOR_READY | MATE_TUTOR_STATE | MATE_TUTOR_OPEN
//  părinte → iframe: MATE_TUTOR_STATE_REQ | MATE_TUTOR_ACTION
// =====================================================================

const BRIDGE_SCRIPT = String.raw`
<script>
(function(){
  if (window.__MATE_TUTOR_BRIDGE__) return; window.__MATE_TUTOR_BRIDGE__ = true;
  var MAXLEN = 4000;

  function txt(el){ return el ? (el.textContent || '').replace(/\s+/g,' ').trim() : ''; }
  function visible(el){ return !!(el && el.offsetParent !== null); }
  function post(type, payload){ try { window.parent.postMessage({ type: type, payload: payload || null }, '*'); } catch(e){} }

  // ── Redă notațiile interne ([a|b] = fracție etc.) ca text simplu ──
  function plain(s){
    s = String(s == null ? '' : s);
    s = s.replace(/\[([^\|\]]+)\|([^\|\]]+)\]/g, '($1)/($2)');
    s = s.replace(/∫\{([^{}]*)\}\{([^{}]*)\}/g, 'integrala de la $1 la $2 din ');
    s = s.replace(/\^\{([^{}]*)\}/g, '^($1)');
    s = s.replace(/_\{([^{}]*)\}/g, '_($1)');
    return s;
  }

  // ── Colectare BOGATĂ: exerciții pe șablonul PROBS/ST/cur ──────────
  function collectRich(){
    try {
      if (typeof PROBS === 'undefined' || !PROBS || !PROBS.length) return null;
      var lines = [];
      var curN = (typeof cur !== 'undefined') ? cur : null;
      if (curN == null) {
        lines.push('Elevul este la lista de probleme. Probleme disponibile:');
        for (var i = 0; i < PROBS.length; i++) lines.push('Problema ' + PROBS[i].n + ': ' + plain(PROBS[i].lead));
        return lines.join('\n');
      }
      var p = null;
      for (var j = 0; j < PROBS.length; j++) if (PROBS[j].n === curN) { p = PROBS[j]; break; }
      if (!p) return null;
      var st = (typeof ST !== 'undefined' && ST && ST[p.n]) ? ST[p.n] : { ans: [], corr: false, score: 0 };
      lines.push('PROBLEMA ' + p.n + ': ' + plain(p.lead));
      if (p.req) for (var r = 0; r < p.req.length; r++) lines.push(plain(p.req[r]));

      // pasul deschis = primul fără răspuns (sau cel în re-editare)
      var open = -1;
      if (typeof redo !== 'undefined' && redo !== null) open = redo;
      else for (var k = 0; k < p.steps.length; k++) if (!st.ans || !st.ans[k]) { open = k; break; }

      lines.push('');
      lines.push('PAȘII REZOLVĂRII (' + p.steps.length + '):');
      for (var s = 0; s < p.steps.length; s++) {
        var step = p.steps[s], a = st.ans ? st.ans[s] : null;
        var row = 'Pasul ' + (s + 1) + (s === open ? ' (PASUL CURENT)' : '') + ': ' + plain(step.d);
        if (step.t === 'mc' && step.o) {
          var opts = [];
          for (var o = 0; o < step.o.length; o++) opts.push(String.fromCharCode(65 + o) + ') ' + plain(step.o[o]));
          row += ' | Variante: ' + opts.join('  ');
        }
        if (a) {
          var my = '';
          if (step.t === 'num') my = a.v;
          else if (step.t === 'mc') my = String.fromCharCode(65 + a.c) + ') ' + plain(step.o[a.c]);
          else if (step.t === 'tf') my = a.c ? 'ADEVĂRAT' : 'FALS';
          else my = (step.c ? plain(step.c[a.c]) : '') + ' = ' + a.v;
          row += ' | Răspunsul elevului: ' + my;
        } else if (s !== open) {
          row += ' | (fără răspuns încă)';
        }
        // răspunsul corect — AI-ul îl folosește pentru verificare, NU pentru dezvăluire
        var corect = '';
        if (step.t === 'num') corect = String(step.a);
        else if (step.t === 'mc') corect = String.fromCharCode(65 + step.ci);
        else if (step.t === 'tf') corect = step.ok ? 'ADEVĂRAT' : 'FALS';
        else if (step.t === 'calc') corect = String.fromCharCode(65 + step.ci) + ', rezultat ' + String(step.a);
        if (corect) row += ' | [SECRET — NU dezvălui elevului: răspuns corect = ' + corect + ']';
        if (step.help) row += ' | Indicația oficială: ' + plain(step.help);
        lines.push(row);
      }
      if (st.corr) lines.push('Problema a fost corectată: ' + st.score + '/' + p.max + ' puncte.');
      return lines.join('\n');
    } catch (e) { return null; }
  }

  // ── Colectare GENERICĂ (orice alt exercițiu): text vizibil din DOM ─
  function collectDom(){
    var parts = [document.title || ''];
    var sel = ['#stmt', '.statement', '.a-title', '.acard', '#stepHelp', '.stephelp', '.question', '.enunt', 'main', 'body'];
    for (var i = 0; i < sel.length; i++) {
      var el = document.querySelector(sel[i]);
      if (el) { var t = txt(el); if (t && parts.join(' ').indexOf(t.slice(0, 80)) === -1) parts.push(t); }
      if (parts.join('\n').length > MAXLEN) break;
    }
    return parts.filter(Boolean).join('\n').slice(0, MAXLEN);
  }

  function collect(){
    var rich = collectRich();
    return { text: (rich || collectDom()).slice(0, MAXLEN), rich: !!rich, title: document.title || '' };
  }

  // ── Butonul de indicații → „Întreabă profesorul virtual" ──────────
  function rewireHintButtons(){
    var btns = [];
    document.querySelectorAll('.btn-hint').forEach(function(b){ btns.push(b); });
    document.querySelectorAll('button').forEach(function(b){
      if (btns.indexOf(b) === -1 && /indici|indicaț|indicat/i.test(b.textContent || '')) btns.push(b);
    });
    btns.forEach(function(b){
      if (b.getAttribute('data-mt-done')) return;
      b.setAttribute('data-mt-done', '1');
      b.innerHTML = '🎓 Întreabă profesorul virtual';
      b.removeAttribute('onclick'); b.onclick = null;
      b.addEventListener('click', function(ev){
        ev.preventDefault(); ev.stopPropagation();
        post('MATE_TUTOR_OPEN', collect());
      });
    });
  }

  // ── Acțiuni cerute de AI (la cererea explicită a elevului) ────────
  function setNativeValue(input, value){
    try {
      var proto = Object.getPrototypeOf(input);
      var desc = Object.getOwnPropertyDescriptor(proto, 'value') || Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value');
      if (desc && desc.set) desc.set.call(input, value); else input.value = value;
    } catch (e) { input.value = value; }
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new Event('change', { bubbles: true }));
  }
  function doAction(action){
    if (!action || !action.kind) return false;
    try {
      if (action.kind === 'fill') {
        var inp = document.querySelector('#stepIn');
        if (!visible(inp)) {
          var cands = document.querySelectorAll('.acard input, input[type="text"], input:not([type])');
          for (var i = 0; i < cands.length; i++) if (visible(cands[i])) { inp = cands[i]; break; }
        }
        if (!inp) return false;
        setNativeValue(inp, String(action.value == null ? '' : action.value));
        inp.focus();
        return true;
      }
      if (action.kind === 'choose') {
        var idx = (typeof action.index === 'number') ? action.index
                : (action.letter ? String(action.letter).toUpperCase().charCodeAt(0) - 65 : -1);
        if (idx < 0) return false;
        var chops = Array.prototype.filter.call(document.querySelectorAll('.chop'), visible);
        if (chops[idx]) { chops[idx].click(); return true; }
        var radios = Array.prototype.filter.call(document.querySelectorAll('input[type="radio"]'), visible);
        if (radios[idx]) { radios[idx].click(); return true; }
        return false;
      }
      if (action.kind === 'tf') {
        var want = action.value === true || action.value === 'true' || /adev/i.test(String(action.value));
        var tfs = Array.prototype.filter.call(document.querySelectorAll('.tfbtn'), visible);
        for (var t = 0; t < tfs.length; t++) {
          var isTrue = /adev/i.test(tfs[t].textContent || '');
          if (isTrue === want) { tfs[t].click(); return true; }
        }
        return false;
      }
      if (action.kind === 'add') {
        var b = document.querySelector('#btnAdd');
        if (b && !b.disabled && visible(b)) { b.click(); return true; }
        return false;
      }
      if (action.kind === 'check') {
        var c = document.querySelector('.btn-check');
        if (visible(c)) { c.click(); return true; }
        return false;
      }
    } catch (e) { return false; }
    return false;
  }

  // ── Ascultă părintele ──────────────────────────────────────────────
  window.addEventListener('message', function(ev){
    var d = ev && ev.data;
    if (!d || typeof d !== 'object') return;
    if (d.type === 'MATE_TUTOR_STATE_REQ') post('MATE_TUTOR_STATE', collect());
    if (d.type === 'MATE_TUTOR_ACTION') {
      var ok = doAction(d.action);
      post('MATE_TUTOR_ACK', { ok: ok, action: d.action });
      setTimeout(function(){ post('MATE_TUTOR_STATE', collect()); }, 120);
    }
  });

  // ── Observă re-randările exercițiului ─────────────────────────────
  var deb = null;
  function onMutate(){
    rewireHintButtons();
    if (deb) clearTimeout(deb);
    deb = setTimeout(function(){ post('MATE_TUTOR_STATE', collect()); }, 400);
  }
  function start(){
    rewireHintButtons();
    try { new MutationObserver(onMutate).observe(document.body, { childList: true, subtree: true }); } catch(e){}
    post('MATE_TUTOR_READY', { title: document.title || '' });
    post('MATE_TUTOR_STATE', collect());
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start);
  else start();
})();
</` + `script>`;

// Injectează bridge-ul în HTML-ul exercițiului, înainte de </body>
// (sau la final, dacă documentul nu are </body>).
export function injectTutorBridge(html) {
  if (!html || typeof html !== 'string') return html;
  if (html.includes('__MATE_TUTOR_BRIDGE__')) return html; // deja injectat
  const idx = html.toLowerCase().lastIndexOf('</body>');
  if (idx === -1) return html + BRIDGE_SCRIPT;
  return html.slice(0, idx) + BRIDGE_SCRIPT + html.slice(idx);
}

// ── Parsarea acțiunilor emise de AI în răspuns: [[ACTIUNE:{...}]] ────
// Returnează { text: răspunsul fără marcaje, actions: [...] }.
export function extractTutorActions(text) {
  const actions = [];
  const cleaned = String(text || '').replace(/\[\[\s*ACTIUNE\s*:\s*(\{[^\]]*\})\s*\]\]/gi, (_, json) => {
    try { actions.push(JSON.parse(json)); } catch { /* marcaj invalid — îl ignorăm */ }
    return '';
  });
  return { text: cleaned.replace(/\n{3,}/g, '\n\n').trim(), actions };
}
