-- MB Portal: Users table
-- Yeh Supabase SQL Editor mein run karo

CREATE TABLE IF NOT EXISTS public.users (
  id          UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  name        TEXT,
  email       TEXT,
  role        TEXT DEFAULT 'user',
  dashboards  TEXT[] DEFAULT '{}',
  created_at  TIMESTAMPTZ DEFAULT NOW()
);

-- RLS enable karo (security ke liye)
ALTER TABLE public.users ENABLE ROW LEVEL SECURITY;

-- Admin sabko dekh/edit kar sake
CREATE POLICY "Admin full access" ON public.users
  USING (
    EXISTS (
      SELECT 1 FROM public.users
      WHERE id = auth.uid() AND role = 'admin'
    )
  );

-- Har user apna record dekh sake
CREATE POLICY "Users can read own" ON public.users
  FOR SELECT USING (auth.uid() = id);

-- Apna admin account insert karo
-- (Pehle Supabase Auth mein user banao, phir yahan UID daalo)
-- INSERT INTO public.users (id, name, email, role, dashboards)
-- VALUES ('YOUR-UID-HERE', 'Ajay', 'Ajay.aj@margerp.net', 'admin', '{}');
