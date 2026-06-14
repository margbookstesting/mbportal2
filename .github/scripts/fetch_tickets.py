import json, os, requests, re
from datetime import datetime, timezone

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

# Step 1: API fetch
today = datetime.now(timezone.utc).strftime('%Y-%m-%d')
url = f"{API_URL}?FDate=2023-04-01&ToDate={today}&TicketNo="
print(f"Fetching: {url}")

resp = requests.get(url, timeout=1200, headers={
    'Accept': 'application/json',
    'User-Agent': 'Mozilla/5.0'
})
resp.raise_for_status()
data = resp.json()

if data.get('Status') != 'Success':
    raise Exception(f"API Error: {data.get('Message')}")

details = data.get('Details', [])
print(f"API records: {len(details)}")

# Step 2: Parse
ticket_map = {}
for r in details:
    rec = parse_record(r)
    if rec and rec.get('n'):
        ticket_map[rec['n']] = rec
RAW = list(ticket_map.values())
print(f"Unique tickets: {len(RAW)}")

# Step 3: Save to Supabase
headers = {
    'apikey': SUPA_KEY,
    'Authorization': f'Bearer {SUPA_KEY}',
    'Content-Type': 'application/json',
    'Prefer': 'return=minimal'
}

# Delete old
requests.delete(f"{SUPA_URL}/rest/v1/ticket_cache?id=neq.0", headers=headers)
print("Old data cleared")

# Insert new
payload = {
    'data': RAW,
    'total_count': len(RAW),
    'date_from': '2023-04-01',
    'date_to': today,
    'fetched_at': datetime.now(timezone.utc).isoformat()
}
r = requests.post(f"{SUPA_URL}/rest/v1/ticket_cache", json=payload, headers=headers)
r.raise_for_status()
print(f"✅ Saved {len(RAW)} tickets to Supabase!")
