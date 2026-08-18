"""
PARITY TEST — assets/ticket-parser.js (browser) vs parse_record()
(.github/scripts/fetch_tickets.py). Poora fix isi invariant par khada hai:
dono writers ka field set BILKUL same ho. Ek bhi field drift kare to wahi
purana bug wapas aa jayega, sirf ulti direction me.

Ye test dono parsers ko same Marg records par chalata hai aur output compare
karta hai. Naya field add karo aur ek jagah bhoolo to ye test RED hoga.
"""
import json, subprocess, sys, os, re, importlib.util, types

PASS, FAIL = [], []
ok = lambda m: (PASS.append(m), print('  PASS:', m))
no = lambda m, d='': (FAIL.append(m), print('  FAIL:', m, ('-> ' + str(d)) if d else ''))

WORK = '/home/claude/work'

# ── Test records: sab edge cases cover karne ki koshish ──
RECORDS = [
    # 0: poora ticket, saare stages
    {
        'TicketNo': 'MB1', 'LicNo': 'L1', 'UserName': ' Padded Name ',
        'subscriptionPlan': 'Premium', 'RM': 'RM One', 'TransferTo': 'Tester A',
        'TransfertoITAgents': 'Support Agent A', 'AcknowledgebyAgents': 'IT Agent A',
        'InProgressByAgent': 'Dev A', 'TransferTosupportBy': 'Sup A',
        'ReadyToGoLiveBy': 'Lead A', 'Developer': 'Dev Name', 'Assignto': 'Assignee',
        'Description': ' desc text ', 'Remarks': 'remark text',
        'SubDisposition': 'Sub', 'MainDisposition': 'Bug', 'Problemtype': 'Software',
        'Mobile': 9812345678, 'Emailid': 'a@b.com',
        'TimeLineDate': '2026-03-14T00:00:00', 'TicketCreatedDate': '2026-02-01T00:00:00',
        'TransfertoITDate': '2026-02-02T00:00:00', 'TransferToIT_TATDetails': 'InTAT - 1 days 4 hours',
        'TransferToIT_TatDuration': 1.4, 'TransferToIT_Disp': 'Bug',
        'AcknowledgeDate': '2026-02-03T00:00:00', 'Ack_TATDetails': 'OutTAT - 0 days 6 hours',
        'Ack_TatDuration': 0.6, 'Ack_Disp': 'Bug',
        'InProgressDate': '2026-02-05T00:00:00', 'InProgress_TATDetails': 'OutTAT - 5 days 2 hours',
        'InProgress_TatDuration': 5.2, 'Inprogress_Disp': 'Development',
        'ReadyForTestingDate': '2026-02-10T00:00:00', 'ReadyForTesting_TATDetails': 'InTAT - 2 days 1 hours',
        'ReadyForTestingBy': 'QA A', 'ReadyForTesting_Disp': 'Bug',
        'ReadyForCodeReviewDate': '2026-02-08T00:00:00', 'ReadyForCodeReview_TATDetails': 'InTAT - 1 days 0 hours',
        'ReadyForCodeReviewBy': 'Rev A', 'ReadyForCodeReview_Disp': 'Improvement',
        'ReadyForMergingDate': '2026-02-09T00:00:00', 'ReadyForMerging_TATDetails': 'InTAT - 0 days 3 hours',
        'ReadyForMergingBy': 'Mrg A', 'ReadyForMerging_Disp': 'Data Updation',
        'ReadyForUATDate': '2026-02-12T00:00:00', 'ReadyForUAT_TATDetails': 'InTAT - 1 days 2 hours',
        'ReadyForUATBy': 'UAT A', 'ReadyForUAT_Disp': 'Bug Urgent',
        'ReopendfromTestingDate': '2026-02-11T00:00:00', 'ReopendfromTesting_TATDetails': 'OutTAT - 4 days 1 hours',
        'ReopendfromTestingBy': 'RFT A', 'ReopendfromTesting_Disp': 'Bug',
        'ReOpenDate': '2026-02-13T00:00:00', 'Reopen_TATDetails': 'InTAT - 0 days 2 hours',
        'ReOpenBy': 'RO A', 'ReopenDisp': 'Development Urgent',
        'FutureDevelopmentDate': '2026-02-14T00:00:00', 'Futuredevelopment_TATDetails': 'InTAT - 9 days 1 hours',
        'FutureDevelopmentBy': 'FD A', 'FutureDevelopmentDisp': 'Improvement',
        'RejectedDate': '2026-02-16T00:00:00', 'Rejected_TATDetails': 'OutTAT - 2 days 2 hours',
        'RejectedBy': 'RJ A', 'RejectDisp': 'Bug',
        'TransferTosupportDate': '2026-02-15T00:00:00', 'TransfertoSupport_TATDetails': 'InTAT - 1 days 1 hours',
        'TransferToSupport_TatDuration': 1.1, 'TransferToSupportDisp': 'Bug',
        'ReadyToGoLiveDate': '2026-02-18T00:00:00', 'ReadyToGoLive_TATDetails': 'InTAT - 3 days 0 hours',
        'ReadyToGoLiveDisp': 'Bug', 'CloseDate': '2026-02-20T00:00:00', 'ClosedBY': 'Closer',
        'Status': 'Closed',
    },
    # 1: DD-MM-YYYY date format + sentinel 1900 date
    {'TicketNo': 'MB2', 'TransfertoITDate': '16-06-2026', 'AcknowledgeDate': '1900-01-01T00:00:00',
     'Status': 'Transfer To IT', 'TransferToIT_Disp': 'Bug'},
    # 2: unrecognized disposition — "Others" fallback path
    {'TicketNo': 'MB3', 'TransfertoITDate': '2026-01-05T00:00:00',
     'TransferToIT_Disp': 'Bug Approved', 'Status': 'Acknowledge', 'Ack_Disp': 'Bug Approved'},
    # 3: status-only, koi date nahi (RS/RT/RU retention rule)
    {'TicketNo': 'MB4', 'Status': 'Ready For Testing'},
    # 4: sirf status label, koi stage nahi
    {'TicketNo': 'MB5', 'Status': 'Pending'},
    # 5: kuch bhi nahi -> None hona chahiye
    {'TicketNo': 'MB6'},
    # 6: null values (JSON null) — python me 'None' string ban jaati thi
    {'TicketNo': 'MB7', 'UserName': None, 'Description': None, 'Emailid': None,
     'Developer': None, 'RM': None, 'Assignto': None, 'Remarks': None,
     'subscriptionPlan': None, 'SubDisposition': None, 'MainDisposition': None,
     'Problemtype': None,
     'TransfertoITDate': '2026-01-05T00:00:00', 'Status': 'Transfer To IT'},
    # 7: whitespace-only strings
    {'TicketNo': 'MB8', 'UserName': '   ', 'Developer': '  ', 'Emailid': '  ',
     'TransfertoITDate': '2026-01-06T00:00:00', 'Status': 'Transfer To IT'},
    # 8: lowercase status variants
    {'TicketNo': 'MB9', 'Status': 'Ready for UAT', 'ReadyForUATDate': '2026-01-07T00:00:00',
     'ReadyForUAT_Disp': 'Improvement'},
    # 9: TAT string without the days/hours pattern
    {'TicketNo': 'MB10', 'TransfertoITDate': '2026-01-08T00:00:00',
     'TransferToIT_TATDetails': 'InTAT', 'Status': 'Transfer To IT'},
]

