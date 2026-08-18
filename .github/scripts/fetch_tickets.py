import json, os, requests, re, time
from datetime import datetime, timezone, date
from dateutil.relativedelta import relativedelta
from requests.adapters import HTTPAdapter
from urllib3.util.retry import Retry

API_URL = 'https://bssapi.margcompusoft.com/api/MargBook/GetMBTicketStatusDetail'
SUPA_URL = os.environ['SUPABASE_URL']
SUPA_KEY = os.environ['SUPABASE_SERVICE_KEY']

# ── CACHE SCHEMA ──────────────────────────────────────────────────────────────
# assets/ticket-parser.js ke MB_SCHEMA_VERSION / MB_REQUIRED_FIELDS aur
# api/ticket-cache.js ke REQUIRED_SCHEMA / REQUIRED_FIELDS ke saath in-sync
# rakhna zaroori hai. Yahan koi naya field add karo to teeno jagah bump karo.
SCHEMA_VERSION = 3
REQUIRED_FIELDS = ['tia', 'ld', 'rtd', 'st']
WRITER = 'nightly'

STATUS_MAP = {
  'Transfer To IT':'IT','Acknowledge':'AK','In Progress':'IP',
  'Ready To Go Live':'LV','Transfer To Support':'SP','Closed':'CL',
  'Return To Support':'RS','Ready For Testing':'RT','Ready For UAT':'RU',
  'Return to Support':'RS','Ready for Testing':'RT','Ready for UAT':'RU'
}

# Stage → its own disposition-field name (API record key).
# Used to compute `ld` (last disposition) = the disposition of whatever stage
# the ticket is CURRENTLY sitting at. Fallback = latest non-null Disp walked
# in reverse chronological order.
# Field names verified against live Marg API (2026-07-17 sample).
STAGE_DISP_BY_SC = {
  'IT': 'TransferToIT_Disp',
  'AK': 'Ack_Disp',
  'IP': 'Inprogress_Disp',
  'RT': 'ReadyForTesting_Disp',
  'RU': 'ReadyForUAT_Disp',
  'LV': 'ReadyToGoLiveDisp',
  'SP': 'TransferToSupportDisp',
  'RS': 'ReopenDisp',
}
# Reverse chronological fallback order — later stages first
DISP_FALLBACK_ORDER = [
  'RejectDisp','FutureDevelopmentDisp','ReopenDisp','TransferToSupportDisp',
  'ReadyToGoLiveDisp','ReopendfromTesting_Disp','ReadyForUAT_Disp',
  'ReadyForMerging_Disp','ReadyForCodeReview_Disp','ReadyForTesting_Disp',
  'Inprogress_Disp','Ack_Disp','TransferToIT_Disp'
]

# ── Recognized dispositions for the Bug/Dev/Improve/Data-Upd buckets ──────────
# Used by the category-aware `ld` walk: while walking stages reverse-
# chronologically we SKIP any disposition that is not one of these six, so a
# ticket only lands in "Others" when NO stage ever had a recognized value.
# Patterns mirror isBug/isDev/isImprovement/isDataUpdation in
# marg_ticket_dashboard.html exactly (strict for Bug/Dev, contains for
# Improvement/Data Updation).
_RECOG_EXACT_RE = re.compile(r'^\s*(bug|bug\s*urgent|development|development\s*urgent)\s*$', re.I)
def is_recognized_disp(v):
    s = str(v)
    if _RECOG_EXACT_RE.match(s): return True
    if re.search(r'improvement', s, re.I): return True
    if re.search(r'data\s*updation', s, re.I): return True
    return False

def parse_date(v):
    if not v or v == '1900-01-01T00:00:00': return None
    s = str(v).strip()
    m = re.match(r'^(\d{2})-(\d{2})-(\d{4})$', s)
    if m: return f"{m.group(3)}-{m.group(2)}-{m.group(1)}"
    return s.split('T')[0]

def tat_flag(v):
    if not v: return None
    s = str(v)
    if 'InTAT' in s: return 'I'
    if 'OutTAT' in s: return 'O'
    return None

def compact_tat(v):
    if not v: return None
    m = re.search(r'(\d+)\s+days?\s+(\d+)\s+hours?', str(v))
    return f"{m.group(1)}d {m.group(2)}h" if m else None

