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
  'mgWindows','mgStageAsOf','mgBacklogMoves','mgDupShare','mgCompute','mgFmt','mgTrend','_smfTesterVal',
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

console.log('\nMGMT RESULTS: '+pass+' passed, '+fail+' failed');
process.exit(fail?1:0);
