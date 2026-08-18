// api/bss-proxy.js ke tests — ASLI handler load hota hai, Marg aur Supabase
// dono mocked. Yahan wo cheezein cover ho rahi hain jo live test me pakadna
// mehenga padta: auth bypass, payload injection, token retry, cache patch.
const SCHEMA = require('/home/claude/work/assets/ticket-parser.js').MB_SCHEMA_VERSION;
const PASS = []; const FAIL = [];
const ok = m => { PASS.push(m); console.log('  PASS:', m); };
const no = (m, d) => { FAIL.push(m); console.log('  FAIL:', m, d === undefined ? '' : '→ ' + d); };
const eq = (a, b, m) => (JSON.stringify(a) === JSON.stringify(b) ? ok(m) : no(m, `got ${JSON.stringify(a)}, want ${JSON.stringify(b)}`));

process.env.SUPABASE_SERVICE_KEY = 'service-key';
process.env.MARG_LOGIN_EMAIL = 'bot@example.com';
process.env.MARG_LOGIN_PASSWORD = 'secret';

// ── Mock world ──
let db, margCalls, loginCount, margUpdateResponse, margDetailRecords, tokenValid;
let MIGRATION_MISSING = false, USERS_DOWN = false, NO_PROFILE = false;

function jwt(expSec) {
  const p = Buffer.from(JSON.stringify({ exp: expSec })).toString('base64');
  return 'h.' + p + '.s';
}
const resp = (status, body) => Promise.resolve({
  ok: status >= 200 && status < 300, status,
  text: () => Promise.resolve(body === null || body === undefined ? '' : JSON.stringify(body)),
});

function reset() {
  db = {
    users: {
      'user-uid':  { role: 'user',  dashboards: ['bss-dashboard'], bss_user_id: 3923, name: 'Ajay', email: 'a@b.c' },
      'nobss-uid': { role: 'user',  dashboards: ['bss-dashboard'], bss_user_id: null, name: 'NoBss', email: 'n@b.c' },
      'other-uid': { role: 'user',  dashboards: ['support-dashboard'], bss_user_id: 999, name: 'Other', email: 'o@b.c' },
      'admin-uid': { role: 'admin', dashboards: [], bss_user_id: 4518, name: 'Admin', email: 'x@b.c' },
    },
    ticket_cache: [
      { id: 1, date_from: '2026-01-01', data: [ { n: 'MB - 036939', st: 'Pending', ld: 'Bug' }, { n: 'MB - 000001', st: 'Closed' } ] },
      { id: 2, date_from: '2025-01-01', data: [ { n: 'MB - 999999', st: 'Closed' } ] },
    ],
    bss_update_log: [],
  };
  margCalls = []; loginCount = 0; tokenValid = true;
  MIGRATION_MISSING = false; USERS_DOWN = false; NO_PROFILE = false;
  margUpdateResponse = { Status: 'success', Message: 'Ticket status updated successfully.' };
  margDetailRecords = [{ TicketNo: 'MB - 036939', Status: 'Pending', JiraID: '1213', Developer: 'Ashish Sharma' }];
  loadHandler();
}

