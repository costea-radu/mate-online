// =====================================================================
// api/_lib/contentAdmin.js — logica PURĂ (fără rețea) pentru Admin →
// „Tot Conținutul": editarea metadatelor unui material, ordinea de afișare,
// înlocuirea fișierului (păstrând data și poziția) și unde apar materialele noi.
// Folosită de api/content-admin.js; testată în test/content-admin.test.js și
// test/continut-inlocuire-ordine.test.js.
//
// Cum se ordonează materialele pe site (ContentPage.jsx / ExamContent.jsx):
//     .order('sort_order', asc).order('created_at', desc)
// deci sort_order MIC = apare PRIMUL, iar la egalitate câștigă cel mai nou.
// Materialele noi se inserează cu sort_order = 0 → apar primele până sunt mutate
// (sau la sfârșitul rubricii, dacă adminul a ales „⤓ ultimele" — vezi mai jos).
// =====================================================================

const CATEGORIES = [
  'clasa-5', 'clasa-6', 'clasa-7', 'clasa-8', 'clasa-9', 'clasa-10', 'clasa-11', 'clasa-12',
  'evaluare-nationala', 'bacalaureat', 'manuale',
];
const CONTENT_TYPES = ['pdf', 'interactive', 'manual'];
// Subcategoriile/profilurile EXACT ca în formularele din Admin.jsx și în
// paginile EvaluareNationala.jsx / Bacalaureat.jsx (altfel materialul nu apare).
const SUBCATEGORIES = {
  'evaluare-nationala': ['capitole', 'exercitii-subiecte', 'variante', 'simulari', 'bareme', 'teste-interactive'],
  'bacalaureat':        ['capitole', 'exercitii', 'variante', 'teste-antrenament', 'simulari', 'bareme', 'teste-interactive'],
};
const BAC_PROFILES = ['mate-info', 'stiinte-naturii', 'tehnologic'];

const MAX_TITLE = 300;
const MAX_DESCRIPTION = 500;

function bucketFor(isFree) { return isFree ? 'content-files-free' : 'content-files'; }

// Extensia fișierului din URL-ul de Storage (sau dintr-o cale simplă).
function fileExtension(fileUrl) {
  if (!fileUrl) return null;
  const clean = String(fileUrl).split('?')[0].split('#')[0];
  const name = clean.split('/').pop() || '';
  const m = name.match(/\.([a-z0-9]+)$/i);
  return m ? m[1].toLowerCase() : null;
}

// Tipurile de conținut compatibile cu fișierul: un PDF nu poate deveni
// „interactiv" (viewer-ul l-ar deschide ca HTML și s-ar rupe), iar un HTML
// nu poate deveni „pdf". Fără fișier (manual inline) → doar „manual".
function allowedContentTypes(row) {
  const ext = fileExtension(row && row.file_url);
  if (!ext) return row && row.file_url ? CONTENT_TYPES.slice() : ['manual'];
  if (ext === 'pdf') return ['pdf'];
  if (ext === 'html' || ext === 'htm') return ['interactive', 'manual'];
  return CONTENT_TYPES.slice(); // extensie necunoscută → nu blocăm adminul
}

function isStr(v) { return typeof v === 'string'; }

