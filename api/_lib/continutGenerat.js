// =====================================================================
// api/_lib/continutGenerat.js — 🤖 CONȚINUTUL GENERAT de skill-ul „examenmate-continut"
// (21 nov. 2026)
//
// Cererea lui Radu: task-uri programate care generează bareme, teste interactive, fișe după
// fișierele model, variante EN, explicații la grila EN și verifică testele interactive
// existente; „dacă se verifică după barem, se publică direct pe site", restul intră ca
// ciornă și se aprobă din Admin. Rularea task-ului (în cloud) nu ajunge la Supabase prin
// HTTP: pune fișierele + manifest.json în repo-ul privat examenmate-continut, iar GitHub
// Action-ul „Publică" (scripts/continut/publica.js) apelează proceseazaUnitate de aici.
// Admin → „🤖 Conținut generat" (api/continut-generat.js) apelează aproba / respinge /
// anuleaza / lista / linkuri.
//
// O UNITATE = materialul + baremul lui (sau testul interactiv, explicațiile, înlocuirea).
// Procedurile (manifest.procedura):
//   1 · barem pentru un PDF fără barem        → rând `bareme` + legătura (claude-skill)
//   2 · test interactiv pentru un PDF          → rând interactiv + asocierea PDF ↔ test
//   3 · fișă după un fișier model              → PDF la clasa/capitolul modelului + barem
//   4 · variantă EN („Variante generate cu AI") → PDF în `variante-ai` + barem + varianta „fără
//       suprafață neagră" (ca botul pagina2) + testul interactiv asociat (22 nov. 2026)
//   5 · explicații la grila EN                 → rând în barem_explicatii
//   6 · verificarea unui test interactiv       → fișier nou în locul celui vechi
//
// Reguli (ca în skill): nu se suprascrie nimic — precondițiile se verifică chiar înainte
// de scriere și, la legături, chiar în instrucțiunea de scriere (doarDacaLiber, .is(null));
// ce nu trece verificările automate de aici coboară din „publică" în „ciornă"; orice
// unitate publicată se poate anula (ce s-a creat e ținut în `creat`).
// Tabela: supabase/continut_generat.sql. Teste: test/continut-generat.test.js.
// =====================================================================
const http = require('./http');
const B = require('./barem');
const CH = require('./capitoleHarta');

const TABLE = 'continut_generat';
const BY = 'claude-skill';
const SETUP_HINT = 'Tabela conținutului generat lipsește: rulează o dată supabase/continut_generat.sql în Supabase → SQL Editor.';

const PROCEDURI = {
  1: { titlu: 'Barem pentru un PDF fără barem', scurt: 'Barem' },
  2: { titlu: 'Test interactiv pentru un PDF', scurt: 'Test interactiv' },
  3: { titlu: 'Fișă după un fișier model', scurt: 'Fișă nouă' },
  4: { titlu: 'Variantă de Evaluare Națională', scurt: 'Variantă EN' },
  5: { titlu: 'Explicații la grila EN', scurt: 'Explicații grilă' },
  6: { titlu: 'Verificarea unui test interactiv', scurt: 'Verificare test' },
};
const STARI = ['in_lucru', 'publicat', 'ciorna', 'aprobat', 'respins', 'anulat', 'esuat', 'conflict', 'verificat', 'nimic'];
const DECIZII = ['publica', 'ciorna', 'nimic', 'verificat', 'esuat'];
const FARA_FISIERE = { nimic: 'nimic', verificat: 'verificat', esuat: 'esuat' };   // decizie → starea finală
const CATEGORII = new Set(['clasa-5', 'clasa-6', 'clasa-7', 'clasa-8', 'clasa-9', 'clasa-10', 'clasa-11', 'clasa-12', 'evaluare-nationala', 'bacalaureat']);
const BAREM_OK = new Set(['ok', 'ok_antet', 'ok_continut', 'ok_admin', 'inclus', 'este_barem']);
const COLS = 'id, title, category, subcategory, profile, content_type, is_free, file_url, interactiv_id, pdf_sursa_id, chapter_id';
const MAX_BYTES = 40 * 1024 * 1024;
const IN_LUCRU_EXPIRA_MS = 30 * 60 * 1000;   // o rulare întreruptă: unitatea „în lucru" de peste 30 de minute
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// fișierele unei unități, pe roluri: unde le caută manifestul și ce sunt
const ROLURI = {
  material: { ext: 'pdf', mime: 'application/pdf' },
  material_alb: { ext: 'pdf', mime: 'application/pdf' },   // procedura 4: aceeași variantă, fără dreptunghiul negru
  barem: { ext: 'pdf', mime: 'application/pdf' },
  interactiv: { ext: 'html', mime: 'text/html' },
  explicatii: { ext: 'pdf', mime: 'application/pdf' },
  inlocuire: { ext: 'html', mime: 'text/html' },
};
// ce roluri cere fiecare procedură (la „publică" / „ciornă")
const NEVOI = { 1: ['barem'], 2: ['interactiv'], 3: ['material', 'barem'], 4: ['material', 'barem'], 5: ['explicatii'], 6: ['inlocuire'] };

function eroare(status, msg, cod = null) { const e = new Error(msg); e.status = status; if (cod) e.cod = cod; return e; }
const conflict = (msg) => eroare(409, msg, 'CONFLICT');
const curat = (v, max = 300) => String(v == null ? '' : v).replace(/\s+/g, ' ').trim().slice(0, max);
const lipsaTabela = (err) => !!err && /relation .* does not exist|does not exist|schema cache|could not find the table/i.test(String(err.message || err));
const duplicat = (err) => !!err && (err.code === '23505' || /duplicate key/i.test(String(err.message || '')));
const nowIso = () => new Date().toISOString();

// numele din calea Storage (ca exgen.slug: fără diacritice, doar litere/cifre/cratimă)
function slug(s) {
  return String(s || 'material').toLowerCase()
    .replace(/[ăâ]/g, 'a').replace(/î/g, 'i').replace(/[șş]/g, 's').replace(/[țţ]/g, 't')
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60) || 'material';
}
// un nume de fișier din unitate (fără foldere, fără „..")
const numeFisierOk = (f) => typeof f === 'string' && /^[A-Za-z0-9][A-Za-z0-9._-]{0,119}$/.test(f) && !f.includes('..');

