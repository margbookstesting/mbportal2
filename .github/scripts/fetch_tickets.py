import json, os, requests, re, time
from datetime import datetime, timezone, date
from dateutil.relativedelta import relativedelta
from requests.adapters import HTTPAdapter
from urllib3.util.retry import Retry

API_URL = 'https://bssapi.margcompusoft.com/api/MargBook/GetMBTicketStatusDetail'[cite: 1]
SUPA_URL = os.environ['SUPABASE_URL'][cite: 1]
SUPA_KEY = os.environ['SUPABASE_SERVICE_KEY'][cite: 1]

STATUS_MAP = {
  'Transfer To IT':'IT','Acknowledge':'AK','In Progress':'IP',
  'Ready To Go Live':'LV','Transfer To Support':'SP','Closed':'CL',
  'Return To Support':'RS','Ready For Testing':'RT','Ready For UAT':'RU',
  'Return to Support':'RS','Ready for Testing':'RT','Ready for UAT':'RU'
}[cite: 1]

def parse_date(v):
    if not v or v == '1900-01-01T00:00:00': return None[cite: 1]
    s = str(v).strip()[cite: 1]
    m = re.match(r'^(\d{2})-(\d{2})-(\d{4})$', s)[cite: 1]
    if m: return f"{m.group(3)}-{m.group(2)}-{m.group(1)}"[cite: 1]
    return s.split('T')[0][cite: 1]

def tat_flag(v):
    if not v: return None[cite: 1]
    s = str(v)[cite: 1]
    if 'InTAT' in s: return 'I'[cite: 1]
    if 'OutTAT' in s: return 'O'[cite: 1]
    return None[cite: 1]

def compact_tat(v):
    if not v: return None[cite: 1]
    m = re.search(r'(\d+)\s+days?\s+(\d+)\s+hours?', str(v))[cite: 1]
    return f"{m.group(1)}d {m.group(2)}h" if m else None[cite: 1]

def parse_record(r):
    rec = {}[cite: 1]
    for k,v in [('n','TicketNo'),('l','LicNo'),('q','Ack_Disp'),('t','TransferTo'),
                ('ta','AcknowledgebyAgents'),('ti','InProgressByAgent'),
                ('ts','TransferTosupportBy'),('eb','ReadyToGoLiveBy')]:[cite: 1]
        if r.get(v): rec[k] = r[v][cite: 1]
    for k,v in [('u','UserName'),('p','subscriptionPlan'),('r','RM'),
                ('desc','Description'),('remarks','Remarks'),('dev','Developer'),
                ('subDisp','SubDisposition'),('mainDisp','MainDisposition'),
                ('probType','Problemtype'),('assignto','Assignto')]:[cite: 1]
        if str(r.get(v,'')).strip(): rec[k] = str(r[v]).strip()[cite: 1]
    if r.get('Mobile'): rec['mobile'] = str(r['Mobile']).strip()[cite: 1]
    if r.get('Emailid','').strip(): rec['email'] = r['Emailid'].strip()[cite: 1]

    tld = parse_date(r.get('TimeLineDate'))[cite: 1]
    if tld: rec['tld'] = tld[cite: 1]
    tc = parse_date(r.get('TicketCreatedDate'))[cite: 1]
    if tc: rec['tc'] = tc[cite: 1]

    a = parse_date(r.get('TransfertoITDate'))[cite: 1]
    b = parse_date(r.get('AcknowledgeDate'))[cite: 1]
    c = parse_date(r.get('InProgressDate'))[cite: 1]
    d = parse_date(r.get('TransferTosupportDate'))[cite: 1]
    e = parse_date(r.get('ReadyToGoLiveDate'))[cite: 1]

    if a:
        rec['a']=a[cite: 1]
        at=tat_flag(r.get('TransferToIT_TATDetails'))[cite: 1]
        if at: rec['at']=at[cite: 1]
        av=compact_tat(r.get('TransferToIT_TATDetails'))[cite: 1]
        if av: rec['av']=av[cite: 1]
        if r.get('TransferToIT_TatDuration'): rec['ad']=str(r['TransferToIT_TatDuration'])[cite: 1]
    if b:
        rec['b']=b[cite: 1]
        bt=tat_flag(r.get('Ack_TATDetails'))[cite: 1]
        if bt: rec['bt']=bt[cite: 1]
        bv=compact_tat(r.get('Ack_TATDetails'))[cite: 1]
        if bv: rec['bv']=bv[cite: 1]
        if r.get('Ack_TatDuration'): rec['bd']=str(r['Ack_TatDuration'])[cite: 1]
    if c:
        rec['c']=c[cite: 1]
        ct=tat_flag(r.get('InProgress_TATDetails'))[cite: 1]
        if ct: rec['ct']=ct[cite: 1]
        cv=compact_tat(r.get('InProgress_TATDetails'))[cite: 1]
        if cv: rec['cv']=cv[cite: 1]
        if r.get('InProgress_TatDuration'): rec['cd']=str(r['InProgress_TatDuration'])[cite: 1]
    if d:
        rec['d']=d[cite: 1]
        dt=tat_flag(r.get('TransfertoSupport_TATDetails'))[cite: 1]
        if dt: rec['dt']=dt[cite: 1]
        dv=compact_tat(r.get('TransfertoSupport_TATDetails'))[cite: 1]
        if dv: rec['dv']=dv[cite: 1]
        if r.get('TransferToSupport_TatDuration'): rec['dd']=str(r['TransferToSupport_TatDuration'])[cite: 1]
    if e:
        rec['e']=e[cite: 1]
        et=tat_flag(r.get('ReadyToGoLive_TATDetails'))[cite: 1]
        if et: rec['et']=et[cite: 1]
        ev=compact_tat(r.get('ReadyToGoLive_TATDetails'))[cite: 1]
        if ev: rec['ev']=ev[cite: 1]

    rec['sc'] = STATUS_MAP.get(r.get('Status',''), 'OT')[cite: 1]
    return rec if (a or b or c or d or e or rec['sc'] in ['RS','RT','RU']) else None[cite: 1]

