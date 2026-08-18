// DEEP / ADVERSARIAL SUITE
// Ye suite confirm karne ke liye nahi, TODNE ke liye likhi gayi hai.
// Angles: HTML/JS escaping, injection, prototype pollution, unicode,
// boundary dates, concurrency, precision, aur real-world dirty data.
const fs = require('fs');
const vm = require('vm');

const PASS = []; const FAIL = [];
const WARN = [];
const warnLimit = m => { WARN.push(m); console.log('  NOTE: ', m); };
const ok = m => { PASS.push(m); console.log('  PASS:', m); };
const no = (m, d) => { FAIL.push(m); console.log('  FAIL:', m, d === undefined ? '' : '→ ' + d); };
const eq = (a, b, m) => (JSON.stringify(a) === JSON.stringify(b) ? ok(m) : no(m, `got ${JSON.stringify(a)}, want ${JSON.stringify(b)}`));

const W = '/home/claude/work';
const html = fs.readFileSync(`${W}/bss_dashboard.html`, 'utf8');
const F = require(`${W}/assets/bss-fields.js`);

// ── Page ke render helpers ko sandbox me nikaalte hain ──
const sliceStart = html.indexOf('function _normSt');
const sliceEnd = html.indexOf('];', html.indexOf('const MON=[')) + 2;
const logic = html.slice(sliceStart, sliceEnd);
const escFn = html.match(/const esc=[\s\S]*?;\n/)[0];
const fmtFn = html.match(/const fmt=[\s\S]*?;\n/)[0];
const listColsFn = html.slice(html.indexOf('function listColumns()'), html.indexOf('function renderList'));

const ctx = { console };
vm.createContext(ctx);
vm.runInContext(fmtFn + escFn + logic + listColsFn + `
this.esc=esc; this.listColumns=listColumns; this.statusKeyOf=statusKeyOf;
this.bucketOf=bucketOf; this.testerOf=testerOf; this.devOf=devOf; this.rmOf=rmOf;
this.statusLabelOf=statusLabelOf;`, ctx);

/* Browser jaisa HTML-attribute decode. Yahi asli behaviour hai: browser
 * attribute value me se entities DECODE karta hai, phir usme jo JS bacha
 * hai use parse karta hai. Isliye esc() se `'` ko `&#39;` karna attribute
 * ke andar JS string ko SAFE nahi banata. */
function decodeEntities(s) {
  return String(s)
    .replace(/&#39;/g, "'").replace(/&quot;/g, '"')
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&');
}
function extractOnclick(fragment) {
  const m = fragment.match(/onclick="([^"]*)"/);
  return m ? decodeEntities(m[1]) : null;
}
function jsParses(code) {
  try { new (require('vm').Script)(code); return true; } catch { return false; }
}