// ─── 1) MANIFESTUL ───────────────────────────────────────────────────────────
// manifest.json (scris de rularea task-ului; fără secrete):
// { procedura: 1–6, decizie: 'publica'|'ciorna'|'nimic'|'verificat'|'esuat', motiv, titlu,
//   sursa: { content_id } | { model_id },
//   material:   { fisier, title, is_free? }                 (3, 4)
//   material_alb: { fisier }                                (4 — aceeași variantă, cu alb în locul
//                                                            dreptunghiului negru de pe pagina 2)
//   barem:      { fisier }                                  (1, 3, 4)
//   interactiv: { fisier, title?, is_free? }                (2, 4 — la 4: testul interactiv al variantei)
//   explicatii: { fisier, titlu? }                          (5 — sursa.content_id = baremul)
//   inlocuire:  { fisier, file_url_vechi }                  (6 — sursa.content_id = testul)
//   surse: [content_id…] (4, opțional), verificari: {…}, rulare }
function normalizeazaManifest(raw, { unitate } = {}) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw eroare(400, 'Manifestul lipsește sau nu e un obiect JSON.');
  const procedura = Number(raw.procedura);
  if (!PROCEDURI[procedura]) throw eroare(400, `Procedura „${raw.procedura}" nu există (1–6).`);
  const decizie = String(raw.decizie || '');
  if (!DECIZII.includes(decizie)) throw eroare(400, `Decizia „${raw.decizie}" nu e una dintre: ${DECIZII.join(', ')}.`);
  const u = curat(unitate || raw.unitate, 200);
  if (!u || !/^[A-Za-z0-9][A-Za-z0-9._/-]*$/.test(u) || u.includes('..')) throw eroare(400, 'Unitatea (calea din repo) lipsește sau are caractere nepermise.');

  const src = raw.sursa && typeof raw.sursa === 'object' ? raw.sursa : {};
  const sursa = {};
  if (src.content_id != null) { if (!UUID_RE.test(String(src.content_id))) throw eroare(400, 'sursa.content_id nu e un id valid.'); sursa.content_id = String(src.content_id); }
  if (src.model_id != null) { if (!UUID_RE.test(String(src.model_id))) throw eroare(400, 'sursa.model_id nu e un id valid.'); sursa.model_id = String(src.model_id); }

  const m = {
    versiune: 1, unitate: u, procedura, decizie,
    motiv: curat(raw.motiv, 2000) || null,
    titlu: curat(raw.titlu, 300),
    rulare: curat(raw.rulare, 200) || null,
    sursa,
    surse: Array.isArray(raw.surse) ? raw.surse.filter((x) => UUID_RE.test(String(x))).map(String).slice(0, 30) : [],
    verificari: raw.verificari && typeof raw.verificari === 'object' ? raw.verificari : null,
  };
  for (const rol of Object.keys(ROLURI)) {
    const r = raw[rol];
    if (r == null) continue;
    if (typeof r !== 'object') throw eroare(400, `„${rol}" trebuie să fie un obiect.`);
    if (!numeFisierOk(r.fisier) || !r.fisier.toLowerCase().endsWith(`.${ROLURI[rol].ext}`)) {
      throw eroare(400, `„${rol}.fisier" trebuie să fie un nume de fișier .${ROLURI[rol].ext} din folderul unității (fără „/" sau „..").`);
    }
    const x = { fisier: r.fisier };
    if (r.title != null) x.title = curat(r.title, 200);
    if (r.titlu != null) x.titlu = curat(r.titlu, 200);
    if (r.is_free != null) x.is_free = r.is_free === true;
    if (r.file_url_vechi != null) x.file_url_vechi = String(r.file_url_vechi).slice(0, 2000);
    m[rol] = x;
  }

  const cuFisiere = decizie === 'publica' || decizie === 'ciorna';
  const trebuie = (cond, msg) => { if (!cond) throw eroare(400, msg); };
  if ([1, 2, 5, 6].includes(procedura) && (cuFisiere || decizie === 'verificat')) trebuie(sursa.content_id, `Procedura ${procedura} are nevoie de sursa.content_id.`);
  if (procedura === 3 && cuFisiere) trebuie(sursa.model_id, 'Procedura 3 are nevoie de sursa.model_id (fișierul model).');
  if (decizie === 'verificat') trebuie(procedura === 6, 'Decizia „verificat" e doar pentru procedura 6.');
  if (cuFisiere) {
    for (const rol of NEVOI[procedura]) trebuie(m[rol], `Procedura ${procedura} are nevoie de „${rol}" (cu fișierul lui).`);
    if (procedura === 3 || procedura === 4) trebuie(m.material.title, 'Materialul are nevoie de titlu (material.title).');
    if (procedura === 6) trebuie(m.inlocuire.file_url_vechi, 'Înlocuirea are nevoie de file_url_vechi (fișierul de înlocuit).');
  }
  if (!m.titlu) m.titlu = (m.material && m.material.title) || (m.interactiv && m.interactiv.title) || PROCEDURI[procedura].titlu;
  return m;
}

// ─── 2) CONTEXTUL ȘI PRECONDIȚIILE (starea live) ─────────────────────────────
async function citesteRand(supa, table, cols, col, val) {
  const { data, error } = await supa.from(table).select(cols).eq(col, val).maybeSingle();
  if (error) throw eroare(500, `${table}: ${error.message}`);
  return data || null;
}

