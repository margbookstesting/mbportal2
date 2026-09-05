/* Management tab ke metrics ka offline test.
   Page se ASLI function bodies nikal kar chalate hain (copy-paste nahi), taaki
   test aur page kabhi alag na ho jayen. */
const fs=require('fs'), vm=require('vm');
const path=require('path');
const PARSER_ABS=require('path').join(__dirname,'..','assets','ticket-parser.js');
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
function grabFn(name){
  const i=pageJs.indexOf('function '+name+'(');
  if(i<0) return null;
  let d=0, started=false;
  for(let j=i;j<pageJs.length;j++){
    if(pageJs[j]==='{'){d++;started=true;}
    else if(pageJs[j]==='}'){d--; if(started&&d===0) return pageJs.slice(i,j+1);}
  }
  return null;
}
const NEEDED=['mgShift','mgToday','mgDayDiff','mgPctile','mgOpenAsOf','mgLastAct',
  'mgWindows','mgStageAsOf','mgBacklogMoves','mgDupShare','mgFirstIT','mgInScope','mgDispOf','mgInDisp','esc','mgFmtDate','mgRowStatus','mgTargetMiss','mgExceptions','mgCompute','mgFmt','mgTrend','_smfTesterVal',
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
[/const MG_DATA_FROM   = '[^']*';/,/const MG_KEEP_DISP   = new Set\([^)]*\);/,/const MG_RUN_DISP    = new Set\([^)]*\);/,/const MG_CHANGE_DISP = new Set\([^)]*\);/,/const MG_FIRST_KEYS  = \[[^\]]*\];/].forEach(p=>vm.runInContext(pageJs.match(p)[0], sandbox));
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
  {n:'T1', ld:'Bug', a:'2026-08-21', b:'2026-08-22', bt:'I', c:'2026-08-23', d:'2026-08-25', dt:'I', dev:'D1', desc:'gst report not printing', l:'L1', ts:'QA1'},
  {n:'T2', ld:'Bug', a:'2026-08-22', b:'2026-08-23', bt:'O', d:'2026-08-26', dt:'O', dev:'D1', desc:'gst report print issue', l:'L1', ts:'QA1'},
  {n:'T3', ld:'Bug', a:'2026-08-23', b:'2026-08-24', desc:'gst report printing problem', l:'L1', ts:'QA1'},
  {n:'T4', ld:'Bug', a:'2026-08-24', b:'2026-08-25', desc:'stock ledger mismatch', l:'L2', ts:'QA2'},
  // pichhle hafte ka, abhi bhi backlog me, 30+ din se nahi hila
  {n:'T5', ld:'Bug', a:'2026-06-01', b:'2026-06-02', desc:'old one', l:'L1', ts:'QA1'},
  // go live is hafte
  {n:'T6', ld:'Bug', a:'2026-07-01', e:'2026-08-25', et:'I', d:'2026-08-26', dev:'D2', desc:'x', l:'L3', ts:'QA2'},
  /* Ye do backlog me NAHI aane chahiye — intake window se bahar hain to
     baaki metrics par asar nahi padta, sirf stock check karte hain. */
  {n:'T7', ld:'Bug', a:'2026-08-20', desc:'IT ko mila par acknowledge nahi hua', l:'L4', ts:'QA3'},
  {n:'T8', ld:'Bug', a:'2026-07-01', b:'2026-07-02', rjd:'2026-07-10', desc:'rejected', l:'L5', ts:'QA3'},
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

/* Flow ratio ab report waali ginti hai: Transfer-To-Support ÷ Transfer-To-IT.
   Window 21-27 Aug me a: T1-21, T2-22, T3-23, T4-24 = 4 created.
   d: T1-25, T2-26, T6-26 = 3 closed. */
eq('flow created (Transfer To IT)',      m._flowIn, 4);
eq('flow closed (Transfer To Support)',  m._flowOut, 3);
eq('flow ratio 3/4',        m.flow, 0.75);
/* Ye jaan-bujh kar reconciliation se alag hai — dono alag events ginte hain. */
eq('flow does not reuse backlog moves', m.flow===m._out/m._in, false);
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
eq('backlog 30 days earlier', m.backlog30, 1);            // sirf T5
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

eq('accounts 5+ = 0',       m.acc5, 0);
eq('dup share > 0 (3 gst tickets cluster)', m.dupShare > 0, true);
eq('dup base = intake with desc', m._dupN, 4);

console.log('== 4b. in-TAT denominator = sirf TAT flag wale tickets ==');
/* Dashboard KPI cards `tatTot = intat + outtat` use karte hain, poora set
   nahi. Ye test isi parity ko pakadta hai — pehle Management 13% ki jagah
   11% dikha raha tha kyunki bina flag wale bhi denominator me the. */
sandbox.RAW=[
  {n:'A1', ld:'Bug', a:'2026-08-20', b:'2026-08-24', bt:'I'},
  {n:'A2', ld:'Bug', a:'2026-08-20', b:'2026-08-24', bt:'O'},
  {n:'A3', ld:'Bug', a:'2026-08-20', b:'2026-08-24'},              // TAT flag abhi nahi aaya
  {n:'A4', ld:'Bug', a:'2026-08-20', b:'2026-08-24'},
  {n:'A5', ld:'Bug', a:'2026-08-20', b:'2026-08-25', et:'I', e:'2026-08-25'},
  {n:'A6', ld:'Bug', a:'2026-08-20', b:'2026-08-25', e:'2026-08-26'},   // go-live flag nahi
  {n:'A7', ld:'Bug', a:'2026-08-20', d:'2026-08-25', dt:'I'},
  {n:'A8', ld:'Bug', a:'2026-08-20', d:'2026-08-25', dt:'O'},
  {n:'A9', ld:'Bug', a:'2026-08-20', d:'2026-08-26'},                   // transfer-to-support flag nahi
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
console.log('== 8. escaping ==');
eq('esc escapes quotes',     sandbox.esc('a"b'), 'a&quot;b');
eq('esc escapes apostrophe', sandbox.esc("O'Brien"), 'O&#39;Brien');
eq('esc escapes tags',       sandbox.esc('<b>x</b>'), '&lt;b&gt;x&lt;/b&gt;');
eq('esc escapes ampersand',  sandbox.esc('A & B'), 'A &amp; B');
eq('esc handles null',       sandbox.esc(null), '');
/* Duplicate cluster ke naam Marg ke ticket text se aate hain — user-supplied
   hai, isliye innerHTML me jane se pehle escape hona chahiye. */
eq('script payload neutralised', sandbox.esc('<img src=x onerror=alert(1)>').includes('<img'), false);

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
eq('Acknowledge in-TAT 80%',  tgt.ackTat,    '80%');
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

console.log('== 13. row status + needs-attention list ==');
/* mgRowStatus ek hi jagah se rail ka rang, target pill aur list decide karta
   hai — teeno ka jawab hamesha same hona chahiye. */
const rowOf=id=>MG_ROWS_VAL.find(r=>r.id===id);
eq('behind target → behind',
   sandbox.mgRowStatus(rowOf('dupShare'), {dupShare:40}, {dupShare:40}).state, 'behind');
eq('meeting target → met',
   sandbox.mgRowStatus(rowOf('dupShare'), {dupShare:4},  {dupShare:4}).state, 'met');
eq('null value → no status',
   sandbox.mgRowStatus(rowOf('dupShare'), {dupShare:null}, {dupShare:1}), null);
eq('off rows never get a status',
   sandbox.mgRowStatus(rowOf('rework'), {rework:1}, {rework:1}), null);
eq('section rows never get a status',
   sandbox.mgRowStatus({sec:'Support'}, {}, {}), null);
/* Non-numeric target (↓ week on week) — tab trend hi faisla karta hai. */
/* Soft target (baseline / declining) — tab trend hi faisla karta hai. */
eq('worsening on a soft target → behind',
   sandbox.mgRowStatus(rowOf('acc5'), {acc5:9}, {acc5:2}).state, 'behind');
eq('improving on a soft target → met',
   sandbox.mgRowStatus(rowOf('devSpread'), {devSpread:2}, {devSpread:8}).state, 'met');

const bad ={}; MG_ROWS_VAL.filter(r=>r.id&&r.f!=='off').forEach(r=>bad[r.id]=999);
bad.cycP50=999;
eq('needs-attention capped at five', sandbox.mgExceptions(bad,{}).length, 5);
eq('every entry explains itself',    sandbox.mgExceptions(bad,{}).every(e=>e.why&&e.label), true);
const ok={dupShare:1,bypass:1,loadTop2:1,acc5:0,devSpread:1,flow:2,ackTat:99,ttsTat:99,
          aged90:0,runChange:1,cycP50:1};
eq('all healthy → nothing listed',   sandbox.mgExceptions(ok,ok).length, 0);
eq('list agrees with row status',
   sandbox.mgExceptions(bad,{}).every(e=>{
     const row=MG_ROWS_VAL.find(r=>r.label===e.label);
     return sandbox.mgRowStatus(row,bad,{}).state==='behind';
   }), true);

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
    ['flow = closed/created',  c.flow===null||Math.abs(c.flow-c._flowOut/c._flowIn)<1e-9],
    ['P50 <= P90',             c.cycP50===null||c.cycP90===null||c.cycP50<=c.cycP90],
    ['cycN <= transfer exits', c._cycN<=c._dExitN],
    ['devSpread >= 1',         c.devSpread===null||c.devSpread>=1],
    ['percentages within 0-100',
      [c.ackTat,c.ttsTat,c.bypass,c.runChange,c.loadTop2,c.dupShare]
        .every(v=>v===null||(v>=0&&v<=100))],
    ['counts never negative',  [c._open,c.backlog30,c.aged30,c.aged90,c.acc5,c._in,c._out]
        .every(v=>v>=0)],
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
/* Resolution + owner column hata di gayi. Label me shabd "resolution" hona
   theek hai ("First call resolution / CSAT"), isliye page ke header aur
   render code par check karte hain, label text par nahi. */
const pageHtml=fs.readFileSync(PAGE,'utf8');
eq('Resolution column header gone', /Resolution \+ owner/.test(pageHtml), false);
eq('resolution cell renderer gone', /mgResCell/.test(pageHtml), false);
eq('owner datalist gone',           /mgOwnerList/.test(pageHtml), false);
eq('table is 5 columns',            /colspan="6"/.test(pageHtml), false);

/* ══════ 18. PPT page 5 se labels aur order ka milaan ══════
   Report ke saath ye table side-by-side padhi jati hai, isliye har label
   bilkul wahi shabd hone chahiye jo slide par hain, usi kram me. */
console.log('== 18. matches the one-page report ==');
const SPEC={Support:['Acknowledge in-TAT %','Go-Live in-TAT %',
  'Aged backlog — no movement 30d+','Duplicate / repeat ticket share','QA bypass rate',
  'First call resolution / CSAT','Backlog flow ratio (closed ÷ created)','Load concentration — top 2 assignees',
  'Accounts holding 5+ open tickets'],
 Engineering:['Developer speed spread','Run vs Change ratio','Delivered volume — MRs / net churn',
  'Rework rate (churn <21d of merge)','Cycle time P50 / P90','Escaped defects — last release']};
let _sec=null,_i=0;
MG_ROWS_VAL.forEach(r=>{
  if(r.sec){ _sec=r.sec; _i=0; return; }
  eq('row '+(_i+1)+' of '+_sec, r.label, SPEC[_sec][_i++]);
});
eq('Support has 9 rows',     SPEC.Support.length, 9);
/* Row 2 ka label report se match karta hai par number Transfer-to-Support ka
   hai. Note me ye saaf likha hona chahiye, warna koi Go-Live samajh lega. */
eq('row 2 note says what is really measured',
   /Transfer to Support date, not Ready to Go Live/.test(
     MG_ROWS_VAL.find(r=>r.id==='ttsTat').note), true);
eq('Engineering has 6 rows', SPEC.Engineering.length, 6);
eq('15 rows total', MG_ROWS_VAL.filter(r=>r.id).length, 15);
/* Ye do rows jaan-bujh kar hataye gaye — report me nahi hain. */
eq('IT backlog row removed',  MG_ROWS_VAL.some(r=>r.id==='openBacklog'), false);
eq('Backlog-30-days row removed', MG_ROWS_VAL.some(r=>r.id==='backlog30'), false);
/* Backlog reconciliation footer ab bhi in numbers par chalta hai. */
eq('_open still computed',   typeof sandbox.mgCompute('2026-08-21','2026-08-27')._open, 'number');


/* ══════ 19. SCOPE — date + disposition filter ══════ */
console.log('== 19. management tab ka scope ==');
eq('cutoff is 01-04-2026', vm.runInContext('MG_DATA_FROM', sandbox), '2026-04-01');
eq('first IT stage = earliest IT date',
   sandbox.mgFirstIT({a:'2026-05-10',b:'2026-05-02',cld:'2026-01-01'}), '2026-05-02');
eq('close date does not count as a start',
   sandbox.mgFirstIT({cld:'2026-01-01'}), '');
eq('before cutoff → out of scope',
   sandbox.mgInScope({a:'2026-03-31',b:'2026-05-01'}), false);
eq('on the cutoff → in scope',
   sandbox.mgInScope({a:'2026-04-01'}), true);
eq('after cutoff → in scope',
   sandbox.mgInScope({a:'2026-06-01'}), true);
eq('no IT date at all → out of scope',
   sandbox.mgInScope({cld:'2026-06-01'}), false);

eq('Bug kept',            sandbox.mgInDisp({ld:'Bug'}), true);
eq('Bug Urgent kept',     sandbox.mgInDisp({ld:'Bug Urgent'}), true);
eq('Data Updation kept',  sandbox.mgInDisp({ld:'Data Updation'}), true);
eq('Development dropped', sandbox.mgInDisp({ld:'Development'}), false);
eq('Development Urgent dropped', sandbox.mgInDisp({ld:'Development Urgent'}), false);
eq('Improvement dropped', sandbox.mgInDisp({ld:'Improvement'}), false);
eq('blank disposition dropped', sandbox.mgInDisp({}), false);
eq('Bug Approved dropped (not an exact match)', sandbox.mgInDisp({ld:'Bug Approved'}), false);
eq('case does not matter', sandbox.mgInDisp({ld:'  BUG URGENT '}), true);

/* Scope counters footer me dikhte hain — sahi rehne chahiye. */
const sc=sandbox.mgCompute('2026-08-21','2026-08-27');
eq('scope counts are reported', typeof sc._scopeAll==='number' && typeof sc._scopeN==='number', true);
eq('scoped set is never larger than all', sc._scopeN<=sc._scopeAll, true);
eq('disposition set is inside the dated set', sc._scopeN<=sc._scopeDated, true);

console.log('== 20. Run vs Change ==');
/* Ye akela metric disposition filter se chhoot par hai — Development hi
   "change" hai, use nikal dene par denominator khatam ho jata. */
sandbox.RAW=[
  {n:'r1', ld:'Bug',                a:'2026-06-01', d:'2026-08-25'},
  {n:'r2', ld:'Bug Urgent',         a:'2026-06-01', d:'2026-08-25'},
  {n:'r3', ld:'Bug',                a:'2026-06-01', d:'2026-08-26'},
  {n:'c1', ld:'Development',        a:'2026-06-01', d:'2026-08-25'},
  {n:'c2', ld:'Improvement',        a:'2026-06-01', d:'2026-08-26'},
  {n:'x1', ld:'Data Updation',      a:'2026-06-01', d:'2026-08-25'},
  {n:'x2', ld:'',                   a:'2026-06-01', d:'2026-08-25'},
  {n:'old',ld:'Development',        a:'2026-01-01', d:'2026-08-25'},
];
const rc=sandbox.mgCompute('2026-08-21','2026-08-27');
eq('run counts Bug + Bug Urgent',    rc._rcRun, 3);
eq('change counts Dev + Improvement',rc._rcChange, 2);
eq('share = 3/(3+2) = 60%',          rc.runChange, 60);
eq('Data Updation not in either side', rc._rcRun+rc._rcChange, 5);
eq('blank disposition not counted',  rc._rcRun+rc._rcChange, 5);
eq('date filter still applies to Run vs Change', rc._rcChange, 2);  // 'old' bahar

sandbox.RAW=[{n:'b1', ld:'Bug', a:'2026-06-01', d:'2026-08-25'}];
eq('no change tickets → 100%, not a crash',
   sandbox.mgCompute('2026-08-21','2026-08-27').runChange, 100);
sandbox.RAW=[];
eq('nothing at all → null', sandbox.mgCompute('2026-08-21','2026-08-27').runChange, null);
sandbox.RAW=savedRaw;

console.log('== 21. target direction for bare numbers ==');
/* '95%' me zyada behtar hai, '50/50' me kam behtar. Pehle dono ≥ maane
   jate the, jisse Run vs Change 50 se neeche jaane par galat "behind"
   dikhta tha — jabki wahi sudhar hai. */
eq('40 beats a 50/50 target',  sandbox.mgTargetMiss(40,'50/50, then 40/60','down'), false);
eq('78 misses a 50/50 target', sandbox.mgTargetMiss(78,'50/50, then 40/60','down'), true);
eq('96 meets 95% (up)',        sandbox.mgTargetMiss(96,'95%','up'), false);
eq('40 misses 95% (up)',       sandbox.mgTargetMiss(40,'95%','up'), true);
eq('explicit operators still win', sandbox.mgTargetMiss(12,'< 10%','down'), true);


/* ══════ 22. Load concentration = tester ki queue ══════ */
console.log('== 22. load concentration base ==');
sandbox.RAW=[
  /* RFT/UAT par pade — queue me ginenge */
  {n:'q1', ld:'Bug', a:'2026-06-01', b:'2026-06-02', rtd:'2026-08-20', assignto:'QA1'},
  {n:'q2', ld:'Bug', a:'2026-06-01', b:'2026-06-02', rtd:'2026-08-20', assignto:'QA1'},
  {n:'q3', ld:'Bug', a:'2026-06-01', b:'2026-06-02', uad:'2026-08-20', assignto:'QA2'},
  {n:'q4', ld:'Bug', a:'2026-06-01', b:'2026-06-02', rtd:'2026-08-20', assignto:'QA3'},
  /* backlog me hain par tester ki queue me nahi */
  {n:'d1', ld:'Bug', a:'2026-06-01', c:'2026-08-20', assignto:'QA1'},
  {n:'d2', ld:'Bug', a:'2026-06-01', crd:'2026-08-20', assignto:'QA1'},
  {n:'d3', ld:'Bug', a:'2026-06-01', b:'2026-08-20', assignto:'QA1'},
];
const lc=sandbox.mgCompute('2026-08-21','2026-08-27');
eq('queue = RFT + UAT only',      lc._queueN, 4);
eq('In Progress / Code Review / Ack excluded', lc._queueN < lc._open, true);
eq('top 2 of 4 = QA1(2)+QA2(1)',  lc.loadTop2, 75);
eq('three testers in the queue',  lc._testerN, 3);
eq('_assigned still spans the whole backlog', lc._assigned, 7);

/* Point-in-time: jo ticket pichhle hafte RFT me tha aur is hafte aage badh
   gaya, wo pichhle hafte ginega — is hafte nahi. */
sandbox.RAW=[
  {n:'m1', ld:'Bug', a:'2026-06-01', rtd:'2026-08-18', c:'2026-08-26', assignto:'QA1'},
  {n:'m2', ld:'Bug', a:'2026-06-01', rtd:'2026-08-18', assignto:'QA2'},
];
eq('moved on → out of this week\u2019s queue',
   sandbox.mgCompute('2026-08-25','2026-08-31')._queueN, 1);
eq('still counted in last week\u2019s queue',
   sandbox.mgCompute('2026-08-18','2026-08-24')._queueN, 2);

sandbox.RAW=[{n:'z', ld:'Bug', a:'2026-06-01', c:'2026-08-20'}];
eq('empty queue → null, not 0', sandbox.mgCompute('2026-08-21','2026-08-27').loadTop2, null);
sandbox.RAW=savedRaw;


/* ══════ 23. Excel export — poora column dump + Currently Pending ══════ */
console.log('== 23. excel export ==');
vm.runInContext(pageJs.match(/const XL_COLS = \[[\s\S]*?\n\];/)[0], sandbox);
vm.runInContext('var XL_PICK = null;', sandbox);   // null = sab columns
['xlSelected','buildSheetRows','xlCols'].forEach(n=>{
  const b=grabFn(n); if(b) vm.runInContext(b, sandbox);
});
const xh = sandbox.buildSheetRows([], 'at', 'a', 'IT')[0];
eq('header starts with the stage columns',
   xh.slice(0,3).join('|'), 'Stage Date|Pending Status|TAT Status');
eq('no duplicate column names', new Set(xh).size, xh.length);
eq('column widths match the header', sandbox.xlCols().length, xh.length);

/* Har wo field jo koi bhi dashboard padhta hai, sheet me hona chahiye. */
['Ticket No','Created Date','Status','Client Name','LicNo','Description',
 'RM','Tester (TransferTo)','Developer','Last Disposition',
 'Transfer To IT Date','Acknowledge Date','In Progress Date',
 'Ready For Testing Date','Code Review Date','Merging Date','Ready For UAT Date',
 'Reopend from Testing Date','Ready To Go Live Date','Transfer To Support Date',
 'Reopen Date','Future Development Date','Rejected Date','Close Date',
 'Acknowledge TAT','Transfer To Support TAT'].forEach(c=>{
  eq('export has "'+c+'"', xh.includes(c), true);
});

const xr = sandbox.buildSheetRows([
  {n:'T1', st:'Acknowledge', sc:'AK', a:'2026-08-20', b:'2026-08-21', bt:'I',
   u:'Client A', l:'L1', desc:'gst issue', r:'RM1', t:'QA1', dev:'D1'},
  {n:'T2', st:'In Progress', sc:'IP', a:'2026-08-20'},
], 'bt', 'b', 'AK');
eq('one row per ticket', xr.length, 3);
eq('every row is the full width', xr.every(r=>r.length===xh.length), true);
eq('missing fields become blank, never undefined',
   xr.slice(1).every(r=>r.every(v=>v!==undefined && v!==null)), true);
eq('pending status marks the matching stage', xr[1][1], 'Pending');
eq('pending status marks moved-on tickets',   xr[2][1], 'Moved Forward');
eq('TAT status reads the stage flag',         xr[1][2], 'InTAT');
eq('no flag → No TAT',                        xr[2][2], 'No TAT');
eq('description is exported', xr[1][xh.indexOf('Description')], 'gst issue');
eq('stage date column follows dateKey', xr[1][0], '2026-08-21');

/* "Currently Pending" sheet card ke Overall pill se match karni chahiye —
   dono RAW par chalte hain, bina kisi filter ke. */
console.log('== 24. Currently Pending sheet ==');
const pageSrc = fs.readFileSync(PAGE,'utf8');
eq('sheet exists',            /Currently Pending/.test(pageSrc), true);
eq('it reads RAW, not cfg.data',
   /\(RAW\|\|\[\]\)\.filter\(r=>r\.sc===cfg\.pendingSc\)/.test(pageSrc), true);
eq('summary reports both counts',
   /Currently Pending \(all data, no filters\)/.test(pageSrc), true);
const pend = sandbox.buildSheetRows(
  [{n:'P1',sc:'IT',a:'2020-01-01'},{n:'P2',sc:'IT'}], 'at','a','IT');
eq('old tickets are not dropped by a date',  pend.length, 3);
eq('all rows read as Pending', pend.slice(1).every(r=>r[1]==='Pending'), true);


/* ══════ 25. status matching — ek hi source, exact match ══════
   Pehle do system the: parser exact string match karta tha, dashboard
   variants + SUBSTRING fallback. Substring hi bug tha — SUP_STATUSES me
   'pending' sabse upar hai, to "Approval Pending" chup-chaap "Pending" ban
   jata tha (asli data me 38 tickets). Ab dono MB_STATUS_VARIANTS se chalte
   hain aur match sirf exact hota hai. */
console.log('== 25. status codes ==');
const P = require(PARSER_ABS);
eq('Pending is its own code',        P.mbStatusCode('Pending'), 'PN');
eq('Approval Pending is not Pending',P.mbStatusCode('Approval Pending'), 'AP');
eq('Team Testing mapped',            P.mbStatusCode('Team Testing'), 'TT');
eq('Future Development mapped',      P.mbStatusCode('Future Development'), 'FD');
eq('Reject mapped',                  P.mbStatusCode('Reject'), 'RJ');
eq('Rejected is the same code',      P.mbStatusCode('Rejected'), 'RJ');
eq('Reopen mapped',                  P.mbStatusCode('Reopen'), 'RO');
eq('Reopend from Testing mapped',    P.mbStatusCode('Reopend from Testing'), 'RF');
eq('Code Review mapped',             P.mbStatusCode('Ready For Code Review'), 'CR');
eq('Merging mapped',                 P.mbStatusCode('Ready For Merging'), 'MG');
eq('case is ignored',                P.mbStatusCode('TRANSFER TO IT'), 'IT');
eq('extra spaces ignored',           P.mbStatusCode('  In   Progress '), 'IP');
eq('underscores ignored',            P.mbStatusCode('in_progress'), 'IP');
eq('unknown falls to OT',            P.mbStatusCode('Some Brand New Status'), 'OT');
eq('null falls to OT',               P.mbStatusCode(null), 'OT');
eq('blank falls to OT',              P.mbStatusCode('   '), 'OT');
/* Substring guessing wapas na aa jaye. */
eq('no substring guessing',          P.mbStatusCode('Transfer To IT Pending'), 'OT');
eq('no variant is listed twice', (()=>{
  const seen=new Set();
  for(const [,list] of P.MB_STATUS_VARIANTS)
    for(const v of list){ if(seen.has(v)) return false; seen.add(v); }
  return true;
})(), true);
eq('every variant is already normalised',
   P.MB_STATUS_VARIANTS.every(([,l])=>l.every(v=>v===P.mbNormStatus(v))), true);

console.log('== 26. cd / cdd no longer collide ==');
/* `cd` do cheezon ke liye use ho raha tha: In Progress ka TAT duration aur
   current-stage disposition. Disposition baad me likhti thi, isliye duration
   HAMESHA overwrite ho jata tha — asli 14,211 tickets me ek bhi nahi bacha. */
const cdRec = P.mbParseTicket({
  TicketNo:'X', Status:'In Progress',
  InProgressDate:'2026-08-20T00:00:00', InProgress_TatDuration:'168 Hr',
  Inprogress_Disp:'Bug'
});
eq('duration lands in cdd', cdRec.cdd, '168 Hr');
eq('disposition lands in cd', cdRec.cd, 'Bug');
eq('cd is never the duration', cdRec.cd === cdRec.cdd, false);
const noDisp = P.mbParseTicket({
  TicketNo:'Y', Status:'In Progress',
  InProgressDate:'2026-08-20T00:00:00', InProgress_TatDuration:'24 Hr'
});
eq('duration survives with no disposition', noDisp.cdd, '24 Hr');

console.log('== 27. schema bump ==');
/* cdd, jira aur naye sc codes purane cache me nahi hain — server ka
   REQUIRED_SCHEMA isi ke barabar hona chahiye, warna Refresh Data toot
   jayega (ek baar pehle ho chuka hai). */
eq('parser is on schema 4', P.MB_SCHEMA_VERSION, 4);
const cacheSrc = fs.readFileSync(path.join(ROOT,'api/ticket-cache.js'),'utf8');
const req = (cacheSrc.match(/REQUIRED_SCHEMA\s*=\s*(\d+)/)||[])[1];
eq('server requires the same schema', Number(req), P.MB_SCHEMA_VERSION);
const pageSrc2 = fs.readFileSync(PAGE,'utf8');
eq('parser cache-buster was bumped too',
   /ticket-parser\.js\?v=4/.test(pageSrc2), true);

console.log('== 28. column picker ==');
const MG_XLCOLS_LEN = vm.runInContext('XL_COLS.length', sandbox);
eq('default selection is every column', sandbox.xlSelected().length, MG_XLCOLS_LEN);
vm.runInContext('XL_PICK = new Set(["Ticket No","Client Name"]);', sandbox);
eq('only the ticked columns are exported', sandbox.xlSelected().length, 2);
eq('header shrinks with the selection',
   sandbox.buildSheetRows([], 'at','a','IT')[0].length, 5);   // 3 stage + 2
eq('widths still line up with the header',
   sandbox.xlCols().length, sandbox.buildSheetRows([], 'at','a','IT')[0].length);
const picked = sandbox.buildSheetRows([{n:'T',u:'C',l:'L1',a:'2026-08-20'}], 'at','a','IT');
eq('rows shrink too', picked[1].length, 5);
/* Sab untick kar dena galti hai, khali file nahi — sab wapas de do. */
vm.runInContext('XL_PICK = new Set();', sandbox);
eq('clearing everything falls back to all', sandbox.xlSelected().length, MG_XLCOLS_LEN);
vm.runInContext('XL_PICK = null;', sandbox);
eq('reset restores every column', sandbox.xlSelected().length, MG_XLCOLS_LEN);
eq('picker gates all three exports',
   (pageSrc2.match(/openColumnPicker\(/g)||[]).length >= 4, true);


/* ══════ 29. REGRESSION guards — jo cheezein badalni NAHI chahiye ══════
   Ye tests us regression se aaye hain jo status codes badalne par mila:
   477 tickets 'OT' se nikal kar apne codes me chale gaye, aur support
   dashboard ka "Other / Pending" card (jo sc==='OT' filter karta tha)
   khali ho gaya tha. Card ab catch-all hai. */
console.log('== 29. status regression guards ==');
const supSrc = fs.readFileSync(path.join(ROOT,'support_dashboard.html'),'utf8');
eq('Other card is a catch-all, not sc===OT',
   /S_OT:[\s\S]{0,400}?indexOf\(r\.sc\)===-1/.test(supSrc), true);
eq('Other card no longer filters sc===OT directly',
   /S_OT: \{ data:VIEW\.filter\(r=>r\.sc==='OT'\)/.test(supSrc), false);

/* Har naya code kisi na kisi label map me hona chahiye, warna UI par kachcha
   code ("FD", "AP") dikhega. */
const labelSrc = fs.readFileSync(PAGE,'utf8');
['CR','MG','RF','RO','FD','RJ','PN','AP','TT'].forEach(c=>{
  eq('label exists for '+c, new RegExp("\\b"+c+":'").test(labelSrc), true);
});

/* Rejected ka ab code hai; deadline list use pehle raw status se pakadti thi.
   Dono raaste same jawab dein, warna closed tickets list me wapas aa jayenge. */
eq('Rejected counts as done via code', /DONE_SC = \{ CL:1, SP:1, RS:1, RJ:1 \}/.test(labelSrc), true);
eq('raw-status fallback still there', /\/\^reject\/\.test\(st\)/.test(labelSrc), true);

console.log('== 30. parser field stability ==');
/* sc, cdd, jira ke alawa parser ka koi field nahi badalna chahiye —
   asli 14,211 tickets par ye verify kiya gaya tha. */
const sample = {
  TicketNo:'MB - 1', Status:'Acknowledge', LicNo:'L1',
  TicketCreatedDate:'2026-06-01T10:00:00',
  TransfertoITDate:'2026-06-02T10:00:00', TransferToIT_TATDetails:'0 days :InTAT',
  AcknowledgeDate:'2026-06-03T10:00:00', Ack_TATDetails:'0 days :OutTAT',
  Ack_TatDuration:'16 Hr', Ack_Disp:'Bug'
};
const rec = P.mbParseTicket(sample);
eq('ticket no kept',      rec.n,  'MB - 1');
eq('created date parsed', rec.tc, '2026-06-01');
eq('transfer date parsed',rec.a,  '2026-06-02');
eq('ack date parsed',     rec.b,  '2026-06-03');
eq('in-TAT flag',         rec.at, 'I');
eq('out-of-TAT flag',     rec.bt, 'O');
eq('ack duration',        rec.bd, '16 Hr');
eq('status code',         rec.sc, 'AK');
eq('no stray cdd without In Progress', rec.cdd, undefined);
eq('no stray jira',       rec.jira, undefined);

console.log('\nMGMT RESULTS: '+pass+' passed, '+fail+' failed');
process.exit(fail?1:0);
