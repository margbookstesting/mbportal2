# Postgres ko zaroorat par start karo. Container me service reap ho jati hai,
# isliye har SQL suite pehle ye chalati hai — warna suite jhoothe FAILs deti hai.
PGBIN=/usr/lib/postgresql/16/bin
if ! $PGBIN/pg_isready -h /tmp -p 5433 >/dev/null 2>&1; then
  if [ ! -d /tmp/pgdata/base ]; then
    mkdir -p /tmp/pgdata && chown -R postgres:postgres /tmp/pgdata
    su postgres -c "$PGBIN/initdb -D /tmp/pgdata -A trust" >/dev/null 2>&1
  fi
  su postgres -c "$PGBIN/pg_ctl -D /tmp/pgdata -o '-k /tmp -p 5433' -l /tmp/pg.log start" >/dev/null 2>&1
  for i in $(seq 1 20); do $PGBIN/pg_isready -h /tmp -p 5433 >/dev/null 2>&1 && break; sleep 0.5; done
fi
$PGBIN/pg_isready -h /tmp -p 5433 >/dev/null 2>&1 || { echo "  FAIL: postgres start nahi hua"; exit 1; }
