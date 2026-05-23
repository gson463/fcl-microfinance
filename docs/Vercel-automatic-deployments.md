# Automatic deployments on Vercel

Deployments update **automatically** when Vercel is connected to your Git repository and you **push** to the tracked branches. Nothing in `vercel.json` turns that on; it is configured in the Vercel project.

## One-time setup (Vercel Dashboard)

1. Open [Vercel Dashboard](https://vercel.com/dashboard) → your **FCL** project (or **Add New… → Project** and import this repo).
2. Under **Settings → Git**:
   - **Connected Git Repository** must show your Git host (GitHub/GitLab/Bitbucket) and this repo—not “No Git Connected”.
   - **Production Branch** must match where you merge releases (usually `main`).
3. Under **Settings → Git → Deploy Hooks** (optional): only needed for non-Git triggers; ordinary pushes do **not** need a hook.

## What triggers a deploy

| Event | Typical result |
|--------|----------------|
| Push to **production branch** (`main`) | New **Production** deployment |
| Push to another branch | **Preview** deployment (unless disabled) |

## If production does not update after you ship code

1. **Push the commit to the remote** Vercel is watching (`git push origin main`). Local-only commits never deploy.
2. Confirm the **Production Branch** in Vercel is the branch you actually push to.
3. In **Deployments**, open the failed build and fix build errors (same as `npm run build` locally).
4. Confirm you did not enable **Ignored Build Step** in a way that skips every build (Settings → Git → Ignored Build Step).

## Frontend vs backend

- **This repo / Vercel**: static **Vite** build (`npm run build`). Env vars (`VITE_*`, Supabase URL/key) belong in **Vercel → Settings → Environment Variables**.
- **Supabase** (SQL, Edge Functions): deploy separately (`supabase db push`, Edge deploy). Vercel does not migrate your database.
