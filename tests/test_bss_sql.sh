#!/bin/bash
# BSS migration test — asli PostgreSQL 16.
# Supabase ke roles (anon / authenticated / service_role) vanilla Postgres me
# nahi hote, isliye stub me bana rahe hain — warna `TO authenticated` fail hoga
# aur wo test ka artifact hoga, SQL ka bug nahi.
set -u
source "$(dirname "$0")/_pg_up.sh"
PSQL="/usr/lib/postgresql/16/bin/psql -h /tmp -p 5433 -U postgres -v ON_ERROR_STOP=1 -q"
MIG=/home/claude/work/sql/2026-08-bss-dashboard.sql
PASS=0; FAIL=0
ok(){ echo "  PASS: $1"; PASS=$((PASS+1)); }
no(){ echo "  FAIL: $1 ${2:-}"; FAIL=$((FAIL+1)); }

fresh_db(){
  $PSQL -d postgres -c "DROP DATABASE IF EXISTS $1;" >/dev/null 2>&1
  $PSQL -d postgres -c "CREATE DATABASE $1;" >/dev/null
  $PSQL -d "$1" >/dev/null <<'SQL'
CREATE SCHEMA IF NOT EXISTS auth;
CREATE TABLE auth.users (id uuid PRIMARY KEY);
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT NULL::uuid $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='anon')          THEN CREATE ROLE anon; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN CREATE ROLE authenticated; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='service_role')  THEN CREATE ROLE service_role; END IF;
END $$;
SQL
}

echo "== A: migration on an existing portal DB =="
fresh_db t_bss
$PSQL -d t_bss -f /home/claude/work/setup.sql >/dev/null 2>&1

if $PSQL -d t_bss -f "$MIG" >/tmp/bss1.log 2>&1; then ok "migration ran"; else no "migration failed"; sed -n '1,10p' /tmp/bss1.log; fi
grep -q "BSS Dashboard setup OK" /tmp/bss1.log && ok "success NOTICE printed" || no "no success notice"

c=$($PSQL -d t_bss -tAc "select count(*) from information_schema.columns where table_name='users' and column_name='bss_user_id'")
[ "$c" = "1" ] && ok "users.bss_user_id added" || no "column missing"
t=$($PSQL -d t_bss -tAc "select data_type from information_schema.columns where table_name='users' and column_name='bss_user_id'")
[ "$t" = "integer" ] && ok "bss_user_id is integer" || no "wrong type: $t"

c=$($PSQL -d t_bss -tAc "select count(*) from information_schema.tables where table_name='bss_update_log'")
[ "$c" = "1" ] && ok "bss_update_log created" || no "table missing"
r=$($PSQL -d t_bss -tAc "select relrowsecurity from pg_class where relname='bss_update_log'")
[ "$r" = "t" ] && ok "audit log RLS enabled" || no "RLS off"
w=$($PSQL -d t_bss -tAc "select count(*) from pg_policies where tablename='bss_update_log' and cmd<>'SELECT'")
s=$($PSQL -d t_bss -tAc "select count(*) from pg_policies where tablename='bss_update_log' and cmd='SELECT'")
{ [ "$w" = "0" ] && [ "$s" = "1" ]; } && ok "audit log is append-only for the app (0 write, 1 read policy)" || no "policies read=$s write=$w"
i=$($PSQL -d t_bss -tAc "select count(*) from pg_indexes where tablename='bss_update_log'")
[ "$i" -ge 3 ] && ok "indexes present (pkey + ticket + created)" || no "indexes=$i"

echo "== A2: existing users survive, existing rows keep working =="
fresh_db t_bss2
$PSQL -d t_bss2 -f /home/claude/work/setup.sql >/dev/null 2>&1
$PSQL -d t_bss2 >/dev/null <<'SQL'
INSERT INTO auth.users (id) VALUES ('11111111-1111-1111-1111-111111111111');
INSERT INTO public.users (id,name,email,role,dashboards)
VALUES ('11111111-1111-1111-1111-111111111111','Ajay','a@b.c','admin','{tat-dashboard}');
SQL
$PSQL -d t_bss2 -f "$MIG" >/dev/null 2>&1
n=$($PSQL -d t_bss2 -tAc "select count(*) from public.users")
b=$($PSQL -d t_bss2 -tAc "select coalesce(bss_user_id::text,'NULL') from public.users")
{ [ "$n" = "1" ] && [ "$b" = "NULL" ]; } && ok "existing user preserved, bss_user_id defaults to NULL" || no "rows=$n bss=$b"
$PSQL -d t_bss2 -c "UPDATE public.users SET bss_user_id=3923;" >/dev/null 2>&1 && ok "bss_user_id is writable by admin" || no "update failed"

echo "== A3: audit log accepts a real entry =="
$PSQL -d t_bss2 >/dev/null 2>&1 <<'SQL'
INSERT INTO public.bss_update_log (ticket_no,actor_id,actor_name,bss_user_id,payload,before,success,message)
VALUES ('MB - 036939','11111111-1111-1111-1111-111111111111','Ajay',3923,
        '{"Disposition":3,"SubDisposition":10}'::jsonb,'{"st":"Pending"}'::jsonb,true,null);
SQL
n=$($PSQL -d t_bss2 -tAc "select count(*) from public.bss_update_log where ticket_no='MB - 036939'")
[ "$n" = "1" ] && ok "audit row inserted (service-key path)" || no "insert failed"
d=$($PSQL -d t_bss2 -tAc "select payload->>'SubDisposition' from public.bss_update_log limit 1")
[ "$d" = "10" ] && ok "payload JSON queryable" || no "payload=$d"
ts=$($PSQL -d t_bss2 -tAc "select created_at is not null from public.bss_update_log limit 1")
[ "$ts" = "t" ] && ok "created_at auto-filled" || no "created_at null"

echo "== B: idempotency =="
if $PSQL -d t_bss -f "$MIG" >/tmp/bss2.log 2>&1; then ok "second run clean"; else no "second run failed"; sed -n '1,10p' /tmp/bss2.log; fi
if $PSQL -d t_bss -f "$MIG" >/tmp/bss3.log 2>&1; then ok "third run clean"; else no "third run failed"; fi
w=$($PSQL -d t_bss -tAc "select count(*) from pg_policies where tablename='bss_update_log' and cmd<>'SELECT'")
[ "$w" = "0" ] && ok "re-runs do not add write policies" || no "write policies appeared: $w"

echo "== C: tamper guard =="
$PSQL -d t_bss -c 'CREATE POLICY "sneaky" ON public.bss_update_log FOR INSERT TO public WITH CHECK (true);' >/dev/null 2>&1
if $PSQL -d t_bss -f "$MIG" >/tmp/bss4.log 2>&1; then
  no "migration should have FAILED with a write policy present"
else
  grep -q "write policies hain" /tmp/bss4.log && ok "guard blocks a sneaky INSERT policy on the audit log" || no "wrong error"
fi

echo "== D: missing column guard =="
fresh_db t_bss3
$PSQL -d t_bss3 -c "CREATE TABLE public.users (id uuid PRIMARY KEY);" >/dev/null
$PSQL -d t_bss3 -f "$MIG" >/dev/null 2>&1
c=$($PSQL -d t_bss3 -tAc "select count(*) from information_schema.columns where table_name='users' and column_name='bss_user_id'")
[ "$c" = "1" ] && ok "works on a minimal users table too" || no "column not added"

echo
echo "BSS SQL RESULTS: $PASS passed, $FAIL failed"
[ "$FAIL" -eq 0 ]
