// BSS field crosswalk tests.
// Sabse important: Disposition <-> SubDisposition ka swap. Dono integer hain,
// to galat map hone par API error nahi deta — ticket chup-chaap galat status
// aur galat category me chala jaata hai. Ye suite usi ko lock karti hai.
const F = require('/home/claude/work/assets/bss-fields.js');

const PASS = []; const FAIL = [];
const ok = m => { PASS.push(m); console.log('  PASS:', m); };
const no = (m, d) => { FAIL.push(m); console.log('  FAIL:', m, d === undefined ? '' : '→ ' + d); };
const eq = (a, b, m) => (JSON.stringify(a) === JSON.stringify(b) ? ok(m) : no(m, `got ${JSON.stringify(a)}, want ${JSON.stringify(b)}`));

// ── Asli BindDropDown response ka representative subset ──
// IDs aur parent links wahi hain jo live response me the.
const DD = {
  Dispostion: [
    { ID: 1, Name: 'Pending' }, { ID: 2, Name: 'Acknowledge' }, { ID: 3, Name: 'In Progress' },
    { ID: 4, Name: 'Closed' }, { ID: 5, Name: 'Reopen' }, { ID: 12, Name: 'Transfer To IT' },
    { ID: 15, Name: 'Ready For Testing' }, { ID: 18, Name: 'Ready For UAT' },
  ],
  BSSDisposition: [
    { ID: 5, Name: 'Guidance Provided' }, { ID: 10, Name: 'Bug' }, { ID: 11, Name: 'Bug Urgent' },
    { ID: 12, Name: 'Development' }, { ID: 13, Name: 'Development Urgent' },
    { ID: 21, Name: 'No Disposition' }, { ID: 22, Name: 'Improvement' }, { ID: 23, Name: 'Data Updation' },
  ],
  SubDispostion: [
    { ID: 46, Name: 'LOG-IN/SIGN-UP' }, { ID: 47, Name: 'DASHBOARD' }, { ID: 48, Name: 'MASTER' },
    { ID: 118, Name: 'test' },
  ],
  ProblemTypeMargBook: [
    { ID: 552, Name: 'SIGN-UP', Subdispositionid: 46 },
    { ID: 553, Name: 'LOG-IN ', Subdispositionid: 46 },
    { ID: 554, Name: 'REFRESH DASHBOARD', Subdispositionid: 47 },
    { ID: 565, Name: 'Branch Master', Subdispositionid: 48 },
    // ORPHAN: parent 64 (Bss Panel) SubDispostion list me hai hi nahi
    { ID: 633, Name: 'Bss Panel ', Subdispositionid: 64 },
    // ORPHAN: parent 109 (Training)
    { ID: 866, Name: 'Follow-up for Training', Subdispositionid: 109 },
  ],
  SubProblemTypeMargBook: [
    { ID: 1960, Name: 'MOBILE NO.', ProblemType: 'SIGN-UP', ProblemTypeID: 552 },
    { ID: 1962, Name: 'EMAIL ID', ProblemType: 'SIGN-UP', ProblemTypeID: 552 },
    { ID: 1966, Name: 'USER ID', ProblemType: 'LOG-IN ', ProblemTypeID: 553 },
    { ID: 1975, Name: 'REFRESH DASHBOARD', ProblemType: 'REFRESH DASHBOARD', ProblemTypeID: 554 },
  ],
  Rm: [
    { ID: 1, Name: 'Mayur Sharma' }, { ID: 2, Name: 'Santosh Kumar' },
    { ID: 3, Name: 'Pardeep Pandit' }, { ID: 4, Name: 'Anil Tiwari' },
  ],
  Developers: [
    { ID: 1, Name: 'Aman Verma' }, { ID: 15, Name: 'Ashish Sharma' }, { ID: 16, Name: 'Santosh Kumar Yadav' },
  ],
  AssignTo: [
    { ID: 43, Name: 'IT Coordinator Care' },
    { ID: 43, Name: 'RAHUL RANJAN' },          // DUPLICATE ID — live data me aisa hi hai
    { ID: 3976, Name: 'Teena Sharma' },
    { ID: 4278, Name: 'Aman' },
  ],
  Users: [
    { ID: 3923, Name: 'Ajay' }, { ID: 4518, Name: 'Anil Tiwari' },
    { ID: 4008, Name: 'Preeti Lavanya' }, { ID: 4282, Name: 'Preeti Lavanya' }, // DUPLICATE NAME
  ],
};

