-- Populează full_name și avatar_url pentru toți userii existenți
-- Rulează în Supabase → SQL Editor

UPDATE public.profiles p
SET
  full_name = COALESCE(
    NULLIF(p.full_name, ''),
    u.raw_user_meta_data->>'name',
    u.raw_user_meta_data->>'full_name',
    split_part(u.email, '@', 1)
  ),
  avatar_url = COALESCE(
    NULLIF(p.avatar_url, ''),
    u.raw_user_meta_data->>'avatar_url',
    u.raw_user_meta_data->>'picture'
  )
FROM auth.users u
WHERE p.id = u.id;

-- Verifică rezultatul:
SELECT id, full_name, email, avatar_url FROM public.profiles LIMIT 10;
