// =====================================================================
// api/ai-exercise-agent.js — AGENTUL CLAUDE de generare exerciții (admin).
// Primește un FIȘIER-MODEL (PDF trimis nativ către Claude / text extras
// din HTML) + INSTRUCȚIUNILE adminului (mesaj liber, stil chat) și
// generează un exercițiu asemănător: grilă sau cu etape de rezolvare
// (indicii + barem + punctaj). Formatul se alege automat după model,
// dacă instrucțiunile nu cer altceva.
// Body: { userId, instructions?, model?, modelPdf?(base64), history? }
//   - model    = text-model (HTML convertit în text) SAU exercițiul curent
//                (JSON) când se cere o variantă nouă / asemănătoare.
//   - modelPdf = PDF-ul model, base64 (necesită ANTHROPIC_API_KEY).
// Răspuns: { exercise, provider }
// =====================================================================
const fs = require('fs');
const path = require('path');
const ai = require('./_lib/ai');
const claude = require('./_lib/claude');

const SCHEMAS = `— GRILĂ:
{
  "title": "titlul exercițiului",
  "kind": "grila",
  "output": "interactive sau pdf — formatul de salvare cerut de admin (implicit interactive)",
  "statement": "context general (opțional, poate fi gol)",
  "questions": [
    { "statement": "enunț (LaTeX între $...$)", "options": ["A", "B", "C", "D"],
      "answer": 0, "hint": "indiciu fără răspuns", "explanation": "rezolvarea completă", "points": 10 }
  ]
}
— CU ETAPE DE REZOLVARE:
{
  "title": "titlul exercițiului",
  "kind": "etape",
  "statement": "enunțul complet al problemei (LaTeX între $...$)",
  "steps": [
    { "prompt": "ce se cere la această etapă", "answer": "răspuns scurt (număr/expresie)",
      "hint": "indiciu fără răspuns", "explanation": "rezolvarea etapei (barem)", "points": 10 }
  ],
  "final_answer": "răspunsul final"
}`;

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

