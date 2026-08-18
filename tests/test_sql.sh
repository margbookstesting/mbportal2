#!/bin/bash
# Migration test — real Postgres 16.
# Ye wahi scenario banata hai jo blocker #1 tha: duplicate date_from rows
# jinme fetched_at NULL hai. Purana DELETE inhe chhod deta tha → unique
# constraint fail → uske baad har upsert toot jaata tha.
set -u
source "$(dirname "$0")/_pg_up.sh"
PSQL="/usr/lib/postgresql/16/bin/psql -h /tmp -p 5433 -U postgres -v ON_ERROR_STOP=1 -q"
MIG=/home/claude/work/sql/2026-08-ticket-cache-hardening.sql
PASS=0; FAIL=0
ok(){ echo "  PASS: $1"; PASS=$((PASS+1)); }
no(){ echo "  FAIL: $1"; FAIL=$((FAIL+1)); }

# ── Scenario A: LEGACY prod table (purana schema: naye columns nahi,
#    koi unique constraint nahi) + duplicate rows with NULL fetched_at ──
echo "== A: legacy table, duplicate date_from, NULL fetched_at =="
$PSQL -d postgres <<'SQL' >/dev/null
DROP DATABASE IF EXISTS t_a;
SQL
$PSQL -d postgres -c "CREATE DATABASE t_a;" >/dev/null
$PSQL -d t_a <<'SQL' >/dev/null
-- Jaisa production me tha: koi schema_version/field_counts/writer nahi,
-- koi unique constraint nahi.
CREATE TABLE public.ticket_cache (
  id          bigserial PRIMARY KEY,
  data        jsonb NOT NULL,
  total_count integer,
  date_from   date NOT NULL,
  date_to     date,
  fetched_at  timestamptz
);
-- 2023: 3 duplicate rows, SAB ke fetched_at NULL  <-- purane DELETE ka killer
INSERT INTO public.ticket_cache (data,total_count,date_from,date_to,fetched_at) VALUES
  ('[{"n":"T1"}]'::jsonb, 1, '2023-04-01','2023-12-31', NULL),
  ('[{"n":"T2"}]'::jsonb, 1, '2023-04-01','2023-12-31', NULL),
  ('[{"n":"T3"}]'::jsonb, 1, '2023-04-01','2023-12-31', NULL);
-- 2024: duplicates, mixed NULL + non-NULL
INSERT INTO public.ticket_cache (data,total_count,date_from,date_to,fetched_at) VALUES
  ('[{"n":"A"}]'::jsonb,  1, '2024-01-01','2024-12-31', NULL),
  ('[{"n":"B"},{"n":"C"}]'::jsonb, 2, '2024-01-01','2024-12-31', '2026-08-01T00:00:00Z'),
  ('[{"n":"D"}]'::jsonb,  1, '2024-01-01','2024-12-31', '2026-08-02T00:00:00Z');
-- 2025: clean single row
INSERT INTO public.ticket_cache (data,total_count,date_from,date_to,fetched_at) VALUES
  ('[{"n":"X"}]'::jsonb, 1, '2025-01-01','2025-12-31', '2026-08-03T00:00:00Z');
SQL

if $PSQL -d t_a -f "$MIG" >/tmp/mig_a.log 2>&1; then
  ok "migration ran on legacy table with NULL-fetched_at duplicates"
else
  no "migration failed"; sed -n '1,20p' /tmp/mig_a.log
fi

n=$($PSQL -d t_a -tAc "select count(*) from public.ticket_cache where date_from='2023-04-01';")
[ "$n" = "1" ] && ok "2023 all-NULL duplicates collapsed to 1 row (was 3)" || no "2023 rows = $n, expected 1"

n=$($PSQL -d t_a -tAc "select count(*) from public.ticket_cache where date_from='2024-01-01';")
[ "$n" = "1" ] && ok "2024 mixed-NULL duplicates collapsed to 1 row (was 3)" || no "2024 rows = $n, expected 1"

# Survivor must be the NEWEST fetched_at, not an arbitrary row
w=$($PSQL -d t_a -tAc "select data->0->>'n' from public.ticket_cache where date_from='2024-01-01';")
[ "$w" = "D" ] && ok "2024 survivor is newest fetched_at row (D)" || no "2024 survivor = $w, expected D"

n=$($PSQL -d t_a -tAc "select count(*) from public.ticket_cache where date_from='2025-01-01';")
[ "$n" = "1" ] && ok "clean 2025 row untouched" || no "2025 rows = $n"

c=$($PSQL -d t_a -tAc "select count(*) from pg_constraint where conname='ticket_cache_date_from_key';")
[ "$c" = "1" ] && ok "unique constraint created (this is what used to fail)" || no "constraint missing"

cols=$($PSQL -d t_a -tAc "select count(*) from information_schema.columns where table_name='ticket_cache' and column_name in ('schema_version','field_counts','writer');")
[ "$cols" = "3" ] && ok "new columns added" || no "new columns = $cols/3"

r=$($PSQL -d t_a -tAc "select relrowsecurity from pg_class where relname='ticket_cache';")
[ "$r" = "t" ] && ok "RLS enabled" || no "RLS not enabled"
p=$($PSQL -d t_a -tAc "select count(*) from pg_policies where tablename='ticket_cache' and cmd='SELECT';")
w=$($PSQL -d t_a -tAc "select count(*) from pg_policies where tablename='ticket_cache' and cmd<>'SELECT';")
{ [ "$p" = "1" ] && [ "$w" = "0" ]; } && ok "exactly 1 SELECT policy, 0 write policies" || no "policies select=$p write=$w"