console.log('== 1. THE SWAP: payload field names ==');
// Postman sample: Disposition:3 (In Progress), SubDisposition:10 (Bug)
eq(F.bssField('subDisposition').payload, 'Disposition',
   'UI "Sub Disposition" → payload `Disposition`');
eq(F.bssField('disposition').payload, 'SubDisposition',
   'UI "Disposition" → payload `SubDisposition`');
eq(F.bssField('subDisposition').list, 'Dispostion',
   'UI "Sub Disposition" → BindDropDown `Dispostion` (misspelled, as-is)');
eq(F.bssField('disposition').list, 'BSSDisposition',
   'UI "Disposition" → BindDropDown `BSSDisposition`');
eq(F.bssField('mainDisposition').list, 'SubDispostion',
   'UI "Main Disposition" → BindDropDown `SubDispostion` (misspelled, as-is)');

console.log('\n== 2. payload build reproduces the Postman sample exactly ==');
const form = {
  subDisposition: 3,       // In Progress   → Disposition: 3
  disposition: 10,         // Bug           → SubDisposition: 10
  mainDisposition: 46,     // LOG-IN/SIGN-UP→ BSSMainDisposition: 46
  problemType: 552,        // SIGN-UP       → BSSProblemType: 552
  subProblemType: 1960,    // MOBILE NO.    → BSSSubProblemType: 1960
  jiraId: '1213',
  timelineDate: '2026-06-29',
  assignedTo: 43,
  developer: 15,
  rm: 4,
  remarks: 'Ticket status updated successfully.',
  bssComment: 'testing2',
};
const body = F.bssBuildPayload(form, 'MB - 036939', 3923);
const expected = {
  TicketNo: 'MB - 036939', UpdatedByUser: 3923,
  Disposition: 3, SubDisposition: 10, BSSMainDisposition: 46,
  BSSProblemType: 552, BSSSubProblemType: 1960,
  AssignedTo: 43, Developer: 15, RM: 4,
  TimeLineDate: '2026-06-29', JiraID: '1213',
  Remarks: 'Ticket status updated successfully.', BSSComment: 'testing2',
};
const bk = Object.keys(body).sort(), ek = Object.keys(expected).sort();
eq(bk, ek, 'payload has exactly the expected field names');
let mismatch = bk.filter(k => String(body[k]) !== String(expected[k]));
eq(mismatch, [], 'every payload value matches the Postman sample');
eq(typeof body.Disposition, 'number', 'IDs sent as numbers, not strings');
eq(typeof body.JiraID, 'string', 'text fields sent as strings');

console.log('\n== 3. swap regression guard (the expensive bug) ==');
// Agar koi galti se in-progress ko SubDisposition me daal de
eq(body.Disposition, 3, 'status (In Progress) landed in `Disposition`');
eq(body.SubDisposition, 10, 'category (Bug) landed in `SubDisposition`');
const wrong = body.Disposition === 10 || body.SubDisposition === 3;
eq(wrong, false, 'status and category are NOT crossed');

console.log('\n== 4. empty fields are omitted, not sent as null/0 ==');
const partial = F.bssBuildPayload({ subDisposition: 3, disposition: 10, jiraId: '' }, 'MB - 1', 3923);
eq(Object.keys(partial).sort(), ['Disposition', 'SubDisposition', 'TicketNo', 'UpdatedByUser'],
   'blank/undefined fields dropped from payload');
eq('JiraID' in partial, false, 'empty string not sent (would blank the field in BSS)');

console.log('\n== 5. cascade filtering ==');
eq(F.bssCascadeOptions(DD, 'problemType', 46).map(o => o.ID), [552, 553],
   'Main Disposition 46 → only its own Problem Types');
eq(F.bssCascadeOptions(DD, 'problemType', 47).map(o => o.ID), [554],
   'Main Disposition 47 → 1 Problem Type');
eq(F.bssCascadeOptions(DD, 'subProblemType', 552).map(o => o.ID), [1960, 1962],
   'Problem Type 552 → its Sub-Problem Types');
eq(F.bssCascadeOptions(DD, 'problemType', null), [],
   'no parent selected → empty list (not the full list)');
eq(F.bssCascadeOptions(DD, 'problemType', 118), [],
   'parent with no children → empty list');
eq(F.bssCascadeOptions(DD, 'problemType', 999), [],
   'unknown parent → empty list');

console.log('\n== 6. validation ==');
eq(F.bssValidate(form, DD, 3923), [], 'valid form passes clean');

let e = F.bssValidate(form, DD, null);
eq(e.length === 1 && e[0].field === 'updatedByUser', true, 'missing bss_user_id blocks update');
eq(/BSS User ID/.test(e[0].msg), true, 'error tells the user what to do');

