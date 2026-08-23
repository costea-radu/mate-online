// =====================================================================
// api/_lib/ingest.js — FRAGMENTELE (chunks) pentru baza de cunoștințe
// (Etapa 3 din AUDIT_AGENTI_AI.md, punctul 1.5 — RAG pe conținut REAL)
//
// Până acum PDF-urile și exercițiile interactive intrau în ai_knowledge ca o
// singură linie de metadate („Tip: pdf. Categorie: X. titlu — descriere”), deci
// RAG-ul aducea TITLURI, nu exerciții. De acum:
//   · PDF (teste, variante, simulări) → textul din cache-ul ai_pdf_text, tăiat
//     PE EXERCIȚII („Subiectul II, ex. 3: …”); baremele → fragmente „solution";
//   · exercițiu interactiv → câte un fragment per item din
//     content.interactive_data.exercise (enunț + variante + rezolvare scurtă) sau,
//     pentru HTML-urile fără JSON, textul paginii tăiat pe exerciții;
//   · manual → paragrafe (~1200 caractere, cu suprapunere), nu felii oarbe;
//   · fiecare fragment primește capitolul din programă (chapter_id) + subiectul
//     (taxonomy.classify) — pentru filtrarea „exerciții din capitolul X”.
// content_hash se COMPARĂ la indexare (ai-ingest.js): fragmentele neschimbate
// nu se re-vectorizează și nu li se schimbă updated_at (pre-generarea rămâne valabilă).
// =====================================================================
const taxonomy = require('./taxonomy');

const CHUNK_MAX = 1500;           // caractere per fragment (exercițiu)
const PARA_SIZE = 1200, PARA_OVERLAP = 150;
const MAX_CHUNKS = 80;            // plafon per material

const stripHtml = (s) => String(s || '')
  .replace(/<script[\s\S]*?<\/script>/gi, ' ').replace(/<style[\s\S]*?<\/style>/gi, ' ')
  .replace(/<br\s*\/?>|<\/p>|<\/div>|<\/li>|<\/h[1-6]>/gi, '\n').replace(/<[^>]+>/g, ' ')
  .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
  .replace(/[ \t]+/g, ' ').replace(/\n\s*\n+/g, '\n\n').trim();

// ── Tăierea unui text de test PE EXERCIȚII ───────────────────────────────────
// Întoarce [{ label, text }] — label = „Subiectul II · 3" / „Ex. 5"; null dacă
// textul nu are structură de exerciții (atunci se taie pe paragrafe).
const SUBJECT_RE = /^\s*SUBIECTUL\s+(?:al\s+)?(I{1,3}|[123])(?:\s*-?\s*lea)?\b/i;
const EX_RE = /^\s*(\d{1,2})\s*[.)]\s+(?=\S)/;
const ROMAN = { i: 'I', ii: 'II', iii: 'III', 1: 'I', 2: 'II', 3: 'III' };
function splitExercises(text) {
  const lines = String(text || '').split(/\r?\n/);
  const out = [];
  let subject = null, cur = null, lastNum = 0;
  const flush = () => { if (cur && cur.text.trim().length >= 25) out.push({ label: cur.label, text: cur.text.trim() }); cur = null; };
  for (const line of lines) {
    const sm = SUBJECT_RE.exec(line);
    if (sm) { flush(); subject = ROMAN[String(sm[1]).toLowerCase()] || sm[1]; lastNum = 0; continue; }
    const em = EX_RE.exec(line);
    const num = em ? parseInt(em[1], 10) : 0;
    // un nou exercițiu: numerotare crescătoare (1, 2, 3…) — „2." din mijlocul unui enunț nu rupe
    if (em && num >= 1 && num <= 30 && (num === lastNum + 1 || (num === 1 && lastNum > 1))) {
      flush();
      lastNum = num;
      cur = { label: subject ? `Subiectul ${subject} · ${num}` : `Ex. ${num}`, text: line.replace(EX_RE, '') };
      continue;
    }
    if (cur) cur.text += '\n' + line;
  }
  flush();
  return out.length >= 2 ? out : null;
}

// ── Paragrafe cu suprapunere (manuale, texte fără structură) ─────────────────
function splitParagraphs(text, size = PARA_SIZE, overlap = PARA_OVERLAP) {
  const t = String(text || '').replace(/\r/g, '').trim();
  if (!t) return [];
  if (t.length <= size) return [t];
  const out = [];
  let i = 0;
  while (i < t.length) {
    let end = Math.min(t.length, i + size);
    if (end < t.length) {
      // tăiem la sfârșit de paragraf / propoziție, dacă e în ultima treime
      const win = t.slice(i + Math.floor(size * 0.6), end);
      const cut = Math.max(win.lastIndexOf('\n\n'), win.lastIndexOf('. '), win.lastIndexOf('.\n'));
      if (cut > 0) end = i + Math.floor(size * 0.6) + cut + 1;
    }
    out.push(t.slice(i, end).trim());
    if (end >= t.length) break;
    i = Math.max(end - overlap, i + 1);
  }
  return out.filter(Boolean);
}