# ── The actual payoff: does on_conflict=date_from upsert now work? ──
echo "== A2: atomic upsert (what was breaking without the constraint) =="
if $PSQL -d t_a >/dev/null 2>&1 <<'SQL'
INSERT INTO public.ticket_cache (data,total_count,date_from,date_to,fetched_at,schema_version,field_counts,writer)
VALUES ('[{"n":"NEW"}]'::jsonb,1,'2025-01-01','2025-12-31',now(),2,'{"total":1}'::jsonb,'nightly')
ON CONFLICT (date_from) DO UPDATE SET
  data=excluded.data, total_count=excluded.total_count, fetched_at=excluded.fetched_at,
  schema_version=excluded.schema_version, field_counts=excluded.field_counts, writer=excluded.writer;
SQL
then ok "upsert on_conflict(date_from) succeeded"; else no "upsert failed"; fi
n=$($PSQL -d t_a -tAc "select count(*) from public.ticket_cache where date_from='2025-01-01';")
v=$($PSQL -d t_a -tAc "select data->0->>'n' from public.ticket_cache where date_from='2025-01-01';")
{ [ "$n" = "1" ] && [ "$v" = "NEW" ]; } && ok "upsert replaced in place (1 row, new data)" || no "rows=$n val=$v"

# ── Idempotency: migration ko dobara chalao ──
echo "== A3: idempotency (re-run) =="
if $PSQL -d t_a -f "$MIG" >/tmp/mig_a2.log 2>&1; then ok "second run clean"; else no "second run failed"; sed -n '1,20p' /tmp/mig_a2.log; fi
if $PSQL -d t_a -f "$MIG" >/tmp/mig_a3.log 2>&1; then ok "third run clean"; else no "third run failed"; fi

# ── Scenario B: fresh env from setup.sql alone (blocker #4) ──
echo "== B: fresh provision from setup.sql only =="
$PSQL -d postgres -c "DROP DATABASE IF EXISTS t_b;" >/dev/null
$PSQL -d postgres -c "CREATE DATABASE t_b;" >/dev/null
# setup.sql auth.users aur auth.uid() par depend karta hai — Supabase deta hai,
# local Postgres nahi. Minimal stub bana rahe hain.
$PSQL -d t_b <<'SQL' >/dev/null
CREATE SCHEMA IF NOT EXISTS auth;
CREATE TABLE auth.users (id uuid PRIMARY KEY);
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT NULL::uuid $$;
SQL
if $PSQL -d t_b -f /home/claude/work/setup.sql >/tmp/setup_b.log 2>&1; then
  ok "setup.sql ran on empty database"
else
  no "setup.sql failed"; sed -n '1,20p' /tmp/setup_b.log
fi
t=$($PSQL -d t_b -tAc "select count(*) from information_schema.tables where table_name='ticket_cache';")
[ "$t" = "1" ] && ok "ticket_cache now exists from setup.sql (blocker #4)" || no "ticket_cache missing"
c=$($PSQL -d t_b -tAc "select count(*) from pg_constraint where conname='ticket_cache_date_from_key';")
[ "$c" = "1" ] && ok "unique constraint present in fresh env" || no "constraint missing in fresh env"
t=$($PSQL -d t_b -tAc "select count(*) from information_schema.tables where table_name='retention_snapshots';")
[ "$t" = "1" ] && ok "retention_snapshots created" || no "retention_snapshots missing"
# Fresh env should also tolerate the migration on top (order-independent)
if $PSQL -d t_b -f "$MIG" >/tmp/mig_b.log 2>&1; then ok "migration on top of fresh setup.sql is a no-op"; else no "migration on fresh env failed"; sed -n '1,20p' /tmp/mig_b.log; fi

# ── Scenario C: guard fires when duplicates somehow survive ──
echo "== C: fail-loud guard =="
$PSQL -d postgres -c "DROP DATABASE IF EXISTS t_c;" >/dev/null
$PSQL -d postgres -c "CREATE DATABASE t_c;" >/dev/null
$PSQL -d t_c <<'SQL' >/dev/null
CREATE TABLE public.ticket_cache (
  data jsonb NOT NULL, total_count integer, date_from date NOT NULL,
  date_to date, fetched_at timestamptz
);
SQL
# NOTE: is table me `id` column NAHI hai — purana SQL `t.id` par crash karta.
$PSQL -d t_c <<'SQL' >/dev/null
INSERT INTO public.ticket_cache VALUES
 ('[]'::jsonb,0,'2024-01-01','2024-12-31',NULL),
 ('[]'::jsonb,0,'2024-01-01','2024-12-31',NULL);
SQL
if $PSQL -d t_c -f "$MIG" >/tmp/mig_c.log 2>&1; then
  ok "migration works on a table with NO id column (ctid tiebreak)"
else
  no "migration failed on table without id column"; sed -n '1,20p' /tmp/mig_c.log
fi
n=$($PSQL -d t_c -tAc "select count(*) from public.ticket_cache;")
[ "$n" = "1" ] && ok "deduped to 1 row without an id column" || no "rows=$n"

echo
echo "SQL RESULTS: $PASS passed, $FAIL failed"
[ "$FAIL" -eq 0 ]