async function incarcaContext(supa, m) {
  const ctx = { sursa: null, pdfText: null, model: null, explicatii: null, titluExistent: false, gratuitClasa: null };
  if (m.sursa.content_id) {
    ctx.sursa = await citesteRand(supa, 'content', COLS, 'id', m.sursa.content_id);
    if (ctx.sursa && ctx.sursa.content_type === 'pdf') {
      ctx.pdfText = await citesteRand(supa, 'ai_pdf_text', 'content_id, barem_id, barem_status, barem_override_id, barem_override_by', 'content_id', m.sursa.content_id);
    }
  }
  if (m.sursa.model_id) {
    ctx.model = await citesteRand(supa, 'admin_model_files', 'id, titlu, clasa, examen, profil, capitol, capitol_id, tip_exercitiu, status, processed_by', 'id', m.sursa.model_id);
  }
  if (m.procedura === 5 && ctx.sursa) {
    const { data, error } = await supa.from('barem_explicatii').select('barem_id').eq('barem_id', ctx.sursa.id).maybeSingle();
    if (error && !lipsaTabela(error)) throw eroare(500, `barem_explicatii: ${error.message}`);
    if (error) throw eroare(409, 'Tabela barem_explicatii lipsește: rulează supabase/explicatii_grila.sql.', 'CONFLICT');
    ctx.explicatii = data || null;
  }
  if (m.procedura === 4 && m.material && m.material.title) {
    const { data } = await supa.from('content').select('id').eq('category', 'evaluare-nationala').eq('subcategory', 'variante-ai').eq('title', m.material.title).limit(1);
    ctx.titluExistent = Array.isArray(data) && data.length > 0;
  }
  if (m.procedura === 3 && ctx.model && ctx.model.clasa) {
    // fișele clasei sunt, de regulă, gratuite — materialul nou ia regula majorității
    const { data } = await supa.from('content').select('is_free').eq('category', `clasa-${ctx.model.clasa}`).eq('content_type', 'pdf').limit(300);
    const rows = Array.isArray(data) ? data : [];
    ctx.gratuitClasa = rows.length ? rows.filter((r) => r.is_free).length * 2 >= rows.length : true;
  }
  return ctx;
}

// → { ok: true } | { ok: false, motiv } — „conflict": între timp golul a fost completat
function verificaPreconditii(m, ctx) {
  const nu = (motiv) => ({ ok: false, motiv });
  const s = ctx.sursa;
  switch (m.procedura) {
    case 1: {
      if (!s) return nu('Materialul nu mai există.');
      if (s.content_type !== 'pdf') return nu('Materialul nu e un PDF.');
      if (B.isBaremRow(s)) return nu('Materialul e el însuși un barem.');
      const t = ctx.pdfText;
      if (t && t.barem_override_id) return nu(`Materialul are deja un barem ales (${t.barem_override_by || 'admin'}).`);
      if (t && (t.barem_id || BAREM_OK.has(t.barem_status))) return nu(`Materialul are deja barem (${t.barem_status}).`);
      return { ok: true };
    }
    case 2: {
      if (!s) return nu('PDF-ul nu mai există.');
      if (s.content_type !== 'pdf') return nu('Sursa nu e un PDF.');
      if (B.isBaremRow(s)) return nu('Sursa e un barem.');
      if (s.interactiv_id) return nu('PDF-ul are deja un test interactiv.');
      if (!CATEGORII.has(s.category)) return nu(`Categoria „${s.category}" nu e una a site-ului.`);
      return { ok: true };
    }
    case 3: {
      const mo = ctx.model;
      if (!mo) return nu('Fișierul model nu mai există.');
      if (mo.status !== 'neprocesat') return nu('Fișierul model a fost deja procesat.');
      if (!mo.clasa) return nu('Fișierul model nu are clasa (e etichetat doar pe examen) — rubrica o alege Radu.');
      return { ok: true };
    }
    case 4:
      if (ctx.titluExistent) return nu(`Există deja o variantă cu titlul „${m.material.title}".`);
      return { ok: true };
    case 5: {
      if (!s) return nu('Baremul nu mai există.');
      if (s.category !== 'evaluare-nationala') return nu('Explicațiile la grilă sunt doar pentru baremele de Evaluare Națională.');
      const inclus = ctx.pdfText && ctx.pdfText.barem_status === 'inclus';
      if (!B.isBaremRow(s) && !inclus) return nu('Sursa nu e un barem (nici un subiect cu baremul inclus).');
      if (ctx.explicatii) return nu('Baremul are deja explicații la grilă.');
      return { ok: true };
    }
    case 6: {
      if (!s) return nu('Testul nu mai există.');
      if (s.content_type !== 'interactive') return nu('Sursa nu e un test interactiv.');
      if (s.file_url !== m.inlocuire.file_url_vechi) return nu('Fișierul testului s-a schimbat între timp — nu-l înlocuiesc.');
      return { ok: true };
    }
    default: return nu('Procedură necunoscută.');
  }
}

// ─── 3) FIȘIERELE ────────────────────────────────────────────────────────────
// Unde se urcă fiecare fișier (aceleași căi ca site-ul: AdminBareme, exgen.postContent,
// explicatiiGrila, verificare.correctedPath). → { rol: { bucket, path, mime } }
function planificaFisiere(m, ctx, now = new Date()) {
  const ts = now.getTime();
  const bucketPt = (free) => (free ? 'content-files-free' : 'content-files');
  const plan = {};
  const material = descriereMaterial(m, ctx);
  if (m.material && material) {
    plan.material = { bucket: bucketPt(material.is_free), path: `pdf/${material.category}/${ts}_${slug(material.title)}.pdf`, mime: ROLURI.material.mime };
    // varianta „fără suprafață neagră": în același bucket (aceleași reguli de acces), ca botul
    // pagina2 (api/_lib/pagina2Run.js → _pagina2-alb/…); starea o scrie publicarea
    if (m.material_alb) plan.material_alb = { bucket: plan.material.bucket, path: `_pagina2-alb/claude-skill/${ts}_${slug(material.title)}.pdf`, mime: ROLURI.material_alb.mime };
  }
  if (m.barem) {
    const pt = m.procedura === 1 ? ctx.sursa : material;
    if (!pt) throw eroare(400, 'Nu știu materialul baremului.');
    plan.barem = { bucket: bucketPt(!!pt.is_free), path: `pdf/${pt.category}/${ts + 1}_barem-${slug(pt.title)}.pdf`, mime: ROLURI.barem.mime };
  }
  if (m.interactiv) {
    const t = descriereInteractiv(m, ctx);
    plan.interactiv = { bucket: bucketPt(t.is_free), path: `interactive/${t.category}/${ts}_task_${slug(t.title)}.html`, mime: ROLURI.interactiv.mime };
  }
  if (m.explicatii) {
    const titlu = ctx.sursa ? ctx.sursa.title : 'barem';
    plan.explicatii = { bucket: 'content-files', path: `pdf/evaluare-nationala/${ts}_explicatii-grila_${slug(titlu)}.pdf`, mime: ROLURI.explicatii.mime };
  }
  if (m.inlocuire) {
    const loc = http.parseStoragePath(m.inlocuire.file_url_vechi);
    const V = require('./verificare');
    plan.inlocuire = { bucket: loc.bucket, path: V.correctedPath(loc.filePath, now), mime: ROLURI.inlocuire.mime };
  }
  return plan;
}

