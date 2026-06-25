// Supabase Edge Function: admin-actions
// ---------------------------------------------------------------------------
// Service-role key ab sirf yahan (server-side) use hoti hai — browser mein NAHI.
// Har request mein caller ka JWT verify hota hai aur check hota hai ki woh admin hai.
//
// Deploy:
//   supabase functions deploy admin-actions
// (SUPABASE_URL / SUPABASE_ANON_KEY / SUPABASE_SERVICE_ROLE_KEY platform khud
//  inject karta hai — manually set karne ki zaroorat nahi.)
// ---------------------------------------------------------------------------

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...cors, "Content-Type": "application/json" },
  });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  // 1) Caller ka token nikalo aur verify karo
  const authHeader = req.headers.get("Authorization") || "";
  const token = authHeader.replace(/^Bearer\s+/i, "").trim();
  if (!token) return json({ error: "Missing auth token" }, 401);

  const userClient = createClient(SUPABASE_URL, ANON_KEY, {
    auth: { persistSession: false },
  });
  const { data: { user }, error: userErr } = await userClient.auth.getUser(token);
  if (userErr || !user) return json({ error: "Invalid session" }, 401);

  // 2) Service client (RLS bypass) — aur admin role check
  const admin = createClient(SUPABASE_URL, SERVICE_KEY, {
    auth: { persistSession: false },
  });
  const { data: profile } = await admin
    .from("users")
    .select("role")
    .eq("id", user.id)
    .single();
  if (profile?.role !== "admin") return json({ error: "Admin only" }, 403);

  // 3) Action perform karo
  let body: any;
  try {
    body = await req.json();
  } catch {
    return json({ error: "Bad JSON" }, 400);
  }
  const { action, payload = {} } = body || {};

  try {
    if (action === "list") {
      const { data, error } = await admin
        .from("users")
        .select("*")
        .order("created_at", { ascending: false });
      if (error) throw error;
      return json({ ok: true, users: data });
    }

    if (action === "create") {
      const { name, email, password, role } = payload;
      if (!name || !email || !password)
        return json({ error: "All fields are required" }, 400);
      if (String(password).length < 6)
        return json({ error: "Password min 6 characters" }, 400);

      const { data: created, error: cErr } = await admin.auth.admin.createUser({
        email,
        password,
        user_metadata: { name },
        email_confirm: true,
      });
      if (cErr) throw cErr;

      const { error: dbErr } = await admin.from("users").insert({
        id: created.user.id,
        name,
        email,
        role: role || "user",
        dashboards: [],
        created_at: new Date().toISOString(),
      });
      if (dbErr) throw dbErr;
      return json({ ok: true, id: created.user.id });
    }

    if (action === "delete") {
      const { id } = payload;
      if (!id) return json({ error: "Missing id" }, 400);
      if (id === user.id)
        return json({ error: "You cannot delete your own account" }, 400);

      await admin.from("users").delete().eq("id", id);
      const { error: dErr } = await admin.auth.admin.deleteUser(id);
      if (dErr) throw dErr;
      return json({ ok: true });
    }

    if (action === "update") {
      const { id, name, email, role, dashboards, password } = payload;
      if (!id) return json({ error: "Missing id" }, 400);

      const { error: uErr } = await admin
        .from("users")
        .update({ name, email, role, dashboards })
        .eq("id", id);
      if (uErr) throw uErr;

      const authUpdate: Record<string, string> = {};
      if (email) authUpdate.email = email;
      if (password) authUpdate.password = password;
      if (Object.keys(authUpdate).length) {
        const { error: aErr } = await admin.auth.admin.updateUserById(
          id,
          authUpdate,
        );
        if (aErr) throw aErr;
      }
      return json({ ok: true });
    }

    return json({ error: "Unknown action" }, 400);
  } catch (e) {
    return json({ error: (e as Error).message || String(e) }, 400);
  }
});
