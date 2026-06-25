# MB Portal — Admin Fix (Vercel serverless function)

## Kya badla (Edge Function ki zaroorat khatam)

Pehle admin operations Supabase Edge Function par the (jise CLI/Docker se
deploy karna padta). Ab woh ek **Vercel serverless function** par hain:
`api/admin-actions.js`. Tum already Vercel par ho, isliye ye file repo mein
hone par tumhare **normal Vercel deploy ke saath hi** live ho jaati hai —
alag se kuch deploy nahi karna. Service key sirf Vercel env var mein rehti hai.

## Sirf 3 step (5 min)

### 1. File repo mein daalo
`api/admin-actions.js` ko apne repo ke **`api/`** folder mein rakho
(root par `api` folder banao agar nahi hai). Path bilkul: `api/admin-actions.js`.
`admin.html` ko bhi replace karo (naya wala).

### 2. Vercel mein service key set karo  ⚠️ zaroori
Vercel Dashboard → apna project → **Settings → Environment Variables** → Add:

| Name                   | Value                                  |
|------------------------|----------------------------------------|
| `SUPABASE_SERVICE_KEY` | tumhari **nayi** Supabase service_role key |

(Environments mein Production + Preview dono tick kar dena.)

> Purani service key expose ho chuki thi — Supabase → Settings → API Keys mein
> service_role key **roll/reset** karke nayi banao, aur wahi yahan daalo.
> Purani key turant invalid ho jaayegi.

### 3. Redeploy
Git push karo (ya Vercel mein "Redeploy"). Function `/api/admin-actions` par
live ho jaayega. Admin page refresh karo — list aur create dono chalenge.

## Confirm: function live hai ya nahi
Browser mein kholo: `https://<tumhari-site>/api/admin-actions`
- **405 (Method not allowed)** aaye → function live hai ✅ (GET allowed nahi, sirf POST)
- **404** → file galat jagah hai, `api/admin-actions.js` path check karo

## Agar list par 403 aaye
Function chal rahi hai par tumhara apna user admin nahi hai. Supabase SQL Editor:
```sql
update public.users set role = 'admin' where email = 'tumhara@email.com';
```

## Note
- `supabase/functions/admin-actions/index.ts` ab use nahi hota — chaaho toh
  rakho ya hata do, Vercel waala hi kaafi hai.
- `vercel.json` mein koi change ki zaroorat nahi — `/api/*` automatically chalta hai.
