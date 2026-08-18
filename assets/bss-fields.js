/* ===========================================================================
 * MB Portal — BSS FIELD CROSSWALK  (single source of truth)
 * ---------------------------------------------------------------------------
 * WHY THIS FILE EXISTS
 * BSS ke UI label, BindDropDown ki list ka naam, aur UpdateTicketStatus ke
 * payload field ka naam — TEENO alag hain, aur do jagah ULTE hain:
 *
 *   UI "Disposition"      → BindDropDown: BSSDisposition → payload: SubDisposition
 *   UI "Sub Disposition"  → BindDropDown: Dispostion     → payload: Disposition
 *
 * Dono integer hain. Galat map karne par API error NAHI dega — ticket
 * chup-chaap galat status aur galat category me chala jayega. Isliye mapping
 * sirf YAHAN rehti hai, kahin inline nahi.
 *
 * NOTE: BindDropDown me do list names MISSPELLED hain (`Dispostion`,
 * `SubDispostion` — `i` missing). Wahi exact spelling use karni hai.
 *
 * ID SPACES ALAG HAIN: ek hi insaan alag list me alag ID rakhta hai —
 * jaise Anil Tiwari `Rm` me ID 4, par `Users` me ID 4518. Har field ke liye
 * uski APNI list use karo, cross mat karo. resolveOption() isko enforce karta hai.
 * =========================================================================== */

var BSS_FIELDS_VERSION = 1;

/* ── CROSSWALK ────────────────────────────────────────────────────────────
 * key        : hamara internal naam (form state me yahi use hota hai)
 * label      : UI par jo dikhega (BSS ke apne label se match karta hai)
 * list       : BindDropDown response ki list ka EXACT key (misspelling ke saath)
 * payload    : UpdateTicketStatus body ka EXACT field naam
 * type       : 'select' | 'cascade' | 'text' | 'date'
 * parent     : cascade ke liye — kis field par depend karta hai
 * parentKey  : child option me parent ka reference field
 * required   : update ke waqt zaroori hai ya nahi
 */
var BSS_CROSSWALK = [
  { key:'subDisposition', label:'Sub Disposition', list:'Dispostion',
    payload:'Disposition',          type:'select', required:true,
    note:'ULTA: UI "Sub Disposition" → payload `Disposition`. Ye ticket ka STATUS hai (Pending/In Progress/Closed...).' },

  { key:'disposition',    label:'Disposition',     list:'BSSDisposition',
    payload:'SubDisposition',       type:'select', required:true,
    note:'ULTA: UI "Disposition" → payload `SubDisposition`. Ye CATEGORY hai (Bug/Development/Improvement...).' },

  { key:'mainDisposition',label:'Main Disposition',list:'SubDispostion',
    payload:'BSSMainDisposition',   type:'select', required:false },

  { key:'problemType',    label:'Problem Type',    list:'ProblemTypeMargBook',
    payload:'BSSProblemType',       type:'cascade', required:false,
    parent:'mainDisposition', parentKey:'Subdispositionid' },

  { key:'subProblemType', label:'Sub-Problem Type',list:'SubProblemTypeMargBook',
    payload:'BSSSubProblemType',    type:'cascade', required:false,
    parent:'problemType',     parentKey:'ProblemTypeID' },

  { key:'assignedTo',     label:'Assign To (Tester)', list:'AssignTo',
    payload:'AssignedTo',           type:'select', required:false },

  { key:'developer',      label:'Developer',       list:'Developers',
    payload:'Developer',            type:'select', required:false },

  { key:'rm',             label:'RM',              list:'Rm',
    payload:'RM',                   type:'select', required:false },

  { key:'timelineDate',   label:'Timeline Date',   list:null,
    payload:'TimeLineDate',         type:'date',   required:false },

  { key:'jiraId',         label:'Jira ID',         list:null,
    payload:'JiraID',               type:'text',   required:false },

  { key:'remarks',        label:'Remarks',         list:null,
    payload:'Remarks',              type:'text',   required:false },

  { key:'bssComment',     label:'BSS Comment',     list:null,
    payload:'BSSComment',           type:'text',   required:false },
];