global.fetch = async (url, opts = {}) => {
  const method = opts.method || 'GET';

  // Supabase auth
  if (url.includes('/auth/v1/user')) {
    const t = (opts.headers.Authorization || '').replace('Bearer ', '');
    return db.users[t] ? resp(200, { id: t }) : resp(401, { error: 'bad jwt' });
  }
  // Supabase users
  if (url.includes('/rest/v1/users')) {
    // Migration na chali ho to PostgREST poori query fail karta hai
    if (MIGRATION_MISSING && /bss_user_id/.test(url))
      return resp(400, { code: '42703', message: 'column users.bss_user_id does not exist' });
    if (USERS_DOWN) return resp(500, { message: 'db unavailable' });
    if (NO_PROFILE) return resp(200, []);   // auth user hai, public.users me row nahi
    const m = url.match(/id=eq\.([^&]+)/);
    const u = m && db.users[m[1]];
    return resp(200, u ? [u] : []);
  }
  // Supabase ticket_cache
  if (url.includes('/rest/v1/ticket_cache')) {
    if (method === 'GET') return resp(200, db.ticket_cache.map(r => ({ id: r.id, date_from: r.date_from, data: r.data })));
    if (method === 'PATCH') {
      const id = Number(url.match(/id=eq\.(\d+)/)[1]);
      const row = db.ticket_cache.find(r => r.id === id);
      row.data = JSON.parse(opts.body).data;
      return resp(204, null);
    }
  }
  // Supabase audit log
  if (url.includes('/rest/v1/bss_update_log')) {
    db.bss_update_log.push(JSON.parse(opts.body));
    return resp(201, null);
  }
  // Marg login
  if (url.includes('/api/Auth/login')) {
    loginCount++;
    return resp(200, { token: jwt(Math.floor(Date.now() / 1000) + 3600) });
  }
  // Marg BindDropDown
  if (url.includes('BindDropDown')) {
    margCalls.push('dropdowns');
    return resp(200, { Status: 'success', Details: { Dispostion: [{ ID: 3, Name: 'In Progress' }], BSSDisposition: [{ ID: 10, Name: 'Bug' }] } });
  }
  // Marg ticket detail
  if (url.includes('GetMBTicketStatusDetail')) {
    margCalls.push('detail:' + url);
    return resp(200, { Status: 'Success', Details: margDetailRecords });
  }
  // Marg update
  if (url.includes('UpdateTicketStatus')) {
    const t = (opts.headers.Authorization || '').replace('Bearer ', '');
    margCalls.push({ kind: 'update', body: JSON.parse(opts.body), token: t });
    if (!tokenValid) { tokenValid = true; return resp(401, { Status: 'Fail', Message: 'token expired' }); }
    if (margUpdateResponse.__http) return resp(margUpdateResponse.__http, margUpdateResponse);
    return resp(200, margUpdateResponse);
  }
  return resp(404, { error: 'unmocked ' + url });
};

// Handler har reset par FRESH load hota hai. bss-proxy.js me dropdown cache
// aur Marg token module-level hain (warm lambda me yahi chahiye) — reload
// kiye bina wo state test sections ke beech leak hoti hai.
let handler;
function loadHandler() {
  delete require.cache[require.resolve('/home/claude/work/api/bss-proxy.js')];
  handler = require('/home/claude/work/api/bss-proxy.js');
}

function mkRes() {
  const r = { _s: 0, _j: null };
  r.status = c => { r._s = c; return r; };
  r.json = o => { r._j = o; return r; };
  return r;
}
async function call(body, user = 'user-uid', method = 'POST') {
  const req = { method, headers: { authorization: 'Bearer ' + user }, body: JSON.stringify(body) };
  const res = mkRes();
  await handler(req, res);
  return res;
}

const GOOD = {
  TicketNo: 'MB - 036939', Disposition: 3, SubDisposition: 10, BSSMainDisposition: 46,
  BSSProblemType: 552, BSSSubProblemType: 1960, AssignedTo: 43, Developer: 15, RM: 4,
  TimeLineDate: '2026-06-29', JiraID: '1213', Remarks: 'r', BSSComment: 'c',
};

