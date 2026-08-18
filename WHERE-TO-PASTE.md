# Kahan kya paste karna hai

Is zip ka folder structure **repo jaisa hi** hai. Sabse aasan tarika: zip
extract karke `mbportal2-changes/` ka poora content repo root par copy kar do
(overwrite allow karo). Manually karna ho to neeche exact mapping hai.

---

## 1. Nayi files (pehle exist nahi karti thi)

| File | Repo me kahan |
|---|---|
| `assets/ticket-parser.js` | `assets/` — **nayi folder banani padegi** |
| `assets/bss-fields.js` | `assets/` |
| `api/ticket-cache.js` | `api/` |
| `api/bss-proxy.js` | `api/` |
| `bss_dashboard.html` | root |
| `sql/2026-08-ticket-cache-hardening.sql` | `sql/` — **nayi folder** |
| `sql/2026-08-bss-dashboard.sql` | `sql/` |
| `tests/` (poora folder) | root par `tests/` |

## 2. Replace hone wali files

| File | Repo me kahan |
|---|---|
| `.github/scripts/fetch_tickets.py` | `.github/scripts/` |
| `api/admin-actions.js` | `api/` |
| `admin.html` | root |
| `portal.html` | root |
| `marg_ticket_dashboard.html` | root |
| `support_dashboard.html` | root |
| `ticket_dashboard_api.html` | root |
| `upcoming_timeline.html` | root |
| `setup.sql` | root |
| `vercel.json` | root |
| `DEPLOY.md` | root |

## 3. DELETE karni hai (repo root se)

- `fetch_tickets.py`  ← root wali copy. Purana fork hai, `tia` field ke bina.
  Galti se chal gayi to cache kharab kar degi. `.github/scripts/` wali rehni hai.
- `fetch-tickets.yml` ← root wali copy. Inert hai (GitHub sirf
  `.github/workflows/` padhta hai), par confusion banati hai.

---

## Deploy order — ORDER MAATTER KARTA HAI

### Step 1 — Supabase SQL Editor

`sql/2026-08-ticket-cache-hardening.sql` **already chal chuki hai** (17 Aug),
policies bhi theek ho gayi thi. Sirf ye chalao:

```
sql/2026-08-bss-dashboard.sql
```

Success par: `NOTICE: BSS Dashboard setup OK — users.bss_user_id + bss_update_log ready.`

Verify:
```sql
select
  (select count(*) from information_schema.columns
     where table_name='users' and column_name='bss_user_id')          as bss_col,
  (select count(*) from information_schema.tables
     where table_name='bss_update_log')                               as log_table,
  (select count(*) from pg_policies
     where tablename='bss_update_log' and cmd<>'SELECT')              as log_write_pols;
```
`1, 1, 0` aana chahiye.

> `setup.sql` live DB par chalane ki zaroorat NAHI (sab `IF NOT EXISTS` hai, nuksaan
> bhi nahi hoga). Wo sirf naye/fresh environment ke liye hai.

### Step 2 — Git push

Upar wali saari files. Vercel auto-deploy karega. Koi naya env var nahi chahiye —
`SUPABASE_SERVICE_KEY`, `MARG_LOGIN_EMAIL`, `MARG_LOGIN_PASSWORD` already set hain
(`api/client-info.js` wahi use karta hai).

### Step 3 — Admin setup

1. `admin.html` kholo → apne user ko edit karo
2. **BSS User ID** dropdown se apna BSS user select karo
   (list BindDropDown se aayegi; har entry par `Naam · #ID` dikhega kyunki
   master data me duplicate names hain)
3. Permissions tab me **BSS Dashboard** tick karo
4. Save

⚠️ BSS User ID map na ho to update button **disabled** rahega. Ye jaanbujhkar hai —
`UpdatedByUser` ke bina audit trail jhootha ho jata.

### Step 4 — Verify (read-only)

`/bss` kholo → `Ctrl+Shift+R` (hard refresh zaroori, warna purana cached JS chalega).
KPI cards, teen sections, filters — sab dikhna chahiye. Kisi ticket par click karo,
modal khulega aur console me `bssReadAudit` table print hogi.

### Step 5 — Live test (MB - 036939)

Pehle DRY (kuch update nahi karega):
```bash
cd tests
node live_test_bss.js --base https://mbportal.vercel.app \
  --email tumhara@email.com --password 'pass' --dry
```

Output bhejo. Usse pata chalega read endpoint kaunse BSS fields deta hai —
uske hisaab se `assets/bss-fields.js` me `BSS_READ_ALIASES` adjust karna pad
sakta hai (JiraID ka exact naam confirm nahi hai).

Uske baad asli test (backup + har field verify + restore):
```bash
node live_test_bss.js --base https://mbportal.vercel.app \
  --email tumhara@email.com --password 'pass'
```

---

## Offline tests

```bash
bash tests/run_all.sh
```
451 checks, sab offline (koi live Supabase/Marg nahi chahiye). Deploy se pehle
green hona chahiye.

`tests/test_parity.py` sabse important hai: JS aur Python parser ka field set
same rehna chahiye. Naya field ek jagah add karke doosri jagah bhoolo to yahi
RED hoga.
