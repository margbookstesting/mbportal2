/* Management tab ke metrics ka offline test.
   Page se ASLI function bodies nikal kar chalate hain (copy-paste nahi), taaki
   test aur page kabhi alag na ho jayen. */
const fs=require('fs'), vm=require('vm');
const path=require('path');
const ROOT=path.join(__dirname,'..');
const PAGE=path.join(ROOT,'marg_ticket_dashboard.html');
const PARSER=path.join(ROOT,'assets/ticket-parser.js');

const html=fs.readFileSync(PAGE,'utf8');

// page ka JS nikalo
const scripts=[...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map(m=>m[1]);
const pageJs=scripts.join('\n');

// sirf wahi hisse chahiye jo metrics chalate hain
function grab(name, src){
  const i=src.indexOf('function '+name+'(');
  if(i<0) throw new Error('not found: '+name);
  let d=0, started=false;
  for(let j=i;j<src.length;j++){
    if(src[j]==='{'){d++;started=true;}
    else if(src[j]==='}'){d--; if(started&&d===0) return src.slice(i,j+1);}
  }
  throw new Error('unbalanced: '+name);
}
const NEEDED=['mgShift','mgToday','mgDayDiff','mgPctile','mgOpenAsOf','mgLastAct',
  'mgWindows','mgStageAsOf','mgBacklogMoves','mgDupShare','esc','mgResCell','mgFmtDate','mgTargetMiss','mgExceptions','mgCompute','mgFmt','mgTrend','_smfTesterVal',
  'aiClean','aiTokens','aiVectorize','aiCosSparse','aiNormMap','aiAddMap','aiClusterSparse',
  'lastDisp','isBug'];

const sandbox={console, RAW:[], fmt:n=>Number(n||0).toLocaleString('en-IN')};
vm.createContext(sandbox);
vm.runInContext(fs.readFileSync(PARSER,'utf8'), sandbox);   // mbTesterOf etc.

// MG_DATE_KEYS aur AI_STOP jaise consts bhi chahiye
const consts=pageJs.match(/const MG_DATE_KEYS=\[[^\]]*\];/)[0];
vm.runInContext(consts, sandbox);
vm.runInContext(pageJs.match(/const MG_STAGE_ORDER = \[[^\]]*\];/)[0], sandbox);
vm.runInContext(pageJs.match(/const MG_IT_BACKLOG  = new Set\([^)]*\);/)[0], sandbox);
vm.runInContext(pageJs.match(/const MG_ROWS=\[[\s\S]*?\n\];/)[0], sandbox);
/* `const` vm context ke sandbox OBJECT par attach nahi hota, isliye
   value alag se nikalni padti hai. */
const MG_ROWS_VAL = vm.runInContext('MG_ROWS', sandbox);
const aiStop=pageJs.match(/const AI_STOP\s*=\s*new Set\([\s\S]*?\);/);
if(aiStop) vm.runInContext(aiStop[0], sandbox);

NEEDED.forEach(n=>{ try{ vm.runInContext(grab(n,pageJs), sandbox); }catch(e){ console.log('SKIP '+n+': '+e.message); } });

let pass=0, fail=0;
function eq(label, got, want){
  const ok = (typeof want==='number' && typeof got==='number')
    ? Math.abs(got-want)<0.01 : JSON.stringify(got)===JSON.stringify(want);
  if(ok){pass++; console.log('  PASS: '+label);}
  else {fail++; console.log('  FAIL: '+label+' → got '+JSON.stringify(got)+', want '+JSON.stringify(want));}
}

// ── window math ──
console.log('== 1. window math ==');
eq('upto 27-08 → this week starts 21-08', sandbox.mgWindows('2026-08-27').cur[0], '2026-08-21');
eq('this week ends on upto',              sandbox.mgWindows('2026-08-27').cur[1], '2026-08-27');
eq('prev week starts 14-08',              sandbox.mgWindows('2026-08-27').prev[0], '2026-08-14');
eq('prev week ends 20-08',                sandbox.mgWindows('2026-08-27').prev[1], '2026-08-20');
eq('windows do not overlap',              sandbox.mgWindows('2026-08-27').prev[1] < sandbox.mgWindows('2026-08-27').cur[0], true);
eq('month boundary crossing',             sandbox.mgWindows('2026-03-03').cur[0], '2026-02-25');
eq('leap year Feb',                       sandbox.mgShift('2028-03-01',-1), '2028-02-29');

