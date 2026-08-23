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
//                    | MATE_RESET_REQ (butonul „Resetează" al testului e
//                      defect → părintele reîncarcă exercițiul de la zero)
//  părinte → iframe: MATE_TUTOR_STATE_REQ | MATE_TUTOR_ACTION
// =====================================================================

const BRIDGE_SCRIPT = String.raw`
<script>
(function(){
  if (window.__MATE_TUTOR_BRIDGE__) return; window.__MATE_TUTOR_BRIDGE__ = true;
  var MAXLEN = 14000;

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

  // ── Tot testul, compact: fiecare exercițiu cu enunț + cerințe ─────
  // AI-ul primește astfel FIȘIERUL CURENT complet și poate recunoaște
  // exact exercițiul la care se referă elevul („exercițiul 3", „subiectul II 2.b").
  function allProblemsText(){
    try {
      if (typeof PROBS === 'undefined' || !PROBS || !PROBS.length) return null;
      var lines = ['CONȚINUTUL COMPLET AL TESTULUI' + (document.title ? ' „' + document.title + '"' : '') + ' (toate exercițiile, în ordine):'];
      var lastPart = null;
      for (var i = 0; i < PROBS.length; i++) {
        var p = PROBS[i];
        if (p.part && p.part !== lastPart) { lastPart = p.part; lines.push('— ' + p.part + ' —'); }
        lines.push('Exercițiul ' + (p.lbl || p.n) + ': ' + plain(p.lead));
        if (p.req) for (var r = 0; r < p.req.length; r++) lines.push('   ' + plain(p.req[r]));
      }
      return lines.join('\n');
    } catch (e) { return null; }
  }

  // ── Colectare BOGATĂ: exerciții pe șablonul PROBS/ST/cur ──────────
  function collectRich(){
    try {
      if (typeof PROBS === 'undefined' || !PROBS || !PROBS.length) return null;
      var all = allProblemsText();
      var lines = [];
      var curN = (typeof cur !== 'undefined') ? cur : null;
      if (curN == null) {
        lines.push('Elevul este la LISTA de exerciții (niciun exercițiu deschis acum).');
        if (all) lines.push('', all);
        return lines.join('\n');
      }
      var p = null;
      for (var j = 0; j < PROBS.length; j++) if (PROBS[j].n === curN) { p = PROBS[j]; break; }
      if (!p) return null;
      var st = (typeof ST !== 'undefined' && ST && ST[p.n]) ? ST[p.n] : { ans: [], corr: false, score: 0 };
      lines.push('EXERCIȚIUL DESCHIS ACUM — ' + (p.lbl || p.n) + ': ' + plain(p.lead));
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
        if (corect) row += ' | [răspuns corect — dezvăluie DOAR dacă elevul îl cere explicit: ' + corect + ']';
        if (step.help) row += ' | Indicația oficială: ' + plain(step.help);
        lines.push(row);
      }
      if (st.corr) lines.push('Problema a fost corectată: ' + st.score + '/' + p.max + ' puncte.');
      var all = allProblemsText();
      if (all) lines.push('', all);
      return lines.join('\n');
    } catch (e) { return null; }
  }

  // ── Colectare GENERICĂ (orice alt exercițiu): text vizibil din DOM ─
  function collectDom(){
    var parts = [document.title || ''];
    var sel = ['#stmt', '.statement', '.a-title', '.acard', '#stepHelp', '.stephelp', '.question', '.enunt'];
    for (var i = 0; i < sel.length; i++) {
      var el = document.querySelector(sel[i]);
      if (el) { var t = txt(el); if (t && parts.join(' ').indexOf(t.slice(0, 80)) === -1) parts.push(t); }
    }
    // întregul conținut vizibil al fișierului (ca AI-ul să vadă TOATE exercițiile)
    var body = txt(document.body);
    if (body && parts.join('\n').length < MAXLEN) {
      parts.push('CONȚINUTUL COMPLET AL FIȘIERULUI (text vizibil):\n' + body);
    }
    return parts.filter(Boolean).join('\n').slice(0, MAXLEN);
  }

  // ── Exercițiul-grilă pe care elevul a cerut ajutor (Subiectul I & II) ─
  // Când elevul apasă „Ajutor" pe un card-grilă, reținem cardul și punem
  // în context TOT ce ține de el: enunț, variante, alegerea elevului,
  // răspunsul corect (secret) și explicația oficială (secret).
  var focusCard = null;
  function sectionOf(card){
    var secs = document.querySelectorAll('.sec-title'), name = '';
    for (var i = 0; i < secs.length; i++) {
      if (secs[i].compareDocumentPosition(card) & 4) { // titlul e ÎNAINTEA cardului
        var fc = secs[i].firstChild;
        name = ((fc && fc.nodeType === 3 ? fc.textContent : secs[i].textContent) || '').replace(/\s+/g, ' ').trim();
      }
    }
    return name;
  }
  function cardLabel(card){
    if (!card || !document.body || !document.body.contains(card)) return null;
    var sec = sectionOf(card), nr = txt(card.querySelector('.nr'));
    var lbl = sec + (nr ? (sec ? ', ' : '') + 'exercițiul ' + nr : '');
    return lbl || null;
  }
  function cardInfo(card){
    if (!card || !document.body || !document.body.contains(card) || !visible(card)) return null;
    var lines = ['EXERCIȚIUL LA CARE ELEVUL A CERUT AJUTOR — ' + (cardLabel(card) || 'exercițiu grilă') + ':'];
    var q = txt(card.querySelector('.qtxt')) || txt(card.querySelector('.card-hdr'));
    if (q) lines.push('Enunț: ' + q);
    var tb = card.querySelector('table'); if (tb) lines.push('Tabel: ' + txt(tb));
    var opts = [];
    card.querySelectorAll('.opt').forEach(function(o){
      var l = txt(o.querySelector('.olbl')) || '?', t = txt(o.querySelector('.otxt'));
      opts.push(l + ') ' + t + (o.classList.contains('sel') ? ' ← ALES DE ELEV' : ''));
    });
    if (opts.length) lines.push('Variante: ' + opts.join('   '));
    if (!card.querySelector('.opt.sel')) lines.push('Elevul nu a ales încă niciun răspuns.');
    var ok = card.getAttribute('data-correct');
    if (ok) {
      var okTxt = txt(card.querySelector('.opt[data-opt="' + ok + '"] .otxt'));
      lines.push('[răspuns corect — dezvăluie DOAR dacă elevul îl cere explicit: ' + ok + (okTxt ? ') ' + okTxt : '') + ']');
    }
    var ex = card.querySelector('.expl');
    if (ex) { var et = txt(ex); if (et) lines.push('[explicația oficială — folosește-o pentru indicii, nu o recita nesolicitat: ' + et + ']'); }
    if (card.dataset && card.dataset.checked) lines.push('Exercițiul a fost deja corectat — elevul vede pe ecran răspunsul corect și explicația.');
    return lines.join('\n');
  }

  function collect(){
    var rich = collectRich();
    var base = rich || collectDom();
    var fx = cardInfo(focusCard);
    var text = fx ? fx + '\n\n' + base : base;
    return { text: String(text || '').slice(0, MAXLEN), rich: !!rich, title: document.title || '', focus: fx ? cardLabel(focusCard) : null };
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
        focusCard = null;
        post('MATE_TUTOR_OPEN', collect());
      });
    });
  }

  // ── „Ajutor" la FIECARE pas de rezolvare + pastilă de rezervă ─────
  // Fața Einstein (același desen ca EinsteinIcon.jsx), inline pentru iframe.
  var EINSTEIN_SVG = '<svg width="18" height="18" viewBox="0 0 64 64" role="img" aria-label="Profesor Virtual" style="flex-shrink:0"><g fill="#f3f4f6" stroke="#d9dce1" stroke-width="1"><path d="M14 30 C4 30 6 16 14 16 C10 8 22 4 26 10 C30 3 44 5 44 13 C54 10 58 24 50 28 C60 30 56 42 48 40 L16 40 C8 42 6 32 14 30 Z"/><circle cx="12" cy="26" r="5"/><circle cx="9" cy="33" r="4"/><circle cx="52" cy="24" r="5"/><circle cx="55" cy="32" r="4"/><circle cx="18" cy="15" r="4"/><circle cx="46" cy="15" r="4"/></g><ellipse cx="32" cy="33" rx="15" ry="16" fill="#f7d9b8" stroke="#e0b98f" stroke-width="1"/><path d="M24 24 Q32 21 40 24" fill="none" stroke="#e0b98f" stroke-width="1" opacity=".7"/><path d="M22 29 Q26 26 30 29" fill="none" stroke="#c9ccd1" stroke-width="3" stroke-linecap="round"/><path d="M34 29 Q38 26 42 29" fill="none" stroke="#c9ccd1" stroke-width="3" stroke-linecap="round"/><circle cx="26" cy="33" r="2" fill="#3a3f47"/><circle cx="38" cy="33" r="2" fill="#3a3f47"/><path d="M32 34 L30 40 Q32 42 34 40" fill="none" stroke="#d9a878" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/><path d="M22 43 Q27 41 32 43 Q37 41 42 43 Q40 48 32 46 Q24 48 22 43 Z" fill="#e6e8eb" stroke="#c9ccd1" stroke-width="1"/><path d="M28 47 Q32 49 36 47" fill="none" stroke="#b98a63" stroke-width="1.3" stroke-linecap="round"/></svg>';
  var BTN_CSS = 'display:inline-flex;align-items:center;gap:7px;background:#fff8e1;border:1.5px solid #e8b931;color:#8a6d00;border-radius:8px;padding:6px 12px;font-family:inherit;font-weight:700;font-size:.78rem;cursor:pointer;';
  function makeHelpBtn(card){
    var b = document.createElement('button');
    b.type = 'button';
    b.setAttribute('data-mt-step', '1');
    b.innerHTML = EINSTEIN_SVG + '<span>Ajutor — întreabă profesorul virtual</span>';
    b.style.cssText = BTN_CSS;
    b.addEventListener('click', function(ev){ ev.preventDefault(); ev.stopPropagation(); focusCard = card || null; post('MATE_TUTOR_OPEN', collect()); });
    return b;
  }
  function ensureStepHelpers(){
    // pe cardul activ al pasului curent (dacă nu există deja butonul de indicii rescris)
    document.querySelectorAll('.acard').forEach(function(card){
      if (card.querySelector('[data-mt-step]') || card.querySelector('[data-mt-done]')) return;
      var host = card.querySelector('.acts') || card;
      host.appendChild(makeHelpBtn());
    });
    // exercițiile-grilă (Subiectul I & II): butonul „Ajutor" pe FIECARE card,
    // exact ca la pașii de la Subiectul al III-lea.
    document.querySelectorAll('.card').forEach(function(card){
      if (!card.querySelector('.opt')) return;                        // doar carduri cu variante de răspuns
      if (card.querySelector('[data-mt-step]') || card.querySelector('[data-mt-done]')) return;
      var row = document.createElement('div');
      row.setAttribute('data-mt-row', '1');
      row.style.cssText = 'padding:0 18px 14px;';
      row.appendChild(makeHelpBtn(card));
      card.appendChild(row);
    });
    // exerciții pe alt șablon (fără .acard / fără buton de indicii): pastilă fixă jos-stânga
    var structured = document.querySelector('.acard') || document.querySelector('[data-mt-done]') || document.querySelector('.card [data-mt-step]');
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

  // ── RAPORTAREA SCORULUI pentru testele care nu au postMessage propriu ──
  // Testele încărcate manual (ex. variante BAC) își calculează punctajul
  // intern, dar nu îl trimit platformei. Aici îl detectăm și îl trimitem
  // ca MATE_SCORE, exact ca exercițiile generate de platformă.
  var NATIVE_SCORE = !!window.__MATE_NATIVE_SCORE__; // fișierul are deja postMessage MATE_SCORE
  var userActed = false, lastSig = '', lastSigAt = 0;
  ['click', 'keydown', 'touchend'].forEach(function(ev){
    document.addEventListener(ev, function(){ userActed = true; }, true);
  });
  function parseNum(s){ return parseFloat(String(s).replace(/\s+/g, '').replace(',', '.')); }
  // ── RĂSPUNSURILE elevului, pentru VERIFICAREA SCORULUI PE SERVER (Etapa 3) ──
  // HTML-urile generate mai demult trimit doar procentul (fără răspunsuri).
  // Le citim noi din pagină — câmpurile lor se numesc q0, q1, … exact ca la
  // exercițiile generate acum — și le trimitem părintelui, care le pasează
  // serverului: acesta recalculează punctajul din cheile materialului.
  function collectAnswers(){
    try {
      var out = [], i = 0;
      for (;;) {
        var radios = document.querySelectorAll('input[type="radio"][name="q' + i + '"]');
        var text = document.querySelector('input[type="text"][name="q' + i + '"], input[name="q' + i + '"]:not([type="radio"]), textarea[name="q' + i + '"]');
        if (!radios.length && !text) break;
        if (radios.length) {
          var sel = document.querySelector('input[type="radio"][name="q' + i + '"]:checked');
          out.push(sel ? Number(sel.value) : null);
        } else out.push(String(text.value || ''));
        i++;
        if (i > 60) break;
      }
      return out.length ? out : null;
    } catch(e){ return null; }
  }
  function postAnswers(){
    var a = collectAnswers();
    if (!a) return;
    try { window.parent.postMessage({ type: 'MATE_ANSWERS', answers: a }, '*'); } catch(e){}
  }

  function postScore(score, max, force){
    if (!isFinite(score) || !isFinite(max) || max <= 0 || score < 0 || score > max) return;
    var sig = score + '/' + max, now = Date.now();
    // fără „force" (observatorul DOM): raportăm doar când scorul se SCHIMBĂ;
    // cu „force" (corectare explicită): raportăm, dar nu de două ori în 4s.
    if (!force && sig === lastSig) return;
    if (sig === lastSig && now - lastSigAt < 4000) return;
    lastSig = sig; lastSigAt = now;
    postAnswers(); // răspunsurile ajung ÎNAINTE de scor (părintele le trimite serverului)
    try { window.parent.postMessage({ type: 'MATE_SCORE', score: Math.round(score), maxScore: Math.round(max), answers: collectAnswers() || undefined }, '*'); } catch(e){}
  }
  // 1) șablonul PROBS/stats/GRADED (variantele de examen încărcate)
  function scoreFromStats(){
    try {
      if (typeof stats !== 'function' || typeof GRAND_MAX === 'undefined') return null;
      if (typeof GRADED === 'undefined' || !GRADED) return null; // doar DUPĂ corectare
      var g = stats();
      if (g && typeof g.score === 'number') return { s: g.score, m: GRAND_MAX };
    } catch(e){}
    return null;
  }
  // 2) generic: panoul final vizibil cu „X / Y puncte"
  function scoreFromDom(){
    var sels = ['#fScore', '.final-score', '#finalScore', '.score-final', '#scorFinal', '.rezultat-final', '.final.show', '#final.show'];
    for (var i = 0; i < sels.length; i++) {
      var el = document.querySelector(sels[i]);
      if (!visible(el)) continue;
      var m = (el.textContent || '').match(/(\d+(?:[.,]\d+)?)\s*(?:\/|din)\s*(\d+(?:[.,]\d+)?)\s*(?:puncte|pct|p\b)/i);
      if (m) { var s = parseNum(m[1]), mx = parseNum(m[2]); if (isFinite(s) && isFinite(mx)) return { s: s, m: mx }; }
    }
    return null;
  }
  // 3) bara de statistici a testelor mari („Scor: 45/90 pct") — ancorată pe „Scor"
  function scoreFromHeader(){
    try {
      var m = (document.body.innerText || '').match(/Scor\s*[:  ]\s*(\d+(?:[.,]\d+)?)\s*\/\s*(\d+(?:[.,]\d+)?)\s*(?:pct|puncte|p\b)/i);
      if (m) { var s = parseNum(m[1]), mx = parseNum(m[2]); if (isFinite(s) && isFinite(mx)) return { s: s, m: mx }; }
    } catch(e){}
    return null;
  }
  function tryReportScore(force){
    if (NATIVE_SCORE || !userActed) return; // fără dubluri; fără raport la simpla re-deschidere
    var r = scoreFromStats() || scoreFromDom();
    if (r) postScore(r.s, r.m, !!force);
  }
  // ── PLASA DE SIGURANȚĂ: unele teste „native" (au cod MATE_SCORE în fișier)
  // NU îl trimit totuși la „Corectează". La fiecare corectare explicită emitem
  // un HINT cu scorul citit din pagină; PĂRINTELE îl folosește DOAR dacă nu
  // primește un MATE_SCORE direct — fără el, tema/rezultatul nu se salvau deloc.
  var lastHintSig = '', lastHintAt = 0;
  function emitScoreHint(){
    if (!userActed) return;
    var r = scoreFromStats() || scoreFromDom() || scoreFromHeader();
    if (!r || !isFinite(r.s) || !isFinite(r.m) || r.m <= 0 || r.s < 0 || r.s > r.m) return;
    var sig = r.s + '/' + r.m, now = Date.now();
    if (sig === lastHintSig && now - lastHintAt < 4000) return;
    lastHintSig = sig; lastHintAt = now;
    try { window.parent.postMessage({ type: 'MATE_SCORE_HINT', score: Math.round(r.s), maxScore: Math.round(r.m) }, '*'); } catch(e){}
  }
  // corectarea explicită: click pe butoane de tip „Corectează / Verifică / Finalizează"
  document.addEventListener('click', function(ev){
    try {
      var b = ev.target && ev.target.closest ? ev.target.closest('button, a, [role="button"]') : null;
      if (!b) return;
      var t = (b.textContent || '').toLowerCase();
      if (/corecteaz|verific[aă]\s*(tot|toate)?$|finalizeaz|corectare/.test(t.replace(/\s+/g, ' ').trim())) {
        postAnswers(); // și la testele „native": scorul lor nu poartă răspunsurile
        setTimeout(emitScoreHint, 500);
        setTimeout(emitScoreHint, 1500); // testele care redau scorul mai lent
      }
    } catch(e){}
  }, true);
  // înfășoară funcțiile uzuale de corectare (rulăm DUPĂ scriptul testului)
  ['checkAll', 'gradeAll', 'corecteaza', 'verificaTot', 'finalizeaza'].forEach(function(name){
    try {
      var f = window[name];
      if (typeof f === 'function' && !f.__mateScoreWrap) {
        var wrapped = function(){ var r = f.apply(this, arguments); setTimeout(function(){ tryReportScore(true); emitScoreHint(); }, 80); return r; };
        wrapped.__mateScoreWrap = true;
        window[name] = wrapped;
      }
    } catch(e){}
  });

  // ── Butonul „Resetează" — GARANTAT funcțional ──────────────────────
  // La unele teste încărcate (ex. variantele de BAC), funcția proprie de
  // resetare e defectă sau blocată de sandbox (confirm() e ignorat în
  // iframe), așa că scorul și răspunsurile rămâneau pe ecran, iar elevul
  // trebuia să iasă din test și să-l repornească. Nu modificăm fișierele
  // din baza de date: după orice apăsare pe un buton de tip „Resetează"
  // verificăm dacă testul chiar s-a golit; dacă NU, cerem paginii-părinte
  // să reîncarce exercițiul de la zero (identic cu ieșire + repornire,
  // dar într-un singur click, cu scorul înapoi la 0).
  function answeredSigns(){
    var n = 0;
    // șablonul variantelor de examen (PROBS/ST/GRADED)
    try { if (typeof GRADED !== 'undefined' && GRADED) n += 1000; } catch(e){}
    try {
      if (typeof ST !== 'undefined' && ST) {
        for (var k in ST) {
          var st = ST[k];
          if (!st) continue;
          if (st.corr) n += 200;
          if (st.ans) for (var a = 0; a < st.ans.length; a++) if (st.ans[a]) n++;
        }
      }
    } catch(e){}
    // șablonul standard (carduri-grilă)
    try { n += document.querySelectorAll('.card[data-checked], .opt.ok, .opt.err, .opt.show-ok, .opt.sel').length; } catch(e){}
    try { var fin = document.querySelector('.final.show, #final.show'); if (fin && visible(fin)) n += 500; } catch(e){}
    // scor nenul afișat în bara testului („Scor: 45/90 pct")
    try {
      var m = (document.body.innerText || '').match(/Scor\s*[:\s]\s*(\d+(?:[.,]\d+)?)\s*\/\s*\d+(?:[.,]\d+)?\s*(?:pct|puncte|p\b)/i);
      if (m && parseNum(m[1]) > 0) n += 100;
    } catch(e){}
    return n;
  }
  document.addEventListener('click', function(ev){
    try {
      var b = ev.target && ev.target.closest ? ev.target.closest('button, a, [role="button"]') : null;
      if (!b) return;
      var label = ((b.textContent || '') + ' ' + (b.getAttribute('title') || '') + ' ' + (b.getAttribute('onclick') || '')).toLowerCase();
      if (label.indexOf('reset') === -1) return;   // „Resetează" / „Reset" / onclick="resetAll()"
      if (b.closest('.draw-toolbar')) return;      // nu instrumentele de desen de pe figuri
      var before = answeredSigns();
      if (!before) return;                         // test neînceput — nu e nimic de resetat
      setTimeout(function(){
        if (answeredSigns()) post('MATE_RESET_REQ', { reason: 'reset-defect' });
      }, 600);
    } catch(e){}
  }, true);

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

  // ── Reparație de AFIȘARE pentru redactarea greșită din unele teste
  // generate mai demult (nu modifică fișierul din baza de date):
  //  • „70^$\circ$" / „70^∘" (caret rămas literal) → „70°"
  //  • „$Știind că m(\angle B)=70^\circ$" (propoziție întreagă în math mode →
  //    litere italice lipite) → text normal cu simboluri unicode
  //  • „BC).Știind" → „BC). Știind" (spațiu după punct)
  var ROMTXT = /[ăâîșțĂÂÎȘȚ]|(?:^|[^\\a-zA-Z])(și|sau|este|sunt|fie|dacă|atunci|deci|află|arată|calculează|determină|știind|unghiul|unghiului|triunghiul|laturile|numerele|valoarea)(?![a-zA-Z])/i;
  function texToPlain(s){
    s = String(s || '');
    s = s.replace(/\\frac\s*\{([^{}]*)\}\s*\{([^{}]*)\}/g, '($1)/($2)');
    s = s.replace(/\^\s*\{?\s*(?:\\circ|∘|°)\s*\}?/g, '°');
    s = s.replace(/\\angle\b\s*/g, '∠').replace(/\\triangle\b\s*/g, '△')
         .replace(/\\in\b\s*/g, ' ∈ ').replace(/\\cdot\b\s*/g, '·').replace(/\\times\b\s*/g, '×')
         .replace(/\\pi\b/g, 'π').replace(/\\sqrt\s*\{([^{}]*)\}/g, '√($1)')
         .replace(/\\(leq?|geq?)\b/g, function(m, c){ return c[0] === 'l' ? '≤' : '≥'; })
         .replace(/\\neq?\b/g, '≠').replace(/\\pm\b/g, '±').replace(/\\equiv\b/g, '≡');
    s = s.replace(/\\[a-zA-Z]+\s*/g, ' ').replace(/[{}]/g, '');
    return s.replace(/\s{2,}/g, ' ');
  }
  function fixTypography(){
    try {
      var w = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, null), n;
      var nodes = [];
      while ((n = w.nextNode())) nodes.push(n);
      for (var i = 0; i < nodes.length; i++) {
        var t = nodes[i].nodeValue;
        if (!t || !/[$^.]/.test(t)) continue;
        var r = t
          // propoziție românească împachetată în $...$ → text simplu lizibil
          .replace(/\$([^$]+)\$/g, function(m, inner){ return ROMTXT.test(inner) ? texToPlain(inner) : m; })
          // grade cu caret literal, inclusiv forma „70^$\circ$" pre-KaTeX
          .replace(/(\d)\s*\^\s*\$\s*\\circ\s*\$/g, '$1°')
          .replace(/(\d)\s*\^\s*\{?\s*[∘°]\s*\}?/g, '$1°')
          // spațiu după punct înaintea propoziției următoare
          .replace(/([)\]])\.(?=[A-ZĂÎÂȘȚ])/g, '$1. ');
        if (r !== t) nodes[i].nodeValue = r;
      }
    } catch(e){}
  }
  fixTypography();
  setTimeout(fixTypography, 350);
  setTimeout(fixTypography, 1500);

  // ── Observă re-randările exercițiului ─────────────────────────────
  var deb = null;
  function refreshUI(){ rewireHintButtons(); ensureStepHelpers(); }
  function onMutate(){
    refreshUI();
    if (deb) clearTimeout(deb);
    deb = setTimeout(function(){
      tryReportScore(); // rezervă: teste cu altă funcție de corectare (detectăm panoul final)
      post('MATE_TUTOR_STATE', collect());
    }, 400);
  }
  function start(){
    refreshUI();
    // Dacă testul se deschide DEJA corectat (stare salvată local), reținem
    // scorul existent ca punct de plecare — nu îl re-raportăm la simpla
    // redeschidere; doar o corectare nouă (sau un scor schimbat) se trimite.
    try {
      var r0 = scoreFromStats() || scoreFromDom();
      if (r0) lastSig = r0.s + '/' + r0.m;
    } catch(e){}
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
  // Dacă exercițiul își raportează SINGUR scorul (șablonul platformei),
  // reporterul din bridge stă deoparte — altfel scorul s-ar salva de două ori.
  const nativeFlag = /MATE_SCORE/.test(html)
    ? '<scr' + 'ipt>window.__MATE_NATIVE_SCORE__=true;</scr' + 'ipt>'
    : '';
  const inject = nativeFlag + BRIDGE_SCRIPT;
  const idx = html.toLowerCase().lastIndexOf('</body>');
  if (idx === -1) return html + inject;
  return html.slice(0, idx) + inject + html.slice(idx);
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