e = F.bssValidate({ ...form, subDisposition: '' }, DD, 3923);
eq(e.some(x => x.field === 'subDisposition'), true, 'required Sub Disposition enforced');

e = F.bssValidate({ ...form, disposition: '' }, DD, 3923);
eq(e.some(x => x.field === 'disposition'), true, 'required Disposition enforced');

// Cross-list contamination: RM ID 4518 (Users list) me daal do — Rm list me nahi hai
e = F.bssValidate({ ...form, rm: 4518 }, DD, 3923);
eq(e.some(x => x.field === 'rm'), true, 'RM id from the Users list is rejected (ID spaces differ)');
eq(F.bssOptionById(DD, 'rm', 4), DD.Rm[3], 'RM 4 resolves within the Rm list = Anil Tiwari');

// Invalid cascade combo: problemType 554 belongs to parent 47, not 46
e = F.bssValidate({ ...form, mainDisposition: 46, problemType: 554 }, DD, 3923);
eq(e.some(x => x.field === 'problemType'), true, 'Problem Type outside its parent is rejected');
e = F.bssValidate({ ...form, problemType: 552, subProblemType: 1966 }, DD, 3923);
eq(e.some(x => x.field === 'subProblemType'), true, 'Sub-Problem Type outside its parent is rejected');

e = F.bssValidate({ ...form, timelineDate: '29-06-2026' }, DD, 3923);
eq(e.some(x => x.field === 'timelineDate'), true, 'DD-MM-YYYY date rejected');
eq(F.bssValidate({ ...form, timelineDate: '2026-06-29' }, DD, 3923), [], 'YYYY-MM-DD accepted');

e = F.bssValidate({ ...form, developer: 999 }, DD, 3923);
eq(e.some(x => x.field === 'developer'), true, 'unknown Developer id rejected');

// Optional fields may be blank
eq(F.bssValidate({ subDisposition: 3, disposition: 10 }, DD, 3923), [],
   'only the two required fields is a valid submission');

console.log('\n== 7. duplicate names → reverse lookup must NOT guess ==');
let r = F.bssIdByName(DD, 'assignedTo', 'IT Coordinator Care');
eq(r.id, 43, 'unique-ish name resolves');
r = F.bssIdByName(DD, 'rm', 'Anil Tiwari');
eq(r.id, 4, 'RM name resolves inside the Rm list (id 4, not Users id 4518)');
r = F.bssIdByName(DD, 'developer', 'Nobody');
eq(r.id, null, 'unknown name → null, no guess');
// AssignTo has two entries sharing ID 43 → different names, same id
r = F.bssIdByName(DD, 'assignedTo', 'RAHUL RANJAN');
eq(r.id, 43, 'the other label on shared id 43 also resolves to 43');

console.log('\n== 8. dropdown health detects broken master data ==');
const h = F.bssDropdownHealth(DD);
eq(h.orphanParents, [64, 109], 'orphan parent ids detected (unreachable Problem Types)');
eq(h.orphanProblemTypes, 2, 'counted the orphaned Problem Types');
eq(h.emptyParents, [118], 'parent with zero children detected');

