// =====================================================================
// src/lib/pdfInteractiv.js — legătura PDF ↔ testul interactiv, peste tot pe site
// (20 nov. 2026, cererea: „Fă o legătură mai bună între testele PDF și testele
// interactive și asociază-le.")
//
// Legăturile stau în `content` (supabase/pdf_interactiv.sql, supabase/pdf_sursa.sql):
//   • content.interactiv_id — pe un PDF: testul lui PRINCIPAL;
//   • content.pdf_sursa_id  — pe un test: PDF-ul după care e făcut.
// Aici: ce test deschide „🧩 Interactiv" (cu sau fără abonament), legăturile pentru o
// listă întreagă de carduri (câteva interogări, nu una pe card) și starea cu care se
// deschide testul din PDF-ul lui (punctajul cumulat — api/ai-score.js → cumuleazaInPdf).
// Fără importuri: clientul Supabase vine ca parametru (testele îl încarcă direct).
// =====================================================================

// testele întregi de examen: exercițiile din testul interactiv se adaugă la punctajul PDF-ului
// (aceeași structură, Subiectele I–III — api/_lib/punctajCumulat.js → testIntreg)
export const RUBRICI_TEST_INTREG = ['variante', 'simulari', 'variante-ai', 'teste-antrenament'];
export function esteTestIntreg(pdf) {
  return !!pdf && ['evaluare-nationala', 'bacalaureat'].includes(pdf.category) && RUBRICI_TEST_INTREG.includes(pdf.subcategory || '');
}

// Ce test deschide „🧩 Interactiv" (19 nov. 2026, runda a doua): un PDF poate avea mai multe teste
// făcute după el (content.pdf_sursa_id); principalul e content.interactiv_id. Cu abonament (sau
// când principalul e gratuit) — principalul; fără abonament și principalul Premium — cel mai nou
// test GRATUIT al PDF-ului, dacă există (altfel principalul, cu „⭐ Premium").
export function alegeTestInteractiv(teste, principalId, areAcces) {
  const lista = Array.isArray(teste) ? teste : [];
  const principal = lista.find((t) => t && t.id === principalId) || (principalId ? { id: principalId, is_free: null } : null);
  if (areAcces || !principal || principal.is_free !== false) return principal;
  const gratuit = lista.filter((t) => t && t.is_free === true && t.id !== principalId)
    .sort((a, b) => String(b.created_at || '').localeCompare(String(a.created_at || '')))[0];
  return gratuit || principal;
}

// coloanele de care au nevoie cardurile (titlul perechii, accesul, rubrica — pentru cumul)
export const COLOANE_LEGATURA = 'id, title, content_type, category, subcategory, profile, is_free, created_at, interactiv_id, pdf_sursa_id';
const scurt = (r) => ({
  id: r.id, title: r.title || '', content_type: r.content_type, category: r.category || null,
  subcategory: r.subcategory || null, is_free: r.is_free === true ? true : r.is_free === false ? false : null,
  created_at: r.created_at || null,
});

// Ce trebuie adus pentru o listă: perechile (testul principal al fiecărui PDF, PDF-ul fiecărui
// test) și, pentru PDF-urile cu test, celelalte teste făcute după ele (testul gratuit).
export function deAdus(items) {
  const lista = Array.isArray(items) ? items.filter((i) => i && i.id) : [];
  const ids = new Set();
  const pdfIds = new Set();
  for (const it of lista) {
    if (it.content_type === 'pdf' && it.interactiv_id) { ids.add(it.interactiv_id); pdfIds.add(it.id); }
    if (it.content_type === 'interactive' && it.pdf_sursa_id) ids.add(it.pdf_sursa_id);
  }
  return { ids: [...ids], pdfIds: [...pdfIds] };
}

