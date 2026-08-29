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
console.log('== colours Support Dashboard se match karte hain ==');

const sup=fs.readFileSync('/home/claude/mb/mbportal2-main/support_dashboard.html','utf8');
eq('har status ka apna cls hai (inline colour nahi)',
   ev("STATUSES.filter(s=>!s.cls).length"), 0);
eq('koi purana `c:` property nahi bachi', /\{key:'[a-z]+',\s*label:'[^']*',\s*c:'--/.test(html), false);
eq('inline background var hata diya gaya',
   /kpi-top" style="background:var\(\$\{d\.c\}\)/.test(html), false);
eq('card par cls lagti hai', /class="kpi \$\{d\.cls\}"/.test(html), true);
// har istemal hone wali class ke liye CSS maujood honi chahiye
const used=[...new Set(ev("STATUSES.map(s=>s.cls)"))];
eq('har cls ke liye #tabBss stripe rule hai',
   used.filter(c=>!new RegExp('#tabBss \\.'+c+'\\s+\\.kpi-top').test(html)).length, 0);
eq('har cls ke liye #tabBss label rule hai',
   used.filter(c=>!new RegExp('#tabBss \\.'+c+'\\s+\\.kpi-s').test(html)).length, 0);
// gradient vars BSS scope me define hone chahiye, warna stripe khali dikhegi
const grads=['--it-g','--ack-g','--ip-g','--tst-g','--uat-g','--glv-g','--ret-g','--cl-g','--oth-g'];
const bssScope=html.slice(html.indexOf('#tabBss{'), html.indexOf('#tabBss *{'));
eq('saare gradient vars #tabBss scope me hain',
   grads.filter(g=>!bssScope.includes(g+':')).length, 0);
// values Support ke barabar hon
eq('gradient values Support se identical',
   grads.filter(g=>{
     const m=sup.match(new RegExp(g.replace(/-/g,'\\-')+':(linear-gradient\\([^)]*\\))'));
     return m && !bssScope.includes(g+':'+m[1]);
   }).length, 0);
eq('Transfer To Support Support ki tarah HARA hai (c-sup → glv-g)',
   /#tabBss \.c-sup\s+\.kpi-top\{background:var\(--glv-g\)/.test(html), true);

console.log('\nSTATUS RESULTS: '+p+' passed, '+f+' failed');
process.exit(f?1:0);
