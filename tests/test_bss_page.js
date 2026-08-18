// BSS Dashboard page + wiring tests.
// Page ka JS browser ke bina chalta nahi, isliye yahan do cheezein cover ho
// rahi hain: (1) page load hone layak hai (syntax + koi missing symbol nahi),
// (2) uska pure logic (status mapping, buckets, filters) asli page se NIKAAL
// kar chalaya ja raha hai — copy-paste nahi, warna test aur page alag ho jate.
const fs = require('fs');
const vm = require('vm');
const { execSync } = require('child_process');

const PASS = []; const FAIL = [];
const ok = m => { PASS.push(m); console.log('  PASS:', m); };
const no = (m, d) => { FAIL.push(m); console.log('  FAIL:', m, d === undefined ? '' : '→ ' + d); };
const eq = (a, b, m) => (JSON.stringify(a) === JSON.stringify(b) ? ok(m) : no(m, `got ${JSON.stringify(a)}, want ${JSON.stringify(b)}`));

const W = '/home/claude/work';
const html = fs.readFileSync(`${W}/bss_dashboard.html`, 'utf8');

console.log('== 1. page loads: syntax + libraries in scope ==');
const inline = [...html.matchAll(/<script([^>]*)>([\s\S]*?)<\/script>/gi)]
  .filter(m => !/src=/.test(m[1])).map(m => m[2]).join('\n;\n');
const combined = fs.readFileSync(`${W}/assets/ticket-parser.js`, 'utf8') + '\n;\n'
               + fs.readFileSync(`${W}/assets/bss-fields.js`, 'utf8') + '\n;\n' + inline;
fs.writeFileSync('/tmp/bsspage.js', combined);
try { execSync('node --check /tmp/bsspage.js', { stdio: 'pipe' }); ok('no syntax error / redeclaration with both libs loaded'); }
catch (e) { no('syntax error', String(e.stderr).split('\n').slice(0, 3).join(' ')); }

console.log('\n== 2. wiring ==');
eq(/<script src="\/assets\/ticket-parser\.js\?v=2">/.test(html), true, 'ticket-parser loaded (absolute, cache-busted)');
eq(/<script src="\/assets\/bss-fields\.js\?v=1">/.test(html), true, 'bss-fields loaded (absolute, cache-busted)');
eq(/const _DASH='bss-dashboard'/.test(html), true, 'auth guard checks the bss-dashboard permission');
eq(/storage:window\.sessionStorage/.test(html.split('const sb=supabase.createClient')[1] || ''), true,
   'data client uses sessionStorage (else getSession() is null and the proxy 401s)');