function bssField(key){
  for(var i=0;i<BSS_CROSSWALK.length;i++) if(BSS_CROSSWALK[i].key===key) return BSS_CROSSWALK[i];
  return null;
}
function bssSelectFields(){ return BSS_CROSSWALK.filter(function(f){ return f.list; }); }

/* ── OPTION RESOLUTION ────────────────────────────────────────────────────
 * BindDropDown ki list se ek option nikaalo. Sirf USI list me dhoondhta hai
 * jo crosswalk me di gayi hai — isliye galat ID space use karna impossible.
 */
function bssOptions(dd, key){
  var f = bssField(key);
  if(!f || !f.list || !dd) return [];
  var arr = dd[f.list];
  return Array.isArray(arr) ? arr : [];
}

/* Cascade: parent ke ID par filter. Parent select nahi hua to khali list —
 * poori list dikhana galat hoga (user invalid combo bhej dega). */
function bssCascadeOptions(dd, key, parentId){
  var f = bssField(key);
  if(!f) return [];
  var all = bssOptions(dd, key);
  if(f.type !== 'cascade') return all;
  if(parentId === null || parentId === undefined || parentId === '') return [];
  var pid = Number(parentId);
  if(!isFinite(pid)) return [];
  return all.filter(function(o){
    var pv = o[f.parentKey];
    /* Jinke paas parent hai hi nahi unhe SKIP karo. Warna Number(null) === 0
       hone ki wajah se parentId 0 par wo saare options leak ho jate the. */
    if(pv === null || pv === undefined || pv === '') return false;
    return Number(pv) === pid;
  });
}

/* ID → option object (us field ki apni list me). */
function bssOptionById(dd, key, id){
  if(id === null || id === undefined || id === '') return null;
  var opts = bssOptions(dd, key), n = Number(id);
  for(var i=0;i<opts.length;i++) if(opts[i] && Number(opts[i].ID) === n) return opts[i];
  return null;
}

/* ID → display name. Nahi mila to ID hi dikhao (chupana se behtar hai). */
function bssNameById(dd, key, id){
  var o = bssOptionById(dd, key, id);
  if(o) return String(o.Name).trim();
  return (id === null || id === undefined || id === '') ? '' : ('#' + id);
}

/* Name → ID (reverse). AMBIGUOUS ho sakta hai: master data me duplicate names
 * hain (AssignTo ID 43 do baar, Users me "Preeti Lavanya" 4008 aur 4282,
 * ProblemType me "New integration " kai baar). Isliye ye {id, ambiguous,
 * matches} lautata hai — caller ko pata rehna chahiye ki bharosa karna hai
 * ya user se dobara select karwana hai. Ye function GUESS nahi karta. */
function bssIdByName(dd, key, name){
  var out = { id:null, ambiguous:false, matches:[] };
  if(name === null || name === undefined) return out;
  var want = String(name).trim().toLowerCase();
  if(!want) return out;
  var opts = bssOptions(dd, key);
  for(var i=0;i<opts.length;i++){
    if(opts[i] && String(opts[i].Name).trim().toLowerCase() === want) out.matches.push(opts[i]);
  }
  if(out.matches.length === 1) out.id = Number(out.matches[0].ID);
  else if(out.matches.length > 1){
    out.ambiguous = true;
    /* Sab matches ki ID same ho to ambiguity practical nahi (sirf label alag) */
    var first = Number(out.matches[0].ID), same = true;
    for(var j=1;j<out.matches.length;j++) if(Number(out.matches[j].ID) !== first) same = false;
    if(same){ out.id = first; out.ambiguous = false; }
  }
  return out;
}