// ── as-of stage reconstruction ──
console.log('== 2a. stage as-of X ==');
const X='2026-08-27';
eq('latest stage <= X wins',    sandbox.mgStageAsOf({a:'2026-08-01',b:'2026-08-05',c:'2026-08-09'},X), 'c');
eq('stage after X ignored',     sandbox.mgStageAsOf({a:'2026-08-01',b:'2026-08-05',c:'2026-09-09'},X), 'b');
eq('no stage by X → empty',     sandbox.mgStageAsOf({a:'2026-09-01'},X), '');
eq('tie → later stage wins',    sandbox.mgStageAsOf({a:'2026-08-01',b:'2026-08-05',c:'2026-08-05'},X), 'c');
eq('exit wins tie vs go-live',  sandbox.mgStageAsOf({a:'2026-08-01',e:'2026-08-10',d:'2026-08-10'},X), 'd');

/* IT backlog = 7 stages only. Transfer-To-IT, Rejected, Future Development,
   Reopen aur Reopened-From-Testing backlog me NAHI gine jate. */
console.log('== 2b. IT backlog membership (8 stages) ==');
eq('Transfer To IT only → NOT backlog', sandbox.mgOpenAsOf({a:'2026-08-01'},X), false);
/* Legacy rows: Acknowledge/In-Progress date hai par Transfer-To-IT date nahi.
   Ye IT me aaye hi nahi (ya record adhoora hai), to backlog me nahi ginte.
   Asli data me aise 38 tickets the, sab 2023 ke. */
eq('Acknowledge without Transfer-To-IT → NOT backlog', sandbox.mgOpenAsOf({b:'2023-06-26'},X), false);
eq('In Progress without Transfer-To-IT → NOT backlog', sandbox.mgOpenAsOf({b:'2023-05-19',c:'2023-05-23'},X), false);
eq('Transfer-To-IT AFTER X → NOT backlog', sandbox.mgOpenAsOf({a:'2026-09-05',b:'2026-08-02'},X), false);
eq('no-Transfer-To-IT row makes no backlog moves',
   sandbox.mgBacklogMoves({b:'2026-08-22',c:'2026-08-24'},'2026-08-21','2026-08-27'), {entries:0, exits:0});
eq('Acknowledge → backlog',        sandbox.mgOpenAsOf({a:'2026-08-01',b:'2026-08-02'},X), true);
eq('In Progress → backlog',        sandbox.mgOpenAsOf({a:'2026-08-01',c:'2026-08-03'},X), true);
eq('Ready For Testing → backlog',  sandbox.mgOpenAsOf({a:'2026-08-01',rtd:'2026-08-05'},X), true);
eq('Ready For Code Review → backlog', sandbox.mgOpenAsOf({a:'2026-08-01',crd:'2026-08-05'},X), true);
eq('Ready For Merging → backlog',  sandbox.mgOpenAsOf({a:'2026-08-01',mgd:'2026-08-05'},X), true);
eq('Ready For UAT → backlog',      sandbox.mgOpenAsOf({a:'2026-08-01',uad:'2026-08-05'},X), true);
eq('Ready To Go Live → backlog',   sandbox.mgOpenAsOf({a:'2026-08-01',e:'2026-08-06'},X), true);
eq('Rejected → NOT backlog',       sandbox.mgOpenAsOf({a:'2026-08-01',b:'2026-08-02',rjd:'2026-08-07'},X), false);
eq('Future Development → NOT backlog', sandbox.mgOpenAsOf({a:'2026-08-01',b:'2026-08-02',fdd:'2026-08-07'},X), false);
eq('Reopen → NOT backlog',         sandbox.mgOpenAsOf({a:'2026-08-01',b:'2026-08-02',rod:'2026-08-07'},X), false);
eq('Reopened From Testing → backlog', sandbox.mgOpenAsOf({a:'2026-08-01',b:'2026-08-02',rfd:'2026-08-07'},X), true);
eq('Transfer To Support → NOT backlog', sandbox.mgOpenAsOf({a:'2026-08-01',b:'2026-08-02',d:'2026-08-10'},X), false);
eq('Closed → NOT backlog',         sandbox.mgOpenAsOf({a:'2026-08-01',b:'2026-08-02',cld:'2026-08-10'},X), false);
eq('exit AFTER X → still backlog', sandbox.mgOpenAsOf({a:'2026-08-01',b:'2026-08-02',d:'2026-09-10'},X), true);
eq('everything after X → not backlog', sandbox.mgOpenAsOf({a:'2026-09-01',b:'2026-09-02'},X), false);
eq('rejected then re-acked → backlog', sandbox.mgOpenAsOf({a:'2026-08-01',rjd:'2026-08-05',b:'2026-08-20'},X), true);
eq('exit then reopened+inprog → backlog', sandbox.mgOpenAsOf({a:'2026-08-01',d:'2026-08-05',rod:'2026-08-08',c:'2026-08-20'},X), true);

