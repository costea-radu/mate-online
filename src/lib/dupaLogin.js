// =====================================================================
// src/lib/dupaLogin.js — unde ajunge un cont după autentificare
//
// 15 nov. 2026 (seara, a doua cerere): „fă ca orice tip de utilizator la conectare să intre
// în Home" (înlocuiește „elevul ajunge la Pregătește-mă", de mai devreme în aceeași seară).
//   · email + parolă (src/pages/Login.jsx): oricine — elev, profesor, părinte, admin — ajunge
//     în Home (/);
//   · Google / Discord: Supabase întoarce contul la /profil (adresa de întoarcere rămâne
//     aceeași — acolo se termină onboarding-ul); înainte de plecare marcăm autentificarea
//     (sessionStorage — rămâne în același tab), iar <DupaLogin /> (în src/App.jsx) mută contul
//     de acolo în Home.
// Excepții (rămân la /profil): un tip de cont sau o asociere cu profesorul în așteptare (se
// aplică acolo) și contul fără rol încă (își alege rolul acolo).
// =====================================================================
import { useEffect } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { supabase } from './supabase';
import { useAuth } from '../context/AuthContext';

export const CHEIE_DUPA_LOGIN = 'em_dupa_login';
export const ACASA = '/';
const PROASPAT_MS = 10 * 60 * 1000;

export function marcheazaLogin() {
  try { sessionStorage.setItem(CHEIE_DUPA_LOGIN, String(Date.now())); } catch { /* fără stocare */ }
}

// onboarding în așteptare (OAuth: tipul de cont; linkul de asociere cu profesorul)
export function areOnboarding() {
  try { return !!(localStorage.getItem('pending_account_type') || localStorage.getItem('pending_teacher_code')); } catch { return false; }
}

// oricine are rol ajunge în Home; contul fără rol încă își alege rolul în /profil
export const destinatiePentru = (role) => (role ? ACASA : '/profil');

// după email + parolă: Home (fără să aștepte AuthContext); onboarding-ul rămâne în /profil
export async function destinatieDupaLogin(userId) {
  if (!userId || areOnboarding()) return '/profil';
  try {
    const { data } = await supabase.from('profiles').select('role').eq('id', userId).maybeSingle();
    return destinatiePentru(data && data.role);
  } catch { return ACASA; }
}

// după Google / Discord: o singură dată, din /profil, orice cont cu rol
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
    if (profile.role && pathname === '/profil') navigate(ACASA, { replace: true });
  }, [loading, user, profile, pathname, navigate]);
  return null;
}
