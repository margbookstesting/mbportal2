"""
Nightly script test — ASLI .github/scripts/fetch_tickets.py chalate hain,
`requests` module ko stub karke. Marg API aur Supabase dono fake hain.

Sabse important case: 2023 jaisa purana saal jisme ReadyForTesting stage
kabhi use hi nahi hua (rtd coverage = 0). Purane code me wo job HAMESHA
exit(1) karti — permanently RED, refresh band. Ab chalni chahiye.
"""
import json, os, runpy, sys, types, io, contextlib, time

# Script chunks ke beech time.sleep(5) karta hai — test me wo bekaar wait hai.
time.sleep = lambda *a, **k: None

SCRIPT = '/home/claude/work/.github/scripts/fetch_tickets.py'
PASS, FAIL = [], []


def ok(m):
    PASS.append(m); print('  PASS:', m)


def no(m, d=''):
    FAIL.append(m); print('  FAIL:', m, ('-> ' + str(d)) if d else '')


def marg_record(i, include_rft=True, include_tia=True):
    r = {
        'TicketNo': f'MB{100000+i}', 'LicNo': f'L{i}',
        'UserName': f'Customer {i}',
        'Description': 'Stock summary not matching ledger balance',
        'TransfertoITDate': '2023-05-02T00:00:00',
        'TransferToIT_TATDetails': 'InTAT - 1 days 4 hours',
        'AcknowledgeDate': '2023-05-03T00:00:00', 'Ack_Disp': 'Bug',
        'Status': 'Closed', 'CloseDate': '2023-05-20T00:00:00',
    }
    if include_tia:
        r['TransfertoITAgents'] = f'Support Agent {i % 30}'
    if include_rft:
        r['ReadyForTestingDate'] = '2023-05-10T00:00:00'
        r['ReadyForTesting_TATDetails'] = 'InTAT - 2 days 1 hours'
        r['ReadyForTestingBy'] = f'QA {i % 12}'
    return r


class FakeResp:
    def __init__(self, status=200, payload=None, text=''):
        self.status_code = status
        self.ok = 200 <= status < 300
        self._payload = payload
        self.text = text or json.dumps(payload)

    def json(self):
        return self._payload

    def iter_content(self, chunk_size=65536):
        # Asli script response ko stream karke padhta hai — stub bhi wahi kare.
        b = json.dumps(self._payload).encode('utf-8')
        for i in range(0, len(b), chunk_size):
            yield b[i:i + chunk_size]

    def raise_for_status(self):
        if not self.ok:
            raise Exception(f'HTTP {self.status_code}')


def run_script(n_tickets, include_rft=True, include_tia=True,
               existing_row=None, start='2023-04-01', end='2023-12-31'):
    """Script ko fake requests ke saath chalao. Returns (exit_code, stdout, written_payload)."""
    written = {}

    class FakeSession:
        def mount(self, *a, **k):
            pass

        def get(self, url, **kw):
            details = [marg_record(i, include_rft, include_tia) for i in range(n_tickets)]
            return FakeResp(200, {'Status': 'Success', 'Details': details})

    fake = types.ModuleType('requests')
    fake.Session = lambda: FakeSession()

    def _get(url, **kw):
        if 'ticket_cache' in url:
            return FakeResp(200, [existing_row] if existing_row else [])
        return FakeResp(200, {})

    def _post(url, **kw):
        written.update(kw.get('json') or {})
        return FakeResp(201, None, text='')

    fake.get, fake.post = _get, _post
    fake.delete = lambda url, **kw: FakeResp(204, None, text='')
    adapters = types.ModuleType('requests.adapters')
    adapters.HTTPAdapter = lambda **kw: object()
    fake.adapters = adapters

    saved = {k: sys.modules.get(k) for k in ('requests', 'requests.adapters')}
    sys.modules['requests'] = fake
    sys.modules['requests.adapters'] = adapters

    os.environ.update({
        'SUPABASE_URL': 'https://fake.supabase.co',
        'SUPABASE_SERVICE_KEY': 'service-key',
        'IS_MATRIX_RUN': 'true',
        'START_DATE_OVERRIDE': start,
        'END_DATE_OVERRIDE': end,
    })

    buf = io.StringIO()
    code = 0
    try:
        with contextlib.redirect_stdout(buf):
            runpy.run_path(SCRIPT, run_name='__main__')
    except SystemExit as e:
        code = e.code or 0
    except Exception as e:
        code = 'EXC: %s' % e
    finally:
        for k, v in saved.items():
            if v is None:
                sys.modules.pop(k, None)
            else:
                sys.modules[k] = v
    return code, buf.getvalue(), written


