import { createClient } from '@supabase/supabase-js';

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseAnonKey) {
  throw new Error(
    'Lipsesc variabilele de mediu Supabase. ' +
    'Asigură-te că ai setat VITE_SUPABASE_URL și VITE_SUPABASE_ANON_KEY în fișierul .env'
  );
}

export const supabase = createClient(supabaseUrl, supabaseAnonKey);
