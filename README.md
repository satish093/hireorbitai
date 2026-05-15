# HireOrbit AI

Role-based consultant marketing & recruiting portal. AI-assisted resume scoring, job matching, vendor pitch generation, plus a full task / messaging / reporting workspace for recruiting teams.

Originally shipped as **TalentBridge AI**; rebranded to **HireOrbit AI**.

---

## Features

- **Authentication & RBAC** — Supabase Auth (email + password) verified server-side; 9 roles with explicit tier helpers (`OWNER_TIER`, `ADMIN_TIER`, `MANAGER_TIER`, `OPERATOR_TIER`).
- **Forced password rotation** on first sign-in for admin-created users; account lockout after N failed attempts.
- **Custom forgot-password / reset-password flow** — branded Brevo emails with hashed reset tokens (15-min TTL). No Supabase recovery emails.
- **Admin user management** — All Users list, per-user detail page with audit log, deactivated-accounts view, inline lifecycle actions (deactivate, suspend, ban, reactivate, send-reset, delete) with cross-page invalidation.
- **Consultant onboarding** + recruiter onboarding gates.
- **Resume management** — versioned, with current-resume markers, AI scoring against job descriptions.
- **AI features (Anthropic Claude)** — resume score, ATS match, vendor email draft, structured JD requirement extraction, per-skill scoring, "Fix My Resume" tailoring loop.
- **Job ingestion** — pluggable drivers for Greenhouse, Lever, RemoteOK, Remotive, Arbeitnow, Adzuna, JSearch (LinkedIn / Indeed via RapidAPI), Ashby, Jooble, USAJobs, SerpAPI, SearchApi.io, Monster, plus manual import. Auto-match-and-notify.
- **Application pipeline** — submission tracking, duplicate-submission guard, ATS scoring, status transitions, funnel events.
- **Interviews & calendar** — schedule real + mock interviews, capture feedback, click-to-filter day view.
- **Tasks** — Kanban board + list view, drag-drop status changes, comments, attachments, assigned-to-me view, dashboard metrics.
- **Messages** — internal DM with conversation list, presence dots, unread counts.
- **Reports** — recruiter performance, consultant pipeline, placement analytics, daily activity log, time-in-app tracking.
- **Vendors / Clients** — partner directories.
- **User groups** — multi-tenancy primitive ("Cloudfen", "Zangle IT", etc.).
- **Feature flags** — global + per-group overrides (SUPER_ADMIN / CEO).

---

## Tech Stack

**Frontend**
- React 18 + TypeScript + Vite
- React Router v6, React Hook Form, Axios
- Tailwind CSS with custom design tokens (motion keyframes, hover-lift, skeleton shimmer)
- react-hot-toast

**Backend**
- Node.js **22 LTS** (uses native `--env-file` and `fetch`)
- Express 4 + TypeScript (CommonJS)
- Zod for env validation + every controller's request body
- Pino + pino-http for structured request logging with `requestId`
- Helmet, hpp, compression, express-rate-limit
- Multer for uploads

**Database / Auth / Storage**
- Supabase (Postgres + Auth + Storage)
- Service-role key bypasses RLS; `supabaseAnon` is used wherever `signInWithPassword` is called (anon-client doesn't mutate the admin client's auth state)

**AI**
- Anthropic Claude (default `claude-haiku-4-5-20251001`) via `@anthropic-ai/sdk` with zod-validated structured outputs

**Email**
- Brevo (transactional REST v3) — every email path (welcome+temp password, invitation, password reset, password changed, account locked) goes through the Brevo client. **Supabase auth emails are intentionally disabled.**

**Hosting**
- Hostinger VPS + CloudPanel + Nginx (reverse proxy)
- PM2 (process manager, ecosystem config in repo)
- Let's Encrypt via CloudPanel

---

## Repo layout

