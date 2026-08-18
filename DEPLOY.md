# MB Portal — Admin Fix (Vercel serverless function)

## Kya badla (Edge Function ki zaroorat khatam)

Pehle admin operations Supabase Edge Function par the (jise CLI/Docker se
deploy karna padta). Ab woh ek **Vercel serverless function** par hain:
`api/admin-actions.js`. Tum already Vercel par ho, isliye ye file repo mein
hone par tumhare **normal Vercel deploy ke saath hi** live ho jaati hai —
alag se kuch deploy nahi karna. Service key sirf Vercel env var mein rehti hai.

## Sirf 3 step (5 min)

### 1. File repo mein daalo
`api/admin-actions.js` ko apne repo ke **`api/`** folder mein rakho
(root par `api` folder banao agar nahi hai). Path bilkul: `api/admin-actions.js`.
`admin.html` ko bhi replace karo (naya wala).

### 2. Vercel mein service key set karo  ⚠️ zaroori
Vercel Dashboard → apna project → **Settings → Environment Variables** → Add:

| Name                   | Value                                  |
|------------------------|----------------------------------------|
| `SUPABASE_SERVICE_KEY` | tumhari **nayi** Supabase service_role key |

(Environments mein Production + Preview dono tick kar dena.)

> Purani service key expose ho chuki thi — Supabase → Settings → API Keys mein
> service_role key **roll/reset** karke nayi banao, aur wahi yahan daalo.
> Purani key turant invalid ho jaayegi.

### 3. Redeploy
Git push karo (ya Vercel mein "Redeploy"). Function `/api/admin-actions` par
live ho jaayega. Admin page refresh karo — list aur create dono chalenge.

## Confirm: function live hai ya nahi
Browser mein kholo: `https://<tumhari-site>/api/admin-actions`
- **405 (Method not allowed)** aaye → function live hai ✅ (GET allowed nahi, sirf POST)
- **404** → file galat jagah hai, `api/admin-actions.js` path check karo

## Agar list par 403 aaye
Function chal rahi hai par tumhara apna user admin nahi hai. Supabase SQL Editor:
```sql
update public.users set role = 'admin' where email = 'tumhara@email.com';
```

## Note
- `supabase/functions/admin-actions/index.ts` ab use nahi hota — chaaho toh
  rakho ya hata do, Vercel waala hi kaafi hai.
- `vercel.json` mein koi change ki zaroorat nahi — `/api/*` automatically chalta hai.

---

# ticket_cache — permanent fix (schema v2)

## Problem jo fix hui

Teen dashboards apna-apna `parseAPIRecord` rakhte the aur teeno ka field set
alag tha, par sab **ek hi `ticket_cache`** me anon key se seedha likhte the.
Jis page se Refresh hota, wo baaki pages ke fields cache se uda deta tha:

| Kahan Refresh | Kya toota |
|---|---|
| TAT Dashboard | Support ka "Transfer To IT — Agent-wise" table khali (`tia` gaya) |
| Support Dashboard | TAT ke Bug/Dev/Improve columns "Others", RfT & UAT ke InTAT/OutTAT 0% (`ld`, `rtt`, `uat` gaye) |

Login par data cache se aata hai (adhoora), Refresh par live API se (poora) —
isliye "refresh ke baad aa jata hai" ka pattern banta tha.

## Ab kya hai

1. **`assets/ticket-parser.js`** — ek shared SUPERSET parser. Chaaron pages
   wahi use karte hain. Har page ke local parser/helpers hata diye gaye, unki
   jagah thin aliases hain.
2. **`api/ticket-cache.js`** — cache ka ek-hi validating writer. Browser ab
   seedha nahi likhta. Payload reject hota hai agar: schema mismatch, khali
   data, koi required field `>0` se `0` par gire, ya ticket count 50%+ gir jaye.
3. **`sql/2026-08-ticket-cache-hardening.sql`** — naye columns
   (`schema_version`, `field_counts`, `writer`), `date_from` par unique
   constraint, aur RLS se browser **read-only**.
4. **Nightly script** — atomic upsert (delete+insert window khatam), field
   coverage self-check, aur khali result par `exit(1)` (pehle chup-chaap
   `exit(0)` karke stale data chhod deta tha).
5. **Read-side merge** — ek ticket kai year-rows me hota hai; pehle random
   winner chunta tha. Ab **jyada fields wala record jeetta hai**, to purani
   adhoori row nayi poori row ko overwrite nahi kar sakti.

## Deploy steps (order important)

### 1. Supabase SQL Editor
`sql/2026-08-ticket-cache-hardening.sql` poora run karo.
⚠️ **Ye pehle karna zaroori hai** — iske bina upsert (`on_conflict=date_from`)
fail karega.

