// =====================================================================
// api/_lib/contentAdmin.js — logica PURĂ (fără rețea) pentru Admin →
// „Tot Conținutul": editarea metadatelor unui material și ordinea de afișare.
// Folosită de api/content-admin.js; testată în test/content-admin.test.js.
//
// Cum se ordonează materialele pe site (ContentPage.jsx / ExamContent.jsx):
//     .order('sort_order', asc).order('created_at', desc)
// deci sort_order MIC = apare PRIMUL, iar la egalitate câștigă cel mai nou.
// Materialele noi se inserează cu sort_order = 0 → apar primele până sunt mutate.
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

module.exports = {
  CATEGORIES, CONTENT_TYPES, SUBCATEGORIES, BAC_PROFILES,
  bucketFor, fileExtension, allowedContentTypes, sanitizeUpdate,
  siteOrder, planReorder, planSortAll,
};