// materialul nou (procedurile 3, 4): categoria, rubrica, capitolul, accesul
function descriereMaterial(m, ctx) {
  if (!m.material) return null;
  if (m.procedura === 3) {
    const mo = ctx.model;
    if (!mo || !mo.clasa) return null;
    return {
      title: m.material.title, category: `clasa-${mo.clasa}`, subcategory: null, profile: null,
      chapter_id: mo.capitol_id || null,
      is_free: m.material.is_free != null ? m.material.is_free : ctx.gratuitClasa !== false,
    };
  }
  if (m.procedura === 4) {
    return {
      title: m.material.title, category: 'evaluare-nationala', subcategory: 'variante-ai', profile: null,
      chapter_id: null, is_free: m.material.is_free === true,
    };
  }
  return null;
}

// testul interactiv nou (procedura 2): ca exgen.postContent, cu rubrica VIZIBILĂ pe site
function descriereInteractiv(m, ctx) {
  const EX = require('./exgen');
  if (m.procedura === 4) {
    // testul interactiv al variantei generate: la „Teste interactive" de EN, asociat cu varianta
    const d = descriereMaterial(m, ctx);
    return {
      title: (m.interactiv && m.interactiv.title) || `${d.title} — rezolvare interactivă`,
      category: d.category,
      subcategory: EX.visibleSubcategory(d.category, d.subcategory),
      profile: null,
      is_free: !!(m.interactiv && m.interactiv.is_free),
    };
  }
  const pdf = ctx.sursa;
  if (!pdf) throw eroare(400, 'PDF-ul sursă lipsește.');
  return {
    title: (m.interactiv && m.interactiv.title) || `${pdf.title} — rezolvare interactivă`,
    category: pdf.category,
    subcategory: EX.visibleSubcategory(pdf.category, pdf.subcategory),
    profile: pdf.profile || null,
    is_free: !!(m.interactiv && m.interactiv.is_free),
  };
}

// citește fișierele unității (citeste(nume) → Buffer) și le verifică forma
async function citesteFisiere(m, citeste) {
  const out = {};
  for (const rol of Object.keys(ROLURI)) {
    if (!m[rol]) continue;
    let buf;
    try { buf = await citeste(m[rol].fisier); } catch (e) { throw eroare(400, `Fișierul „${m[rol].fisier}" (${rol}) nu există în unitate.`); }
    if (!Buffer.isBuffer(buf)) buf = Buffer.from(buf || '');
    if (!buf.length) throw eroare(400, `Fișierul „${m[rol].fisier}" e gol.`);
    if (buf.length > MAX_BYTES) throw eroare(400, `Fișierul „${m[rol].fisier}" e prea mare (peste 40 MB).`);
    if (ROLURI[rol].ext === 'pdf' && buf.subarray(0, 5).toString('latin1') !== '%PDF-') throw eroare(400, `„${m[rol].fisier}" nu e un PDF valid.`);
    if (ROLURI[rol].ext === 'html' && !/<html[\s>]|<!doctype html/i.test(buf.subarray(0, 4000).toString('utf8'))) throw eroare(400, `„${m[rol].fisier}" nu e un document HTML.`);
    out[rol] = buf;
  }
  return out;
}

async function urcaFisiere(supa, plan, buffers) {
  const urcate = {};
  try {
    for (const [rol, p] of Object.entries(plan)) {
      const buf = buffers[rol];
      if (!buf) continue;
      const { error } = await supa.storage.from(p.bucket).upload(p.path, buf, { contentType: p.mime, upsert: false });
      if (error) throw eroare(502, `Încărcarea fișierului „${rol}" în Storage a eșuat: ${error.message}`);
      const { data: u } = supa.storage.from(p.bucket).getPublicUrl(p.path);
      urcate[rol] = { bucket: p.bucket, path: p.path, file_url: (u && u.publicUrl) || p.path, bytes: buf.length };
    }
  } catch (e) {
    await stergeFisiere(supa, urcate);
    throw e;
  }
  return urcate;
}

async function stergeFisiere(supa, fisiere) {
  for (const f of Object.values(fisiere || {})) {
    if (!f || !f.bucket || !f.path) continue;
    try { await supa.storage.from(f.bucket).remove([f.path]); } catch { /* rămâne în bucket — nu oprește nimic */ }
  }
}