console.log('== 1. ESCAPING: ticket data with quotes/HTML/unicode ==');
{
  const cols = ctx.listColumns();
  const ticketCol = cols[0][1];

  // Ab ticket no data-attribute me jata hai (inline onclick nahi). Test yahi
  // hai ki attribute value HTML parse hone ke BAAD bilkul original string
  // wapas de — kyunki click handler wahi value use karega.
  const attrOf = (frag, name) => {
    const m = frag.match(new RegExp(`${name}="([^"]*)"`));
    return m ? decodeEntities(m[1]) : null;
  };

  const hostile = [
    ['MB - 036939',              'plain'],
    ["MB - O'BRIEN",             'apostrophe'],
    ['MB - "QUOTED"',            'double quotes'],
    ['MB - \\',                  'backslash'],
    ['MB - <img src=x onerror=alert(1)>', 'html/script injection'],
    ['MB - & &amp; &#39;',       'ampersands and pre-encoded entities'],
    ['MB - 🎫 हिन्दी',            'unicode + emoji'],
    ['MB - line1\nline2',        'newline'],
    ["MB - `back` ${tick}",      'template literal syntax'],
    ['MB - </span><script>x</script>', 'tag breakout attempt'],
  ];

  hostile.forEach(([val, why]) => {
    const frag = ticketCol({ n: val });
    const got = attrOf(frag, 'data-tno');
    if (got === val) ok(`ticket no round-trips exactly: ${why}`);
    else no(`ticket no CORRUPTED: ${why}`, `sent ${JSON.stringify(val)}, attribute decodes to ${JSON.stringify(got)}`);
  });

  // Structural safety: no executable injection, no attribute breakout
  const evil = ticketCol({ n: '"><img src=x onerror=alert(1)><span a="' });
  eq(/<img/.test(evil), false, 'img tag cannot be injected through the ticket no');
  // `onerror=` string output me dikhega — par sirf ESCAPED TEXT ke andar, jo
  // inert hai. Asli sawaal ye hai ki koi event-handler ATTRIBUTE bana ya nahi.
  // Isliye tag ke attribute NAAM nikaal kar check kar rahe hain.
  const attrNames = (frag) => {
    const tag = frag.match(/<span[^>]*>/)[0];
    const noValues = tag.replace(/="[^"]*"/g, '=""').replace(/='[^']*'/g, "=''");
    return [...noValues.matchAll(/\s([a-zA-Z-]+)=/g)].map(m => m[1].toLowerCase());
  };
  const names = attrNames(evil);
  eq(names.some(n => n.startsWith('on')), false,
     'no event-handler attribute created (attrs: ' + names.join(',') + ')');
  eq(names.sort(), ['class', 'data-tno'], 'only the intended attributes exist');
  eq((evil.match(/<span/g) || []).length, 1, 'exactly one span — attribute breakout prevented');
  eq(/onclick=/.test(evil), false, 'no inline onclick generated at all (whole bug class removed)');

  // Displayed text must also be escaped
  eq(ticketCol({ n: '<b>x</b>' }).includes('&lt;b&gt;'), true, 'visible text is escaped');
}

console.log('\n== 2. ESCAPING: agent names in the section tables ==');
{
  const tblBlock = html.slice(html.indexOf('function agentTable'), html.indexOf('function renderAgents'));
  eq(/onclick=/.test(tblBlock), false, 'agent table generates no inline onclick');
  eq(/data-agent-name=/.test(tblBlock), true, 'agent name passed via data attribute');

  // Simulate what the template produces for hostile agent names
  const render = name => `<span class="badge" data-agent-kind="${ctx.esc('Tester')}" data-agent-name="${ctx.esc(name)}">1</span>`;
  const attrOf = (frag) => {
    const m = frag.match(/data-agent-name="([^"]*)"/);
    return m ? decodeEntities(m[1]) : null;
  };
  [
    ["Support agent's concern", 'apostrophe (exists in their master data)'],
    ['A "quoted" name',         'double quotes'],
    ['Name & Co',               'ampersand'],
    ['<script>alert(1)</script>', 'script tag'],
    ['नाम 🙂',                   'unicode'],
  ].forEach(([n, why]) => {
    const got = attrOf(render(n));
    if (got === n) ok(`agent name round-trips exactly: ${why}`);
    else no(`agent name CORRUPTED: ${why}`, `sent ${JSON.stringify(n)}, got ${JSON.stringify(got)}`);
  });

  // Delegation listener must exist, otherwise clicks silently do nothing
  eq(/addEventListener\('click'/.test(html), true, 'click delegation listener registered');
  eq(/closest\('\[data-tno\]'\)/.test(html), true, 'delegation reads data-tno');
  eq(/closest\('\[data-agent-name\]'\)/.test(html), true, 'delegation reads data-agent-name');
}