// { [id card]: { tip: 'pdf', principalId, teste: [...] } | { tip: 'interactive', pdf } }
// `rows` = rândurile aduse (perechile); se folosesc și cardurile din listă (pagina clasei le are
// pe amândouă). Un test șters / ascuns de RLS → cardul rămâne fără legătură, ca până acum.
export function construiesteLegaturi(items, rows) {
  const lista = Array.isArray(items) ? items.filter((i) => i && i.id) : [];
  const toate = new Map();
  for (const r of [...(Array.isArray(rows) ? rows : []), ...lista]) if (r && r.id && !toate.has(r.id)) toate.set(r.id, r);
  const dupaPdf = new Map();   // pdf id → testele făcute după el
  for (const r of toate.values()) {
    if (r.content_type === 'interactive' && r.pdf_sursa_id) {
      if (!dupaPdf.has(r.pdf_sursa_id)) dupaPdf.set(r.pdf_sursa_id, []);
      dupaPdf.get(r.pdf_sursa_id).push(r);
    }
  }
  const out = {};
  for (const it of lista) {
    if (it.content_type === 'pdf' && it.interactiv_id) {
      const teste = [...(dupaPdf.get(it.id) || [])];
      const principal = toate.get(it.interactiv_id);
      if (principal && principal.content_type === 'interactive' && !teste.some((t) => t.id === principal.id)) teste.unshift(principal);
      out[it.id] = { tip: 'pdf', principalId: it.interactiv_id, teste: teste.map(scurt) };
    } else if (it.content_type === 'interactive' && it.pdf_sursa_id) {
      const pdf = toate.get(it.pdf_sursa_id);
      if (pdf && pdf.content_type === 'pdf') out[it.id] = { tip: 'interactive', pdf: scurt(pdf) };
    }
  }
  return out;
}

// Interogările, pe bucăți (URL-ul unei cereri PostgREST are o limită): perechile după id și
// testele făcute după PDF-urile din listă. O eroare → fără legături (cardurile rămân ca înainte).
const BUCATA = 60;
function bucati(arr) {
  const out = [];
  for (let i = 0; i < arr.length; i += BUCATA) out.push(arr.slice(i, i + BUCATA));
  return out;
}
export async function incarcaLegaturi(supabase, items) {
  const { ids, pdfIds } = deAdus(items);
  if (!ids.length && !pdfIds.length) return {};
  const cereri = [
    ...bucati(ids).map((b) => supabase.from('content').select(COLOANE_LEGATURA).in('id', b)),
    ...bucati(pdfIds).map((b) => supabase.from('content').select(COLOANE_LEGATURA).eq('content_type', 'interactive').in('pdf_sursa_id', b)),
  ];
  const rez = await Promise.all(cereri.map((q) => Promise.resolve(q).then((r) => (r && !r.error ? r.data || [] : []), () => [])));
  return construiesteLegaturi(items, rez.flat());
}

// Testul pe care îl deschide cardul unui PDF (`leg` din construiesteLegaturi): același ca „🧩
// Interactiv" din vizualizator — fără abonament, testul gratuit al PDF-ului, dacă există.
export function testulPdfului(leg, areAcces) {
  if (!leg || leg.tip !== 'pdf') return null;
  const t = alegeTestInteractiv(leg.teste, leg.principalId, areAcces);
  if (!t) return null;
  return { ...t, premium: t.is_free === false && !areAcces };
}

// Starea cu care se deschide testul interactiv din PDF-ul lui, de pe cardul din listă
// (src/components/ContentPage.jsx): „← Înapoi" duce la listă, banda testului are „📄 Deschide
// PDF-ul" (cu întoarcerea la listă), iar exercițiile rezolvate intră în punctajul PDF-ului la
// testele întregi de examen (api/ai-score.js → cumuleazaInPdf; serverul verifică legătura).
export function stareTestDinPdf(pdf, retur = {}) {
  const r = {
    returnTo: retur.returnTo || null,
    scrollToCardId: retur.scrollToCardId || pdf.id,
    returnTab: retur.returnTab || null,
    returnSubcategory: retur.returnSubcategory || null,
    returnContentType: retur.returnContentType || null,
  };
  return {
    ...r,
    dinPdf: { id: pdf.id, title: pdf.title || '', adauga: esteTestIntreg(pdf), stare: { item: pdf, ...r }, dinLista: true },
  };
}

// Starea cu care se deschide PDF-ul unui test (de pe cardul testului sau din banda testului
// deschis direct): „← Înapoi" din PDF duce acolo de unde se deschisese testul. Fără `item`:
// vizualizatorul aduce singur rândul întreg al PDF-ului (aici avem doar câteva coloane).
export function starePdfDinTest(retur = {}) {
  return {
    returnTo: retur.returnTo || null,
    scrollToCardId: retur.scrollToCardId || null,
    returnTab: retur.returnTab || null,
    returnSubcategory: retur.returnSubcategory || null,
    returnContentType: retur.returnContentType || null,
  };
}
