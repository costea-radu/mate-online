// =====================================================================
// api/_lib/exgen.js — GENERAREA AUTOMATĂ de exerciții pe rubrici + POSTAREA
// pe site, partajate de:
//   • api/ai-exercise-agent.js (acțiunea „auto" din admin — butonul ⚙️)
//   • api/agent-tasks.js       (task-urile programate: CRUD + „Rulează acum")
//   • api/agent-cron.js        (cronul orar care execută task-urile scadente)
//
// Conține:
//   runAuto({supa, category, subcategory, profile, ctype, instructions,
//            resultKind, dataMode, aiModel})
//       → { html? | exercise?, provider, combinedFrom, template?, usage }
//       (logica mutată NEMODIFICAT din ai-exercise-agent.js, plus alegerea
//        modelului AI per rulare — aiModel, validat în claude.resolveModel)
//   normalize(ex)            — validarea/curățarea JSON-ului de exercițiu
//   renderExerciseHtml(ex)   — HTML interactiv autonom (copie CJS a
//                              src/lib/exerciseRender.js → renderExercise;
//                              ține-le SINCRON dacă schimbi designul)
//   postContent({...})       — încarcă HTML-ul în Storage + rând în `content`
//   runTask({supa, task, triggerKind}) — execută UN task programat cap-coadă:
//       generare → postare automată SAU rezultat „pending_review" → istoricul
//       rulărilor (agent_task_runs) → email către admin (dacă task.notify)
//   postRun({supa, runId})   — postează pe site rezultatul unei rulări
//                              „pending_review" (aprobat manual de admin)
// =====================================================================
const fs = require('fs');
const path = require('path');
const claude = require('./claude');
const { modeLine } = require('./pdftext');

function httpErr(status, message) {
  const e = new Error(message);
  e.status = status;
  return e;
}

// ─── Validarea exercițiului JSON (mutat din ai-exercise-agent.js) ───────────
function normalize(ex) {
  if (!ex || typeof ex !== 'object') return null;
  const kind = ex.kind === 'etape' ? 'etape' : 'grila';
  const out = {
    title: String(ex.title || 'Exercițiu generat'), kind,
    statement: String(ex.statement || ''),
    output: ex.output === 'pdf' ? 'pdf' : 'interactive',
  };
  if (kind === 'grila') {
    const qs = Array.isArray(ex.questions) ? ex.questions : [];
    out.questions = qs.slice(0, 20).map((q) => ({
      statement: String(q.statement || ''),
      options: Array.isArray(q.options) && q.options.length ? q.options.slice(0, 6).map(String) : undefined,
      answer: Array.isArray(q.options) && q.options.length ? Math.max(0, Number(q.answer) || 0) : String(q.answer ?? ''),
      hint: String(q.hint || ''),
      explanation: String(q.explanation || ''),
      points: Math.max(1, Number(q.points) || 10),
    })).filter((q) => q.statement);
    if (!out.questions.length) return null;
  } else {
    const st = Array.isArray(ex.steps) ? ex.steps : [];
    out.steps = st.slice(0, 20).map((s) => ({
      prompt: String(s.prompt || s.text || ''),
      answer: String(s.answer ?? ''),
      hint: String(s.hint || ''),
      explanation: String(s.explanation || ''),
      points: Math.max(1, Number(s.points) || 10),
    })).filter((s) => s.prompt);
    out.final_answer = String(ex.final_answer || '');
    if (!out.steps.length || !out.statement) return null;
  }
  return out;
}

