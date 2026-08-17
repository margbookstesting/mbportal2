/* ===========================================================================
 * MB Portal — SHARED TICKET PARSER  (single source of truth)
 * ---------------------------------------------------------------------------
 * WHY THIS FILE EXISTS
 * Pehle har dashboard ka apna `parseAPIRecord` tha aur sabka field set alag:
 *   marg_ticket_dashboard  → ld + 8 sub-stages + cld, par `tia` NAHI
 *   support_dashboard      → `tia`, par ld / sub-stages / cld NAHI
 *   ticket_dashboard_api   → dono nahi
 *   fetch_tickets.py       → sab (superset)
 * Sab ek hi `ticket_cache` table me likhte the, to jis page se Refresh hota
 * tha wo baaki pages ke fields cache se uda deta tha:
 *   TAT par Refresh    → Support ka "Agent-wise" table khali (tia gaya)
 *   Support par Refresh → TAT ke Bug/Dev columns "Others", RfT/UAT TAT 0% (ld/rtt gaye)
 * Ab saare browser dashboards YAHI parser use karte hain, isliye kisi bhi
 * page se Refresh karo — cache me poora superset jaata hai.
 *
 * RULE: yahan koi field ADD karo to `.github/scripts/fetch_tickets.py` ke
 * parse_record() me bhi ADD karo, aur MB_SCHEMA_VERSION bump karo.
 * =========================================================================== */

/* Cache payload schema version. Bump karo jab bhi field set badle.
 * api/ticket-cache.js isko validate karta hai; cacheLoad() purani rows par
 * warning deta hai. */
var MB_SCHEMA_VERSION = 2;

/* Marg ticket API */
var MB_API_URL = 'https://bssapi.margcompusoft.com/api/MargBook/GetMBTicketStatusDetail';

/* Status string → short code */
var MB_STATUS_MAP = {
  'Transfer To IT':'IT','Acknowledge':'AK','In Progress':'IP',
  'Ready To Go Live':'LV','Transfer To Support':'SP','Closed':'CL',
  'Return To Support':'RS','Ready For Testing':'RT','Ready For UAT':'RU',
  'Return to Support':'RS','Ready for Testing':'RT','Ready for UAT':'RU'
};

/* Stage → uska apna disposition field (API record key).
 * `ld` (last disposition) nikaalne ke liye — ticket jis stage par abhi hai. */
var MB_STAGE_DISP_BY_SC = {
  'IT': 'TransferToIT_Disp',
  'AK': 'Ack_Disp',
  'IP': 'Inprogress_Disp',
  'RT': 'ReadyForTesting_Disp',
  'RU': 'ReadyForUAT_Disp',
  'LV': 'ReadyToGoLiveDisp',
  'SP': 'TransferToSupportDisp',
  'RS': 'ReopenDisp',
};

/* Reverse-chronological fallback order — baad ke stages pehle */
var MB_DISP_FALLBACK_ORDER = [
  'RejectDisp','FutureDevelopmentDisp','ReopenDisp','TransferToSupportDisp',
  'ReadyToGoLiveDisp','ReopendfromTesting_Disp','ReadyForUAT_Disp',
  'ReadyForMerging_Disp','ReadyForCodeReview_Disp','ReadyForTesting_Disp',
  'Inprogress_Disp','Ack_Disp','TransferToIT_Disp'
];

/* 8 additional sub-stages: [shortKey, dateField, tatField, agentField]
 * Keys banti hain: <k>d = date, <k>t = TAT flag, <k>v = compact TAT, <k>g = agent */
var MB_SUB_STAGES = [
  ['rt','ReadyForTestingDate',    'ReadyForTesting_TATDetails',    'ReadyForTestingBy'],
  ['cr','ReadyForCodeReviewDate', 'ReadyForCodeReview_TATDetails', 'ReadyForCodeReviewBy'],
  ['mg','ReadyForMergingDate',    'ReadyForMerging_TATDetails',    'ReadyForMergingBy'],
  ['ua','ReadyForUATDate',        'ReadyForUAT_TATDetails',        'ReadyForUATBy'],
  ['rf','ReopendfromTestingDate', 'ReopendfromTesting_TATDetails', 'ReopendfromTestingBy'],
  ['ro','ReOpenDate',             'Reopen_TATDetails',             'ReOpenBy'],
  ['fd','FutureDevelopmentDate',  'Futuredevelopment_TATDetails',  'FutureDevelopmentBy'],
  ['rj','RejectedDate',           'Rejected_TATDetails',           'RejectedBy'],
];

