#!/usr/bin/env node
// =====================================================================
// scripts/continut/aduce-surse.js — GitHub Action-ul „Aduce surse" (repo-ul privat
// examenmate-continut, .github/workflows/aduce-surse.yml) — 21 nov. 2026
//
// Rularea task-ului programat (în cloud) nu poate descărca fișiere din Storage. Ea pune o
// cerere în cereri/<nume>.json și face push; Action-ul rulează acest script cu cheia de
// serviciu și pune fișierele cerute pe ramura `surse` a repo-ului (o ramură fără istoric,
// rescrisă la fiecare rulare, ca repo-ul să nu crească):
//   <content_id>/<fișier> + meta.json          — un material din `content` (PDF / test interactiv)
//   <content_id>/barem/<fișier> + meta.json    — baremul legat de material ({ "barem_pentru": id })
//   model-<id>/<fișier> + meta.json            — un fișier model (admin_model_files)
//   <content_id>/lectie/reguli.md + brief.json + meta.json — procedura 7 (lecția live): regulile
//                                                EXACTE după care scrie lecțiile modelul de pe site,
//                                                pentru acest subiect ({ "lectie_pentru": id })
//   _gata/<nume>.json                          — cererea e gata (ce s-a adus, ce nu)
// Cererea: { "creat_la": ISO, "rulare": "…", "fisiere": [ {"content_id": "…"}, {"barem_pentru": "…"},
// {"model_id": "…"}, {"lectie_pentru": "…"} ] } — cel mult 30 de elemente; doar ce e în tabelele
// site-ului (nu căi oarecare din bucket). Cererile mai vechi de 48 de ore nu se mai procesează.
// Sursele stau 7 zile.
//
//   node scripts/continut/aduce-surse.js --dir <clona repo-ului (main)> --out <folderul ramurii surse>
// =====================================================================
'use strict';
const fs = require('node:fs');
const path = require('node:path');

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAX_ITEMI = 30;
const MAX_BYTES = 40 * 1024 * 1024;
const CERERE_EXPIRA_MS = 48 * 3600 * 1000;
const SURSE_EXPIRA_MS = 7 * 24 * 3600 * 1000;
const GATA_EXPIRA_MS = 14 * 24 * 3600 * 1000;
const COLS = 'id, title, description, category, subcategory, profile, content_type, is_free, file_url, interactiv_id, pdf_sursa_id, chapter_id, created_at';

function arg(name, def = null) {
  const i = process.argv.indexOf(name);
  return i > 0 && process.argv[i + 1] ? process.argv[i + 1] : def;
}
const numeSigur = (s) => String(s || 'fisier').normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^A-Za-z0-9._-]+/g, '_').replace(/^[._]+/, '').slice(-120) || 'fisier';
const scrieJson = (f, o) => { fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, `${JSON.stringify(o, null, 2)}\n`); };

async function descarca(supa, bucket, filePath) {
  const { data, error } = await supa.storage.from(bucket).download(filePath);
  if (error || !data) throw new Error(`descărcarea a eșuat (${error ? error.message : 'fișier lipsă'})`);
  const buf = Buffer.from(await data.arrayBuffer());
  if (buf.length > MAX_BYTES) throw new Error('fișierul are peste 40 MB');
  return buf;
}

async function aduMaterial(supa, http, id, outDir, sub = '', acum = Date.now()) {
  const { data: row, error } = await supa.from('content').select(COLS).eq('id', id).maybeSingle();
  if (error) throw new Error(error.message);
  if (!row) throw new Error('materialul nu există');
  if (!row.file_url) throw new Error('materialul nu are fișier');
  const loc = http.parseStoragePath(row.file_url);
  const buf = await descarca(supa, loc.bucket, loc.filePath);
  const nume = numeSigur(loc.filePath.split('/').pop());
  const dir = path.join(outDir, sub);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, nume), buf);
  let pdf = null;
  if (row.content_type === 'pdf') {
    const { data: t } = await supa.from('ai_pdf_text').select('barem_status, barem_id, barem_override_id, barem_override_by, chars, truncated').eq('content_id', id).maybeSingle();
    pdf = t || null;
  }
  scrieJson(path.join(dir, 'meta.json'), { ...row, fisier: nume, bytes: buf.length, ai_pdf_text: pdf, adus_la: new Date(acum).toISOString() });
  return path.posix.join(path.relative(path.dirname(outDir), dir).split(path.sep).join('/'), nume);
}