// ─── AUTOMATIZAREA pe rubrică (mutată din ai-exercise-agent.js, acțiunea
// „auto") — combină teste existente din rubrică într-un test NOU.
// Rubrici INTERACTIVE → FORMATUL STANDARD (HTML cu figuri + desen), sau
// „exam" → subiect structurat (JSON). Rubrici PDF → test structurat (JSON),
// sau „interactive" → FORMATUL STANDARD. `aiModel` = ID-ul Claude ales
// (opțional; validat în claude.resolveModel — necunoscut → implicitul).
// Adună usage-ul tuturor apelurilor; apelantul face ai.logUsage.
async function runAuto({ supa, category, subcategory = null, profile = null, ctype = 'interactive', instructions: autoInstr = '', resultKind = 'auto', dataMode = 'modify', aiModel = null }) {
  if (!category) throw httpErr(400, 'Alege rubrica (categoria).');
  let q = supa.from('content')
    .select('id, title, file_url, interactive_data, subcategory, content_type')
    .eq('content_type', ctype).eq('category', category);
  if (subcategory && String(subcategory).includes('+')) q = q.in('subcategory', String(subcategory).split('+'));
  else if (subcategory) q = q.eq('subcategory', subcategory);
  if (profile) q = q.eq('profile', profile); // separă strict profilurile BAC
  const { data: rows } = await q.limit(40);
  if (!rows || rows.length < 2) throw httpErr(400, 'Rubrica are prea puține materiale (minim 2) pentru combinare.');

  const parsePath = (fileUrl) => {
    const url = new URL(fileUrl);
    const parts = url.pathname.split('/');
    const oi = parts.findIndex((x) => x === 'object');
    return { bucket: parts[oi + 2], filePath: parts.slice(oi + 3).join('/').split('?')[0] };
  };
  const shuffled = [...rows].sort(() => Math.random() - 0.5);

  // ── Rubrici PDF (exerciții / teste / bareme) ──
  if (ctype === 'pdf') {
    const blocksA = [];
    const names = [];
    for (const r of shuffled) {
      if (names.length >= 3) break;
      try {
        const { bucket, filePath } = parsePath(r.file_url);
        const { data: blob } = await supa.storage.from(bucket).download(filePath);
        if (!blob) continue;
        const buf = Buffer.from(await blob.arrayBuffer());
        if (buf.length > 2.5 * 1024 * 1024) continue;
        blocksA.push({ type: 'text', text: `TESTUL ${String.fromCharCode(65 + names.length)}: ${r.title}` });
        blocksA.push({ type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: buf.toString('base64') } });
        names.push(r.title);
      } catch { /* sursă ignorată */ }
    }
    if (names.length < 2) throw httpErr(400, 'Nu am putut folosi suficiente PDF-uri din rubrică (fiecare max ~2,5 MB).');

    // ── rezultat INTERACTIV (format standard) cu exerciții din PDF-uri ──
    if (resultKind === 'interactive') {
      let tpl = null;
      try { tpl = fs.readFileSync(path.join(__dirname, 'template-standard.html'), 'utf8').slice(0, 120000); } catch { /* n/a */ }
      if (!tpl) throw httpErr(500, 'Șablonul standard lipsește.');
      const lettersD = names.map((_, i) => String.fromCharCode(65 + i)).sort(() => Math.random() - 0.5);
      const planD = Array.from({ length: 8 }, (_, i) => `- Itemul ${i + 1} (dacă nu are figură) ← TESTUL ${lettersD[i % lettersD.length]}, un exercițiu ales aleatoriu.`).join('\n');
      const sysD = `Ești agentul de creare de exerciții al platformei ExamenMate (matematică, românește).
Primești ȘABLONUL HTML STANDARD al site-ului (test interactiv cu figuri și instrumente de desen) și ${names.length} subiecte PDF din rubrica „${category}${subcategory ? ' / ' + subcategory : ''}”.
Construiește un TEST INTERACTIV NOU în ACELAȘI fișier-format ca șablonul, cu exercițiile preluate din PDF-uri după plan:
${planD}
Reguli: COPIAZĂ întocmai tot ce nu ține de conținutul itemilor (CSS, JavaScript, instrumente de desen, bara de scor, MATE_SCORE). FIGURILE din șablon NU se modifică deloc; itemii cu figură rămân ai șablonului. REGIM DE LUCRU CU DATELE: ${modeLine(dataMode)}
Răspunde DOAR cu documentul HTML complet (<!doctype html> … </html>).`;
      blocksA.push({ type: 'text', text: `ȘABLONUL STANDARD:\n${tpl}\n\nConstruiește acum testul interactiv.${String(autoInstr || '').trim() ? ` INSTRUCȚIUNILE ADMINULUI (prioritare): ${String(autoInstr).slice(0, 3000)}` : ''} Sesiune #${Math.random().toString(36).slice(2, 8)}.` });
      const rD = await claude.chatClaude({ system: sysD, messages: [{ role: 'user', content: blocksA }], maxTokens: 24000, model: aiModel });
      let hOut = String(rD.text || '');
      const fD = hOut.match(/```(?:html)?\s*([\s\S]*?)```/i); if (fD) hOut = fD[1];
      const sD = hOut.search(/<!doctype html|<html[\s>]/i); const eD = hOut.lastIndexOf('</html>');
      if (sD !== -1 && eD > sD) hOut = hOut.slice(sD, eD + 7);
      hOut = hOut.trim();
      const tplSvgsD = tpl.match(/<svg[\s\S]*?<\/svg>/gi) || [];
      if (tplSvgsD.length) { let k = 0; hOut = hOut.replace(/<svg[\s\S]*?<\/svg>/gi, (m) => (k < tplSvgsD.length ? tplSvgsD[k++] : m)); }
      if (sD === -1 || hOut.length < 600) {
        console.error('exgen(auto-pdf-interactiv): invalid. stopReason=%s', rD.stopReason);
        throw httpErr(502, 'Nu am obținut un fișier interactiv valid din PDF-uri. Mai încearcă.');
      }
      return { html: hOut, provider: rD.provider, combinedFrom: names, template: 'șablonul standard', usage: rD.usage };
    }

    const lettersP = names.map((_, i) => String.fromCharCode(65 + i)).sort(() => Math.random() - 0.5);
    const planP = Array.from({ length: 10 }, (_, i) => `- Itemul ${i + 1} ← TESTUL ${lettersP[i % lettersP.length]}, itemul nr. ${1 + Math.floor(Math.random() * 5)} din el (sau alt item al aceluiași test).`).join('\n');
    const sysPdf = `Ești agentul de creare de exerciții al platformei ExamenMate (matematică, românește).
Primești ${names.length} teste PDF existente din rubrica „${category}${subcategory ? ' / ' + subcategory : ''}”.
Construiește URMĂTORUL test al rubricii (nr. ${rows.length + 1}) prin COMBINARE, după PLANUL DE MAI JOS (tras la sorți pe server — respectă-l întocmai, ca generările succesive să fie DIFERITE):
${planP}
Pentru fiecare poziție: COPIAZĂ itemul indicat (enunț, tip, structură). REGIM DE LUCRU CU DATELE: ${modeLine(dataMode)} Păstrează structura și baremul tipic rubricii.
Răspunde STRICT cu UN obiect JSON valid (fără alt text):
{ "title": "…", "kind": "grila", "statement": "", "questions": [ { "statement": "…", "options": ["A","B","C","D"], "answer": 0, "hint": "…", "explanation": "…", "points": 5 } ] }
Itemii cu răspuns liber: OMITE "options", "answer" ca text. LaTeX între $...$ cu backslash dublu. Verifică-ți calculele.`;
    blocksA.push({ type: 'text', text: `Construiește acum testul nr. ${rows.length + 1}.${String(autoInstr || '').trim() ? ` INSTRUCȚIUNILE ADMINULUI (prioritare): ${String(autoInstr).slice(0, 3000)}` : ''} Sesiune #${Math.random().toString(36).slice(2, 8)}.` });
    const rP = await claude.chatClaude({ system: sysPdf, messages: [{ role: 'user', content: blocksA }], maxTokens: 9000, model: aiModel });
    const exP = normalize(claude.extractJson(rP.text));
    if (!exP) {
      console.error('exgen(auto-pdf): invalid. stopReason=%s', rP.stopReason);
      throw httpErr(502, 'Automatizarea nu a produs un test valid din PDF-uri. Mai încearcă o dată.');
    }
    exP.title = exP.title || `Test ${rows.length + 1} · ${category}${subcategory ? ' / ' + subcategory : ''}`;
    exP.output = 'pdf';
    return { exercise: exP, provider: rP.provider, combinedFrom: names, usage: rP.usage };
  }

  // ── rubrici interactive → SUBIECT PDF (test structurat) la cerere ──
  if (ctype === 'interactive' && resultKind === 'exam') {
    const srcTexts = [];
    for (const r of shuffled) {
      if (srcTexts.length >= 5) break;
      try {
        if (r.interactive_data?.exercise) { srcTexts.push({ title: r.title, text: JSON.stringify(r.interactive_data.exercise).slice(0, 5000) }); continue; }
        const { bucket, filePath } = parsePath(r.file_url);
        const { data: blob } = await supa.storage.from(bucket).download(filePath);
        if (!blob) continue;
        const raw = Buffer.from(await blob.arrayBuffer()).toString('utf8');
        const t = raw.replace(/<script[\s\S]*?<\/script>/gi, ' ').replace(/<style[\s\S]*?<\/style>/gi, ' ').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
        if (t.length > 200) srcTexts.push({ title: r.title, text: t.slice(0, 5000) });
      } catch { /* ignorată */ }
    }
    if (srcTexts.length < 2) throw httpErr(400, 'Prea puține surse utilizabile în rubrică.');
    const lettersE = srcTexts.map((_, i) => String.fromCharCode(65 + i)).sort(() => Math.random() - 0.5);
    const planE = Array.from({ length: 10 }, (_, i) => `- Itemul ${i + 1} ← TESTUL ${lettersE[i % lettersE.length]}, un exercițiu ales aleatoriu.`).join('\n');
    const sysE = `Ești agentul de creare de exerciții al platformei ExamenMate (matematică, românește).
Primești ${srcTexts.length} teste din rubrica „${category}${subcategory ? ' / ' + subcategory : ''}”. Construiește un SUBIECT DE EXAMEN NOU prin combinare, după plan:
${planE}
REGIM DE LUCRU CU DATELE: ${modeLine(dataMode)}
Răspunde STRICT cu UN obiect JSON valid: { "title": "…", "kind": "grila", "statement": "", "questions": [ { "statement": "…", "options": ["A","B","C","D"], "answer": 0, "hint": "…", "explanation": "…", "points": 5 } ] } (itemii cu răspuns liber: fără "options", "answer" text; LaTeX cu backslash dublu).`;
    const blkE = srcTexts.map((x, i) => `=== TESTUL ${String.fromCharCode(65 + i)}: ${x.title} ===\n${x.text}`).join('\n\n');
    const rE = await claude.chatClaude({ system: sysE, messages: [{ role: 'user', content: `${blkE}\n\nConstruiește subiectul acum.${String(autoInstr || '').trim() ? ` INSTRUCȚIUNI: ${String(autoInstr).slice(0, 3000)}` : ''} #${Math.random().toString(36).slice(2, 8)}` }], maxTokens: 9000, model: aiModel });
    const exE = normalize(claude.extractJson(rE.text));
    if (!exE) throw httpErr(502, 'Nu am obținut un subiect valid. Mai încearcă.');
    exE.output = 'pdf';
    return { exercise: exE, provider: rE.provider, combinedFrom: srcTexts.map((x) => x.title), usage: rE.usage };
  }

  // ── Rubrici INTERACTIVE → FORMATUL STANDARD (figuri + desen) ──
  let templateHtml = null;
  let templateName = null;
  const sources = [];
  for (const r of shuffled) {
    try {
      if (r.interactive_data?.exercise) {
        if (sources.length < 5) sources.push({ title: r.title, text: JSON.stringify(r.interactive_data.exercise).slice(0, 6000) });
        continue;
      }
      const { bucket, filePath } = parsePath(r.file_url);
      const { data: blob } = await supa.storage.from(bucket).download(filePath);
      if (!blob) continue;
      const raw = Buffer.from(await blob.arrayBuffer()).toString('utf8');
      // formatul standard: figuri geometrice + instrumente de desen + scor
      const isStandard = /desen|<canvas|class="fig"/i.test(raw) && /MATE_SCORE/.test(raw);
      if (!templateHtml && isStandard && raw.length < 200000) { templateHtml = raw.slice(0, 120000); templateName = r.title; }
      const textOnly = raw.replace(/<script[\s\S]*?<\/script>/gi, ' ').replace(/<style[\s\S]*?<\/style>/gi, ' ').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
      if (textOnly.length > 200 && sources.length < 5) sources.push({ title: r.title, text: textOnly.slice(0, 6000) });
    } catch { /* sursă ignorată */ }
  }
  if (!templateHtml) {
    try {
      templateHtml = fs.readFileSync(path.join(__dirname, 'template-standard.html'), 'utf8').slice(0, 120000);
      templateName = 'șablonul standard al site-ului';
    } catch { /* lipsă */ }
  }
  if (sources.length < 2) throw httpErr(400, 'Nu am putut extrage conținut din suficiente teste ale rubricii.');
  if (!templateHtml) throw httpErr(500, 'Nu am găsit șablonul formatului standard.');

  const lettersI = sources.map((_, i) => String.fromCharCode(65 + i)).sort(() => Math.random() - 0.5);
  const planI = Array.from({ length: 8 }, (_, i) => `- Itemul ${i + 1} (DOAR dacă nu are figură) ← TESTUL ${lettersI[i % lettersI.length]}, itemul nr. ${1 + Math.floor(Math.random() * 5)} din el (sau alt item al aceluiași test), cu numere/notații noi.`).join('\n');
  const sysAuto = `Ești agentul de creare de exerciții al platformei ExamenMate (matematică, românește).
Primești un ȘABLON HTML în FORMATUL STANDARD al site-ului (test interactiv cu figuri geometrice SVG și instrumente de desen) și ${sources.length} teste existente din rubrica „${category}${subcategory ? ' / ' + subcategory : ''}”.
Sarcina: construiește URMĂTORUL test al rubricii (nr. ${rows.length + 1}), ÎN ACELAȘI FIȘIER-FORMAT ca șablonul.

PLAN DE COMBINARE — tras la sorți pe server; respectă-l întocmai, ca generările succesive să fie DIFERITE (excepție: itemii cu figură, care rămân ai șablonului):
${planI}

Reguli:
- COPIAZĂ ÎNTOCMAI tot ce nu ține de conținutul itemilor: CSS-ul complet, TOT JavaScript-ul, instrumentele de desen, structura pe subiecte, bara de scor — NIMIC eliminat sau simplificat;
- pentru pozițiile din plan: COPIAZĂ itemul indicat; REGIM DE LUCRU CU DATELE: ${modeLine(dataMode)};
- același număr de itemi și aceeași structură (subiecte, punctaje) ca șablonul;
- FIGURILE/DESENELE (SVG, canvas) NU SE MODIFICĂ DELOC — rămân EXACT cele din șablon, cu aceleași etichete și valori (oricum vor fi restaurate programatic din șablon, deci orice modificare a lor e inutilă și greșită);
- itemii CU figură rămân cei ai șablonului: enunț, valori și notații consistente cu figura, cel mult mici reformulări care NU contrazic figura; combini din celelalte teste DOAR itemii FĂRĂ figură;
- păstrează raportarea scorului (MATE_SCORE) exact ca în șablon.
Răspunde DOAR cu documentul HTML complet (de la <!doctype html> la </html>), fără explicații, fără markdown.`;

  const srcBlock = sources.map((x, i) => `=== TESTUL ${String.fromCharCode(65 + i)}: ${x.title} ===\n${x.text}`).join('\n\n');
  const rA = await claude.chatClaude({
    system: sysAuto,
    messages: [{ role: 'user', content: `ȘABLONUL (formatul standard):\n${templateHtml}\n\n${srcBlock}\n\nConstruiește ACUM testul nr. ${rows.length + 1} — doar documentul HTML.${String(autoInstr || '').trim() ? ` INSTRUCȚIUNILE ADMINULUI (prioritare, dar desenele tot NU se modifică): ${String(autoInstr).slice(0, 3000)}` : ''} Sesiune #${Math.random().toString(36).slice(2, 8)}.` }],
    maxTokens: 24000,
    model: aiModel,
  });

  let htmlOut = String(rA.text || '');
  const fenceA = htmlOut.match(/```(?:html)?\s*([\s\S]*?)```/i);
  if (fenceA) htmlOut = fenceA[1];
  const st = htmlOut.search(/<!doctype html|<html[\s>]/i);
  const en = htmlOut.lastIndexOf('</html>');
  if (st !== -1 && en > st) htmlOut = htmlOut.slice(st, en + 7);
  htmlOut = htmlOut.trim();

  // Garanție: restaurăm figurile EXACT din șablon (desenele nu se modifică deloc)
  const tplSvgs = templateHtml.match(/<svg[\s\S]*?<\/svg>/gi) || [];
  if (tplSvgs.length) {
    let svgIdx = 0;
    htmlOut = htmlOut.replace(/<svg[\s\S]*?<\/svg>/gi, (m) => (svgIdx < tplSvgs.length ? tplSvgs[svgIdx++] : m));
  }

  if (st === -1 || htmlOut.length < 600) {
    console.error('exgen(auto-html): invalid. stopReason=%s', rA.stopReason);
    throw httpErr(502, rA.stopReason === 'max_tokens' ? 'Șablonul rubricii e prea mare pentru o singură generare — mai încearcă (sau folosește o rubrică cu teste mai mici).' : 'Automatizarea nu a produs un fișier valid. Mai încearcă o dată.');
  }
  return { html: htmlOut, provider: rA.provider, combinedFrom: sources.map((x) => x.title), template: templateName, usage: rA.usage };
}

