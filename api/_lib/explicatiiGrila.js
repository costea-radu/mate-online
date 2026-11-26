// =====================================================================
// api/_lib/explicatiiGrila.js — EXPLICAȚIILE LA GRILĂ, la baremele oficiale de EN
// (18 nov. 2026)
//
// Cererea: „Pune barem cu explicații pt grila la evaluare națională. Baremul oficial
// oferă doar rezolvarea grilei fără explicații. În baremul oficial pune buton pentru
// explicații la grilă. Explicația la grilă o să fie generată ulterior și încărcată."
//
// Un PDF cu explicațiile grilei (Subiectele I și II) pentru un barem de Evaluare
// Națională — tabela barem_explicatii (supabase/explicatii_grila.sql), cheia = baremul
// (content.id: baremul separat sau, la „subiecte + barem" în același PDF, subiectul).
//   stare(supa, baremId)            — există? (fără linkul fișierului) — oricine;
//   link(supa, baremId, { profil }) — linkul semnat (5 min), doar pentru abonații
//                                     Premium și admini (26 nov. 2026: „Explicațiile
//                                     grilă fă-le să fie premium" — și la baremele gratuite);
//   salveaza / sterge / lista       — doar adminul (Admin → 💡 Explicații grilă).
// Fișierul îl încarcă browserul adminului în Storage (content-files, privat), la
// pdf/evaluare-nationala/…_explicatii-grila_….pdf; aici se verifică locul și se leagă.
// Rutele: api/bareme.js (acțiunile explicatii, explicatii_url, explicatii_lista,
// explicatii_salveaza, explicatii_sterge). Interfața: src/components/ExplicatiiGrila.jsx.
// =====================================================================
const http = require('./http');
const B = require('./barem');

const TABELA = 'barem_explicatii';
const BUCKET = 'content-files';
const PREFIX = 'pdf/evaluare-nationala/';
const SELECT_BAREM = 'id, title, category, subcategory, content_type, file_url, is_free, created_at';

function eroare(status, msg) { const e = new Error(msg); e.status = status; return e; }
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// tabela lipsește → scriptul nu e rulat
const lipsaTabela = (error) => !!error && (/barem_explicatii|does not exist|schema cache|relation/i.test(String(error.message || '')) || error.code === '42P01' || error.code === 'PGRST205');

async function baremul(supa, baremId) {
  const id = String(baremId || '');
  if (!UUID.test(id)) throw eroare(400, 'Baremul lipsește.');
  const { data, error } = await supa.from('content').select(SELECT_BAREM).eq('id', id).maybeSingle();
  if (error) throw eroare(500, error.message);
  if (!data) throw eroare(404, 'Baremul nu a fost găsit.');
  return data;
}

async function randul(supa, baremId) {
  const { data, error } = await supa.from(TABELA).select('barem_id, file_url, titlu, updated_at').eq('barem_id', String(baremId)).maybeSingle();
  if (error) {
    if (lipsaTabela(error)) return { setup: false, row: null };
    throw eroare(500, error.message);
  }
  return { setup: true, row: data || null };
}

const esteEN = (row) => !!row && row.category === 'evaluare-nationala';

// Există explicații pentru baremul acesta? (fără linkul fișierului)
async function stare(supa, baremId) {
  const b = await baremul(supa, baremId);
  if (!esteEN(b)) return { ok: true, en: false, setup: true, exista: false };
  const { setup, row } = await randul(supa, b.id);
  return {
    ok: true, en: true, setup, exista: !!row,
    titlu: row ? (row.titlu || 'Explicații la grilă') : null,
    actualizat: row ? row.updated_at : null,
    gratuit: !!b.is_free,       // baremul în sine (explicațiile sunt Premium oricum)
    premium: true,
  };
}

// Linkul semnat — explicațiile la grilă sunt Premium (26 nov. 2026), indiferent dacă
// baremul e gratuit: abonații activi și adminii
async function link(supa, baremId, { profil = null } = {}) {
  const b = await baremul(supa, baremId);
  if (!esteEN(b)) throw eroare(404, 'Explicațiile la grilă sunt doar la baremele de Evaluare Națională.');
  const { row } = await randul(supa, b.id);
  if (!row) throw eroare(404, 'Explicațiile la grila acestui barem nu au fost încă adăugate.');
  if (!profil) throw eroare(401, 'Autentifică-te ca să deschizi explicațiile la grilă (sunt pentru abonații Premium).');
  const abonat = profil.subscription_status === 'active' || !!profil.is_admin;
  if (!abonat) throw eroare(403, 'Explicațiile la grilă fac parte din abonamentul Premium.');
  const url = await http.signedUrlFromPublic(supa, row.file_url, 300);
  return { ok: true, url, titlu: row.titlu || 'Explicații la grilă' };
}

