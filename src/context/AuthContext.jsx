import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { supabase } from '../lib/supabase';
import { getValidSession } from '../lib/api';

const AuthContext = createContext({});

// Schimbă această valoare pentru a forța TOȚI utilizatorii să se autentifice din nou
// (o singură dată per dispozitiv) — de ex. după o resetare majoră a conturilor.
// La următoarea încărcare a aplicației, sesiunile mai vechi sunt deconectate automat.
const FORCE_RELOGIN_TOKEN = '2026-06-04';

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [profile, setProfile] = useState(null);
  const [loading, setLoading] = useState(true);
  const fetchedForSession = useRef(null);
  const forcedRef = useRef(false);

  const fetchProfile = useCallback(async (userId) => {
    try {
      const { data, error } = await supabase
        .from('profiles')
        .select('*')
        .eq('id', userId)
        .single();

      if (error) {
        console.warn('Profile not found for user:', userId, error.message);
        setProfile(null);
        return null;
      }
      setProfile(data);
      return data; // întoarce profilul (folosit ex. la poll-ul de după checkout)
    } catch (err) {
      console.error('Profile fetch error:', err);
      setProfile(null);
      return null;
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    const FORCE_KEY = `relogin_done_${FORCE_RELOGIN_TOKEN}`;

    // Returnează true dacă a fost forțată deconectarea (apelantul se oprește).
    function gateSession(session) {
      if (!session) return false;
      if (forcedRef.current) return true; // deconectare deja forțată — ignoră sesiunea reziduală
      let done = false;
      try { done = localStorage.getItem(FORCE_KEY) === '1'; } catch { /* ignore */ }
      if (done) return false; // sesiune deja reînnoită după resetare
      // Sesiune veche → forțează o deconectare unică pe acest dispozitiv.
      forcedRef.current = true;
      try { localStorage.setItem(FORCE_KEY, '1'); } catch { /* ignore */ }
      supabase.auth.signOut();
      setUser(null);
      setProfile(null);
      fetchedForSession.current = null;
      setLoading(false);
      return true;
    }

    supabase.auth.getSession().then(({ data: { session } }) => {
      if (gateSession(session)) return;
      setUser(session?.user ?? null);
      if (session?.user) {
        fetchedForSession.current = session.user.id;
        fetchProfile(session.user.id);
      } else {
        setLoading(false);
      }
    });

    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
      // Autentificare nouă → marcăm dispozitivul drept reconectat (nu mai forțăm deconectarea).
      // PASSWORD_RECOVERY = sesiune creată din linkul „Resetare parolă" — o tratăm la fel,
      // altfel gate-ul de mai jos ar deconecta utilizatorul chiar când vrea să-și schimbe parola.
      if (event === 'SIGNED_IN' || event === 'PASSWORD_RECOVERY') {
        forcedRef.current = false;
        try { localStorage.setItem(FORCE_KEY, '1'); } catch { /* ignore */ }
      }
      if (gateSession(session)) return;

      const newUserId = session?.user?.id ?? null;
      setUser(session?.user ?? null);

      if (session?.user) {
        if (fetchedForSession.current !== newUserId) {
          fetchedForSession.current = newUserId;
          fetchProfile(newUserId);
        }
      } else {
        fetchedForSession.current = null;
        setProfile(null);
        setLoading(false);
      }
    });

    return () => subscription.unsubscribe();
  }, [fetchProfile]);

  // PING DE ACTIVITATE — politica de conturi inactive (12 luni → avertizare,
  // +30 zile → ștergere). Orice sesiune validă actualizează last_active_at și
  // ANULEAZĂ o eventuală ștergere programată, deci simpla autentificare
  // salvează contul. Throttle: cel mult o dată la 12 ore per dispozitiv;
  // cheia se scrie DOAR după o actualizare reușită (offline → reîncercăm).
  useEffect(() => {
    if (!user?.id) return;
    const PING_KEY = 'em_activity_ping';
    let last = 0;
    try { last = Number(localStorage.getItem(PING_KEY) || 0); } catch { /* ignore */ }
    if (Date.now() - last < 12 * 3600 * 1000) return;
    supabase
      .from('profiles')
      .update({
        last_active_at: new Date().toISOString(),
        deletion_warned_at: null,
        deletion_reminded_at: null,
        deletion_scheduled_at: null,
      })
      .eq('id', user.id)
      .then(({ error }) => {
        if (error) {
          // coloanele apar după rularea supabase/inactive_accounts.sql
          console.warn('Ping activitate eșuat:', error.message);
        } else {
          try { localStorage.setItem(PING_KEY, String(Date.now())); } catch { /* ignore */ }
        }
      });
  }, [user?.id]);

  // Reîmprospătează proactiv sesiunea când utilizatorul revine în tab / revine
  // online, ca tokenul să nu fie expirat la următoarea acțiune sau interogare
  // directă Supabase (altfel PostgREST respinge JWT-ul expirat cu 401).
  useEffect(() => {
    const check = () => { if (document.visibilityState === 'visible') getValidSession(); };
    document.addEventListener('visibilitychange', check);
    window.addEventListener('online', check);
    window.addEventListener('focus', check);
    return () => {
      document.removeEventListener('visibilitychange', check);
      window.removeEventListener('online', check);
      window.removeEventListener('focus', check);
    };
  }, []);

  async function signUp(email, password, fullName, accountType) {
    const metadata = { full_name: fullName };
    if (accountType === 'elev' || accountType === 'profesor' || accountType === 'parinte') {
      metadata.account_type = accountType;
    }
    const { data, error } = await supabase.auth.signUp({
      email,
      password,
      options: { data: metadata }
    });
    if (error) throw error;
    return data;
  }

  async function signIn(email, password) {
    const { data, error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) throw error;
    return data;
  }

  // „Am uitat parola": Supabase trimite emailul de resetare (prin SMTP-ul
  // configurat — admin.examenmate@gmail.com), cu link către /resetare-parola.
  // URL-ul trebuie să fie în Supabase → Authentication → URL Configuration → Redirect URLs.
  async function resetPassword(email) {
    const { error } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: `${window.location.origin}/resetare-parola`,
    });
    if (error) throw error;
  }

  async function signInWithGoogle() {
    const { error } = await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: { redirectTo: `${window.location.origin}/profil` },
    });
    if (error) throw error;
  }

  async function signInWithDiscord() {
    const { error } = await supabase.auth.signInWithOAuth({
      provider: 'discord',
      options: { redirectTo: `${window.location.origin}/profil` },
    });
    if (error) throw error;
  }

  async function signOut() {
    await supabase.auth.signOut();
    setUser(null);
    setProfile(null);
    fetchedForSession.current = null;
  }

  const isPremium = profile?.subscription_status === 'active';
  const isAdmin = profile?.is_admin === true;
  const isTeacher = profile?.role === 'profesor';
  const isStudent = profile?.role === 'elev';
  const isParent = profile?.role === 'parinte';
  const isMentor = isTeacher || isParent;

  return (
    <AuthContext.Provider value={{
      user, profile, loading, isPremium, isAdmin, isTeacher, isStudent, isParent, isMentor,
      signUp, signIn, signInWithGoogle, signInWithDiscord, signOut, fetchProfile, resetPassword
    }}>
      {children}
    </AuthContext.Provider>
  );
}

export const useAuth = () => useContext(AuthContext);
