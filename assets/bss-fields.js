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

/* Cascade field ka naam PARENT ke andar dhoondho, poori list me nahi.
 * Master data me ek hi naam kai parents ke neeche repeat hota hai — jaise
 * "Exta page printing issue " teen baar:
 *     ID 3078 -> parent 609 (Template Management)
 *     ID 3082 -> parent 801 (Invoice Template)
 *     ID 3086 -> parent 802 (Invoice Designer)
 * Global lookup teeno match karta tha aur "ambiguous" flag kar deta tha, jabki
 * parent pata hone par jawab bilkul unique hai. Isliye pehle scoped lookup. */
function bssIdByNameInParent(dd, key, name, parentId){
  var out = { id:null, ambiguous:false, matches:[], scoped:true };
  var f = bssField(key);
  if(!f || f.type !== 'cascade') return bssIdByName(dd, key, name);
  if(name === null || name === undefined) return out;
  var want = String(name).trim().toLowerCase();
  if(!want) return out;

  var opts = bssCascadeOptions(dd, key, parentId);
  for(var i = 0; i < opts.length; i++){
    if(opts[i] && String(opts[i].Name).trim().toLowerCase() === want) out.matches.push(opts[i]);
  }
  if(out.matches.length === 1){ out.id = Number(out.matches[0].ID); return out; }
  if(out.matches.length > 1){
    /* Ek hi parent ke neeche do same naam — ye Marg master data ka issue hai,
     * yahan guess karna theek nahi. */
    out.ambiguous = true;
    return out;
  }
  /* Is parent ke neeche mila hi nahi — global try karo, taaki neeche
   * parentMismatch use pakad kar user ko wajah bata sake. */
  var g = bssIdByName(dd, key, name);
  g.scoped = false;
  return g;
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
      msg:'Your account has no BSS User ID mapped. Ask an admin to set it in Admin → Users. Updates are disabled until then.' });

  BSS_CROSSWALK.forEach(function(f){
    var v = form[f.key];
    var empty = (v === undefined || v === null || v === '');

    if(f.required && empty){
      errors.push({ field:f.key, msg:f.label + ' is required' });
      return;
    }
    if(empty) return;

    if(f.type === 'date'){
      var ds = String(v).trim();
      if(!/^\d{4}-\d{2}-\d{2}$/.test(ds)){
        errors.push({ field:f.key, msg:f.label + ' must be in YYYY-MM-DD format' });
        return;
      }
      /* Format sahi hone ka matlab date ka EXIST karna nahi. 2026-02-30 aur
         2026-13-01 regex pass kar jate the aur seedha Marg ko chale jate.
         Round-trip se asli calendar check hota hai. */
      var pp = ds.split('-').map(Number);
      var dt = new Date(Date.UTC(pp[0], pp[1] - 1, pp[2]));
      if(dt.getUTCFullYear() !== pp[0] || dt.getUTCMonth() !== pp[1] - 1 || dt.getUTCDate() !== pp[2])
        errors.push({ field:f.key, msg:f.label + ': ' + ds + ' is not a real calendar date' });
      return;
    }
    if(f.type === 'text') return;

    /* select / cascade → ID us field ki APNI list me maujood ho */
    if(!/^\d+$/.test(String(v))){
      errors.push({ field:f.key, msg:f.label + ' must be a numeric ID' });
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
            msg:f.label + ' is not valid under the selected ' + (pf ? pf.label : f.parent) + ' — please choose again' });
        }
      } else if(!bssOptionById(dd, f.key, v)){
        errors.push({ field:f.key, msg:f.label + ' ID (' + v + ') was not found in the master list' });
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
/* CONFIRMED against live GetMBTicketStatusDetail responses for MB - 037392 AND
 * MB - 036741, each cross-checked against the BSS UI screen for that ticket.
 *
 * MB - 036741 ne decide kiya (037392 par dono naam same the, isliye us se
 * farak pata nahi chalta tha):
 *     BSS UI  Problem Type     = "Invoice Template"          -> read SubDisposition
 *     BSS UI  Sub-Problem Type = "Exta page printing issue"  -> read Problemtype
 * Proof: "Exta page printing issue" master data me SIRF SubProblemTypeMargBook
 * me hai (ID 3082, parent 801), aur chain 98 -> 801 -> 3082 valid banti hai.
 *
 * Read endpoint aur update payload ka naming ALAG hai — aur ye sirf swap nahi,
 * SHIFT hai. Verified mapping:
 *
 *   BSS UI label      read field                update payload
 *   ---------------------------------------------------------------
 *   Main Disposition  MainDisposition           BSSMainDisposition
 *   Problem Type      SubDisposition            BSSProblemType
 *   Sub-Problem Type  Problemtype               BSSSubProblemType
 *   Sub Disposition   Status                    Disposition
 *   Disposition       <current stage>_Disp      SubDisposition
 *
 * "Disposition" ka koi dedicated read field NAHI hai — wo ticket jis stage par
 * hai us stage ki disp hai (MB - 037392: status Acknowledge -> Ack_Disp =
 * "Future Development"). Isliye neeche `disposition` ka koi alias nahi hai;
 * use bssCurrentDisposition() derive karta hai. */
var BSS_READ_ALIASES = {
  ticketNo:        ['TicketNo'],
  createdDate:     ['TicketCreatedDate'],
  currentStatus:   ['Status'],
  timelineDate:    ['TimeLineDate'],

  subDisposition:  ['Status'],              // UI "Sub Disposition" = ticket status
  mainDisposition: ['MainDisposition'],
  problemType:     ['SubDisposition'],      // ⚠️ read `SubDisposition` = UI Problem Type
  subProblemType:  ['Problemtype'],         // ⚠️ read `Problemtype`    = UI Sub-Problem Type

  description:     ['Description'],         // read-only, update endpoint me hai hi nahi

  jiraId:          ['JiraID'],
  assignedTo:      ['Assignto'],
  rm:              ['RM'],
  developer:       ['Developer'],
  remarks:         ['Remarks'],
  /* bssComment JAANBUJHKAR nahi hai — dekho bssReadTicket() ka note. */
};

/* Stage-wise disposition fields, reverse-chronological (baad ke stage pehle).
 * assets/ticket-parser.js ke MB_DISP_FALLBACK_ORDER se match karta hai; page
 * par wahi global pass hota hai, ye sirf standalone fallback hai. */
var BSS_DISP_ORDER_FALLBACK = [
  'RejectDisp','FutureDevelopmentDisp','ReopenDisp','TransferToSupportDisp',
  'ReadyToGoLiveDisp','ReopendfromTesting_Disp','ReadyForUAT_Disp',
  'ReadyForMerging_Disp','ReadyForCodeReview_Disp','ReadyForTesting_Disp',
  'Inprogress_Disp','Ack_Disp','TransferToIT_Disp'
];

/* UI "Disposition" derive karo: ticket jis stage par hai, USI stage ki disp.
 * Recognition filter NAHI lagate — parser ka `ld` sirf 6 recognized values
 * leta hai, par BSS UI "Future Development" jaisi values bhi dikhata hai.
 *
 * stageMap / order page se aate hain (MB_STAGE_DISP_BY_SC / MB_DISP_FALLBACK_ORDER)
 * taaki mapping duplicate na ho — wahi drift ka source banta hai. */
function bssCurrentDisposition(raw, statusCode, stageMap, order){
  if(!raw) return null;
  var key = stageMap && statusCode ? stageMap[statusCode] : null;
  if(key && raw[key] && String(raw[key]).trim()) return String(raw[key]).trim();
  var list = order || BSS_DISP_ORDER_FALLBACK;
  for(var i = 0; i < list.length; i++){
    var v = raw[list[i]];
    if(v && String(v).trim()) return String(v).trim();
  }
  return null;
}

/* Marg read me date DD-MM-YYYY aati hai ("29-08-2026"), par UpdateTicketStatus
 * aur <input type="date"> dono YYYY-MM-DD maangte hain. Convert na karo to
 * date field khali dikhega aur save par wo value ud jayegi. */
function bssToISODate(v){
  if(v === null || v === undefined) return null;
  var t = String(v).trim();
  if(!t || t.indexOf('1900-01-01') === 0) return null;
  var m = t.match(/^(\d{2})-(\d{2})-(\d{4})$/);          // DD-MM-YYYY
  if(m) return m[3] + '-' + m[2] + '-' + m[1];
  m = t.match(/^(\d{4})-(\d{2})-(\d{2})/);               // YYYY-MM-DD (+ time)
  if(m) return m[1] + '-' + m[2] + '-' + m[3];
  return null;
}

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
function bssReadTicket(raw, dd, stageMap, dispOrder){
  /* missing        = read response me field aaya hi nahi
   * unresolved     = value AAYI par master list me match nahi hui
   * parentMismatch = value resolve to hui, par uska parent selected parent se
   *                  match nahi karta (cascade toot jayega)
   *
   * `unresolved` pehle nahi tha — us case me field chup-chaap blank ho jata
   * tha aur user ko lagta ki BSS me kuch set hi nahi hai. Ab dono alag hain. */
  var out = { values:{}, names:{}, resolved:{}, missing:[], unresolved:[], parentMismatch:[], ambiguous:[] };

  ['ticketNo','createdDate','currentStatus','jiraId','remarks','description']
    .forEach(function(k){
      var r = bssReadValue(raw, k);
      out.values[k] = r.value;
      out.resolved[k] = r.via;
      /* description read-only hai (update endpoint me hai hi nahi), isliye
         "missing" report karna bekaar shor hoga. */
      if(r.via === null && k !== 'description') out.missing.push(k);
    });

  /* Timeline date: DD-MM-YYYY -> YYYY-MM-DD */
  var tl = bssReadValue(raw, 'timelineDate');
  out.values.timelineDate = bssToISODate(tl.value);
  out.resolved.timelineDate = tl.via;
  if(out.values.timelineDate === null) out.missing.push('timelineDate');

  /* BSS Comment JAANBUJHKAR blank rehta hai. Wo ek field nahi, append-only
   * comment log hai — BSS UI me har update ek nayi Comments row banata hai.
   * Pre-fill karne par har save duplicate comment bana deta. */
  out.values.bssComment = null;
  out.resolved.bssComment = null;

  /* DO PASS. Cascade child ko resolve karne ke liye uska parent PEHLE resolve
   * hona chahiye — warna scoping possible hi nahi. Pass 1: non-cascade.
   * Pass 2: cascade, crosswalk order me (parent hamesha child se pehle hai). */
  function resolveField(f, scoped){
    if(f.key === 'disposition') return;   /* neeche derive hota hai */
    var nameR = bssReadValue(raw, f.key);
    if(nameR.value === null){ out.missing.push(f.key); out.values[f.key] = null; out.names[f.key] = ''; return; }
    out.names[f.key] = String(nameR.value).trim();
    out.resolved[f.key] = nameR.via;

    var rev = scoped
      ? bssIdByNameInParent(dd, f.key, nameR.value, out.values[f.parent])
      : bssIdByName(dd, f.key, nameR.value);

    out.values[f.key] = rev.id;
    if(rev.ambiguous) out.ambiguous.push({ field:f.key, name:String(nameR.value).trim(), ids:rev.matches.map(function(m){ return m.ID; }) });
    if(rev.id === null)
      out.unresolved.push({ field:f.key, label:f.label, name:String(nameR.value).trim(), list:f.list, via:nameR.via });
  }

  bssSelectFields().forEach(function(f){ if(f.type !== 'cascade') resolveField(f, false); });
  bssSelectFields().forEach(function(f){ if(f.type === 'cascade') resolveField(f, true);  });

  /* Cascade sanity: child ka parent, parent field ki value se match karta hai? */
  BSS_CROSSWALK.forEach(function(f){
    if(f.type !== 'cascade') return;
    var childId = out.values[f.key], parentId = out.values[f.parent];
    if(childId === null || childId === undefined) return;
    var opt = bssOptionById(dd, f.key, childId);
    if(!opt) return;
    var actual = opt[f.parentKey];
    if(parentId === null || parentId === undefined || Number(actual) !== Number(parentId)){
      var pf = bssField(f.parent);
      out.parentMismatch.push({
        field:f.key, label:f.label, name:String(opt.Name).trim(),
        parentLabel: pf ? pf.label : f.parent,
        expected: parentId === null || parentId === undefined ? null : Number(parentId),
        actual: actual === null || actual === undefined ? null : Number(actual),
        actualParentName: pf ? bssNameById(dd, f.parent, actual) : String(actual),
      });
    }
  });

  /* Disposition — current stage se derive (koi direct field nahi hai) */
  var sc = null;
  if(typeof MB_STATUS_MAP !== 'undefined' && raw && raw.Status)
    sc = MB_STATUS_MAP[String(raw.Status).trim()] || null;
  var dispName = bssCurrentDisposition(raw, sc, stageMap, dispOrder);
  if(dispName === null){
    out.values.disposition = null; out.names.disposition = ''; out.missing.push('disposition');
  } else {
    out.names.disposition = dispName;
    out.resolved.disposition = 'derived from current stage';
    var rv = bssIdByName(dd, 'disposition', dispName);
    out.values.disposition = rv.id;
    if(rv.ambiguous) out.ambiguous.push({ field:'disposition', name:dispName, ids:rv.matches.map(function(m){ return m.ID; }) });
  }

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
    bssCurrentDisposition, bssToISODate, BSS_DISP_ORDER_FALLBACK, bssIdByNameInParent,
  };
}