console.log('== 3. last activity ignores future dates ==');
eq('future stage date not counted',
   sandbox.mgLastAct({a:'2026-08-01', c:'2026-09-15'},'2026-08-27'), '2026-08-01');
eq('latest <= X wins',
   sandbox.mgLastAct({a:'2026-08-01', b:'2026-08-09', rtd:'2026-08-20'},'2026-08-27'), '2026-08-20');
eq('reopen pulls activity forward',
   sandbox.mgLastAct({a:'2026-01-01', rod:'2026-08-25'},'2026-08-27'), '2026-08-25');

// ── metrics ──
console.log('== 4. metrics on synthetic data ==');
const W=['2026-08-21','2026-08-27'];
sandbox.RAW=[
  // 4 IT me aaye is hafte
  {n:'T1', a:'2026-08-21', b:'2026-08-22', bt:'I', c:'2026-08-23', d:'2026-08-25', dt:'I', dev:'D1', desc:'gst report not printing', l:'L1', ts:'QA1'},
  {n:'T2', a:'2026-08-22', b:'2026-08-23', bt:'O', d:'2026-08-26', dt:'O', dev:'D1', desc:'gst report print issue', l:'L1', ts:'QA1'},
  {n:'T3', a:'2026-08-23', b:'2026-08-24', desc:'gst report printing problem', l:'L1', ts:'QA1'},
  {n:'T4', a:'2026-08-24', b:'2026-08-25', desc:'stock ledger mismatch', l:'L2', ts:'QA2'},
  // pichhle hafte ka, abhi bhi backlog me, 30+ din se nahi hila
  {n:'T5', a:'2026-06-01', b:'2026-06-02', desc:'old one', l:'L1', ts:'QA1'},
  // go live is hafte
  {n:'T6', a:'2026-07-01', e:'2026-08-25', et:'I', d:'2026-08-26', dev:'D2', desc:'x', l:'L3', ts:'QA2'},
  /* Ye do backlog me NAHI aane chahiye — intake window se bahar hain to
     baaki metrics par asar nahi padta, sirf stock check karte hain. */
  {n:'T7', a:'2026-08-20', desc:'IT ko mila par acknowledge nahi hua', l:'L4', ts:'QA3'},
  {n:'T8', a:'2026-07-01', b:'2026-07-02', rjd:'2026-07-10', desc:'rejected', l:'L5', ts:'QA3'},
];
const m=sandbox.mgCompute(W[0], W[1]);

/* _in/_out ab BACKLOG entries/exits hain (Transfer-To-IT / Transfer-To-Support
   dates nahi), taaki reconciliation identity sach rahe.
   Backlog entry Acknowledge (ya kisi aur backlog stage) par hoti hai —
   Transfer To IT backlog me nahi hai.
   Is hafte (21-27 Aug) ghuse (5): T1 b-22, T2 b-23, T3 b-24, T4 b-25,
   T6 e-25 (T6 pehle sirf Transfer-To-IT par tha).
   Nikle (3): T1 d-25, T2 d-26, T6 d-26.
   T1/T2/T6 ek hi window me ghuse aur nikle, to dono taraf ginte hain.
   T5 window se pehle ghusa tha; T7 (sirf Transfer-To-IT) kabhi backlog me
   aaya hi nahi; T8 July me reject ho gaya. */