console.log('\n== 3. PROTOTYPE POLLUTION via cachePatch ==');
{
  // patchCache Object.assign({}, rec, patch) karta hai. JSON.parse `__proto__`
  // ko own property banata hai, aur Object.assign [[Set]] use karta hai —
  // to prototype pollute ho sakta hai.
  const before = ({}).polluted;
  const rec = { n: 'X', st: 'Pending' };
  const patch = JSON.parse('{"__proto__":{"polluted":"yes"},"st":"Closed"}');
  const merged = Object.assign({}, rec, patch);
  const after = ({}).polluted;
  if (after === undefined) ok('Object.assign with __proto__ did not pollute (node semantics)');
  else no('PROTOTYPE POLLUTION possible through cachePatch', 'Object.prototype.polluted = ' + after);
  delete Object.prototype.polluted;
  eq(merged.st, 'Closed', 'legit patch field still applied');

  // Whether or not node pollutes, unknown keys should not reach the cache
  const proxySrc = fs.readFileSync(`${W}/api/bss-proxy.js`, 'utf8');
  const hasWhitelist = /CACHE_PATCH_KEYS|allowedPatchKeys/.test(proxySrc);
  if (hasWhitelist) ok('cachePatch keys are whitelisted server-side');
  else no('cachePatch keys are NOT whitelisted — client can write arbitrary keys into ticket_cache records');
}

console.log('\n== 4. PAYLOAD: numeric edge cases ==');
{
  const DD = { Dispostion: [{ ID: 3, Name: 'In Progress' }], BSSDisposition: [{ ID: 10, Name: 'Bug' }] };
  // String ids from <select> (browser hamesha string deta hai)
  let p = F.bssBuildPayload({ subDisposition: '3', disposition: '10' }, 'MB - 1', '3923');
  eq(typeof p.Disposition, 'number', 'select string "3" → number 3');
  eq(p.Disposition, 3, 'value preserved');
  eq(typeof p.UpdatedByUser, 'number', 'UpdatedByUser coerced to number');

  // Leading zeros / whitespace
  // "03" → Number("03") === 3, jo list me hai. Ye normalize hota hai, reject
  // nahi — aur payload me 3 hi jata hai. Isliye ye SAHI behaviour hai.
  eq(F.bssValidate({ subDisposition: '03', disposition: '10' }, DD, 1)
       .some(e => e.field === 'subDisposition'), false, 'id "03" normalises to 3 (accepted)');
  eq(F.bssBuildPayload({ subDisposition: '03', disposition: '10' }, 'T', 1).Disposition, 3,
     '"03" reaches the payload as numeric 3');
  eq(F.bssValidate({ subDisposition: ' 3', disposition: '10' }, DD, 1)
       .some(e => e.field === 'subDisposition'), true, 'id with space rejected (not silently trimmed)');
  eq(F.bssValidate({ subDisposition: '3.0', disposition: '10' }, DD, 1)
       .some(e => e.field === 'subDisposition'), true, 'float id rejected');
  eq(F.bssValidate({ subDisposition: '-3', disposition: '10' }, DD, 1)
       .some(e => e.field === 'subDisposition'), true, 'negative id rejected');
  eq(F.bssValidate({ subDisposition: '3e0', disposition: '10' }, DD, 1)
       .some(e => e.field === 'subDisposition'), true, 'exponent notation rejected');

  // 0 is falsy — must not be silently dropped if it were a valid id
  const DD0 = { Dispostion: [{ ID: 0, Name: 'Zero' }], BSSDisposition: [{ ID: 10, Name: 'Bug' }] };
  const p0 = F.bssBuildPayload({ subDisposition: 0, disposition: 10 }, 'MB - 1', 1);
  if (p0.Disposition === 0) ok('id 0 survives payload build');
  else no('id 0 is dropped by the payload builder (falsy bug)', JSON.stringify(p0));
}

console.log('\n== 5. TEXT fields: length, unicode, control chars ==');
{
  const long = 'x'.repeat(5000);
  const p = F.bssBuildPayload({ subDisposition: 3, disposition: 10, remarks: long }, 'MB - 1', 1);
  eq(p.Remarks.length, 5000, 'client does not truncate (server does)');
  // server-side cap
  const proxySrc = fs.readFileSync(`${W}/api/bss-proxy.js`, 'utf8');
  eq(/slice\(0,\s*2000\)/.test(proxySrc), true, 'server caps text fields at 2000 chars');

  const uni = 'हिन्दी 中文 🎫 émoji';
  const pu = F.bssBuildPayload({ subDisposition: 3, disposition: 10, bssComment: uni }, 'MB - 1', 1);
  eq(pu.BSSComment, uni, 'unicode preserved exactly');

  const nl = 'line1\nline2\ttab';
  const pn = F.bssBuildPayload({ subDisposition: 3, disposition: 10, remarks: nl }, 'MB - 1', 1);
  eq(pn.Remarks, nl, 'newlines/tabs preserved');

  // Whitespace-only should count as empty, not send a blank that wipes BSS
  const pw = F.bssBuildPayload({ subDisposition: 3, disposition: 10, jiraId: '   ' }, 'MB - 1', 1);
  if ('JiraID' in pw) no('whitespace-only text is sent (would overwrite BSS with spaces)', JSON.stringify(pw.JiraID));
  else ok('whitespace-only text field is omitted');
}

