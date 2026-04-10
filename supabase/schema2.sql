-- =====================================================
-- ExamenMate – Supabase Database Setup
-- Rulează acest SQL în Supabase → SQL Editor → New Query
-- =====================================================

-- 1. Tabela de profiluri utilizatori
CREATE TABLE IF NOT EXISTS public.profiles (
  id UUID REFERENCES auth.users(id) ON DELETE CASCADE PRIMARY KEY,
  full_name TEXT,
  email TEXT,
  subscription_status TEXT DEFAULT 'inactive' CHECK (subscription_status IN ('active', 'inactive')),
  stripe_customer_id TEXT,
  subscription_id TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- 2. Creare automată profil la înregistrare
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO public.profiles (id, full_name, email)
  VALUES (
    NEW.id,
    NEW.raw_user_meta_data->>'full_name',
    NEW.email
  );
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Trigger: la fiecare user nou, se creează profilul
DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- 3. Tabela de conținut (exerciții, teste, manuale)
CREATE TABLE IF NOT EXISTS public.content (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  title TEXT NOT NULL,
  description TEXT,
  category TEXT NOT NULL CHECK (category IN ('clasa-5', 'clasa-6', 'clasa-7', 'clasa-8', 'evaluare-nationala', 'bacalaureat', 'manuale')),
  content_type TEXT NOT NULL CHECK (content_type IN ('pdf', 'interactive', 'manual')),
  is_free BOOLEAN DEFAULT false,
  file_url TEXT,            -- URL fișier PDF din Supabase Storage
  interactive_data JSONB,   -- Date pentru exerciții interactive
  manual_content TEXT,      -- Conținut manual online (HTML/Markdown)
  sort_order INTEGER DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- 4. Row Level Security (RLS)
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.content ENABLE ROW LEVEL SECURITY;

-- Politici pentru profiles
CREATE POLICY "Users can view own profile"
  ON public.profiles FOR SELECT
  USING (auth.uid() = id);

CREATE POLICY "Users can update own profile"
  ON public.profiles FOR UPDATE
  USING (auth.uid() = id);

-- Politici pentru content
-- CORECȚIE: Conținutul gratuit e vizibil pentru TOȚI (inclusiv vizitatori neautentificați)
CREATE POLICY "Free content visible to everyone"
  ON public.content FOR SELECT
  USING (is_free = true);

-- Conținutul premium: vizibil doar pentru abonați activi
CREATE POLICY "Premium content visible to subscribers"
  ON public.content FOR SELECT
  USING (
    is_free = false
    AND auth.role() = 'authenticated'
    AND EXISTS (
      SELECT 1 FROM public.profiles
      WHERE id = auth.uid()
      AND subscription_status = 'active'
    )
  );

-- Politică pentru service role (funcții serverless)
CREATE POLICY "Service role full access to profiles"
  ON public.profiles FOR ALL
  USING (auth.role() = 'service_role');

CREATE POLICY "Service role full access to content"
  ON public.content FOR ALL
  USING (auth.role() = 'service_role');

-- 5. Index-uri pentru performanță
CREATE INDEX IF NOT EXISTS idx_content_category ON public.content(category);
CREATE INDEX IF NOT EXISTS idx_content_type ON public.content(content_type);
CREATE INDEX IF NOT EXISTS idx_content_free ON public.content(is_free);
CREATE INDEX IF NOT EXISTS idx_profiles_stripe ON public.profiles(stripe_customer_id);

-- 6. Storage bucket pentru fișiere PDF
INSERT INTO storage.buckets (id, name, public)
VALUES ('content-files', 'content-files', false)
ON CONFLICT (id) DO NOTHING;

-- Politică storage: download permis pentru utilizatori autentificați
CREATE POLICY "Authenticated users can download files"
  ON storage.objects FOR SELECT
  USING (
    bucket_id = 'content-files'
    AND auth.role() = 'authenticated'
  );

-- Upload permis doar de admin (service role)
CREATE POLICY "Service role can upload files"
  ON storage.objects FOR INSERT
  WITH CHECK (
    bucket_id = 'content-files'
    AND auth.role() = 'service_role'
  );