// =====================================================================
// RANDAREA exercițiului JSON ca HTML interactiv autonom.
// COPIE CJS a src/lib/exerciseRender.js (renderExercise) + autoMath din
// src/lib/katex.js — dacă schimbi designul acolo, oglindește-l și aici.
// =====================================================================
const CMDS = 'cdot|times|div|pm|mp|angle|pi|alpha|beta|gamma|delta|theta|lambda|mu|omega|leq|geq|le|ge|neq|approx|equiv|infty|circ|Delta|Omega|deg|notin|in|subseteq|subset|supset|cup|cap|Rightarrow|rightarrow|leftarrow|to|forall|exists';

function wrapBare(s) {
  if (!s) return s;
  s = s.replace(/\\frac\s*\{[^{}]*\}\s*\{[^{}]*\}/g, (m) => '$' + m + '$');
  s = s.replace(/\\sqrt\s*(\[[^\]]*\])?\s*\{[^{}]*\}/g, (m) => '$' + m + '$');
  s = s.replace(/((?:\d+[A-Za-z]?)?\([^()]*\)|\[[^\][]*\]|\d+(?:[.,]\d+)?|[A-Za-z0-9])(\^|_)(\{[^{}]*\}|[A-Za-z0-9]+)/g, (m) => '$' + m + '$');
  s = s.replace(new RegExp('\\\\(' + CMDS + ')\\b', 'g'), (m) => '$' + m + '$');
  s = s.replace(/\$\s*\$/g, ' ');
  return s;
}

