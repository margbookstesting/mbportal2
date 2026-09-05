// Page-level regression checks + mbMergeCacheRows behaviour.
const fs = require('fs');
const vm = require('vm');
const { execSync } = require('child_process');

const SCHEMA = require('/home/claude/work/assets/ticket-parser.js').MB_SCHEMA_VERSION;
const PASS = []; const FAIL = [];
const ok = m => { PASS.push(m); console.log('  PASS:', m); };
const no = (m, d) => { FAIL.push(m); console.log('  FAIL:', m, d === undefined ? '' : '→ ' + d); };
const eq = (a, b, m) => (a === b ? ok(m) : no(m, `got ${JSON.stringify(a)}, want ${JSON.stringify(b)}`));

const WORK = '/home/claude/work';
const PAGES = ['marg_ticket_dashboard', 'support_dashboard', 'ticket_dashboard_api', 'upcoming_timeline'];

// ── Load parser ──
const ctx = { console, fetch: () => {}, Blob, Response, CompressionStream, btoa: s => Buffer.from(s, 'binary').toString('base64') };
vm.createContext(ctx);
vm.runInContext(fs.readFileSync(`${WORK}/assets/ticket-parser.js`, 'utf8'), ctx);

console.log('== 1. every page: inline JS parses with the parser in scope ==');
// Ye wahi cheez pakadta hai jo deploy tod deti hai: duplicate const
// declaration (page ka local helper + parser ka global) -> SyntaxError ->
// poora dashboard blank.
for (const p of PAGES) {
  const html = fs.readFileSync(`${WORK}/${p}.html`, 'utf8');
  const inline = [...html.matchAll(/<script([^>]*)>([\s\S]*?)<\/script>/gi)]
    .filter(m => !/src=/.test(m[1]))
    .filter(m => !/type=/.test(m[1]) || /javascript/i.test(m[1]))
    .map(m => m[2]).join('\n;\n');
  const combined = fs.readFileSync(`${WORK}/assets/ticket-parser.js`, 'utf8') + '\n;\n' + inline;
  fs.writeFileSync(`/tmp/chk_${p}.js`, combined);
  try {
    execSync(`node --check /tmp/chk_${p}.js`, { stdio: 'pipe' });
    ok(`${p}: no redeclaration / syntax error with parser loaded`);
  } catch (e) {
    no(`${p}: syntax error`, String(e.stderr).split('\n').slice(0, 3).join(' '));
  }
}