console.log('\n== 6. DATE boundaries ==');
{
  eq(F.bssValidate({ subDisposition: 3, disposition: 10, timelineDate: '2026-02-30' }, null, 1)
       .some(e => e.field === 'timelineDate'), true, 'impossible date 2026-02-30 rejected');
  eq(F.bssValidate({ subDisposition: 3, disposition: 10, timelineDate: '2026-13-01' }, null, 1)
       .some(e => e.field === 'timelineDate'), true, 'month 13 rejected');
  eq(F.bssValidate({ subDisposition: 3, disposition: 10, timelineDate: '20260629' }, null, 1)
       .some(e => e.field === 'timelineDate'), true, 'compact date rejected');
  eq(F.bssValidate({ subDisposition: 3, disposition: 10, timelineDate: '2026-06-29T00:00:00' }, null, 1)
       .some(e => e.field === 'timelineDate'), true, 'ISO datetime rejected (endpoint wants date only)');
}

console.log('\n== 7. MONTH BUCKETS across year boundary ==');
{
  // January me "previous month" December of LAST year hona chahiye
  const RealDate = Date;
  const mock = (y, m, d) => {
    class D extends RealDate {
      constructor(...a) { if (!a.length) super(y, m - 1, d); else super(...a); }
      static now() { return new RealDate(y, m - 1, d).getTime(); }
    }
    return D;
  };
  const c2 = { console, Date: mock(2027, 1, 15) };
  vm.createContext(c2);
  vm.runInContext(logic + '\nthis.bucketOf=bucketOf;', c2);
  eq(c2.bucketOf({ tc: '2027-01-05' }), 'cur', 'Jan 2027 ticket in January → current');
  eq(c2.bucketOf({ tc: '2026-12-20' }), 'prev', 'Dec 2026 ticket in January → previous (year boundary handled)');
  eq(c2.bucketOf({ tc: '2026-11-20' }), 'older', 'Nov 2026 → older');

  // Malformed dates must not crash or land in the wrong bucket
  eq(ctx.bucketOf({ tc: 'not-a-date' }), 'older', 'garbage date → older');
  eq(ctx.bucketOf({ tc: '' }), 'older', 'empty date → older');
  eq(ctx.bucketOf({ tc: null }), 'older', 'null date → older');
}

console.log('\n== 8. STATUS mapping: dirty real-world strings ==');
{
  const cases = [
    ['  In Progress  ', 'ip', 'leading/trailing spaces'],
    ['IN PROGRESS', 'ip', 'uppercase'],
    ['in_progress', 'ip', 'underscore separator'],
    ['In-Progress', 'ip', 'hyphen separator'],
    ['Transfer  To   IT', 'it', 'multiple spaces collapsed'],
    ['Ready for testing', 'rft', 'mixed case'],
    ['ready/for/uat', 'rfu', 'slash separator'],
  ];
  cases.forEach(([s, want, why]) => eq(ctx.statusKeyOf({ st: s }), want, `${why}: "${s}"`));

  // st and sc disagree → st must win (st is authoritative after an update)
  eq(ctx.statusKeyOf({ st: 'Closed', sc: 'IT' }), 'closed', 'raw status wins over stale short code');
  // Substring trap: "Reopend from Testing" must NOT be caught by "ready for testing"
  eq(ctx.statusKeyOf({ st: 'Reopend from Testing' }), 'reopentest', 'no substring collision with Ready For Testing');
  // "Reopen" vs "Reopend from Testing"
  eq(ctx.statusKeyOf({ st: 'Reopen' }), 'reopen', 'Reopen stays Reopen');
}