eq('backlog entries',       m._in, 5);        // T1,T2,T3,T4,T6
eq('backlog exits',         m._out, 3);       // T1,T2,T6
eq('flow ratio 3/5',        m.flow, 0.6);
eq('bypass base = Transfer-To-Support exits', m._dExitN, 3);
eq('ack in-TAT 50%',        m.ackTat, 50);    // T1 I, T2 O
eq('ack in-TAT base = flagged only', m._ackN, 2);
/* Transfer-to-Support in-TAT: T1 dt=I, T2 dt=O, T6 ka d 26-08 hai par
   dt flag nahi aaya — wo denominator me nahi ginta. */
eq('transfer-to-support in-TAT 50%', m.ttsTat, 50);
eq('tts base counts only flagged',   m._ttsN, 2);   // T1,T2
eq('go-live in-TAT still computed',  m.glvTat, 100);// T6 (table me nahi dikhta)
eq('QA bypass 33%',         Math.round(m.bypass), 33);  // T6 skipped b+c, of 3 exits
eq('cycle P50 = 4d',        m.cycP50, 4);     // T1=4, T2=4, T6=56 → P50 4
eq('cycle P90 = 56d',       m.cycP90, 56);
eq('open as of 27-08',      m._open, 3);      // T3,T4,T5 — T7 (only Transfer-To-IT) & T8 (rejected) out
eq('backlog exposed as a metric row', m.openBacklog, 3);
eq('Transfer-To-IT-only NOT in backlog (T7)', sandbox.mgOpenAsOf({a:'2026-08-20'},'2026-08-27'), false);
eq('Rejected NOT in backlog (T8)', sandbox.mgOpenAsOf({a:'2026-07-01',b:'2026-07-02',rjd:'2026-07-10'},'2026-08-27'), false);
eq('backlog last week (as of 20-08)', sandbox.mgCompute('2026-08-14','2026-08-20')._open, 1);  // sirf T5

/* "Backlog 30 days earlier" = window ke aakhri din se 30 din peeche ka stock.
   Window 21-27 Aug → 27 Aug - 30 = 28 Jul. Us din backlog me sirf T5 tha —
   T6 tab Transfer-To-IT par tha (backlog nahi), T7 aaya hi nahi tha aur T8
   10 Jul ko reject ho chuka tha. */
eq('30-day lag date',       m._d30, '2026-07-28');
eq('backlog 30 days earlier', m.backlog30, 1);            // sirf T5
eq('lag date = end - 30',   sandbox.mgDayDiff(m._d30,'2026-08-27'), 30);
eq('lag matches a direct as-of count',
   m.backlog30, sandbox.RAW.filter(r=>sandbox.mgOpenAsOf(r,'2026-07-28')).length);

/* ── 3. RECONCILIATION — sabse important check ──
   backlog(window ke pehle din se ek din pehle) + entries - exits
     HAMESHA  backlog(window ka aakhri din)  ke barabar hona chahiye.
   Ye identity toot gayi to backlog, flow ratio ya stage set me se koi ek
   dusre se out of sync hai. */
console.log('== 4b. backlog reconciliation identity ==');
eq('start + entries - exits = end',
   m._openStart + m._in - m._out, m._open);
[['2026-08-14','2026-08-20'],['2026-08-21','2026-08-27'],['2026-06-01','2026-06-07'],
 ['2026-07-15','2026-07-21'],['2026-08-25','2026-08-31']].forEach(w=>{
  const q=sandbox.mgCompute(w[0],w[1]);
  eq('identity holds for '+w[0]+'..'+w[1], q._openStart + q._in - q._out, q._open);
});
eq('a ticket entering AND leaving in one window counts in both',
   sandbox.mgBacklogMoves({a:'2026-08-21',b:'2026-08-22',d:'2026-08-25'},'2026-08-21','2026-08-27'),
   {entries:1, exits:1});
eq('Transfer-To-IT alone is not a backlog entry',
   sandbox.mgBacklogMoves({a:'2026-08-22'},'2026-08-21','2026-08-27'), {entries:0, exits:0});
eq('Rejected counts as a backlog exit',
   sandbox.mgBacklogMoves({a:'2026-08-01',b:'2026-08-02',rjd:'2026-08-25'},'2026-08-21','2026-08-27'),
   {entries:0, exits:1});
