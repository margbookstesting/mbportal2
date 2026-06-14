import json, os, requests, re, time
from datetime import datetime, timezone, date
from dateutil.relativedelta import relativedelta
from requests.adapters import HTTPAdapter
from urllib3.util.retry import Retry

API_URL = 'https://bssapi.margcompusoft.com/api/MargBook/GetMBTicketStatusDetail'
SUPA_URL = os.environ['SUPABASE_URL']
SUPA_KEY = os.environ['SUPABASE_SERVICE_KEY']

STATUS_MAP = {
  'Transfer To IT':'IT','Acknowledge':'AK','In Progress':'IP',
  'Ready To Go Live':'LV','Transfer To Support':'SP','Closed':'CL',
  'Return To Support':'RS','Ready For Testing':'RT','Ready For UAT':'RU',
  'Return to Support':'RS','Ready for Testing':'RT','Ready for UAT':'RU'
}

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
                ('ta','AcknowledgebyAgents'),('ti','InProgressByAgent'),
                ('ts','TransferTosupportBy'),('eb','ReadyToGoLiveBy')]:
        if r.get(v): rec[k] = r[v]
    for k,v in [('u','UserName'),('p','subscriptionPlan'),('r','RM'),
                ('desc','Description'),('remarks','Remarks'),('dev','Developer'),
                ('subDisp','SubDisposition'),('mainDisp','MainDisposition'),
                ('probType','Problemtype'),('assignto','Assignto')]:
        if str(r.get(v,'')).strip(): rec[k] = str(r[v]).strip()
    if r.get('Mobile'): rec['mobile'] = str(r['Mobile']).strip()
    if r.get('Emailid','').strip(): rec['email'] = r['Emailid'].strip()

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

    rec['sc'] = STATUS_MAP.get(r.get('Status',''), 'OT')
    return rec if (a or b or c or d or e or rec['sc'] in ['RS','RT','RU']) else None

# ── Date chunks banana ─────────────────────────────────────────────────────────
def make_chunks(start_str, end_date, months=3):
    """Puri date range ko 3-3 mahine ke chunks mein todta hai"""
    chunks = []
    current = datetime.strptime(start_str, '%Y-%m-%d').date()
    while current <= end_date:
        chunk_end = min(current + relativedelta(months=months) - relativedelta(days=1), end_date)
        chunks.append((current.strftime('%Y-%m-%d'), chunk_end.strftime('%Y-%m-%d')))
        current = chunk_end + relativedelta(days=1)
    return chunks

# ── Ek chunk fetch karna ──────────────────────────────────────────────────────
def fetch_chunk(session, fdate, todate, attempt_no, total):
    url = f"{API_URL}?FDate={fdate}&ToDate={todate}&TicketNo="
    print(f"\n[Chunk {attempt_no}/{total}] {fdate} → {todate}", flush=True)
    print(f"  Fetching: {url}", flush=True)

    for try_no in range(1, 4):  # 3 chances har chunk ko
        try:
            resp = session.get(
                url,
                timeout=(60, 1800),  # connect=1min, read=30min per chunk
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
                print(f"  ⚠️ Chunk {fdate}→{todate} skip kar raha hoon!", flush=True)
                return []  # is chunk ko skip karo, baaki chalte raho

# ── Main ──────────────────────────────────────────────────────────────────────
today = date.today()
START_DATE = '2023-04-01'

# Session setup
session = requests.Session()
retry = Retry(total=0)  # Retry hum khud handle kar rahe hain
adapter = HTTPAdapter(max_retries=retry)
session.mount("https://", adapter)
session.mount("http://", adapter)

# Chunks banao
chunks = make_chunks(START_DATE, today, months=3)
print(f"Total chunks: {len(chunks)}", flush=True)
for i, (f, t) in enumerate(chunks, 1):
    print(f"  Chunk {i}: {f} → {t}", flush=True)

# Sabhi chunks fetch karo
ticket_map = {}
for i, (fdate, todate) in enumerate(chunks, 1):
    records = fetch_chunk(session, fdate, todate, i, len(chunks))
    for r in records:
        rec = parse_record(r)
        if rec and rec.get('n'):
            ticket_map[rec['n']] = rec  # duplicate ticket override hoga

    # Chunks ke beech thodi rest (server par load kam)
    if i < len(chunks):
        print(f"  Resting 5s before next chunk...", flush=True)
        time.sleep(5)

RAW = list(ticket_map.values())
print(f"\n{'='*50}", flush=True)
print(f"Total unique tickets: {len(RAW)}", flush=True)

# ── Supabase mein save ────────────────────────────────────────────────────────
supa_headers = {
    'apikey': SUPA_KEY,
    'Authorization': f'Bearer {SUPA_KEY}',
    'Content-Type': 'application/json',
    'Prefer': 'return=minimal'
}

print("Clearing old data...", flush=True)
requests.delete(f"{SUPA_URL}/rest/v1/ticket_cache?id=neq.0", headers=supa_headers, timeout=60)
print("Old data cleared!", flush=True)

payload = {
    'data': RAW,
    'total_count': len(RAW),
    'date_from': START_DATE,
    'date_to': today.strftime('%Y-%m-%d'),
    'fetched_at': datetime.now(timezone.utc).isoformat()
}
r = requests.post(f"{SUPA_URL}/rest/v1/ticket_cache", json=payload, headers=supa_headers, timeout=120)
r.raise_for_status()
print(f"✅ Saved {len(RAW)} tickets to Supabase!", flush=True)
