// Vercel Serverless Function  →  POST /api/bss-proxy
// ---------------------------------------------------------------------------
// BSS Dashboard ka server-side gateway. Browser Marg ke bssapi ko SEEDHA call
// nahi kar sakta: CORS block karta hai, aur Marg ka Bearer token browser me
// expose ho jata (anon key ki tarah page source se nikal jata). Isliye saara
// traffic yahan se jata hai — bilkul api/client-info.js jaise.
//
// Actions:
//   dropdowns → BindDropDown (master lists). Server par cache, TTL neeche.
//   ticket    → ek ticket ki LIVE detail (modal kholte waqt — cache se nahi,
//               taaki user hamesha current value edit kare)
//   update    → UpdateTicketStatus (write). Validate + audit + cache patch.
//
// Vercel env vars (client-info.js jaise hi, reuse):
//   SUPABASE_SERVICE_KEY, MARG_LOGIN_EMAIL, MARG_LOGIN_PASSWORD
//   MARG_TOKEN (optional static fallback)
// ---------------------------------------------------------------------------

const SUPA_URL = process.env.SUPABASE_URL || 'https://xsxchyqhhyfvuxbofxna.supabase.co';
const ANON_KEY = process.env.SUPABASE_ANON_KEY ||
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InhzeGNoeXFoaHlmdnV4Ym9meG5hIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODE0MTMzNTAsImV4cCI6MjA5Njk4OTM1MH0.P4VYTv-fizFW7nknhP4h1BetBGJ6yLLD90lkUUYgt-4';
const SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;

const BSS_BASE   = process.env.MARG_BSS_BASE || 'https://bssapi.margcompusoft.com';
const DD_URL     = BSS_BASE + '/api/MBSupport/BindDropDown';
const UPDATE_URL = BSS_BASE + '/api/MBSupport/UpdateTicketStatus';
const DETAIL_URL = BSS_BASE + '/api/MargBook/GetMBTicketStatusDetail';

const LOGIN_API      = 'https://dbwork.margbooks.com/api/Auth/login';
const LOGIN_EMAIL    = process.env.MARG_LOGIN_EMAIL || '';
const LOGIN_PASSWORD = process.env.MARG_LOGIN_PASSWORD || '';
const STATIC_TOKEN   = process.env.MARG_TOKEN || '';
const MARG_ORIGIN    = process.env.MARG_ORIGIN || 'http://192.167.24.89:8086';

// Is page ka permission id (portal.html ke ALL_DASHBOARDS se match karta hai).
// Page access aur update permission JAANBUJHKAR same hai: jiske paas dashboard
// hai wo update kar sakta hai.
// BSS ab TAT dashboard ka tab hai, isliye permission `tat-bss` hai. Purani
// standalone id bhi maani jati hai — jinke paas pehle se `bss-dashboard` hai
// unka access na toote (aur /bss route abhi bhi chalta hai).
const DASH_IDS = ['tat-bss', 'bss-dashboard'];
const DASH_ID = DASH_IDS[0];

// BindDropDown master data roz nahi badalta. Har modal par fetch karna Marg par
// bekaar load hai, isliye warm lambda me cache. TTL chhota rakha hai taaki naya
// developer/agent add hone par 10 min me dikh jaye.
const DD_TTL_MS = 10 * 60 * 1000;
let _dd = { data: null, exp: 0 };
let _tok = { token: null, exp: 0 };

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/150.0.0.0 Safari/537.36';