function autoMath(input) {
  if (!input || (input.indexOf('\\') === -1 && input.indexOf('^') === -1 && input.indexOf('_') === -1)) return input;
  const parts = String(input).split(/(\$\$[^$]*\$\$|\$[^$]*\$|\\\([^)]*\\\)|\\\[[^\]]*\\\])/g);
  return parts.map((seg, i) => (i % 2 === 1 ? seg : wrapBare(seg))).join('');
}

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
    e: q.explanation || '',
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
  var D=${JSON.stringify(data)};
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

  const data = steps.map((s) => ({ a: String(s.answer ?? ''), p: Number(s.points) || 0, e: s.explanation || '' }));

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
  var D=${JSON.stringify(data)};
  document.getElementById('check').addEventListener('click', function(){
    var got=0, max=0;
    for(var i=0;i<D.length;i++){
      max+=D[i].p;
      var el=document.querySelector('input[name="q'+i+'"]');
      var ok=el&&norm(el.value)===norm(D[i].a);
      if(ok) got+=D[i].p;
      var fb=document.getElementById('fb'+i);
      fb.className='fb '+(ok?'ok':'bad');
      fb.innerHTML=(ok?'✓ Corect (+'+D[i].p+' p)':'✗ Greșit (0 p) — răspuns corect: '+D[i].a)+(D[i].e?'<div class="exp"><b>Barem/rezolvare:</b> '+D[i].e+'</div>':'');
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

function renderExerciseHtml(exercise) {
  const ex = exercise || {};
  return ex.kind === 'etape' ? renderEtape(ex) : renderGrila(ex);
}

// ─── Postarea pe site: Storage + rând în `content` (ca formularele din Admin) ─
function slug(s) {
  return String(s || 'exercitiu').toLowerCase()
    .replace(/[ăâ]/g, 'a').replace(/î/g, 'i').replace(/[șş]/g, 's').replace(/[țţ]/g, 't')
    .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60) || 'exercitiu';
}

async function postContent({ supa, title, description = '', category, subcategory = null, profile = null, isFree = false, html = null, exercise = null, postType = 'test', taskId = null }) {
  const finalHtml = html || renderExerciseHtml(exercise);
  if (!finalHtml || finalHtml.length < 200) throw httpErr(500, 'Nu există conținut de postat.');
  const bucket = isFree ? 'content-files-free' : 'content-files';
  const storagePath = `interactive/${category}/${Date.now()}_task_${slug(title)}.html`;
  const { error: upErr } = await supa.storage.from(bucket)
    .upload(storagePath, Buffer.from(finalHtml, 'utf8'), { contentType: 'text/html' });
  if (upErr) throw httpErr(502, `Încărcarea în Storage a eșuat: ${upErr.message}`);
  const { data: urlData } = supa.storage.from(bucket).getPublicUrl(storagePath);
  const row = {
    title: String(title || 'Test generat').slice(0, 300),
    description: String(description || '').slice(0, 500),
    category, content_type: 'interactive', is_free: !!isFree,
    file_url: urlData?.publicUrl || storagePath,
    interactive_data: {
      type: postType === 'exercise' ? 'exercise' : 'test',
      html: true, ai_generated: true, agent: 'claude',
      ...(taskId ? { agent_task: taskId } : {}),
      ...(exercise ? { exercise } : {}),
    },
    subcategory: subcategory || null,
    profile: profile || null,
    sort_order: 0,
  };
  const { data: ins, error: dbErr } = await supa.from('content').insert(row).select('id').single();
  if (dbErr) {
    await supa.storage.from(bucket).remove([storagePath]).catch(() => {});
    throw httpErr(502, `Salvarea în baza de date a eșuat: ${dbErr.message}`);
  }
  return { contentId: ins?.id || null, fileUrl: row.file_url };
}

// ─── Emailul către admin după o rulare programată (dacă task.notify) ─────────
async function notifyAdmin({ task, run }) {
  const mailer = require('./mailer');
  if (!task.notify || !mailer.enabled()) return false;
  const site = (process.env.SITE_URL || 'https://examenmate.com').replace(/\/$/, '');
  const rubric = `${task.category}${task.subcategory ? ' / ' + task.subcategory : ''}${task.profile ? ' · ' + task.profile : ''}`;
  const state = run.status === 'posted'
    ? { subj: `🤖 Task „${task.name}”: test nou PUBLICAT pe site`, head: 'Testul a fost generat și publicat automat pe site.' }
    : run.status === 'pending_review'
      ? { subj: `🤖 Task „${task.name}”: test generat — așteaptă aprobarea ta`, head: 'Testul a fost generat și AȘTEAPTĂ aprobarea ta în admin (nu e pe site încă).' }
      : { subj: `⚠️ Task „${task.name}”: eroare la generare`, head: 'Rularea programată a eșuat.' };
  const html = mailer.template({
    title: state.subj.replace(/^[^ ]+ /, ''),
    preheader: run.title || rubric,
    bodyHtml: `
      <p>${state.head}</p>
      <ul style="padding-left:20px">
        <li><strong>Task:</strong> ${mailer.escapeHtml(task.name)}</li>
        <li><strong>Rubrica:</strong> ${mailer.escapeHtml(rubric)}</li>
        ${run.title ? `<li><strong>Titlu generat:</strong> ${mailer.escapeHtml(run.title)}</li>` : ''}
        ${run.provider ? `<li><strong>Model AI:</strong> ${mailer.escapeHtml(run.provider)}</li>` : ''}
        ${run.error ? `<li style="color:#b71c1c"><strong>Eroare:</strong> ${mailer.escapeHtml(run.error)}</li>` : ''}
      </ul>
      <p style="margin-top:16px"><a href="${site}/admin" style="display:inline-block;background:#17233f;color:#fff;padding:10px 18px;border-radius:8px;text-decoration:none;font-weight:600">Deschide panoul de admin</a></p>`,
    footerNote: 'Email automat de la agentul Claude de exerciții (task programat). Gestionezi task-urile din Admin → Agent Claude → Task-uri programate.',
  });
  const r = await mailer.sendMail({ to: mailer.ADMIN_EMAIL, subject: state.subj, html });
  return !!r.ok;
}

// ─── Execuția completă a unui task programat (folosită de cron și „Rulează acum”) ─
async function runTask({ supa, task, triggerKind = 'cron' }) {
  const startedAt = new Date().toISOString();
  const run = {
    task_id: task.id, trigger_kind: triggerKind, status: 'error',
    title: null, provider: null, content_id: null, error: null, result: null, combined_from: null,
  };
  let usage = null;
  try {
    const g = await runAuto({
      supa,
      category: task.category, subcategory: task.subcategory, profile: task.profile,
      ctype: task.ctype || 'interactive',
      instructions: task.instructions || '',
      resultKind: task.result_kind || 'auto',
      dataMode: task.data_mode || 'modify',
      aiModel: task.ai_model || null,
    });
    usage = g.usage || null;
    run.provider = g.provider || null;
    run.combined_from = g.combinedFrom || null;
    run.title = (g.exercise && g.exercise.title)
      || (String(g.html || '').match(/<title>([^<]*)<\/title>/i)?.[1] || '').trim()
      || `Test generat · ${task.name}`;

    if (task.auto_post) {
      const dateRo = new Date().toLocaleDateString('ro-RO', { timeZone: 'Europe/Bucharest' });
      const posted = await postContent({
        supa,
        title: run.title,
        description: `Generat automat de agentul Claude (task „${task.name}”) · ${dateRo}`,
        category: task.category, subcategory: task.subcategory, profile: task.profile,
        isFree: !!task.is_free,
        html: g.html || null, exercise: g.exercise || null,
        postType: task.post_type || 'test',
        taskId: task.id,
      });
      run.status = 'posted';
      run.content_id = posted.contentId;
    } else {
      run.status = 'pending_review';
      // rezultatul rămâne în istoricul rulărilor până îl aprobi/ștergi din
      // admin (plafonat sub ~1 MB — limita payload-ului API-ului Supabase)
      run.result = g.html
        ? { kind: 'html', html: String(g.html).slice(0, 700000) }
        : { kind: 'exercise', exercise: g.exercise };
    }
  } catch (e) {
    run.error = String(e?.message || e || 'eroare necunoscută').slice(0, 900);
  }

  const { data: inserted } = await supa.from('agent_task_runs').insert(run).select('id').single();
  await supa.from('agent_tasks').update({
    last_run_at: startedAt,
    last_status: run.status,
    last_error: run.error,
  }).eq('id', task.id);
  const emailed = await notifyAdmin({ task, run }).catch((e) => { console.warn('exgen: email eșuat:', e.message); return false; });

  return { ok: run.status !== 'error', runId: inserted?.id || null, run, usage, emailed };
}

// ─── Aprobarea manuală: postează rezultatul unei rulări „pending_review” ─────
async function postRun({ supa, runId }) {
  const { data: run, error } = await supa.from('agent_task_runs').select('*').eq('id', runId).single();
  if (error || !run) throw httpErr(404, 'Rularea nu a fost găsită.');
  if (run.status !== 'pending_review') throw httpErr(400, 'Doar rulările „așteaptă aprobare” se pot posta.');
  if (!run.result || (!run.result.html && !run.result.exercise)) throw httpErr(400, 'Rularea nu mai are rezultatul salvat.');
  const { data: task } = await supa.from('agent_tasks').select('*').eq('id', run.task_id).single();
  if (!task) throw httpErr(404, 'Task-ul rulării nu mai există.');

  const dateRo = new Date().toLocaleDateString('ro-RO', { timeZone: 'Europe/Bucharest' });
  const posted = await postContent({
    supa,
    title: run.title || `Test generat · ${task.name}`,
    description: `Generat de agentul Claude (task „${task.name}”) · aprobat ${dateRo}`,
    category: task.category, subcategory: task.subcategory, profile: task.profile,
    isFree: !!task.is_free,
    html: run.result.html || null, exercise: run.result.exercise || null,
    postType: task.post_type || 'test',
    taskId: task.id,
  });
  // eliberăm HTML-ul din istoric (exercițiul JSON rămâne pe rândul din `content`)
  await supa.from('agent_task_runs').update({ status: 'posted', content_id: posted.contentId, result: null }).eq('id', runId);
  return { contentId: posted.contentId, fileUrl: posted.fileUrl };
}

module.exports = { runAuto, normalize, renderExerciseHtml, postContent, runTask, postRun, notifyAdmin };