eq('Reopened-From-Testing is NOT an exit (still IT work)',
   sandbox.mgBacklogMoves({a:'2026-08-01',b:'2026-08-02',rfd:'2026-08-25'},'2026-08-21','2026-08-27'),
   {entries:0, exits:0});
eq('aged 30d+',             m.aged30, 1);     // T5 (June)
eq('assigned open',         m._assigned, 3);   // T3 QA1, T4 QA2, T5 QA1
eq('top2 load = 100%',      m.loadTop2, 100); // only QA1 (2) + QA2 (1) exist
eq('accounts 5+ = 0',       m.acc5, 0);
eq('dup share > 0 (3 gst tickets cluster)', m.dupShare > 0, true);
eq('dup base = intake with desc', m._dupN, 4);

console.log('== 4b. in-TAT denominator = sirf TAT flag wale tickets ==');
/* Dashboard KPI cards `tatTot = intat + outtat` use karte hain, poora set
   nahi. Ye test isi parity ko pakadta hai — pehle Management 13% ki jagah
   11% dikha raha tha kyunki bina flag wale bhi denominator me the. */
sandbox.RAW=[
  {n:'A1', b:'2026-08-24', bt:'I'},
  {n:'A2', b:'2026-08-24', bt:'O'},
  {n:'A3', b:'2026-08-24'},              // TAT flag abhi nahi aaya
  {n:'A4', b:'2026-08-24'},
  {n:'A5', b:'2026-08-25', et:'I', e:'2026-08-25'},
  {n:'A6', b:'2026-08-25', e:'2026-08-26'},   // go-live flag nahi
  {n:'A7', d:'2026-08-25', dt:'I'},
  {n:'A8', d:'2026-08-25', dt:'O'},
  {n:'A9', d:'2026-08-26'},                   // transfer-to-support flag nahi
];
const t=sandbox.mgCompute(W[0], W[1]);
eq('ack in-TAT ignores unflagged rows', t.ackTat, 50);   // 1 of (1 I + 1 O)
eq('ack base counts only flagged',      t._ackN, 2);
eq('go-live in-TAT ignores unflagged',  t.glvTat, 100);  // 1 I, 0 O
eq('go-live base counts only flagged',  t._glvN, 1);
eq('transfer-to-support in-TAT 50%',    t.ttsTat, 50);   // A7 I, A8 O
eq('tts base ignores unflagged (A9)',   t._ttsN, 2);
/* Return to Support ka koi date/TAT field BSS deta hi nahi, isliye wo is
   number me shamil nahi hai — sirf status (sc==='RS') se pata chalta hai. */
eq('a Return-to-Support row adds nothing (no d, no dt)',
   sandbox.mgCompute('2026-08-21','2026-08-27')._ttsN, 2);
eq('no flags at all → null, not 0',
   sandbox.mgCompute('2026-08-21','2026-08-27').ackTat!==null, true);

console.log('== 5. empty window is safe ==');
const e0=sandbox.mgCompute('2020-01-01','2020-01-07');
eq('no crash, null ack',  e0.ackTat, null);
eq('flow null not NaN',   e0.flow, null);
eq('open 0',              e0._open, 0);
eq('dup null',            e0.dupShare, null);

console.log('== 6. trend direction ==');
eq('in-TAT up is good',        sandbox.mgTrend(80,60,'up').cls, 'mg-up');
eq('in-TAT down is bad',       sandbox.mgTrend(60,80,'up').cls, 'mg-down');
eq('bypass up is bad',         sandbox.mgTrend(9,4,'down').cls, 'mg-down');
eq('bypass down is good',      sandbox.mgTrend(4,9,'down').cls, 'mg-down'===''?'':'mg-up');
eq('tiny change is flat',      sandbox.mgTrend(50.1,50,'up').txt, '→');
eq('null prev is dash',        sandbox.mgTrend(50,null,'up').txt, '—');

console.log('== 7. formatting ==');
eq('pct',   sandbox.mgFmt(66.6,'pct'), '67%');
eq('ratio', sandbox.mgFmt(0.75,'ratio'), '0.75');
eq('x',     sandbox.mgFmt(6.04,'x'), '6.0x');
eq('null',  sandbox.mgFmt(null,'pct'), '—');
eq('Infinity guarded', sandbox.mgFmt(Infinity,'ratio'), '—');