// Validează și normalizează câmpurile editabile. `input` = ce a trimis
// formularul, `current` = rândul din baza de date. Întoarce { patch, errors }:
// patch conține DOAR câmpurile care se schimbă (gol → nimic de salvat).
function sanitizeUpdate(input, current) {
  const errors = [];
  const patch = {};
  const src = input && typeof input === 'object' ? input : {};
  const cur = current && typeof current === 'object' ? current : {};

  if (src.title !== undefined) {
    const title = isStr(src.title) ? src.title.trim() : '';
    if (!title) errors.push('Titlul e obligatoriu.');
    else if (title.length > MAX_TITLE) errors.push(`Titlul e prea lung (max ${MAX_TITLE} caractere).`);
    else if (title !== cur.title) patch.title = title;
  }

  if (src.description !== undefined) {
    const d = isStr(src.description) ? src.description.trim() : '';
    if (d.length > MAX_DESCRIPTION) errors.push(`Descrierea e prea lungă (max ${MAX_DESCRIPTION} caractere).`);
    else {
      const next = d || null;
      if (next !== (cur.description || null)) patch.description = next;
    }
  }

  const category = src.category !== undefined ? String(src.category || '') : cur.category;
  if (src.category !== undefined) {
    if (!CATEGORIES.includes(category)) errors.push('Categorie necunoscută.');
    else if (category !== cur.category) patch.category = category;
  }

  if (src.content_type !== undefined) {
    const ct = String(src.content_type || '');
    if (!CONTENT_TYPES.includes(ct)) errors.push('Tip de conținut necunoscut.');
    else if (!allowedContentTypes(cur).includes(ct)) {
      errors.push(`Tipul „${ct}" nu se potrivește cu fișierul (${fileExtension(cur.file_url) || 'fără fișier'}).`);
    } else if (ct !== cur.content_type) patch.content_type = ct;
  }

  if (src.is_free !== undefined) {
    const free = src.is_free === true || src.is_free === 'true' || src.is_free === 'free';
    if (free !== !!cur.is_free) patch.is_free = free;
  }

  // Subcategorie / profil — au sens doar la Evaluare Națională și Bacalaureat.
  const subs = SUBCATEGORIES[category];
  if (subs) {
    if (src.subcategory !== undefined) {
      const sub = src.subcategory ? String(src.subcategory) : null;
      if (sub && !subs.includes(sub)) errors.push('Subcategorie invalidă pentru categoria aleasă.');
      else if (sub !== (cur.subcategory || null)) patch.subcategory = sub;
    }
    if (category === 'bacalaureat') {
      if (src.profile !== undefined) {
        const prof = src.profile ? String(src.profile) : null;
        if (prof && !BAC_PROFILES.includes(prof)) errors.push('Profil de Bacalaureat invalid.');
        else if (prof !== (cur.profile || null)) patch.profile = prof;
      }
    } else if (cur.profile) {
      patch.profile = null; // EN nu are profiluri
    }
  } else if (patch.category && SUBCATEGORIES[cur.category]) {
    // a plecat din EN/BAC într-o clasă/auxiliare → rubricile vechi nu mai au sens
    if (cur.subcategory) patch.subcategory = null;
    if (cur.profile) patch.profile = null;
  }

  if (src.sort_order !== undefined && src.sort_order !== null && src.sort_order !== '') {
    const n = Number(src.sort_order);
    if (!Number.isInteger(n) || n < 0 || n > 1000000) errors.push('Ordinea trebuie să fie un număr întreg ≥ 0.');
    else if (n !== (cur.sort_order == null ? 0 : cur.sort_order)) patch.sort_order = n;
  }

  return { patch, errors };
}

// Ordinea de pe site pentru două rânduri (sort_order asc, apoi created_at desc).
function siteOrder(a, b) {
  const sa = a.sort_order == null ? 0 : Number(a.sort_order);
  const sb = b.sort_order == null ? 0 : Number(b.sort_order);
  if (sa !== sb) return sa - sb;
  const ta = Date.parse(a.created_at || 0) || 0;
  const tb = Date.parse(b.created_at || 0) || 0;
  return tb - ta;
}

// Renumerotează o listă de id-uri (în ordinea dorită) cu 1..N. Întoarce DOAR
// rândurile al căror sort_order se schimbă (fiecare update e o cerere).
// `rows` = rândurile existente (id, sort_order); id-urile necunoscute sunt
// ignorate (șterse între timp) și raportate în `missing`.
function planReorder(rows, ids) {
  const byId = new Map((rows || []).map((r) => [String(r.id), r]));
  const seen = new Set();
  const updates = [];
  const missing = [];
  let pos = 0;
  for (const rawId of ids || []) {
    const id = String(rawId);
    if (seen.has(id)) continue;
    seen.add(id);
    const row = byId.get(id);
    if (!row) { missing.push(id); continue; }
    pos += 1;
    const cur = row.sort_order == null ? 0 : Number(row.sort_order);
    if (cur !== pos) updates.push({ id, sort_order: pos });
  }
  return { updates, missing, total: pos };
}

