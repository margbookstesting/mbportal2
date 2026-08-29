const fs=require('fs'), vm=require('vm');
const html=fs.readFileSync('/home/claude/mb/mbportal2-main/marg_ticket_dashboard.html','utf8');
const js=[...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map(m=>m[1]).join('\n');
function grab(n,src){const i=src.indexOf('function '+n+'(');if(i<0)throw new Error(n);
 let d=0,st=false;for(let j=i;j<src.length;j++){if(src[j]==='{'){d++;st=true;}else if(src[j]==='}'){d--;if(st&&d===0)return src.slice(i,j+1);}}}
let p=0,f=0;
const eq=(l,g,w)=>{const ok=JSON.stringify(g)===JSON.stringify(w);
 if(ok){p++;console.log('  PASS: '+l);}else{f++;console.log('  FAIL: '+l+' → '+JSON.stringify(g)+' want '+JSON.stringify(w));}};

console.log('== 1. category ab TAT ke bugDevClass par hai ==');
const ctx={console};vm.createContext(ctx);
['lastDisp','isBug','isDev','isImprovement','isDataUpdation','bugDevClass','detectCategory']
  .forEach(n=>vm.runInContext(grab(n,js),ctx));
const cat=r=>vm.runInContext('detectCategory('+JSON.stringify(r)+')',ctx);
eq('Bug disposition → bug',            cat({ld:'Bug'}), 'bug');
eq('Bug Urgent → bug',                 cat({ld:'Bug Urgent'}), 'bug');
eq('Development → dev',                cat({ld:'Development'}), 'dev');
eq('Development Urgent → dev',         cat({ld:'Development Urgent'}), 'dev');
eq('Improvement → other',              cat({ld:'Improvement'}), 'other');
eq('Data Updation → other',            cat({ld:'Data Updation'}), 'other');
eq('unknown → other',                  cat({ld:'Something Else'}), 'other');
eq('khaali → other',                   cat({}), 'other');
// asli baat: TAT ke classifier se hi aana chahiye
eq('Bug count TAT ke bugDevClass se match karta hai',
   vm.runInContext("bugDevClass({ld:'Bug'})",ctx), 'Bug');
eq('purana keyword matcher hata diya gaya',
   /devKeywords|bugKeywords/.test(js), false);
eq('description ab category tay nahi karti',
   cat({desc:'urgent bug crash error', ld:'Development'}), 'dev');

console.log('== 2. inline list hat gayi, modal aa gaya ==');
eq('sectionsContainer me ab cards nahi bharte', /sectionsContainer'\).innerHTML = html/.test(js), false);
eq('buckets modal ke liye yaad rakhe jate hain', /window\._upBuckets = buckets/.test(js), true);
eq('upCardHtml reusable ban gaya', /function upCardHtml\(/.test(js), true);
eq('card click par detail modal khulta hai', /UP\.openTicketDetail\('\$\{r\.n\}'\)/.test(js), true);
eq('list modal markup maujood hai', /id="upListModal"/.test(html), true);
eq('KPI card clickable hai', /onclick="UP\.openBucket\('\$\{sec\.id\}','all'\)"/.test(js), true);
['dev','bug','other'].forEach(c=>
  eq('chip '+c+' clickable', new RegExp("UP\\.openBucket\\('\\$\\{sec\\.id\\}','"+c+"'\\)").test(js), true));
eq('chip click card ke click me nahi girta', /event\.stopPropagation\(\);UP\.openBucket/.test(js), true);

console.log('== 3. dead code saaf ==');
eq('setSectionCat hata diya gaya', /function setSectionCat/.test(js), false);
eq('UP export se bhi hata', /setSectionCat:/.test(js), false);
eq('.sec-cat-btn CSS hati', /#tabUp \.sec-cat-btn\{/.test(html), false);
eq('.sc-active-* CSS hati', /#tabUp \.sc-active-dev/.test(html), false);
eq('.t-card CSS bachi hai (modal me chahiye)', /#tabUp \.t-card/.test(html), true);
eq('.cards-grid bachi hai', /#tabUp \.cards-grid/.test(html), true);

console.log('== 4. export wahi rows leta hai jo dikh rahi hain ==');
eq('exportExcel rowsOverride leta hai', /function exportExcel\(sectionId, sectionLabel, event, rowsOverride\)/.test(js), true);
eq('override na ho to purana recompute', /rowsOverride \? rowsOverride : RAW\.filter/.test(js), true);
eq('modal ka Excel dikhayi de rahi rows bhejta hai', /exportExcel\(window\._upListSec, window\._upListName\|\|'Tickets', null, rows\)/.test(js), true);
eq('event optional ho gaya (modal se null jata hai)',
   /if\(event && event\.stopPropagation\) event\.stopPropagation\(\)/.test(js), true);

console.log('\nUPCOMING RESULTS: '+p+' passed, '+f+' failed');
process.exit(f?1:0);
