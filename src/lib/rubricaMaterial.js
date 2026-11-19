// =====================================================================
// src/lib/rubricaMaterial.js — UNDE APARE UN MATERIAL NOU (18 nov. 2026)
//
// Cererea lui Radu: „Fă ca atunci când se adaugă un PDF sau test interactiv nou, să se
// adauge la capitolul corespunzător din site. Eu din admin aleg doar clasa sau examenul
// și profilul."
//
// La „Adaugă PDF" / „Exerciții Interactive" (src/pages/Admin.jsx), adminul alege doar
// clasa sau examenul (+ profilul la BAC). De aici vin:
//   • rubricaAuto  — la Evaluare Națională / Bacalaureat, RUBRICA (subcategoria) după
//                    titlu și numele fișierului: baremele, simulările, testele de
//                    antrenament, variantele, exercițiile pe subiecte, capitolele,
//                    testele interactive. Ce nu se recunoaște rămâne de ales de admin;
//   • capitolulNou — capitolul din site (aceleași reguli ca pe hartă, la bareme și în
//                    paginile claselor: api/_lib/capitoleHarta.js), doar unde lista e pe
//                    capitole: clasele și rubrica „Capitole" de la EN / BAC.
// Locul exact (la sfârșitul capitolului lui) îl pune serverul după încărcare:
// api/content-admin.js → action 'plaseaza' (api/_lib/contentAdmin.js → planPlasare).
// Regulile de rubrică sunt verificate pe titlurile reale din site
// (test/material-capitol.test.js).
// =====================================================================
import { capitolDin, fold } from '../../api/_lib/capitoleHarta.js';

const EXAMEN = new Set(['evaluare-nationala', 'bacalaureat']);
const RE_CLASA = /^clasa-(5|6|7|8|9|10|11|12)$/;

// numele fișierului, fără prefixul-timestamp și fără extensie („…_bar_07_LRO")
function numeFisier(fileName) {
  let n = String(fileName || '').split('#')[0].split('?')[0].split('/').pop() || '';
  try { n = decodeURIComponent(n); } catch { /* rămâne cum e */ }
  return n.replace(/\.[a-z0-9]{2,5}$/i, '').replace(/^\d{9,}[_-]/, '');
}
const curat = (s) => fold(s).replace(/[_.·|]+/g, ' ').replace(/\s+/g, ' ').trim();

// lista e pe capitole? (clasele; la examene — doar rubrica „Capitole")
export function rubricaPeCapitole(category, subcategory) {
  if (RE_CLASA.test(String(category || ''))) return true;
  return EXAMEN.has(category) && subcategory === 'capitole';
}

// Rubrica unui material nou la EN / BAC → { subcategory, motiv } ('' = nerecunoscută).
// La clase și la auxiliare nu există rubrici → { subcategory: '' }.
export function rubricaAuto({ title, fileName = '', category, contentType }) {
  if (!EXAMEN.has(category)) return { subcategory: '', motiv: null };
  const bac = category === 'bacalaureat';
  const t = curat(title);
  const f = curat(numeFisier(fileName));
  const tf = `${t} ${f}`;
  const subiect = /\bsubiect(ul)?\b/.test(t);
  const cap = capitolDin(title, category);

  if (contentType === 'interactive') {
    // testele (variantele, simulările) întâi: „Test interactiv … · Subiectul I, II" e un test
    if (/\btest\b|\bvarianta\b|\bvariante\b|\bmodel\b|\bsimulare\b|\b(19|20)\d{2}\b/.test(t)) return { subcategory: 'teste-interactive', motiv: 'test / variantă în titlu' };
    // EN: „Geometrie plană 2 · Subiectul III" stă la Capitole; BAC: „Funcții · Subiectul I,
    // Ex. 2" stă la Exerciții pe subiecte (cum sunt așezate în site)
    if (!bac && cap) return { subcategory: 'capitole', motiv: `capitolul „${cap.titlu}"` };
    if (subiect) return { subcategory: bac ? 'exercitii' : 'exercitii-subiecte', motiv: '„Subiectul …" în titlu' };
    if (cap) return { subcategory: 'capitole', motiv: `capitolul „${cap.titlu}"` };
    return { subcategory: '', motiv: null };
  }

  // PDF — „…_bar_…" e numele oficial al unui barem; un fișier „subiecte și barem" e
  // subiectul, nu baremul
  const faraSubiect = !/subiect/.test(f);
  if (/\bbarem/.test(t) || (/\bbar\b/.test(f) && faraSubiect)) return { subcategory: 'bareme', motiv: 'barem' };
  if (/\bsimulare\b|\bsimulari\b|\bsimularea\b/.test(tf)) return { subcategory: 'simulari', motiv: 'simulare' };
  if (/barem/.test(f) && faraSubiect) return { subcategory: 'bareme', motiv: 'barem (numele fișierului)' };
  if (bac && /\bmodel(ul)?\b/.test(tf)) return { subcategory: 'simulari', motiv: 'modelul de subiect' };
  if (/\btest(e|ul)? (de )?antrenament\b|\btest \d/.test(tf)) return { subcategory: bac ? 'teste-antrenament' : 'variante', motiv: 'test de antrenament' };
  if (/\bvarianta\b|\bvariante\b|\brezerva\b|\bsesiunea\b|\bmodel(ul)?\b|\bvar \d|\bsubiect(e)? oficial/.test(tf)) return { subcategory: 'variante', motiv: 'variantă / model' };
  if (cap) return { subcategory: 'capitole', motiv: `capitolul „${cap.titlu}"` };
  if (subiect) return { subcategory: bac ? 'exercitii' : 'exercitii-subiecte', motiv: '„Subiectul …" în titlu' };
  return { subcategory: '', motiv: null };
}

// Capitolul din site în care intră materialul (null = lista nu e pe capitole sau
// titlul nu spune capitolul → „Alte exerciții / Alte fișe")
export function capitolulNou({ title, category, subcategory }) {
  if (!rubricaPeCapitole(category, subcategory)) return null;
  return capitolDin(title, category);
}