```
hireorbitai/
├── backend/                          Node 22 + Express + TypeScript API
│   ├── src/
│   │   ├── server.ts                 helmet/CORS/hpp/compression/rate-limit + graceful shutdown
│   │   ├── config/
│   │   │   ├── env.ts                Zod-validated env (fail-fast at startup)
│   │   │   ├── logger.ts             Pino with redaction
│   │   │   ├── supabase.ts           supabaseAdmin (service-role) + supabaseAnon
│   │   │   ├── anthropic.ts
│   │   │   └── bootstrap.ts          opt-in default-admin provisioning
│   │   ├── middleware/
│   │   │   ├── auth.ts               requireAuth + requireRole + requireAdmin + blockIfMustChangePassword
│   │   │   └── errorHandler.ts
│   │   ├── routes/                   one router per resource
│   │   ├── controllers/              one per resource
│   │   ├── services/
│   │   │   ├── auth.service.ts       login / changePassword / forgotPassword / resetPassword / setUserStatus
│   │   │   ├── audit.service.ts      append-only auth_audit_logs
│   │   │   ├── brevo.service.ts      Brevo v3 REST + 5 templates
│   │   │   ├── invitation.service.ts
│   │   │   ├── ai.service.ts
│   │   │   └── jobIngestion.service.ts
│   │   ├── utils/password.ts         crypto-secure temp passwords + strength validator + token hash
│   │   └── types/index.ts
│   ├── scripts/
│   │   ├── bootstrap-admin.mjs       node --env-file=.env scripts/bootstrap-admin.mjs
│   │   └── seed-{users,leadership}.mjs
│   ├── ecosystem.config.cjs          PM2 process definition (uses --env-file)
│   ├── package.json                  engines.node >= 22.0.0
│   └── .env.example
├── frontend/
│   ├── src/
│   │   ├── App.tsx                   routes + role gates
│   │   ├── main.tsx                  ErrorBoundary + Toaster
│   │   ├── config/env.ts             validated VITE_ vars
│   │   ├── context/AuthContext.tsx
│   │   ├── components/
│   │   │   ├── Button.tsx, Modal.tsx, DataTable.tsx, FormInput.tsx, …
│   │   │   ├── ProtectedRoute.tsx    fail-closed RBAC gate
│   │   │   ├── ErrorBoundary.tsx
│   │   │   └── PasswordField.tsx     show/hide + live strength hints
│   │   ├── hooks/
│   │   │   ├── useFeatureFlags.tsx
│   │   │   └── useInvalidate.ts      cross-page invalidation channel
│   │   ├── pages/                    27 pages
│   │   ├── services/
│   │   │   ├── api.ts                axios + bearer interceptor + 401/423 boot
│   │   │   └── supabase.ts
│   │   └── utils/fileUrl.ts          centralized URL resolver
│   ├── tailwind.config.js
│   └── .env.example
├── database/                         Supabase SQL migrations (apply in order)
├── scripts/deploy.sh                 SSH-side: git pull + build + pm2 restart
├── DEPLOY.md                         end-to-end VPS guide
└── .gitignore                        excludes .env, node_modules, dist, build artifacts
```

---

## Local development

### Prerequisites

- **Node.js 22 LTS** — both packages pin `engines.node >= 22.0.0`. The repo includes `.nvmrc` so `nvm use` selects it.
- A Supabase project (URL + anon key + service-role key)
- An Anthropic API key
- A Brevo account with `hireorbitai.com` (or your own domain) verified

### 1. Clone

```bash
git clone https://github.com/<your-account>/hireorbitai.git
cd hireorbitai
nvm use   # picks Node 22 from .nvmrc
```

### 2. Database

In Supabase SQL editor, apply migrations in this order:

```
database/schema.sql
database/auth-hardening.sql
database/seed-default-admin.sql       ← creates satish.flex07@gmail.com / Admin2123 / SUPER_ADMIN
database/<remaining feature migrations>
```

Storage → create a private bucket named **`resumes`**.

### 3. Backend

```bash
cd backend
cp .env.example .env
nano .env     # fill in real values, see env table below
npm ci
npm run build
npm run dev   # tsx watch + --env-file=.env
```

Backend listens on `http://localhost:4000`. Health: `GET /health`.

### 4. Frontend

```bash
cd ../frontend
cp .env.example .env
nano .env     # VITE_API_URL + VITE_SUPABASE_URL + VITE_SUPABASE_ANON_KEY
npm ci
npm run dev
```

Open `http://localhost:5173`.

### 5. First sign-in

```
Email:    satish.flex07@gmail.com
Password: Admin2123
```

The app immediately routes you to `/change-password` and refuses to leave until you pick a new one. That's the forced-rotation policy in action — the seeded default becomes unusable as soon as you rotate.

---

## Environment variables

### Backend (`backend/.env`)

