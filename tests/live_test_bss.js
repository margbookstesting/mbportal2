#!/usr/bin/env node
/* ===========================================================================
 * LIVE BSS TEST  —  MB - 036939
 * ---------------------------------------------------------------------------
 * Ye script ASLI Marg API par chalti hai, deployed portal ke /api/bss-proxy
 * ke through. Isliye ye offline suite se alag hai: yahan production ticket
 * chhua jata hai.
 *
 * SAFETY — script ye teen cheezein karti hai:
 *   1. Pehle ticket ki ORIGINAL values padh kar disk par save karti hai
 *      (bss_live_backup_<ticket>.json). Kuch bhi ho jaye, wo file rehti hai.
 *   2. Har field ALAG-ALAG update karke turant wapas padh kar verify karti hai
 *      — taaki pata chale KAUNSA field toota, na ki "kuch toot gaya".
 *   3. Aakhir me saari original values RESTORE karti hai aur restore verify
 *      karti hai.
 *
 * CHALANE SE PEHLE:
 *   - Portal par deploy ho chuka ho (api/bss-proxy.js live ho)
 *   - sql/2026-08-bss-dashboard.sql chal chuka ho
 *   - Tumhare user par bss_user_id map ho (Admin → Users)
 *   - Tumhe bss-dashboard permission ho
 *
 * USAGE:
 *   node live_test_bss.js --base https://mbportal.vercel.app \
 *                         --email you@company.com --password 'yourpass'
 *
 *   optional:  --ticket "MB - 036939"     (default yahi hai)
 *              --dry                       (sirf padho, kuch update mat karo)
 *              --no-restore                (restore skip — DEBUG ONLY)
 *
 * Output ko copy karke bhej dena — jo bhi FAIL hoga usme exact field aur
 * expected/got dikhega.
 * =========================================================================== */

const fs = require('fs');

const SUPA_URL = 'https://xsxchyqhhyfvuxbofxna.supabase.co';
const SUPA_ANON = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InhzeGNoeXFoaHlmdnV4Ym9meG5hIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODE0MTMzNTAsImV4cCI6MjA5Njk4OTM1MH0.P4VYTv-fizFW7nknhP4h1BetBGJ6yLLD90lkUUYgt-4';

// ── args ──
const A = {};
process.argv.slice(2).forEach((a, i, arr) => {
  if (a.startsWith('--')) {
    const k = a.slice(2);
    A[k] = (arr[i + 1] && !arr[i + 1].startsWith('--')) ? arr[i + 1] : true;
  }
});
const BASE   = String(A.base || '').replace(/\/$/, '');
const EMAIL  = A.email, PASSWORD = A.password;
const TICKET = String(A.ticket || 'MB - 036939');
const DRY    = !!A.dry, NO_RESTORE = !!A['no-restore'];

if (!BASE || !EMAIL || !PASSWORD) {
  console.error('Usage: node live_test_bss.js --base https://your-portal --email you@co.com --password "pass" [--ticket "MB - 036939"] [--dry]');
  process.exit(2);
}

const F = require('../assets/bss-fields.js');

const PASS = [], FAIL = [], WARN = [];
const ok   = m => { PASS.push(m); console.log('  \x1b[32mPASS\x1b[0m ', m); };
const bad  = (m, d) => { FAIL.push(m); console.log('  \x1b[31mFAIL\x1b[0m ', m, d === undefined ? '' : '\n         → ' + d); };
const warn = m => { WARN.push(m); console.log('  \x1b[33mWARN\x1b[0m ', m); };
const hdr  = t => console.log(`\n\x1b[1m${t}\x1b[0m`);
const sleep = ms => new Promise(r => setTimeout(r, ms));

let TOKEN = null;

