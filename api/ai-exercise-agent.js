// =====================================================================
// api/ai-exercise-agent.js — AGENTUL CLAUDE de generare exerciții (admin).
// Primește un FIȘIER-MODEL (PDF trimis nativ către Claude / text extras
// din HTML) + INSTRUCȚIUNILE adminului (mesaj liber, stil chat) și
// generează un exercițiu asemănător: grilă sau cu etape de rezolvare
// (indicii + barem + punctaj). Formatul se alege automat după model,
// dacă instrucțiunile nu cer altceva.
// Body: { userId, instructions?, model?, modelPdf?(base64), history?, aiModel? }
//   - model    = text-model (HTML convertit în text) SAU exercițiul curent
//                (JSON) când se cere o variantă nouă / asemănătoare.
//   - modelPdf = PDF-ul model, base64 (necesită ANTHROPIC_API_KEY).
//   - aiModel  = ID-ul Claude ales din selectorul de model al adminului
//                (ex. 'claude-opus-5'); lista permisă e în api/_lib/claude.js
//                (MODELS) — un ID necunoscut cade pe modelul implicit.
// Răspuns: { exercise, provider }
//
// Automatizarea pe rubrică (action='auto') s-a mutat în api/_lib/exgen.js
// (runAuto) — partajată cu task-urile programate (api/agent-tasks.js +
// api/agent-cron.js), care generează și pot posta automat pe site.
// =====================================================================
const ai = require('./_lib/ai');
const { modeLine } = require('./_lib/pdftext');
const claude = require('./_lib/claude');
const exgen = require('./_lib/exgen');

const SCHEMAS = `— GRILĂ:
{
  "title": "titlul exercițiului",
  "kind": "grila",
  "output": "interactive sau pdf — formatul de salvare cerut de admin (implicit interactive)",
  "statement": "context general (opțional, poate fi gol)",
  "questions": [
    { "statement": "enunț (LaTeX între $...$)", "options": ["A", "B", "C", "D"],
      "answer_index": 0, "answer_text": null, "hint": "indiciu fără răspuns", "explanation": "rezolvarea completă", "points": 10 }
  ],
  "steps": null, "final_answer": null
}
(item cu răspuns liber: "options": null, "answer_index": null, "answer_text": "răspunsul")
— CU ETAPE DE REZOLVARE:
{
  "title": "titlul exercițiului",
  "kind": "etape",
  "output": "interactive",
  "statement": "enunțul complet al problemei (LaTeX între $...$)",
  "questions": null,
  "steps": [
    { "prompt": "ce se cere la această etapă", "answer": "răspuns scurt (număr/expresie)",
      "hint": "indiciu fără răspuns", "explanation": "rezolvarea etapei (barem)", "points": 10 }
  ],
  "final_answer": "răspunsul final"
}`;

// normalize() s-a mutat în api/_lib/exgen.js (partajat cu task-urile programate)
const normalize = exgen.normalize;

module.exports = async function handler(req, res) {
  ai.applyCors(res);
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method Not Allowed' });

  const supa = ai.admin();
  try {
    const userId = await ai.authUser(req, supa);
    await ai.requireAdmin(supa, userId);

    const { action = null, instructions = '', model = null, modelPdf = null, formatText = null, formatPdf = null, formatHtml = null, currentHtml = null, history = [], dataMode = 'modify', aiModel = null } = req.body || {};

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
    // Logica e în api/_lib/exgen.js (runAuto) — partajată cu task-urile
    // programate. Modelul AI ales de admin (aiModel) se aplică generării.
    if (action === 'auto') {
      const { category, subcategory = null, profile = null, ctype = 'interactive', instructions: autoInstr = '', resultKind = 'auto' } = req.body || {};
      const r = await exgen.runAuto({ supa, category, subcategory, profile, ctype, instructions: autoInstr, resultKind, dataMode, aiModel });
      await ai.logUsage(supa, userId, 'ai-exercise-agent', r.usage);
      if (r.html) {
        return res.status(200).json({ html: r.html, provider: r.provider, combinedFrom: r.combinedFrom, template: r.template });
      }
      return res.status(200).json({ exercise: r.exercise, provider: r.provider, combinedFrom: r.combinedFrom });
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
- Instrucțiunile adminului au prioritate absolută.
- REGIM DE LUCRU CU DATELE: ${modeLine(dataMode)}`;

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

      const rH = await claude.chatClaude({ system: sysHtml, messages: [...pastH, { role: 'user', content: blocksH }], maxTokens: 24000, model: aiModel });
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
- La grilă: exact 4 variante, "answer_index" = indexul corect (0–3), distribuit aleatoriu.
- La etape: răspunsuri scurte, verificabile prin comparație de text.
- Numărul de itemi: ca în model sau conform instrucțiunilor.
- Generările repetate trebuie să DIFERE (alte valori, alt context).
- REGIM DE LUCRU CU DATELE: ${modeLine(dataMode)}`;

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

    // Structured Outputs (Etapa 3): schema strictă a exercițiului (exgen.EXERCISE_SCHEMA);
    // dacă API-ul o respinge, chatClaude reîncearcă fără ea → parsare tolerantă
    const rr = await claude.chatClaude({
      system,
      messages: [...past, { role: 'user', content: blocks }],
      maxTokens: 8000,
      model: aiModel,
      schema: exgen.EXERCISE_SCHEMA,
    });
    const { text, usage, provider, stopReason } = rr;
    await ai.logUsage(supa, userId, 'ai-exercise-agent', usage);

    const exercise = exgen.parseExercise(rr);
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