// ── Supabase helper ────────────────────────────────────────────────────────
async function supa(path, { method = 'GET', token = SERVICE_KEY, key = SERVICE_KEY, body, prefer } = {}) {
  const headers = { apikey: key, Authorization: `Bearer ${token}` };
  if (body) headers['Content-Type'] = 'application/json';
  if (prefer) headers['Prefer'] = prefer;
  const res = await fetch(`${SUPA_URL}${path}`, {
    method, headers, body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let data; try { data = text ? JSON.parse(text) : null; } catch { data = text; }
  return { ok: res.ok, status: res.status, data };
}

// ── Marg auth (client-info.js ka same pattern) ─────────────────────────────
function findJwt(o) {
  if (!o) return null;
  if (typeof o === 'string') return o.split('.').length === 3 ? o : null;
  for (const k of Object.keys(o)) {
    const v = o[k];
    if (typeof v === 'string' && v.split('.').length === 3) return v;
    if (v && typeof v === 'object') { const f = findJwt(v); if (f) return f; }
  }
  return null;
}
function jwtExpMs(t) {
  try {
    const p = JSON.parse(Buffer.from(t.split('.')[1].replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString());
    return p.exp ? p.exp * 1000 : 0;
  } catch { return 0; }
}
async function margLogin() {
  const r = await fetch(LOGIN_API, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json', 'Accept': 'application/json, text/plain, */*',
      'Origin': MARG_ORIGIN, 'Referer': MARG_ORIGIN + '/', 'User-Agent': UA,
    },
    body: JSON.stringify({ email: LOGIN_EMAIL, password: LOGIN_PASSWORD, token: '', roleid: 0, permission: [], isotpauth: 0 }),
  });
  const text = await r.text();
  let data; try { data = JSON.parse(text); } catch { data = text; }
  if (!r.ok) throw new Error('Marg login failed (HTTP ' + r.status + ')');
  const tok = findJwt(data);
  if (!tok) throw new Error('No token found in the login response');
  return tok;
}
async function margToken(force) {
  if (LOGIN_EMAIL && LOGIN_PASSWORD) {
    const now = Date.now();
    if (!force && _tok.token && _tok.exp - 60000 > now) return _tok.token;
    const t = await margLogin();
    _tok = { token: t, exp: jwtExpMs(t) || (now + 10 * 60000) };
    return t;
  }
  if (STATIC_TOKEN) return STATIC_TOKEN;
  throw new Error('Server not configured: set MARG_LOGIN_EMAIL/PASSWORD (or MARG_TOKEN)');
}
async function callMarg(url, { method = 'POST', body, token } = {}) {
  const headers = {
    'Accept': 'application/json, text/plain, */*',
    'Origin': MARG_ORIGIN, 'Referer': MARG_ORIGIN + '/', 'User-Agent': UA,
  };
  if (token) headers['Authorization'] = `Bearer ${token}`;
  if (body) headers['Content-Type'] = 'application/json';
  const r = await fetch(url, { method, headers, body: body ? JSON.stringify(body) : undefined });
  const text = await r.text();
  let data; try { data = text ? JSON.parse(text) : null; } catch { data = text; }
  return { ok: r.ok, status: r.status, data };
}

// Marg ka "Status" hamesha HTTP code me nahi aata — 200 ke saath bhi
// {"Status":"Fail"} ho sakta hai. Dono check karna zaroori hai, warna
// failed update bhi success dikh jayega.
function margSucceeded(res) {
  if (!res.ok) return false;
  const d = res.data;
  if (d && typeof d === 'object' && typeof d.Status === 'string')
    return /success/i.test(d.Status);
  return true;
}
function margMessage(res) {
  const d = res.data;
  if (d && typeof d === 'object') return d.Message || d.message || JSON.stringify(d).slice(0, 300);
  return typeof d === 'string' ? d.slice(0, 300) : ('HTTP ' + res.status);
}

// ── Payload whitelist ──────────────────────────────────────────────────────
// assets/bss-fields.js ke crosswalk se match karta hai. Client jo bhejta hai
// usme se SIRF ye fields aage jaate hain — koi extra key Marg tak nahi pahunchti.
const NUM_FIELDS = ['Disposition', 'SubDisposition', 'BSSMainDisposition', 'BSSProblemType',
                    'BSSSubProblemType', 'AssignedTo', 'Developer', 'RM'];
const TXT_FIELDS = ['JiraID', 'Remarks', 'BSSComment', 'TimeLineDate'];

function sanitizePayload(raw) {
  const out = {}, errors = [];
  if (!raw || typeof raw !== 'object') return { out, errors: ['payload missing'] };

  const tn = String(raw.TicketNo || '').trim();
  if (!tn) errors.push('TicketNo missing');
  out.TicketNo = tn;

  for (const f of NUM_FIELDS) {
    const v = raw[f];
    if (v === undefined || v === null || v === '') continue;
    if (!/^\d+$/.test(String(v))) { errors.push(`${f} must be a numeric id`); continue; }
    out[f] = Number(v);
  }
  for (const f of TXT_FIELDS) {
    const v = raw[f];
    if (v === undefined || v === null || v === '') continue;
    const sv = String(v).trim();
    if (!sv) continue;                       // whitespace-only = omit, not blank-out
    if (f === 'TimeLineDate') {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(sv)) { errors.push('TimeLineDate must be YYYY-MM-DD'); continue; }
      // Format sahi hone ka matlab date exist karna nahi (2026-02-30 / 2026-13-01)
      const pp = sv.split('-').map(Number);
      const dt = new Date(Date.UTC(pp[0], pp[1] - 1, pp[2]));
      if (dt.getUTCFullYear() !== pp[0] || dt.getUTCMonth() !== pp[1] - 1 || dt.getUTCDate() !== pp[2]) {
        errors.push('TimeLineDate is not a real calendar date'); continue;
      }
    }
    out[f] = sv.slice(0, 2000);
  }
  // Dono required — inke bina BSS ticket ko half-updated chhod sakta hai
  if (out.Disposition === undefined)    errors.push('Disposition (Sub Disposition) required');
  if (out.SubDisposition === undefined) errors.push('SubDisposition (Disposition) required');

  return { out, errors };
}

// cachePatch me client jo bheje wo SEEDHA cache record par apply hota tha.
// Do problem: (1) koi bhi arbitrary key ticket record me ghusa sakta tha,
// (2) `__proto__` jaisi key Object.assign ke [[Set]] se prototype tak pahunch
// sakti thi. Isliye sirf wahi keys allow hain jo parser bhi produce karta hai.
// `st`/`ld` jaise text fields ke alawa STAGE DATES bhi patch hoti hain. Iske
// bina update ke baad BSS ke KPI to move ho jate the (wo `st` padhte hain) par
// TAT dashboard ke KPI wahin atke rehte the — wo stage dates par chalte hain
// (a/b/c/rtd/uad/e/d). Reload par bhi purana hi dikhta tha, kyunki cache me
// dates purani rehti thi. `sc` bhi shamil hai taaki short-code stale na rahe.
const CACHE_PATCH_KEYS = new Set(['st', 'ld', 'mainDisp', 'probType', 'subDisp',
                                  'assignto', 'dev', 'r', 'tld', 'jira',
                                  'sc', 'a', 'b', 'c', 'd', 'e', 'cld',
                                  'rtd', 'crd', 'mgd', 'uad', 'rfd', 'rod', 'fdd', 'rjd']);

function sanitizeCachePatch(raw) {
  const out = {};
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return out;
  for (const k of Object.keys(raw)) {
    if (!CACHE_PATCH_KEYS.has(k)) continue;            // unknown key → drop
    if (k === '__proto__' || k === 'constructor' || k === 'prototype') continue;
    const v = raw[k];
    if (v === undefined || v === null || v === '') continue;
    if (typeof v !== 'string' && typeof v !== 'number') continue;  // no objects
    out[k] = String(v).slice(0, 500);
  }
  return out;
}

// ── ticket_cache patch ─────────────────────────────────────────────────────
// Update ke baad cache purana ho jata hai. Poori row rewrite karne ki jagah
// SIRF us ek ticket ka object patch karte hain — isse concurrent updates ka
// nuksaan kam rehta hai aur /api/ticket-cache ke guards bhi bypass nahi hote
// (ye service key se seedha likhta hai, wahi nightly job karta hai).
// Best-effort: fail ho to update ko fail nahi karte, sirf flag lautate hain.
async function patchCache(ticketNo, patch) {
  try {
    const rows = await supa('/rest/v1/ticket_cache?select=id,date_from,data');
    if (!rows.ok || !Array.isArray(rows.data)) return { patched: false, reason: 'cache read failed' };

    for (const row of rows.data) {
      if (!Array.isArray(row.data)) continue;
      const ix = row.data.findIndex(t => t && t.n === ticketNo);
      if (ix < 0) continue;

      const next = row.data.slice();
      /* Object.assign ki jagah explicit loop — assign [[Set]] use karta hai,
         jisse `__proto__` jaisi key prototype tak pahunch sakti thi. Keys
         waise bhi sanitizeCachePatch se hoke aati hain, ye second layer hai. */
      const merged = {};
      for (const k of Object.keys(next[ix] || {})) merged[k] = next[ix][k];
      for (const k of Object.keys(patch)) {
        if (k === '__proto__' || k === 'constructor' || k === 'prototype') continue;
        Object.defineProperty(merged, k, { value: patch[k], enumerable: true, writable: true, configurable: true });
      }
      next[ix] = merged;
      const up = await supa(`/rest/v1/ticket_cache?id=eq.${row.id}`, {
        method: 'PATCH', prefer: 'return=minimal', body: { data: next },
      });
      return { patched: up.ok, row: row.date_from, reason: up.ok ? null : 'write failed' };
    }
    return { patched: false, reason: 'ticket not in cache' };
  } catch (e) {
    return { patched: false, reason: String(e.message || e) };
  }
}

// ── Audit ──────────────────────────────────────────────────────────────────
// Ye production tickets badalta hai, isliye har update ka record rehna chahiye.
// Table na ho to update fail nahi karte (best-effort), sirf flag lautate hain.
async function audit(entry) {
  try {
    const r = await supa('/rest/v1/bss_update_log', {
      method: 'POST', prefer: 'return=minimal', body: entry,
    });
    return r.ok;
  } catch { return false; }
}

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  if (!SERVICE_KEY) return res.status(500).json({ error: 'Server not configured: SUPABASE_SERVICE_KEY missing' });

  // 1) Caller verify
  const auth = req.headers.authorization || '';
  const token = auth.replace(/^Bearer\s+/i, '').trim();
  if (!token) return res.status(401).json({ error: 'Missing auth token' });

  const me = await supa('/auth/v1/user', { token, key: ANON_KEY });
  if (!me.ok || !me.data || !me.data.id) return res.status(401).json({ error: 'Invalid session' });

  // Profile read. `bss_user_id` column tabhi hota hai jab
  // sql/2026-08-bss-dashboard.sql chal chuki ho. Na ho to PostgREST poori
  // query fail kar deta hai — pehle wo "No profile" 403 ban jata tha, jo
  // bilkul misleading tha (asli wajah: migration nahi chali).
  // Ab: column ke bina bhi READ-ONLY dashboard chalna chahiye; sirf update
  // block ho, saaf message ke saath.
  let prof = await supa(`/rest/v1/users?id=eq.${me.data.id}&select=role,dashboards,bss_user_id,name,email`);
  let migrationMissing = false;

  if (!prof.ok) {
    const msg = JSON.stringify(prof.data || '');
    if (/bss_user_id/.test(msg)) {
      migrationMissing = true;
      prof = await supa(`/rest/v1/users?id=eq.${me.data.id}&select=role,dashboards,name,email`);
    }
    if (!prof.ok)
      return res.status(500).json({
        error: 'Profile read failed: ' + (prof.data && (prof.data.message || prof.data.hint) || ('HTTP ' + prof.status)),
      });
  }

  const p = Array.isArray(prof.data) ? prof.data[0] : null;
  if (!p)
    return res.status(403).json({
      error: 'Your profile was not found in the public.users table (the auth account exists). ' +
             'Ask an admin to create your user record.',
    });
  if (migrationMissing) p.bss_user_id = null;

  const allowed = p.role === 'admin' ||
    (Array.isArray(p.dashboards) && DASH_IDS.some(id => p.dashboards.includes(id)));
  if (!allowed)
    return res.status(403).json({
      error: `You do not have access to the BSS Update tab. Ask an admin to tick "BSS Update (TAT)" in Admin → Users.`,
      role: p.role || null,
      dashboards: Array.isArray(p.dashboards) ? p.dashboards : [],
    });

  let body = req.body;
  if (typeof body === 'string') { try { body = JSON.parse(body); } catch { body = {}; } }
  const action = (body && body.action) || '';

  try {
    // ── dropdowns ──────────────────────────────────────────────────────────
    if (action === 'dropdowns') {
      const now = Date.now();
      if (_dd.data && _dd.exp > now && !body.force)
        return res.status(200).json({ ok: true, cached: true, dropdowns: _dd.data });

      const r = await callMarg(DD_URL, { method: 'GET' });
      if (!margSucceeded(r))
        return res.status(502).json({ error: 'BindDropDown failed: ' + margMessage(r) });

      const d = (r.data && r.data.Details) ? r.data.Details : r.data;
      _dd = { data: d, exp: now + DD_TTL_MS };
      return res.status(200).json({ ok: true, cached: false, dropdowns: d });
    }

    // ── ticket (live single-ticket detail) ─────────────────────────────────
    // Modal cache se nahi, LIVE data se bharta hai. Do wajah: (1) cache me
    // kuch BSS fields (JiraID, Sub-Problem Type) hain hi nahi, (2) cache
    // nightly hai — user purani value edit karke overwrite kar sakta tha.
    if (action === 'ticket') {
      const tn = String(body.ticketNo || '').trim();
      if (!tn) return res.status(400).json({ error: 'ticketNo required' });

      const from = /^\d{4}-\d{2}-\d{2}$/.test(String(body.from || '')) ? body.from : '2023-04-01';
      const to   = /^\d{4}-\d{2}-\d{2}$/.test(String(body.to || '')) ? body.to
                 : new Date().toISOString().split('T')[0];

      const url = `${DETAIL_URL}?FDate=${from}&ToDate=${to}&TicketNo=${encodeURIComponent(tn)}`;
      const r = await callMarg(url, { method: 'GET' });
      if (!margSucceeded(r))
        return res.status(502).json({ error: 'Ticket detail failed: ' + margMessage(r) });

      const list = (r.data && r.data.Details) || [];
      const rec = list.find(x => String(x.TicketNo).trim() === tn) || list[0] || null;
      if (!rec) return res.status(404).json({ error: `Ticket ${tn} was not found between ${from} and ${to}` });

      return res.status(200).json({ ok: true, ticket: rec });
    }

    // ── cachepatch (resync ke baad fresh values cache me likho) ────────────
    // Update ke turant baad client us ticket ko Marg se dobara padhta hai
    // (action:'ticket') aur parse karke stage dates nikalta hai. Wo dates
    // yahan bheji jati hain, warna cache me purani dates rehti aur page
    // reload par stage phir peeche chala jata. Auth/permission check upar
    // ho chuka hai — ye wahi patchCache use karta hai jo update karta hai,
    // aur sanitizeCachePatch ki whitelist se guzarta hai.
    if (action === 'cachepatch') {
      const tn = String(body.ticketNo || '').trim();
      if (!tn) return res.status(400).json({ error: 'ticketNo required' });
      const cp = sanitizeCachePatch(body.patch);
      if (!Object.keys(cp).length)
        return res.status(200).json({ ok: true, cache: { patched: false, reason: 'nothing to patch after sanitising' } });
      const cache = await patchCache(tn, cp);
      return res.status(200).json({ ok: true, ticketNo: tn, cache });
    }

    // ── update ─────────────────────────────────────────────────────────────
    if (action === 'update') {
      if (migrationMissing)
        return res.status(500).json({
          error: 'Database migration pending: the users.bss_user_id column is missing. ' +
                 'Run sql/2026-08-bss-dashboard.sql in the Supabase SQL Editor, then updates will work.',
        });
      if (!p.bss_user_id)
        return res.status(400).json({
          error: 'Your account has no BSS User ID mapped. Ask an admin to set it in Admin → Users. ' +
                 'Without it the update cannot be attributed in the audit log.',
        });

      const { out, errors } = sanitizePayload(body.payload);
      if (errors.length) return res.status(400).json({ error: 'Invalid payload: ' + errors.join('; '), details: errors });

      // UpdatedByUser SERVER par set hota hai — client jo bheje ignore.
      // Warna koi bhi kisi aur ke naam par update kar sakta tha.
      out.UpdatedByUser = Number(p.bss_user_id);

      const tok = await margToken(false);
      let r = await callMarg(UPDATE_URL, { body: out, token: tok });
      if (r.status === 401 || r.status === 403) {
        const t2 = await margToken(true);          // token expire — ek retry
        r = await callMarg(UPDATE_URL, { body: out, token: t2 });
      }

      const okUpdate = margSucceeded(r);

      await audit({
        ticket_no:   out.TicketNo,
        actor_id:    me.data.id,
        actor_name:  p.name || p.email || null,
        bss_user_id: out.UpdatedByUser,
        payload:     out,
        before:      body.before || null,
        success:     okUpdate,
        message:     okUpdate ? null : margMessage(r),
      });

      if (!okUpdate)
        return res.status(502).json({ error: 'Update failed: ' + margMessage(r), marg: r.data });

      let cache = { patched: false, reason: 'not requested' };
      if (body.cachePatch && typeof body.cachePatch === 'object') {
        const cp = sanitizeCachePatch(body.cachePatch);
        cache = Object.keys(cp).length
          ? await patchCache(out.TicketNo, cp)
          : { patched: false, reason: 'nothing to patch after sanitising' };
      }

      return res.status(200).json({ ok: true, ticketNo: out.TicketNo, sent: out, marg: r.data, cache });
    }

    return res.status(400).json({ error: 'Unknown action: ' + action });
  } catch (e) {
    return res.status(500).json({ error: String(e.message || e) });
  }
};
