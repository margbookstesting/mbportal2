// BSS Dashboard page + wiring tests.
// Page ka JS browser ke bina chalta nahi, isliye yahan do cheezein cover ho
// rahi hain: (1) page load hone layak hai (syntax + koi missing symbol nahi),
// (2) uska pure logic (status mapping, buckets, filters) asli page se NIKAAL
// kar chalaya ja raha hai — copy-paste nahi, warna test aur page alag ho jate.
const fs = require('fs');
const vm = require('vm');
const { execSync } = require('child_process');

const SCHEMA = require('/home/claude/work/assets/ticket-parser.js').MB_SCHEMA_VERSION;
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
eq(new RegExp(`<script src="/assets/ticket-parser\\.js\\?v=${SCHEMA}">`).test(html), true, 'ticket-parser loaded (absolute, cache-busted)');
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

console.log('\n== 9. agent sections: no inner scroll, totals reconcile ==');
{
  // Scroll: teeno section tables tw-full hone chahiye
  ['tblTester','tblDev','tblRM'].forEach(id =>
    eq(new RegExp(`class="tw tw-full"><table id="${id}"`).test(html), true, `${id} has no inner scroll`));
  eq(/\.tw-full\{overflow:visible;max-height:none\}/.test(html), true, 'tw-full removes the height cap');
  eq(/\.tw-full th\{position:static\}/.test(html), true, 'sticky header disabled in full mode (avoids overlap with page header)');
  // Modal list ko scroll karna hi chahiye (wo bahut lamba ho sakta hai)
  eq(/class="tw" style="max-height:none"/.test(html), true, 'modal list keeps its own sizing');

  // agentTable ko asli page source se chalate hain
  const atStart = html.indexOf('function agentTable');
  const atEnd   = html.indexOf('function renderAgents');
  const helpers = html.match(/const fmt=[\s\S]*?;\n/)[0] + html.match(/const esc=[\s\S]*?;\n/)[0];
  const logicSrc = html.slice(html.indexOf('function _normSt'), html.indexOf('];', html.indexOf('const MON=[')) + 2);

  const mkCtx = (view) => {
    const c = { console, VIEW: view };
    vm.createContext(c);
    vm.runInContext(helpers + logicSrc + html.slice(atStart, atEnd) + '\nthis.agentTable=agentTable;', c);
    return c;
  };

  // Deliberately include statuses that are NOT among the 8 shown columns,
  // so "Other" has to absorb them.
  const view = [
    { n:'1', assignto:'A', st:'Pending' },
    { n:'2', assignto:'A', st:'Closed' },
    { n:'3', assignto:'A', st:'Reopen' },              // not a shown column
    { n:'4', assignto:'A', st:'Future Development' },  // not shown
    { n:'5', assignto:'A', st:'Ready For Merging' },   // not shown
    { n:'6', assignto:'B', st:'In Progress' },
    { n:'7', assignto:'B', st:'Approval Pending' },    // unmapped → pending bucket
    { n:'8', assignto:'',  st:'Closed' },              // no agent → excluded
  ];
  const c = mkCtx(view);
  const out = c.agentTable(r => (r.assignto||'').trim(), 'Tester');

  eq(/<tfoot>/.test(out), true, 'totals row rendered');
  eq(/>Other</.test(out), true, 'Other column present');

  // Parse the numbers back out
  const rowsHtml = out.slice(out.indexOf('<tbody>'), out.indexOf('</tbody>'));
  const footHtml = out.slice(out.indexOf('<tfoot>'));
  const nums = frag => [...frag.matchAll(/<td class="r[^"]*">([\d,]+)<\/td>/g)].map(m => Number(m[1].replace(/,/g,'')));
  const badgeNums = frag => [...frag.matchAll(/data-agent-name="[^"]*">([\d,]+)</g)].map(m => Number(m[1].replace(/,/g,'')));

  const trs = rowsHtml.split('<tr>').slice(1);
  let allReconcile = true, detail = [];
  trs.forEach(tr => {
    const total = badgeNums(tr)[0];
    const cells = nums(tr);                 // 8 shown + Other
    const sum = cells.reduce((a,b)=>a+b,0);
    if (sum !== total) { allReconcile = false; detail.push(`row total ${total} vs cells ${sum}`); }
  });
  eq(allReconcile, true, 'EVERY row: shown columns + Other === Total' + (detail.length ? ' | ' + detail.join('; ') : ''));

  // Agent A: 5 tickets (Pending, Closed, Reopen, Future Dev, Merging)
  //  → shown: pending 1, closed 1 ; Other must be 3
  const rowA = trs.find(t => t.includes('>A<'));
  const cellsA = nums(rowA);
  eq(badgeNums(rowA)[0], 5, 'agent A total = 5');
  eq(cellsA[cellsA.length-1], 3, 'agent A Other = 3 (Reopen + Future Dev + Merging)');

  // Footer must equal the sum of all rows, and match the filtered ticket count
  const footCells = nums(footHtml);
  const footTotal = footCells[0];
  const footRest  = footCells.slice(1).reduce((a,b)=>a+b,0);
  eq(footTotal, 7, 'footer Total = 7 (the 8th ticket has no agent, correctly excluded)');
  eq(footRest, footTotal, 'footer: shown columns + Other === footer Total');

  const rowTotals = trs.map(t => badgeNums(t)[0]).reduce((a,b)=>a+b,0);
  eq(rowTotals, footTotal, 'footer Total === sum of all row totals');
  eq(/2 testers/.test(footHtml), true, 'footer labels the agent count');

  // Empty view must not crash and must not show a bogus total
  const c2 = mkCtx([]);
  const empty = c2.agentTable(r => (r.assignto||'').trim(), 'Tester');
  eq(/No data/.test(empty), true, 'empty view shows the empty state');
  eq(/<tfoot>/.test(empty), false, 'no totals row when there is no data');

  // Single agent → singular label
  const c3 = mkCtx([{ n:'1', assignto:'Solo', st:'Closed' }]);
  eq(/1 tester</.test(c3.agentTable(r => (r.assignto||'').trim(), 'Tester')), true, 'singular label for one agent');
}

console.log('\nBSS PAGE RESULTS: ' + PASS.length + ' passed, ' + FAIL.length + ' failed');
process.exit(FAIL.length ? 1 : 0);
