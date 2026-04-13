-- Funcție care permite unui utilizator autentificat să își șteargă propriul cont
-- Rulează în Supabase → SQL Editor → New Query

CREATE OR REPLACE FUNCTION public.delete_user_account()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER -- rulează cu privilegii de admin, nu ale userului curent
SET search_path = public
AS $$
DECLARE
  calling_user_id UUID;
BEGIN
  -- Obținem ID-ul userului autentificat curent
  calling_user_id := auth.uid();

  IF calling_user_id IS NULL THEN
    RAISE EXCEPTION 'Trebuie să fii autentificat pentru a șterge contul.';
  END IF;

  -- Ștergem profilul (CASCADE va șterge și datele asociate)
  DELETE FROM public.profiles WHERE id = calling_user_id;

  -- Ștergem userul din auth.users (necesită SECURITY DEFINER)
  DELETE FROM auth.users WHERE id = calling_user_id;
END;
$$;

-- Acordăm permisiunea de execuție utilizatorilor autentificați
GRANT EXECUTE ON FUNCTION public.delete_user_account() TO authenticated;