eq(/from\('ticket_cache'\)\.select/.test(html), true, 'reads the cache');
eq(/ticket_cache'\)\.(insert|delete|upsert|update)/.test(html), false, 'never writes ticket_cache directly from the browser');
eq(/bssapi\.margcompusoft\.com/.test(html), false, 'never calls Marg directly from the browser (CORS + token leak)');
eq((html.match(/\/api\/bss-proxy/g) || []).length >= 3, true, 'all Marg traffic goes through the proxy');

const vercel = JSON.parse(fs.readFileSync(`${W}/vercel.json`, 'utf8'));
eq(vercel.rewrites.some(r => r.source === '/bss' && r.destination === '/bss_dashboard.html'), true,
   '/bss route registered in vercel.json');
const portal = fs.readFileSync(`${W}/portal.html`, 'utf8');
eq(/id:'bss-dashboard'/.test(portal) && /bss_dashboard\.html/.test(portal), true, 'portal lists the dashboard');
const admin = fs.readFileSync(`${W}/admin.html`, 'utf8');
eq(/id:'bss-dashboard'/.test(admin), true, 'admin can grant the bss-dashboard permission');
eq(/eBssUser/.test(admin) && /fillBssUsers/.test(admin), true, 'admin has the BSS user mapping field');
eq(/bss_user_id/.test(fs.readFileSync(`${W}/api/admin-actions.js`, 'utf8')), true, 'admin API persists bss_user_id');

console.log('\n== 3. required BSS columns present in the detail table ==');
const wanted = ['Ticket No', 'Created', 'Current Status', 'Timeline', 'Disposition', 'Main Disposition',
                'Problem Type', 'Sub-Problem Type', 'Jira ID', 'Assign To (Tester)', 'RM', 'Developer'];
const colBlock = html.split('function listColumns()')[1].split('function renderList')[0];
wanted.forEach(w => eq(colBlock.includes(`'${w}'`), true, `detail column present: ${w}`));

console.log('\n== 4. every updatable field is rendered in the edit modal ==');
const F = require(`${W}/assets/bss-fields.js`);
eq(F.BSS_CROSSWALK.length, 12, '12 updatable fields defined');
eq(/BSS_CROSSWALK\.map\(f=>\{/.test(html), true, 'edit form is generated FROM the crosswalk (cannot drift)');
const payloadNames = F.BSS_CROSSWALK.map(f => f.payload).sort();
eq(payloadNames, ['AssignedTo','BSSComment','BSSMainDisposition','BSSProblemType','BSSSubProblemType',
                  'Developer','Disposition','JiraID','RM','Remarks','SubDisposition','TimeLineDate'],
   'crosswalk covers exactly the UpdateTicketStatus fields');

console.log('\n== 5. page logic, executed from the real page source ==');
// Page ka pure-logic hissa ASLI source se nikaal kar sandbox me chala rahe
// hain — copy-paste nahi, warna test aur page alag ho jate. Ye ek CONTIGUOUS
// slice hai (_normSt se MON tak), regex se tukde jodne ke bajaye — page me
// kuch helpers one-liner hain aur unhe alag-alag match karne par overlap ho
// jata tha.
const sliceStart = html.indexOf('function _normSt');
const sliceEnd   = html.indexOf('];', html.indexOf('const MON=[')) + 2;
if (sliceStart < 0 || sliceEnd < sliceStart) throw new Error('logic block not found in page');
const src = html.slice(sliceStart, sliceEnd);

const ctx = { console };
vm.createContext(ctx);
vm.runInContext(src + `
this.statusKeyOf=statusKeyOf; this.statusLabelOf=statusLabelOf; this.bucketOf=bucketOf;
this.testerOf=testerOf; this.devOf=devOf; this.rmOf=rmOf; this.STATUSES=STATUSES;`, ctx);

eq(ctx.STATUSES.length, 16, 'all 16 status cards defined');
// Live BindDropDown ke saare 20 statuses map hone chahiye
const live20 = ['Pending','Acknowledge','In Progress','Closed','Reopen','Reject','Testing Done','Team Testing',
  'Future Development','Transfer To Support','Under Review','Transfer To IT','Ready To Go Live','Return to Support',
  'Ready For Testing','Ready For Code Review','Ready For Merging','Ready For UAT','Reopend from Testing','Approval Pending'];
const mapped = {};
live20.forEach(s => { mapped[s] = ctx.statusKeyOf({ st: s }); });
eq(mapped['Pending'], 'pending', 'Pending → pending');
eq(mapped['In Progress'], 'ip', 'In Progress → ip');
eq(mapped['Transfer To IT'], 'it', 'Transfer To IT → it');
eq(mapped['Return to Support'], 'rts', 'Return to Support (lowercase "to") → rts');
eq(mapped['Reopend from Testing'], 'reopentest', 'Reopend from Testing → reopentest');
eq(mapped['Ready For Code Review'], 'rfcr', 'Ready For Code Review → rfcr');
eq(mapped['Ready For Merging'], 'rfm', 'Ready For Merging → rfm');
eq(mapped['Future Development'], 'future', 'Future Development → future');
eq(mapped['Reject'], 'rejected', 'Reject → rejected');
eq(mapped['Closed'], 'closed', 'Closed → closed');
// Ye teen SUP_STATUSES me nahi hain — inhe pending bucket me girna chahiye,
// gayab nahi hona chahiye (warna KPI total tickets se kam ho jayega).
['Testing Done', 'Team Testing', 'Under Review', 'Approval Pending'].forEach(s =>
  eq(!!mapped[s], true, `unmapped status "${s}" still lands in a bucket (not dropped)`));

// short-code fallback jab raw status na ho
eq(ctx.statusKeyOf({ sc: 'CL' }), 'closed', 'falls back to short code when st is missing');
eq(ctx.statusKeyOf({}), 'pending', 'empty record → pending (never undefined)');
eq(ctx.statusLabelOf({ st: 'In Progress' }), 'In Progress', 'label round-trips');

console.log('\n== 6. month buckets ==');
const now = new Date();
const iso = d => d.toISOString().slice(0, 10);
const thisMonth = iso(new Date(now.getFullYear(), now.getMonth(), 15));
const prevMonth = iso(new Date(now.getFullYear(), now.getMonth() - 1, 15));
const oldDate   = '2023-05-05';
eq(ctx.bucketOf({ tc: thisMonth }), 'cur', 'current month bucket');
eq(ctx.bucketOf({ tc: prevMonth }), 'prev', 'previous month bucket');
eq(ctx.bucketOf({ tc: oldDate }), 'older', 'older bucket');
eq(ctx.bucketOf({}), 'older', 'no date → older (never crashes)');
// Buckets must partition: cur+prev+older == total
const sample = [{ tc: thisMonth }, { tc: prevMonth }, { tc: oldDate }, {}, { tld: thisMonth }];
const counts = sample.reduce((a, r) => { a[ctx.bucketOf(r)]++; return a; }, { cur: 0, prev: 0, older: 0 });
eq(counts.cur + counts.prev + counts.older, sample.length, 'buckets partition the set (no ticket lost or double-counted)');

console.log('\n== 7. agent field resolution ==');
eq(ctx.testerOf({ assignto: 'Teena Sharma', t: 'Other' }), 'Teena Sharma', 'tester prefers Assignto');
eq(ctx.testerOf({ t: 'Fallback' }), 'Fallback', 'tester falls back to TransferTo');
eq(ctx.testerOf({}), '', 'no tester → empty (filtered out of sections)');
eq(ctx.devOf({ dev: ' Ashish ' }), 'Ashish', 'developer trimmed');
eq(ctx.rmOf({ r: 'Anil Tiwari' }), 'Anil Tiwari', 'RM read');

console.log('\n== 8. KPI totals reconcile ==');
// Har ticket exactly ek status bucket me jaana chahiye
const tickets = [
  { n: '1', st: 'Pending' }, { n: '2', st: 'In Progress' }, { n: '3', st: 'Closed' },
  { n: '4', st: 'Approval Pending' }, { n: '5', sc: 'IT' }, { n: '6' },
];
const byKey = {};
tickets.forEach(t => { const k = ctx.statusKeyOf(t); byKey[k] = (byKey[k] || 0) + 1; });
eq(Object.values(byKey).reduce((a, b) => a + b, 0), tickets.length,
   'sum of KPI counts equals total tickets (nothing dropped)');
eq(Object.keys(byKey).every(k => ctx.STATUSES.some(s => s.key === k)), true,
   'every produced key has a KPI card to land on');

console.log('\nBSS PAGE RESULTS: ' + PASS.length + ' passed, ' + FAIL.length + ' failed');
process.exit(FAIL.length ? 1 : 0);
