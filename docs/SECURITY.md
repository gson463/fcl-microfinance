# Security hardening — FCL

## Supabase Dashboard (manual)

In **Authentication → Settings**:

1. **Minimum password length** = 12
2. **Leaked password protection** (HaveIBeenPwned) = ON (Pro plan)
3. **Rate limits** — review defaults for sign-in, sign-up, password recovery

Set Edge Function secret:

```bash
supabase secrets set ADMIN_SETUP_SECRET='your-long-random-secret'
```

## Environment variables

| Variable | Where | Purpose |
|----------|-------|---------|
| `VITE_SUPABASE_URL` | Client `.env` | Required — no hardcoded fallback |
| `VITE_SUPABASE_ANON_KEY` | Client `.env` | Required |
| `VITE_ALLOW_ADMIN_SIGNUP` | Client `.env` | `true` only during initial bootstrap; omit in production |
| `ADMIN_SETUP_SECRET` | Supabase Edge secrets | Required for `create-admin-user` |

## Admin bootstrap

Prefer CLI after first deploy:

```bash
node scripts/create-admin-user.mjs admin@example.com 'SecurePass12chars' 'Admin Name'
```

Web `/admin-signup` is disabled unless `VITE_ALLOW_ADMIN_SIGNUP=true` and caller supplies matching setup secret.

## Verify session storage (current SPA)

1. Sign in → DevTools → Application → Local Storage
2. Key `sb-<project-ref>-auth-token` exists (expected for SPA)
3. **Future:** migrate to httpOnly cookies via SSR/BFF (see below)

## httpOnly cookies migration (Phase 3)

Current stack: **Vite SPA + `@supabase/supabase-js`** → tokens in `localStorage`.

To eliminate JS-readable tokens:

1. **Option A:** Next.js App Router + `@supabase/ssr` cookie handlers
2. **Option B:** Small Node/BFF that sets `httpOnly; Secure; SameSite=Lax` cookies and proxies Supabase Auth

After migration, DevTools → Local Storage should **not** contain auth tokens; session cookie should be **HttpOnly**.

Interim mitigations: strict CSP, XSS-safe rendering, 5-minute idle logout (already enabled).

## Verify fixes

- `create-admin-user` without setup secret → 403
- `record-repayment` without JWT → 401
- `record-repayment` with wrong `officer_id` in body → 403
- Inactive user login → blocked with message
- Password under 12 chars on user create → rejected