// ─── procedura 7: regulile lecției live pentru un subiect ─────────────────────
// Exact ce primește modelul care scrie lecțiile pe site (api/_lib/liveLesson.js → skillBrief):
// instrucțiunile (system), cererile pe bucăți cu secțiunile subiectului și ale baremului, schema
// răspunsului — ca rularea skill-ului să scrie lecția după aceleași reguli; plus starea lecției.
const EXAM_TEXT = { en: 'Evaluarea Națională', bac: 'Bacalaureat' };
function reguliMd(brief, row) {
  const lines = [
    `# Lecția live cu ${brief.teacher.name} — „${brief.title}" (${EXAM_TEXT[brief.exam] || brief.exam}${brief.profile ? `, ${brief.profile}` : ''})`,
    '',
    '> Regulile EXACTE după care scrie lecțiile live modelul de pe site (api/_lib/liveLesson.js: systemPrompt, userPrompt, SCHEMA),',
    `> generate acum pentru acest subiect (content_id ${row.id}). Lecția o scrii TU, după ele, în locul modelului.`,
    '',
    '## Ce livrezi',
    '',
    '`lectie.json` = `{ "items": [ … ] }` — toți itemii subiectului, în ordinea din subiect, fiecare EXACT după schema de la sfârșit',
    '(un obiect pe item; fără alte câmpuri). Cererile de mai jos sunt bucățile pe care modelul de pe site le primește pe rând, cu',
    'paginile PDF ale subiectului și ale baremului atașate: tu ai PDF-urile întregi (cererea `content_id` + `barem_pentru`) — citește',
    'formulele din pagini (regula 0). Poți scrie bucată cu bucată; la sfârșit pui toți itemii în același `items`.',
    '',
    `- Itemii așteptați (structura subiectului): ${brief.expected.length ? brief.expected.join(', ') : '— (structura nu se citește din text: toți itemii din PDF)'}`,
    `- Baremul: ${brief.hasBarem ? `citit${brief.barem && brief.barem.title ? ` („${brief.barem.title}")` : ''}` : 'NU e citit — subiectul nu se poate preda'}`,
  ];
  const g = Object.entries(brief.grile || {}).filter(([, v]) => v && Object.keys(v).length);
  if (g.length) lines.push(`- Literele grilelor din tabelul baremului (au ultimul cuvânt): ${g.map(([sec, v]) => `S. ${sec}: ${Object.entries(v).map(([n, l]) => `${n}) ${l}`).join(', ')}`).join(' · ')}`);
  lines.push('', '## Instrucțiunile (system)', '', '```text', brief.system, '```', '', '## Cererile, pe bucăți', '');
  brief.chunks.forEach((c, i) => {
    lines.push(`### Bucata ${i + 1} — Subiectul ${c.section}, itemii ${c.from}–${c.to}`, '', '```text', c.prompt, '```', '');
  });
  lines.push('## Schema unui răspuns (JSON)', '', 'Fiecare bucată răspunde cu un obiect de forma de mai jos; în `lectie.json` pui toți itemii la un loc.', '', '```json', JSON.stringify(brief.schema, null, 2), '```', '');
  return lines.join('\n');
}

