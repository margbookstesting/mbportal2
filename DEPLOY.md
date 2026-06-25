# MB Portal — Security Changes & Deploy Guide

## ⚠️ Sabse pehle: PURANI SERVICE KEY ROTATE KARO (urgent)

`admin.html` ke purane version mein `service_role` key publicly exposed thi.
Jisne bhi woh file / GitHub repo / browser source dekha, uske paas abhi bhi
woh key hai aur woh poore database ka full admin control le sakta hai.

**Code change kaafi nahi hai — key ko invalidate karna zaroori hai:**

1. Supabase Dashboard → Project Settings → **API Keys** (ya **Data API**)
2. `service_role` key ke saamne **Reveal / Roll / Reset** karo → nayi key generate karo.
3. Purani key turant band ho jaayegi.
4. Nayi service key ko **sirf** GitHub Actions secret `SUPABASE_SERVICE_KEY`
   mein update karo (fetch_tickets.py use karta hai). Browser mein kabhi mat daalo.

> Note: Edge Function ko service key manually dene ki zaroorat nahi —
> Supabase khud `SUPABASE_SERVICE_ROLE_KEY` inject karta hai (rotate karne par
> woh bhi automatically updated rehti hai).

---

## Kya-kya badla

### 1. `admin.html` — service key hata di
- `SUPA_SERVICE` aur `sbAdmin` client poori tarah remove.
- Create / Update / Delete / List ab **Edge Function** `admin-actions` ke through
  hote hain. Function har request par caller ka JWT verify karta hai aur check
  karta hai ki woh `role = admin` hai — tabhi operation chalega.

### 2. `supabase/functions/admin-actions/index.ts` — naya
- Service key sirf yahan (server-side) use hoti hai.
- Actions: `list`, `create`, `update`, `delete`.

### 3. Chaaron dashboards — Auth Guard add
`ticket_dashboard_api.html`, `marg_ticket_dashboard.html`,
`upcoming_timeline.html`, `ticket_dashboard_excel.html` —
ab page load par check hota hai:
- Logged in nahi? → `index.html` par redirect.
- Logged in hai par us dashboard ka permission nahi (aur admin bhi nahi)?
  → `portal.html` par redirect.

(Pehle koi bhi seedha `/dashboard`, `/tat` URL kholkar bina login data dekh sakta tha.)

---

## Edge Function deploy karne ke steps

```bash
# 1. Supabase CLI install (agar nahi hai)
npm i -g supabase

# 2. Login + project link
supabase login
supabase link --project-ref xsxchyqhhyfvuxbofxna

# 3. Deploy
supabase functions deploy admin-actions
```

Deploy ke baad function yahan available hoga:
`https://xsxchyqhhyfvuxbofxna.supabase.co/functions/v1/admin-actions`
(admin.html mein ye URL already set hai.)

---

## Optional cleanup (recommended)

`setup.sql` ki **"Admin full access"** policy `public.users` ke andar hi
`public.users` ko query karti hai — ye RLS **infinite recursion** error de
sakti hai. Ab admin reads function (service key) ke through hote hain, isliye
ye policy zaroori nahi rahi. Chaaho toh isse hata sakte ho; baaki ke liye
"Users can read own" policy kaafi hai (portal/dashboard profile read uske
through chalte hain).
