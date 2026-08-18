// End-to-end test: browser ka mbCacheWrite → asli api/ticket-cache.js handler.
// Supabase HTTP calls mock ki gayi hain; parser aur handler ASLI files se load
// ho rahe hain (koi copy-paste nahi), taaki test real code ko hi verify kare.
const fs = require('fs');
const vm = require('vm');
const zlib = require('zlib');

const SCHEMA = require('/home/claude/work/assets/ticket-parser.js').MB_SCHEMA_VERSION;
const PASS = []; const FAIL = [];
const ok = m => { PASS.push(m); console.log('  PASS:', m); };
const no = (m, d) => { FAIL.push(m); console.log('  FAIL:', m, d === undefined ? '' : '→ ' + d); };
const eq = (a, b, m) => (a === b ? ok(m) : no(m, `got ${JSON.stringify(a)}, want ${JSON.stringify(b)}`));

// ── Browser environment shim: CompressionStream, Blob, Response, btoa ──
// Node 18+ me ye sab global hain, exactly Chrome jaisa behaviour.
const parserSrc = fs.readFileSync('/home/claude/work/assets/ticket-parser.js', 'utf8');
const browser = {
  console, fetch: null, Blob, Response, CompressionStream,
  btoa: s => Buffer.from(s, 'binary').toString('base64'),
};
vm.createContext(browser);
vm.runInContext(parserSrc, browser);

// ── Fake Supabase (in-memory ticket_cache) ──
let db = {};              // date_from -> row
let calls = [];
function fakeSupabase(url, opts = {}) {
  calls.push((opts.method || 'GET') + ' ' + url);
  const method = opts.method || 'GET';

  if (url.includes('/auth/v1/user')) {
    const tok = (opts.headers.Authorization || '').replace('Bearer ', '');
    if (tok === 'good-token' || tok === 'admin-token')
      return resp(200, { id: tok === 'admin-token' ? 'admin-uid' : 'user-uid' });
    return resp(401, { error: 'bad jwt' });
  }
  if (url.includes('/rest/v1/users')) {
    if (url.includes('admin-uid')) return resp(200, [{ role: 'admin', dashboards: [] }]);
    if (url.includes('nobody-uid')) return resp(200, []);
    return resp(200, [{ role: 'user', dashboards: ['tat'] }]);
  }
  if (url.includes('/rest/v1/ticket_cache') && method === 'GET') {
    const m = url.match(/date_from=eq\.([0-9-]+)/);
    const row = m && db[m[1]];
    return resp(200, row ? [{ field_counts: row.field_counts, total_count: row.total_count, schema_version: row.schema_version }] : []);
  }
  if (url.includes('/rest/v1/ticket_cache') && method === 'POST') {
    const b = JSON.parse(opts.body);
    db[b.date_from] = b;             // unique(date_from) upsert simulate
    return resp(201, null);
  }
  return resp(404, { error: 'unmocked ' + url });
}
const resp = (status, body) => Promise.resolve({
  ok: status >= 200 && status < 300, status,
  text: () => Promise.resolve(body === null ? '' : JSON.stringify(body)),
});

// ── Load the REAL handler with fetch + env stubbed ──
process.env.SUPABASE_SERVICE_KEY = 'service-key';
global.fetch = fakeSupabase;
delete require.cache[require.resolve('/home/claude/work/api/ticket-cache.js')];
const handler = require('/home/claude/work/api/ticket-cache.js');

// Minimal Vercel req/res
function mkRes() {
  const r = { _s: 0, _j: null };
  r.status = c => { r._s = c; return r; };
  r.json = o => { r._j = o; return r; };
  return r;
}
async function callApi(bodyStr, token = 'good-token') {
  const req = { method: 'POST', headers: { authorization: 'Bearer ' + token }, body: bodyStr };
  const res = mkRes();
  await handler(req, res);
  return res;
}

// ── Build realistic records with the REAL parser ──
function rec(i, over = {}) {
  return Object.assign({
    TicketNo: 'MB' + (100000 + i), LicNo: 'L' + i,
    UserName: 'Customer Name Number ' + i,
    TransfertoITAgents: 'Support Agent ' + (i % 30),
    Description: 'Stock summary not matching ledger balance for FY, reproduced on build 12.4.8, sequence ' + i,
    Remarks: 'Discussed with customer, shared workaround, permanent fix pending from dev team.',
    TransfertoITDate: '2026-02-02T00:00:00', TransferToIT_TATDetails: 'InTAT - 1 days 4 hours',
    AcknowledgeDate: '2026-02-03T00:00:00', Ack_Disp: 'Bug',
    ReadyForTestingDate: '2026-02-10T00:00:00', ReadyForTesting_TATDetails: 'InTAT - 2 days 1 hours',
    ReadyForTestingBy: 'QA ' + (i % 12),
    Status: 'Closed', CloseDate: '2026-02-20T00:00:00', ClosedBY: 'Closer ' + (i % 15),
  }, over);
}
const parse = n => Array.from({ length: n }, (_, i) => browser.mbParseTicket(rec(i))).filter(Boolean);