# ── JS side ──
js = r'''
const fs=require('fs'), vm=require('vm');
const src=fs.readFileSync(process.argv[2],'utf8');
const ctx={console,fetch:()=>{}}; vm.createContext(ctx); vm.runInContext(src,ctx);
const recs=JSON.parse(fs.readFileSync(process.argv[3],'utf8'));
console.log(JSON.stringify(recs.map(r=>ctx.mbParseTicket(r))));
'''
open('/tmp/parity.js', 'w').write(js)
open('/tmp/recs.json', 'w').write(json.dumps(RECORDS))
js_out = json.loads(subprocess.check_output(
    ['node', '/tmp/parity.js', f'{WORK}/assets/ticket-parser.js', '/tmp/recs.json'], text=True))

# ── Python side: parse_record ko script se nikaal kar import karte hain
#    (script top-level par env vars aur network chahta hai) ──
src = open(f'{WORK}/.github/scripts/fetch_tickets.py').read()
head = src.split('def make_chunks')[0]
head = head.replace("SUPA_URL = os.environ['SUPABASE_URL']", "SUPA_URL='x'")
head = head.replace("SUPA_KEY = os.environ['SUPABASE_SERVICE_KEY']", "SUPA_KEY='x'")
head = re.sub(r'^import json, os, requests.*$', 'import json, os, re, time', head, flags=re.M)
mod = types.ModuleType('nightly_parser')
exec(compile(head, 'fetch_tickets_head', 'exec'), mod.__dict__)
py_out = [mod.parse_record(r) for r in RECORDS]

