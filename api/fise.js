// =====================================================================
// api/fise.js — BANCA DE EXERCIȚII din fișele claselor 5–12 (1 nov. 2026)
//
// „🧩 Generează exerciții/teste interactive/PDF" → „👥 Teste diferite / elev"
// → „📚 Fișele cu exerciții ale clasei": profesorul bifează nivelele / tipurile
// de exerciții ale unei fișe, exact cum sunt scrise în ea („Nivel 3", „MODEL 2",
// „Exercițiul 1 — ecuații de forma …"), iar fiecare elev primește alt test.
//
// Fișa o citește O SINGURĂ DATĂ modelul cu vedere (api/_lib/fise.js);
// grupele ei, cu exercițiile în LaTeX, se păstrează în `fise_banca`
// (supabase/fise_banca.sql) și le folosesc apoi toți profesorii — testele
// „cu datele păstrate" se compun din bancă fără niciun cost.
//
// Citirea o plătește PLATFORMA (bancă comună), nu profesorul: rândul din
// ai_usage are user_id null și endpoint „fise:transcriere".
//
// POST { action, ... }   (doar conturile de profesor și administratorii)
//   list  { category }            → fișele PDF ale clasei + starea lor în bancă
//   bank  { contentId, refresh? } → grupele fișei, cu exercițiile lor; dacă
//                                   fișa nu e încă în bancă, o citește ACUM
//                                   (1–3 minute). `refresh` = doar admin.
//         Altă citire a aceleiași fișe deja pornită → 202 { reading: true }:
//         pagina reîntreabă peste câteva secunde.
// =====================================================================
const ai = require('./_lib/ai');
const F = require('./_lib/fise');
const { extractPagesPdf } = require('./_lib/pdfpages');

// o citire începută de mai mult de atât (funcție oprită la jumătate) se poate relua
const READ_LOCK_MS = 12 * 60 * 1000;
const notBarem = (r) => !/barem/i.test(r.title || '');
const isReading = (row, now = Date.now()) => !!(row && row.reading_since && now - Date.parse(row.reading_since) < READ_LOCK_MS);
// banca e a fișei ACTUALE (același fișier) și citită măcar o dată?
const isFresh = (row, content) => !!(row && row.status !== 'pending' && row.file_url === content.file_url);

module.exports = async function handler(req, res) {
  ai.applyCors(res);
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method Not Allowed' });

  const supa = ai.admin();
  try {
    const { action } = req.body || {};
    if (action === 'list') return await list(req, res, supa);
    if (action === 'bank') return await bank(req, res, supa);
    return res.status(400).json({ error: 'action invalid' });
  } catch (err) {
    console.error('fise error:', err);
    return res.status(err.status || 500).json({ error: err.message || 'Eroare server', code: err.code || null });
  }
};

// ─── Ajutoare ────────────────────────────────────────────────────────────────
async function requireTeacher(req, supa) {
  const userId = await ai.authUser(req, supa);
  const profile = await ai.requireUser(supa, userId);
  if (!(profile.role === 'profesor' || profile.is_admin)) {
    const e = new Error('Testele din fișele claselor sunt pentru conturile de profesor.');
    e.status = 403; throw e;
  }
  return { userId, profile };
}

// Tabela lipsește (migrarea nerulată) → mesaj clar, nu „relation does not exist"
function tableError(error) {
  const msg = String(error?.message || error || '');
  if (/fise_banca|relation|schema cache|permission denied|does not exist/i.test(msg)) {
    const e = new Error('Banca fișelor nu e pregătită: rulează supabase/fise_banca.sql în Supabase → SQL Editor.');
    e.status = 503; e.code = 'FISE_SQL'; return e;
  }
  return error instanceof Error ? error : new Error(msg || 'Eroare la banca fișelor');
}

async function readBankRow(supa, contentId) {
  const { data, error } = await supa.from('fise_banca')
    .select('content_id, file_url, status, groups, exercises, pages, model, cost_micro, reading_since, updated_at')
    .eq('content_id', contentId).maybeSingle();
  if (error) throw tableError(error);
  return data || null;
}

const sheetOf = (c) => ({ id: c.id, title: c.title, category: c.category, isFree: !!c.is_free });
const bankOf = (row) => ({
  status: row.status, exercises: row.exercises || 0, pages: row.pages || null,
  groups: Array.isArray(row.groups) ? row.groups : [], updatedAt: row.updated_at || null,
});

// Numărul de pagini al PDF-ului (pdf-lib, fără randare)
async function pageCount(buf) {
  const { PDFDocument } = require('pdf-lib');
  const doc = await PDFDocument.load(buf, { ignoreEncryption: true });
  return doc.getPageCount();
}

// Lacătul citirii: o singură citire odată pentru aceeași fișă.
//   • fără rând → INSERT (cine pierde cursa primește 23505 → „se citește deja");
//   • cu rând   → UPDATE condiționat de `updated_at` (compare-and-swap).
// Banca veche (dacă există) rămâne citibilă cât timp se citește din nou.
async function takeLock(supa, content, row) {
  const now = new Date().toISOString();
  if (!row) {
    const { error } = await supa.from('fise_banca').insert({
      content_id: content.id, file_url: content.file_url, category: content.category, title: content.title,
      status: 'pending', reading_since: now, updated_at: now,
    });
    if (!error) return true;
    if (String(error.code) === '23505' || /duplicate key/i.test(error.message || '')) return false;
    throw tableError(error);
  }
  const { data, error } = await supa.from('fise_banca')
    .update({ reading_since: now, updated_at: now })
    .eq('content_id', content.id).eq('updated_at', row.updated_at)
    .select('content_id');
  if (error) throw tableError(error);
  return Array.isArray(data) && data.length > 0;
}
async function releaseLock(supa, contentId) {
  try { await supa.from('fise_banca').update({ reading_since: null }).eq('content_id', contentId); } catch { /* lacătul expiră singur */ }
}

