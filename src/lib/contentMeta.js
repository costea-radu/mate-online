// =====================================================================
// src/lib/contentMeta.js — rubricile site-ului într-un singur loc:
// categorii, subcategorii (EN/BAC), profiluri (BAC), tipuri de conținut,
// plus regulile de afișare (ordinea de pe site, rubrica în care apare un
// material). Folosit de Admin.jsx și de componentele din ContentAdminTools.jsx.
// Valorile trebuie să rămână IDENTICE cu filtrele din paginile publice
// (ContentPage.jsx, EvaluareNationala.jsx, Bacalaureat.jsx) și cu validarea
// de pe server (api/_lib/contentAdmin.js).
// =====================================================================

export const CATEGORIES = [
  { value: 'clasa-5',  label: 'Clasa a V-a' },
  { value: 'clasa-6',  label: 'Clasa a VI-a' },
  { value: 'clasa-7',  label: 'Clasa a VII-a' },
  { value: 'clasa-8',  label: 'Clasa a VIII-a' },
  { value: 'clasa-9',  label: 'Clasa a IX-a' },
  { value: 'clasa-10', label: 'Clasa a X-a' },
  { value: 'clasa-11', label: 'Clasa a XI-a' },
  { value: 'clasa-12', label: 'Clasa a XII-a' },
  { value: 'evaluare-nationala', label: 'Evaluare Națională' },
  { value: 'bacalaureat', label: 'Bacalaureat' },
  { value: 'manuale', label: 'Manuale Online' },
];

export const EN_SUBCATEGORIES = [
  { value: 'capitole',          label: 'Capitole' },
  { value: 'exercitii-subiecte',label: 'Exerciții pe Subiecte (Teste antrenament)' },
  { value: 'variante',          label: 'Variante Date + Modele (Teste antrenament)' },
  { value: 'simulari',          label: 'Simulări (Teste antrenament)' },
  { value: 'bareme',            label: 'Bareme (Teste antrenament)' },
  { value: 'teste-interactive', label: 'Teste Interactive' },
];

export const BAC_SUBCATEGORIES = [
  { value: 'capitole',          label: 'Capitole' },
  { value: 'exercitii',         label: 'Exerciții pe Subiecte' },
  { value: 'variante',          label: 'Variante + Olimpici + Rezerve' },
  { value: 'teste-antrenament', label: 'Teste de Antrenament' },
  { value: 'simulari',          label: 'Simulări' },
  { value: 'bareme',            label: 'Bareme' },
  { value: 'teste-interactive', label: 'Teste Interactive' },
];

export const BAC_PROFILES = [
  { value: 'mate-info',       label: 'Mate-Info' },
  { value: 'stiinte-naturii', label: 'Științele Naturii' },
  { value: 'tehnologic',      label: 'Tehnologic' },
];

export const CONTENT_TYPES = [
  { value: 'pdf', label: '📄 PDF' },
  { value: 'interactive', label: '🧩 Exercițiu Interactiv' },
  { value: 'manual', label: '📖 Manual Online' },
];

const labelOf = (list, value) => (list.find((x) => x.value === value) || {}).label || value || '';
export const categoryLabel = (v) => labelOf(CATEGORIES, v);
export const profileLabel = (v) => labelOf(BAC_PROFILES, v);
export const contentTypeLabel = (v) => labelOf(CONTENT_TYPES, v);

// Subcategoriile unei categorii (goale la clase/auxiliare).
export function subcategoriesFor(category) {
  if (category === 'evaluare-nationala') return EN_SUBCATEGORIES;
  if (category === 'bacalaureat') return BAC_SUBCATEGORIES;
  return [];
}
export const hasSubcategories = (category) => subcategoriesFor(category).length > 0;
export const subcategoryLabel = (category, v) => labelOf(subcategoriesFor(category), v);

// La Bacalaureat, fiecare rubrică (mai puțin „Capitole") se filtrează după profil
// (vezi Bacalaureat.jsx: ProfilePDFContent + blocul de teste interactive).
export const needsProfile = (category, subcategory) =>
  category === 'bacalaureat' && !!subcategory && subcategory !== 'capitole';

// Extensia fișierului din URL-ul de Storage.
export function fileExtension(fileUrl) {
  if (!fileUrl) return null;
  const name = String(fileUrl).split('?')[0].split('#')[0].split('/').pop() || '';
  const m = name.match(/\.([a-z0-9]+)$/i);
  return m ? m[1].toLowerCase() : null;
}