# ── Date chunks banana ─────────────────────────────────────────────────────────
def make_chunks(start_str, end_date, months=3):[cite: 1]
    """Puri date range ko 3-3 mahine ke chunks mein todta hai"""
    chunks = [][cite: 1]
    current = datetime.strptime(start_str, '%Y-%m-%d').date()[cite: 1]
    while current <= end_date:[cite: 1]
        chunk_end = min(current + relativedelta(months=months) - relativedelta(days=1), end_date)[cite: 1]
        chunks.append((current.strftime('%Y-%m-%d'), chunk_end.strftime('%Y-%m-%d')))[cite: 1]
        current = chunk_end + relativedelta(days=1)[cite: 1]
    return chunks[cite: 1]

# ── Ek chunk fetch karna ──────────────────────────────────────────────────────
def fetch_chunk(session, fdate, todate, attempt_no, total):[cite: 1]
    url = f"{API_URL}?FDate={fdate}&ToDate={todate}&TicketNo="[cite: 1]
    print(f"\n[Chunk {attempt_no}/{total}] {fdate} → {todate}", flush=True)[cite: 1]
    print(f"  Fetching: {url}", flush=True)[cite: 1]

    for try_no in range(1, 4):  # 3 chances har chunk ko[cite: 1]
        try:
            resp = session.get([cite: 1]
                url,[cite: 1]
                timeout=(60, 1800),  # connect=1min, read=30min per chunk[cite: 1]
                stream=True,[cite: 1]
                headers={[cite: 1]
                    'Accept': 'application/json',[cite: 1]
                    'User-Agent': 'Mozilla/5.0',[cite: 1]
                    'Connection': 'keep-alive',[cite: 1]
                }[cite: 1]
            )
            resp.raise_for_status()[cite: 1]
            print(f"  Response received! Reading...", flush=True)[cite: 1]

            content = b""[cite: 1]
            for chunk in resp.iter_content(chunk_size=65536):[cite: 1]
                if chunk:[cite: 1]
                    content += chunk[cite: 1]

            data = json.loads(content.decode('utf-8'))[cite: 1]

            if data.get('Status') != 'Success':[cite: 1]
                raise Exception(f"API Error: {data.get('Message')}")[cite: 1]

            records = data.get('Details', [])[cite: 1]
            print(f"  ✅ Got {len(records)} records", flush=True)[cite: 1]
            return records[cite: 1]

        except Exception as ex:[cite: 1]
            print(f"  ❌ Try {try_no}/3 failed: {ex}", flush=True)[cite: 1]
            if try_no < 3:[cite: 1]
                wait = 30 * try_no[cite: 1]
                print(f"  Waiting {wait}s...", flush=True)[cite: 1]
                time.sleep(wait)[cite: 1]
            else:[cite: 1]
                print(f"  ⚠️ Chunk {fdate}→{todate} skip kar raha hoon!", flush=True)[cite: 1]
                return []  # is chunk ko skip karo, baaki chalte raho[cite: 1]

