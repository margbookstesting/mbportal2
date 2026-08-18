#!/bin/bash
# Saare offline test suites. Deploy se pehle ye green hona chahiye.
# Live test alag hai: work/tests/live_test_bss.js (asli Marg API par chalti hai).
cd /home/claude
TOTAL_FAIL=0
run(){
  echo "════════════════════════════════════════════════════════════"
  echo "  $1"
  echo "════════════════════════════════════════════════════════════"
  shift
  if "$@" > /tmp/out.$$ 2>&1; then
    grep -E "RESULTS:" /tmp/out.$$
  else
    grep -E "RESULTS:|FAIL" /tmp/out.$$ | head -20
    TOTAL_FAIL=$((TOTAL_FAIL+1))
  fi
  rm -f /tmp/out.$$
}

echo "── ticket_cache hardening ──"
run "1/8  SQL migration (real PostgreSQL 16)"   bash tests/test_sql.sh
run "2/8  ticket-cache API + gzip"              node tests/test_api.js
run "3/8  Nightly script guards"                python3 tests/test_nightly.py
run "4/8  Parser parity (JS vs Python)"         python3 tests/test_parity.py
run "5/8  Pages + cache merge"                  node tests/test_pages.js

echo ""
echo "── BSS dashboard ──"
run "6/8  BSS SQL migration"                    bash tests/test_bss_sql.sh
run "7/8  BSS field crosswalk"                  node tests/test_bss_fields.js
run "8/8  BSS proxy"                            node tests/test_bss_proxy.js
run "9/10 BSS dashboard page"                   node tests/test_bss_page.js
run "10/10 DEEP / adversarial"                  node tests/test_deep.js

echo "════════════════════════════════════════════════════════════"
if [ "$TOTAL_FAIL" -eq 0 ]; then echo "  ✅ ALL SUITES GREEN"; else echo "  ❌ $TOTAL_FAIL suite(s) failed"; fi
echo "════════════════════════════════════════════════════════════"
exit $TOTAL_FAIL