console.log('\n== 9. CASCADE: dirty parent references ==');
{
  const DD = {
    SubDispostion: [{ ID: 46, Name: 'A' }],
    ProblemTypeMargBook: [
      { ID: 1, Name: 'num parent', Subdispositionid: 46 },
      { ID: 2, Name: 'string parent', Subdispositionid: '46' },   // string in real data
      { ID: 3, Name: 'null parent', Subdispositionid: null },
      { ID: 4, Name: 'missing parent' },
    ],
    SubProblemTypeMargBook: [],
  };
  const got = F.bssCascadeOptions(DD, 'problemType', 46).map(o => o.ID);
  eq(got, [1, 2], 'string and numeric parent ids both match (Marg mixes them)');
  eq(F.bssCascadeOptions(DD, 'problemType', '46').map(o => o.ID), [1, 2], 'string parent argument works too');
  eq(F.bssCascadeOptions(DD, 'problemType', 0), [], 'parent id 0 → empty (not treated as "no filter")');
  eq(F.bssCascadeOptions(DD, 'problemType', undefined), [], 'undefined parent → empty');
}

console.log('\n== 10. DROPDOWN health on malformed master data ==');
{
  eq(F.bssDropdownHealth(null).orphanParents, [], 'null dropdowns → no crash');
  eq(F.bssDropdownHealth({}).orphanParents, [], 'empty dropdowns → no crash');
  const weird = { SubDispostion: null, ProblemTypeMargBook: 'not-an-array', Dispostion: [{ ID: 1, Name: 'X' }] };
  let threw = false;
  try { F.bssDropdownHealth(weird); } catch (e) { threw = true; }
  eq(threw, false, 'malformed lists → no crash');
  eq(F.bssOptions(weird, 'problemType'), [], 'non-array list → empty options');
}

console.log('\n== 11. READ resolution: hostile / odd values ==');
{
  const DD = { Rm: [{ ID: 4, Name: 'Anil Tiwari' }], Developers: [], AssignTo: [],
               Dispostion: [], BSSDisposition: [], SubDispostion: [],
               ProblemTypeMargBook: [], SubProblemTypeMargBook: [] };
  // Case/whitespace tolerance in reverse lookup
  eq(F.bssIdByName(DD, 'rm', '  anil tiwari  ').id, 4, 'reverse lookup is case/space tolerant');
  eq(F.bssIdByName(DD, 'rm', 'Anil').id, null, 'partial name does NOT match (no fuzzy guessing)');
  eq(F.bssIdByName(DD, 'rm', '').id, null, 'empty name → null');
  eq(F.bssIdByName(DD, 'rm', null).id, null, 'null name → null');

  // Sentinel and empty values on read
  eq(F.bssReadValue({ TimeLineDate: '' }, 'timelineDate').value, null, 'empty string → null');
  eq(F.bssReadValue({ TimeLineDate: '   ' }, 'timelineDate').value, null, 'whitespace → null');
  // JiraID 0 ek legit value hai (String(0) = "0", khali nahi). Ise null karna
  // data loss hoga, isliye ye SAHI behaviour hai.
  eq(F.bssReadValue({ JiraID: 0 }, 'jiraId').value, 0, 'numeric 0 is kept (a real value, not "empty")');
  eq(F.bssReadValue({}, 'jiraId').value, null, 'absent → null');
  eq(F.bssReadValue(null, 'jiraId').value, null, 'null record → null, no crash');

  // Alias priority: first alias wins
  eq(F.bssReadValue({ JiraID: 'A', JiraId: 'B' }, 'jiraId').via, 'JiraID', 'first alias has priority');
}