// ─── list: fișele clasei + starea lor în bancă ───────────────────────────────
async function list(req, res, supa) {
  await requireTeacher(req, supa);
  const category = String(req.body?.category || '');
  if (!F.CLASS_CATS.includes(category)) return res.status(400).json({ error: 'Alege o clasă, de la a V-a la a XII-a.' });

  const { data: rows, error } = await supa.from('content')
    .select('id, title, category, is_free, file_url, sort_order')
    .eq('category', category).eq('content_type', 'pdf')
    .order('sort_order', { ascending: true }).limit(1000);
  if (error) throw error;
  const sheets = F.sortSheets((rows || []).filter(notBarem));

  let banks = [];
  let bankError = null;
  if (sheets.length) {
    const { data, error: e2 } = await supa.from('fise_banca')
      .select('content_id, file_url, status, summary, exercises, reading_since, updated_at')
      .in('content_id', sheets.map((s) => s.id));
    if (e2) bankError = tableError(e2).message; // lista fișelor rămâne folosibilă
    else banks = data || [];
  }
  const byId = new Map(banks.map((b) => [b.content_id, b]));
  const now = Date.now();
  return res.status(200).json({
    category,
    bankError,
    sheets: sheets.map((c) => {
      const b = byId.get(c.id);
      const fresh = isFresh(b, c);
      return {
        ...sheetOf(c),
        bank: fresh ? { status: b.status, exercises: b.exercises || 0, groups: Array.isArray(b.summary) ? b.summary : [], updatedAt: b.updated_at } : null,
        reading: isReading(b, now),
        stale: !!(b && b.status !== 'pending' && !fresh), // fișierul fișei s-a schimbat de la citire
      };
    }),
  });
}

// ─── bank: grupele unei fișe (o citește acum, dacă trebuie) ──────────────────
async function bank(req, res, supa) {
  const { userId, profile } = await requireTeacher(req, supa);
  const contentId = String(req.body?.contentId || '');
  const refresh = !!req.body?.refresh && !!profile.is_admin;
  if (!contentId) return res.status(400).json({ error: 'contentId lipsă' });

  const { data: c } = await supa.from('content')
    .select('id, title, category, content_type, file_url, is_free')
    .eq('id', contentId).maybeSingle();
  if (!c || c.content_type !== 'pdf' || !F.CLASS_CATS.includes(c.category) || !c.file_url) {
    return res.status(404).json({ error: 'Fișa nu există (sau nu e o fișă a claselor 5–12).' });
  }
  // o fișă ⭐ premium: exercițiile ei (și banca lor) doar cu abonament — ca fișa însăși
  if (!c.is_free) ai.requirePremium(profile);

  const row = await readBankRow(supa, c.id);
  const fresh = isFresh(row, c);
  if (fresh && !refresh) return res.status(200).json({ sheet: sheetOf(c), bank: bankOf(row) });

  // altcineva o citește chiar acum → pagina reîntreabă (banca veche, dacă e, se poate folosi)
  if (isReading(row)) {
    return res.status(202).json({ sheet: sheetOf(c), reading: true, since: row.reading_since, bank: fresh ? bankOf(row) : null });
  }

  // Citirea cheamă AI-ul: abonament (adminul e scutit) + limita orară. Bugetele
  // profesorului NU se ating — banca e comună, citirea o plătește platforma.
  if (!profile.is_admin) ai.requirePremium(profile);
  await ai.enforceRateLimit(supa, userId, profile, { budgets: false });
  if (!ai.hasChat()) return res.status(503).json({ error: 'AI-ul nu e configurat pe server (OPENAI_API_KEY).' });

  if (!(await takeLock(supa, c, row))) {
    return res.status(202).json({ sheet: sheetOf(c), reading: true, since: new Date().toISOString(), bank: fresh ? bankOf(row) : null });
  }

  let result;
  try {
    const { downloadContentPdf } = require('./ai-pdf-context');
    const buf = await downloadContentPdf(supa, c);
    result = await F.transcribeSheet(buf, {
      title: c.title, category: c.category, model: ai.PDF_MODEL,
      chatJson: ai.chatJson, S: ai.S, extractPagesPdf, pageCount,
      log: (m) => console.warn(m),
    });
  } catch (e) {
    if (e && e.usage) await ai.logUsage(supa, null, 'fise:transcriere', e.usage);
    await releaseLock(supa, c.id);
    throw e;
  }

  await ai.logUsage(supa, null, 'fise:transcriere', result.usage);
  const cost = ai.costMicroLei(result.usage.model, result.usage);
  const now = new Date().toISOString();
  const upd = {
    file_url: c.file_url, category: c.category, title: c.title,
    status: result.status, groups: result.groups, summary: F.summarize(result.groups),
    exercises: result.exercises, pages: result.pages, model: result.usage.model,
    cost_micro: (row?.cost_micro || 0) + cost, created_by: userId,
    reading_since: null, updated_at: now,
  };
  const { error: e3 } = await supa.from('fise_banca').update(upd).eq('content_id', c.id);
  if (e3) throw tableError(e3);
  const lei = cost / 1e6;
  return res.status(200).json({
    sheet: sheetOf(c),
    bank: bankOf({ ...upd, updated_at: now }),
    read: { lei: Math.round(lei * 1000) / 1000, failedChunks: result.failed || 0 },
  });
}

module.exports.isFresh = isFresh;
module.exports.isReading = isReading;
module.exports.READ_LOCK_MS = READ_LOCK_MS;
