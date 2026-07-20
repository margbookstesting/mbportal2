// Vercel Serverless Function  →  POST /api/client-info
// ---------------------------------------------------------------------------
// "Get Client Info" module ke saare actions ka proxy. Browser se Marg internal
// APIs ko direct call nahi kar sakte (CORS + internal origin + token). Ye proxy:
//   (1) Supabase caller verify (admin ya 'admin-activity' permission)
//   (2) Marg me KHUD login karke fresh Bearer token leta hai (cache + auto-refresh)
//   (3) request me diye 'action' ke hisaab se sahi Marg endpoint + body forward karta hai
//
// Vercel env vars (client-move.js jaise hi, reuse):
//   SUPABASE_SERVICE_KEY, MARG_LOGIN_EMAIL, MARG_LOGIN_PASSWORD
//   MARG_USER_EMAIL   (optional) operator email (useremailid); default = login email
//   MARG_ORIGIN       (optional) default 'http://192.167.24.89:8086'
//   MARG_OTHER_KEY    (optional) getpwd/details key; default '74287637'
//   MARG_ITEM_KEY     (optional) ItemStockCorrection key; default '74287673'
//   MARG_TOKEN        (optional fallback static token)
// ---------------------------------------------------------------------------

const SUPA_URL = process.env.SUPABASE_URL || 'https://xsxchyqhhyfvuxbofxna.supabase.co';
const ANON_KEY = process.env.SUPABASE_ANON_KEY ||
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InhzeGNoeXFoaHlmdnV4Ym9meG5hIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODE0MTMzNTAsImV4cCI6MjA5Njk4OTM1MH0.P4VYTv-fizFW7nknhP4h1BetBGJ6yLLD90lkUUYgt-4';
const SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;

const LOGIN_API      = 'https://dbwork.margbooks.com/api/Auth/login';
const LOGIN_EMAIL    = process.env.MARG_LOGIN_EMAIL || '';
const LOGIN_PASSWORD = process.env.MARG_LOGIN_PASSWORD || '';
const STATIC_TOKEN   = process.env.MARG_TOKEN || '';
const OPERATOR       = process.env.MARG_USER_EMAIL || LOGIN_EMAIL || '';
const MARG_ORIGIN    = process.env.MARG_ORIGIN || 'http://192.167.24.89:8086';
const KEY_OTHER      = process.env.MARG_OTHER_KEY || '74287637';
const KEY_ITEM       = process.env.MARG_ITEM_KEY  || '74287673';

const DBWORK = 'https://dbwork.margbooks.com';
const GW     = 'https://gateway6.margbooks.com/v4.2';