# ── Main ──────────────────────────────────────────────────────────────────────
# GitHub Actions Matrix ke inputs read karna
if os.getenv("IS_MATRIX_RUN") == "true":
    START_DATE = os.getenv("START_DATE_OVERRIDE")
    target_end = datetime.strptime(os.getenv("END_DATE_OVERRIDE"), '%Y-%m-%d').date()
    today = min(date.today(), target_end)
else:
    # Local fallback
    START_DATE = '2023-04-01'[cite: 1]
    today = date.today()[cite: 1]

# Session setup
session = requests.Session()[cite: 1]
retry = Retry(total=0)  # Retry hum khud handle kar rahe hain[cite: 1]
adapter = HTTPAdapter(max_retries=retry)[cite: 1]
session.mount("https://", adapter)[cite: 1]
session.mount("http://", adapter)[cite: 1]

# Chunks banao
chunks = make_chunks(START_DATE, today, months=3)[cite: 1]
print(f"Total chunks for this matrix run: {len(chunks)}", flush=True)
for i, (f, t) in enumerate(chunks, 1):[cite: 1]
    print(f"  Chunk {i}: {f} → {t}", flush=True)[cite: 1]

# Sabhi chunks fetch karo
ticket_map = {}[cite: 1]
for i, (fdate, todate) in enumerate(chunks, 1):[cite: 1]
    records = fetch_chunk(session, fdate, todate, i, len(chunks))[cite: 1]
    for r in records:[cite: 1]
        rec = parse_record(r)[cite: 1]
        if rec and rec.get('n'):[cite: 1]
            ticket_map[rec['n']] = rec  # duplicate ticket override hoga[cite: 1]

    # Chunks ke beech thodi rest (server par load kam)
    if i < len(chunks):[cite: 1]
        print(f"  Resting 5s before next chunk...", flush=True)[cite: 1]
        time.sleep(5)[cite: 1]

RAW = list(ticket_map.values())[cite: 1]
print(f"\n{'='*50}", flush=True)[cite: 1]
print(f"Total unique tickets in this chunk: {len(RAW)}", flush=True)

if not RAW:
    print("Is date range me koi records nahi mile. Task finished gracefully.", flush=True)
    exit(0)

# ── Supabase mein Upsert ──────────────────────────────────────────────────────
supa_headers = {[cite: 1]
    'apikey': SUPA_KEY,[cite: 1]
    'Authorization': f'Bearer {SUPA_KEY}',[cite: 1]
    'Content-Type': 'application/json',[cite: 1]
    # 'resolution=merge-duplicates' lagaya hai taki multiple parallel workers ek doosre ka data delete na karein
    'Prefer': 'resolution=merge-duplicates' 
}[cite: 1]

# NOTE: Purane data ko delete karne wala requests.delete hata diya hai taki parallel runs safe rahein.[cite: 1]

payload = {[cite: 1]
    'data': RAW,[cite: 1]
    'total_count': len(RAW),[cite: 1]
    'date_from': START_DATE,[cite: 1]
    'date_to': today.strftime('%Y-%m-%d'),[cite: 1]
    'fetched_at': datetime.now(timezone.utc).isoformat()[cite: 1]
}[cite: 1]

print("Saving/Merging data into Supabase...", flush=True)
r = requests.post(f"{SUPA_URL}/rest/v1/ticket_cache", json=payload, headers=supa_headers, timeout=120)[cite: 1]
r.raise_for_status()[cite: 1]
print(f"✅ Safely merged {len(RAW)} tickets to Supabase!", flush=True)[cite: 1]
