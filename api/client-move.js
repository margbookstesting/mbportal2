// Vercel Serverless Function  →  POST /api/client-move
// ---------------------------------------------------------------------------
// Browser se Marg API ko direct call nahi kar sakte (CORS + token exposure).
// Ye proxy: (1) Supabase caller verify (admin ya 'admin-activity' permission),
// (2) Marg me KHUD login karke fresh Bearer token leta hai (cache + auto-refresh),
// (3) usermoveDomain API ko server-side forward karta hai.
//
// Vercel env vars chahiye:
//   SUPABASE_SERVICE_KEY   (already set)
//   MARG_LOGIN_EMAIL       = ajay.aj@margerp.net
//   MARG_LOGIN_PASSWORD    = <Marg ka password>
//   MARG_USER_EMAIL        = (optional) Useremailid; default = login email
//   MARG_MOVE_KEY          = (optional) constant 'key'; default body se aata hai
//   MARG_TOKEN             = (optional fallback) agar login creds na ho to static token
// ---------------------------------------------------------------------------

const SUPA_URL = process.env.SUPABASE_URL || 'https://xsxchyqhhyfvuxbofxna.supabase.co';
const ANON_KEY = process.env.SUPABASE_ANON_KEY ||
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InhzeGNoeXFoaHlmdnV4Ym9meG5hIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODE0MTMzNTAsImV4cCI6MjA5Njk4OTM1MH0.P4VYTv-fizFW7nknhP4h1BetBGJ6yLLD90lkUUYgt-4';
const SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;

const MARG_API   = 'https://dbwork.margbooks.com/api/Other/usermoveDomain';
const LOGIN_API  = 'https://dbwork.margbooks.com/api/Auth/login';
const MARG_ORIGIN = process.env.MARG_ORIGIN || 'http://192.167.24.89:8086';
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/149.0.0.0 Safari/537.36';
const LOGIN_EMAIL    = process.env.MARG_LOGIN_EMAIL || '';
const LOGIN_PASSWORD = process.env.MARG_LOGIN_PASSWORD || '';
const STATIC_TOKEN   = process.env.MARG_TOKEN || '';
const MARG_USER_EMAIL = process.env.MARG_USER_EMAIL || LOGIN_EMAIL || '';

// warm instance me token cache (cold start par dobara login)
let _cache = { token: '', exp: 0 };

async function supa(path, { token = SERVICE_KEY, key = SERVICE_KEY } = {}) {
  const res = await fetch(`${SUPA_URL}${path}`, { headers: { apikey: key, Authorization: `Bearer ${token}` } });
  const text = await res.text();
  let data; try { data = text ? JSON.parse(text) : null; } catch { data = text; }
  return { ok: res.ok, status: res.status, data };
}

// response ke andar kahin bhi JWT-jaisi string dhoondh lo (field name unknown ho to bhi)
function findJwt(v) {
  if (typeof v === 'string') return /^eyJ[\w-]+\.[\w-]+\.[\w-]+$/.test(v) ? v : null;
  if (v && typeof v === 'object') {
    for (const k of Object.keys(v)) { const f = findJwt(v[k]); if (f) return f; }
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
      'Content-Type': 'application/json',
      'Accept': 'application/json, text/plain, */*',
      'Accept-Language': 'en-US,en;q=0.9',
      'Origin': MARG_ORIGIN,
      'Referer': MARG_ORIGIN + '/',
      'User-Agent': UA,
    },
    body: JSON.stringify({ email: LOGIN_EMAIL, password: LOGIN_PASSWORD, token: '', roleid: 0, permission: [], isotpauth: 0 }),
  });
  const text = await r.text();
  let data; try { data = JSON.parse(text); } catch { data = text; }
  if (!r.ok) throw new Error('Marg login failed (HTTP ' + r.status + ')');
  const tok = findJwt(data);
  if (!tok) throw new Error('Token not found in login response. Structure: ' +
    (typeof data === 'string' ? data.slice(0, 200) : JSON.stringify(data).slice(0, 300)));
  return tok;
}

async function getMargToken(force) {
  if (LOGIN_EMAIL && LOGIN_PASSWORD) {
    const now = Date.now();
    if (!force && _cache.token && _cache.exp - 60000 > now) return _cache.token;
    try {
      const tok = await margLogin();
      _cache = { token: tok, exp: jwtExpMs(tok) || (now + 10 * 60000) };
      return tok;
    } catch (e) {
      if (STATIC_TOKEN) return STATIC_TOKEN;   // manual token fallback
      throw e;
    }
  }
  if (STATIC_TOKEN) return STATIC_TOKEN;
  throw new Error('Server not configured: set MARG_LOGIN_EMAIL/PASSWORD (or MARG_TOKEN)');
}

async function callMove(token, payload) {
  const r = await fetch(MARG_API, {
    method: 'POST',
    headers: { 'Accept': 'application/json, text/plain, */*', 'Accept-Language': 'en-US,en;q=0.9', 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}`, 'Origin': MARG_ORIGIN, 'Referer': MARG_ORIGIN + '/', 'User-Agent': UA },
    body: JSON.stringify(payload),
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
  const p = Array.isArray(prof.data) ? prof.data[0] : null;
  const allowed = p && (p.role === 'admin' || (Array.isArray(p.dashboards) && p.dashboards.includes('admin-activity')));
  if (!allowed) return res.status(403).json({ error: 'Not allowed (admin-activity access required)' });

  // 3) Body + validation
  let body = req.body;
  if (typeof body === 'string') { try { body = JSON.parse(body); } catch { body = {}; } }
  const { countrykey, key, version, istesting, iscrv, moveBy, emailid, dbinfolinkidstr } = body || {};

  if (!countrykey) return res.status(400).json({ error: 'Please select a Country' });
  if (version === undefined || istesting === undefined) return res.status(400).json({ error: 'Please select a Domain' });
  if (moveBy === 'email' && !String(emailid || '').trim()) return res.status(400).json({ error: 'Please enter an Email ID' });
  if (moveBy === 'dblink' && !String(dbinfolinkidstr || '').trim()) return res.status(400).json({ error: 'Please enter a DB InfoLinkID' });

  const payload = {
    key: String(process.env.MARG_MOVE_KEY || key || ''),
    dbinfolinkidstr: moveBy === 'dblink' ? String(dbinfolinkidstr).trim() : '',
    version: String(version),
    emailid: moveBy === 'email' ? String(emailid).trim() : '',
    iscrv: Number(iscrv) || 0,
    istesting: Number(istesting),
    countrykey: String(countrykey),
    Useremailid: (p && p.email) || MARG_USER_EMAIL || '',
  };

  // 4) Token lao -> move call -> 401/403 par ek baar re-login + retry
  let mtok;
  try { mtok = await getMargToken(false); }
  catch (e) { return res.status(500).json({ error: e.message || String(e) }); }

  let r;
  try { r = await callMove(mtok, payload); }
  catch (e) { return res.status(502).json({ error: 'Could not reach Marg API: ' + (e.message || String(e)) }); }

  if (r.status === 401 || r.status === 403) {
    try { mtok = await getMargToken(true); r = await callMove(mtok, payload); }
    catch (e) { return res.status(502).json({ error: 'Re-login failed: ' + (e.message || String(e)) }); }
  }

  if (r.status === 401 || r.status === 403)
    return res.status(502).json({ error: 'Marg auth failed (even after re-login)', upstreamStatus: r.status });
  if (!r.ok)
    return res.status(502).json({ error: 'Marg API error', upstreamStatus: r.status, upstream: r.data });

  return res.status(200).json({ ok: true, sent: payload, result: r.data });
};