async function login() {
  const r = await fetch(`${SUPA_URL}/auth/v1/token?grant_type=password`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', apikey: SUPA_ANON },
    body: JSON.stringify({ email: EMAIL, password: PASSWORD }),
  });
  const j = await r.json();
  if (!r.ok || !j.access_token) throw new Error('Portal login failed: ' + (j.error_description || j.msg || r.status));
  TOKEN = j.access_token;
  return j;
}
async function proxy(payload) {
  const r = await fetch(`${BASE}/api/bss-proxy`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + TOKEN },
    body: JSON.stringify(payload),
  });
  let j; try { j = await r.json(); } catch { j = { error: 'non-JSON response (HTTP ' + r.status + ')' }; }
  return { status: r.status, ok: r.ok, body: j };
}
async function readTicket() {
  const r = await proxy({ action: 'ticket', ticketNo: TICKET });
  if (!r.ok || r.body.error) throw new Error('Ticket read failed: ' + (r.body.error || r.status));
  return r.body.ticket;
}

(async () => {
  console.log('='.repeat(72));
  console.log(`LIVE BSS TEST — ${TICKET}`);
  console.log(`Portal: ${BASE}${DRY ? '   [DRY RUN — no writes]' : ''}`);
  console.log('='.repeat(72));

  // ── 0. login ──
  hdr('0. Portal login');
  await login();
  ok('logged in to the portal');

  // ── 1. dropdowns ──
  hdr('1. BindDropDown master');
  let r = await proxy({ action: 'dropdowns' });
  if (!r.ok || r.body.error) { bad('dropdowns fetch', r.body.error || r.status); return finish(); }
  const DD = r.body.dropdowns;
  ok('dropdowns fetched');

  F.bssSelectFields().forEach(f => {
    const n = (DD[f.list] || []).length;
    if (n > 0) ok(`list "${f.list}" (${f.label}) → ${n} options`);
    else bad(`list "${f.list}" (${f.label}) is EMPTY or missing`,
             'BindDropDown ne is naam se list nahi di — assets/bss-fields.js me `list` theek karo');
  });

  const health = F.bssDropdownHealth(DD);
  if (health.orphanParents.length)
    warn(`${health.orphanProblemTypes} Problem Types ke parent (${health.orphanParents.join(', ')}) Main Disposition list me nahi — cascade me nahi dikhenge (Marg master data ka issue)`);
  Object.keys(health.duplicateNames || {}).forEach(k =>
    warn(`"${k}" me duplicate names: ` + health.duplicateNames[k].map(d => `${d.name} → [${d.ids}]`).join(', ')));

  // ── 2. read ticket ──
  hdr('2. Read ticket (live)');
  const before = await readTicket();
  ok(`ticket read: ${before.TicketNo}`);

  const backupFile = `bss_live_backup_${TICKET.replace(/[^a-z0-9]+/gi, '_')}.json`;
  fs.writeFileSync(backupFile, JSON.stringify(before, null, 2));
  ok(`ORIGINAL saved to ${backupFile} (rollback ke liye sambhal ke rakho)`);

  hdr('2b. Which BSS fields does the read endpoint actually return?');
  const audit = F.bssReadAudit(before);
  audit.forEach(a => {
    if (a.found) ok(`${a.field.padEnd(18)} ← "${a.via}" = ${JSON.stringify(a.sample)}`);
    else         warn(`${a.field.padEnd(18)} NOT FOUND (aliases: ${(F.BSS_READ_ALIASES[a.field] || []).join(', ')})`);
  });

  const parsed = F.bssReadTicket(before, DD);
  if (parsed.ambiguous.length)
    parsed.ambiguous.forEach(a => warn(`"${a.name}" (${a.field}) master list me ${a.ids.length} baar hai → IDs ${a.ids.join(', ')}`));

  console.log('\n  Resolved current values:');
  F.BSS_CROSSWALK.forEach(f => {
    const v = parsed.values[f.key];
    const n = parsed.names[f.key];
    console.log(`    ${f.label.padEnd(20)} id=${String(v == null ? '—' : v).padEnd(8)} ${n ? '(' + n + ')' : ''}`);
  });

  if (DRY) { console.log('\n[DRY RUN] koi update nahi bheja gaya.'); return finish(); }

  // ── 3. baseline form ──
  // Har field ko individually test karenge. Baseline = current values; agar
  // koi required field resolve nahi hua to master list ka pehla option lete
  // hain (warna update reject hoga).
  hdr('3. Build baseline (current values)');
  const base = {};
  F.BSS_CROSSWALK.forEach(f => { if (parsed.values[f.key] != null) base[f.key] = parsed.values[f.key]; });
  if (parsed.values.timelineDate) base.timelineDate = String(parsed.values.timelineDate).slice(0, 10);

  const firstId = key => { const o = F.bssOptions(DD, key); return o.length ? Number(o[0].ID) : null; };
  ['subDisposition', 'disposition'].forEach(k => {
    if (base[k] == null) { base[k] = firstId(k); warn(`${k} current value resolve nahi hua — baseline me pehla option (${base[k]}) use kar rahe hain`); }
  });
  const bErr = F.bssValidate(base, DD, 1);
  if (bErr.filter(e => e.field !== 'updatedByUser').length)
    warn('baseline validation warnings: ' + bErr.map(e => e.field).join(', '));
  ok('baseline ready: ' + JSON.stringify(base));

  // ── 4. per-field update + verify ──
  hdr('4. Per-field update → read back → verify');
  console.log('  (har field alag se, taaki pata chale KAUNSA toota)\n');

  // Har field ke liye ek "alag" value chuno — current se different.
  function pickDifferent(key, current, parentVal) {
    const f = F.bssField(key);
    const opts = f.type === 'cascade' ? F.bssCascadeOptions(DD, key, parentVal) : F.bssOptions(DD, key);
    const cand = opts.filter(o => String(o.ID) !== String(current));
    return cand.length ? Number(cand[0].ID) : (opts.length ? Number(opts[0].ID) : null);
  }

  const results = [];
  for (const f of F.BSS_CROSSWALK) {
    const form = Object.assign({}, base);
    let testVal;

    if (f.type === 'text')      testVal = 'LIVETEST-' + Date.now().toString().slice(-6);
    else if (f.type === 'date') testVal = new Date(Date.now() + 7 * 864e5).toISOString().slice(0, 10);
    else if (f.type === 'cascade') {
      const pv = form[f.parent];
      testVal = pickDifferent(f.key, form[f.key], pv);
      if (testVal == null) { warn(`${f.label}: is parent ke andar koi option nahi — skip`); continue; }
    } else {
      testVal = pickDifferent(f.key, form[f.key]);
      if (testVal == null) { warn(`${f.label}: list khali — skip`); continue; }
    }

    form[f.key] = testVal;
    // cascade parent badla to children clear (warna invalid combo)
    F.BSS_CROSSWALK.filter(c => c.parent === f.key).forEach(c => {
      delete form[c.key];
      F.BSS_CROSSWALK.filter(g => g.parent === c.key).forEach(g => delete form[g.key]);
    });

    const vErr = F.bssValidate(form, DD, 1).filter(e => e.field !== 'updatedByUser');
    if (vErr.length) { bad(`${f.label}: local validation failed before sending`, JSON.stringify(vErr)); continue; }

    const payload = F.bssBuildPayload(form, TICKET, 0);
    delete payload.UpdatedByUser;   // server apne aap bharta hai

    const up = await proxy({ action: 'update', payload });
    if (!up.ok || up.body.error) {
      bad(`${f.label} (${f.payload}) update REJECTED`, (up.body.error || up.status) + '  sent=' + JSON.stringify(payload[f.payload]));
      results.push({ field: f.label, sent: testVal, ok: false, err: up.body.error });
      continue;
    }

    await sleep(700);                       // Marg ko commit hone do
    const after = await readTicket();
    const back = F.bssReadTicket(after, DD);

    let got, matched;
    if (f.type === 'text' || f.type === 'date') {
      got = back.values[f.key] == null ? null : String(back.values[f.key]).slice(0, f.type === 'date' ? 10 : 100);
      matched = got === String(testVal);
    } else {
      got = back.values[f.key];
      matched = String(got) === String(testVal);
    }

    if (matched) ok(`${f.label.padEnd(20)} → sent ${JSON.stringify(testVal)}, read back ${JSON.stringify(got)}`);
    else if (got == null) warn(`${f.label.padEnd(20)} → sent ${JSON.stringify(testVal)}, but read endpoint doesn't return this field (update may still be fine — BSS UI me check karo)`);
    else bad(`${f.label} MISMATCH`, `sent ${JSON.stringify(testVal)} (payload field "${f.payload}"), read back ${JSON.stringify(got)}`);

    results.push({ field: f.label, payloadField: f.payload, sent: testVal, got, ok: matched });
    base[f.key] = testVal;   // agla test isi state se
  }

  // ── 5. THE SWAP CHECK ──
  // Sabse mehenga bug: status aur category cross ho jayein. Dono ek saath set
  // karke padhte hain — agar cross hue to ye pakad lega.
  hdr('5. Disposition / Sub Disposition swap check (critical)');
  {
    const statusOpts = F.bssOptions(DD, 'subDisposition');
    const catOpts    = F.bssOptions(DD, 'disposition');
    const wantStatus = statusOpts.find(o => /in progress/i.test(o.Name)) || statusOpts[0];
    const wantCat    = catOpts.find(o => /^bug$/i.test(o.Name)) || catOpts[0];

    const form = Object.assign({}, base, { subDisposition: Number(wantStatus.ID), disposition: Number(wantCat.ID) });
    const payload = F.bssBuildPayload(form, TICKET, 0);
    delete payload.UpdatedByUser;

    console.log(`  sending Disposition=${payload.Disposition} ("${wantStatus.Name}")  SubDisposition=${payload.SubDisposition} ("${wantCat.Name}")`);
    const up = await proxy({ action: 'update', payload });
    if (!up.ok || up.body.error) bad('swap-check update rejected', up.body.error || up.status);
    else {
      await sleep(900);
      const after = await readTicket();
      const back = F.bssReadTicket(after, DD);
      const gotStatusName = back.names.subDisposition || after.Status || '';
      const gotCatName    = back.names.disposition || '';

      if (String(back.values.subDisposition) === String(wantStatus.ID) || new RegExp(wantStatus.Name, 'i').test(String(after.Status || '')))
        ok(`STATUS landed correctly → "${wantStatus.Name}" (read back: "${gotStatusName || after.Status}")`);
      else bad('STATUS did not land', `wanted "${wantStatus.Name}", read back "${gotStatusName || after.Status}"`);

      if (String(back.values.disposition) === String(wantCat.ID))
        ok(`CATEGORY landed correctly → "${wantCat.Name}" (read back: "${gotCatName}")`);
      else if (back.values.disposition == null)
        warn(`CATEGORY read-back not available — BSS UI me manually verify karo ki Disposition = "${wantCat.Name}" hai`);
      else bad('CATEGORY did not land', `wanted "${wantCat.Name}", read back "${gotCatName}"`);

      if (new RegExp(wantCat.Name, 'i').test(String(after.Status || '')))
        bad('SWAP DETECTED', `category "${wantCat.Name}" ticket ke STATUS me chala gaya — crosswalk ulta hai!`);
      else ok('no swap: category did not leak into status');
    }
  }

  // ── 6. server-side guards ──
  hdr('6. Server-side guards (live)');
  {
    let g = await proxy({ action: 'update', payload: { TicketNo: TICKET, Disposition: base.subDisposition } });
    (g.status === 400) ? ok('missing SubDisposition rejected (400)') : bad('missing SubDisposition not rejected', g.status);

    g = await proxy({ action: 'update', payload: { TicketNo: TICKET, Disposition: base.subDisposition, SubDisposition: base.disposition, Developer: 'abc' } });
    (g.status === 400) ? ok('non-numeric Developer rejected (400)') : bad('non-numeric id not rejected', g.status);

    g = await proxy({ action: 'update', payload: { TicketNo: TICKET, Disposition: base.subDisposition, SubDisposition: base.disposition, TimeLineDate: '29-06-2026' } });
    (g.status === 400) ? ok('DD-MM-YYYY date rejected (400)') : bad('bad date not rejected', g.status);

    g = await proxy({ action: 'ticket', ticketNo: 'MB - 000000000' });
    (g.status === 404) ? ok('unknown ticket → 404') : warn('unknown ticket returned ' + g.status);

    g = await proxy({ action: 'nonsense' });
    (g.status === 400) ? ok('unknown action → 400') : bad('unknown action not rejected', g.status);
  }

  // ── 7. restore ──
  hdr('7. RESTORE original values');
  if (NO_RESTORE) { warn('--no-restore diya gaya — ticket test values par CHHOD diya gaya hai!'); return finish(results); }

  const restore = {};
  F.BSS_CROSSWALK.forEach(f => { if (parsed.values[f.key] != null) restore[f.key] = parsed.values[f.key]; });
  if (parsed.values.timelineDate) restore.timelineDate = String(parsed.values.timelineDate).slice(0, 10);
  ['subDisposition', 'disposition'].forEach(k => { if (restore[k] == null) restore[k] = base[k]; });

  const rPayload = F.bssBuildPayload(restore, TICKET, 0);
  delete rPayload.UpdatedByUser;
  const rr = await proxy({ action: 'update', payload: rPayload });

  if (!rr.ok || rr.body.error) {
    bad('RESTORE FAILED', (rr.body.error || rr.status) + `\n         Original values ${backupFile} me hain — BSS UI se manually wapas set karo.`);
  } else {
    await sleep(900);
    const fin = await readTicket();
    const finP = F.bssReadTicket(fin, DD);
    let diffs = [];
    F.BSS_CROSSWALK.forEach(f => {
      const was = parsed.values[f.key], now = finP.values[f.key];
      if (was == null) return;
      if (String(was) !== String(now)) diffs.push(`${f.label}: was ${JSON.stringify(was)}, now ${JSON.stringify(now)}`);
    });
    if (!diffs.length) ok('ticket restored to its original values');
    else bad('RESTORE INCOMPLETE', diffs.join('\n         ') + `\n         Backup: ${backupFile}`);
  }

  finish(results);
})().catch(e => {
  console.error('\n\x1b[31mFATAL\x1b[0m', e.message || e);
  console.error('Agar update ho chuka tha to backup file se manually restore karo.');
  process.exit(1);
});

function finish(results) {
  console.log('\n' + '='.repeat(72));
  if (results && results.length) {
    console.log('PER-FIELD SUMMARY');
    results.forEach(r => console.log(`  ${r.ok ? '✅' : '❌'} ${String(r.field).padEnd(20)} ${r.payloadField || ''} sent=${JSON.stringify(r.sent)} got=${JSON.stringify(r.got)}${r.err ? ' err=' + r.err : ''}`));
    console.log('');
  }
  console.log(`RESULT: ${PASS.length} passed, ${FAIL.length} failed, ${WARN.length} warnings`);
  console.log('='.repeat(72));
  if (WARN.length) console.log('\nWARN ka matlab "toota" nahi — zyadatar "read endpoint ye field wapas nahi deta".\nUnhe BSS UI me ek baar aankh se verify kar lena.');
  process.exit(FAIL.length ? 1 : 0);
}