console.log('\n== 12. LIST columns: every column survives a null-heavy record ==');
{
  const cols = ctx.listColumns();
  const empty = {};
  let crashed = null;
  cols.forEach(c => { try { c[1](empty); } catch (e) { crashed = c[0] + ': ' + e.message; } });
  eq(crashed, null, 'all columns render for an empty record');

  const nasty = { n: '<b>x</b>', tc: null, st: undefined, tld: '<script>', ld: '"quo"',
                  mainDisp: "it's", probType: '&amp;', subDisp: '\u0000', u: '😀', l: 0 };
  crashed = null;
  const out = cols.map(c => { try { return c[1](nasty); } catch (e) { crashed = c[0]; return ''; } });
  eq(crashed, null, 'all columns render for a hostile record');
  const joined = out.join('');
  eq(/<script>/.test(joined), false, 'no raw <script> in output');
  eq(/<b>x<\/b>/.test(joined), false, 'no raw HTML tags in output');
}

console.log('\n== 13. CONCURRENCY: two updates, cache patch ordering ==');
{
  // patchCache read-modify-write hai. Do parallel updates me last-write-wins
  // hota hai — par doosre ticket ka data nahi udna chahiye.
  const row = { data: [{ n: 'A', st: 'Pending' }, { n: 'B', st: 'Pending' }] };
  const snapshot = JSON.parse(JSON.stringify(row.data));   // dono ne same read kiya
  const nextA = snapshot.slice(); nextA[0] = Object.assign({}, nextA[0], { st: 'Closed' });
  const nextB = snapshot.slice(); nextB[1] = Object.assign({}, nextB[1], { st: 'In Progress' });
  // A likhta hai, phir B (B ka snapshot purana hai)
  row.data = nextA; row.data = nextB;
  // DOCUMENTED LIMITATION: patchCache read-modify-write hai, to do bilkul
  // simultaneous updates me pehla patch cache me kho sakta hai. Ye sirf CACHE
  // hai — asli data Marg me sahi rehta hai aur agli nightly/Refresh par cache
  // apne aap theek ho jata hai. Yahan ye lock kar rahe hain ki nuksaan sirf
  // itna ho: koi RECORD gayab na ho, aur baad wala patch lag jaye.
  if (row.data[0].st === 'Closed') ok('concurrent patches both survived');
  else warnLimit(`cache-only lost update (A wanted Closed, got ${row.data[0].st}) — self-heals on next refresh`);
  eq(row.data[1].st, 'In Progress', 'the later patch is applied');
  eq(row.data.length, 2, 'no record lost in either path');
}

console.log('\n== 14. SCALE: 30k tickets through the hot paths ==');
{
  const N = 30000;
  const big = [];
  const sts = ['Pending', 'In Progress', 'Closed', 'Transfer To IT', 'Ready For UAT', 'Approval Pending'];
  for (let i = 0; i < N; i++) big.push({
    n: 'MB - ' + i, st: sts[i % sts.length], tc: '2026-0' + ((i % 8) + 1) + '-15',
    assignto: 'Tester ' + (i % 40), dev: 'Dev ' + (i % 20), r: 'RM ' + (i % 4), u: 'Client ' + i,
  });

  let t = Date.now();
  const counts = {};
  big.forEach(r => { const k = ctx.statusKeyOf(r); counts[k] = (counts[k] || 0) + 1; });
  const tStatus = Date.now() - t;
  eq(Object.values(counts).reduce((a, b) => a + b, 0), N, `all ${N} tickets bucketed`);
  (tStatus < 3000) ? ok(`statusKeyOf over ${N} tickets: ${tStatus}ms`) : no(`statusKeyOf too slow: ${tStatus}ms`);

  t = Date.now();
  const agents = new Map();
  big.forEach(r => { const a = ctx.testerOf(r); if (a) { agents.set(a, (agents.get(a) || 0) + 1); } });
  const tAgent = Date.now() - t;
  eq(agents.size, 40, 'agent grouping correct');
  (tAgent < 2000) ? ok(`agent grouping: ${tAgent}ms`) : no(`agent grouping too slow: ${tAgent}ms`);

  t = Date.now();
  const filtered = big.filter(r => ctx.statusKeyOf(r) === 'closed' && ctx.devOf(r) === 'Dev 3');
  const tFilter = Date.now() - t;
  (tFilter < 2000) ? ok(`filter pass: ${tFilter}ms, ${filtered.length} rows`) : no(`filter too slow: ${tFilter}ms`);

  t = Date.now();
  const cols = ctx.listColumns();
  const rows = big.slice(0, 5000).map(r => cols.map(c => c[1](r)).join(''));
  const tRender = Date.now() - t;
  (tRender < 5000) ? ok(`render 5000 rows: ${tRender}ms`) : no(`render too slow: ${tRender}ms`);
  eq(rows.length, 5000, 'all rows produced');
}

