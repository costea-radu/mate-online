// =====================================================================
// src/lib/siteTests.js — regulile listei „🧩 Teste din site" (SitePicker.jsx)
//
// Pur (fără React, fără rețea) — se testează direct în Node:
//   levelOf(profile, fallbackCategory) → { cat, prof, label } nivelul elevului
//   sortInteractive(rows, cat)          → interactivele pe care le ARATĂ site-ul,
//                                          teste → exerciții pe subiecte → capitole
//   foldRo(text)                        → text fără diacritice, pentru căutare
// =====================================================================
import { visibleTypesFor } from './contentMeta.js';

export const PDF_SUBCAT_RO = {
  simulari: '🎯 Simulări', variante: '📋 Variante date + modele', 'teste-antrenament': '🏋 Teste de antrenament',
  'exercitii-subiecte': '📝 Exerciții pe subiecte', exercitii: '📝 Exerciții pe subiecte', capitole: '📚 Capitole',
};
export const INTER_SUBCAT_RO = {
  'teste-interactive': '🧩 Test interactiv', 'exercitii-subiecte': '📝 Exerciții pe subiecte',
  exercitii: '📝 Exerciții pe subiecte', capitole: '📚 Capitole',
};
export const PROFILE_RO = { 'mate-info': 'Mate-Info', 'stiinte-naturii': 'Șt. Naturii', tehnologic: 'Tehnologic' };
// ordinea interactivelor: întâi testele, apoi exercițiile pe subiecte, apoi capitolele
const INTER_ORDER = { 'teste-interactive': 0, 'exercitii-subiecte': 1, exercitii: 1, capitole: 2 };

// căutarea merge și fără diacritice („judeteana" găsește „județeană")
export const foldRo = (t) => String(t || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');

// Nivelul elevului (profilul de meditații) → categoria testelor din site și,
// la BAC, profilul. Fără profil: categoria paginii (rezervă) sau null.
export function levelOf(profile, fallbackCategory = null) {
  const p = profile || {};
  if (p.examTarget === 'evaluare-nationala') return { cat: 'evaluare-nationala', prof: null, label: 'Evaluarea Națională' };
  if (p.examTarget === 'bac-mate-info') return { cat: 'bacalaureat', prof: 'mate-info', label: 'BAC Mate-Info' };
  if (p.examTarget === 'bac-stiinte') return { cat: 'bacalaureat', prof: 'stiinte-naturii', label: 'BAC Științele Naturii' };
  if (p.examTarget === 'bac-tehnologic') return { cat: 'bacalaureat', prof: 'tehnologic', label: 'BAC Tehnologic' };
  if (p.grade) return { cat: `clasa-${p.grade}`, prof: null, label: `clasa a ${p.grade}-a` };
  const cat = fallbackCategory;
  if (!cat) return null;
  return {
    cat, prof: null,
    label: cat === 'evaluare-nationala' ? 'Evaluarea Națională' : cat === 'bacalaureat' ? 'Bacalaureat'
      : cat.startsWith('clasa-') ? `clasa a ${cat.replace('clasa-', '')}-a` : cat,
  };
}

// Interactivele pe care site-ul chiar le ARATĂ (rubrica lor le afișează), în
// ordinea: teste → exerciții pe subiecte → capitole; în rest, ordinea site-ului.
export function sortInteractive(rows, cat) {
  return (rows || [])
    .filter((r) => visibleTypesFor(cat, r.subcategory).includes('interactive'))
    .map((r, i) => ({ r, i }))
    .sort((a, b) => ((INTER_ORDER[a.r.subcategory] ?? 3) - (INTER_ORDER[b.r.subcategory] ?? 3)) || (a.i - b.i))
    .map((x) => x.r);
}