// Numele original al fișierului (fără prefixul-timestamp), bucket-ul și calea.
export function storageInfo(fileUrl) {
  if (!fileUrl) return null;
  try {
    const decoded = decodeURIComponent(String(fileUrl));
    const m = decoded.match(/\/object\/(?:public|sign)\/([^/]+)\/(.+?)(?:\?.*)?$/);
    const path = m ? m[2] : decoded;
    const name = (path.split('/').pop() || '').replace(/^\d+_/, '');
    return { bucket: m ? m[1] : null, path, name };
  } catch { return null; }
}

// Tipurile compatibile cu fișierul (oglinda regulii de pe server).
export function allowedContentTypes(item) {
  const ext = fileExtension(item?.file_url);
  if (!ext) return item?.file_url ? CONTENT_TYPES.map((t) => t.value) : ['manual'];
  if (ext === 'pdf') return ['pdf'];
  if (ext === 'html' || ext === 'htm') return ['interactive', 'manual'];
  return CONTENT_TYPES.map((t) => t.value);
}

// Ordinea de pe site: sort_order crescător, la egalitate cel mai nou primul
// (exact .order('sort_order').order('created_at', desc) din ContentPage/ExamContent).
export function siteOrder(a, b) {
  const sa = a.sort_order == null ? 0 : Number(a.sort_order);
  const sb = b.sort_order == null ? 0 : Number(b.sort_order);
  if (sa !== sb) return sa - sb;
  return (Date.parse(b.created_at || 0) || 0) - (Date.parse(a.created_at || 0) || 0);
}

// Rubrica (lista) în care apare un material pe site, pentru un „scope"
// { category, type, subcategory, profile } — aceleași filtre ca pe paginile publice:
//   • clase/auxiliare: categorie + tip (tab-ul paginii);
//   • Evaluare Națională: + subcategorie;
//   • Bacalaureat: + subcategorie + profil (mai puțin la „Capitole").
export function matchesGroup(item, scope) {
  if (!item || !scope) return false;
  if (item.category !== scope.category) return false;
  if (item.content_type !== scope.type) return false;
  if (hasSubcategories(scope.category)) {
    if ((item.subcategory || '') !== (scope.subcategory || '')) return false;
    if (needsProfile(scope.category, scope.subcategory) && (item.profile || '') !== (scope.profile || '')) return false;
  }
  return true;
}

// Tipurile de conținut pe care le AFIȘEAZĂ o rubrică pe site (oglinda paginilor):
//   • clase: tab-urile „Interactive" + „PDF" (ClassPage.jsx);
//   • Auxiliare Online: un singur tab, cel interactiv (Manuale.jsx);
//   • EN: Capitole / Exerciții pe Subiecte au comutator Interactive|PDF (TypeTabs),
//     Variante / Simulări / Bareme doar PDF, Teste Interactive doar interactiv;
//   • BAC: la fel (Capitole / Exerciții cu comutator; Variante / Teste de
//     Antrenament / Simulări / Bareme doar PDF; Teste Interactive doar interactiv).
// Tipul „manual" nu e afișat de nicio pagină.
export function visibleTypesFor(category, subcategory) {
  if (category === 'evaluare-nationala') {
    if (subcategory === 'capitole' || subcategory === 'exercitii-subiecte') return ['pdf', 'interactive'];
    if (subcategory === 'teste-interactive') return ['interactive'];
    if (['variante', 'simulari', 'bareme'].includes(subcategory)) return ['pdf'];
    return [];
  }
  if (category === 'bacalaureat') {
    if (subcategory === 'capitole' || subcategory === 'exercitii') return ['pdf', 'interactive'];
    if (subcategory === 'teste-interactive') return ['interactive'];
    if (['variante', 'teste-antrenament', 'simulari', 'bareme'].includes(subcategory)) return ['pdf'];
    return [];
  }
  if (category === 'manuale') return ['interactive'];
  return ['pdf', 'interactive'];
}
const typeShort = (t) => (t === 'pdf' ? 'PDF' : t === 'interactive' ? 'interactiv' : t);

// Probleme de vizibilitate ale unui material (nu apare pe site și de ce).
export function visibilityWarning(item) {
  if (!item) return null;
  if (hasSubcategories(item.category)) {
    if (!item.subcategory) return 'Fără subcategorie — nu apare pe site.';
    if (needsProfile(item.category, item.subcategory) && !item.profile) return 'Fără profil — nu apare la niciun profil de BAC.';
  }
  const vis = visibleTypesFor(item.category, item.subcategory);
  if (!vis.includes(item.content_type)) {
    const where = hasSubcategories(item.category)
      ? `Rubrica „${subcategoryLabel(item.category, item.subcategory)}"`
      : `„${categoryLabel(item.category)}"`;
    return `${where} afișează doar ${vis.map(typeShort).join(' și ')} — un material de tip „${item.content_type}" nu apare pe site.`;
  }
  return null;
}
