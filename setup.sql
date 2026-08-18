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

-- ===========================================================================
-- ticket_cache  (dashboards ka data cache)
-- ---------------------------------------------------------------------------
-- Ye table pehle sirf manually bana tha, setup.sql me NAHI tha — isliye ek
-- fresh environment setup.sql se poora provision nahi hota tha. Ab yahan hai.
--
-- Ek row PER date_from window (nightly matrix me ek row per saal):
--   date_from='2023-04-01', '2024-01-01', '2025-01-01', '2026-01-01' ...
--
-- LIKHNE WALE sirf do hain, dono service key se:
--   1. .github/scripts/fetch_tickets.py  (writer='nightly')
--   2. api/ticket-cache.js               (writer='<page>-dashboard')
-- Browser SIRF PADHTA hai — neeche RLS me sirf SELECT policy hai.
--
-- NOTE: agar tumhara ticket_cache pehle se maujood hai (production), to ye
-- CREATE TABLE skip ho jayega. Us case me naye columns + unique constraint +
-- RLS ke liye `sql/2026-08-ticket-cache-hardening.sql` chalao.
-- ===========================================================================
CREATE TABLE IF NOT EXISTS public.ticket_cache (
  id             BIGSERIAL PRIMARY KEY,
  data           JSONB       NOT NULL,
  total_count    INTEGER,
  date_from      DATE        NOT NULL,
  date_to        DATE,
  fetched_at     TIMESTAMPTZ DEFAULT NOW(),
  -- payload ka field-set version (assets/ticket-parser.js ka MB_SCHEMA_VERSION)
  schema_version INTEGER,
  -- {"total":N,"tia":N,"ld":N,"rtd":N,"st":N} — regression guard ke liye
  field_counts   JSONB,
  -- nightly / marg-dashboard / support-dashboard / api-dashboard (audit)
  writer         TEXT
);

-- Atomic upsert ke liye ZAROORI. Iske bina PostgREST ka
-- on_conflict=date_from fail karta hai (nightly aur api/ticket-cache dono).
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'ticket_cache_date_from_key'
  ) THEN
    ALTER TABLE public.ticket_cache
      ADD CONSTRAINT ticket_cache_date_from_key UNIQUE (date_from);
  END IF;
END $$;

-- RLS: browser READ-ONLY. INSERT/UPDATE/DELETE ke liye koi policy NAHI →
-- anon aur authenticated dono ke liye wo auto-DENY hain. service_role RLS
-- bypass karta hai, isliye nightly job aur api/ticket-cache par koi asar nahi.
ALTER TABLE public.ticket_cache ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "ticket_cache read for all"       ON public.ticket_cache;
DROP POLICY IF EXISTS "ticket_cache: read only for app" ON public.ticket_cache;

CREATE POLICY "ticket_cache: read only for app"
  ON public.ticket_cache
  FOR SELECT
  TO public
  USING (true);


-- ===========================================================================
-- retention_snapshots  (TAT dashboard ka Retention Trend chart)
-- ---------------------------------------------------------------------------
-- ⚠️ Is table par RLS JAANBUJHKAR nahi lagayi gayi hai: marg_ticket_dashboard
-- ka retSnapshotSave() isme BROWSER se hi upsert karta hai. RLS lagane se
-- Retention Trend chart toot jayega.
--
-- Iska matlab: anon key (page source me public hai) se koi bhi is table me
-- likh/mita sakta hai. Isko lock karna ho to pehle wo write bhi ek serverless
-- function ke peeche le jaana padega — ticket_cache jaisa. Tab tak ye ek
-- known open hole hai, security fix pending.
-- ===========================================================================
CREATE TABLE IF NOT EXISTS public.retention_snapshots (
  snap_date  DATE PRIMARY KEY,
  data       JSONB NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
