-- Actualizează trigger-ul pentru a salva avatar_url și full_name din Google
-- Rulează în Supabase → SQL Editor

CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO public.profiles (id, full_name, email, avatar_url)
  VALUES (
    NEW.id,
    COALESCE(
      NEW.raw_user_meta_data->>'full_name',
      NEW.raw_user_meta_data->>'name'
    ),
    NEW.email,
    NEW.raw_user_meta_data->>'avatar_url'
  )
  ON CONFLICT (id) DO UPDATE SET
    full_name = COALESCE(
      EXCLUDED.full_name,
      profiles.full_name
    ),
    avatar_url = COALESCE(
      EXCLUDED.avatar_url,
      profiles.avatar_url
    );
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

-- Actualizează profilurile existente cu datele din Google
UPDATE public.profiles p
SET
  full_name = COALESCE(p.full_name, u.raw_user_meta_data->>'name', u.raw_user_meta_data->>'full_name'),
  avatar_url = COALESCE(p.avatar_url, u.raw_user_meta_data->>'avatar_url')
FROM auth.users u
WHERE p.id = u.id
  AND (p.full_name IS NULL OR p.avatar_url IS NULL);
