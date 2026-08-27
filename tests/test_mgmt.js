/* Management tab ke metrics ka offline test.
   Page se ASLI function bodies nikal kar chalate hain (copy-paste nahi), taaki
   test aur page kabhi alag na ho jayen. */
const fs=require('fs'), vm=require('vm');
const PAGE='/home/claude/mb/mbportal2-main/marg_ticket_dashboard.html';
const PARSER='/home/claude/mb/mbportal2-main/assets/ticket-parser.js';

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
  'mgWindows','mgDupShare','mgCompute','mgFmt','mgTrend','_smfTesterVal',
  'aiClean','aiTokens','aiVectorize','aiCosSparse','aiNormMap','aiAddMap','aiClusterSparse',
  'lastDisp','isBug'];

const sandbox={console, RAW:[], fmt:n=>Number(n||0).toLocaleString('en-IN')};
vm.createContext(sandbox);
vm.runInContext(fs.readFileSync(PARSER,'utf8'), sandbox);   // mbTesterOf etc.

// MG_DATE_KEYS aur AI_STOP jaise consts bhi chahiye
const consts=pageJs.match(/const MG_DATE_KEYS=\[[^\]]*\];/)[0];
vm.runInContext(consts, sandbox);
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

// ── as-of open ──
console.log('== 2. as-of open reconstruction ==');
eq('a in past, no d → open',    sandbox.mgOpenAsOf({a:'2026-08-01'},'2026-08-27'), true);
eq('a in future → not open',    sandbox.mgOpenAsOf({a:'2026-09-01'},'2026-08-27'), false);
eq('d before X → closed',       sandbox.mgOpenAsOf({a:'2026-08-01',d:'2026-08-10'},'2026-08-27'), false);
eq('d AFTER X → still open',    sandbox.mgOpenAsOf({a:'2026-08-01',d:'2026-09-10'},'2026-08-27'), true);
eq('cld before X → closed',     sandbox.mgOpenAsOf({a:'2026-08-01',cld:'2026-08-05'},'2026-08-27'), false);
eq('no a at all → not open',    sandbox.mgOpenAsOf({b:'2026-08-01'},'2026-08-27'), false);
eq('d exactly on X → closed',   sandbox.mgOpenAsOf({a:'2026-08-01',d:'2026-08-27'},'2026-08-27'), false);
eq('a exactly on X → open',     sandbox.mgOpenAsOf({a:'2026-08-27'},'2026-08-27'), true);

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
  {n:'T1', a:'2026-08-21', b:'2026-08-22', bt:'I', c:'2026-08-23', d:'2026-08-25', dev:'D1', desc:'gst report not printing', l:'L1', ts:'QA1'},
  {n:'T2', a:'2026-08-22', b:'2026-08-23', bt:'O', d:'2026-08-26', dev:'D1', desc:'gst report print issue', l:'L1', ts:'QA1'},
  {n:'T3', a:'2026-08-23', desc:'gst report printing problem', l:'L1', ts:'QA1'},
  {n:'T4', a:'2026-08-24', desc:'stock ledger mismatch', l:'L2', ts:'QA2'},
  // pichhle hafte ka, abhi bhi khula, 30+ din se nahi hila
  {n:'T5', a:'2026-06-01', desc:'old one', l:'L1', ts:'QA1'},
  // go live is hafte
  {n:'T6', a:'2026-07-01', e:'2026-08-25', et:'I', d:'2026-08-26', dev:'D2', desc:'x', l:'L3', ts:'QA2'},
];
const m=sandbox.mgCompute(W[0], W[1]);

eq('intake counted',        m._in, 4);
eq('exits counted',         m._out, 3);       // T1,T2,T6
eq('flow ratio 3/4',        m.flow, 0.75);
eq('ack in-TAT 50%',        m.ackTat, 50);    // T1 I, T2 O
eq('go-live in-TAT 100%',   m.glvTat, 100);   // T6
eq('QA bypass 33%',         Math.round(m.bypass), 33);  // T6 skipped b+c, of 3 exits
eq('cycle P50 = 4d',        m.cycP50, 4);     // T1=4, T2=4, T6=56 → P50 4
eq('cycle P90 = 56d',       m.cycP90, 56);
eq('open as of 27-08',      m._open, 3);      // T3,T4,T5
eq('aged 30d+',             m.aged30, 1);     // T5 (June)
eq('assigned open',         m._assigned, 3);
eq('top2 load = 100%',      m.loadTop2, 100); // only 2 testers exist
eq('accounts 5+ = 0',       m.acc5, 0);
eq('dup share > 0 (3 gst tickets cluster)', m.dupShare > 0, true);
eq('dup base = intake with desc', m._dupN, 4);

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