/* Fields jinke bina koi dashboard section khali dikhta hai — api/ticket-cache.js
 * inhe validate karta hai payload accept karne se pehle. */
var MB_REQUIRED_FIELDS = ['tia','ld','rtd','st'];

/* ── Primitive helpers ───────────────────────────────────────────────────── */
function mbTATFlag(v){
  if(!v) return null;
  var s = String(v);
  return s.indexOf('InTAT') >= 0 ? 'I' : (s.indexOf('OutTAT') >= 0 ? 'O' : null);
}
function mbCompactTAT(v){
  if(!v) return null;
  var m = String(v).match(/(\d+)\s+days?\s+(\d+)\s+hours?/);
  return m ? (m[1] + 'd ' + m[2] + 'h') : null;
}
function mbParseDate(v){
  if(!v || v === '1900-01-01T00:00:00') return null;
  var s = String(v).trim();
  // DD-MM-YYYY (e.g. "16-06-2026") → YYYY-MM-DD
  var dmy = s.match(/^(\d{2})-(\d{2})-(\d{4})$/);
  if(dmy) return dmy[3] + '-' + dmy[2] + '-' + dmy[1];
  // ISO / YYYY-MM-DD
  return s.split('T')[0];
}

/* Bug / Bug Urgent / Development / Development Urgent / Improvement / Data Updation.
 * `ld` walk me sirf inhi values ko recognized maana jaata hai — patterns
 * isBug/isDev/isImprovement/isDataUpdation se exactly match karte hain. */
function mbIsRecognizedDisp(v){
  var s = String(v == null ? '' : v).trim();
  if(!s) return false;
  if(/^\s*(bug|bug\s*urgent|development|development\s*urgent)\s*$/i.test(s)) return true;
  if(/improvement/i.test(s)) return true;
  if(/data\s*updation/i.test(s)) return true;
  return false;
}