def parse_record(r):
    rec = {}
    for k,v in [('n','TicketNo'),('l','LicNo'),('q','Ack_Disp'),('t','TransferTo'),
                ('tia','TransfertoITAgents'),
                ('ta','AcknowledgebyAgents'),('ti','InProgressByAgent'),
                ('ts','TransferTosupportBy'),('eb','ReadyToGoLiveBy')]:
        if r.get(v): rec[k] = r[v]
    for k,v in [('u','UserName'),('p','subscriptionPlan'),('r','RM'),
                ('desc','Description'),('remarks','Remarks'),('dev','Developer'),
                ('subDisp','SubDisposition'),('mainDisp','MainDisposition'),
                ('probType','Problemtype'),('assignto','Assignto')]:
        # NULL GUARD: pehle yahan `str(r.get(v,'')).strip()` tha. Marg API jab
        # JSON `null` bhejta hai to str(None) == 'None' — non-empty string! —
        # to rec[k] me literal "None" chala jaata tha. Dashboard par customer
        # name / developer / RM sab "None" dikhte the, aur field PRESENT hone
        # ki wajah se koi required-field guard bhi ise pakad nahi sakta tha.
        # JS parser (`r.UserName && r.UserName.trim()`) null ko correctly drop
        # karta hai — ab dono match karte hain. tests/test_parity.py isko lock
        # karta hai.
        _v = r.get(v)
        if _v is not None and str(_v).strip():
            rec[k] = str(_v).strip()


    if r.get('Mobile'): rec['mobile'] = str(r['Mobile']).strip()
    
    # SAFE FIX: Check for None or non-string object types before stripping email
    email_val = r.get('Emailid')
    if email_val is not None:
        email_str = str(email_val).strip()
        if email_str:
            rec['email'] = email_str

    tld = parse_date(r.get('TimeLineDate'))
    if tld: rec['tld'] = tld
    tc = parse_date(r.get('TicketCreatedDate'))
    if tc: rec['tc'] = tc

    a = parse_date(r.get('TransfertoITDate'))
    b = parse_date(r.get('AcknowledgeDate'))
    c = parse_date(r.get('InProgressDate'))
    d = parse_date(r.get('TransferTosupportDate'))
    e = parse_date(r.get('ReadyToGoLiveDate'))

    if a:
        rec['a']=a
        at=tat_flag(r.get('TransferToIT_TATDetails'))
        if at: rec['at']=at
        av=compact_tat(r.get('TransferToIT_TATDetails'))
        if av: rec['av']=av
        if r.get('TransferToIT_TatDuration'): rec['ad']=str(r['TransferToIT_TatDuration'])
    if b:
        rec['b']=b
        bt=tat_flag(r.get('Ack_TATDetails'))
        if bt: rec['bt']=bt
        bv=compact_tat(r.get('Ack_TATDetails'))
        if bv: rec['bv']=bv
        if r.get('Ack_TatDuration'): rec['bd']=str(r['Ack_TatDuration'])
    if c:
        rec['c']=c
        ct=tat_flag(r.get('InProgress_TATDetails'))
        if ct: rec['ct']=ct
        cv=compact_tat(r.get('InProgress_TATDetails'))
        if cv: rec['cv']=cv
        if r.get('InProgress_TatDuration'): rec['cd']=str(r['InProgress_TatDuration'])
    if d:
        rec['d']=d
        dt=tat_flag(r.get('TransfertoSupport_TATDetails'))
        if dt: rec['dt']=dt
        dv=compact_tat(r.get('TransfertoSupport_TATDetails'))
        if dv: rec['dv']=dv
        if r.get('TransferToSupport_TatDuration'): rec['dd']=str(r['TransferToSupport_TatDuration'])
    if e:
        rec['e']=e
        et=tat_flag(r.get('ReadyToGoLive_TATDetails'))
        if et: rec['et']=et
        ev=compact_tat(r.get('ReadyToGoLive_TATDetails'))
        if ev: rec['ev']=ev

    # ── ADDITIONAL SUB-STAGES ──────────────────────────────────────────────
    # Mirrors parseAPIRecord()'s 8-stage extraction. For each sub-stage we
    # extract date + TAT flag + compact TAT + agent — same short-key
    # convention: date=<k>d, TAT flag=<k>t, TAT compact=<k>v, agent=<k>g.
    # Previously only the JS-side parser did this, so cache-loaded records
    # were missing rtt/uat — that was the root cause of the KPI cards
    # showing 0% for InTAT/OutTAT. Both sides are now aligned.
    sub_stages = [
        ('rt', 'ReadyForTestingDate',       'ReadyForTesting_TATDetails',    'ReadyForTestingBy'),
        ('cr', 'ReadyForCodeReviewDate',    'ReadyForCodeReview_TATDetails', 'ReadyForCodeReviewBy'),
        ('mg', 'ReadyForMergingDate',       'ReadyForMerging_TATDetails',    'ReadyForMergingBy'),
        ('ua', 'ReadyForUATDate',           'ReadyForUAT_TATDetails',        'ReadyForUATBy'),
        ('rf', 'ReopendfromTestingDate',    'ReopendfromTesting_TATDetails', 'ReopendfromTestingBy'),
        ('ro', 'ReOpenDate',                'Reopen_TATDetails',             'ReOpenBy'),
        ('fd', 'FutureDevelopmentDate',     'Futuredevelopment_TATDetails',  'FutureDevelopmentBy'),
        ('rj', 'RejectedDate',              'Rejected_TATDetails',           'RejectedBy'),
    ]
    has_substage_date = False
    for k, date_field, tat_field, agent_field in sub_stages:
        dd = parse_date(r.get(date_field))
        if dd:
            rec[k+'d'] = dd
            has_substage_date = True
            tf = tat_flag(r.get(tat_field))
            if tf: rec[k+'t'] = tf
            tv = compact_tat(r.get(tat_field))
            if tv: rec[k+'v'] = tv
            ag = r.get(agent_field)
            if ag and str(ag).strip():
                rec[k+'g'] = str(ag).strip()

    # Close date + closed-by agent
    cld = parse_date(r.get('CloseDate'))
    if cld:
        rec['cld'] = cld
        cby = r.get('ClosedBY')
        if cby and str(cby).strip():
            rec['clb'] = str(cby).strip()

    # Raw status string (exact label from Marg) — used by Support Dashboard for
    # status-wise KPIs (Pending, Reopen, Code Review, Merging, Future Dev, Rejected, etc.)
    st = str(r.get('Status', '') or '').strip()
    if st:
        rec['st'] = st

    rec['sc'] = STATUS_MAP.get(r.get('Status',''), 'OT')

    # ── LAST DISPOSITION (ld) ──────────────────────────────────────────────
    # (1) Category-aware reverse-chronological walk: pick the LAST stage whose
    #     disposition is one of the six recognized values (Bug / Bug Urgent /
    #     Development / Development Urgent / Improvement / Data Updation).
    #     Unrecognized values (e.g. "Bug Approved") are SKIPPED so earlier
    #     stages still get a chance — "Others" only when nothing matches.
    # (2) Fallback (no recognized disposition on any stage): old behaviour —
    #     current stage's own Disp field, then first non-empty reverse-chrono.
    # Mirrors parseAPIRecord() in marg_ticket_dashboard.html so cache-loaded
    # records match live-fetched.
    _ld = None
    for k in DISP_FALLBACK_ORDER:
        v = r.get(k)
        if v is not None and str(v).strip() and is_recognized_disp(str(v).strip()):
            _ld = str(v).strip()
            break
    if not _ld:
        _primary_key = STAGE_DISP_BY_SC.get(rec['sc'])
        if _primary_key:
            v = r.get(_primary_key)
            if v is not None and str(v).strip():
                _ld = str(v).strip()
    if not _ld:
        for k in DISP_FALLBACK_ORDER:
            v = r.get(k)
            if v is not None and str(v).strip():
                _ld = str(v).strip()
                break
    if _ld:
        rec['ld'] = _ld

    # ── CURRENT-STAGE DISPOSITION (cd) — schema v3 ──
    # `ld` recognized-first walk hai (sirf 6 values), jo Bug/Dev analytics ke
    # liye sahi hai. Par BSS UI ka "Disposition" dropdown ticket ke CURRENT
    # stage ki disposition dikhata hai — recognized ho ya na ho.
    # MB - 037392: status Acknowledge, Ack_Disp = "Future Development",
    # TransferToIT_Disp = "Bug"  ->  ld = "Bug", BSS UI = "Future Development".
    # BSS Dashboard ko `cd` chahiye, warna wo galat value dikha kar user se
    # overwrite karwa dega. assets/ticket-parser.js me bilkul yahi logic hai —
    # tests/test_parity.py dono ko sync me rakhta hai.
    _cd = None
    _cur = STAGE_DISP_BY_SC.get(rec['sc'])
    if _cur and str(r.get(_cur) or '').strip():
        _cd = str(r[_cur]).strip()
    else:
        for k in DISP_FALLBACK_ORDER:
            if str(r.get(k) or '').strip():
                _cd = str(r[k]).strip()
                break
    if _cd:
        rec['cd'] = _cd

    # Keep a record if it reached any stage (main OR sub-stage), OR is in a
    # status-only stage, OR simply carries a status label (so Pending / Reopen
    # / Rejected / Future Dev etc. are not dropped).
    return rec if (a or b or c or d or e or has_substage_date or rec['sc'] in ['RS','RT','RU'] or st) else None