/* ── DROPDOWN HEALTH ──────────────────────────────────────────────────────
 * Master data me cascade toota hua hai: kuch ProblemType aise parent ko refer
 * karte hain jo SubDispostion list me hai hi nahi — wo cascade se kabhi
 * reachable nahi honge. Ye Marg ke data ka issue hai; yahan sirf detect karke
 * report karte hain taaki chup-chaap gayab na dikhe. */
function bssDropdownHealth(dd){
  var out = { orphanParents:[], emptyParents:[], orphanProblemTypes:0, duplicateNames:{} };
  if(!dd) return out;

  /* Marg kabhi-kabhi list ki jagah null / string bhej deta hai. Array na ho to
     khali maano — health check kabhi throw nahi karna chahiye, warna poora
     dropdown load fail ho jayega. */
  var arr = function(x){ return Array.isArray(x) ? x : []; };

  var parents = {};
  arr(dd.SubDispostion).forEach(function(p){ if(p) parents[Number(p.ID)] = p.Name; });

  var seen = {};
  arr(dd.ProblemTypeMargBook).forEach(function(pt){
    if(!pt) return;
    var pid = Number(pt.Subdispositionid);
    if(!(pid in parents)){
      out.orphanProblemTypes++;
      if(!seen[pid]){ seen[pid] = true; out.orphanParents.push(pid); }
    }
  });
  out.orphanParents.sort(function(a,b){ return a-b; });

  Object.keys(parents).forEach(function(pid){
    var has = arr(dd.ProblemTypeMargBook).some(function(pt){ return pt && Number(pt.Subdispositionid) === Number(pid); });
    if(!has) out.emptyParents.push(Number(pid));
  });

  bssSelectFields().forEach(function(f){
    var byName = {}, dups = [];
    bssOptions(dd, f.key).forEach(function(o){
      if(!o) return;
      var k = String(o.Name).trim().toLowerCase();
      (byName[k] = byName[k] || []).push(Number(o.ID));
    });
    Object.keys(byName).forEach(function(k){
      var ids = byName[k].filter(function(v,ix,a){ return a.indexOf(v)===ix; });
      if(byName[k].length > 1) dups.push({ name:k, ids:ids });
    });
    if(dups.length) out.duplicateNames[f.key] = dups;
  });

  return out;
}

/* ── PAYLOAD BUILD ────────────────────────────────────────────────────────
 * Form state (internal keys) → UpdateTicketStatus body (BSS field names).
 * Yahi ek jagah hai jahan swap apply hota hai.
 *
 * form           : { subDisposition:3, disposition:10, ... }
 * ticketNo       : 'MB - 036939'
 * updatedByUser  : logged-in user ka bss_user_id
 */
function bssBuildPayload(form, ticketNo, updatedByUser){
  var body = { TicketNo: ticketNo, UpdatedByUser: Number(updatedByUser) };
  BSS_CROSSWALK.forEach(function(f){
    var v = form[f.key];
    if(v === undefined || v === null || v === '') return;
    if(f.type === 'text' || f.type === 'date'){
      /* TRIM: pehle "   " jaisa whitespace-only value chala jata tha aur BSS
         me wo field spaces se overwrite ho jati thi. Trim ke baad khali ho to
         bhejo hi mat — omitted field ka matlab "unchanged" hai. */
      var sv = String(v).trim();
      if(!sv) return;
      body[f.payload] = sv;
    }
    else body[f.payload] = Number(v);
  });
  return body;
}

/* ── VALIDATION ───────────────────────────────────────────────────────────
 * Update bhejne se PEHLE. Har error me field key hoti hai taaki UI usi input
 * ko highlight kar sake. */
