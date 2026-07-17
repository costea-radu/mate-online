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
      b.innerHTML = EINSTEIN_SVG + '<span>Întreabă profesorul virtual</span>';
      b.style.display = 'inline-flex'; b.style.alignItems = 'center'; b.style.gap = '7px';
      b.removeAttribute('onclick'); b.onclick = null;
      b.addEventListener('click', function(ev){
        ev.preventDefault(); ev.stopPropagation();
        post('MATE_TUTOR_OPEN', collect());
      });
    });
  }

  // ── „Ajutor" la FIECARE pas de rezolvare + pastilă de rezervă ─────
  // Fața Einstein (același desen ca EinsteinIcon.jsx), inline pentru iframe.
  var EINSTEIN_SVG = '<svg width="18" height="18" viewBox="0 0 64 64" role="img" aria-label="Profesor Virtual" style="flex-shrink:0"><g fill="#f3f4f6" stroke="#d9dce1" stroke-width="1"><path d="M14 30 C4 30 6 16 14 16 C10 8 22 4 26 10 C30 3 44 5 44 13 C54 10 58 24 50 28 C60 30 56 42 48 40 L16 40 C8 42 6 32 14 30 Z"/><circle cx="12" cy="26" r="5"/><circle cx="9" cy="33" r="4"/><circle cx="52" cy="24" r="5"/><circle cx="55" cy="32" r="4"/><circle cx="18" cy="15" r="4"/><circle cx="46" cy="15" r="4"/></g><ellipse cx="32" cy="33" rx="15" ry="16" fill="#f7d9b8" stroke="#e0b98f" stroke-width="1"/><path d="M24 24 Q32 21 40 24" fill="none" stroke="#e0b98f" stroke-width="1" opacity=".7"/><path d="M22 29 Q26 26 30 29" fill="none" stroke="#c9ccd1" stroke-width="3" stroke-linecap="round"/><path d="M34 29 Q38 26 42 29" fill="none" stroke="#c9ccd1" stroke-width="3" stroke-linecap="round"/><circle cx="26" cy="33" r="2" fill="#3a3f47"/><circle cx="38" cy="33" r="2" fill="#3a3f47"/><path d="M32 34 L30 40 Q32 42 34 40" fill="none" stroke="#d9a878" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/><path d="M22 43 Q27 41 32 43 Q37 41 42 43 Q40 48 32 46 Q24 48 22 43 Z" fill="#e6e8eb" stroke="#c9ccd1" stroke-width="1"/><path d="M28 47 Q32 49 36 47" fill="none" stroke="#b98a63" stroke-width="1.3" stroke-linecap="round"/></svg>';
  var BTN_CSS = 'display:inline-flex;align-items:center;gap:7px;background:#fff8e1;border:1.5px solid #e8b931;color:#8a6d00;border-radius:8px;padding:6px 12px;font-family:inherit;font-weight:700;font-size:.78rem;cursor:pointer;';
  function makeHelpBtn(){
    var b = document.createElement('button');
    b.type = 'button';
    b.setAttribute('data-mt-step', '1');
    b.innerHTML = EINSTEIN_SVG + '<span>Ajutor — întreabă profesorul virtual</span>';
    b.style.cssText = BTN_CSS;
    b.addEventListener('click', function(ev){ ev.preventDefault(); ev.stopPropagation(); post('MATE_TUTOR_OPEN', collect()); });
    return b;
  }
  function ensureStepHelpers(){
    // pe cardul activ al pasului curent (dacă nu există deja butonul de indicii rescris)
    document.querySelectorAll('.acard').forEach(function(card){
      if (card.querySelector('[data-mt-step]') || card.querySelector('[data-mt-done]')) return;
      var host = card.querySelector('.acts') || card;
      host.appendChild(makeHelpBtn());
    });
    // exerciții pe alt șablon (fără .acard / fără buton de indicii): pastilă fixă jos-stânga
    var structured = document.querySelector('.acard') || document.querySelector('[data-mt-done]');
    var pill = document.getElementById('mtHelpPill');
    if (structured) { if (pill) pill.remove(); return; }
    if (!pill && document.body) {
      pill = makeHelpBtn();
      pill.id = 'mtHelpPill';
      pill.style.cssText = BTN_CSS + 'position:fixed;left:14px;bottom:14px;z-index:99999;box-shadow:0 4px 14px rgba(0,0,0,.18);';
      document.body.appendChild(pill);
    }
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
  function refreshUI(){ rewireHintButtons(); ensureStepHelpers(); }
  function onMutate(){
    refreshUI();
    if (deb) clearTimeout(deb);
    deb = setTimeout(function(){ post('MATE_TUTOR_STATE', collect()); }, 400);
  }
  function start(){
    refreshUI();
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