/* ── SUPERSET PARSER ─────────────────────────────────────────────────────── */
/* Ek Marg API record → compact cache record (ya null agar rakhne layak nahi). */
function mbParseTicket(r){
  var rec = {};

  /* Identity / people */
  if(r.TicketNo)                                  rec.n = r.TicketNo;
  if(r.LicNo)                                     rec.l = r.LicNo;
  if(r.UserName && r.UserName.trim())             rec.u = r.UserName.trim();
  if(r.subscriptionPlan && r.subscriptionPlan.trim()) rec.p = r.subscriptionPlan.trim();
  if(r.Ack_Disp)                                  rec.q = r.Ack_Disp;   /* legacy, backward-compat */
  if(r.RM && r.RM.trim())                         rec.r = r.RM.trim();
  if(r.TransferTo)                                rec.t = r.TransferTo;
  /* rec.t (TransferTo) = tester ka naam. rec.tia (TransfertoITAgents) =
   * SUPPORT-TEAM agent jisne ticket IT ko transfer kiya — Support Dashboard ke
   * "Transfer To IT — Agent-wise Breakdown" section ke liye. Dono alag hain. */
  if(r.TransfertoITAgents)                        rec.tia = r.TransfertoITAgents;
  if(r.AcknowledgebyAgents)                       rec.ta = r.AcknowledgebyAgents;
  if(r.InProgressByAgent)                         rec.ti = r.InProgressByAgent;
  if(r.TransferTosupportBy)                       rec.ts = r.TransferTosupportBy;
  if(r.ReadyToGoLiveBy)                           rec.eb = r.ReadyToGoLiveBy;
  if(r.Developer && r.Developer.trim())           rec.dev = r.Developer.trim();
  if(r.Assignto && r.Assignto.trim())             rec.assignto = r.Assignto.trim();

  /* Text */
  if(r.Description && r.Description.trim())       rec.desc = r.Description.trim();
  if(r.Remarks && r.Remarks.trim())               rec.remarks = r.Remarks.trim();
  if(r.SubDisposition && r.SubDisposition.trim()) rec.subDisp = r.SubDisposition.trim();
  if(r.MainDisposition && r.MainDisposition.trim()) rec.mainDisp = r.MainDisposition.trim();
  if(r.Problemtype && r.Problemtype.trim())       rec.probType = r.Problemtype.trim();

  /* Contact */
  if(r.Mobile && String(r.Mobile).trim())         rec.mobile = String(r.Mobile).trim();
  if(r.Emailid && String(r.Emailid).trim())       rec.email = String(r.Emailid).trim();

  /* Timeline / created */
  var tld = mbParseDate(r.TimeLineDate);       if(tld) rec.tld = tld;
  var tc  = mbParseDate(r.TicketCreatedDate);  if(tc)  rec.tc = tc;

  /* 5 main stages */
  var a = mbParseDate(r.TransfertoITDate);
  var b = mbParseDate(r.AcknowledgeDate);
  var c = mbParseDate(r.InProgressDate);
  var d = mbParseDate(r.TransferTosupportDate);
  var e = mbParseDate(r.ReadyToGoLiveDate);

  if(a){ rec.a = a;
    var at = mbTATFlag(r.TransferToIT_TATDetails);    if(at) rec.at = at;
    var av = mbCompactTAT(r.TransferToIT_TATDetails); if(av) rec.av = av;
    if(r.TransferToIT_TatDuration) rec.ad = String(r.TransferToIT_TatDuration); }
  if(b){ rec.b = b;
    var bt = mbTATFlag(r.Ack_TATDetails);    if(bt) rec.bt = bt;
    var bv = mbCompactTAT(r.Ack_TATDetails); if(bv) rec.bv = bv;
    if(r.Ack_TatDuration) rec.bd = String(r.Ack_TatDuration); }
  if(c){ rec.c = c;
    var ct = mbTATFlag(r.InProgress_TATDetails);    if(ct) rec.ct = ct;
    var cv = mbCompactTAT(r.InProgress_TATDetails); if(cv) rec.cv = cv;
    if(r.InProgress_TatDuration) rec.cd = String(r.InProgress_TatDuration); }
  if(d){ rec.d = d;
    var dt = mbTATFlag(r.TransfertoSupport_TATDetails);    if(dt) rec.dt = dt;
    var dv = mbCompactTAT(r.TransfertoSupport_TATDetails); if(dv) rec.dv = dv;
    if(r.TransferToSupport_TatDuration) rec.dd = String(r.TransferToSupport_TatDuration); }
  if(e){ rec.e = e;
    var et = mbTATFlag(r.ReadyToGoLive_TATDetails);    if(et) rec.et = et;
    var ev = mbCompactTAT(r.ReadyToGoLive_TATDetails); if(ev) rec.ev = ev; }

  /* 8 sub-stages (13-stage timeline + RfT/UAT KPIs isi par depend karte hain) */
  var hasSubStage = false;
  for(var i = 0; i < MB_SUB_STAGES.length; i++){
    var m  = MB_SUB_STAGES[i];
    var dd = mbParseDate(r[m[1]]);
    if(!dd) continue;
    hasSubStage = true;
    rec[m[0] + 'd'] = dd;
    var tf = mbTATFlag(r[m[2]]);    if(tf) rec[m[0] + 't'] = tf;
    var tv = mbCompactTAT(r[m[2]]); if(tv) rec[m[0] + 'v'] = tv;
    if(r[m[3]] && String(r[m[3]]).trim()) rec[m[0] + 'g'] = String(r[m[3]]).trim();
  }

  /* Close date + closed-by */
  var cld = mbParseDate(r.CloseDate);
  if(cld){
    rec.cld = cld;
    if(r.ClosedBY && String(r.ClosedBY).trim()) rec.clb = String(r.ClosedBY).trim();
  }

  /* Raw status (Support Dashboard ke status-wise KPIs) + short code */
  if(r.Status && String(r.Status).trim()) rec.st = String(r.Status).trim();
  rec.sc = MB_STATUS_MAP[r.Status] || 'OT';

  /* ── LAST DISPOSITION (ld) ──
   * (1) Category-aware reverse-chronological walk: aakhri stage jiski
   *     disposition 6 recognized values me se ho. Unrecognized (jaise
   *     "Bug Approved") SKIP hote hain, taaki pehle ke stages ko mauka mile —
   *     "Others" tabhi jab kahin kuch na mile.
   * (2) Fallback: current stage ka apna Disp, phir pehla non-empty reverse-chrono. */
  var ld = null, k, v;
  for(var x = 0; x < MB_DISP_FALLBACK_ORDER.length; x++){
    k = MB_DISP_FALLBACK_ORDER[x]; v = r[k];
    if(v && String(v).trim() && mbIsRecognizedDisp(v)){ ld = String(v).trim(); break; }
  }
  if(!ld){
    var primary = MB_STAGE_DISP_BY_SC[rec.sc];
    if(primary && r[primary] && String(r[primary]).trim()){
      ld = String(r[primary]).trim();
    } else {
      for(var y = 0; y < MB_DISP_FALLBACK_ORDER.length; y++){
        k = MB_DISP_FALLBACK_ORDER[y];
        if(r[k] && String(r[k]).trim()){ ld = String(r[k]).trim(); break; }
      }
    }
  }
  if(ld) rec.ld = ld;

  /* Rakho agar koi bhi stage touch hua (main ya sub), ya status-only stage hai,
   * ya sirf ek status label carry karta hai (Pending/Reopen/Rejected na chhoote). */
  var statusOnlyOk = ['RS','RT','RU'].indexOf(rec.sc) >= 0;
  return (a || b || c || d || e || hasSubStage || statusOnlyOk || rec.st) ? rec : null;
}