function bssValidate(form, dd, updatedByUser){
  var errors = [];
  form = form || {};        /* null form par crash nahi hona chahiye */

  if(!updatedByUser || !Number(updatedByUser))
    errors.push({ field:'updatedByUser',
      msg:'Aapke account par BSS User ID map nahi hai. Admin → Users me ise set karwao, tab tak update nahi ho sakta.' });

  BSS_CROSSWALK.forEach(function(f){
    var v = form[f.key];
    var empty = (v === undefined || v === null || v === '');

    if(f.required && empty){
      errors.push({ field:f.key, msg:f.label + ' zaroori hai' });
      return;
    }
    if(empty) return;

    if(f.type === 'date'){
      var ds = String(v).trim();
      if(!/^\d{4}-\d{2}-\d{2}$/.test(ds)){
        errors.push({ field:f.key, msg:f.label + ' ka format YYYY-MM-DD hona chahiye' });
        return;
      }
      /* Format sahi hone ka matlab date ka EXIST karna nahi. 2026-02-30 aur
         2026-13-01 regex pass kar jate the aur seedha Marg ko chale jate.
         Round-trip se asli calendar check hota hai. */
      var pp = ds.split('-').map(Number);
      var dt = new Date(Date.UTC(pp[0], pp[1] - 1, pp[2]));
      if(dt.getUTCFullYear() !== pp[0] || dt.getUTCMonth() !== pp[1] - 1 || dt.getUTCDate() !== pp[2])
        errors.push({ field:f.key, msg:f.label + ': ' + ds + ' aisi koi date hai hi nahi' });
      return;
    }
    if(f.type === 'text') return;

    /* select / cascade → ID us field ki APNI list me maujood ho */
    if(!/^\d+$/.test(String(v))){
      errors.push({ field:f.key, msg:f.label + ' ki value numeric ID honi chahiye' });
      return;
    }
    if(dd){
      if(f.type === 'cascade'){
        var parentVal = form[f.parent];
        var allowed = bssCascadeOptions(dd, f.key, parentVal);
        var ok = allowed.some(function(o){ return Number(o.ID) === Number(v); });
        if(!ok){
          var pf = bssField(f.parent);
          errors.push({ field:f.key,
            msg:f.label + ' is ' + (pf ? pf.label : f.parent) + ' ke andar valid nahi hai — dobara select karo' });
        }
      } else if(!bssOptionById(dd, f.key, v)){
        errors.push({ field:f.key, msg:f.label + ' ki ID (' + v + ') master list me nahi mili' });
      }
    }
  });

  return errors;
}

/* ── READ-SIDE FIELD RESOLUTION ───────────────────────────────────────────
 * GetMBTicketStatusDetail apne naam use karta hai, aur wo UpdateTicketStatus
 * se match nahi karte. Kuch fields (JiraID, Sub-Problem Type) response me
 * ho bhi sakte hain, nahi bhi — API doc nahi hai.
 *
 * Isliye har field ke liye ALIAS list rakhi hai. Live ticket ka response
 * aane par jo alias mil jaye wahi use hota hai, aur bssReadAudit() batata hai
 * kaunsa mila / kaunsa nahi. Naam pata chalne par sirf yahi list badalni hai.
 *
 * `*Id` aliases isliye hain ki agar Marg read response me IDs bhi de de to
 * modal exact pre-select ho jaye (warna name→ID reverse karna padta hai, jo
 * duplicate names ki wajah se ambiguous hai). */