const collator = new Intl.Collator('ro', { numeric: true, sensitivity: 'base' });

// Sortare globală: renumerotează fiecare categorie separat, după dată sau
// titlu, crescător/descrescător. Întoarce DOAR rândurile care se schimbă.
function planSortAll(rows, { by = 'created_at', dir = 'desc' } = {}) {
  if (!['created_at', 'title'].includes(by)) throw new Error('Criteriu de sortare necunoscut.');
  if (!['asc', 'desc'].includes(dir)) throw new Error('Direcție de sortare necunoscută.');
  const sign = dir === 'asc' ? 1 : -1;
  const cmp = by === 'title'
    ? (a, b) => sign * collator.compare(String(a.title || ''), String(b.title || '')) || siteOrder(a, b)
    : (a, b) => sign * ((Date.parse(a.created_at || 0) || 0) - (Date.parse(b.created_at || 0) || 0)) || siteOrder(a, b);

  const groups = new Map();
  for (const r of rows || []) {
    const key = String(r.category || '');
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(r);
  }
  const updates = [];
  for (const list of groups.values()) {
    list.sort(cmp).forEach((r, i) => {
      const cur = r.sort_order == null ? 0 : Number(r.sort_order);
      if (cur !== i + 1) updates.push({ id: String(r.id), sort_order: i + 1 });
    });
  }
  return { updates, total: (rows || []).length };
}

// ═════════════════════════════════════════════════════════════════════════════
// ÎNLOCUIREA FIȘIERULUI unui material („🔁 Înlocuiește" din Tot Conținutul)
// Rândul din `content` rămâne ACELAȘI (id, created_at, sort_order, titlu,
// rubrică, acces) → ordinea de pe site, rezultatele elevilor, recenziile și
// temele date rămân neatinse; se schimbă doar `file_url`. Fișierul nou se
// încarcă într-o cale NOUĂ (URL nou → fără copii vechi în cache-ul CDN, iar
// triggerele din baza de date reindexează materialul și invalidează textul PDF).
// ═════════════════════════════════════════════════════════════════════════════
const FILE_FOLDERS = ['pdf', 'interactive', 'manual'];
const CONTENT_BUCKETS = ['content-files', 'content-files-free'];

// Folderul din Storage în care Admin pune fișierele unui tip (ca la „Adaugă PDF / Interactiv")
function folderFor(contentType) { return contentType === 'pdf' ? 'pdf' : 'interactive'; }

// Numele fișierului pentru o cheie de Storage: fără diacritice și fără
// caracterele pe care Storage le refuză („Invalid key"), cu extensia păstrată.
function safeFileName(name) {
  const raw = String(name || '').split(/[\\/]/).pop() || '';
  const m = raw.match(/^(.*?)(\.[A-Za-z0-9]{1,8})?$/);
  const ext = ((m && m[2]) || '').toLowerCase();
  const base = String((m && m[1]) || '').normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^A-Za-z0-9._ -]+/g, '_').replace(/\s+/g, '_').replace(/_+/g, '_')
    .replace(/^[_.-]+|[_.-]+$/g, '').slice(0, 80);
  return (base || 'fisier') + ext;
}

// Calea în Storage a fișierului nou (oglinda din src/lib/contentMeta.js).
function replacementPath(row, fileName, now = Date.now()) {
  return `${folderFor(row && row.content_type)}/${row && row.category}/${now}_${safeFileName(fileName)}`;
}

