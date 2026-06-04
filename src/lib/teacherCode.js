import { supabase } from './supabase';

// Alfabet fără caractere ambigue (fără I, O, 0, 1) — ușor de citit/dictat.
const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

// Generează un cod aleator (implicit 8 caractere).
export function randomCode(len = 8) {
  let out = '';
  const cryptoObj = typeof window !== 'undefined' ? (window.crypto || window.msCrypto) : null;
  if (cryptoObj?.getRandomValues) {
    const arr = new Uint32Array(len);
    cryptoObj.getRandomValues(arr);
    for (let i = 0; i < len; i++) out += ALPHABET[arr[i] % ALPHABET.length];
  } else {
    for (let i = 0; i < len; i++) out += ALPHABET[Math.floor(Math.random() * ALPHABET.length)];
  }
  return out;
}

// Normalizează un cod introdus de utilizator (din link sau tastat manual).
export function normalizeCode(code) {
  return String(code || '').trim().toUpperCase().replace(/[^A-Z0-9]/g, '');
}

// Atribuie un teacher_code unic profilului dat, reîncercând dacă apare o coliziune.
// `extra` permite setarea simultană a altor câmpuri (ex: { role: 'profesor' }).
export async function assignTeacherCode(userId, extra = {}) {
  for (let attempt = 0; attempt < 6; attempt++) {
    const code = randomCode(8);
    const { error } = await supabase
      .from('profiles')
      .update({ ...extra, teacher_code: code })
      .eq('id', userId);

    if (!error) return code;
    // 23505 = unique_violation → încearcă alt cod
    if (error.code !== '23505') throw error;
  }
  throw new Error('Nu s-a putut genera un cod unic. Încearcă din nou.');
}
