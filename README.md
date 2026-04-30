# Rinkd v2 — Full Authenticated App

Real sign-up, real login, real posts, real likes, real comments.

---

## 🗄️ Step 1 — Set up Supabase Database (do this first)

1. Go to **supabase.com/dashboard** → your Rinkd project
2. Click **SQL Editor** in the left sidebar
3. Click **New Query**
4. Open `SUPABASE_SETUP.sql` from this folder
5. Copy the entire contents and paste into the SQL editor
6. Click **Run**
7. You should see "Success" — your database is ready

---

## 🔑 Step 2 — Add Environment Variables to Vercel

In your Vercel project → Settings → Environment Variables, add:

| Name | Value |
|------|-------|
| `REACT_APP_SUPABASE_URL` | `https://tbpoopsyhfuqcbugrjbh.supabase.co` |
| `REACT_APP_SUPABASE_ANON_KEY` | Your publishable key from Supabase → Settings → API |

---

## 📧 Step 3 — Configure Supabase Auth

1. Go to Supabase → **Authentication** → **URL Configuration**
2. Set **Site URL** to: `https://rinkd-dnbj.vercel.app`
3. Add to **Redirect URLs**: `https://rinkd-dnbj.vercel.app/**`
4. Click Save

Optional — disable email confirmation for faster testing:
- Authentication → **Providers** → Email → toggle off "Confirm email"

---

## 🚀 Step 4 — Deploy to Vercel

**Option A — Via Vercel CLI (recommended):**
```bash
cd rinkd-v2
vercel --prod
```

**Option B — Via GitHub:**
1. Push all files to your GitHub repo (replace old files)
2. Vercel auto-deploys

---

## ✅ What works now

- **Sign up** — creates a real account + player profile
- **Log in / Log out** — persistent sessions
- **Feed** — posts from ALL users, newest first
- **Create posts** — with tags and hashtags, saves to database
- **Like posts** — toggles, persists, everyone sees the count
- **Comments** — real threaded comments on any post
- **Profile** — your real stats, tier progress, edit bio/position
- **Tier system** — points earned automatically, tier updates in real-time
- **Protected routes** — can't access feed without logging in

---

## 🏗️ Stack

- React 18 + React Router 6
- Supabase (Auth + PostgreSQL + RLS)
- Vercel (hosting)
- Zero paid services required at this scale