| Var | Required | Notes |
|---|---|---|
| `PORT` | no | default `4000` |
| `NODE_ENV` | no | `development` (default) / `production` / `test` |
| `APP_URL` | yes | full URL — e.g. `https://hireorbitai.com` |
| `FRONTEND_URL` | yes | used in email links (reset / welcome / invitation) |
| `CORS_ORIGIN` | yes | comma-separated allowlist of frontend origins |
| `TRUST_PROXY` | no | `1` behind Nginx (default), `0` if Node listens on `:443` directly |
| `SUPABASE_URL` | yes | from Supabase Settings → API |
| `SUPABASE_ANON_KEY` | yes | |
| `SUPABASE_SERVICE_ROLE_KEY` | yes | **server-only**, bypasses RLS |
| `SUPABASE_STORAGE_BUCKET` | no | default `resumes` |
| `ANTHROPIC_API_KEY` | yes if AI features used | |
| `ANTHROPIC_MODEL` | no | default `claude-haiku-4-5-20251001` |
| `BREVO_API_KEY` | yes | `xkeysib-…`; the only email provider we ship |
| `BREVO_SENDER_EMAIL` | no | default `noreply@hireorbitai.com` |
| `BREVO_SENDER_NAME` | no | default `HireOrbit AI` |
| `COOKIE_SECRET` | yes | min 32 chars; `node -e "console.log(require('crypto').randomBytes(48).toString('base64'))"` |
| `INVITATION_EXPIRY_HOURS` | no | default `72` |
| `TEMP_PASSWORD_EXPIRY_HOURS` | no | default `24` |
| `RESET_TOKEN_EXPIRY_MINUTES` | no | default `15` |
| `MAX_FAILED_LOGINS` | no | default `5` |
| `LOCKOUT_MINUTES` | no | default `30` |
| `RATE_LIMIT_WINDOW_MS` | no | default `900000` (15 min) |
| `RATE_LIMIT_MAX` | no | default `1500` per window per authenticated user |
| `ENABLE_DEFAULT_ADMIN` | no | `true` to runtime-bootstrap the default SUPER_ADMIN. Off by default — prefer the SQL seed. |
| Job-source keys | no | see `.env.example` for `JSEARCH_API_KEY`, `JOOBLE_API_KEY`, `RAPIDAPI_KEY`, etc. |

### Frontend (`frontend/.env`)

| Var | Required | Notes |
|---|---|---|
| `VITE_API_URL` | yes | full URL incl. scheme — e.g. `https://api.hireorbitai.com` |
| `VITE_SUPABASE_URL` | yes | full URL |
| `VITE_SUPABASE_ANON_KEY` | yes | from Supabase Settings → API |

> Vite **bakes these into the bundle at build time**. Changing them requires a fresh `npm run build`.

---

## Deployment (VPS + CloudPanel + Nginx + PM2)

End-to-end guide lives in [DEPLOY.md](./DEPLOY.md). Skeleton:

1. **DNS** — point `hireorbitai.com` (or your domain) at the VPS.
2. **Brevo** — verify domain (DKIM + SPF + DMARC TXT records), generate an `xkeysib-…` API key.
3. **Supabase** — apply migrations, create `resumes` storage bucket, **leave Custom SMTP DISABLED** (every email goes through Brevo, not Supabase).
4. **Server prerequisites**:
   ```bash
   curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
   sudo apt-get install -y nodejs git
   sudo npm i -g pm2
   ```
5. **CloudPanel** — create a static site for the frontend domain, issue Let's Encrypt SSL.
6. **Backend** —
   ```bash
   cd backend
   cp .env.example .env
   nano .env
   npm ci
   npm run build
   pm2 start ecosystem.config.cjs
   pm2 save && pm2 startup
   ```
7. **Frontend** —
   ```bash
   cd ../frontend
   cp .env.example .env
   nano .env
   npm ci && npm run build
   rsync -a --delete dist/ /home/<site-user>/htdocs/<domain>/
   ```
8. **Nginx vhost** — paste the security-headers + asset-cache + SPA fallback + `/api/` reverse-proxy block from DEPLOY.md §7. **Don't replace the CloudPanel-generated config** — only add inside the existing HTTPS `server { … }` block, and never touch `/.well-known/acme-challenge/`.
9. **Re-deploy on every change**: `bash scripts/deploy.sh` (handles `git pull` + build + `pm2 restart` + smoke-curl).

---

## Production checklist

Before going live:

