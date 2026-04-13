-- Fix: trigger care preia corect numele atât pentru email/parolă cât și pentru Google OAuth
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO public.profiles (id, full_name, email)
  VALUES (
    NEW.id,
    COALESCE(
      NEW.raw_user_meta_data->>'full_name',  -- email/parolă
      NEW.raw_user_meta_data->>'name'         -- Google OAuth
    ),
    NEW.email
  );
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