console.log('\n== 9. read-side resolution (CONFIRMED live mapping) ==');
{
  // Ye exactly MB - 037392 ka live response hai (relevant fields), aur uske
  // saamne BSS UI screen ne jo dikhaya wo.
  const LIVE = {
    TicketNo: 'MB - 037392',
    TicketCreatedDate: '2026-07-22T12:59:49.673',
    Status: 'Acknowledge',                    // UI "Sub Disposition"
    MainDisposition: 'DASHBOARD',             // UI "Main Disposition"
    Problemtype: 'REFRESH DASHBOARD',         // UI "Problem Type"
    SubDisposition: 'REFRESH DASHBOARD',      // UI "Sub-Problem Type"  <-- shifted
    TransferToIT_Disp: 'Bug',
    Ack_Disp: 'Future Development',           // UI "Disposition" (current stage)
    RejectDisp: 'No Disposition',
    JiraID: '',
    TimeLineDate: '29-08-2026',               // DD-MM-YYYY on read
    Remarks: 'Ticket status updated successfully.',
    Assignto: 'IT Coordinator Care',
    Developer: 'Ashish Sharma',
    RM: 'Anil Tiwari',
    SubStatus: 'No Disposition',
    ProblemCategory: 'No Disposition',
  };
  const DDL = {
    Dispostion: [{ ID: 2, Name: 'Acknowledge' }, { ID: 3, Name: 'In Progress' }],
    BSSDisposition: [{ ID: 6, Name: 'Future Development' }, { ID: 10, Name: 'Bug' }, { ID: 21, Name: 'No Disposition' }],
    SubDispostion: [{ ID: 47, Name: 'DASHBOARD' }, { ID: 46, Name: 'LOG-IN/SIGN-UP' }],
    ProblemTypeMargBook: [{ ID: 554, Name: 'REFRESH DASHBOARD', Subdispositionid: 47 },
                          { ID: 552, Name: 'SIGN-UP', Subdispositionid: 46 }],
    SubProblemTypeMargBook: [{ ID: 1975, Name: 'REFRESH DASHBOARD', ProblemTypeID: 554 },
                             { ID: 1960, Name: 'MOBILE NO.', ProblemTypeID: 552 }],
    AssignTo: [{ ID: 43, Name: 'IT Coordinator Care' }],
    Developers: [{ ID: 15, Name: 'Ashish Sharma' }],
    Rm: [{ ID: 4, Name: 'Anil Tiwari' }],
  };
  // Stage maps parser se — duplicate nahi karte
  const P = require('/home/claude/work/assets/ticket-parser.js');
  global.MB_STATUS_MAP = P.MB_STATUS_MAP;

  const t = F.bssReadTicket(LIVE, DDL, P.MB_STAGE_DISP_BY_SC, P.MB_DISP_FALLBACK_ORDER);

  // Har field wahi dikhna chahiye jo BSS UI screen par tha
  eq(t.names.subDisposition,  'Acknowledge',        'UI "Sub Disposition" reads from Status');
  eq(t.values.subDisposition, 2,                    '  └ resolves to Dispostion ID 2');
  eq(t.names.mainDisposition, 'DASHBOARD',          'UI "Main Disposition" reads from MainDisposition');
  eq(t.values.mainDisposition, 47,                  '  └ resolves to SubDispostion ID 47');
  eq(t.names.problemType,     'REFRESH DASHBOARD',  'UI "Problem Type" reads from Problemtype');
  eq(t.values.problemType,    554,                  '  └ resolves to ProblemTypeMargBook ID 554');
  eq(t.names.subProblemType,  'REFRESH DASHBOARD',  'UI "Sub-Problem Type" reads from SubDisposition (shifted)');
  eq(t.values.subProblemType, 1975,                 '  └ resolves to SubProblemTypeMargBook ID 1975');
  eq(t.names.disposition,     'Future Development', 'UI "Disposition" derived from the CURRENT stage (Ack_Disp)');
  eq(t.values.disposition,    6,                    '  └ resolves to BSSDisposition ID 6');
  eq(t.names.assignedTo,      'IT Coordinator Care','Assign To');
  eq(t.values.developer,      15,                   'Developer');
  eq(t.values.rm,             4,                    'RM');
  eq(t.values.remarks,        'Ticket status updated successfully.', 'Remarks');

  // Cascade chain must be internally valid, else the form rejects on save
  eq(F.bssCascadeOptions(DDL, 'problemType', t.values.mainDisposition).some(o => o.ID === t.values.problemType), true,
     'read Problem Type is valid under the read Main Disposition');
  eq(F.bssCascadeOptions(DDL, 'subProblemType', t.values.problemType).some(o => o.ID === t.values.subProblemType), true,
     'read Sub-Problem Type is valid under the read Problem Type');

  // The whole read must validate — otherwise the user cannot save without re-picking everything
  const form = {};
  F.BSS_CROSSWALK.forEach(f => { if (t.values[f.key] != null) form[f.key] = t.values[f.key]; });
  eq(F.bssValidate(form, DDL, 3923), [], 'the values read back form a VALID, submittable form');

  console.log('\n  -- disposition must NOT be the analytics `ld` --');
  const parsed = P.mbParseTicket(LIVE);
  eq(parsed.ld, 'Bug', 'parser ld = Bug (recognized-first walk)');
  eq(parsed.cd, 'Future Development', 'parser cd = Future Development (current stage)');
  eq(t.names.disposition === parsed.cd, true, 'modal Disposition matches cd, not ld');
  eq(t.names.disposition !== parsed.ld, true, 'and it is deliberately different from ld');

  console.log('\n  -- date conversion --');
  eq(t.values.timelineDate, '2026-08-29', 'TimeLineDate DD-MM-YYYY -> YYYY-MM-DD');
  eq(F.bssToISODate('29-08-2026'), '2026-08-29', 'DD-MM-YYYY converted');
  eq(F.bssToISODate('2026-08-29'), '2026-08-29', 'already-ISO passes through');
  eq(F.bssToISODate('2026-08-29T00:00:00'), '2026-08-29', 'ISO datetime trimmed to date');
  eq(F.bssToISODate('1900-01-01T00:00:00'), null, 'sentinel 1900 -> null');
  eq(F.bssToISODate(''), null, 'empty -> null');
  eq(F.bssToISODate(null), null, 'null -> null');
  eq(F.bssToISODate('garbage'), null, 'garbage -> null (not a bad date)');
  // The converted value must survive validation and round-trip into the payload
  eq(F.bssValidate({ subDisposition: 2, disposition: 6, timelineDate: t.values.timelineDate }, DDL, 1), [],
     'converted date passes validation');
  eq(F.bssBuildPayload({ subDisposition: 2, disposition: 6, timelineDate: t.values.timelineDate }, 'T', 1).TimeLineDate,
     '2026-08-29', 'converted date reaches the payload');

  console.log('\n  -- BSS Comment is append-only, never pre-filled --');
  eq(t.values.bssComment, null, 'bssComment is always null after a read');
  eq('bssComment' in F.BSS_READ_ALIASES, false, 'no read alias defined for bssComment (by design)');
  eq('BSSComment' in F.bssBuildPayload({ subDisposition: 2, disposition: 6 }, 'T', 1), false,
     'an empty comment is not sent (no duplicate comment rows)');
  eq(F.bssBuildPayload({ subDisposition: 2, disposition: 6, bssComment: 'new note' }, 'T', 1).BSSComment,
     'new note', 'a typed comment IS sent');

  console.log('\n  -- current-stage disposition across stages --');
  const cur = (raw) => F.bssCurrentDisposition(raw, raw && P.MB_STATUS_MAP[raw.Status], P.MB_STAGE_DISP_BY_SC, P.MB_DISP_FALLBACK_ORDER);
  eq(cur({ Status: 'In Progress', Inprogress_Disp: 'Development', Ack_Disp: 'Bug' }), 'Development',
     'In Progress -> Inprogress_Disp');
  eq(cur({ Status: 'Transfer To IT', TransferToIT_Disp: 'Bug', Ack_Disp: 'Improvement' }), 'Bug',
     'Transfer To IT -> TransferToIT_Disp');
  eq(cur({ Status: 'Closed', Ack_Disp: 'Bug' }), 'Bug',
     'stage with no disp field falls back to the most recent non-empty');
  eq(cur({ Status: 'Pending' }), null, 'nothing anywhere -> null');
  eq(cur(null), null, 'null record -> null');
  // Unrecognized values must NOT be filtered out (that is the whole point)
  eq(cur({ Status: 'Acknowledge', Ack_Disp: 'Guidance Provided' }), 'Guidance Provided',
     'unrecognized disposition is kept (no analytics filter)');
}