// Legacy license API (query-param + static key, no Bearer token).
// Used for Change Email / Change Mobile.
const LICENSE_BASE       = process.env.MARG_LICENSE_BASE       || 'https://license.margbooks.com';
const KEY_LICENSE_CHANGE = process.env.MARG_LICENSE_CHANGE_KEY || '!2645^5$ret$38^rt';
// Marg legacy API is strict about URL encoding — it rejects the raw '!' that
// encodeURIComponent leaves unencoded per RFC 3986. Pre-encode the key once
// with an RFC 3986-strict transform (also handles '() * for completeness).
const KEY_LICENSE_CHANGE_ENC = encodeURIComponent(KEY_LICENSE_CHANGE)
  .replace(/!/g,  '%21')
  .replace(/'/g,  '%27')
  .replace(/\(/g, '%28')
  .replace(/\)/g, '%29')
  .replace(/\*/g, '%2A');

// URL-encode a plain object into a query-string
function qs(obj){
  return Object.entries(obj)
    .filter(([_,v]) => v !== undefined && v !== null)
    .map(([k,v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`)
    .join('&');
}

// ── Marg endpoint + body builder per action ────────────────────────────────
// commonreports helper
function cr(p, type, actiontype, extra) {
  return {
    url: `${DBWORK}/api/Other/commonreports`,
    body: Object.assign({
      dbinfolinkid: p.dbinfolinkid,
      type, actiontype,
      emailid: '',
      userlinkid: p.userlinkid,
      remark: '',
    }, extra || {}),
  };
}

const ACTIONS = {
  // Main details fetch (returns full record incl. pwd)
  getDetails: p => ({ url: `${DBWORK}/api/Other/getpwd`, body: { emailid: p.emailid, key: KEY_OTHER, source: 0, useremailid: OPERATOR } }),

  // Quick actions
  viewPwd2:        p => cr(p, 5, 0),
  resetPwd:        p => cr(p, 5, 1, { remark: String(p.remark || '') }),
  viewTransaction: p => cr(p, 202, 0),
  viewCompanyList: p => cr(p, 100, 0),
  viewDataBss:     p => cr(p, 301, 0, { emailid: p.emailid || '' }),
  syncToBI:        p => ({ url: `${DBWORK}/biDataSync/syncallusersid`, body: { userlinkid: p.userlinkid, licenceno: String(p.licenceno || '') } }),
  activate:        p => ({ url: `${DBWORK}/api/DataBaseActivity/AccountActive`, body: { dbinfolinkid: p.dbinfolinkid, userlinkid: p.userlinkid, type: 2, useremailid: OPERATOR } }),
  deactivate:      p => ({ url: `${DBWORK}/api/DataBaseActivity/AccountActive`, body: { dbinfolinkid: p.dbinfolinkid, userlinkid: p.userlinkid, type: 3, useremailid: OPERATOR } }),

  // Legacy license API — GET-style with query params + static key (not Bearer).
  // Key is inlined (already strictly encoded) to bypass qs()'s Node-default
  // encodeURIComponent which would leave '!' unencoded — Marg rejects raw '!'.
  changeEmail:  p => ({
    url: `${LICENSE_BASE}/MargBookBSS/changeEmailID?key=${KEY_LICENSE_CHANGE_ENC}&` + qs({
      oldEmailId:   p.oldEmail  || p.emailid || '',
      newEmailID:   p.newEmail  || '',
      dbInfolinkid: p.dbinfolinkid || '',
    }),
    legacy: true,
  }),
  changeMobile: p => ({
    url: `${LICENSE_BASE}/MargBookBSS/changeMobileNo?key=${KEY_LICENSE_CHANGE_ENC}&` + qs({
      oldPhoneNo:   p.oldMobile || '',
      newPhoneNo:   p.newMobile || '',
      EmailId:      p.emailid   || '',
      dbInfolinkid: p.dbinfolinkid || '',
    }),
    legacy: true,
  }),

  // Domain list for Client Move screen — takes countrylinkid and returns
  // the current active domains for that country. Note Marg's typo in URL:
  // "getdomianlist" (not "getdomainlist"). POST with { countrylinkid }.
  getDomainList: p => ({
    url: `${DBWORK}/api/Other/getdomianlist`,
    body: { countrylinkid: Number(p.countrylinkid) || 0 },
  }),

  // Database operations
  repairMobileDb:     p => ({ url: `${GW}/LoginUser/AlterDatabaseMobile`, body: { dbinfolinkid: p.dbinfolinkid, type: 3 } }),
  repairWebDb:        p => ({ url: `${GW}/LoginUser/AlterDatabaseMobile`, body: { dbinfolinkid: p.dbinfolinkid, type: 2 } }),
  alterIndex:         p => ({ url: `${GW}/LoginUser/AlterIndex`, body: { dbinfolinkid: p.dbinfolinkid, type: 0, remark: 'MargBooksAdmin:' + OPERATOR } }),
  healthProc:         p => cr(p, 1, 0),
  itemDataCorrection: p => ({ url: `${DBWORK}/api/Other/ItemStockCorrection`, body: { key: KEY_ITEM, dbinfolinkid: p.dbinfolinkid, usertype: 0 } }),
  ledgerBalance:      p => cr(p, 4, 0),
  acctTxnMismatch:    p => cr(p, 201, 0),
  stockMismatch:      p => cr(p, 103, 0),
  itemTxnMismatch:    p => cr(p, 101, 0),
  mrpRevert:          p => cr(p, 7, 0),
  dbLockRemove:       p => cr(p, 3, 0),
  exeSyncRemove:      p => cr(p, 304, 0),
  referralHistory:    p => cr(p, 302, 0),
  removeCaching:      p => cr(p, 303, 0),
  migrationLogin:     p => cr(p, 6, 0),
  companyDelete:      p => ({ url: `${DBWORK}/api/MBAdmin/CompanyDeleteByCompID`, body: { dbinfolinkid: p.dbinfolinkid, emailID: p.emailid, userEmailID: OPERATOR } }),
};

// actions that need a loaded record's dbinfolinkid/userlinkid
const NEEDS_RECORD = new Set(Object.keys(ACTIONS).filter(a => a !== 'getDetails' && a !== 'getDomainList'));

// ── token cache (warm instance) ─────────────────────────────────────────────
let _cache = { token: '', exp: 0 };

async function supa(path, { token = SERVICE_KEY, key = SERVICE_KEY } = {}) {
  const res = await fetch(`${SUPA_URL}${path}`, { headers: { apikey: key, Authorization: `Bearer ${token}` } });
  const text = await res.text();
  let data; try { data = text ? JSON.parse(text) : null; } catch { data = text; }
  return { ok: res.ok, status: res.status, data };
}

function findJwt(v) {
  if (typeof v === 'string') return /^eyJ[\w-]+\.[\w-]+\.[\w-]+$/.test(v) ? v : null;
  if (v && typeof v === 'object') { for (const k of Object.keys(v)) { const f = findJwt(v[k]); if (f) return f; } }
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
      'Content-Type': 'application/json',
      'Accept': 'application/json, text/plain, */*',
      'Origin': MARG_ORIGIN, 'Referer': MARG_ORIGIN + '/',
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/150.0.0.0 Safari/537.36',
    },
    body: JSON.stringify({ email: LOGIN_EMAIL, password: LOGIN_PASSWORD, token: '', roleid: 0, permission: [], isotpauth: 0 }),
  });
  const text = await r.text();
  let data; try { data = JSON.parse(text); } catch { data = text; }
  if (!r.ok) throw new Error('Marg login failed (HTTP ' + r.status + ')');
  const tok = findJwt(data);
  if (!tok) throw new Error('Login response me token nahi mila');
  return tok;
}
async function getMargToken(force) {
  if (LOGIN_EMAIL && LOGIN_PASSWORD) {
    const now = Date.now();
    if (!force && _cache.token && _cache.exp - 60000 > now) return _cache.token;
    const tok = await margLogin();
    _cache = { token: tok, exp: jwtExpMs(tok) || (now + 10 * 60000) };
    return tok;
  }
  if (STATIC_TOKEN) return STATIC_TOKEN;
  throw new Error('Server not configured: MARG_LOGIN_EMAIL/PASSWORD (ya MARG_TOKEN) set karo');
}

async function callMarg(token, url, body) {
  const r = await fetch(url, {
    method: 'POST',
    headers: {
      'Accept': 'application/json, text/plain, */*',
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${token}`,
      'Origin': MARG_ORIGIN, 'Referer': MARG_ORIGIN + '/',
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/150.0.0.0 Safari/537.36',
    },
    body: JSON.stringify(body),
  });
  const text = await r.text();
  let data; try { data = text ? JSON.parse(text) : text; } catch { data = text; }
  return { status: r.status, ok: r.ok, data };
}

// Legacy Marg license API (GET, no Bearer, key already in query string).
// Used for changeEmail / changeMobile.
async function callMargLegacy(url) {
  const r = await fetch(url, {
    method: 'GET',
    headers: {
      'Accept': 'application/json, text/plain, */*',
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/150.0.0.0 Safari/537.36',
    },
  });
  const text = await r.text();
  let data; try { data = text ? JSON.parse(text) : text; } catch { data = text; }
  return { status: r.status, ok: r.ok, data };
}

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  if (!SERVICE_KEY) return res.status(500).json({ error: 'Server not configured: SUPABASE_SERVICE_KEY missing' });

  // 1) Supabase caller verify
  const auth = req.headers.authorization || '';
  const token = auth.replace(/^Bearer\s+/i, '').trim();
  if (!token) return res.status(401).json({ error: 'Missing auth token' });

  const me = await supa('/auth/v1/user', { token, key: ANON_KEY });
  if (!me.ok || !me.data || !me.data.id) return res.status(401).json({ error: 'Invalid session' });

  // 2) Permission: admin OR 'admin-activity'
  const prof = await supa(`/rest/v1/users?id=eq.${me.data.id}&select=role,dashboards,email`);
  const pr = Array.isArray(prof.data) ? prof.data[0] : null;
  const allowed = pr && (pr.role === 'admin' || (Array.isArray(pr.dashboards) && pr.dashboards.includes('admin-activity')));
  if (!allowed) return res.status(403).json({ error: 'Not allowed (admin-activity access required)' });

  // 3) Body + action resolve
  let body = req.body;
  if (typeof body === 'string') { try { body = JSON.parse(body); } catch { body = {}; } }
  const { action } = body || {};
  const builder = ACTIONS[action];
  if (!builder) return res.status(400).json({ error: 'Unknown action: ' + action });

  if (action === 'getDetails' && !String(body.emailid || '').trim())
    return res.status(400).json({ error: 'Email ID / Mobile daalo' });
  if (NEEDS_RECORD.has(action) && (body.dbinfolinkid === undefined || body.dbinfolinkid === null || body.dbinfolinkid === ''))
    return res.status(400).json({ error: 'Pehle "Get Details" chalao (record load karo)' });
  if (action === 'resetPwd' && !String(body.remark || '').trim())
    return res.status(400).json({ error: 'New password daalo' });
  if (action === 'changeEmail'){
    if (!String(body.newEmail||'').trim())   return res.status(400).json({ error: 'New email daalo' });
    if (!String(body.oldEmail||'').trim())   return res.status(400).json({ error: 'Current email is missing on this record' });
  }
  if (action === 'changeMobile'){
    if (!String(body.newMobile||'').trim())  return res.status(400).json({ error: 'New mobile number daalo' });
    if (!String(body.oldMobile||'').trim())  return res.status(400).json({ error: 'Current mobile is missing on this record' });
  }
  if (action === 'getDomainList'){
    if (!Number(body.countrylinkid)) return res.status(400).json({ error: 'countrylinkid required' });
  }

  const built = builder(body);
  const { url, body: mbody, legacy } = built;

  let r;
  // Legacy license API path — GET with query-string key, no Bearer token, no retry.
  if (legacy) {
    try { r = await callMargLegacy(url); }
    catch (e) { return res.status(502).json({ error: 'Marg API reach nahi hui: ' + (e.message || String(e)) }); }
    if (!r.ok) return res.status(502).json({ error: 'Marg API error', upstreamStatus: r.status, upstream: r.data });
    return res.status(200).json({ ok: true, action, result: r.data });
  }

  // 4) Token -> call -> 401/403 par ek baar re-login + retry
  let mtok;
  try { mtok = await getMargToken(false); }
  catch (e) { return res.status(500).json({ error: e.message || String(e) }); }

  try { r = await callMarg(mtok, url, mbody); }
  catch (e) { return res.status(502).json({ error: 'Marg API reach nahi hui: ' + (e.message || String(e)) }); }

  if (r.status === 401 || r.status === 403) {
    try { mtok = await getMargToken(true); r = await callMarg(mtok, url, mbody); }
    catch (e) { return res.status(502).json({ error: 'Re-login fail: ' + (e.message || String(e)) }); }
  }

  if (r.status === 401 || r.status === 403)
    return res.status(502).json({ error: 'Marg auth fail (re-login ke baad bhi)', upstreamStatus: r.status });
  if (!r.ok)
    return res.status(502).json({ error: 'Marg API error', upstreamStatus: r.status, upstream: r.data });

  return res.status(200).json({ ok: true, action, result: r.data });
};