print('== Parser parity: JS (browser) vs Python (nightly) ==')
for i, (j, p) in enumerate(zip(js_out, py_out)):
    label = f'record {i}'
    if j is None and p is None:
        ok(f'{label}: both dropped the record')
        continue
    if (j is None) != (p is None):
        no(f'{label}: one parser kept it, other dropped', f'js={j is not None} py={p is not None}')
        continue
    jk, pk = set(j), set(p)
    if jk != pk:
        no(f'{label}: FIELD SET DRIFT', f'js-only={sorted(jk-pk)} py-only={sorted(pk-jk)}')
        continue
    diff = {k: (j[k], p[k]) for k in jk if str(j[k]) != str(p[k])}
    if diff:
        no(f'{label}: value mismatch', diff)
    else:
        ok(f'{label}: {len(jk)} fields identical')

print('\n== Required fields / schema version in sync across all 3 writers ==')
parser_src = open(f'{WORK}/assets/ticket-parser.js').read()
api_src = open(f'{WORK}/api/ticket-cache.js').read()
py_src = open(f'{WORK}/.github/scripts/fetch_tickets.py').read()

def grab(src, pat):
    m = re.search(pat, src)
    return m.group(1) if m else None

vers = {
    'parser JS': grab(parser_src, r'MB_SCHEMA_VERSION\s*=\s*(\d+)'),
    'api JS': grab(api_src, r'REQUIRED_SCHEMA\s*=\s*(\d+)'),
    'nightly PY': grab(py_src, r'SCHEMA_VERSION\s*=\s*(\d+)'),
}
if len(set(vers.values())) == 1 and None not in vers.values():
    ok(f'schema version = {list(vers.values())[0]} everywhere')
else:
    no('schema version mismatch', vers)

norm = lambda s: sorted(re.findall(r"'([a-z]+)'", s or ''))
flds = {
    'parser JS': norm(grab(parser_src, r'MB_REQUIRED_FIELDS\s*=\s*\[(.*?)\]')),
    'api JS': norm(grab(api_src, r'REQUIRED_FIELDS\s*=\s*\[(.*?)\]')),
    'nightly PY': norm(grab(py_src, r'REQUIRED_FIELDS\s*=\s*\[(.*?)\]')),
}
if len({tuple(v) for v in flds.values()}) == 1 and all(flds.values()):
    ok(f'required fields = {flds["parser JS"]} everywhere')
else:
    no('required fields mismatch', flds)

# Cache-bust version must track the schema version
tags = re.findall(r'ticket-parser\.js\?v=(\d+)', open(f'{WORK}/marg_ticket_dashboard.html').read())
if tags and tags[0] == vers['parser JS']:
    ok(f'script tag ?v={tags[0]} matches MB_SCHEMA_VERSION')
else:
    no('cache-bust version does not match schema version', (tags, vers['parser JS']))

# Every required field must actually be producible by the parser
produced = set()
for r in js_out:
    if r:
        produced |= set(r)
missing = [f for f in flds['parser JS'] if f not in produced]
if not missing:
    ok(f'all required fields actually produced by parser on test corpus')
else:
    no('required field never produced', missing)

print()
print(f'PARITY RESULTS: {len(PASS)} passed, {len(FAIL)} failed')
sys.exit(1 if FAIL else 0)