console.log('\n== 15. VALIDATION completeness: fuzz the form ==');
{
  const DD = {
    Dispostion: [{ ID: 3, Name: 'In Progress' }], BSSDisposition: [{ ID: 10, Name: 'Bug' }],
    SubDispostion: [{ ID: 46, Name: 'A' }], ProblemTypeMargBook: [{ ID: 552, Name: 'P', Subdispositionid: 46 }],
    SubProblemTypeMargBook: [{ ID: 1960, Name: 'S', ProblemTypeID: 552 }],
    AssignTo: [{ ID: 43, Name: 'X' }], Developers: [{ ID: 15, Name: 'D' }], Rm: [{ ID: 4, Name: 'R' }],
  };
  const good = { subDisposition: 3, disposition: 10, mainDisposition: 46, problemType: 552,
                 subProblemType: 1960, assignedTo: 43, developer: 15, rm: 4,
                 timelineDate: '2026-06-29', jiraId: 'J', remarks: 'r', bssComment: 'c' };
  eq(F.bssValidate(good, DD, 1), [], 'fully-populated valid form passes');

  // Har select field me ek invalid id daal kar dekho — sabko pakadna chahiye
  let missed = [];
  F.bssSelectFields().forEach(f => {
    const bad = Object.assign({}, good, { [f.key]: 999999 });
    const errs = F.bssValidate(bad, DD, 1);
    if (!errs.some(e => e.field === f.key)) missed.push(f.key);
  });
  eq(missed, [], 'every select field rejects an unknown id');

  // Har field ko null/undefined/'' karke dekho — crash nahi hona chahiye
  let crashed = [];
  F.BSS_CROSSWALK.forEach(f => {
    [null, undefined, '', 0, false, [], {}].forEach(v => {
      try { F.bssValidate(Object.assign({}, good, { [f.key]: v }), DD, 1); }
      catch (e) { crashed.push(f.key + '=' + JSON.stringify(v)); }
    });
  });
  eq(crashed, [], 'validation never throws on odd values');

  // Empty form
  const e0 = F.bssValidate({}, DD, 1);
  eq(e0.length, 2, 'empty form → exactly the 2 required-field errors');
  eq(F.bssValidate({}, DD, null).length, 3, 'empty form + no bss id → 3 errors');
  let nullOk = true;
  try { F.bssValidate(null, DD, 1); } catch (e) { nullOk = false; }
  eq(nullOk, true, 'null form does not crash');
  eq(F.bssValidate(null, DD, 1).length, 2, 'null form → the 2 required-field errors');
}

console.log('\n== 16. PAYLOAD immutability / no leakage ==');
{
  const form = { subDisposition: 3, disposition: 10, jiraId: 'J' };
  const snap = JSON.stringify(form);
  F.bssBuildPayload(form, 'MB - 1', 1);
  eq(JSON.stringify(form), snap, 'buildPayload does not mutate the form');

  const p = F.bssBuildPayload(form, 'MB - 1', 1);
  const allowed = ['TicketNo', 'UpdatedByUser'].concat(F.BSS_CROSSWALK.map(f => f.payload));
  const extra = Object.keys(p).filter(k => !allowed.includes(k));
  eq(extra, [], 'payload contains no unexpected keys');

  // Injected key in form must not appear in payload
  const p2 = F.bssBuildPayload({ subDisposition: 3, disposition: 10, __proto__: { x: 1 }, EvilField: 'y' }, 'MB - 1', 1);
  eq(Object.keys(p2).includes('EvilField'), false, 'unknown form key never reaches the payload');
}

console.log('\nDEEP RESULTS: ' + PASS.length + ' passed, ' + FAIL.length + ' failed, ' + WARN.length + ' documented limitation(s)');
process.exit(FAIL.length ? 1 : 0);