// Verifică fișierul nou (PUR): calea, folderul, extensia potrivită tipului.
// Întoarce { ok, error } sau { ok: true, bucket, ext }.
function checkReplacement(row, path) {
  if (!row) return { ok: false, error: 'Material negăsit.' };
  const p = String(path || '');
  // eslint-disable-next-line no-control-regex
  if (!p || p.length > 600 || p.includes('..') || p.startsWith('/') || /[\u0000-\u001f]/.test(p)) {
    return { ok: false, error: 'Calea fișierului nou e invalidă.' };
  }
  if (!FILE_FOLDERS.includes(p.split('/')[0])) {
    return { ok: false, error: 'Fișierul nou trebuie să fie în folderul materialelor (pdf/ sau interactive/).' };
  }
  const ext = fileExtension(p);
  const want = row.content_type === 'pdf' ? 'un PDF (.pdf)' : 'o pagină HTML (.html)';
  if (!ext) return { ok: false, error: `Fișierul nou nu are extensie — trebuie să fie ${want}.` };
  if (!allowedContentTypes({ file_url: p }).includes(row.content_type)) {
    return { ok: false, error: `Materialul e de tip „${row.content_type}": fișierul nou trebuie să fie ${want}, nu .${ext}.` };
  }
  return { ok: true, bucket: bucketFor(!!row.is_free), ext };
}

// Testele interactive generate de platformă își țin cheile în
// interactive_data.exercise — care descrie fișierul VECHI. La înlocuire îl
// scoatem, iar punctajul se calculează din noul HTML (score.keysFromHtml).
// Întoarce null când nu e nimic de schimbat.
function interactiveDataAfterReplace(data, nowIso = new Date().toISOString()) {
  if (!data || typeof data !== 'object' || Array.isArray(data) || !data.exercise) return null;
  const { exercise, ...rest } = data; // eslint-disable-line no-unused-vars
  return { ...rest, file_replaced_at: nowIso };
}

// ═════════════════════════════════════════════════════════════════════════════
// UNDE APAR MATERIALELE NOI („📥" din Ordinea de afișare)
// Implicit, un material nou primește sort_order = 0 → apare PRIMUL în rubrică.
// Setarea (tabela app_settings, cheia 'content_new_position') poate cere
// „la sfârșit" pe tot site-ul, pe o categorie sau pe o rubrică; triggerul SQL
// public.content_new_position (supabase/setari_ordine_gratuite.sql) dă atunci
// materialului nou sort_order = max(rubrică) + 1 — la orice inserare: Adaugă
// PDF / Interactiv din Admin și testele postate de agentul Claude.
// Prioritatea: rubrica → categoria → tot site-ul → „start".
// ═════════════════════════════════════════════════════════════════════════════
const NEW_POSITION_KEY = 'content_new_position';
const NEW_POSITIONS = ['start', 'end'];

// Cheia rubricii (lista de pe site) a unui material — oglinda lui matchesGroup
// din src/lib/contentMeta.js și a funcției SQL public.content_rubric_key.
function rubricKey(row) {
  const r = row || {};
  const cat = String(r.category || '');
  const sub = SUBCATEGORIES[cat] ? String(r.subcategory || '') : '';
  const prof = cat === 'bacalaureat' && sub && sub !== 'capitole' ? String(r.profile || '') : '';
  return `${cat}|${sub}|${prof}|${String(r.content_type || r.type || '')}`;
}
const RUBRIC_KEY_RE = /^[a-z0-9-]+\|[a-z0-9-]*\|[a-z0-9-]*\|(pdf|interactive|manual)$/;