def make_chunks(start_str, end_date, months=3):
    chunks = []
    current = datetime.strptime(start_str, '%Y-%m-%d').date()
    while current <= end_date:
        chunk_end = min(current + relativedelta(months=months) - relativedelta(days=1), end_date)
        chunks.append((current.strftime('%Y-%m-%d'), chunk_end.strftime('%Y-%m-%d')))
        current = chunk_end + relativedelta(days=1)
    return chunks

def fetch_chunk(session, fdate, todate, attempt_no, total):
    url = f"{API_URL}?FDate={fdate}&ToDate={todate}&TicketNo="
    print(f"\n[Chunk {attempt_no}/{total}] {fdate} → {todate}", flush=True)
    print(f"  Fetching: {url}", flush=True)

    for try_no in range(1, 4):
        try:
            resp = session.get(
                url,
                timeout=(60, 1800),
                stream=True,
                headers={
                    'Accept': 'application/json',
                    'User-Agent': 'Mozilla/5.0',
                    'Connection': 'keep-alive',
                }
            )
            resp.raise_for_status()
            print(f"  Response received! Reading...", flush=True)

            content = b""
            for chunk in resp.iter_content(chunk_size=65536):
                if chunk:
                    content += chunk

            data = json.loads(content.decode('utf-8'))
            if data.get('Status') != 'Success':
                raise Exception(f"API Error: {data.get('Message')}")

            records = data.get('Details', [])
            print(f"  ✅ Got {len(records)} records", flush=True)
            return records

        except Exception as ex:
            print(f"  ❌ Try {try_no}/3 failed: {ex}", flush=True)
            if try_no < 3:
                wait = 30 * try_no
                print(f"  Waiting {wait}s...", flush=True)
                time.sleep(wait)
            else:
                print(f"  ⚠️ Chunk {fdate}→{todate} skip!", flush=True)
                return []

