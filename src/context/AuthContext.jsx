import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { supabase } from '../lib/supabase';

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
      } else {
        setProfile(data);
      }
    } catch (err) {
      console.error('Profile fetch error:', err);
      setProfile(null);
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
      if (event === 'SIGNED_IN') {
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

  async function signUp(email, password, fullName, accountType) {
    const metadata = { full_name: fullName };
    if (accountType === 'elev' || accountType === 'profesor') {
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

  return (
    <AuthContext.Provider value={{
      user, profile, loading, isPremium, isAdmin, isTeacher, isStudent,
      signUp, signIn, signInWithGoogle, signInWithDiscord, signOut, fetchProfile
    }}>
      {children}
    </AuthContext.Provider>
  );
}

export const useAuth = () => useContext(AuthContext);
