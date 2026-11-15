// =====================================================================
// src/lib/dupaLogin.js — unde ajunge un cont după autentificare (15 nov. 2026, seara)
//
// Cererea: „când se conectează un elev, fă să ajungă în home la pregătește-mă".
//   · email + parolă (src/pages/Login.jsx): elevul merge direct la /pregateste-ma,
//     ceilalți la /profil, ca înainte;
//   · Google / Discord: Supabase întoarce contul la /profil; înainte de plecare marcăm
//     autentificarea (sessionStorage — rămâne în același tab), iar <DupaLogin /> (în
//     src/App.jsx) mută elevul de acolo la /pregateste-ma.
// Excepții: un tip de cont sau o asociere cu profesorul în așteptare (se aplică în /profil)
// și contul fără rol încă (își alege rolul în /profil) — rămân la /profil.
// =====================================================================
import { useEffect } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { supabase } from './supabase';
import { useAuth } from '../context/AuthContext';

export const CHEIE_DUPA_LOGIN = 'em_dupa_login';
export const ACASA_ELEV = '/pregateste-ma';
const PROASPAT_MS = 10 * 60 * 1000;

export function marcheazaLogin() {
  try { sessionStorage.setItem(CHEIE_DUPA_LOGIN, String(Date.now())); } catch { /* fără stocare */ }
}

// onboarding în așteptare (OAuth: tipul de cont; linkul de asociere cu profesorul)
export function areOnboarding() {
  try { return !!(localStorage.getItem('pending_account_type') || localStorage.getItem('pending_teacher_code')); } catch { return false; }
}

export const destinatiePentru = (role) => (role === 'elev' ? ACASA_ELEV : '/profil');

// după email + parolă: rolul din profil decide (fără să aștepte AuthContext)
export async function destinatieDupaLogin(userId) {
  if (!userId || areOnboarding()) return '/profil';
  try {
    const { data } = await supabase.from('profiles').select('role').eq('id', userId).maybeSingle();
    return destinatiePentru(data && data.role);
  } catch { return '/profil'; }
}

// după Google / Discord: o singură dată, din /profil, doar elevii
export function DupaLogin() {
  const { user, profile, loading } = useAuth();
  const { pathname } = useLocation();
  const navigate = useNavigate();
  useEffect(() => {
    if (loading || !user || !profile) return;
    let t = null;
    try { t = sessionStorage.getItem(CHEIE_DUPA_LOGIN); } catch { /* fără stocare */ }
    if (!t) return;
    try { sessionStorage.removeItem(CHEIE_DUPA_LOGIN); } catch { /* fără stocare */ }
    if (Date.now() - Number(t) > PROASPAT_MS || areOnboarding()) return;
    if (profile.role === 'elev' && pathname === '/profil') navigate(ACASA_ELEV, { replace: true });
  }, [loading, user, profile, pathname, navigate]);
  return null;
}