Script ab **fail-loud** hai: duplicate rows bachi ho ya constraint na bane to
saaf `EXCEPTION` deta hai. Success par ye dikhna chahiye:
```
NOTICE:  ticket_cache_date_from_key constraint ban gaya.
```
Aage badhne se pehle CONFIRM karo:
```sql
select conname from pg_constraint where conname = 'ticket_cache_date_from_key';
```
Ek row aani chahiye. **Khali aaya to Step 2 mat karo** — upsert silently
tootta rehta aur pakadna mushkil hota.

> Naya/fresh environment ho to sirf `setup.sql` chalao — usme ab `ticket_cache`
> ka poora DDL + unique constraint + RLS shaamil hai, migration ki zaroorat
> nahi.

### 2. Git push (Vercel auto-deploy)
Nayi files: `assets/ticket-parser.js`, `api/ticket-cache.js`, `sql/…`.
`SUPABASE_SERVICE_KEY` already set hai, naya env var nahi chahiye.

### 3. Cache ek baar poora likhwao
GitHub → Actions → "Fetch Tickets & Save to Supabase" → **Run workflow**.
Ya kisi bhi dashboard par "↺ Refresh Data" — dono ab superset likhte hain.

### 4. Verify
```sql
select date_from, writer, schema_version, total_count, field_counts
from public.ticket_cache order by date_from;
```
Har row: `schema_version = 2`, aur `field_counts` me `tia`/`ld`/`st` `> 0`.

`rtd` ke baare me: purane saalon (2023/2024) me ReadyForTesting stage use hi
nahi hua ho to `rtd = 0` aana **normal** hai — ye failure nahi hai. Nightly
script sirf tab fail karti hai jab koi field pehle maujood tha aur ab GAYAB ho
gaya (regression), ya ticket count 50%+ gir jaye.

Iske baad login par bhi har section me data aayega — chahe nightly job ne
likha ho ya kisi dashboard ke Refresh ne.

## Tests

Deploy se pehle `tests/` chalao — 137 checks, saare offline (koi live Supabase
ya Marg API nahi chahiye):

```bash
bash tests/run_all.sh
```

| Suite | Kya verify karta hai |
|---|---|
| `test_sql.sh` | Asli PostgreSQL par migration — NULL `fetched_at` duplicates, `id` column ke bina table, idempotency, upsert |
| `test_api.js` | gzip round-trip, compression-bomb reject, regression + count guards, auth |
| `test_nightly.py` | Purane saal ka 0-coverage PASS ho, asli regression FAIL ho, future window no-op |
| `test_parity.py` | JS aur Python parser ka field set bilkul same (drift guard) |
| `test_pages.js` | Chaaron pages ka JS valid, wiring intact, cache merge correct |

`test_parity.py` sabse important hai: naya field ek jagah add karke doosri
jagah bhoolo to wahi RED hoga, deploy se pehle.

## Naya field add karna ho to

Teeno jagah saath me badlo, warna wahi drift wapas aa jayegi:
1. `assets/ticket-parser.js` → `mbParseTicket()`
2. `.github/scripts/fetch_tickets.py` → `parse_record()`
3. `MB_SCHEMA_VERSION` / `SCHEMA_VERSION` / `REQUIRED_SCHEMA` bump karo
   (parser, python script, `api/ticket-cache.js`)

Agar naya field kisi section ke liye critical hai to usko `MB_REQUIRED_FIELDS`
/ `REQUIRED_FIELDS` me bhi daalo — phir koi adhoora payload accept nahi hoga.

## Hataye gaye files
`fetch_tickets.py` (root) — purana fork, `tia`/sub-stages ke bina; galti se
chalane par cache kharab kar deta tha.
`fetch-tickets.yml` (root) — `.github/workflows/` ki exact duplicate copy.


---

# Blocker fixes (2026-08-17 review ke baad)

Pehle wala patch design me sahi tha, par 4 cheezein deploy tod deti. Ab fix:

## 1. Migration NULL `fetched_at` par toot jaati thi
`t.fetched_at < k.fetched_at` — NULL ke saath comparison NULL deta hai, na true
na false. To jinke `fetched_at` NULL the wo duplicate rows DELETE hi nahi hote,
phir `UNIQUE (date_from)` fail, phir script abort, phir **har** upsert
(`on_conflict=date_from`) — nightly aur `/api/ticket-cache` dono — error.
Asli Postgres par reproduce kiya: `could not create unique index`.

Fix: `coalesce(fetched_at, '-infinity')`. Tiebreak `id` ki jagah `ctid` (Postgres
ka built-in row identifier) — purana SQL `t.id` par crash karta tha agar table
me wo column na ho. Saath me duplicate-count guard + constraint self-check,
dono `RAISE EXCEPTION` ke saath.