/* ── CACHE MERGE (read side) ─────────────────────────────────────────────── */
/* Ek ticket kai year-rows me aa sakta hai. Pehle blind `map[t.n] = t` tha aur
 * rows ka order undefined tha, to random version jeet jaata tha — ek purani
 * adhoori row nayi poori row ko overwrite kar sakti thi. Ab: JYADA FIELDS
 * WALA record jeetega, tie par naya fetched_at.
 * rows = Supabase se aayi ticket_cache rows.
 * Returns { tickets, fetchedAt, dateFrom, dateTo, minSchema, rowCount } */
function mbMergeCacheRows(rows){
  var byTicket = {}, seenTs = {};
  var fetchedAt = null, dateFrom = null, dateTo = null, minSchema = null;

  /* Rows ko recency ke hisaab se SORT karte hain (naya pehle). Isse merge
   * deterministic ho jaata hai — Supabase se rows kisi bhi order me aayen,
   * result same rahega. */
  var sorted = (rows || []).filter(function(r){ return r && typeof r === 'object'; });
  sorted.sort(function(x, y){
    var tx = x.fetched_at ? new Date(x.fetched_at).getTime() : 0;
    var ty = y.fetched_at ? new Date(y.fetched_at).getTime() : 0;
    return ty - tx;   /* newest first */
  });

  sorted.forEach(function(row){
    var rowTs = row.fetched_at ? new Date(row.fetched_at).getTime() : 0;
    if(row.fetched_at && (!fetchedAt || row.fetched_at > fetchedAt)) fetchedAt = row.fetched_at;
    if(row.date_from && (!dateFrom || row.date_from < dateFrom)) dateFrom = row.date_from;
    if(row.date_to   && (!dateTo   || row.date_to   > dateTo))   dateTo   = row.date_to;
    var sv = (row.schema_version == null) ? 1 : row.schema_version;
    if(minSchema === null || sv < minSchema) minSchema = sv;

    if(!row.data || !Array.isArray(row.data)) return;
    row.data.forEach(function(t){
      if(!t || !t.n) return;

      /* FIELD-LEVEL UNION (record-level nahi).
       * Pehle "jyada fields wala record jeetega" tha. Wo blind last-wins se
       * behtar tha, par poora bug fix nahi karta: ek hi ticket do year-rows me
       * hota hai (Dec me bana, Feb me closed hua), aur dono rows ke field set
       * ALAG hote hain — 2025 row me `tia`, 2026 row me `cld`/`clb`. Record
       * level par ek poora jeetta hai, doosre ke fields UD JAATE hain. Yaani
       * wahi purana "Support ka Agent-wise table khali" symptom, bas chhote
       * scale par.
       * Ab: NAYA row base banta hai (status/stage current rehta hai), aur
       * purane rows sirf wo keys bharte hain jo missing hain. Na koi field
       * khota hai, na stale value naya value overwrite karti hai. */
      if(byTicket[t.n] === undefined){
        var copy = {}, ks = Object.keys(t);
        for(var i = 0; i < ks.length; i++) copy[ks[i]] = t[ks[i]];
        byTicket[t.n] = copy;
        seenTs[t.n] = rowTs;
        return;
      }
      var base = byTicket[t.n], keys = Object.keys(t);
      for(var j = 0; j < keys.length; j++){
        var k = keys[j];
        /* Sirf gap bharo. Rows newest-first aa rahe hain, to jo pehle set hua
         * wo hi sabse naya hai — usko chhedna nahi. */
        if(base[k] === undefined || base[k] === null || base[k] === '') base[k] = t[k];
      }
    });
  });

  var tickets = Object.keys(byTicket).map(function(k){ return byTicket[k]; });
  return {
    tickets: tickets,
    fetchedAt: fetchedAt,
    dateFrom: dateFrom,
    dateTo: dateTo,
    minSchema: minSchema === null ? MB_SCHEMA_VERSION : minSchema,
    rowCount: (rows || []).length
  };
}