// mbCacheWrite ko chalane ke liye fake supabase-js client (session token dene wala)
const sbClient = { auth: { getSession: async () => ({ data: { session: { access_token: 'good-token' } } }) } };

// mbCacheWrite ka fetch('/api/ticket-cache') intercept karke asli handler par bhejte hain
let lastBody = null;
browser.fetch = async (url, opts) => {
  lastBody = opts.body;
  const res = await callApi(opts.body, (opts.headers.Authorization || '').replace('Bearer ', ''));
  return { ok: res._s >= 200 && res._s < 300, status: res._s, json: async () => res._j };
};

(async () => {
  console.log('== 1. gzip round-trip: client compresses, server decompresses ==');
  db = {};
  // 12,000 records ka size chuna hai kyunki is test ke synthetic records asli
  // Marg records se halke hain (~450B vs measured ~1414B). Asli data me ~3,300
  // tickets par hi 4.5MB limit hit hota hai — dekho tests/size_probe.js.
  const data5000 = parse(12000);
  const rawSize = Buffer.byteLength(JSON.stringify({ data: data5000 }));
  const out = await browser.mbCacheWrite(sbClient, {
    writer: 'marg-dashboard', dateFrom: '2026-01-01', dateTo: '2026-08-17', data: data5000,
  });
  const sentSize = Buffer.byteLength(lastBody);
  const env = JSON.parse(lastBody);
  ok(`12000 tickets: raw ${(rawSize/1048576).toFixed(2)}MB → sent ${(sentSize/1048576).toFixed(2)}MB (${(rawSize/sentSize).toFixed(1)}x)`);
  eq(env.gz !== undefined, true, 'client sent gz field (not raw data)');
  eq(env.data, undefined, 'client did NOT send raw data alongside gz');
  eq(sentSize < 4.5 * 1048576, true, 'body under 4.5MB Vercel limit');
  eq(rawSize > 4.5 * 1048576, true, 'and raw JSON would have EXCEEDED it (old code broke here)');
  eq(out.count, 12000, 'server reports all 12000 records stored');
  eq(db['2026-01-01'].data.length, 12000, 'DB row holds all 12000 records after gunzip');
  eq(db['2026-01-01'].data[0].n, data5000[0].n, 'first record survived round-trip intact');
  eq(JSON.stringify(db['2026-01-01'].data) === JSON.stringify(data5000), true, 'payload byte-identical after gzip round-trip');
  eq(db['2026-01-01'].schema_version, SCHEMA, `schema_version written (v${SCHEMA})`);
  eq(db['2026-01-01'].writer, 'marg-dashboard', 'writer recorded');
  eq(db['2026-01-01'].field_counts.tia > 0, true, 'field_counts.tia > 0');
  eq(db['2026-01-01'].field_counts.rtd > 0, true, 'field_counts.rtd > 0');

  console.log('\n== 2. uncompressed fallback still accepted (old browsers) ==');
  db = {};
  const small = parse(50);
  let r = await callApi(JSON.stringify({
    writer: 'support-dashboard', date_from: '2026-01-01', date_to: '2026-08-17',
    schema_version: SCHEMA, data: small,
  }));
  eq(r._s, 200, 'raw data path accepted');
  eq(db['2026-01-01'].data.length, 50, 'raw data stored');

  console.log('\n== 3. gz abuse / corruption rejected ==');
  db = {};
  r = await callApi(JSON.stringify({ writer: 'nightly', date_from: '2026-01-01', schema_version: SCHEMA, gz: 'not-valid-gzip!!' }));
  eq(r._s, 400, 'corrupt gz rejected with 400');
  r = await callApi(JSON.stringify({ writer: 'nightly', date_from: '2026-01-01', schema_version: SCHEMA, gz: zlib.gzipSync('{not json').toString('base64') }));
  eq(r._s, 400, 'gz decompressing to invalid JSON rejected');
  r = await callApi(JSON.stringify({
    writer: 'nightly', date_from: '2026-01-01', schema_version: SCHEMA,
    gz: zlib.gzipSync(JSON.stringify(parse(10))).toString('base64'), count: 999,
  }));
  eq(r._s, 400, 'count mismatch (truncated upload) rejected');
  r = await callApi(JSON.stringify({ writer: 'nightly', date_from: '2026-01-01', schema_version: SCHEMA, gz: 'x', data: [{n:'1'}] }));
  eq(r._s, 400, 'sending both gz and data rejected');
  // Compression bomb: 200MB of zeros compresses tiny
  const bomb = zlib.gzipSync(Buffer.alloc(200 * 1024 * 1024, 0x20)).toString('base64');
  ok(`compression bomb: 200MB payload → ${(Buffer.byteLength(bomb)/1024).toFixed(0)}KB body`);
  r = await callApi(JSON.stringify({ writer: 'nightly', date_from: '2026-01-01', schema_version: SCHEMA, gz: bomb }));
  eq(r._s, 400, 'compression bomb rejected by maxOutputLength (not OOM)');
  eq(Object.keys(db).length, 0, 'cache untouched by every rejected request');

  console.log('\n== 4. original guards still work through the gzip path ==');
  db = {};
  await browser.mbCacheWrite(sbClient, { writer: 'marg-dashboard', dateFrom: '2026-01-01', dateTo: '2026-08-17', data: parse(1000) });
  const baseline = db['2026-01-01'].field_counts;
  eq(baseline.tia, 1000, 'baseline has tia on all 1000');

  // Support-dashboard's OLD parser dropped `tia` — simulate that regression
  const stripped = parse(1000).map(t => { const c = { ...t }; delete c.tia; return c; });
  let threw = null;
  try { await browser.mbCacheWrite(sbClient, { writer: 'support-dashboard', dateFrom: '2026-01-01', dateTo: '2026-08-17', data: stripped }); }
  catch (e) { threw = e.message; }
  eq(threw !== null, true, 'payload missing tia was REJECTED (the original bug)');
  eq(/tia/.test(threw || ''), true, 'error names the lost field');
  eq(db['2026-01-01'].field_counts.tia, 1000, 'cache still has tia — nothing overwritten');

  threw = null;
  try { await browser.mbCacheWrite(sbClient, { writer: 'marg-dashboard', dateFrom: '2026-01-01', dateTo: '2026-08-17', data: parse(400) }); }
  catch (e) { threw = e.message; }
  eq(threw !== null, true, '>50% count drop rejected');
  eq(db['2026-01-01'].total_count, 1000, 'cache count unchanged after rejection');

  // A legitimate growth write must still succeed
  const grown = parse(1100);
  await browser.mbCacheWrite(sbClient, { writer: 'support-dashboard', dateFrom: '2026-01-01', dateTo: '2026-08-17', data: grown });
  eq(db['2026-01-01'].total_count, 1100, 'legitimate growing write accepted');

  console.log('\n== 5. auth + schema guards ==');
  db = {};
  const body = JSON.stringify({ writer: 'nightly', date_from: '2026-01-01', schema_version: SCHEMA, data: parse(10) });
  eq((await callApi(body, 'bad-token'))._s, 401, 'invalid session → 401');
  eq((await callApi(body, ''))._s, 401, 'missing token → 401');
  r = await callApi(JSON.stringify({ writer: 'nightly', date_from: '2026-01-01', schema_version: SCHEMA - 1, data: parse(10) }));
  eq(r._s, 400, 'stale schema_version → 400');
  eq(/hard-refresh/i.test(r._j.error), true, 'mismatch error tells user to hard-refresh');
  eq((await callApi(JSON.stringify({ writer: 'evil', date_from: '2026-01-01', schema_version: SCHEMA, data: parse(10) })))._s, 400, 'unknown writer rejected');
  eq((await callApi(JSON.stringify({ writer: 'nightly', date_from: 'garbage', schema_version: SCHEMA, data: parse(10) })))._s, 400, 'bad date_from rejected');
  eq((await callApi(JSON.stringify({ writer: 'nightly', date_from: '2026-01-01', schema_version: SCHEMA, data: [] })))._s, 400, 'empty payload rejected');
  eq((await callApi(JSON.stringify({ writer: 'nightly', date_from: '2026-01-01', schema_version: SCHEMA, data: [{ l: 'no-ticket-no' }] })))._s, 400, 'record without ticket no rejected');
  eq(Object.keys(db).length, 0, 'cache untouched by all rejected requests');

  console.log('\nAPI RESULTS: ' + PASS.length + ' passed, ' + FAIL.length + ' failed');
  process.exit(FAIL.length ? 1 : 0);
})();
