// =====================================================================
// api/_lib/pagina2Alb.js — ⬜ varianta „fără suprafață neagră" a unui test de EN
//
// Botul (api/_lib/pagina2Run.js) face, pentru fiecare test de Evaluare Națională,
// o COPIE a PDF-ului cu un dreptunghi alb lipit peste dreptunghiul negru de pe
// pagina 2. Originalul rămâne neatins, la adresa lui (file_url). Copia stă în
// același bucket (deci cu aceleași reguli de acces: gratuit / premium), în
// `_pagina2-alb/<id>/…`, iar starea ei în app_settings `pagina2:<id>`.
//
// Aici: doar cititul stării, fără MuPDF — îl folosește și api/get-file-url.js
// (vizualizatorul PDF primește linkul semnat al copiei, pe lângă cel al originalului).
// =====================================================================
'use strict';

const STATE_PREFIX = 'pagina2:';
const CATEGORY = 'evaluare-nationala';
const SUBCATS = ['variante', 'simulari'];
const ALB_DIR = '_pagina2-alb';
const VERSION_ALB = 2;          // stările de dinainte (v1) nu au copie albă

const isEnTest = (r) => !!r && r.category === CATEGORY && r.content_type === 'pdf' && SUBCATS.includes(r.subcategory) && !!r.file_url;

// copia albă din stare — doar dacă e a fișierului de ACUM și nu e ascunsă din Admin
function albFromState(row, st) {
  if (!row || !st || typeof st !== 'object') return null;
  if ((st.v || 0) < VERSION_ALB || st.status !== 'curatat' || st.hidden) return null;
  if (st.file_url !== row.file_url) return null;                 // fișierul testului a fost înlocuit între timp
  const a = st.alb;
  if (!a || !a.bucket || !a.path) return null;
  return a;
}

// { bucket, path, … } | null
async function albOf(supa, row) {
  if (!isEnTest(row) || !row.id) return null;
  const { data, error } = await supa.from('app_settings').select('value').eq('key', STATE_PREFIX + row.id).maybeSingle();
  if (error || !data) return null;
  return albFromState(row, data.value);
}

// linkul semnat al copiei albe (null dacă testul n-are una)
async function albSignedUrl(supa, row, ttl = 300) {
  const a = await albOf(supa, row);
  if (!a) return null;
  const { data, error } = await supa.storage.from(a.bucket).createSignedUrl(a.path, ttl);
  if (error || !data || !data.signedUrl) return null;
  return data.signedUrl;
}

module.exports = { STATE_PREFIX, CATEGORY, SUBCATS, ALB_DIR, VERSION_ALB, isEnTest, albFromState, albOf, albSignedUrl };