// ─── 4) VERIFICĂRILE AUTOMATE de aici (plasa de siguranță a publicării directe) ──
// Ce nu trece coboară din „publică" în „ciornă" (cu motivul) — nu se pierde nimic.
async function politicaPublicare(supa, m, ctx, buffers) {
  const probleme = [];
  if (m.procedura === 3) {
    const mo = ctx.model;
    if (!mo.capitol_id) probleme.push('fișierul model nu are un capitol recunoscut (capitol nou) — harta nu l-ar pune la locul lui');
    else {
      const cap = CH.capitolDin(m.material.title, `clasa-${mo.clasa}`);
      if (!cap || cap.id !== mo.capitol_id) probleme.push(`titlul „${m.material.title}" ajunge pe hartă la „${cap ? cap.titlu : 'Alte exerciții'}", nu la capitolul modelului („${mo.capitol || mo.capitol_id}")`);
    }
  }
  if (m.procedura === 4) {
    if (!m.material_alb) probleme.push('lipsește varianta fără dreptunghiul negru (material_alb)');
    if (!m.interactiv) probleme.push('lipsește testul interactiv asociat variantei (interactiv)');
    if (m.material_alb) {
      // aceeași variantă de două ori: același număr de pagini (doar dreptunghiul de pe pagina 2 diferă)
      try {
        const { PDFDocument } = require('pdf-lib');
        const pagini = async (buf) => (await PDFDocument.load(buf, { ignoreEncryption: true, updateMetadata: false })).getPageCount();
        const [n1, n2] = [await pagini(buffers.material), await pagini(buffers.material_alb)];
        if (n1 !== n2) probleme.push(`varianta fără dreptunghi are ${n2} pagini, iar varianta cu dreptunghi ${n1}`);
        if (n1 < 2) probleme.push('varianta are o singură pagină (pagina 1 e coperta, dreptunghiul e pe pagina 2)');
      } catch (e) { probleme.push(`PDF-urile variantei nu s-au putut citi (${e.message})`); }
    }
  }
  if (m.procedura === 2 || m.procedura === 6 || (m.procedura === 4 && m.interactiv)) {
    const V = require('./verificare');
    const S = require('./score');
    const rol = m.procedura === 6 ? 'inlocuire' : 'interactiv';
    const html = buffers[rol].toString('utf8');
    const c = V.staticChecks(html);
    if (c.syntax.length) probleme.push(`JavaScript-ul nu se compilează: ${c.syntax.map((x) => x.message).slice(0, 2).join('; ')}`);
    if (c.latex.length) probleme.push(`LaTeX cu un singur backslash în șirurile JS (${c.latex.length})`);
    if (c.katex.length) probleme.push(`formule pe care KaTeX nu le poate citi (${c.katex.length})`);
    if (!c.scoreReport) probleme.push('testul nu raportează scorul (MATE_SCORE)');
    if (m.procedura === 6) {
      let vechi = null;
      try {
        const loc = http.parseStoragePath(m.inlocuire.file_url_vechi);
        const { data, error } = await supa.storage.from(loc.bucket).download(loc.filePath);
        if (error || !data) throw new Error(error ? error.message : 'lipsă');
        vechi = Buffer.from(await data.arrayBuffer()).toString('utf8');
      } catch (e) { probleme.push(`fișierul vechi nu s-a putut citi pentru comparație (${e.message})`); }
      if (vechi != null) {
        const v = V.validatePatched(vechi, html);
        if (!v.ok) probleme.push(...v.problems);
        if (S.keysFromHtml(vechi) && !S.keysFromHtml(html)) probleme.push('fișierul nou pierde cheile din care serverul recalculează scorul');
      }
    }
  }
  return probleme.length ? { ok: false, motiv: `Verificările automate de la publicare: ${probleme.join(' · ')}` } : { ok: true };
}

// ─── 5) PUBLICAREA (rândurile din baza de date) ──────────────────────────────
// → `creat` (tot ce trebuie pentru „Anulează"). La eroare: desface ce a apucat să creeze.
async function insereazaContent(supa, row) {
  const { data, error } = await supa.from('content').insert(row).select('id, title, category, subcategory, content_type, file_url, is_free').single();
  if (error || !data) throw eroare(502, `Salvarea în content a eșuat: ${error ? error.message : 'fără răspuns'}`);
  return data;
}

// baremul unui PDF: întâi rândul (ca api/bareme.js → incarcaBarem), ABIA APOI legătura —
// triggerul ai_pdf_text_on_new_content șterge, la orice PDF nou din categorie, rândurile
// ai_pdf_text nelegate (s-ar pierde o legătură scrisă înainte)
async function publicaBarem(supa, material, fisier, creat) {
  const prof = material.category === 'bacalaureat' ? (material.profile || null) : null;
  const barem = await insereazaContent(supa, {
    title: curat(`Barem — ${material.title || 'material'}`, 200), category: material.category, content_type: 'pdf',
    subcategory: 'bareme', profile: prof, is_free: fisier.bucket === 'content-files-free',
    file_url: fisier.file_url, sort_order: 0,
  });
  creat.content.push({ id: barem.id, rol: 'barem', title: barem.title, content_type: 'pdf', category: barem.category });
  const pdfContext = require('../ai-pdf-context');
  const legat = await pdfContext.setOverride(supa, { id: material.id, file_url: material.file_url }, barem.id, { by: BY, doarDacaLiber: true });
  if (!legat) throw conflict('Între timp materialul a primit alt barem — nu-l suprascriu.');
  creat.legatura = { material_id: material.id, barem_id: barem.id };
  return barem;
}

// testul interactiv (procedurile 2 și 4): ca exgen.postContent, apoi asocierea cu PDF-ul
// (exgen.asociazaPdf: pdf_sursa_id + interactiv_id, acesta doar dacă PDF-ul n-are încă test)
async function publicaInteractiv(supa, t, fisier, pdfId, creat) {
  const test = await insereazaContent(supa, {
    title: curat(t.title, 300), description: '', category: t.category, content_type: 'interactive', is_free: t.is_free,
    file_url: fisier.file_url,
    interactive_data: { type: 'test', html: true, ai_generated: true, agent: BY },
    subcategory: t.subcategory, profile: t.profile, sort_order: 0,
  });
  creat.content.push({ id: test.id, rol: 'interactiv', title: test.title, content_type: 'interactive', category: test.category });
  const EX = require('./exgen');
  const principal = await EX.asociazaPdf(supa, { sourceId: pdfId, ctype: 'pdf', contentId: test.id });
  if (!principal) throw conflict('Între timp PDF-ul a primit alt test interactiv — nu-l înlocuiesc.');
  creat.asociere = { pdf_id: pdfId, interactiv_id: test.id };
  return test;
}

