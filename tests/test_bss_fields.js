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

console.log('\n== 9. read-side resolution ==');
// Case A: Marg returns IDs (best case) — exact pre-select, no guessing
let t = F.bssReadTicket({
  TicketNo: 'MB - 036939', TicketCreatedDate: '2026-06-29T00:00:00',
  Status: 'In Progress', TimeLineDate: '2026-06-29',
  DispositionID: 3, SubDispositionID: 10, BSSMainDispositionID: 46,
  BSSProblemTypeID: 552, BSSSubProblemTypeID: 1960,
  AssignedToID: 43, DeveloperID: 15, RMID: 4, JiraID: '1213',
}, DD);
eq(t.values.subDisposition, 3, 'status id read');
eq(t.values.disposition, 10, 'category id read');
eq(t.names.disposition, 'Bug', 'category id → name for display');
eq(t.names.rm, 'Anil Tiwari', 'RM id → name');
eq(t.values.jiraId, '1213', 'JiraID read');
eq(t.ambiguous, [], 'no ambiguity when ids are provided');

// Case B: Marg returns only names — reverse lookup, ambiguity flagged
t = F.bssReadTicket({
  TicketNo: 'MB - 036939', Status: 'In Progress',
  MainDisposition: 'Bug', Problemtype: 'SIGN-UP', Assignto: 'Teena Sharma', RM: 'Anil Tiwari',
}, DD);
eq(t.values.disposition, 10, 'category name → id');
eq(t.values.assignedTo, 3976, 'assignee name → id');
eq(t.values.rm, 4, 'RM name → id from the Rm list');
eq(t.missing.includes('jiraId'), true, 'missing JiraID reported, not silently blank');

// Case C: field genuinely absent everywhere
t = F.bssReadTicket({ TicketNo: 'MB - 1' }, DD);
eq(t.values.developer, null, 'absent field → null');
eq(t.missing.includes('developer'), true, 'absent field listed in missing');

console.log('\n== 10. read audit (used to fix aliases after the live test) ==');
const audit = F.bssReadAudit({ TicketNo: 'MB - 036939', JiraId: 'X-9', Status: 'Closed' });
const jira = audit.find(a => a.field === 'jiraId');
eq(jira.found, true, 'audit finds JiraID under an alternate spelling');
eq(jira.via, 'JiraId', 'audit reports WHICH alias matched');
const dev = audit.find(a => a.field === 'developer');
eq(dev.found, false, 'audit reports fields that were not found');
eq(F.bssReadValue({ TimeLineDate: '1900-01-01T00:00:00' }, 'timelineDate').value, null,
   'sentinel 1900 date treated as empty');

console.log('\nBSS FIELD RESULTS: ' + PASS.length + ' passed, ' + FAIL.length + ' failed');
process.exit(FAIL.length ? 1 : 0);
