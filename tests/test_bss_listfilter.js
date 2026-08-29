/* BSS list modal ke column filters ka test.
   Filtering logic page se asli function bodies nikal kar chalayi jati hai. */
const fs=require('fs'), vm=require('vm');
const html=fs.readFileSync('/home/claude/mb/mbportal2-main/marg_ticket_dashboard.html','utf8');
const js=[...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map(m=>m[1]).join('\n');
function grab(n,src){const i=src.indexOf('function '+n+'(');if(i<0)throw new Error('not found: '+n);
 let d=0,st=false;for(let j=i;j<src.length;j++){if(src[j]==='{'){d++;st=true;}else if(src[j]==='}'){d--;if(st&&d===0)return src.slice(i,j+1);}}}
let p=0,f=0;
const eq=(l,g,w)=>{const ok=JSON.stringify(g)===JSON.stringify(w);
 if(ok){p++;console.log('  PASS: '+l);}else{f++;console.log('  FAIL: '+l+' → '+JSON.stringify(g)+' want '+JSON.stringify(w));}};

const ctx={console, LIST_FILTERS:{}, LIST_Q:''};
vm.createContext(ctx);
['listCellText','listPassesFilters'].forEach(n=>vm.runInContext(grab(n,js),ctx));
const ev=x=>vm.runInContext(x,ctx);

console.log('== 1. cell text HTML se nikalta hai (Excel jaisa hi) ==');
const cell=(fn,r)=>{ctx.__c=[ 'X', fn ];ctx.__r=r;return ev('listCellText(__c, __r)');};
eq('plain value',      cell(r=>'Closed',{}), 'Closed');
eq('span nikal jata hai', cell(r=>'<span class="tno">MB - 033534</span>',{}), 'MB - 033534');
eq('entity decode hoti hai', cell(r=>'A &amp; B',{}), 'A & B');
eq('apostrophe wapas aata hai', cell(r=>'O&#39;Brien',{}), "O'Brien");
eq('khaali → dash', cell(r=>'',{}), '—');
eq('muted dash bhi dash hi', cell(r=>'<span class="muted">—</span>',{}), '—');

console.log('== 2. filter AND logic ==');
ctx.__cols=[['Status',r=>r.st],['Dev',r=>r.dev||'']];
const rows=[{st:'Closed',dev:'Amit'},{st:'Closed',dev:'Badal'},{st:'In-Progress',dev:'Amit'},{st:'Closed',dev:''}];
const pass=(r)=>{ctx.__r=r;return ev('listPassesFilters(__r, __cols)');};
ev("LIST_FILTERS={0:new Set(['Closed'])}; LIST_Q='';");
eq('ek column filter', rows.filter(pass).length, 3);
ev("LIST_FILTERS={0:new Set(['Closed']), 1:new Set(['Amit'])};");
eq('do column AND', rows.filter(pass).length, 1);
ev("LIST_FILTERS={1:new Set(['—'])};");
eq('khaali value (Blank) filter ho sakti hai', rows.filter(pass).length, 1);
ev("LIST_FILTERS={0:new Set()};");
eq('khaali set = koi filter nahi', rows.filter(pass).length, 4);

console.log('== 3. global search filters ke SAATH chalti hai ==');
ev("LIST_FILTERS={}; LIST_Q='amit';");
eq('search sab columns me dekhti hai', rows.filter(pass).length, 2);
ev("LIST_FILTERS={0:new Set(['Closed'])}; LIST_Q='amit';");
eq('search + filter AND', rows.filter(pass).length, 1);
ev("LIST_Q='nahi-milega';");
eq('kuch na mile to 0', rows.filter(pass).length, 0);
ev("LIST_FILTERS={}; LIST_Q='';");

console.log('== 4. wiring ==');
eq('har column par filter button (Ticket No samet)', /cols\.map\(\(c,i\)=>/.test(js) && /lf-btn" data-ci="\$\{i\}"/.test(js), true);
eq('panel body me append hota hai (overflow clip se bachne ko)',
   /document\.body\.appendChild\(p\)/.test(js), true);
eq('panel fixed hai', /\.lf-panel\{[\s\S]{0,60}position:fixed/.test(html), true);
eq('viewport se bahar nahi jata', /Math\.min\(rc\.left, window\.innerWidth-pw-8\)/.test(js), true);
eq('1745 values render nahi hoti — cap + search', /const CAP=300/.test(js), true);
eq('counts baaki filters par nikalte hain, khud par nahi',
   /const others=\{\.\.\.LIST_FILTERS\}; delete others\[ci\]/.test(js), true);
eq('naya list khulte hi filters reset', /LIST_FILTERS=\{\}; LIST_Q='';[\s\S]{0,120}closeFilterPanel\(\)/.test(js), true);
eq('export filtered rows bhejta hai', /function exportList\(\)\{saveXLSX\(LIST_VIEW,/.test(js), true);
eq('modal band hone par panel bhi band', /function closeList\(\)\{closeFilterPanel\(\)/.test(js), true);
eq('bahar click par band', /if\(p && !p\.contains\(e\.target\)/.test(js), true);
eq('Escape par band', /if\(e\.key==='Escape'\) closeFilterPanel\(\)/.test(js), true);
eq('active filter icon highlight hota hai', /b\.classList\.toggle\('on'/.test(js), true);
eq('count "X of Y" dikhata hai', /of \$\{fmt\(LIST_ROWS\.length\)\} tickets/.test(js), true);
['listSearch','clearListFilters'].forEach(n=>
  eq('BSS.'+n+' export hua', new RegExp(n+': \\(typeof '+n).test(js), true));
eq('header me search box', /id="listSearch"/.test(html), true);
eq('header me clear-filters chip', /id="listClearFilters"/.test(html), true);

console.log('\nLISTFILTER RESULTS: '+p+' passed, '+f+' failed');
process.exit(f?1:0);