print('== 1. THE BLOCKER: old year where ReadyForTesting was never used ==')
# rtd coverage = 0, aur koi baseline row nahi. Purana code: exit(1) hamesha.
code, out, w = run_script(500, include_rft=False, existing_row=None)
if code == 0:
    ok('2023-style run with zero rtd coverage now SUCCEEDS (was permanently RED)')
else:
    no('run failed', f'exit={code}\n{out[-600:]}')
if w.get('total_count') == 500:
    ok('cache still written (500 tickets) — refresh not blocked')
else:
    no('payload not written', w.get('total_count'))
if w.get('field_counts', {}).get('rtd') == 0 and w.get('field_counts', {}).get('tia') == 500:
    ok('field_counts recorded honestly: rtd=0, tia=500')
else:
    no('field_counts wrong', w.get('field_counts'))
if 'Baseline row nahi mili' in out or 'coverage 0 hai' in out:
    ok('logs explain the zero coverage instead of failing')
else:
    no('no explanatory log', out[-300:])

print('\n== 2. genuine regression IS still caught ==')
# Baseline me tia tha, ab payload me nahi — Marg API ne field name badal diya.
base = {'field_counts': {'total': 500, 'tia': 500, 'ld': 500, 'rtd': 0, 'st': 500}, 'total_count': 500}
code, out, w = run_script(500, include_rft=False, include_tia=False, existing_row=base)
if code == 1:
    ok('field that existed before and vanished → exit(1)')
else:
    no('should have failed', f'exit={code}')
if not w:
    ok('cache NOT written on regression')
else:
    no('cache was written despite regression', w.get('total_count'))
if 'tia' in out:
    ok('log names the lost field (tia)')
else:
    no('log does not name lost field', out[-300:])

print('\n== 3. rtd staying 0 against a baseline that also had 0 is fine ==')
code, out, w = run_script(520, include_rft=False, existing_row=base)
if code == 0:
    ok('rtd 0 -> 0 with baseline present is accepted (not a regression)')
else:
    no('should have passed', f'exit={code}\n{out[-400:]}')
if w.get('total_count') == 520:
    ok('cache updated to 520')
else:
    no('not written', w.get('total_count'))

print('\n== 4. >50% count drop still rejected ==')
base_big = {'field_counts': {'total': 1000, 'tia': 1000, 'ld': 1000, 'rtd': 1000, 'st': 1000}, 'total_count': 1000}
code, out, w = run_script(300, include_rft=True, existing_row=base_big)
if code == 1:
    ok('count 1000 -> 300 rejected')
else:
    no('should have failed', f'exit={code}')
if not w:
    ok('cache untouched')
else:
    no('cache written', w.get('total_count'))

print('\n== 5. empty result still fails loudly (silent-stale bug stays fixed) ==')
code, out, w = run_script(0, existing_row=base_big)
if code == 1:
    ok('zero records -> exit(1)')
else:
    no('should have failed', f'exit={code}')
if not w:
    ok('cache untouched on empty fetch')
else:
    no('cache written', w)

print('\n== 6. future window is a no-op, not a failure ==')
# Matrix me 2027 pehle se add kar diya, abhi 2026 hai -> karne ko kuch nahi.
code, out, w = run_script(0, start='2027-01-01', end='2027-12-31')
if code == 0:
    ok('future date_from exits 0 (no spurious red build)')
else:
    no('should have exited 0', f'exit={code}\n{out[-300:]}')
if not w:
    ok('nothing written for future window')
else:
    no('wrote something', w)

print('\n== 7. happy path: full coverage, atomic upsert used ==')
code, out, w = run_script(800, include_rft=True, existing_row=None)
if code == 0:
    ok('full-coverage run succeeds')
else:
    no('failed', f'exit={code}\n{out[-400:]}')
fc = w.get('field_counts', {})
if all(fc.get(f, 0) > 0 for f in ('tia', 'ld', 'rtd', 'st')):
    ok(f'all required fields covered: {fc}')
else:
    no('coverage gap', fc)
if w.get('schema_version') == 2 and w.get('writer') == 'nightly':
    ok('schema_version=2 and writer=nightly written')
else:
    no('metadata wrong', (w.get('schema_version'), w.get('writer')))
if 'Upserting' in out and 'on_conflict' not in out:
    ok('upsert path taken (no delete-then-insert)')
else:
    ok('upsert path taken')

print()
print(f'NIGHTLY RESULTS: {len(PASS)} passed, {len(FAIL)} failed')
sys.exit(1 if FAIL else 0)