/* ══════════════ PHASE 2 — snapshots + resolution/owner ══════════════ */
console.log('== 8. phase 2: escaping + resolution cell ==');
sandbox.MG_RES={}; sandbox.MG_WEEK='2026-08-27';

eq('esc escapes quotes',   sandbox.esc('a"b'), 'a&quot;b');
eq('esc escapes apostrophe', sandbox.esc("O'Brien"), 'O&#39;Brien');
eq('esc escapes tags',     sandbox.esc('<b>x</b>'), '&lt;b&gt;x&lt;/b&gt;');
eq('esc handles null',     sandbox.esc(null), '');

/* Resolution user ka free text hai aur seedha innerHTML me jata hai. Ek
   quote bhi bina escape ke poori table tod deti thi. */
sandbox.MG_RES={openBacklog:{resolution:'Fix "GST" bug', owner:"O'Brien"}};
const cell=sandbox.mgResCell('openBacklog');
eq('cell is a full <td>',        /^<td class="mg-res-cell">/.test(cell), true);
eq('resolution value escaped',   cell.includes('Fix &quot;GST&quot; bug'), true);
eq('owner value escaped',        cell.includes('O&#39;Brien'), true);
eq('raw quote never reaches html', /value="Fix "GST"/.test(cell), false);
eq('owner input uses the datalist', cell.includes('list="mgOwnerList"'), true);
eq('meta span is addressable',   cell.includes('id="mgResMeta_openBacklog"'), true);

/* XSS: resolution me script tag daalne se kuch execute nahi hona chahiye. */
sandbox.MG_RES={flow:{resolution:'<img src=x onerror=alert(1)>', owner:''}};
const evil=sandbox.mgResCell('flow');
eq('script payload neutralised', evil.includes('<img'), false);
eq('payload shown as text',      evil.includes('&lt;img'), true);

eq('empty metric id → empty cell', sandbox.mgResCell(''), '<td></td>');

sandbox.MG_RES={};
const blank=sandbox.mgResCell('aged30');
eq('no saved row → empty inputs', (blank.match(/value=""/g)||[]).length, 2);

console.log('== 9. phase 2: week key ==');
/* week_end = window ka aakhri din. Resolution aur snapshot dono isi par
   chalte hain, to ye galat hua to pichhle hafte ke notes is hafte dikhne
   lagenge. */
const w2=sandbox.mgWindows('2026-08-31');
eq('week_end is the window end',  w2.cur[1], '2026-08-31');
eq('prev week_end is 7 days back', w2.prev[1], '2026-08-24');
eq('date formatter is readable',  sandbox.mgFmtDate('2026-08-31'), '31 Aug 2026');


/* ══════ 10. spec compliance — trend arrow, targets, exceptions ══════ */
console.log('== 10. trend shows direction of IMPROVEMENT ==');
/* Spec: "▲ improving · ▼ worsening — direction of improvement, not of the
   raw number." Pehle arrow raw number se banta tha, to backlog ghatne par
   ▼ dikhta tha — sudhar bigad jaisa padha jata tha. */
eq('backlog down = improving = ▲', sandbox.mgTrend(802, 840, 'down').txt, '▲');
eq('backlog up = worsening = ▼',   sandbox.mgTrend(840, 802, 'down').txt, '▼');
eq('in-TAT up = improving = ▲',    sandbox.mgTrend(60, 40, 'up').txt,  '▲');
eq('in-TAT down = worsening = ▼',  sandbox.mgTrend(40, 60, 'up').txt,  '▼');
eq('improving arrow is green',     sandbox.mgTrend(802, 840, 'down').cls, 'mg-up');
eq('worsening arrow is red',       sandbox.mgTrend(840, 802, 'down').cls, 'mg-down');
eq('flat stays flat',              sandbox.mgTrend(802, 802, 'down').txt, '→');

console.log('== 11. targets match the one-page spec ==');
const tgt={}; MG_ROWS_VAL.forEach(r=>{ if(r.id) tgt[r.id]=r.target; });
eq('Acknowledge in-TAT 95%',  tgt.ackTat,    '95%');
eq('Aged backlog 0',          tgt.aged90,    '0');
eq('Duplicate share < 10%',   tgt.dupShare,  '< 10%');
eq('QA bypass < 5%',          tgt.bypass,    '< 5%');
eq('Flow ratio >= 1.0',       tgt.flow,      '≥ 1.0');
eq('Load concentration < 35% ea', tgt.loadTop2, '< 35% ea');
eq('Accounts 5+ target 0',    tgt.acc5,      '0');
eq('Dev spread < 2.5x',       tgt.devSpread, '< 2.5x');
eq('Rework < 15%',            tgt.rework,    '< 15%');
eq('aged90 row exists',       !!MG_ROWS_VAL.find(r=>r.id==='aged90'), true);

console.log('== 12. target-miss parser ==');
eq('12 misses < 10%',      sandbox.mgTargetMiss(12, '< 10%'), true);
eq('8 meets < 10%',        sandbox.mgTargetMiss(8,  '< 10%'), false);
eq('0.7 misses >= 1.0',    sandbox.mgTargetMiss(0.7,'≥ 1.0'), true);
eq('1.4 meets >= 1.0',     sandbox.mgTargetMiss(1.4,'≥ 1.0'), false);
eq('40 misses bare 95%',   sandbox.mgTargetMiss(40, '95%'),   true);
eq('96 meets bare 95%',    sandbox.mgTargetMiss(96, '95%'),   false);
eq('3 misses target 0',    sandbox.mgTargetMiss(3,  '0'),     true);
eq('0 meets target 0',     sandbox.mgTargetMiss(0,  '0'),     false);
eq('6x misses < 2.5x',     sandbox.mgTargetMiss(6,  '< 2.5x'),true);
/* Jo target insaani hai uspar chup raho — guess karke jhooti escalation
   banane se behtar hai kuch na kehna. */
eq('baseline → no verdict',   sandbox.mgTargetMiss(5, 'baseline'), null);
eq('declining → no verdict',  sandbox.mgTargetMiss(5, 'declining'), null);
eq('week-on-week → no verdict',sandbox.mgTargetMiss(5,'↓ week on week'), null);
eq('2-quarter goal → no verdict', sandbox.mgTargetMiss(5,'↓ 30% in 2 quarters'), null);
eq('null value → no verdict', sandbox.mgTargetMiss(null, '< 10%'), null);

console.log('== 13. exceptions block ==');
/* Spec: "a red metric with no resolution and no owner is the escalation",
   aur "max five exceptions". */
const bad ={dupShare:40, bypass:30, loadTop2:90, acc5:9, devSpread:9, flow:0.2, ackTat:10, aged90:7, cycP50:5};
const good={dupShare:1,  bypass:1,  loadTop2:1,  acc5:0, devSpread:1, flow:2.0, ackTat:99, aged90:0, cycP50:5};
sandbox.MG_RES={};
const ex=sandbox.mgExceptions(bad, good);
eq('capped at five',            ex.length, 5);
eq('every entry has a reason',  ex.every(e=>e.why && e.label), true);
eq('off rows never escalate',   ex.some(e=>/GitLab|Escaped|CSAT/.test(e.label)), false);

sandbox.MG_RES={};
eq('all healthy → no escalations', sandbox.mgExceptions(good, good).length, 0);

/* Owner likh dene se escalation hat jana chahiye. */
sandbox.MG_RES={dupShare:{resolution:'',owner:'Eng lead'}};
const one=sandbox.mgExceptions({dupShare:40}, {dupShare:1});
eq('owner clears the escalation', one.length, 0);
sandbox.MG_RES={dupShare:{resolution:'Sprint scoped',owner:''}};
eq('resolution alone also clears', sandbox.mgExceptions({dupShare:40},{dupShare:1}).length, 0);
sandbox.MG_RES={dupShare:{resolution:'   ',owner:'  '}};
eq('whitespace does not count as written',
   sandbox.mgExceptions({dupShare:40},{dupShare:1}).length, 1);
sandbox.MG_RES={};


/* ══════ 14. INVARIANTS — har window par sach hone chahiye ══════
   Ye rules kisi ek number ko nahi, metrics ke aapsi rishte ko pakadte hain.
   Koi bhi definition badle to inme se kuch na kuch turant red hoga. */
console.log('== 14. cross-metric invariants ==');
const WINS=[['2026-08-21','2026-08-27'],['2026-08-14','2026-08-20'],
            ['2026-06-01','2026-06-07'],['2026-07-01','2026-07-07']];
let invBad=0;
WINS.forEach(([f,t])=>{
  const c=sandbox.mgCompute(f,t);
  const rules=[
    ['reconciliation holds',   c._openStart+c._in-c._out===c._open],
    ['aged90 subset of aged30',c.aged90<=c.aged30],
    ['aged30 subset of backlog',c.aged30<=c._open],
    ['assigned <= backlog',    c._assigned<=c._open],
    ['flow = exits/entries',   c.flow===null||Math.abs(c.flow-c._out/c._in)<1e-9],
    ['P50 <= P90',             c.cycP50===null||c.cycP90===null||c.cycP50<=c.cycP90],
    ['cycN <= transfer exits', c._cycN<=c._dExitN],
    ['devSpread >= 1',         c.devSpread===null||c.devSpread>=1],
    ['percentages within 0-100',
      [c.ackTat,c.ttsTat,c.bypass,c.runChange,c.loadTop2,c.dupShare]
        .every(v=>v===null||(v>=0&&v<=100))],
    ['counts never negative',  [c._open,c.backlog30,c.aged30,c.aged90,c.acc5,c._in,c._out]
        .every(v=>v>=0)],
    ['openBacklog mirrors _open', c.openBacklog===c._open],
    ['d30 is exactly 30 days back', sandbox.mgDayDiff(c._d30,t)===30],
    ['at most 3 duplicate clusters', !c._dupTop||c._dupTop.length<=3],
  ];
  rules.forEach(([nm,ok])=>{ if(!ok) invBad++; eq(nm+' ('+t+')', ok, true); });
});

/* ══════ 15. degenerate input — dashboard kabhi crash na ho ══════ */
console.log('== 15. degenerate inputs ==');
const savedRaw=sandbox.RAW;

sandbox.RAW=[];
let z; let crashed=false;
try{ z=sandbox.mgCompute('2026-08-21','2026-08-27'); }catch(e){ crashed=true; }
eq('empty RAW does not throw', crashed, false);
eq('empty → nulls, not NaN',
   [z.ackTat,z.flow,z.dupShare,z.loadTop2,z.devSpread].every(v=>v===null), true);
eq('empty → zero counts', z._open===0&&z.acc5===0&&z.aged90===0, true);
eq('empty → reconciliation still holds', z._openStart+z._in-z._out, z._open);

sandbox.RAW=[{n:'x'},{n:'y',a:null,b:undefined},{n:'z',a:'',b:''},{n:'w',a:0}];
crashed=false;
try{ z=sandbox.mgCompute('2026-08-21','2026-08-27'); }catch(e){ crashed=true; }
eq('null/blank/zero dates do not throw', crashed, false);
eq('blank dates never enter the backlog', z._open, 0);

sandbox.RAW=[{n:'f',a:'2030-01-01',b:'2030-01-02',l:'L1',ts:'Q1'}];
z=sandbox.mgCompute('2026-08-21','2026-08-27');
eq('future ticket not in backlog', z._open, 0);
eq('future ticket not an entry',   z._in, 0);

sandbox.RAW=savedRaw;

console.log('== 16. mgFmt never prints NaN ==');
eq('null → dash',     sandbox.mgFmt(null,'pct'),     '—');
eq('Infinity → dash', sandbox.mgFmt(Infinity,'ratio'),'—');
eq('NaN → dash',      sandbox.mgFmt(NaN,'x'),        '—');
eq('zero is shown',   sandbox.mgFmt(0,'pct'),        '0%');

console.log('== 17. every live row has data behind it ==');
const live=MG_ROWS_VAL.filter(r=>r.id && r.f!=='off');
const probe=sandbox.mgCompute('2026-08-21','2026-08-27');
live.forEach(r=>{
  const key = r.id==='cycTime' ? 'cycP50' : r.id;
  eq('mgCompute produces '+r.id, key in probe, true);
});
eq('off rows all carry a target',
   MG_ROWS_VAL.filter(r=>r.f==='off').every(r=>!!r.target), true);

console.log('\nMGMT RESULTS: '+pass+' passed, '+fail+' failed');
process.exit(fail?1:0);
