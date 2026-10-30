// =====================================================================
// src/lib/statistici.js — ce are nevoie panoul „📊 Statistici de utilizare"
// (src/components/AdminStatistici.jsx), fără React: numele prietenoase ale
// paginilor și ale funcțiilor AI, zilele fără vizite (0) și formatarea în
// română. Pur — testat în test/statistici-utilizare.test.js.
// =====================================================================

const CLASE = { 5: 'a V-a', 6: 'a VI-a', 7: 'a VII-a', 8: 'a VIII-a', 9: 'a IX-a', 10: 'a X-a', 11: 'a XI-a', 12: 'a XII-a' };
const PAGINI = {
  '/': 'Acasă', '/evaluare-nationala': 'Evaluare Națională', '/bacalaureat': 'Bacalaureat', '/manuale': 'Auxiliare',
  '/profesor-virtual': 'Profesor Virtual', '/meditatii': 'Meditații live (lobby)', '/meditatii/plan': 'Meditații · Planul meu',
  '/meditatii/pregatire': 'Pregătirea de examen', '/arena': 'Arena matematică', '/arena/harta': 'Harta capitolelor',
  '/exercitiu': 'Exercițiu interactiv', '/exercitiu-ai': 'Exercițiu generat (AI)', '/pdf-viewer': 'PDF cu Profesorul Virtual',
  '/profil': 'Contul meu', '/preturi': 'Prețuri', '/rezolvari': 'Rezolvări', '/discutii': 'Discuții',
  '/biblioteca-utilizatorilor': 'Biblioteca utilizatorilor', '/recenzii': 'Recenzii', '/mesagerie': 'Mesagerie',
  '/autentificare': 'Autentificare', '/inregistrare': 'Înregistrare', '/contact': 'Contact', '/faq': 'Întrebări frecvente',
  '/despre-noi': 'Despre noi', '/tema': 'Temă (de la profesor)', '/tema-grupa': 'Test pe grupă', '/tema-elev': 'Temele elevului',
};
export function numePagina(p) {
  const s = String(p || '');
  if (PAGINI[s]) return PAGINI[s];
  let m = /^\/clase\/clasa-(\d+)$/.exec(s);
  if (m) return `Clasa ${CLASE[m[1]] || m[1]}`;
  m = /^\/bacalaureat\/(.+)$/.exec(s);
  if (m) return `Bacalaureat · ${m[1]}`;
  m = /^\/rezolvari\/(.+)$/.exec(s);
  if (m) return `Rezolvare · ${m[1].replace(/-/g, ' ')}`;
  if (s.startsWith('/meditatii/sala/')) return 'Sala unei meditații live';
  return s;
}
export function numeFunctieAI(f) {
  const s = String(f || '');
  if (s === 'ai-chat' || s === 'ai-chat-stream') return '💬 Chat cu Profesorul Virtual';
  if (s === 'ai-correct') return '📝 Corectarea testelor';
  if (s === 'ai-exam') return '📄 Subiecte de examen generate';
  if (s === 'ai-generate-interactive') return '🧩 Teste / exerciții generate';
  if (s === 'ai-vision') return '📷 Foto-rezolvări';
  if (s === 'ai-meditatii') return '🎓 Meditații cu Prof. Virtual';
  if (s === 'ai-practice') return '✍️ Antrenament';
  if (s === 'ai-handwriting') return '✍️ Corectarea scrisului de mână';
  if (s === 'ai-transcribe') return '🎤 Dictare';
  if (s === 'ai-assignment') return '📤 Teme trimise elevilor';
  if (s === 'ai-public') return '🏛️ Biblioteca utilizatorilor';
  if (s.startsWith('voce')) return '🔊 Vocea profesorului (lecții live)';
  if (s.startsWith('live')) return '🔴 Meditații live';
  if (/agent|seo|debug|content-check/.test(s)) return `🛠 Unelte de admin (${s})`;
  return s || '—';
}
export const ROLURI = { elev: 'elevi', profesor: 'profesori', parinte: 'părinți', nesetat: 'fără rol' };
// „1 elev", „2 elevi", „20 de elevi" — numeralul acordat (rolurile și „utilizator")
const FORME = {
  elev: ['elev', 'elevi'], profesor: ['profesor', 'profesori'], parinte: ['părinte', 'părinți'],
  utilizator: ['utilizator', 'utilizatori'], nesetat: ['cont fără rol', 'conturi fără rol'],
};
export function nr(n, cuvant) {
  const k = Number(n) || 0;
  const [unu, multe] = FORME[cuvant] || [cuvant, cuvant];
  if (k === 1) return `1 ${unu}`;
  const deLa = k % 100 >= 20 || (k >= 100 && k % 100 === 0);  // „20 de elevi", „100 de elevi"
  return `${k.toLocaleString('ro-RO')} ${deLa ? 'de ' : ''}${multe}`;
}
export const fmt = (n) => (n == null ? '—' : Number(n).toLocaleString('ro-RO'));
export const fmtZi = (d) => { try { return new Date(`${d}T12:00:00Z`).toLocaleDateString('ro-RO', { day: 'numeric', month: 'short' }); } catch { return d; } };
export const fmtCand = (t) => { try { return new Date(t).toLocaleString('ro-RO', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }); } catch { return ''; } };

// zilele perioadei, inclusiv cele fără vizite (0)
export function zileComplete(peZile, deLa, panaLa) {
  const map = new Map((peZile || []).map((z) => [String(z.zi).slice(0, 10), z]));
  const out = [];
  const zi = (d) => new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Bucharest', year: 'numeric', month: '2-digit', day: '2-digit' }).format(d);
  const start = new Date(deLa || Date.now() - 29 * 86400000);
  const end = new Date(panaLa || Date.now());
  for (let t = start.getTime(); t <= end.getTime() + 1000; t += 86400000) {
    const k = zi(new Date(t));
    if (out.length && out[out.length - 1].zi === k) continue;
    const z = map.get(k);
    out.push({ zi: k, vizualizari: z ? z.vizualizari : 0, utilizatori: z ? z.utilizatori : 0 });
  }
  const ultima = zi(end);
  if (out.length && out[out.length - 1].zi !== ultima) {
    const z = map.get(ultima);
    out.push({ zi: ultima, vizualizari: z ? z.vizualizari : 0, utilizatori: z ? z.utilizatori : 0 });
  }
  return out;
}