async function publica(supa, m, ctx, fisiere) {
  const creat = { content: [], legatura: null, asociere: null, model: null, explicatii: null, inlocuire: null, pagina2: null };
  try {
    if (m.procedura === 1) {
      await publicaBarem(supa, ctx.sursa, fisiere.barem, creat);
    } else if (m.procedura === 2) {
      await publicaInteractiv(supa, descriereInteractiv(m, ctx), fisiere.interactiv, ctx.sursa.id, creat);
    } else if (m.procedura === 3 || m.procedura === 4) {
      const d = descriereMaterial(m, ctx);
      const mat = await insereazaContent(supa, {
        title: curat(d.title, 300), description: null, category: d.category, subcategory: d.subcategory, profile: d.profile,
        content_type: 'pdf', is_free: fisiere.material.bucket === 'content-files-free', file_url: fisiere.material.file_url,
        sort_order: 0, ...(d.chapter_id ? { chapter_id: d.chapter_id } : {}),
      });
      creat.content.push({ id: mat.id, rol: 'material', title: mat.title, content_type: 'pdf', category: mat.category });
      await publicaBarem(supa, { ...mat, profile: d.profile }, fisiere.barem, creat);
      if (m.procedura === 3) {
        const { data, error } = await supa.from('admin_model_files')
          .update({ status: 'procesat', processed_at: nowIso(), processed_by: BY, updated_at: nowIso() })
          .eq('id', ctx.model.id).eq('status', 'neprocesat').select('id');
        if (error) throw eroare(502, `Fișierul model nu s-a putut marca procesat: ${error.message}`);
        if (!Array.isArray(data) || !data.length) throw conflict('Între timp fișierul model a fost procesat.');
        creat.model = { id: ctx.model.id };
      }
      if (m.procedura === 4 && fisiere.material_alb) {
        // varianta „fără suprafață neagră": aceeași stare ca la botul pagina2 (app_settings
        // 'pagina2:<id>', v2, „curatat", copia albă) → vizualizatorul arată „⬛ Original / ⬜ Fără
        // suprafață neagră" (api/_lib/pagina2Alb.js), iar botul n-o mai procesează
        const SET = require('./settings');
        const key = `pagina2:${mat.id}`;
        await SET.writeSetting(supa, key, {
          v: 2, at: nowIso(), by: BY, status: 'curatat', file_url: mat.file_url,
          alb: { bucket: fisiere.material_alb.bucket, path: fisiere.material_alb.path, bytes: fisiere.material_alb.bytes, at: nowIso() },
          notes: 'variantă generată de skill: copia fără dreptunghiul negru e făcută la generare',
        });
        creat.pagina2 = { key, material_id: mat.id };
      }
      if (m.procedura === 4 && fisiere.interactiv) {
        await publicaInteractiv(supa, descriereInteractiv(m, ctx), fisiere.interactiv, mat.id, creat);
      }
    } else if (m.procedura === 5) {
      const titlu = curat((m.explicatii && m.explicatii.titlu) || `Explicații la grilă — ${ctx.sursa.title}`, 200);
      const { error } = await supa.from('barem_explicatii').insert({ barem_id: ctx.sursa.id, file_url: fisiere.explicatii.file_url, titlu, updated_at: nowIso(), updated_by: null });
      if (duplicat(error)) throw conflict('Între timp baremul a primit explicații.');
      if (error) throw eroare(502, `Explicațiile nu s-au putut salva: ${error.message}`);
      creat.explicatii = { barem_id: ctx.sursa.id, file_url: fisiere.explicatii.file_url };
    } else if (m.procedura === 6) {
      const { data, error } = await supa.from('content').update({ file_url: fisiere.inlocuire.file_url })
        .eq('id', ctx.sursa.id).eq('file_url', m.inlocuire.file_url_vechi).select('id');
      if (error) throw eroare(502, `Înlocuirea fișierului a eșuat: ${error.message}`);
      if (!Array.isArray(data) || !data.length) throw conflict('Între timp fișierul testului s-a schimbat — nu-l înlocuiesc.');
      creat.inlocuire = { content_id: ctx.sursa.id, file_url_vechi: m.inlocuire.file_url_vechi, file_url_nou: fisiere.inlocuire.file_url };
    }
    return creat;
  } catch (e) {
    try { await desface(supa, creat); } catch (e2) { console.error('continutGenerat: desfacerea după eroare a eșuat:', e2.message); }
    throw e;
  }
}

// ─── 6) DESFACEREA (Anulează / după o eroare la publicare) ───────────────────
async function desface(supa, creat) {
  const c = creat || {};
  if (c.inlocuire) {
    const { data, error } = await supa.from('content').update({ file_url: c.inlocuire.file_url_vechi })
      .eq('id', c.inlocuire.content_id).eq('file_url', c.inlocuire.file_url_nou).select('id');
    if (error) throw eroare(502, `Fișierul vechi nu s-a putut readuce: ${error.message}`);
    if (!Array.isArray(data) || !data.length) throw conflict('Între timp fișierul testului s-a schimbat din nou — nu readuc versiunea veche peste el.');
  }
  if (c.explicatii) {
    await supa.from('barem_explicatii').delete().eq('barem_id', c.explicatii.barem_id).eq('file_url', c.explicatii.file_url);
  }
  if (c.model) {
    await supa.from('admin_model_files').update({ status: 'neprocesat', processed_at: null, processed_by: null, updated_at: nowIso() })
      .eq('id', c.model.id).eq('processed_by', BY);
  }
  if (c.pagina2) {
    await supa.from('app_settings').delete().eq('key', c.pagina2.key);
  }
  if (c.asociere) {
    await supa.from('content').update({ interactiv_id: null }).eq('id', c.asociere.pdf_id).eq('interactiv_id', c.asociere.interactiv_id);
  }
  if (c.legatura) {
    // legătura se desface explicit (nu doar prin ON DELETE SET NULL) și materialul revine la
    // potrivirea automată — recalcul la prima deschidere (ca setOverride(null))
    await supa.from('ai_pdf_text').update({ barem_override_id: null, barem_override_by: null, barem_status: 'negasit', barem_id: null, barem: null, barem_text: '', updated_at: new Date(0).toISOString() })
      .eq('content_id', c.legatura.material_id).eq('barem_override_id', c.legatura.barem_id);
  }
  for (const x of [...(c.content || [])].reverse()) {
    await supa.from('content').delete().eq('id', x.id);
    if (x.rol === 'barem') {
      // potrivirile automate rămase în cache cu baremul șters (ca api/bareme.js → stergeBarem)
      await supa.from('ai_pdf_text').update({ barem_status: 'negasit', barem_id: null, barem: null, barem_text: '', updated_at: new Date(0).toISOString() }).eq('barem_id', x.id);
    }
  }
}

