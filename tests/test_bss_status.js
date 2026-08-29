const fs=require('fs'), vm=require('vm');
const html=fs.readFileSync('/home/claude/mb/mbportal2-main/marg_ticket_dashboard.html','utf8');
const js=[...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map(m=>m[1]).join('\n');
function grab(name,src){const i=src.indexOf('function '+name+'(');if(i<0)throw new Error(name);
 let d=0,s=false;for(let j=i;j<src.length;j++){if(src[j]==='{'){d++;s=true;}else if(src[j]==='}'){d--;if(s&&d===0)return src.slice(i,j+1);}}}
const ctx={console};vm.createContext(ctx);
vm.runInContext(js.match(/const STATUSES=\[[\s\S]*?\n\];/)[0],ctx);
vm.runInContext(js.match(/const MATCH=\{[\s\S]*?\};/)[0],ctx);
vm.runInContext(js.match(/const SC2KEY=\{[^}]*\};/)[0],ctx);
['_normSt','bssStatusKeyOf','bssStatusLabelOf'].forEach(n=>vm.runInContext(grab(n,js),ctx));
const ev=x=>vm.runInContext(x,ctx);
let p=0,f=0;const eq=(l,g,w)=>{if(g===w){p++;console.log('  PASS: '+l);}else{f++;console.log('  FAIL: '+l+' → '+JSON.stringify(g)+' want '+JSON.stringify(w));}};

eq('17 cards', ev('STATUSES.length'), 17);
eq('order matches request',
  ev("STATUSES.map(s=>s.label).join('|')"),
  'Pending|Approval Pending|Transfer To IT|Acknowledged|In-Progress|Ready For Code Review|Ready For Testing|Re-Open From Testing|Ready For Merging|Ready For UAT|Ready For Go Live|Transfer To Support|Return To Support|Closed|Re-Open|Future Development|Rejected');
eq('Approval Pending is its own bucket', ev("bssStatusKeyOf({st:'Approval Pending'})"), 'approval');
eq('plain Pending unaffected',           ev("bssStatusKeyOf({st:'Pending'})"), 'pending');
eq('label for approval',                 ev("bssStatusLabelOf({st:'Approval Pending'})"), 'Approval Pending');
eq('case/space tolerant',                ev("bssStatusKeyOf({st:'  APPROVAL   PENDING '})"), 'approval');
eq('Transfer To IT still maps',          ev("bssStatusKeyOf({st:'Transferred To IT'})"), 'it');
eq('Ready to go Live still maps',        ev("bssStatusKeyOf({st:'Ready To Go Live'})"), 'rgl');
eq('Reopend from Testing still maps',    ev("bssStatusKeyOf({st:'Reopend from Testing'})"), 'reopentest');
eq('short-code fallback works',          ev("bssStatusKeyOf({sc:'RU'})"), 'rfu');
eq('unknown falls to pending',           ev("bssStatusKeyOf({st:'Totally Unknown'})"), 'pending');
eq('every key has a MATCH or is fallback',
  ev('STATUSES.filter(s=>!MATCH[s.key]).length'), 0);
console.log('\nSTATUS RESULTS: '+p+' passed, '+f+' failed');
process.exit(f?1:0);