// Setarea, curățată: { site, categories: {cat: poz}, rubrics: {cheie: poz} }
function normalizeNewPosition(v) {
  const src = v && typeof v === 'object' && !Array.isArray(v) ? v : {};
  const out = { site: NEW_POSITIONS.includes(src.site) ? src.site : 'start', categories: {}, rubrics: {} };
  for (const [k, pos] of Object.entries(src.categories || {})) {
    if (CATEGORIES.includes(k) && NEW_POSITIONS.includes(pos)) out.categories[k] = pos;
  }
  for (const [k, pos] of Object.entries(src.rubrics || {})) {
    if (RUBRIC_KEY_RE.test(k) && CATEGORIES.includes(k.split('|')[0]) && NEW_POSITIONS.includes(pos)) out.rubrics[k] = pos;
  }
  return out;
}

// Unde apare un material nou (aceeași regulă ca triggerul SQL)
function newPositionFor(cfg, row) {
  const c = normalizeNewPosition(cfg);
  return c.rubrics[rubricKey(row)] || c.categories[String((row && row.category) || '')] || c.site || 'start';
}

// Schimbă setarea: scope 'site' | 'category' | 'rubric'; value 'start' | 'end'
// sau null (= „ca la nivelul de deasupra": scoate excepția). Întoarce setarea nouă.
function applyNewPosition(cfg, { scope, category = null, rubric = null, value = null } = {}) {
  const c = normalizeNewPosition(cfg);
  if (value !== null && !NEW_POSITIONS.includes(value)) throw new Error('Poziție necunoscută (start / end).');
  if (scope === 'site') {
    c.site = value || 'start';
  } else if (scope === 'category') {
    if (!CATEGORIES.includes(String(category || ''))) throw new Error('Categorie necunoscută.');
    if (value) c.categories[category] = value; else delete c.categories[category];
  } else if (scope === 'rubric') {
    const key = typeof rubric === 'string' ? rubric : rubricKey(rubric || {});
    if (!RUBRIC_KEY_RE.test(key) || !CATEGORIES.includes(key.split('|')[0])) throw new Error('Rubrică necunoscută.');
    if (value) c.rubrics[key] = value; else delete c.rubrics[key];
  } else {
    throw new Error('Nivel necunoscut (site / category / rubric).');
  }
  return c;
}

// „Mută la sfârșit materialele noi": în fiecare rubrică din `rows` care are deja
// o ordine stabilită (cel puțin un sort_order > 0), materialele rămase pe
// poziția 0 (= adăugate după ultima ordonare, deci apar acum PRIMELE) trec la
// sfârșit, în ordinea în care au fost adăugate. Rubricile cu toate pozițiile 0
// (ordonate doar după dată) rămân neatinse. Întoarce DOAR rândurile care se schimbă.
function planMoveNewToEnd(rows) {
  const groups = new Map();
  for (const r of rows || []) {
    const k = rubricKey(r);
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k).push(r);
  }
  const updates = [];
  let rubrics = 0;
  for (const list of groups.values()) {
    const pos = (r) => (r.sort_order == null ? 0 : Number(r.sort_order));
    const max = list.reduce((m, r) => Math.max(m, pos(r)), 0);
    if (max <= 0) continue;
    const fresh = list.filter((r) => pos(r) <= 0)
      .sort((a, b) => (Date.parse(a.created_at || 0) || 0) - (Date.parse(b.created_at || 0) || 0) || String(a.id).localeCompare(String(b.id)));
    if (!fresh.length) continue;
    rubrics += 1;
    fresh.forEach((r, i) => updates.push({ id: String(r.id), sort_order: max + i + 1 }));
  }
  return { updates, rubrics };
}

module.exports = {
  CATEGORIES, CONTENT_TYPES, SUBCATEGORIES, BAC_PROFILES,
  bucketFor, fileExtension, allowedContentTypes, sanitizeUpdate,
  siteOrder, planReorder, planSortAll,
  FILE_FOLDERS, CONTENT_BUCKETS, folderFor, safeFileName, replacementPath, checkReplacement, interactiveDataAfterReplace,
  NEW_POSITION_KEY, NEW_POSITIONS, rubricKey, normalizeNewPosition, newPositionFor, applyNewPosition, planMoveNewToEnd,
};