async function aduLectie(supa, id, out, acum = Date.now(), deps = {}) {
  const { data: row, error } = await supa.from('content').select(COLS).eq('id', id).maybeSingle();
  if (error) throw new Error(error.message);
  if (!row) throw new Error('subiectul nu există');
  const B = require('../../api/_lib/barem');
  const L = require('../../api/_lib/live');
  const LL = require('../../api/_lib/liveLesson');
  const se = L.subjectExam(row, B);
  if (!se) throw new Error('lecțiile live sunt doar pentru subiectele de Evaluare Națională și Bacalaureat');
  const teacher = L.teacherById('radu') || L.teachers()[0];
  const pdfContext = deps.pdfContext || ((s, c) => require('../../api/ai-pdf-context').getPdfContext(s, c));
  const ctx = await pdfContext(supa, row);
  const brief = LL.skillBrief({ ctx, content: row, teacher, exam: se.exam, profile: se.profile });
  const { data: les } = await supa.from('live_lessons').select('id, status, version, title, updated_at')
    .eq('subject_id', id).eq('teacher', teacher.id).order('version', { ascending: false }).limit(1);
  const dir = path.join(out, id, 'lectie');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'reguli.md'), reguliMd(brief, row));
  scrieJson(path.join(dir, 'brief.json'), brief);
  scrieJson(path.join(dir, 'meta.json'), {
    content: row, exam: se.exam, profile: se.profile, are_barem: brief.hasBarem, barem: brief.barem,
    asteptati: brief.expected, grile: brief.grile, lectie_existenta: (les && les[0]) || null, adus_la: new Date(acum).toISOString(),
  });
  return `${id}/lectie/reguli.md`;
}

// `acum` (testele îl simulează): același ceas pentru „adus_la” ca pentru expirarea surselor
async function proceseazaCerere(supa, http, cerere, out, acum = Date.now(), deps = {}) {
  const rezultate = [];
  const itemi = Array.isArray(cerere.fisiere) ? cerere.fisiere.slice(0, MAX_ITEMI) : [];
  for (const it of itemi) {
    const r = { item: it, ok: false };
    try {
      if (it && UUID_RE.test(String(it.content_id || ''))) {
        r.cale = await aduMaterial(supa, http, String(it.content_id), path.join(out, String(it.content_id)), '', acum);
      } else if (it && UUID_RE.test(String(it.barem_pentru || ''))) {
        const id = String(it.barem_pentru);
        const { data: t, error } = await supa.from('ai_pdf_text').select('barem_status, barem_id, barem_override_id').eq('content_id', id).maybeSingle();
        if (error) throw new Error(error.message);
        const baremId = t && (t.barem_override_id || t.barem_id);
        if (t && t.barem_status === 'inclus' && (!baremId || baremId === id)) { r.ok = true; r.nota = 'baremul e inclus în același PDF'; rezultate.push(r); continue; }
        if (!baremId) throw new Error('materialul nu are barem legat');
        r.cale = await aduMaterial(supa, http, baremId, path.join(out, id), 'barem', acum);
        r.barem_id = baremId;
      } else if (it && UUID_RE.test(String(it.model_id || ''))) {
        const id = String(it.model_id);
        const { data: mo, error } = await supa.from('admin_model_files')
          .select('id, titlu, file_path, bucket, sursa, nume_original, pagini, text_sursa, clasa, examen, profil, capitol, capitol_id, tip_exercitiu, examen_asociat, status, uploaded_at')
          .eq('id', id).maybeSingle();
        if (error) throw new Error(error.message);
        if (!mo) throw new Error('fișierul model nu există');
        const buf = await descarca(supa, mo.bucket || 'personal-pdfs', mo.file_path);
        const dir = path.join(out, `model-${id}`);
        const nume = numeSigur(String(mo.file_path).split('/').pop());
        fs.mkdirSync(dir, { recursive: true });
        fs.writeFileSync(path.join(dir, nume), buf);
        scrieJson(path.join(dir, 'meta.json'), { ...mo, fisier: nume, bytes: buf.length, adus_la: new Date(acum).toISOString() });
        r.cale = `model-${id}/${nume}`;
      } else if (it && UUID_RE.test(String(it.lectie_pentru || ''))) {
        r.cale = await aduLectie(supa, String(it.lectie_pentru), out, acum, deps);
      } else {
        throw new Error('element necunoscut (content_id / barem_pentru / model_id / lectie_pentru)');
      }
      r.ok = true;
    } catch (e) {
      r.eroare = e.message;
    }
    rezultate.push(r);
  }
  return rezultate;
}

