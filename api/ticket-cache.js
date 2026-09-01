// Vercel Serverless Function  →  POST /api/ticket-cache
// ---------------------------------------------------------------------------
// ticket_cache ka EK-HI validating writer (browser side ke liye).
//
// KYUN: pehle teen dashboards anon key se seedha ticket_cache me delete+insert
// karte the, har ek apne adhoore field set ke saath. Jo page se Refresh hota,
// wo baaki pages ke fields cache se uda deta:
//   TAT par Refresh     → Support ka Agent-wise table khali (tia gaya)
//   Support par Refresh → TAT ke Bug/Dev columns "Others", RfT/UAT TAT 0% (ld/rtt gaye)
// Ab saare dashboards assets/ticket-parser.js ka superset parser use karte hain
// AUR yahan se likhte hain, jahan payload accept karne se pehle validate hota hai.
// Iske saath ticket_cache par RLS anon ko read-only kar deta hai
// (sql/2026-08-ticket-cache-hardening.sql — existing DB ke liye; naye env me
// setup.sql se hi aa jata hai),
// isliye koi future code galti se bypass nahi kar sakta.
//
// Validation (koi bhi fail → 400, cache waisa hi rehta hai):
//   1. schema_version server ke REQUIRED_SCHEMA se match kare
//   2. data non-empty array ho, records me ticket no (n) ho
//   3. REQUIRED_FIELDS me se koi bhi field >0 se 0 par na gire (regression guard)
//   4. total ticket count purani row se 50% se zyada na gire (adhoori fetch guard)
//
// Vercel env vars: SUPABASE_SERVICE_KEY (already set), SUPABASE_URL (optional)
// ---------------------------------------------------------------------------

const zlib = require('zlib');

const SUPA_URL = process.env.SUPABASE_URL || 'https://xsxchyqhhyfvuxbofxna.supabase.co';
const ANON_KEY = process.env.SUPABASE_ANON_KEY ||
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InhzeGNoeXFoaHlmdnV4Ym9meG5hIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODE0MTMzNTAsImV4cCI6MjA5Njk4OTM1MH0.P4VYTv-fizFW7nknhP4h1BetBGJ6yLLD90lkUUYgt-4';
const SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;

// assets/ticket-parser.js ke MB_SCHEMA_VERSION / MB_REQUIRED_FIELDS ke saath
// in sync rakhna zaroori hai.
const REQUIRED_SCHEMA  = 3;
const REQUIRED_FIELDS  = ['tia', 'ld', 'rtd', 'st'];
const MIN_COUNT_RATIO  = 0.5;    // naya count purane ka kam se kam 50%
const MAX_ROWS         = 200000; // sanity upper bound
// Decompressed payload ka hard cap (compression-bomb guard). ~1.4KB/ticket par
// 64MB ≈ 45k tickets — aaraam se kaafi, aur memory safe.
const MAX_JSON_BYTES   = 64 * 1024 * 1024;

const WRITERS = new Set(['marg-dashboard', 'support-dashboard', 'api-dashboard', 'nightly']);