// ─── doar adminul ────────────────────────────────────────────────────────────
// Fișierul încărcat din browser: doar PDF, în bucket-ul privat, la EN
function verificaFisier(fileUrl) {
  let loc;
  try { loc = http.parseStoragePath(String(fileUrl || '')); } catch { throw eroare(400, 'Fișierul încărcat nu a fost găsit.'); }
  if (loc.bucket !== BUCKET || !loc.filePath.startsWith(PREFIX) || !/\.pdf$/i.test(loc.filePath)) {
    throw eroare(400, 'Explicațiile se încarcă ca PDF, la materialele de Evaluare Națională.');
  }
  return loc;
}

async function stergeFisier(supa, fileUrl) {
  try {
    const { bucket, filePath } = http.parseStoragePath(fileUrl);
    await supa.storage.from(bucket).remove([filePath]);
  } catch { /* fișierul vechi rămâne — nu oprește nimic */ }
}

async function salveaza(supa, { baremId, fileUrl, titlu = '', userId = null }) {
  const b = await baremul(supa, baremId);
  if (!esteEN(b)) throw eroare(400, 'Explicațiile la grilă sunt doar pentru baremele de Evaluare Națională.');
  verificaFisier(fileUrl);
  const { setup, row: vechi } = await randul(supa, b.id);
  if (!setup) throw eroare(409, 'Rulează întâi supabase/explicatii_grila.sql în Supabase.');
  const nume = String(titlu || '').replace(/\s+/g, ' ').trim().slice(0, 200) || 'Explicații la grilă';
  const { error } = await supa.from(TABELA).upsert({
    barem_id: b.id, file_url: String(fileUrl), titlu: nume, updated_at: new Date().toISOString(), updated_by: userId,
  }, { onConflict: 'barem_id' });
  if (error) throw eroare(500, `Explicațiile nu au putut fi salvate (${error.message}).`);
  if (vechi && vechi.file_url && vechi.file_url !== String(fileUrl)) await stergeFisier(supa, vechi.file_url);
  return stare(supa, b.id);
}

async function sterge(supa, { baremId }) {
  const b = await baremul(supa, baremId);
  const { setup, row } = await randul(supa, b.id);
  if (!setup) throw eroare(409, 'Rulează întâi supabase/explicatii_grila.sql în Supabase.');
  if (row) {
    const { error } = await supa.from(TABELA).delete().eq('barem_id', b.id);
    if (error) throw eroare(500, error.message);
    await stergeFisier(supa, row.file_url);
  }
  return stare(supa, b.id);
}

// Baremele de EN (rubrica „Bareme", titlul sau numele fișierului) + cele care au deja
// explicații (și „subiecte + barem" în același PDF), cu starea lor — Admin
async function lista(supa) {
  const rows = await http.allRows((from, to) => supa.from('content').select(SELECT_BAREM)
    .eq('category', 'evaluare-nationala').eq('content_type', 'pdf')
    .order('created_at', { ascending: false }).range(from, to), { pageSize: 1000, maxPages: 5 });
  let expl = [];
  let setup = true;
  const { data, error } = await supa.from(TABELA).select('barem_id, file_url, titlu, updated_at');
  if (error) { if (lipsaTabela(error)) setup = false; else throw eroare(500, error.message); }
  else expl = data || [];
  const cu = new Map(expl.map((e) => [String(e.barem_id), e]));
  const bareme = rows.filter((r) => B.isBaremRow(r) || cu.has(String(r.id))).map((r) => {
    const e = cu.get(String(r.id));
    return {
      id: r.id, title: r.title || 'Barem', is_free: !!r.is_free, barem: B.isBaremRow(r),
      explicatie: e ? { titlu: e.titlu || 'Explicații la grilă', actualizat: e.updated_at } : null,
    };
  });
  return { ok: true, setup, bareme, cuExplicatii: bareme.filter((b) => b.explicatie).length };
}

module.exports = { TABELA, BUCKET, PREFIX, stare, link, salveaza, sterge, lista, verificaFisier, lipsaTabela };