module.exports = async function handler(req, res) {
  ai.applyCors(res);
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method Not Allowed' });

  const supa = ai.admin();
  try {
    const userId = await ai.authUser(req, supa);
    await ai.requireAdmin(supa, userId);

    const { action = null, instructions = '', model = null, modelPdf = null, formatText = null, formatPdf = null, formatHtml = null, currentHtml = null, history = [] } = req.body || {};

    // ── Acțiune: adu un material din baza de date ca model (HTML sau PDF) ──
    if (action === 'fetch-model') {
      const { contentId } = req.body || {};
      const { data: row, error: rowErr } = await supa.from('content')
        .select('id, title, content_type, file_url').eq('id', contentId).single();
      if (rowErr || !row) return res.status(404).json({ error: 'Materialul nu a fost găsit.' });
      const { bucket, filePath } = (() => {
        const url = new URL(row.file_url);
        const parts = url.pathname.split('/');
        const oi = parts.findIndex((x) => x === 'object');
        return { bucket: parts[oi + 2], filePath: parts.slice(oi + 3).join('/').split('?')[0] };
      })();
      const { data: blob, error: dlErr } = await supa.storage.from(bucket).download(filePath);
      if (dlErr || !blob) return res.status(502).json({ error: 'Nu am putut descărca fișierul din storage.' });
      const buf = Buffer.from(await blob.arrayBuffer());
      if (/\.pdf(\?|$)/i.test(filePath) || row.content_type === 'pdf') {
        if (buf.length > 3.2 * 1024 * 1024) return res.status(400).json({ error: 'PDF-ul din baza de date e prea mare (max ~3 MB).' });
        return res.status(200).json({ title: row.title, pdf: buf.toString('base64') });
      }
      const rawHtml = buf.toString('utf8');
      const textOnly = rawHtml.replace(/<script[\s\S]*?<\/script>/gi, ' ').replace(/<style[\s\S]*?<\/style>/gi, ' ').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
      return res.status(200).json({ title: row.title, html: rawHtml.slice(0, 120000), text: textOnly.slice(0, 20000) });
    }

    // ── Acțiune: AUTOMATIZARE — testul următor al unei rubrici ──
    // Rubrici INTERACTIVE → rezultat în FORMATUL STANDARD („interactiv Claude”:
    // figuri geometrice + instrumente de desen), clonat dintr-un test existent
    // al rubricii sau din șablonul standard inclus. Rubrici PDF → test structurat,
    // cu sursele PDF citite nativ de Claude.
    if (action === 'auto') {
      const { category, subcategory = null, ctype = 'interactive', instructions: autoInstr = '' } = req.body || {};
      if (!category) return res.status(400).json({ error: 'Alege rubrica (categoria).' });
      let q = supa.from('content')
        .select('id, title, file_url, interactive_data, subcategory, content_type')
        .eq('content_type', ctype).eq('category', category);
      if (subcategory) q = q.eq('subcategory', subcategory);
      const { data: rows } = await q.limit(40);
      if (!rows || rows.length < 2) return res.status(400).json({ error: 'Rubrica are prea puține materiale (minim 2) pentru combinare.' });

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
        if (names.length < 2) return res.status(400).json({ error: 'Nu am putut folosi suficiente PDF-uri din rubrică (fiecare max ~2,5 MB).' });

        const sysPdf = `Ești agentul de creare de exerciții al platformei ExamenMate (matematică, românește).
Primești ${names.length} teste PDF existente din rubrica „${category}${subcategory ? ' / ' + subcategory : ''}”.
Construiește URMĂTORUL test al rubricii (nr. ${rows.length + 1}) prin COMBINARE: itemul 1 preluat/adaptat din TESTUL A, itemul 2 din TESTUL B, itemul 3 din TESTUL C... (ciclic), SCHIMBÂND numerele/valorile sau notațiile (rezultate recalculate corect). Păstrează structura și baremul tipic rubricii.
Răspunde STRICT cu UN obiect JSON valid (fără alt text):
{ "title": "…", "kind": "grila", "statement": "", "questions": [ { "statement": "…", "options": ["A","B","C","D"], "answer": 0, "hint": "…", "explanation": "…", "points": 5 } ] }
Itemii cu răspuns liber: OMITE "options", "answer" ca text. LaTeX între $...$ cu backslash dublu. Verifică-ți calculele.`;
        blocksA.push({ type: 'text', text: `Construiește acum testul nr. ${rows.length + 1}.${autoInstr.trim() ? ` INSTRUCȚIUNILE ADMINULUI (prioritare): ${String(autoInstr).slice(0, 3000)}` : ''} Sesiune #${Math.random().toString(36).slice(2, 8)}.` });
        const rP = await claude.chatClaude({ system: sysPdf, messages: [{ role: 'user', content: blocksA }], maxTokens: 9000 });
        await ai.logUsage(supa, userId, 'ai-exercise-agent', rP.usage);
        const exP = normalize(claude.extractJson(rP.text));
        if (!exP) {
          console.error('ai-exercise-agent(auto-pdf): invalid. stopReason=%s', rP.stopReason);
          return res.status(502).json({ error: 'Automatizarea nu a produs un test valid din PDF-uri. Mai încearcă o dată.' });
        }
        exP.title = exP.title || `Test ${rows.length + 1} · ${category}${subcategory ? ' / ' + subcategory : ''}`;
        exP.output = 'pdf';
        return res.status(200).json({ exercise: exP, provider: rP.provider, combinedFrom: names });
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
          templateHtml = fs.readFileSync(path.join(__dirname, '_lib', 'template-standard.html'), 'utf8').slice(0, 120000);
          templateName = 'șablonul standard al site-ului';
        } catch { /* lipsă */ }
      }
      if (sources.length < 2) return res.status(400).json({ error: 'Nu am putut extrage conținut din suficiente teste ale rubricii.' });
      if (!templateHtml) return res.status(500).json({ error: 'Nu am găsit șablonul formatului standard.' });

      const sysAuto = `Ești agentul de creare de exerciții al platformei ExamenMate (matematică, românește).
Primești un ȘABLON HTML în FORMATUL STANDARD al site-ului (test interactiv cu figuri geometrice SVG și instrumente de desen) și ${sources.length} teste existente din rubrica „${category}${subcategory ? ' / ' + subcategory : ''}”.
Sarcina: construiește URMĂTORUL test al rubricii (nr. ${rows.length + 1}), ÎN ACELAȘI FIȘIER-FORMAT ca șablonul:
- COPIAZĂ ÎNTOCMAI tot ce nu ține de conținutul itemilor: CSS-ul complet, TOT JavaScript-ul, instrumentele de desen, structura pe subiecte, bara de scor — NIMIC eliminat sau simplificat;
- itemul 1 preluat/adaptat din TESTUL A, itemul 2 din TESTUL B, itemul 3 din TESTUL C... (fiecare din ALT test, ciclic), cu numerele/notațiile SCHIMBATE și rezultatele recalculate corect;
- același număr de itemi și aceeași structură (subiecte, punctaje) ca șablonul;
- FIGURILE/DESENELE (SVG, canvas) NU SE MODIFICĂ DELOC — rămân EXACT cele din șablon, cu aceleași etichete și valori (oricum vor fi restaurate programatic din șablon, deci orice modificare a lor e inutilă și greșită);
- itemii CU figură rămân cei ai șablonului: enunț, valori și notații consistente cu figura, cel mult mici reformulări care NU contrazic figura; combini din celelalte teste DOAR itemii FĂRĂ figură;
- păstrează raportarea scorului (MATE_SCORE) exact ca în șablon.
Răspunde DOAR cu documentul HTML complet (de la <!doctype html> la </html>), fără explicații, fără markdown.`;

      const srcBlock = sources.map((x, i) => `=== TESTUL ${String.fromCharCode(65 + i)}: ${x.title} ===\n${x.text}`).join('\n\n');
      const rA = await claude.chatClaude({
        system: sysAuto,
        messages: [{ role: 'user', content: `ȘABLONUL (formatul standard):\n${templateHtml}\n\n${srcBlock}\n\nConstruiește ACUM testul nr. ${rows.length + 1} — doar documentul HTML.${autoInstr.trim() ? ` INSTRUCȚIUNILE ADMINULUI (prioritare, dar desenele tot NU se modifică): ${String(autoInstr).slice(0, 3000)}` : ''} Sesiune #${Math.random().toString(36).slice(2, 8)}.` }],
        maxTokens: 24000,
      });
      await ai.logUsage(supa, userId, 'ai-exercise-agent', rA.usage);

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
        console.error('ai-exercise-agent(auto-html): invalid. stopReason=%s', rA.stopReason);
        return res.status(502).json({ error: rA.stopReason === 'max_tokens' ? 'Șablonul rubricii e prea mare pentru o singură generare — mai încearcă (sau folosește o rubrică cu teste mai mici).' : 'Automatizarea nu a produs un fișier valid. Mai încearcă o dată.' });
      }
      return res.status(200).json({ html: htmlOut, provider: rA.provider, combinedFrom: sources.map((x) => x.title), template: templateName });
    }
    if (!instructions.trim() && !model && !modelPdf && !formatHtml && !currentHtml) {
      return res.status(400).json({ error: 'Încarcă un fișier-model sau scrie instrucțiuni pentru agent.' });
    }
    if ((modelPdf || formatPdf) && !claude.HAS_KEY) {
      return res.status(400).json({ error: 'Modelele PDF necesită cheia ANTHROPIC_API_KEY (setează-o în Vercel). Alternativ, folosește un model HTML sau doar instrucțiuni.' });
    }
    if ((String(modelPdf || '').length + String(formatPdf || '').length) > 4.2 * 1024 * 1024) {
      return res.status(400).json({ error: 'Fișierele PDF sunt prea mari (max ~3 MB în total).' });
    }

    // ── MOD „HTML BRUT”: modelul de format e un fișier HTML → clonăm exact
    // acel fișier (design + funcționalitate), doar cu exercițiile noi. ──
    if (formatHtml || currentHtml) {
      const sysHtml = `Ești agentul de creare de exerciții al platformei ExamenMate (matematică, românește).
Primești un FIȘIER HTML ȘABLON (un exercițiu/test interactiv complet) și, opțional, un fișier cu EXERCIȚII-MODEL.
Sarcina: produci un fișier HTML COMPLET și AUTONOM care păstrează EXACT designul, stilul (CSS), structura și funcționalitatea (JavaScript) șablonului — schimbi DOAR conținutul exercițiilor (enunțuri, variante, răspunsuri, rezolvări, punctaje), preluat/adaptat din exercițiile-model sau generat conform instrucțiunilor, cu ALTE valori numerice decât modelul.
Reguli stricte:
- Răspunde DOAR cu documentul HTML complet (de la <!doctype html> la </html>), fără explicații, fără markdown.
- COPIAZĂ ÎNTOCMAI tot ce nu ține de conținutul exercițiilor: CSS-ul complet, TOT JavaScript-ul, toate elementele de interfață — inclusiv butoane/unelte care par auxiliare (desen, creion, radieră, calculator, cronometru etc.). NU ai voie să elimini, simplifici sau „cureți” NIMIC din șablon.
- FIGURILE/DESENELE (SVG, canvas, imagini) NU SE MODIFICĂ NICIODATĂ — copiază-le identic, element cu element, mai ales la Subiectul II (geometrie). Poți schimba doar NOTAȚIILE (literele punctelor) în enunțuri și, dacă e necesar, în etichetele-text ale figurii, fără să atingi liniile/formele. NUMERELE se schimbă DOAR dacă rămân perfect consistente cu figura existentă (aceleași proporții/configurație); altfel păstrezi numerele originale ale itemului.
- Dacă instrucțiunile cer doar „schimbă numerele/notațiile”, modifici EXCLUSIV valorile numerice/notațiile din enunțuri, variante, răspunsuri și rezolvări — restul rămâne identic caracter cu caracter.
- Păstrează TOATE funcțiile șablonului (verificare, punctaj, indicii, navigare, desen etc.).
- Păstrează (sau adaugă, dacă lipsește) raportarea scorului: parent.postMessage({type:'MATE_SCORE', score: <procent 0-100>, maxScore: 100}, '*').
- Un singur fișier: CSS și JS inline sau din CDN (păstrează CDN-urile șablonului, ex. KaTeX).
- Răspunsurile corecte trebuie să fie corecte matematic; verifică-ți calculele.
- Instrucțiunile adminului au prioritate absolută.`;

      const blocksH = [];
      if (modelPdf) {
        blocksH.push({ type: 'text', text: 'EXERCIȚIILE-MODEL (PDF):' });
        blocksH.push({ type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: String(modelPdf) } });
      }
      const partsH = [];
      if (model) partsH.push(`EXERCIȚII-MODEL:\n${typeof model === 'string' ? model.slice(0, 20000) : JSON.stringify(model)}`);
      partsH.push(`FIȘIERUL HTML ȘABLON:\n${String(currentHtml || formatHtml).slice(0, 120000)}`);
      partsH.push(`INSTRUCȚIUNI: ${instructions.trim() || (currentHtml ? 'Aplică modificările cerute păstrând totul altfel identic.' : 'Generează exercițiile în acest șablon.')}`);
      partsH.push('Returnează acum DOAR documentul HTML complet.');
      blocksH.push({ type: 'text', text: partsH.join('\n\n') });

      const pastH = (Array.isArray(history) ? history : []).slice(-4).map((m) => ({
        role: m.role === 'assistant' ? 'assistant' : 'user',
        content: String(m.content || '').slice(0, 1500),
      }));

      const rH = await claude.chatClaude({ system: sysHtml, messages: [...pastH, { role: 'user', content: blocksH }], maxTokens: 24000 });
      await ai.logUsage(supa, userId, 'ai-exercise-agent', rH.usage);

      let html = String(rH.text || '');
      const fence = html.match(/```(?:html)?\s*([\s\S]*?)```/i);
      if (fence) html = fence[1];
      const start = html.search(/<!doctype html|<html[\s>]/i);
      const endTag = html.lastIndexOf('</html>');
      if (start !== -1 && endTag > start) html = html.slice(start, endTag + 7);
      html = html.trim();

      if (start === -1 || html.length < 600) {
        console.error('ai-exercise-agent(html): rezultat invalid. stopReason=%s, primele 300: %s', rH.stopReason, String(rH.text || '').slice(0, 300));
        return res.status(502).json({ error: rH.stopReason === 'max_tokens' ? 'Șablonul + exercițiile depășesc limita — folosește un șablon mai mic sau cere mai puține exerciții.' : 'Agentul nu a produs un fișier HTML valid. Mai încearcă sau reformulează.' });
      }
      return res.status(200).json({ html, provider: rH.provider });
    }

    // RAG ușor: stilul materialelor din site rămâne o referință
    const ragQuery = (instructions || 'exercițiu de matematică asemănător modelului').slice(0, 300);
    const docs = await ai.retrieve(supa, { query: ragQuery, category: null, allowPremium: true, k: 4, prefer: 'exercise' });
    const ctx = ai.contextBlock(docs);

    const system = `Ești agentul de creare de exerciții al platformei ExamenMate (matematică, românește, clasele 5–12, Evaluare Națională, Bacalaureat).

Primești (opțional) un EXERCIȚIU-MODEL (PDF sau text), opțional un al doilea fișier: MODELUL DE FORMAT (structura/așezarea/stilul baremului dorite la rezultat), și instrucțiunile adminului.
Sarcina: generează UN exercițiu NOU, ASEMĂNĂTOR modelului de exerciții (aceeași temă, stil și dificultate — dar cu ALTE valori numerice/context; NU copia modelul), turnat în structura modelului de format (număr de itemi, tip grilă/etape, barem), respectând întocmai instrucțiunile adminului (ele au prioritate absolută).
Transformări permise și încurajate când sunt cerute: PDF → interactiv, interactiv → PDF, schimbarea numerelor/valorilor, schimbarea tipului (grilă ↔ etape).

=== MATERIALE DIN SITE (referință de stil și nivel) ===
${ctx}
=== SFÂRȘIT MATERIALE ===

Răspunde STRICT cu UN SINGUR obiect JSON valid (fără alt text, fără markdown), în UNUL din cele două formate:
${SCHEMAS}

Alegerea formatului JSON: potrivește-l cu modelul de format dacă există, altfel cu modelul de exerciții (grilă → "grila"; problemă pe pași → "etape"). Dacă adminul cere explicit, are prioritate.
Câmpul "output": pune "pdf" dacă adminul cere salvare/tipărire ca PDF ori fișă de lucru; altfel "interactive". Ambele scheme acceptă câmpul "output".

Reguli:
- Formule în LaTeX între $...$; fiecare backslash scris DUBLU (ex: "$\\\\frac{1}{2}$").
- Înmulțirea cu „·” ($\\\\cdot$), niciodată × sau litera x.
- "points" = baremul fiecărui item; păstrează proporțiile baremului din model dacă există.
- Indiciile ghidează, NU dau răspunsul; "explanation" = rezolvarea completă (baremul afișat după verificare).
- La grilă: exact 4 variante, "answer" = indexul corect (0–3), distribuit aleatoriu.
- La etape: răspunsuri scurte, verificabile prin comparație de text.
- Numărul de itemi: ca în model sau conform instrucțiunilor.
- Generările repetate trebuie să DIFERE (alte valori, alt context).`;

    // Conversație: instrucțiunile anterioare (context), apoi mesajul curent
    const past = (Array.isArray(history) ? history : []).slice(-6).map((m) => ({
      role: m.role === 'assistant' ? 'assistant' : 'user',
      content: String(m.content || '').slice(0, 2000),
    }));

    const blocks = [];
    if (modelPdf) {
      blocks.push({ type: 'text', text: 'FIȘIERUL 1 — EXERCIȚIILE-MODEL (PDF):' });
      blocks.push({ type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: String(modelPdf) } });
    }
    if (formatPdf) {
      blocks.push({ type: 'text', text: 'FIȘIERUL 2 — MODELUL DE FORMAT (PDF):' });
      blocks.push({ type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: String(formatPdf) } });
    }
    const textParts = [];
    if (model) textParts.push(`EXERCIȚIU-MODEL:\n${typeof model === 'string' ? model.slice(0, 20000) : JSON.stringify(model, null, 2)}`);
    if (formatText) textParts.push(`MODEL DE FORMAT:\n${String(formatText).slice(0, 20000)}`);
    textParts.push(`INSTRUCȚIUNI: ${instructions.trim() || 'Generează un exercițiu asemănător modelului.'}`);
    textParts.push(`Generează acum obiectul JSON. Sesiune #${Math.random().toString(36).slice(2, 8)}.`);
    blocks.push({ type: 'text', text: textParts.join('\n\n') });

    const { text, usage, provider, stopReason } = await claude.chatClaude({
      system,
      messages: [...past, { role: 'user', content: blocks }],
      maxTokens: 8000,
    });
    await ai.logUsage(supa, userId, 'ai-exercise-agent', usage);

    const exercise = normalize(claude.extractJson(text));
    if (!exercise) {
      console.error('ai-exercise-agent: JSON invalid. stopReason=%s, primele 400 caractere: %s', stopReason, String(text || '').slice(0, 400));
      const explain = stopReason === 'max_tokens'
        ? 'Răspunsul a fost tăiat (testul cerut e foarte lung). Cere mai puține întrebări sau împarte-l în două generări.'
        : 'Agentul nu a produs un exercițiu valid. Reformulează instrucțiunile și mai încearcă.';
      return res.status(502).json({ error: explain });
    }

    return res.status(200).json({ exercise, provider });
  } catch (err) {
    console.error('ai-exercise-agent error:', err);
    return res.status(err.status || 500).json({ error: err.message || 'Eroare server', code: err.code || null });
  }
};
