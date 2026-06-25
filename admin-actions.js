// Vercel Serverless Function  →  POST /api/admin-actions
// ---------------------------------------------------------------------------
// Service-role key sirf YAHAN (server-side env var) use hoti hai — browser
// mein kabhi nahi. Vercel project Settings → Environment Variables mein
// SUPABASE_SERVICE_KEY set karna zaroori hai.
//
// Zero npm dependencies — sirf built-in fetch use karta hai (Node 18+).
// Kuch alag deploy nahi karna: ye file repo mein hone par tumhare normal
// Vercel deploy ke saath hi /api/admin-actions par live ho jaati hai.
// ---------------------------------------------------------------------------

const SUPA_URL = process.env.SUPABASE_URL || 'https://xsxchyqhhyfvuxbofxna.supabase.co';
const ANON_KEY = process.env.SUPABASE_ANON_KEY ||
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InhzeGNoeXFoaHlmdnV4Ym9meG5hIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODE0MTMzNTAsImV4cCI6MjA5Njk4OTM1MH0.P4VYTv-fizFW7nknhP4h1BetBGJ6yLLD90lkUUYgt-4';
const SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;

// Chhota helper: Supabase REST / Auth-Admin endpoints ko call karta hai
async function sb(path, { method = 'GET', token = SERVICE_KEY, key = SERVICE_KEY, body, prefer } = {}) {
  const headers = { apikey: key, Authorization: `Bearer ${token}` };
  if (body) headers['Content-Type'] = 'application/json';
  if (prefer) headers['Prefer'] = prefer;
  const res = await fetch(`${SUPA_URL}${path}`, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let data;
  try { data = text ? JSON.parse(text) : null; } catch { data = text; }
  return { ok: res.ok, status: res.status, data };
}

const errMsg = (d, fallback) =>
  (d && (d.msg || d.message || d.error_description || d.error)) || fallback;

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  if (!SERVICE_KEY) return res.status(500).json({ error: 'Server not configured: SUPABASE_SERVICE_KEY missing in Vercel env' });

  // 1) Caller ka token verify karo
  const auth = req.headers.authorization || '';
  const token = auth.replace(/^Bearer\s+/i, '').trim();
  if (!token) return res.status(401).json({ error: 'Missing auth token' });

  const me = await sb('/auth/v1/user', { token, key: ANON_KEY });
  if (!me.ok || !me.data || !me.data.id) return res.status(401).json({ error: 'Invalid session' });
  const callerId = me.data.id;

  // 2) Admin role check (service key se reliable read)
  const prof = await sb(`/rest/v1/users?id=eq.${callerId}&select=role`);
  const role = Array.isArray(prof.data) ? (prof.data[0] && prof.data[0].role) : null;
  if (role !== 'admin') return res.status(403).json({ error: 'Admin only' });

  // 3) Body parse
  let body = req.body;
  if (typeof body === 'string') { try { body = JSON.parse(body); } catch { body = {}; } }
  const { action, payload = {} } = body || {};

  try {
    if (action === 'list') {
      const r = await sb('/rest/v1/users?select=*&order=created_at.desc');
      if (!r.ok) throw new Error(errMsg(r.data, 'List failed'));
      return res.status(200).json({ ok: true, users: r.data || [] });
    }

    if (action === 'create') {
      const { name, email, password, role: newRole } = payload;
      if (!name || !email || !password) return res.status(400).json({ error: 'All fields are required' });
      if (String(password).length < 6) return res.status(400).json({ error: 'Password min 6 characters' });

      const cu = await sb('/auth/v1/admin/users', {
        method: 'POST',
        body: { email, password, email_confirm: true, user_metadata: { name } },
      });
      if (!cu.ok) throw new Error(errMsg(cu.data, 'Create failed'));
      const uid = cu.data.id;

      const ins = await sb('/rest/v1/users', {
        method: 'POST',
        prefer: 'return=minimal',
        body: { id: uid, name, email, role: newRole || 'user', dashboards: [], created_at: new Date().toISOString() },
      });
      if (!ins.ok) throw new Error(errMsg(ins.data, 'Profile insert failed'));
      return res.status(200).json({ ok: true, id: uid });
    }

    if (action === 'delete') {
      const { id } = payload;
      if (!id) return res.status(400).json({ error: 'Missing id' });
      if (id === callerId) return res.status(400).json({ error: 'You cannot delete your own account' });

      // auth user delete -> ON DELETE CASCADE public.users row bhi hata deta hai
      const du = await sb(`/auth/v1/admin/users/${id}`, { method: 'DELETE' });
      if (!du.ok) throw new Error(errMsg(du.data, 'Delete failed'));
      await sb(`/rest/v1/users?id=eq.${id}`, { method: 'DELETE', prefer: 'return=minimal' });
      return res.status(200).json({ ok: true });
    }

    if (action === 'update') {
      const { id, name, email, role: uRole, dashboards, password } = payload;
      if (!id) return res.status(400).json({ error: 'Missing id' });

      const upd = await sb(`/rest/v1/users?id=eq.${id}`, {
        method: 'PATCH',
        prefer: 'return=minimal',
        body: { name, email, role: uRole, dashboards },
      });
      if (!upd.ok) throw new Error(errMsg(upd.data, 'Update failed'));

      const authUpdate = {};
      if (email) authUpdate.email = email;
      if (password) authUpdate.password = password;
      if (Object.keys(authUpdate).length) {
        const au = await sb(`/auth/v1/admin/users/${id}`, { method: 'PUT', body: authUpdate });
        if (!au.ok) throw new Error(errMsg(au.data, 'Auth update failed'));
      }
      return res.status(200).json({ ok: true });
    }

    return res.status(400).json({ error: 'Unknown action' });
  } catch (e) {
    return res.status(400).json({ error: e.message || String(e) });
  }
}