## 2. Vercel body limit — Refresh chalta hi nahi
Browser poora saal ka payload `/api/ticket-cache` par POST karta hai, aur Vercel
ka request-body limit ~4.5MB hai. Measure kiya: ek parsed ticket ≈ **1414 bytes**
JSON, yaani **~3,300 tickets** par hi limit hit. Ek saal ka data usse zyada hai
→ Refresh permanently toota.

Fix: body gzip hoti hai (`CompressionStream` → base64, `gz` field). Measured
**~21x** chhoti — 12,000 tickets 5.4MB → 0.25MB. Server `zlib.gunzipSync` se
kholta hai, `maxOutputLength` cap ke saath (compression bomb guard — 200MB ka
bomb 265KB body me aata hai, reject hota hai, OOM nahi). Purane browser jinme
`CompressionStream` nahi, uncompressed bhejte hain — wo path bhi chalta hai.

## 3. Nightly purane saalon me hamesha RED
```python
missing = [f for f in REQUIRED_FIELDS if field_counts[f] == 0]
if missing: exit(1)
```
`REQUIRED_FIELDS` me `rtd` (ReadyForTestingDate) aur `tia` hain. 2023/2024 me ye
stages use hi nahi hue ho to un matrix jobs ka coverage legitimately 0 —
**permanently red**, refresh band, aur failure aisa dikhta jaise Marg API toot
gaya.

Fix: sahi sawaal "field 0 hai kya?" nahi, "field pehle tha aur ab gayab hai
kya?" hai. Ab maujooda row se compare hota hai — bilkul `api/ticket-cache.js`
jaisa, to dono writers ka behaviour same. Baseline na ho to report karke aage
badhta hai (warna bootstrap possible nahi). Future window (`chunks` khali) ab
`exit(0)` — genuine no-op, spurious red nahi.

## 4. `setup.sql` me `ticket_cache` hi nahi tha
Table sirf manually bana tha, par 4 jagah comment kehta tha "setup.sql me RLS
kar diya gaya hai". Fresh environment `setup.sql` se provision hi nahi hota.
Fix: `ticket_cache` (naye columns + unique constraint + RLS) aur
`retention_snapshots` ka DDL `setup.sql` me add, aur chaaron galat comment theek.

## Saath me (review ke medium items)

- **Cache merge ab field-level union hai.** "Jyada fields wala record jeetega"
  blind last-wins se behtar tha par poora fix nahi: ek hi ticket do year-rows me
  hota hai (Dec me bana, Feb me closed) aur dono ka field set alag — 2025 row me
  `tia`, 2026 row me `cld`/`clb`. Record level par ek poora jeetta, doosre ke
  fields ud jaate — wahi purana symptom chhote scale par. Ab naya row base hai
  (status current rehta hai) aur purane rows sirf missing keys bharte hain.
- **`?v=2` cache-busting** parser ke script tag par + absolute path
  (`/assets/...`), warna `/tat/` jaise trailing-slash URL par 404.
- **Dead `cacheSave()` hataya.** Kabhi call nahi hota tha, par usme
  `yearRaw.length ? yearRaw : raw` tha — saare saalon ka data current-year row
  me daal deta, aur agla sahi refresh 50% guard se reject hota → row stuck.
- **Python ka `"None"` bug.** `str(r.get(v,'')).strip()` — API se JSON `null`
  aaye to `str(None) == 'None'`, non-empty string! Customer name / developer /
  RM sab cache me literal `"None"` chale jaate the, aur field PRESENT hone ki
  wajah se koi guard ise pakad nahi sakta tha. `test_parity.py` ne isko pakda.

## Abhi bhi pending (blocker nahi)

- `retention_snapshots` browser se hi likha jaata hai anon key se — anon key
  page source me public hai, to koi bhi us table ko mita sakta hai. Lock karne
  ke liye wo write bhi serverless function ke peeche le jaana padega.
- `/api/ticket-cache` par koi user jiske paas ek bhi dashboard hai, kisi bhi
  `date_from` par likh sakta hai aur `writer` khud declare kar sakta hai — to
  `writer` column audit nahi, advisory hai.
- Workflow matrix me **2027 ki entry nahi hai**. 1 Jan 2027 se nightly current
  year cover karna band kar degi.

---

# BSS Dashboard + schema v3 (2026-08-18)

## Schema v2 → v3: naya field `cd`

`ld` (last disposition) ek **recognized-first walk** hai — sirf 6 values leta
hai (Bug / Bug Urgent / Development / Development Urgent / Improvement /
Data Updation), baaki SKIP karta hai. Wo Bug-vs-Dev analytics ke liye sahi hai.

Par BSS ka UI "Disposition" dropdown **alag cheez** dikhata hai: ticket abhi jis
stage par hai, USI stage ki disposition — recognized ho ya na ho.