# ── Main Execution ────────────────────────────────────────────────────────────
if os.getenv("IS_MATRIX_RUN") == "true":
    START_DATE = os.getenv("START_DATE_OVERRIDE")
    target_end = datetime.strptime(os.getenv("END_DATE_OVERRIDE"), '%Y-%m-%d').date()
    today = min(date.today(), target_end)
else:
    START_DATE = '2023-04-01'
    today = date.today()

session = requests.Session()
retry = Retry(total=0)
adapter = HTTPAdapter(max_retries=retry)
session.mount("https://", adapter)
session.mount("http://", adapter)

chunks = make_chunks(START_DATE, today, months=3)
print(f"Total chunks for this run: {len(chunks)}", flush=True)

ticket_map = {}
for i, (fdate, todate) in enumerate(chunks, 1):
    records = fetch_chunk(session, fdate, todate, i, len(chunks))
    for r in records:
        rec = parse_record(r)
        if rec and rec.get('n'):
            ticket_map[rec['n']] = rec

    if i < len(chunks):
        print(f"  Resting 5s...", flush=True)
        time.sleep(5)

RAW = list(ticket_map.values())
print(f"\nTotal unique tickets in this chunk: {len(RAW)}", flush=True)

if not chunks:
    # START_DATE aaj se aage hai (jaise matrix me agla saal pehle se add kar
    # diya ho). Karne ko kuch nahi hai — ye GENUINE no-op hai, failure nahi.
    print(f"⏭️  {START_DATE} abhi future me hai — kuch fetch karne ko nahi, skip.", flush=True)
    exit(0)

if not RAW:
    # Pehle yahan exit(0) tha — job GREEN dikhti thi aur purani (possibly
    # adhoori) row waisi hi padi rehti thi, kisi ko pata bhi nahi chalta.
    # Ab loud failure: purani row CHHEDI NAHI jaati, par job RED hoti hai.
    print("❌ No records found in this range — cache unchanged, failing loudly.", flush=True)
    exit(1)

# ── Supabase Integration ──────────────────────────────────────────────────────
supa_headers = {
    'apikey': SUPA_KEY,
    'Authorization': f'Bearer {SUPA_KEY}',
    'Content-Type': 'application/json',
    'Prefer': 'return=minimal'
}

# Field coverage summary — api/ticket-cache.js isi se check karta hai ki koi
# writer kisi field ko >0 se 0 par na gira de. Yahan bhi wahi guard.
field_counts = {'total': len(RAW)}
for _f in REQUIRED_FIELDS:
    field_counts[_f] = sum(1 for r in RAW if r.get(_f) not in (None, ''))
