-- ===========================================================================
-- MB Portal — ticket_cache hardening
-- Supabase → SQL Editor me ye POORA file ek baar run karo.
-- Idempotent hai (dobara chala do to kuch nahi tootega).
-- ---------------------------------------------------------------------------
-- KYUN:
--  1. Teen dashboards anon key se seedha ticket_cache me delete+insert karte
--     the, har ek apne ADHOORE field set ke saath. Jis page se Refresh hota,
--     wo baaki pages ke fields cache se uda deta tha:
--       TAT par Refresh     → Support ka Agent-wise table khali (tia gaya)
--       Support par Refresh → TAT ke Bug/Dev "Others", RfT/UAT TAT 0% (ld/rtt gaye)
--  2. anon key se koi bhi POORA cache delete kar sakta tha (security hole).
--
-- Ab: browser sirf PADHTA hai; likhna hamesha service key se hota hai —
-- ya nightly job se, ya /api/ticket-cache (validating writer) se.
-- ===========================================================================

-- ── 1. Naye columns ────────────────────────────────────────────────────────
-- schema_version : payload ka field-set version (assets/ticket-parser.js ka
--                  MB_SCHEMA_VERSION). Purani rows NULL → readers 1 maante hain.
-- field_counts   : {"total":N,"tia":N,"ld":N,"rtd":N,"st":N} — sasta summary
--                  jisse /api/ticket-cache regression detect karta hai bina
--                  poora payload padhe.
-- writer         : kisne likha (nightly / marg-dashboard / support-dashboard /
--                  api-dashboard) — audit ke liye.
ALTER TABLE public.ticket_cache
  ADD COLUMN IF NOT EXISTS schema_version integer,
  ADD COLUMN IF NOT EXISTS field_counts   jsonb,
  ADD COLUMN IF NOT EXISTS writer         text;

-- ── 2. date_from par duplicate rows saaf karo ──────────────────────────────
-- Purana delete-then-insert pattern race me duplicate rows chhod sakta tha
-- (parallel matrix jobs). Unique constraint lagane se pehle sabse naya
-- fetched_at rakho, baaki hata do.
DELETE FROM public.ticket_cache t
USING public.ticket_cache k
WHERE t.date_from = k.date_from
  AND (
        -- NULL-SAFE: purani rows me fetched_at NULL ho sakta hai. Seedha
        -- `t.fetched_at < k.fetched_at` likhne par comparison NULL deta hai
        -- (na true na false) → wo duplicate DELETE hota hi nahi, aur neeche
        -- unique constraint FAIL ho jaata hai. Fail hone par poora script
        -- abort → uske baad har on_conflict=date_from upsert (nightly AUR
        -- api/ticket-cache dono) error dene lagta hai. Isliye coalesce.
        coalesce(t.fetched_at, '-infinity'::timestamptz)
      < coalesce(k.fetched_at, '-infinity'::timestamptz)
     OR (
        coalesce(t.fetched_at, '-infinity'::timestamptz)
      = coalesce(k.fetched_at, '-infinity'::timestamptz)
        -- Tiebreak par `id` column ASSUME nahi kar rahe (is table ka PK naam
        -- pata nahi, aur ho sakta hai koi PK hi na ho). `ctid` har Postgres
        -- row ka built-in physical identifier hai — hamesha maujood.
        AND t.ctid < k.ctid
     )
  );

-- ── 3. Unique constraint → atomic upsert possible ──────────────────────────
-- Iske bina PostgREST ka on_conflict=date_from kaam nahi karega, aur nightly
-- script / api/ticket-cache dono upsert par fail karenge.
--
-- Pehle guard: agar step 2 ke baad bhi koi duplicate bacha hai to saaf error
-- do, warna ALTER TABLE ka raw error samajhna mushkil hota hai.
DO $$
DECLARE dup_count integer;
BEGIN
  SELECT count(*) INTO dup_count FROM (
    SELECT date_from FROM public.ticket_cache
    GROUP BY date_from HAVING count(*) > 1
  ) d;

  IF dup_count > 0 THEN
    RAISE EXCEPTION
      'ticket_cache me % date_from par ab bhi duplicate rows hain — unique constraint nahi lag sakta. Step 2 ka DELETE dekho.', dup_count;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'ticket_cache_date_from_key'
  ) THEN
    ALTER TABLE public.ticket_cache
      ADD CONSTRAINT ticket_cache_date_from_key UNIQUE (date_from);
    RAISE NOTICE 'ticket_cache_date_from_key constraint ban gaya.';
  ELSE
    RAISE NOTICE 'ticket_cache_date_from_key pehle se maujood hai — skip.';
  END IF;
END $$;

-- ── 3b. Self-check: constraint SACH ME bana ya nahi ────────────────────────
-- Ye bhi fail-loud hai. Bina iske, "SQL chal gaya" dikhta tha par upsert
-- silently tootta rehta tha.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'ticket_cache_date_from_key'
  ) THEN
    RAISE EXCEPTION 'ticket_cache_date_from_key nahi bana — aage deploy na karo.';
  END IF;
END $$;

-- ── 4. RLS: browser = READ-ONLY ────────────────────────────────────────────
-- service_role RLS ko bypass karta hai, isliye nightly job aur
-- /api/ticket-cache (dono service key use karte hain) par koi asar nahi.
-- INSERT/UPDATE/DELETE ke liye koi policy NAHI banayi ja rahi → anon aur
-- authenticated dono ke liye wo automatically DENY hain.
ALTER TABLE public.ticket_cache ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "ticket_cache read for all"        ON public.ticket_cache;
DROP POLICY IF EXISTS "ticket_cache: read only for app"  ON public.ticket_cache;

CREATE POLICY "ticket_cache: read only for app"
  ON public.ticket_cache
  FOR SELECT
  TO public              -- anon + authenticated dono
  USING (true);

-- ── 5. Verify — ye chala kar dekh lo ───────────────────────────────────────
-- Har row me schema_version 2 aur tia/ld/rtd ke counts > 0 hone chahiye.
-- Agar with_tia = 0 dikhe, to us row ko purane writer ne likha tha:
-- dashboard se "↺ Refresh Data" chalao ya nightly job manually run karo.
--
-- select date_from, date_to, fetched_at, writer, schema_version, total_count,
--        (select count(*) from jsonb_array_elements(data) e where e ? 'tia') as with_tia,
--        (select count(*) from jsonb_array_elements(data) e where e ? 'ld')  as with_ld,
--        (select count(*) from jsonb_array_elements(data) e where e ? 'rtd') as with_rtd
-- from public.ticket_cache
-- order by date_from;

-- ── NOTE: retention_snapshots ──────────────────────────────────────────────
-- Ye table jaanbujh kar chhoda gaya hai. marg_ticket_dashboard.html ka
-- retSnapshotSave() isme browser se hi upsert karta hai, to RLS lagane se
-- Retention Trend chart toot jayega. Usko lock karna ho to pehle wo write bhi
-- ek serverless function ke peeche le jaana padega.
