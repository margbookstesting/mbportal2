-- ===========================================================================
-- MB Portal — BSS Dashboard setup
-- Supabase → SQL Editor me ye POORA file ek baar run karo. Idempotent hai.
-- ---------------------------------------------------------------------------
-- Ye BSS Dashboard (bss_dashboard.html + api/bss-proxy.js) ke liye chahiye.
-- Do cheezein add karta hai:
--   1. users.bss_user_id  — portal user ↔ BSS user mapping
--   2. bss_update_log     — har ticket update ka audit trail
-- ===========================================================================

-- ── 1. users.bss_user_id ───────────────────────────────────────────────────
-- UpdateTicketStatus ko `UpdatedByUser` chahiye — BSS ka apna user ID
-- (BindDropDown ki `Users` list se). Ye per-portal-user map hota hai, Admin →
-- Users screen se.
--
-- ZAROORI: api/bss-proxy.js `UpdatedByUser` HAMESHA yahin se leta hai, client
-- jo bheje use IGNORE karta hai. Warna koi bhi kisi aur ke naam par ticket
-- update kar sakta tha aur audit trail jhootha ho jata.
--
-- Jinka ye NULL hai wo update nahi kar payenge (saaf error milega). Read-only
-- dashboard sabke liye chalega.
ALTER TABLE public.users
  ADD COLUMN IF NOT EXISTS bss_user_id integer;

COMMENT ON COLUMN public.users.bss_user_id IS
  'BSS (Marg) user id — BindDropDown ki Users list se. UpdateTicketStatus ke UpdatedByUser ke liye. NULL = ye user BSS update nahi kar sakta.';


-- ── 2. bss_update_log ──────────────────────────────────────────────────────
-- Ye module PRODUCTION tickets badalta hai, isliye har koshish ka record
-- rakhna zaroori hai — successful aur failed dono.
--
-- `before` isliye hai ki galat update ko manually revert kiya ja sake:
-- usme update se PEHLE ki values hoti hain.
CREATE TABLE IF NOT EXISTS public.bss_update_log (
  id          BIGSERIAL PRIMARY KEY,
  ticket_no   TEXT        NOT NULL,
  actor_id    UUID,                    -- public.users.id (portal user)
  actor_name  TEXT,
  bss_user_id INTEGER,                 -- jo UpdatedByUser me gaya
  payload     JSONB,                   -- Marg ko exactly kya bheja
  before      JSONB,                   -- update se pehle ki values (rollback ke liye)
  success     BOOLEAN     NOT NULL DEFAULT false,
  message     TEXT,                    -- fail hone par Marg ka message
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS bss_update_log_ticket_idx  ON public.bss_update_log (ticket_no);
CREATE INDEX IF NOT EXISTS bss_update_log_created_idx ON public.bss_update_log (created_at DESC);

-- RLS: ticket_cache jaisa hi model — browser sirf PADHTA hai.
-- Likhna sirf api/bss-proxy.js karta hai (service key se, jo RLS bypass karta
-- hai). INSERT/UPDATE/DELETE ke liye koi policy NAHI → anon aur authenticated
-- dono ke liye auto-DENY. Iske bina koi bhi anon key se jhooti audit entry
-- daal sakta tha ya asli entry mita sakta tha — audit log ka matlab hi khatam.
ALTER TABLE public.bss_update_log ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "bss_update_log: read only for app" ON public.bss_update_log;

CREATE POLICY "bss_update_log: read only for app"
  ON public.bss_update_log
  FOR SELECT
  TO authenticated          -- logged-in users hi audit dekh sakte hain
  USING (true);

-- ── 3. Self-check ──────────────────────────────────────────────────────────
DO $$
DECLARE bad text;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema='public' AND table_name='users' AND column_name='bss_user_id'
  ) THEN
    RAISE EXCEPTION 'users.bss_user_id nahi bana — BSS update kaam nahi karega.';
  END IF;

  SELECT string_agg(policyname || ' (' || cmd || ')', ', ') INTO bad
    FROM pg_policies
   WHERE tablename='bss_update_log' AND cmd <> 'SELECT';

  IF bad IS NOT NULL THEN
    RAISE EXCEPTION 'bss_update_log par write policies hain: %. Audit log tamper-proof nahi rahega.', bad;
  END IF;

  RAISE NOTICE 'BSS Dashboard setup OK — users.bss_user_id + bss_update_log ready.';
END $$;

-- ── 4. Verify ──────────────────────────────────────────────────────────────
-- Kis-kis user par BSS id map hai:
--   select name, email, role, bss_user_id, dashboards from public.users order by name;
--
-- Aaj ke updates:
--   select created_at, ticket_no, actor_name, success, message
--     from public.bss_update_log order by created_at desc limit 50;