console.log('\n== 2. every page: wiring intact ==');
for (const p of PAGES) {
  const html = fs.readFileSync(`${WORK}/${p}.html`, 'utf8');
  const tag = html.match(/<script src="([^"]*ticket-parser[^"]*)"/);
  eq(tag && tag[1], `/assets/ticket-parser.js?v=${SCHEMA}`, `${p}: absolute, cache-busted script tag`);
  // No direct browser writes to ticket_cache may remain
  const writes = (html.match(/ticket_cache'\)\.(insert|delete|upsert|update)/g) || []);
  eq(writes.length, 0, `${p}: zero direct ticket_cache writes`);
  eq(/from\('ticket_cache'\)\.select/.test(html), true, `${p}: still reads cache`);
  eq(/storage:\s*window\.sessionStorage/.test(html.slice(html.indexOf('SUPABASE CACHE') > -1 ? html.indexOf('SUPABASE CACHE') : 0)), true,
     `${p}: data client uses sessionStorage (else getSession() is null)`);
}

console.log('\n== 3. dead cacheSave() removed (it would poison the year row) ==');
for (const p of ['marg_ticket_dashboard', 'support_dashboard', 'ticket_dashboard_api']) {
  const html = fs.readFileSync(`${WORK}/${p}.html`, 'utf8');
  eq(/function cacheSave/.test(html), false, `${p}: cacheSave() gone`);
}

console.log('\n== 4. mbMergeCacheRows: field-level union, newest wins per field ==');
// Ek ticket kai year-rows me hota hai. Purana code blind last-wins tha.
const rows = [
  { fetched_at: '2026-08-01T00:00:00Z', date_from: '2025-01-01', date_to: '2025-12-31', schema_version: 2,
    data: [{ n: 'T1', st: 'In Progress', tia: 'Agent A', ld: 'Bug' }] },
  { fetched_at: '2026-08-10T00:00:00Z', date_from: '2026-01-01', date_to: '2026-08-17', schema_version: 2,
    data: [{ n: 'T1', st: 'Closed', cld: '2026-02-20', clb: 'Closer' }] },
];
let m = ctx.mbMergeCacheRows(rows);
eq(m.tickets.length, 1, 'duplicate ticket across year rows merged to one');
const t = m.tickets[0];
eq(t.st, 'Closed', 'newest row wins on conflicting field (status not stale)');
eq(t.tia, 'Agent A', 'field only present in older row is preserved');
eq(t.cld, '2026-02-20', 'field only in newer row present');
eq(m.fetchedAt, '2026-08-10T00:00:00Z', 'newest fetched_at reported');
eq(m.dateFrom, '2025-01-01', 'earliest date_from');
eq(m.dateTo, '2026-08-17', 'latest date_to');

// Reverse row order must not change the result
m = ctx.mbMergeCacheRows([rows[1], rows[0]]);
eq(m.tickets[0].st, 'Closed', 'result is order-independent (status)');
eq(m.tickets[0].tia, 'Agent A', 'result is order-independent (tia)');

// The exact original bug: a stale row must not blank out fields
const stale = [
  { fetched_at: '2026-08-10T00:00:00Z', date_from: '2026-01-01', schema_version: 2,
    data: [{ n: 'T9', st: 'Closed', tia: 'Agent X', ld: 'Bug', rtd: '2026-02-10' }] },
  { fetched_at: '2026-08-02T00:00:00Z', date_from: '2025-01-01', schema_version: 1,
    data: [{ n: 'T9', st: 'Closed' }] },
];
m = ctx.mbMergeCacheRows(stale);
eq(m.tickets[0].tia, 'Agent X', 'older thin row cannot erase tia');
eq(m.tickets[0].ld, 'Bug', 'older thin row cannot erase ld');
eq(m.minSchema, 1, 'minSchema reports the OLDEST schema (drives the stale warning)');

// Legacy rows with no schema_version count as v1
m = ctx.mbMergeCacheRows([{ fetched_at: '2026-01-01T00:00:00Z', date_from: '2025-01-01', data: [{ n: 'A' }] }]);
eq(m.minSchema, 1, 'missing schema_version treated as v1');
// Junk rows tolerated
m = ctx.mbMergeCacheRows([{ data: null }, { data: 'nope' }, null, { data: [{ noTicketNo: 1 }, null] }]);
eq(m.tickets.length, 0, 'malformed rows ignored without throwing');
eq(ctx.mbMergeCacheRows([]).tickets.length, 0, 'empty input safe');
eq(ctx.mbMergeCacheRows(null).tickets.length, 0, 'null input safe');

console.log('\n== 5. parser retention rules ==');
eq(ctx.mbParseTicket({ TicketNo: 'X' }), null, 'record with nothing is dropped');
eq(ctx.mbParseTicket({ TicketNo: 'X', Status: 'Ready For Testing' }).sc, 'RT', 'status-only RT kept');
eq(ctx.mbParseTicket({ TicketNo: 'X', Status: 'Pending' }).st, 'Pending', 'unmapped status kept with raw label');
/* 'Pending' ab mapped hai (PN) — pehle wo OT me girta tha aur isliye kisi
   bhi KPI me nahi ginta tha. Asli data me aise 477 tickets the. OT ke liye
   ab ek sach me anjaan status chahiye. */
eq(ctx.mbParseTicket({ TicketNo: 'X', Status: 'Pending' }).sc, 'PN', 'Pending -> PN');
eq(ctx.mbParseTicket({ TicketNo: 'X', Status: 'Approval Pending' }).sc, 'AP', 'Approval Pending -> AP (not PN)');
eq(ctx.mbParseTicket({ TicketNo: 'X', Status: 'Some Brand New Status' }).sc, 'OT', 'genuinely unmapped status -> OT');
eq(ctx.mbParseTicket({ TicketNo: 'X', Status: '  in_progress  ' }).sc, 'IP', 'normalised match');
eq(ctx.mbParseTicket({ TicketNo: 'X', TransfertoITDate: '16-06-2026', Status: 'Transfer To IT' }).a, '2026-06-16', 'DD-MM-YYYY converted');
eq(ctx.mbParseTicket({ TicketNo: 'X', TransfertoITDate: '1900-01-01T00:00:00', Status: 'Pending' }).a, undefined, 'sentinel 1900 date dropped');
// ld: unrecognized disposition must be skipped in favour of an earlier recognized one
const ld = ctx.mbParseTicket({
  TicketNo: 'X', Status: 'Acknowledge',
  TransfertoITDate: '2026-01-01T00:00:00',
  ReadyToGoLiveDisp: 'Bug Approved',   // unrecognized, later stage
  TransferToIT_Disp: 'Development',     // recognized, earlier stage
});
eq(ld.ld, 'Development', 'ld skips unrecognized disposition for a recognized earlier one');

console.log('\n' + 'PAGE RESULTS: ' + PASS.length + ' passed, ' + FAIL.length + ' failed');
process.exit(FAIL.length ? 1 : 0);
