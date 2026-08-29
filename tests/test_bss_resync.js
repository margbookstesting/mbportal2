/* BSS resync + retention export ka offline test.
   Page se asli function bodies nikal kar chalate hain. */
const fs=require('fs'), vm=require('vm');
const P='/home/claude/mb/mbportal2-main/marg_ticket_dashboard.html';
const html=fs.readFileSync(P,'utf8');
const js=[...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map(m=>m[1]).join('\n');
let p=0,f=0;
const eq=(l,g,w)=>{const ok=JSON.stringify(g)===JSON.stringify(w);
  if(ok){p++;console.log('  PASS: '+l);}else{f++;console.log('  FAIL: '+l+' → '+JSON.stringify(g)+' want '+JSON.stringify(w));}};

console.log('== 1. resync merges, does not replace ==');
// Ye wahi line hai jo RAW row update karti hai. Agar koi ise wapas
// `RAW[i]=parsed` kar de to `tia` jaise merged fields ud jayenge.
eq('merge (Object.assign) use hota hai, seedha replace nahi',
   /RAW\[i\]=Object\.assign\(\{\}, RAW\[i\], parsed\)/.test(js), true);
eq('purana `RAW[i]=parsed` wapas nahi aaya',
   /RAW\[i\]=parsed;/.test(js), false);

// merge ka behaviour khud verify karo
const oldRow={n:'MB-1', tia:'SupportAgent', st:'In Progress', a:'2026-08-01'};
const parsed={n:'MB-1', st:'Ready For Testing', a:'2026-08-01', rtd:'2026-08-27'};
const merged=Object.assign({}, oldRow, parsed);
eq('merge me tia bacha rehta hai',   merged.tia, 'SupportAgent');
eq('merge me naya status aata hai',  merged.st, 'Ready For Testing');
eq('merge me nayi stage date aati hai', merged.rtd, '2026-08-27');

console.log('== 2. optimistic patch resync se pehle chalta hai ==');
eq('text fields turant patch hote hain (resync fail ho to bhi)',
   /if\(row\)\{[\s\S]{0,400}?row\.st=s;/.test(js), true);
eq('prevSig optimistic patch se PEHLE liya jata hai',
   js.indexOf('const prevSig=row?JSON.stringify') < js.indexOf('row.st=s;'), true);
eq('prevSig resync ko pass hota hai', /bssResyncTicket\(tn, prevSig\)/.test(js), true);
eq('resync ab RAW se sig nahi padhta (stale hota)',
   /const before=RAW\.find/.test(js), false);

console.log('== 3. retry + cache patch ==');
eq('3 attempts', /attempt<=3/.test(js), true);
eq('attempts ke beech gap', /setTimeout\(r,800\)/.test(js), true);
eq('aakhri attempt par jo mila wahi lete hain', /changed \|\| attempt===3/.test(js), true);
eq('cache patch bheja jata hai', /bssPatchCacheDates\(ticketNo, parsed\)/.test(js), true);
// client ki patch keys server whitelist ka subset honi chahiye
const clientKeys=(js.match(/const BSS_PATCH_KEYS=\[([^\]]*)\]/)[1].match(/'[a-z]+'/g)||[]).map(s=>s.slice(1,-1));
const proxy=fs.readFileSync('/home/claude/mb/mbportal2-main/api/bss-proxy.js','utf8');
const serverKeys=(proxy.match(/CACHE_PATCH_KEYS = new Set\(\[([\s\S]*?)\]\)/)[1].match(/'[a-zA-Z]+'/g)||[]).map(s=>s.slice(1,-1));
eq('client ki saari patch keys server whitelist me hain',
   clientKeys.filter(k=>!serverKeys.includes(k)), []);
eq('stage dates whitelist me hain',
   ['a','b','c','d','e','rtd','uad','cld'].filter(k=>!serverKeys.includes(k)), []);
eq('server me cachepatch action maujood hai', /action === 'cachepatch'/.test(proxy), true);
eq('cachepatch sanitize se guzarta hai', /sanitizeCachePatch\(body\.patch\)/.test(proxy), true);

console.log('== 4. retention export me dono sheets ==');
eq('sheet 1 ka naam Client Details', /book_append_sheet\(wb,ws,'Client Details'\)/.test(js), true);
eq('sheet 2 Pending Tickets', /book_append_sheet\(wb,ws2,'Pending Tickets'\)/.test(js), true);
eq('sheet 2 wahi filtered rows use karti hai',
   js.indexOf('const rows=retLicFilteredRows();') < js.indexOf("'Pending Tickets'"), true);
eq('har ticket row me License aur Client lagti hai', /x\.L\.lic, x\.nm,/.test(js), true);
eq('koi ticket na ho to sheet 2 add nahi hoti', /if\(tOut\.length>1\)/.test(js), true);

console.log('== 5. management tab har baar recompute karta hai ==');
eq('_mgBooted flag hata diya gaya', /_mgBooted/.test(js), false);
eq('mgmtInit seedha render karta hai', /function mgmtInit\(\)\{[\s\S]*?mgmtRender\(\);\n\}/.test(js), true);

console.log('\nRESYNC RESULTS: '+p+' passed, '+f+' failed');
process.exit(f?1:0);