// sursele mai vechi de 7 zile și marcajele mai vechi de 14 zile ies de pe ramură
function curata(out, acum = Date.now()) {
  if (!fs.existsSync(out)) return;
  const adusLa = (f) => { try { return new Date(JSON.parse(fs.readFileSync(f, 'utf8')).adus_la).getTime() || 0; } catch { return 0; } };
  for (const e of fs.readdirSync(out, { withFileTypes: true })) {
    if (!e.isDirectory() || e.name === '_gata' || e.name === '.git') continue;
    // cel mai nou meta.json din folder (materialul, baremul lui, regulile lecției live)
    const t = Math.max(adusLa(path.join(out, e.name, 'meta.json')), adusLa(path.join(out, e.name, 'barem', 'meta.json')), adusLa(path.join(out, e.name, 'lectie', 'meta.json')));
    if (!t || acum - t > SURSE_EXPIRA_MS) fs.rmSync(path.join(out, e.name), { recursive: true, force: true });
  }
  const gata = path.join(out, '_gata');
  if (fs.existsSync(gata)) {
    for (const f of fs.readdirSync(gata)) {
      let t = 0;
      try { t = new Date(JSON.parse(fs.readFileSync(path.join(gata, f), 'utf8')).adus_la).getTime() || 0; } catch { t = 0; }
      if (!t || acum - t > GATA_EXPIRA_MS) fs.rmSync(path.join(gata, f), { force: true });
    }
  }
}

async function aduceToate({ dir, out, supa, http, log = console.log, acum = Date.now(), deps = {} }) {
  const folder = path.join(dir, 'cereri');
  const facute = [];
  curata(out, acum);
  if (!fs.existsSync(folder)) return facute;
  for (const f of fs.readdirSync(folder).filter((x) => x.endsWith('.json')).sort()) {
    const marcaj = path.join(out, '_gata', f);
    if (fs.existsSync(marcaj)) continue;
    let cerere;
    try { cerere = JSON.parse(fs.readFileSync(path.join(folder, f), 'utf8')); } catch (e) { scrieJson(marcaj, { cerere: f, eroare: `JSON invalid: ${e.message}`, adus_la: new Date(acum).toISOString() }); continue; }
    const creat = new Date(cerere && cerere.creat_la).getTime();
    if (!creat || acum - creat > CERERE_EXPIRA_MS) continue;   // veche (sau fără dată) — n-o mai aduc
    const rezultate = await proceseazaCerere(supa, http, cerere, out, acum, deps);
    scrieJson(marcaj, { cerere: f, rulare: cerere.rulare || null, rezultate, adus_la: new Date(acum).toISOString() });
    log(`${f}: ${rezultate.filter((r) => r.ok).length}/${rezultate.length} aduse${rezultate.some((r) => !r.ok) ? ` — ${rezultate.filter((r) => !r.ok).map((r) => r.eroare).join('; ')}` : ''}`);
    facute.push({ cerere: f, rezultate });
  }
  return facute;
}

async function main() {
  const dir = path.resolve(arg('--dir', process.cwd()));
  const out = path.resolve(arg('--out', path.join(process.cwd(), 'surse-out')));
  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    throw new Error('Lipsesc secretele SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY (Settings → Secrets and variables → Actions).');
  }
  const http = require('../../api/_lib/http');
  const facute = await aduceToate({ dir, out, supa: http.admin(), http });
  console.log(facute.length ? `Cereri procesate: ${facute.length}` : 'Nicio cerere nouă.');
}

if (require.main === module) {
  main().catch((e) => { console.error(e.message || e); process.exit(1); });
}

module.exports = { aduceToate, proceseazaCerere, curata, numeSigur, reguliMd };