async function sb(path, { method = 'GET', token = SERVICE_KEY, key = SERVICE_KEY, body, prefer } = {}) {
  const headers = { apikey: key, Authorization: `Bearer ${token}` };
  if (body)   headers['Content-Type'] = 'application/json';
  if (prefer) headers['Prefer'] = prefer;
  const res  = await fetch(`${SUPA_URL}${path}`, {
    method, headers, body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let data;
  try { data = text ? JSON.parse(text) : null; } catch { data = text; }
  return { ok: res.ok, status: res.status, data };
}

// Har required field kitne records me maujood hai — chhota summary jo row ke
// saath store hota hai, taaki agli baar bina poora payload padhe compare ho sake.
function fieldCounts(rows) {
  const out = { total: rows.length };
  for (const f of REQUIRED_FIELDS) out[f] = 0;
  for (const r of rows) {
    for (const f of REQUIRED_FIELDS) {
      if (r[f] !== undefined && r[f] !== null && r[f] !== '') out[f]++;
    }
  }
  return out;
}

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  if (!SERVICE_KEY) return res.status(500).json({ error: 'Server not configured: SUPABASE_SERVICE_KEY missing' });

  // 1) Caller verify — dashboard kholne wala hi refresh kar sakta hai
  const auth  = req.headers.authorization || '';
  const token = auth.replace(/^Bearer\s+/i, '').trim();
  if (!token) return res.status(401).json({ error: 'Missing auth token' });

  const me = await sb('/auth/v1/user', { token, key: ANON_KEY });
  if (!me.ok || !me.data || !me.data.id) return res.status(401).json({ error: 'Invalid session' });

  const prof = await sb(`/rest/v1/users?id=eq.${me.data.id}&select=role,dashboards`);
  const p = Array.isArray(prof.data) ? prof.data[0] : null;
  if (!p) return res.status(403).json({ error: 'No profile — access denied' });
  const allowed = p.role === 'admin' || (Array.isArray(p.dashboards) && p.dashboards.length > 0);
  if (!allowed) return res.status(403).json({ error: 'No dashboard access' });

  // 2) Body
  let body = req.body;
  if (typeof body === 'string') { try { body = JSON.parse(body); } catch { body = {}; } }
  const { writer, date_from, date_to, schema_version, gz, count } = body || {};
  let { data } = body || {};

  // GZIP PAYLOAD — Vercel ka request-body limit ~4.5MB hai aur ek parsed
  // ticket ≈1.4KB JSON, to ~3,300 tickets ke baad raw POST fail hone lagta
  // tha (ek saal ka data usse zyada hota hai). Browser ab `gz` bhejta hai:
  // base64(gzip(JSON.stringify(data))) — measured ~21x chhota.
  // Purane browsers (CompressionStream nahi) `data` bhejte hain, wo bhi chalega.
  if (gz !== undefined) {
    if (data !== undefined)
      return res.status(400).json({ error: 'Send either gz or data, not both' });
    if (typeof gz !== 'string' || !gz)
      return res.status(400).json({ error: 'gz must be a non-empty base64 string' });

    let buf;
    try { buf = Buffer.from(gz, 'base64'); }
    catch { return res.status(400).json({ error: 'gz is not valid base64' }); }

    // Decompressed size cap — compression bomb se bachne ke liye.
    let json;
    try {
      json = zlib.gunzipSync(buf, { maxOutputLength: MAX_JSON_BYTES }).toString('utf8');
    } catch (e) {
      return res.status(400).json({
        error: 'gz decompress failed (corrupt, or decompressed size > ' +
               Math.round(MAX_JSON_BYTES / 1024 / 1024) + 'MB): ' + e.message,
      });
    }

    try { data = JSON.parse(json); }
    catch { return res.status(400).json({ error: 'gz decompressed to invalid JSON' }); }

    // Client ne jo count claim kiya tha wahi mila? (truncated upload catch)
    if (count !== undefined && Array.isArray(data) && data.length !== count)
      return res.status(400).json({
        error: `Payload truncated — the client sent ${count} records but ${data.length} arrived. Please retry the refresh.`,
      });
  }

  if (!WRITERS.has(writer))
    return res.status(400).json({ error: 'Unknown writer: ' + writer });
  if (schema_version !== REQUIRED_SCHEMA)
    return res.status(400).json({
      error: `Schema mismatch — payload v${schema_version}, server needs v${REQUIRED_SCHEMA}. ` +
             `The page is running old cached JS; hard-refresh (Ctrl+Shift+R) and try again.`
    });
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(date_from || '')))
    return res.status(400).json({ error: 'Invalid date_from (YYYY-MM-DD required)' });
  if (date_to && !/^\d{4}-\d{2}-\d{2}$/.test(String(date_to)))
    return res.status(400).json({ error: 'Invalid date_to (YYYY-MM-DD required)' });
  if (!Array.isArray(data) || !data.length)
    return res.status(400).json({ error: 'Empty payload rejected — cache unchanged' });
  if (data.length > MAX_ROWS)
    return res.status(400).json({ error: `Payload too large (${data.length} rows)` });
  if (!data.every(r => r && r.n))
    return res.status(400).json({ error: 'Some records have no ticket number (n) — rejected' });

  const counts = fieldCounts(data);

  // 3) Regression guard — purani row ka summary uthao (sirf counts, poora data nahi)
  const prev = await sb(`/rest/v1/ticket_cache?date_from=eq.${date_from}&select=field_counts,total_count,schema_version`);
  const old  = Array.isArray(prev.data) ? prev.data[0] : null;

  if (old) {
    const oldCounts = old.field_counts || {};
    const lost = REQUIRED_FIELDS.filter(f => (oldCounts[f] || 0) > 0 && counts[f] === 0);
    if (lost.length) {
      return res.status(400).json({
        error: `Incomplete payload rejected — these fields exist in the cache but not in the payload: ${lost.join(', ')}. ` +
               `The cache is safe, nothing was overwritten.`,
        lostFields: lost, oldCounts, newCounts: counts
      });
    }
    const oldTotal = old.total_count || oldCounts.total || 0;
    if (oldTotal > 0 && data.length < oldTotal * MIN_COUNT_RATIO) {
      return res.status(400).json({
        error: `Ticket count dropped from ${oldTotal} to ${data.length} (>50% drop) — ` +
               `this looks like an incomplete fetch, cache unchanged. Try Refresh again.`,
        oldTotal, newTotal: data.length
      });
    }
  }

  // 4) Atomic upsert — date_from par unique constraint
  //    (sql/2026-08-ticket-cache-hardening.sql ya setup.sql se).
  //    delete+insert wala purana tarika beech me ek window chhodta tha jisme
  //    row missing hoti thi; insert fail ho jaata to data poora gayab.
  const up = await sb('/rest/v1/ticket_cache?on_conflict=date_from', {
    method: 'POST',
    prefer: 'resolution=merge-duplicates,return=minimal',
    body: {
      data,
      total_count:    data.length,
      date_from,
      date_to:        date_to || date_from,
      fetched_at:     new Date().toISOString(),
      schema_version: REQUIRED_SCHEMA,
      field_counts:   counts,
      writer,
    },
  });
  if (!up.ok) {
    const msg = (up.data && (up.data.message || up.data.error || up.data.hint)) || `HTTP ${up.status}`;
    return res.status(502).json({ error: 'Cache write failed: ' + msg });
  }

  return res.status(200).json({ ok: true, date_from, count: data.length, field_counts: counts });
};
