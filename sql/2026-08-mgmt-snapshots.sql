-- ===========================================================================
-- MB Portal — Management tab, Phase 2 (snapshots + resolution/owner)
-- Supabase → SQL Editor me ye POORA file ek baar run karo. Idempotent hai.
-- ---------------------------------------------------------------------------
-- Ek table banti hai:
--   mgmt_snapshots — har hafte ke computed metrics ka frozen record
--
-- Iska key `week_end` hai = Management tab ke "This week" window ka
-- aakhri din (mgWindows(upto).cur[1]). Isse ek hafte ka ek hi row banta hai
-- chahe report kitni baar bhi kholi jaye.
-- ===========================================================================


-- ── 1. mgmt_snapshots ──────────────────────────────────────────────────────
-- Kyun chahiye: Management tab har baar RAW cache se metrics dobara compute
-- karta hai. RAW me sirf chuni hui date range hoti hai, to purane hafte
-- dheere-dheere gayab ho jate hain aur pichhle mahine ka number wapas nikalna
-- namumkin ho jata hai. Snapshot us hafte ka number waise ka waisa rakh leta
-- hai — baad me definition badle to bhi purani report nahi badalti.
--
-- `data` jsonb me mgCompute() ka poora output jata hai (cur + prev + window),
-- taaki naya metric add karne par migration na likhni pade.
CREATE TABLE IF NOT EXISTS public.mgmt_snapshots (
  week_end    date PRIMARY KEY,
  data        jsonb       NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  updated_by  text
);

COMMENT ON TABLE public.mgmt_snapshots IS
  'Management tab ka weekly frozen snapshot. week_end = us hafte ka aakhri din.';
COMMENT ON COLUMN public.mgmt_snapshots.data IS
  'mgCompute() ka output: {cur:{...}, prev:{...}, win:{...}, saved_at:...}';


-- ── 3. updated_at apne aap ─────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.mgmt_touch_updated_at()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS mgmt_snapshots_touch ON public.mgmt_snapshots;
CREATE TRIGGER mgmt_snapshots_touch
  BEFORE UPDATE ON public.mgmt_snapshots
  FOR EACH ROW EXECUTE FUNCTION public.mgmt_touch_updated_at();



-- ── 4. RLS ─────────────────────────────────────────────────────────────────
-- Faisla: jiske paas bhi Management tab hai wo likh sakta hai. Tab khud
-- `tat-management` permission se chhupta hai (applyTabPerms), aur ye tables
-- customer data nahi rakhte — sirf aggregate counts aur team ke notes.
-- Isliye policy `authenticated` par hai, per-row owner check ke bina.
--
-- Agar aage chal kar isse sakht karna ho, to USING/WITH CHECK me
-- users.dashboards @> '["tat-management"]' ka subquery jod dena.
ALTER TABLE public.mgmt_snapshots   ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "mgmt_snapshots: read"  ON public.mgmt_snapshots;
DROP POLICY IF EXISTS "mgmt_snapshots: write" ON public.mgmt_snapshots;

CREATE POLICY "mgmt_snapshots: read"
  ON public.mgmt_snapshots FOR SELECT TO authenticated USING (true);

CREATE POLICY "mgmt_snapshots: write"
  ON public.mgmt_snapshots FOR ALL TO authenticated
  USING (true) WITH CHECK (true);



-- ── 5. Self-check ──────────────────────────────────────────────────────────
DO $$
DECLARE bad text := '';
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.tables
                 WHERE table_schema='public' AND table_name='mgmt_snapshots')
    THEN bad := bad || 'mgmt_snapshots missing; '; END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_policies
                 WHERE schemaname='public' AND tablename='mgmt_snapshots'
                   AND policyname='mgmt_snapshots: write')
    THEN bad := bad || 'snapshot write policy missing; '; END IF;

  IF bad <> '' THEN RAISE EXCEPTION 'mgmt_snapshots setup incomplete: %', bad;
  ELSE RAISE NOTICE 'OK — mgmt_snapshots ready.';
  END IF;
END $$;