var BSS_READ_ALIASES = {
  ticketNo:        ['TicketNo'],
  createdDate:     ['TicketCreatedDate'],
  currentStatus:   ['Status'],
  timelineDate:    ['TimeLineDate'],
  subDisposition:  ['SubDisposition', 'Dispositions', 'CurrentDisposition'],
  disposition:     ['BSSDisposition', 'MainDisposition', 'Disposition'],
  mainDisposition: ['BSSMainDisposition', 'MainDisposition', 'SubDispositionName'],
  problemType:     ['Problemtype', 'ProblemType', 'BSSProblemType'],
  subProblemType:  ['SubProblemType', 'BSSSubProblemType', 'SubProblemTypeName'],
  jiraId:          ['JiraID', 'JiraId', 'Jira_ID', 'JIRAID'],
  assignedTo:      ['Assignto', 'AssignTo', 'AssignedTo'],
  rm:              ['RM'],
  developer:       ['Developer'],
  remarks:         ['Remarks'],
  bssComment:      ['BSSComment', 'BssComment'],

  subDispositionId:  ['DispositionID', 'DispositionId'],
  dispositionId:     ['SubDispositionID', 'SubDispositionId', 'BSSDispositionID'],
  mainDispositionId: ['BSSMainDispositionID', 'MainDispositionID', 'SubdispositionID', 'Subdispositionid'],
  problemTypeId:     ['BSSProblemTypeID', 'ProblemTypeID', 'ProblemTypeId'],
  subProblemTypeId:  ['BSSSubProblemTypeID', 'SubProblemTypeID'],
  assignedToId:      ['AssignedToID', 'AssignToID', 'AssigntoID'],
  developerId:       ['DeveloperID', 'DeveloperId'],
  rmId:              ['RMID', 'RmID', 'RMId'],
};

function bssReadValue(raw, key){
  var aliases = BSS_READ_ALIASES[key] || [];
  for(var i=0;i<aliases.length;i++){
    var v = raw ? raw[aliases[i]] : undefined;
    if(v !== undefined && v !== null && String(v).trim() !== '' && String(v) !== '1900-01-01T00:00:00')
      return { value:v, via:aliases[i] };
  }
  return { value:null, via:null };
}

/* Live raw record → modal ke liye normalized object.
 * IDs mile to unhe use karo; sirf name mila to reverse-lookup karo aur
 * ambiguous hone par flag karo (guess mat karo). */
function bssReadTicket(raw, dd){
  var out = { values:{}, names:{}, resolved:{}, missing:[], ambiguous:[] };

  ['ticketNo','createdDate','currentStatus','timelineDate','jiraId','remarks','bssComment']
    .forEach(function(k){
      var r = bssReadValue(raw, k);
      out.values[k] = r.value;
      out.resolved[k] = r.via;
      if(r.via === null) out.missing.push(k);
    });

  bssSelectFields().forEach(function(f){
    var idR = bssReadValue(raw, f.key + 'Id');
    if(idR.value !== null){
      out.values[f.key] = Number(idR.value);
      out.resolved[f.key] = idR.via;
      out.names[f.key] = bssNameById(dd, f.key, idR.value);
      return;
    }
    var nameR = bssReadValue(raw, f.key);
    if(nameR.value === null){ out.missing.push(f.key); out.values[f.key] = null; out.names[f.key] = ''; return; }
    out.names[f.key] = String(nameR.value).trim();
    out.resolved[f.key] = nameR.via;
    var rev = bssIdByName(dd, f.key, nameR.value);
    out.values[f.key] = rev.id;
    if(rev.ambiguous) out.ambiguous.push({ field:f.key, name:String(nameR.value).trim(), ids:rev.matches.map(function(m){ return m.ID; }) });
  });

  return out;
}

/* Diagnostic: live response me kaunse fields mile, kaunse nahi.
 * Live test ke baad BSS_READ_ALIASES theek karne ke liye. */
function bssReadAudit(raw){
  var rows = [];
  Object.keys(BSS_READ_ALIASES).forEach(function(k){
    var r = bssReadValue(raw, k);
    rows.push({ field:k, found: r.via !== null, via:r.via, sample: r.value === null ? null : String(r.value).slice(0,40) });
  });
  return rows;
}

if(typeof module !== 'undefined' && module.exports){
  module.exports = {
    BSS_FIELDS_VERSION, BSS_CROSSWALK, BSS_READ_ALIASES,
    bssField, bssSelectFields, bssOptions, bssCascadeOptions, bssOptionById,
    bssNameById, bssIdByName, bssDropdownHealth, bssBuildPayload, bssValidate,
    bssReadValue, bssReadTicket, bssReadAudit,
  };
}