const clip = (s, n = CHUNK_MAX) => (String(s || '').length > n ? String(s).slice(0, n - 1) + '…' : String(s || ''));

// ── Fragmentele unui material ────────────────────────────────────────────────
// row = rândul din `content`; pdfText = textul testului (din ai_pdf_text) sau null;
// html = HTML-ul exercițiului interactiv (doar când lipsește JSON-ul) sau null.
// Întoarce [{ source_type, chunk_index, category, topic, chapter_id, title, content, is_free }]
function chunksForContent(row, { pdfText = null, html = null, isBarem = false } = {}) {
  const header = [row.title, row.description].filter(Boolean).join(' — ');
  const base = { category: row.category, title: row.title, is_free: !!row.is_free };
  const tag = (text, fallbackTopic = null) => {
    const c = taxonomy.classify(text, row.category);
    return { chapter_id: c ? c.chapterId : null, topic: c ? c.topic : (fallbackTopic || null) };
  };
  const metaTopic = () => { const c = taxonomy.classify(header, row.category); return c ? c.topic : null; };
  let items = [];

  if (row.content_type === 'manual') {
    const body = stripHtml(row.manual_content || '');
    const paras = body ? splitParagraphs(body) : [];
    items = paras.length
      ? paras.map((p) => ({ source_type: 'manual', content: `${row.title ? row.title + '\n' : ''}${p}` }))
      : [{ source_type: 'manual', content: `Manual: ${header}` }];
  } else if (row.content_type === 'pdf') {
    const kind = isBarem ? 'solution' : 'exercise';
    const ex = pdfText ? splitExercises(pdfText) : null;
    if (ex) {
      items = ex.map((e) => ({ source_type: kind, content: `${row.title} — ${e.label}:\n${clip(e.text)}` }));
    } else if (pdfText && pdfText.trim().length > 80) {
      items = splitParagraphs(pdfText).map((p) => ({ source_type: kind, content: `${row.title}:\n${p}` }));
    } else {
      items = [{ source_type: kind, content: `Tip: pdf. Categorie: ${row.category}. ${header}` }];
    }
  } else {
    // interactiv: JSON-ul exercițiului (generat de platformă) sau textul HTML-ului
    const exj = row.interactive_data && row.interactive_data.exercise;
    const list = exj && typeof exj === 'object' ? (exj.kind === 'etape' ? exj.steps : exj.questions) : null;
    if (Array.isArray(list) && list.length) {
      const lead = exj.statement ? `${clip(exj.statement, 600)}\n` : '';
      items = list.map((q, i) => {
        const opts = Array.isArray(q.options) && q.options.length
          ? '\nVariante: ' + q.options.map((o, k) => `${'abcdef'[k]}) ${o}`).join('  ')
          : '';
        const ans = q.options ? `\nRăspuns corect: ${'abcdef'[Number(q.answer)] || q.answer}` : (q.answer != null && String(q.answer).trim() ? `\nRăspuns: ${q.answer}` : '');
        const expl = q.explanation ? `\nRezolvare: ${clip(q.explanation, 400)}` : '';
        return { source_type: 'exercise', content: `${row.title} — ${exj.kind === 'etape' ? 'pasul' : 'itemul'} ${i + 1}:\n${i === 0 ? lead : ''}${clip(q.statement || q.prompt || '', 900)}${opts}${ans}${expl}` };
      });
    } else if (html) {
      const text = stripHtml(html);
      const ex = splitExercises(text);
      if (ex) items = ex.map((e) => ({ source_type: 'exercise', content: `${row.title} — ${e.label}:\n${clip(e.text)}` }));
      else if (text.length > 80) items = splitParagraphs(text).slice(0, 12).map((p) => ({ source_type: 'exercise', content: `${row.title}:\n${p}` }));
    }
    if (!items.length) items = [{ source_type: 'exercise', content: `Tip: ${row.content_type}. Categorie: ${row.category}. ${header}` }];
  }

  const fallbackTopic = metaTopic();
  return items.slice(0, MAX_CHUNKS).map((it, i) => ({
    ...base, source_type: it.source_type, source_id: row.id, chunk_index: i,
    content: clip(it.content, CHUNK_MAX + 200), ...tag(it.content, fallbackTopic),
  }));
}

// Rezolvările (tabela `rezolvari`): metadate + descriere (conținutul e video/PDF/imagine)
function chunksForRezolvare(row) {
  const header = [row.title, row.description].filter(Boolean).join(' — ');
  const c = taxonomy.classify(header, row.category);
  return [{
    source_type: 'solution', source_id: row.id, chunk_index: 0,
    category: row.category, topic: c ? c.topic : null, chapter_id: c ? c.chapterId : null,
    title: row.title, content: `Rezolvare (${row.type || 'material'}). Categorie: ${row.category || 'general'}. ${header}`,
    is_free: row.is_free !== false,
  }];
}

module.exports = { chunksForContent, chunksForRezolvare, splitExercises, splitParagraphs, stripHtml, CHUNK_MAX };