// ─── 7) JURNALUL (continut_generat) ──────────────────────────────────────────
async function actualizeaza(supa, id, patch) {
  const { error } = await supa.from(TABLE).update({ ...patch, actualizat_la: nowIso() }).eq('id', id);
  if (error) throw eroare(500, `${TABLE}: ${error.message}`);
}

async function randDupaId(supa, id) {
  if (!UUID_RE.test(String(id || ''))) throw eroare(400, 'Unitatea lipsește.');
  const { data, error } = await supa.from(TABLE).select('*').eq('id', String(id)).maybeSingle();
  if (error) throw lipsaTabela(error) ? eroare(409, SETUP_HINT) : eroare(500, error.message);
  if (!data) throw eroare(404, 'Unitatea nu a fost găsită.');
  return data;
}

const rezultat = (rand, extra = {}) => ({ id: rand.id, unitate: rand.unitate, procedura: rand.procedura, status: rand.status, titlu: rand.titlu, motiv: rand.motiv || null, eroare: rand.eroare || null, creat: rand.creat || {}, ...extra });

// ─── 8) PUNCTUL DE INTRARE AL ACTION-ULUI ────────────────────────────────────
// proceseazaUnitate(supa, { manifest, unitate, citeste }) — idempotent: o unitate deja
// înregistrată nu se mai procesează (unitate e UNIQUE în tabelă).
async function proceseazaUnitate(supa, { manifest, unitate, citeste, now = new Date() } = {}) {
  let m;
  try {
    m = normalizeazaManifest(manifest, { unitate });
  } catch (e) {
    // manifest greșit: rămâne în jurnal ca „eșuat" (dacă știm măcar procedura), ca Admin să-l vadă
    const proc = Number(manifest && manifest.procedura);
    const u = curat(unitate || (manifest && manifest.unitate), 200);
    if (PROCEDURI[proc] && u && /^[A-Za-z0-9][A-Za-z0-9._/-]*$/.test(u) && !u.includes('..')) {
      const { data: ex } = await supa.from(TABLE).select('*').eq('unitate', u).maybeSingle();
      if (ex) return rezultat(ex, { deja: true });
      const rand = { unitate: u, procedura: proc, status: 'esuat', titlu: curat(manifest && manifest.titlu, 300) || PROCEDURI[proc].titlu, eroare: `Manifest greșit: ${e.message}`, manifest: {} };
      const { data: ins, error } = await supa.from(TABLE).insert(rand).select('id').single();
      if (!error && ins) return rezultat({ ...rand, id: ins.id });
    }
    throw e;
  }
  const { data: existent, error: e0 } = await supa.from(TABLE).select('*').eq('unitate', m.unitate).maybeSingle();
  if (e0) throw lipsaTabela(e0) ? eroare(409, SETUP_HINT) : eroare(500, e0.message);
  if (existent) {
    if (existent.status === 'in_lucru' && Date.now() - new Date(existent.actualizat_la || existent.creat_la).getTime() > IN_LUCRU_EXPIRA_MS) {
      await actualizeaza(supa, existent.id, { status: 'esuat', eroare: 'Rularea anterioară s-a întrerupt (unitatea a rămas „în lucru").' });
      return rezultat({ ...existent, status: 'esuat' }, { deja: true });
    }
    return rezultat(existent, { deja: true });
  }

  const baza = {
    unitate: m.unitate, procedura: m.procedura, decizie: m.decizie, titlu: m.titlu, motiv: m.motiv,
    sursa_id: m.sursa.content_id || null, model_id: m.sursa.model_id || null,
    manifest: m, verificari: m.verificari, rulare: m.rulare, status: 'in_lucru',
  };
  const { data: rand, error: e1 } = await supa.from(TABLE).insert(baza).select('id').single();
  if (e1) {
    if (duplicat(e1)) { const { data: d } = await supa.from(TABLE).select('*').eq('unitate', m.unitate).maybeSingle(); if (d) return rezultat(d, { deja: true }); }
    throw lipsaTabela(e1) ? eroare(409, SETUP_HINT) : eroare(500, e1.message);
  }
  const id = rand.id;
  const fin = async (patch) => { await actualizeaza(supa, id, patch); return rezultat({ ...baza, id, ...patch }); };

  if (FARA_FISIERE[m.decizie]) return fin({ status: FARA_FISIERE[m.decizie] });

  let fisiere = {};
  try {
    const ctx = await incarcaContext(supa, m);
    const pre = verificaPreconditii(m, ctx);
    if (!pre.ok) return fin({ status: 'conflict', motiv: pre.motiv });
    const buffers = await citesteFisiere(m, citeste);
    let decizie = m.decizie;
    let motiv = m.motiv;
    if (decizie === 'publica') {
      const pol = await politicaPublicare(supa, m, ctx, buffers);
      if (!pol.ok) { decizie = 'ciorna'; motiv = pol.motiv; }
    }
    fisiere = await urcaFisiere(supa, planificaFisiere(m, ctx, now), buffers);
    if (decizie === 'ciorna') return fin({ status: 'ciorna', motiv, fisiere });
    try {
      const creat = await publica(supa, m, ctx, fisiere);
      return fin({ status: 'publicat', fisiere, creat });
    } catch (e) {
      await stergeFisiere(supa, fisiere);
      return fin({ status: e.cod === 'CONFLICT' ? 'conflict' : 'esuat', motiv: e.cod === 'CONFLICT' ? e.message : motiv, eroare: e.cod === 'CONFLICT' ? null : e.message, fisiere: {} });
    }
  } catch (e) {
    return fin({ status: e.cod === 'CONFLICT' ? 'conflict' : 'esuat', eroare: e.message, fisiere });
  }
}

