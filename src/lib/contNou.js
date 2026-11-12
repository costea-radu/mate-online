// =====================================================================
// src/lib/contNou.js — CONT NOU PRIN GOOGLE / DISCORD → evenimentul „sign_up"
// (GA4, Meta, TikTok).
//
// Până pe 11 nov. 2026 evenimentul pleca doar din formularul cu e-mail
// (Register.jsx), deși cele mai multe conturi se fac cu Google: reclamele
// (TikTok, Meta) nu vedeau aceste înregistrări și nu aveau pe ce să se
// optimizeze. Un cont e „nou" dacă a fost creat în ultimele 10 minute; se
// trimite o singură dată per cont și dispozitiv. Apelat din AuthContext, la
// SIGNED_IN. Pură (primește funcția de trimitere) — testată în
// test/scor-in-asteptare.test.js.
// =====================================================================
export const CONT_NOU_MS = 10 * 60000;

export function contNouPrinOAuth(u, { now = Date.now(), storage = null, trimite = null } = {}) {
  try {
    const furnizor = u && u.app_metadata && u.app_metadata.provider;
    if (!u || !u.id || !furnizor || furnizor === 'email' || typeof trimite !== 'function') return false;
    const creat = new Date(u.created_at).getTime();
    if (!Number.isFinite(creat) || now - creat > CONT_NOU_MS || now - creat < -60000) return false;
    const st = storage || window.localStorage;
    const cheie = `em_signup_${u.id}`;
    if (st.getItem(cheie)) return false;
    st.setItem(cheie, '1');
    trimite(furnizor);
    return true;
  } catch { return false; }
}
