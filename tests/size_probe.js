// Realistic payload size probe.
// Ek synthetic Marg record banate hain (typical text lengths ke saath), usko
// asli shared parser se parse karte hain, aur dekh rahe hain ki kitne tickets
// par Vercel ka ~4.5MB request-body limit hit hota hai.
const fs = require('fs');
const zlib = require('zlib');
const vm = require('vm');

const parserSrc = fs.readFileSync('/home/claude/work/assets/ticket-parser.js', 'utf8');
const ctx = { console, fetch: () => {} };
vm.createContext(ctx);
vm.runInContext(parserSrc, ctx);

function makeRecord(i) {
  return {
    TicketNo: 'MB' + (100000 + i),
    LicNo: 'LIC' + (900000 + i),
    UserName: 'Some Customer Name ' + i,
    subscriptionPlan: 'MargBooks Premium Annual',
    RM: 'Relationship Manager ' + (i % 40),
    TransferTo: 'Tester Name ' + (i % 25),
    TransfertoITAgents: 'Support Agent ' + (i % 30),
    AcknowledgebyAgents: 'IT Agent ' + (i % 20),
    InProgressByAgent: 'Dev Agent ' + (i % 18),
    TransferTosupportBy: 'Support Agent ' + (i % 30),
    ReadyToGoLiveBy: 'Lead ' + (i % 8),
    Developer: 'Developer Name ' + (i % 22),
    Assignto: 'Assignee Name ' + (i % 22),
    // Free text — ye hi payload ka bulk hai
    Description: 'Customer is reporting that the stock summary report is not matching '
      + 'with the ledger balance for the selected financial year. Screenshots attached. '
      + 'Issue reproduced on build 12.4.8 for ticket sequence ' + i + '.',
    Remarks: 'Discussed with the customer over call, shared temporary workaround, '
      + 'pending permanent fix from development team. Follow-up scheduled.',
    SubDisposition: 'Report Mismatch - Stock Summary',
    MainDisposition: 'Bug',
    Problemtype: 'Software',
    Mobile: '98' + String(10000000 + i).slice(0, 8),
    Emailid: 'customer' + i + '@example-business-domain.com',
    TimeLineDate: '2026-03-14T00:00:00',
    TicketCreatedDate: '2026-02-01T00:00:00',
    TransfertoITDate: '2026-02-02T00:00:00',
    TransferToIT_TATDetails: 'InTAT - 1 days 4 hours',
    TransferToIT_TatDuration: '1.4',
    AcknowledgeDate: '2026-02-03T00:00:00',
    Ack_TATDetails: 'InTAT - 0 days 6 hours',
    Ack_TatDuration: '0.6',
    Ack_Disp: 'Bug',
    InProgressDate: '2026-02-05T00:00:00',
    InProgress_TATDetails: 'OutTAT - 5 days 2 hours',
    InProgress_TatDuration: '5.2',
    Inprogress_Disp: 'Bug',
    ReadyForTestingDate: '2026-02-10T00:00:00',
    ReadyForTesting_TATDetails: 'InTAT - 2 days 1 hours',
    ReadyForTestingBy: 'QA Person ' + (i % 12),
    ReadyForTesting_Disp: 'Bug',
    ReadyForCodeReviewDate: '2026-02-08T00:00:00',
    ReadyForCodeReview_TATDetails: 'InTAT - 1 days 0 hours',
    ReadyForCodeReviewBy: 'Reviewer ' + (i % 9),
    ReadyForMergingDate: '2026-02-09T00:00:00',
    ReadyForMerging_TATDetails: 'InTAT - 0 days 3 hours',
    ReadyForMergingBy: 'Merger ' + (i % 6),
    ReadyForUATDate: '2026-02-12T00:00:00',
    ReadyForUAT_TATDetails: 'InTAT - 1 days 2 hours',
    ReadyForUATBy: 'UAT Person ' + (i % 10),
    TransferTosupportDate: '2026-02-15T00:00:00',
    TransfertoSupport_TATDetails: 'InTAT - 1 days 1 hours',
    TransferToSupport_TatDuration: '1.1',
    TransferToSupportDisp: 'Bug',
    ReadyToGoLiveDate: '2026-02-18T00:00:00',
    ReadyToGoLive_TATDetails: 'InTAT - 3 days 0 hours',
    ReadyToGoLiveDisp: 'Bug',
    CloseDate: '2026-02-20T00:00:00',
    ClosedBY: 'Closer Agent ' + (i % 15),
    Status: 'Closed',
  };
}

const parsed = [];
for (let i = 0; i < 12000; i++) parsed.push(ctx.mbParseTicket(makeRecord(i)));

const oneJson = JSON.stringify(parsed[0]);
console.log('keys per record        :', Object.keys(parsed[0]).length);
console.log('bytes per record (JSON):', Buffer.byteLength(oneJson));
console.log('');

const LIMIT = 4.5 * 1024 * 1024;
console.log('tickets | raw JSON  | gzip+b64  | raw vs 4.5MB | gz vs 4.5MB');
for (const n of [1000, 2500, 5000, 8000, 12000]) {
  const slice = parsed.slice(0, n);
  const raw = Buffer.byteLength(JSON.stringify({ writer: 'x', date_from: '2026-01-01', schema_version: 2, data: slice }));
  const gz = zlib.gzipSync(Buffer.from(JSON.stringify(slice)), { level: 6 });
  const b64 = Math.ceil(gz.length / 3) * 4 + 120; // envelope
  const f = b => (b / 1024 / 1024).toFixed(2) + 'MB';
  console.log(
    String(n).padStart(7), '|', f(raw).padStart(9), '|', f(b64).padStart(9), '|',
    (raw > LIMIT ? 'OVER  ' : 'ok    ').padStart(12), '|',
    (b64 > LIMIT ? 'OVER' : 'ok')
  );
}
console.log('');
console.log('gzip+base64 is ~' + (
  Buffer.byteLength(JSON.stringify(parsed)) /
  (Math.ceil(zlib.gzipSync(Buffer.from(JSON.stringify(parsed))).length / 3) * 4)
).toFixed(1) + 'x smaller than raw JSON');