// ─── 9) ADMIN: lista, linkurile, aprobă / respinge / anulează ─────────────────
const GRUPURI = {
  ciorne: ['ciorna'],
  publicate: ['publicat', 'aprobat'],
  probleme: ['esuat', 'conflict', 'in_lucru'],
  inchise: ['respins', 'anulat'],
  verificate: ['verificat', 'nimic'],
};

async function lista(supa, { grup = 'ciorne', procedura = null, limit = 200 } = {}) {
  let q = supa.from(TABLE).select('id, unitate, procedura, status, decizie, titlu, motiv, sursa_id, model_id, fisiere, creat, verificari, rulare, eroare, creat_la, actualizat_la, decis_la')
    .order('creat_la', { ascending: false }).limit(Math.min(500, Math.max(1, Number(limit) || 200)));
  if (GRUPURI[grup]) q = q.in('status', GRUPURI[grup]);
  if (PROCEDURI[Number(procedura)]) q = q.eq('procedura', Number(procedura));
  const { data, error } = await q;
  if (error) {
    if (lipsaTabela(error)) return { setup: false, hint: SETUP_HINT, unitati: [], numarare: {} };
    throw eroare(500, error.message);
  }
  // câte sunt în fiecare grup (insignele filelor)
  const numarare = {};
  const { data: toate } = await supa.from(TABLE).select('status').limit(5000);
  for (const r of toate || []) for (const [g, st] of Object.entries(GRUPURI)) if (st.includes(r.status)) numarare[g] = (numarare[g] || 0) + 1;
  // titlurile surselor (o singură interogare)
  const ids = [...new Set((data || []).map((r) => r.sursa_id).filter(Boolean))];
  const surse = {};
  if (ids.length) {
    const { data: rows } = await supa.from('content').select('id, title, content_type, category').in('id', ids);
    for (const r of rows || []) surse[r.id] = r;
  }
  return { setup: true, unitati: (data || []).map((r) => ({ ...r, sursa: r.sursa_id ? surse[r.sursa_id] || null : null })), numarare };
}

const linkSite = (c) => (c.content_type === 'interactive' ? `/exercitiu?id=${c.id}` : `/pdf-viewer?id=${c.id}`);

async function linkuri(supa, id) {
  const r = await randDupaId(supa, id);
  const fisiere = {};
  for (const [rol, f] of Object.entries(r.fisiere || {})) {
    if (!f || !f.bucket || !f.path) continue;
    const { data } = await supa.storage.from(f.bucket).createSignedUrl(f.path, 600);
    fisiere[rol] = data && data.signedUrl ? data.signedUrl : null;
  }
  let vechi = null;
  const fv = r.manifest && r.manifest.inlocuire && r.manifest.inlocuire.file_url_vechi;
  if (fv) { try { vechi = await http.signedUrlFromPublic(supa, fv, 600); } catch { vechi = null; } }
  const site = (r.creat && Array.isArray(r.creat.content) ? r.creat.content : []).map((c) => ({ rol: c.rol, title: c.title, url: linkSite(c) }));
  if (r.procedura === 6 && r.sursa_id && ['publicat', 'aprobat'].includes(r.status)) site.push({ rol: 'test', title: r.titlu, url: `/exercitiu?id=${r.sursa_id}` });
  if (r.procedura === 5 && r.sursa_id) site.push({ rol: 'barem', title: r.titlu, url: `/pdf-viewer?id=${r.sursa_id}` });
  return { fisiere, vechi, site };
}

async function aproba(supa, id, userId = null) {
  const r = await randDupaId(supa, id);
  if (r.status !== 'ciorna') throw eroare(409, `Doar ciornele se aprobă (unitatea e „${r.status}").`);
  const m = normalizeazaManifest(r.manifest, { unitate: r.unitate });
  const ctx = await incarcaContext(supa, m);
  const pre = verificaPreconditii(m, ctx);
  if (!pre.ok) throw eroare(409, `Nu se poate publica: ${pre.motiv}`);
  const creat = await publica(supa, m, ctx, r.fisiere || {});
  await actualizeaza(supa, r.id, { status: 'aprobat', creat, decis_la: nowIso(), decis_de: userId });
  return rezultat({ ...r, status: 'aprobat', creat });
}

async function respinge(supa, id, userId = null, motiv = '') {
  const r = await randDupaId(supa, id);
  if (r.status !== 'ciorna') throw eroare(409, `Doar ciornele se resping (unitatea e „${r.status}").`);
  await stergeFisiere(supa, r.fisiere);
  const m = curat(motiv, 1000);
  await actualizeaza(supa, r.id, { status: 'respins', decis_la: nowIso(), decis_de: userId, ...(m ? { motiv: `${r.motiv ? `${r.motiv} · ` : ''}Respins: ${m}` } : {}) });
  return rezultat({ ...r, status: 'respins' });
}

async function anuleaza(supa, id, userId = null) {
  const r = await randDupaId(supa, id);
  if (!['publicat', 'aprobat'].includes(r.status)) throw eroare(409, `Doar unitățile publicate se anulează (unitatea e „${r.status}").`);
  await desface(supa, r.creat || {});
  await stergeFisiere(supa, r.fisiere);
  await actualizeaza(supa, r.id, { status: 'anulat', decis_la: nowIso(), decis_de: userId });
  return rezultat({ ...r, status: 'anulat' });
}

module.exports = {
  TABLE, BY, PROCEDURI, STARI, DECIZII, GRUPURI, SETUP_HINT,
  normalizeazaManifest, incarcaContext, verificaPreconditii, planificaFisiere, citesteFisiere,
  politicaPublicare, publica, desface, proceseazaUnitate,
  lista, linkuri, aproba, respinge, anuleaza,
  slug, numeFisierOk,
};