Live example (MB - 037392): status `Acknowledge`, `Ack_Disp` = "Future
Development", `TransferToIT_Disp` = "Bug".
```
ld     = "Bug"                  <- analytics walk
BSS UI = "Future Development"   <- current stage
```
BSS Dashboard `ld` par bharosa karta to **galat value dikha kar user se
overwrite karwa deta**. Isliye parser ab `cd` (current-stage disposition) bhi
store karta hai — bina recognition filter ke.

Iske saath `MB_SCHEMA_VERSION` 2 → **3**. Bump kahan-kahan hua:
`assets/ticket-parser.js`, `.github/scripts/fetch_tickets.py`,
`api/ticket-cache.js` (`REQUIRED_SCHEMA`), aur paanchon pages ka `?v=3`.

⚠️ **Deploy ke baad ek full refresh chahiye.** Tab tak purani rows v2 hain,
unme `cd` nahi hai, aur BSS Dashboard ka Disposition column `—` dikhayega
(modal phir bhi sahi rahega — wo LIVE Marg data se bharta hai). Console me
"ticket_cache is on an older schema (v2)" warning aayegi. Ye apne aap theek ho
jata hai; kuch todta nahi.

## Read vs Update naming — CONFIRMED

Do tickets ke live response + unke BSS UI screen se verify kiya. Ye sirf swap
nahi, **shift** hai — naam par bharosa mat karna:

| BSS UI label | read field | update payload | BindDropDown list |
|---|---|---|---|
| Main Disposition | `MainDisposition` | `BSSMainDisposition` | `SubDispostion` |
| Problem Type | `SubDisposition` | `BSSProblemType` | `ProblemTypeMargBook` |
| Sub-Problem Type | `Problemtype` | `BSSSubProblemType` | `SubProblemTypeMargBook` |
| Sub Disposition | `Status` | `Disposition` | `Dispostion` |
| Disposition | *(current stage ka `*_Disp`)* | `SubDisposition` | `BSSDisposition` |

Mapping sirf `assets/bss-fields.js` ke `BSS_CROSSWALK` + `BSS_READ_ALIASES` me
hai. Kahin inline mat karna.

**Problem Type / Sub-Problem Type kaise decide hua:** MB - 037392 par dono ka
naam same tha ("REFRESH DASHBOARD"), isliye us se farak pata nahi chalta tha.
MB - 036741 ne decide kiya —
```
BSS UI   Problem Type     = "Invoice Template"
         Sub-Problem Type = "Exta page printing issue"
read     SubDisposition   = "Invoice Template "
         Problemtype      = "Exta page printing issue "
```
"Exta page printing issue" master data me SIRF `SubProblemTypeMargBook` me hai
(ID 3082, parent 801), aur chain 98 -> 801 -> 3082 valid banti hai. Naam dekh kar
`Problemtype` -> "Problem Type" maan lena GALAT hai.

⚠️ Parser ke keys raw API naam se aate hain, isliye ye jodi ULTI lagti hai par
sahi hai: `rec.subDisp` (= `SubDisposition`) me **Problem Type** hota hai, aur
`rec.probType` (= `Problemtype`) me **Sub-Problem Type**.

## Aur do behaviours

- **`TimeLineDate` do formats me hai.** Read `29-08-2026` (DD-MM-YYYY) deta hai,
  update `2026-08-29` (YYYY-MM-DD) maangta hai. `bssToISODate()` convert karta
  hai; bina uske date input khali rehta aur save par value ud jati.
- **`BSSComment` field nahi, append-only log hai.** Har update BSS ke Comments
  table me ek nayi row banata hai. Isliye modal me wo hamesha KHALI rehta hai —
  pre-fill karne par har save duplicate comment bana deta. `Remarks` alag hai,
  wo overwrite hota hai.

## Known limitation — TAT/Support ka Bug/Dev count

TAT aur Support dashboards Bug/Dev classification `r.q` (= `Ack_Disp`) se karte
hain. BSS UI ka "Disposition" bhi current stage ka `*_Disp` hai — to agar ticket
Acknowledge stage par hai aur koi BSS Dashboard se Disposition badalta hai, wo
asal me `Ack_Disp` badal raha hai.

Hamara cache patch `cd`/`ld` set karta hai, **`q` nahi**. Matlab TAT aur Support
ka Bug/Dev count **agli nightly tak purana dikhega**.

Ye JAANBUJHKAR hai. `q` ko conditionally patch karna (sirf jab stage Acknowledge
ho) wahan conditional logic add karta jahan galti hone par GALAT stage ki field
patch ho jati — wo stale count se kahin mehenga bug hota. Asli data Marg me
hamesha sahi rehta hai aur nightly refresh sab theek kar deti hai.