- [ ] Rotate every secret that ever lived in `.env.example` history (Supabase service-role, Anthropic, Brevo, RapidAPI). The `.gitignore` blocks `.env` from being committed but doesn't help if anyone pasted a real value historically.
- [ ] Set `NODE_ENV=production` on the VPS.
- [ ] `COOKIE_SECRET` ≥ 32 chars, generated fresh.
- [ ] `CORS_ORIGIN` contains exactly the public frontend origin(s) — no wildcards.
- [ ] `TRUST_PROXY=1` if behind Nginx (default).
- [ ] Let's Encrypt SSL is auto-renewing (CloudPanel handles this; check the status page weekly).
- [ ] `pm2 save && pm2 startup` so the API survives reboots.
- [ ] Brevo domain verification is **green** (DKIM + DMARC + SPF).
- [ ] Supabase Custom SMTP is **disabled** (we don't want duplicate sends).
- [ ] Default admin's password has been rotated away from `Admin2123`.
- [ ] Storage bucket `resumes` is **private** (not public).
- [ ] Nginx security headers are live: HSTS, X-Frame-Options, X-Content-Type-Options, Referrer-Policy, Permissions-Policy.
- [ ] Static assets cache `public, max-age=31536000, immutable`; `index.html` is `no-cache`.
- [ ] Health probe `https://api.hireorbitai.com/health` returns 200.
- [ ] Readiness probe `https://api.hireorbitai.com/ready` returns `{ok:true,supabase:200}`.

---

## Auth flow at a glance

```
        sign in           ┌─────────────────────────────┐
   POST /auth/login  ───→ │ supabaseAnon                │
                          │  .signInWithPassword        │
                          │  (NEVER on supabaseAdmin —  │
                          │   would mutate auth state)  │
                          └─────────────┬───────────────┘
                                        │
                            success     │     failure
                                        │
              ┌─────────────────────────┴─────────┐
              ▼                                   ▼
  ┌────────────────────┐                  ┌──────────────────┐
  │ check status       │                  │ bump fail count  │
  │ != active → 423    │                  │ N? → lock + email│
  └─────────┬──────────┘                  └──────────────────┘
            │
            ▼
  ┌─────────────────────────┐
  │ check temp_password TTL │
  │ expired? → 403          │
  └─────────┬───────────────┘
            ▼
  ┌─────────────────────────┐
  │ return tokens +         │
  │ must_change_password?   │
  └─────────┬───────────────┘
            ▼
        frontend
   refreshSession() ───→ supabase.auth.setSession
            │
       must_change?
            │ yes
            ▼
   /change-password (only allowed protected route)
            │
       on success
            │
            ▼
       /dashboard
```

Other paths are summarized in [DEPLOY.md §12](./DEPLOY.md).

---

## Scripts

**Backend** (`backend/package.json`)
- `npm run dev` — `node --watch --import tsx --env-file=.env src/server.ts`
- `npm run build` — `tsc -p tsconfig.json`
- `npm start` — `node --env-file=.env dist/server.js`
- `npm run typecheck` — `tsc --noEmit`
- `npm run bootstrap:admin` — `node --env-file=.env scripts/bootstrap-admin.mjs`

**Frontend** (`frontend/package.json`)
- `npm run dev` — Vite dev server
- `npm run build` — `tsc -b && vite build`
- `npm run preview` — preview the built bundle
- `npm run typecheck` — `tsc --noEmit`

**Repo root**
- `bash scripts/deploy.sh` — VPS-side: pulls, builds both halves, restarts PM2, smoke-curls

---

## Architecture notes

- **One source of truth for account lifecycle**: `setUserStatus()` in `auth.service.ts`. Both legacy (`/users/:id/deactivate`) and admin (`/admin/users/:id/status`) routes funnel through it. Keeps `status`, `is_active`, `status_reason`, `status_changed_at`, and `status_changed_by` always in sync; revokes refresh tokens on every non-active transition; audit-logged.
- **Cross-page state invalidation**: `frontend/src/hooks/useInvalidate.ts` is a tiny pub/sub keyed by domain (`'users' | 'tasks' | 'jobs' | 'applications' | 'invitations'`). Pages that mutate fire `invalidate(channel)`; pages that read use `useInvalidationListener(channel, refetch)`. Replaces what we'd otherwise need react-query for.
- **Fail-closed RBAC**: `ProtectedRoute` redirects to `/unauthorized` when a session exists but the profile didn't load — prevents privilege escalation when `/auth/me` 403s.
- **Brevo-only email**: every transactional email path goes through `services/brevo.service.ts`. Supabase Custom SMTP is intentionally disabled.
- **Rate limiting per authenticated user**: not per IP. So users on the same NAT (office network) don't compete for the bucket.
- **Centralized file URLs**: `frontend/src/utils/fileUrl.ts` resolves any path/URL safely, applies `noopener,noreferrer` on opens.

---

## Known follow-ups

Tracked in code comments and `DEPLOY.md` notes; not blockers for production:

- Reminders have no scheduler; rows are stored but no cron sends `due_at` notifications. Wire to a Supabase Edge Function or a host cron when needed.
- Messages page polls every 4s — works for the current load; switch to Supabase Realtime when concurrency exceeds ~100 users.
- Job-search `/applications/none/events` is intentional (orphan funnel events with `application_id: null`); the backend special-cases the literal `'none'` segment.
- The `/jobs` dropdown in `Applications.tsx` loads all jobs unbounded; replace with a typeahead endpoint at scale.

---

## License

Private — all rights reserved.