(async () => {
  console.log('== 1. auth ==');
  reset();
  eq((await call({ action: 'dropdowns' }, 'nobody'))._s, 401, 'invalid session → 401');
  let r = await call({ action: 'dropdowns' }, 'other-uid');
  eq(r._s, 403, 'user without bss-dashboard permission → 403');
  eq(/do not have access/.test(r._j.error), true, 'refusal explains why');
  eq((await call({ action: 'dropdowns' }, 'admin-uid'))._s, 200, 'admin allowed without explicit permission');
  eq((await call({ action: 'dropdowns' }, 'user-uid'))._s, 200, 'user with bss-dashboard allowed');
  const req = { method: 'GET', headers: {}, body: '' }; const rr = mkRes(); await handler(req, rr);
  eq(rr._s, 405, 'GET rejected');

  console.log('\n== 2. dropdowns + caching ==');
  reset();
  r = await call({ action: 'dropdowns' });
  eq(r._s, 200, 'dropdowns fetched');
  eq(r._j.cached, false, 'first call is a live fetch');
  eq(!!r._j.dropdowns.Dispostion, true, 'Details unwrapped to the list map');
  const before = margCalls.filter(c => c === 'dropdowns').length;
  r = await call({ action: 'dropdowns' });
  eq(r._j.cached, true, 'second call served from cache');
  eq(margCalls.filter(c => c === 'dropdowns').length, before, 'no extra Marg hit while cached');
  r = await call({ action: 'dropdowns', force: true });
  eq(r._j.cached, false, 'force:true bypasses cache');

  console.log('\n== 3. live ticket read ==');
  reset();
  r = await call({ action: 'ticket', ticketNo: 'MB - 036939' });
  eq(r._s, 200, 'ticket fetched live');
  eq(r._j.ticket.JiraID, '1213', 'returns raw record incl. fields absent from cache');
  const durl = margCalls.find(c => typeof c === 'string' && c.startsWith('detail:'));
  eq(/TicketNo=MB%20-%20036939/.test(durl), true, 'ticket no is URL-encoded');
  eq((await call({ action: 'ticket' }))._s, 400, 'missing ticketNo → 400');
  margDetailRecords = [];
  eq((await call({ action: 'ticket', ticketNo: 'MB - 000000' }))._s, 404, 'unknown ticket → 404');
  reset();
  // Date range injection attempt
  r = await call({ action: 'ticket', ticketNo: 'MB - 036939', from: "2026-01-01' OR 1=1--", to: 'xx' });
  const u2 = margCalls.find(c => typeof c === 'string' && c.startsWith('detail:'));
  eq(/FDate=2023-04-01/.test(u2), true, 'malformed from-date falls back to default, not injected');

  console.log('\n== 4. update: the security-critical bits ==');
  reset();
  r = await call({ action: 'update', payload: GOOD });
  eq(r._s, 200, 'valid update succeeds');
  let sent = margCalls.find(c => c.kind === 'update').body;
  eq(sent.UpdatedByUser, 3923, 'UpdatedByUser taken from the caller profile');

  // Spoof attempt: client claims someone else's BSS id
  reset();
  await call({ action: 'update', payload: { ...GOOD, UpdatedByUser: 9999 } });
  sent = margCalls.find(c => c.kind === 'update').body;
  eq(sent.UpdatedByUser, 3923, 'client-supplied UpdatedByUser is IGNORED (no impersonation)');

  // Extra/unknown fields must not reach Marg
  reset();
  await call({ action: 'update', payload: { ...GOOD, EvilField: 'x', IsAdmin: true, Status: 'Closed' } });
  sent = margCalls.find(c => c.kind === 'update').body;
  eq(Object.keys(sent).sort(), ['AssignedTo','BSSComment','BSSMainDisposition','BSSProblemType','BSSSubProblemType','Developer','Disposition','JiraID','RM','Remarks','SubDisposition','TicketNo','TimeLineDate','UpdatedByUser'],
     'only whitelisted fields forwarded to Marg');

  reset();
  r = await call({ action: 'update', payload: GOOD }, 'nobss-uid');
  eq(r._s, 400, 'user without bss_user_id cannot update');
  eq(/BSS User ID/.test(r._j.error), true, 'error names the missing mapping');
  eq(margCalls.filter(c => c.kind === 'update').length, 0, 'no Marg call made for that user');

  console.log('\n== 5. update: payload validation ==');
  reset();
  const bad = async (payload, why) => {
    reset();
    const rr = await call({ action: 'update', payload });
    eq(rr._s, 400, why);
    eq(margCalls.filter(c => c.kind === 'update').length, 0, '  └ nothing sent to Marg');
  };
  await bad({ ...GOOD, TicketNo: '' }, 'missing TicketNo rejected');
  await bad({ ...GOOD, Disposition: undefined }, 'missing Disposition rejected');
  await bad({ ...GOOD, SubDisposition: undefined }, 'missing SubDisposition rejected');
  await bad({ ...GOOD, Developer: 'abc' }, 'non-numeric id rejected');
  await bad({ ...GOOD, TimeLineDate: '29-06-2026' }, 'DD-MM-YYYY date rejected');

  reset();
  r = await call({ action: 'update', payload: { TicketNo: 'MB - 036939', Disposition: 3, SubDisposition: 10 } });
  eq(r._s, 200, 'only the two required fields is accepted');
  sent = margCalls.find(c => c.kind === 'update').body;
  eq('JiraID' in sent, false, 'omitted optional fields are not sent as empty (would blank them in BSS)');

  console.log('\n== 6. Marg failure handling ==');
  reset();
  margUpdateResponse = { Status: 'Fail', Message: 'Invalid disposition' };
  r = await call({ action: 'update', payload: GOOD });
  eq(r._s, 502, 'HTTP 200 with Status:Fail is treated as FAILURE');
  eq(/Invalid disposition/.test(r._j.error), true, 'Marg message surfaced to the user');
  eq(db.bss_update_log[0].success, false, 'failed attempt still audited');

  reset();
  margUpdateResponse = { __http: 500, Message: 'server error' };
  eq((await call({ action: 'update', payload: GOOD }))._s, 502, 'HTTP 500 from Marg → 502');

  reset();
  tokenValid = false;                    // first call 401, retry should succeed
  r = await call({ action: 'update', payload: GOOD });
  eq(r._s, 200, 'expired Marg token is retried once and succeeds');
  eq(margCalls.filter(c => c.kind === 'update').length, 2, 'exactly one retry, not a loop');

  console.log('\n== 7. audit log ==');
  reset();
  await call({ action: 'update', payload: GOOD, before: { st: 'Pending' } });
  const log = db.bss_update_log[0];
  eq(log.ticket_no, 'MB - 036939', 'audit records the ticket');
  eq(log.actor_id, 'user-uid', 'audit records the portal user');
  eq(log.bss_user_id, 3923, 'audit records the BSS id used');
  eq(log.success, true, 'audit records the outcome');
  eq(log.before.st, 'Pending', 'audit records the previous value for rollback');
  eq(log.payload.SubDisposition, 10, 'audit records what was sent');

  console.log('\n== 8. cache patch ==');
  reset();
  r = await call({ action: 'update', payload: GOOD, cachePatch: { st: 'In Progress', ld: 'Bug' } });
  eq(r._j.cache.patched, true, 'cache row patched after update');
  const row = db.ticket_cache.find(x => x.id === 1);
  eq(row.data[0].st, 'In Progress', 'the ticket object was updated in place');
  eq(row.data[0].ld, 'Bug', 'patched field written');
  eq(row.data[1].n, 'MB - 000001', 'sibling ticket untouched');
  eq(row.data.length, 2, 'no records added or lost');
  eq(db.ticket_cache.find(x => x.id === 2).data[0].st, 'Closed', 'other year row untouched');

  reset();
  r = await call({ action: 'update', payload: { ...GOOD, TicketNo: 'MB - NOTINCACHE' }, cachePatch: { st: 'X' } });
  eq(r._s, 200, 'ticket missing from cache does NOT fail the update');
  eq(r._j.cache.patched, false, 'cache patch reported as not applied');
  eq(/not in cache/.test(r._j.cache.reason), true, 'reason explained');

  reset();
  r = await call({ action: 'update', payload: GOOD });
  eq(r._j.cache.patched, false, 'no cachePatch supplied → cache left alone');

  console.log('\n== 8b. cachePatch sanitising (deep-suite findings) ==');
  reset();
  r = await call({ action: 'update', payload: GOOD, cachePatch: {
    st: 'In Progress',
    evilKey: 'x',                    // unknown → drop
    __proto__: { polluted: 'yes' },  // prototype → drop
    dev: { nested: 'obj' },          // non-scalar → drop
    r: 'RM Name',
  }});
  eq(r._j.cache.patched, true, 'patch applied');
  let rec = db.ticket_cache.find(x => x.id === 1).data[0];
  eq(rec.st, 'In Progress', 'whitelisted key applied');
  eq(rec.r, 'RM Name', 'second whitelisted key applied');
  eq('evilKey' in rec, false, 'unknown key dropped from the cache record');
  eq(rec.dev, undefined, 'non-scalar value dropped');
  eq(({}).polluted, undefined, 'Object.prototype not polluted');
  delete Object.prototype.polluted;

  reset();
  r = await call({ action: 'update', payload: GOOD, cachePatch: { onlyGarbage: 1 } });
  eq(r._j.cache.patched, false, 'patch with nothing valid does not touch the cache');
  eq(/sanitis/.test(r._j.cache.reason), true, 'reason explains why');

  reset();
  r = await call({ action: 'update', payload: GOOD, cachePatch: { st: 'y'.repeat(2000) } });
  rec = db.ticket_cache.find(x => x.id === 1).data[0];
  eq(rec.st.length, 500, 'oversized patch value capped at 500 chars');

  console.log('\n== 8c. date + text hardening (deep-suite findings) ==');
  reset();
  eq((await call({ action: 'update', payload: { ...GOOD, TimeLineDate: '2026-02-30' } }))._s, 400,
     'impossible date 2026-02-30 rejected server-side');
  eq((await call({ action: 'update', payload: { ...GOOD, TimeLineDate: '2026-13-01' } }))._s, 400,
     'month 13 rejected server-side');
  eq((await call({ action: 'update', payload: { ...GOOD, TimeLineDate: '2024-02-29' } }))._s, 200,
     'real leap day 2024-02-29 accepted');
  eq((await call({ action: 'update', payload: { ...GOOD, TimeLineDate: '2026-02-29' } }))._s, 400,
     'non-leap 2026-02-29 rejected');

  reset();
  await call({ action: 'update', payload: { ...GOOD, JiraID: '   ' } });
  sent = margCalls.find(c => c.kind === 'update').body;
  eq('JiraID' in sent, false, 'whitespace-only text omitted (would have blanked the BSS field)');

  reset();
  await call({ action: 'update', payload: { ...GOOD, Remarks: '  hello  ' } });
  sent = margCalls.find(c => c.kind === 'update').body;
  eq(sent.Remarks, 'hello', 'text fields trimmed before sending');

  console.log('\n== 8d. auth diagnostics (403 debugging) ==');
  reset();
  // Migration nahi chali: read-only kaam karna chahiye, update saaf fail
  MIGRATION_MISSING = true;
  r = await call({ action: 'dropdowns' });
  eq(r._s, 200, 'dropdowns still work without the bss_user_id column (read-only degrades gracefully)');
  r = await call({ action: 'ticket', ticketNo: 'MB - 036939' });
  eq(r._s, 200, 'ticket read still works without the migration');
  r = await call({ action: 'update', payload: GOOD });
  eq(r._s, 500, 'update blocked when the migration is missing');
  eq(/2026-08-bss-dashboard\.sql/.test(r._j.error), true, 'error names the exact SQL file to run');
  eq(margCalls.filter(c => c.kind === 'update').length, 0, 'nothing sent to Marg');

  reset();
  // Permission missing → error must say what to do, and echo what they DO have
  r = await call({ action: 'dropdowns' }, 'other-uid');
  eq(r._s, 403, 'no permission → 403');
  eq(/BSS Dashboard permission/.test(r._j.error), true, 'error says how to fix it');
  eq(r._j.dashboards, ['support-dashboard'], 'response echoes the permissions the user actually has');
  eq(r._j.role, 'user', 'response echoes the role');

  reset();
  // Auth session valid, par public.users me row hi nahi
  NO_PROFILE = true;
  r = await call({ action: 'dropdowns' });
  eq(r._s, 403, 'auth ok but no profile row → 403');
  eq(/public\.users/.test(r._j.error), true, 'error explains the profile is missing, not "access denied"');

  reset();
  USERS_DOWN = true;
  r = await call({ action: 'dropdowns' });
  eq(r._s, 500, 'profile read failure → 500 (not a misleading 403)');
  eq(/Profile read failed/.test(r._j.error), true, 'surfaces the DB error');

  console.log('\n== 9. misc ==');
  reset();
  eq((await call({ action: 'nonsense' }))._s, 400, 'unknown action → 400');
  eq((await call({}))._s, 400, 'missing action → 400');

  console.log('\nBSS PROXY RESULTS: ' + PASS.length + ' passed, ' + FAIL.length + ' failed');
  process.exit(FAIL.length ? 1 : 0);
})();
