// =====================================================================
// src/lib/cautare.js — căutarea din bara de sus (src/components/Navbar.jsx):
// unde duce fiecare rezultat și cine a scris o discuție. Pur — testat în
// test/cautare.test.js.
// 12 nov. 2026: o rezolvare găsită ducea la pagina /rezolvari întreagă (o căutai
// încă o dată acolo), articolele de blog nu apăreau deloc, iar la discuții
// autorul era mereu „Utilizator" (numele nu se cerea niciodată).
// =====================================================================

// Adresa la care duce un rezultat (null = materialele din `content`, care se
// deschid cu openItem — au nevoie de verificarea accesului).
export function tintaRezultat(item) {
  if (!item) return null;
  if (item._type === 'articol') return item.slug ? `/rezolvari/${item.slug}` : '/rezolvari';
  if (item._type === 'rezolvare') return item.title ? `/rezolvari?q=${encodeURIComponent(item.title)}` : '/rezolvari';
  if (item._type === 'public') return `/biblioteca-utilizatorilor?q=${encodeURIComponent(item.title || '')}`;
  return null;
}

// Pune numele autorului pe fiecare discuție (din rândurile `profiles` cerute
// separat). Fără nume → `autor: null`, iar eticheta nu mai inventează unul.
export function cuAutori(discutii, profile) {
  const nume = new Map((profile || []).filter((p) => p && p.id).map((p) => [p.id, String(p.full_name || '').trim()]));
  return (discutii || []).map((d) => ({ ...d, autor: nume.get(d.user_id) || null }));
}

export function eticDiscutie(item) {
  return item && item.autor ? `💬 Discuții · ${item.autor}` : '💬 Discuții';
}

// Textul de căutare din adresă (/rezolvari?q=…), cel mult 120 de caractere
export function cautareDinAdresa(search) {
  const q = new URLSearchParams(search || '').get('q');
  return q == null ? null : q.slice(0, 120);
}
