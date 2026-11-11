// =====================================================================
// api/_lib/noteProfesor.js — CATALOGUL PROFESORULUI (11 nov. 2026)
//
// Cererea: „fă ca profesorii să poată da note elevilor, plusuri, minusuri,
// aprecieri". Profesorul alege, la un elev asociat lui (Contul meu → „Grupe /
// Rezultate elevi" → „📒 Notează"):
//   📝 notă (1–10) — pentru ce: lucrare, test, răspuns oral, temă…
//   ➕ plus  /  ➖ minus — opțional, pentru ce
//   👏 apreciere — un mesaj scurt pentru elev
// Elevul le vede în „Rezultatele mele", părinții lui în „Rezultate elev", iar
// amândoi primesc o notificare. Notele intră în mediile profesorului.
//
// Aici: logica pură (validarea, textele notificărilor, rezumatul) — testabilă.
// Scrierile: api/teacher-manage.js (add_mark / delete_mark); citirea pentru
// profesor și părinte: api/teacher-students.js (`marks`). Tabela:
// supabase/catalog_profesor.sql.
// =====================================================================

const KINDS = ['nota', 'plus', 'minus', 'apreciere'];
const MAX_TITLE = 120;
const MAX_COMMENT = 600;

const curat = (v, max) => String(v == null ? '' : v).replace(/\s+/g, ' ').trim().slice(0, max);

// { kind, value, title, comment } din corpul cererii → { ok, row?, error? }
function validateMark(body = {}) {
  const kind = String(body.kind || '').trim();
  if (!KINDS.includes(kind)) return { ok: false, error: 'Alege ce dai: notă, plus, minus sau apreciere.' };
  const title = curat(body.title, MAX_TITLE) || null;
  const comment = curat(body.comment, MAX_COMMENT) || null;
  let value = null;
  if (kind === 'nota') {
    const n = Number(String(body.value ?? '').replace(',', '.'));
    if (!Number.isFinite(n) || n < 1 || n > 10) return { ok: false, error: 'Nota trebuie să fie între 1 și 10.' };
    value = Math.round(n * 100) / 100;
  }
  if (kind === 'apreciere' && !comment) return { ok: false, error: 'Scrie aprecierea pentru elev.' };
  return { ok: true, row: { kind, value, title, comment } };
}

const fmtNota = (v) => {
  const n = Number(v);
  if (!Number.isFinite(n)) return '';
  return Number.isInteger(n) ? String(n) : n.toFixed(2).replace('.', ',');
};

// Textul notificării — pentru elev (`cui: 'elev'`) sau pentru părinte (`cui: 'parinte'`)
function notificare(mark, { profesor = 'profesorul tău', elev = 'copilul tău', cui = 'elev' } = {}) {
  const prof = profesor || 'profesorul tău';
  const pentru = mark.title ? ` · ${mark.title}` : '';
  const laElev = cui === 'elev';
  switch (mark.kind) {
    case 'nota':
      return {
        title: laElev ? `📝 Ai primit nota ${fmtNota(mark.value)} de la ${prof}` : `📝 ${elev} a primit nota ${fmtNota(mark.value)} de la ${prof}`,
        body: mark.title ? `Pentru: ${mark.title}${mark.comment ? ` — ${mark.comment}` : ''}` : (mark.comment || null),
      };
    case 'plus':
      return {
        title: laElev ? `➕ Ai primit un plus de la ${prof}` : `➕ ${elev} a primit un plus de la ${prof}`,
        body: mark.title ? `Pentru: ${mark.title}` : (mark.comment || null),
      };
    case 'minus':
      return {
        title: laElev ? `➖ Ai primit un minus de la ${prof}` : `➖ ${elev} a primit un minus de la ${prof}`,
        body: mark.title ? `Pentru: ${mark.title}` : (mark.comment || null),
      };
    case 'apreciere':
    default:
      return {
        title: laElev ? `👏 ${prof} te apreciază${pentru}` : `👏 ${prof} îl apreciază pe ${elev}${pentru}`,
        body: mark.comment || null,
      };
  }
}

// Rezumatul unei liste de rânduri: { note: [..], media, plusuri, minusuri, aprecieri }
function rezumat(list = []) {
  const rows = Array.isArray(list) ? list : [];
  const note = rows.filter((m) => m && m.kind === 'nota' && Number.isFinite(Number(m.value)));
  const media = note.length ? Math.round((note.reduce((a, m) => a + Number(m.value), 0) / note.length) * 100) / 100 : null;
  return {
    note,
    media,
    plusuri: rows.filter((m) => m && m.kind === 'plus').length,
    minusuri: rows.filter((m) => m && m.kind === 'minus').length,
    aprecieri: rows.filter((m) => m && m.kind === 'apreciere').length,
  };
}

const lipsaTabela = (err) => !!err && /teacher_marks|relation|does not exist|schema cache|could not find/i.test(String(err.message || err));

module.exports = { KINDS, MAX_TITLE, MAX_COMMENT, validateMark, notificare, rezumat, fmtNota, lipsaTabela };