/* ── CACHE WRITE (write side) ────────────────────────────────────────────── */
/* Browser seedha ticket_cache me nahi likhta. Ye helper server-side
 * api/ticket-cache.js ko call karta hai, jo caller ko verify karta hai aur
 * payload ko validate karta hai (schema_version + required fields + sanity
 * count) — adhoora data cache me ghus hi nahi sakta.
 * sbClient = Supabase JS client (session token ke liye) */
/* Vercel serverless function ka request-body limit ~4.5MB hai. Ek parsed
 * ticket ≈ 1.4KB JSON hota hai (63 fields, desc/remarks free text ke saath),
 * to sirf ~3,300 tickets par POST fail hone lagta tha — ek saal ka data
 * aaraam se usse zyada hai. Isliye body ko gzip karke bhejte hain:
 * measured ~21x chhota (12,000 tickets = 16.4MB raw → 0.76MB gzip+base64),
 * yaani ~70k tickets tak headroom. Server (api/ticket-cache.js) `gz` field
 * dekh kar unzip karta hai.
 * Base64 use kar rahe hain (raw bytes nahi) kyunki Content-Type: application/json
 * rehne se Vercel ka body parsing predictable rehta hai. */
var MB_MAX_BODY = 4.0 * 1024 * 1024;   /* 4.5MB limit se thoda neeche */

/* gzip → base64. CompressionStream Chrome 80+/Firefox 113+/Safari 16.4+ me hai.
 * Na mile to null return karte hain aur caller uncompressed bhej deta hai. */
async function mbGzipBase64(str){
  if(typeof CompressionStream === 'undefined') return null;
  try{
    var blob = new Blob([str]);
    var cs   = new CompressionStream('gzip');
    var buf  = await new Response(blob.stream().pipeThrough(cs)).arrayBuffer();
    var bytes = new Uint8Array(buf), bin = '';
    /* String.fromCharCode(...bytes) bade arrays par stack blow karta hai —
     * isliye 32KB ke chunks me. */
    for(var i = 0; i < bytes.length; i += 0x8000){
      bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
    }
    return btoa(bin);
  } catch(e){
    console.warn('gzip failed, uncompressed bhej rahe hain:', e);
    return null;
  }
}

async function mbCacheWrite(sbClient, opts){
  var res, out;
  var sess = await sbClient.auth.getSession();
  var token = sess && sess.data && sess.data.session ? sess.data.session.access_token : null;
  if(!token) throw new Error('Session expired — sign in again');

  var envelope = {
    writer:         opts.writer,
    date_from:      opts.dateFrom,
    date_to:        opts.dateTo,
    schema_version: MB_SCHEMA_VERSION
  };

  var dataJson = JSON.stringify(opts.data);
  var gz = await mbGzipBase64(dataJson);
  if(gz){
    envelope.gz    = gz;
    envelope.count = opts.data.length;   /* server unzip se pehle sanity check kar sake */
  } else {
    envelope.data = opts.data;
  }

  var body = JSON.stringify(envelope);
  if(body.length > MB_MAX_BODY){
    throw new Error(
      'Payload bahut bada (' + (body.length/1024/1024).toFixed(1) + 'MB' +
      (gz ? ' compressed' : ' uncompressed — purana browser, gzip support nahi') +
      '). Server limit ~4.5MB hai. Nightly job (GitHub Actions) se refresh karo.'
    );
  }

  res = await fetch('/api/ticket-cache', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + token },
    body: body
  });
  try { out = await res.json(); } catch(e) { out = { error: 'Server error (' + res.status + ')' }; }
  if(!res.ok || out.error) throw new Error(out.error || ('HTTP ' + res.status));
  return out;
}