console.log('\n== 10. read audit ==');
{
  const audit = F.bssReadAudit({ TicketNo: 'MB - 1', Status: 'Closed', Problemtype: 'X' });
  eq(audit.find(a => a.field === 'problemType').found, true, 'audit finds Problem Type');
  eq(audit.find(a => a.field === 'problemType').via, 'Problemtype', 'audit reports the matching key');
  eq(audit.find(a => a.field === 'developer').found, false, 'audit reports missing fields');
  eq(F.bssReadValue({ TimeLineDate: '1900-01-01T00:00:00' }, 'timelineDate').value, null,
     'sentinel 1900 date treated as empty');
}

console.log('\n== 11. all user-facing messages are English ==');
{
  const HINGLISH = /\b(nahi|karo|karwao|dabao|chalao|kholo|dekho|purana|khali|bheje|gaya|hua|rahe|padega|sakte|zaroori|theek|wapas|jaye|bahut|hai)\b/i;
  let bad = [];
  const src = require('fs').readFileSync('/home/claude/work/assets/bss-fields.js', 'utf8');
  // sirf msg:'...' / Error('...') strings — comments Hinglish rehne diye gaye hain
  [...src.matchAll(/msg\s*:\s*([^,\n]+)/g)].forEach(m => { if (HINGLISH.test(m[1])) bad.push(m[1].trim().slice(0, 60)); });
  eq(bad, [], 'no Hinglish left in validation messages');
}

console.log('\nBSS FIELD RESULTS: ' + PASS.length + ' passed, ' + FAIL.length + ' failed');
process.exit(FAIL.length ? 1 : 0);