print(f"Field coverage: {field_counts}", flush=True)

# ── REGRESSION GUARD ─────────────────────────────────────────────────────────
# Pehle yahan blunt check tha: `if field_counts[f] == 0: exit(1)`.
# Wo GALAT tha — REQUIRED_FIELDS me `rtd` (ReadyForTestingDate) aur `tia` hain,
# aur ye stages purane saalon (2023/2024) ke workflow me kabhi use hi nahi hue
# ho sakte. Us case me un matrix jobs ka coverage legitimately 0 hota, aur wo
# HAMESHA ke liye RED ho jaati — refresh band, aur failure aisa dikhta jaise
# Marg API toot gaya ho.
#
# Sahi sawaal "field 0 hai kya?" nahi, "field pehle tha aur ab GAYAB ho gaya
# kya?" hai. To ab maujooda row se compare karte hain — bilkul waise hi jaise
# api/ticket-cache.js karta hai. Isse dono writers ka behaviour same rehta hai.
prev_counts, prev_total = None, 0
try:
    _pr = requests.get(
        f"{SUPA_URL}/rest/v1/ticket_cache"
        f"?date_from=eq.{START_DATE}&select=field_counts,total_count",
        headers={'apikey': SUPA_KEY, 'Authorization': f'Bearer {SUPA_KEY}'},
        timeout=60,
    )
    if _pr.ok and isinstance(_pr.json(), list) and _pr.json():
        _row = _pr.json()[0]
        prev_counts = _row.get('field_counts') or None
        prev_total = _row.get('total_count') or 0
except Exception as _e:
    # Guard best-effort hai. Compare na ho paye to write block nahi karte —
    # warna ek Supabase blip poori nightly rok deta.
    print(f"⚠️  Purani row nahi padh paye ({_e}) — regression guard skip.", flush=True)

if prev_counts:
    lost = [f for f in REQUIRED_FIELDS
            if (prev_counts.get(f) or 0) > 0 and field_counts[f] == 0]
    if lost:
        print(f"❌ Ye fields cache me hain par is fetch me nahi: {lost}", flush=True)
        print(f"   purana: {prev_counts}", flush=True)
        print(f"   naya  : {field_counts}", flush=True)
        print("   Marg API ne field names badal diye lagte hain. Cache UNCHANGED.", flush=True)
        exit(1)

    if prev_total > 0 and len(RAW) < prev_total * 0.5:
        print(f"❌ Ticket count {prev_total} → {len(RAW)} (>50% drop) — adhoori fetch "
              f"lagti hai. Cache UNCHANGED.", flush=True)
        exit(1)
else:
    # Pehli baar likh rahe hain (ya purani row me field_counts NULL hai).
    # Compare karne ko kuch nahi — sirf report karo, block mat karo, warna
    # bootstrap hi possible nahi hoga.
    zero = [f for f in REQUIRED_FIELDS if field_counts[f] == 0]
    if zero:
        print(f"ℹ️  Baseline row nahi mili. In fields ka coverage 0 hai: {zero} — "
              f"is window ke liye normal ho sakta hai (purane saalon me wo stage "
              f"use hi nahi hota tha). Aage badh rahe hain; agli baar se ye "
              f"baseline ban jayega aur regression pakda jayega.", flush=True)

payload = {
    'data': RAW,
    'total_count': len(RAW),
    'date_from': START_DATE,
    'date_to': today.strftime('%Y-%m-%d'),
    'fetched_at': datetime.now(timezone.utc).isoformat(),
    'schema_version': SCHEMA_VERSION,
    'field_counts': field_counts,
    'writer': WRITER,
}

# ATOMIC UPSERT (date_from par unique constraint — setup.sql).
# Pehle delete-then-insert tha: beech me ek window rehti thi jisme us saal ki
# row missing hoti thi, aur insert fail ho jaata to data agli raat tak gayab.
# on_conflict + merge-duplicates se ek hi statement me replace hota hai.
print(f"Upserting {len(RAW)} tickets for {START_DATE} → {today}...", flush=True)
r = requests.post(
    f"{SUPA_URL}/rest/v1/ticket_cache?on_conflict=date_from",
    json=payload,
    headers={**supa_headers, 'Prefer': 'resolution=merge-duplicates,return=minimal'},
    timeout=180,
)
if not r.ok:
    print(f"❌ Upsert failed (HTTP {r.status_code}): {r.text[:500]}", flush=True)
r.raise_for_status()
print(f"✅ Successfully saved {len(RAW)} tickets (schema v{SCHEMA_VERSION}) to Supabase!", flush=True)
