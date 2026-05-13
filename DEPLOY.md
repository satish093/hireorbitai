# Production deployment — HireOrbit AI on Hostinger VPS + CloudPanel

Target stack:
- Domain: **hireorbitai.com** (registered at Hostinger)
- Server: Hostinger VPS running CloudPanel
- Frontend: Vite static build, served by Nginx (CloudPanel site)
- Backend: Node.js + Express, run by PM2 on `127.0.0.1:4000`, reverse-proxied at `/api`
- DB / Auth / Storage: Supabase (managed)
- Email: Resend (transactional, send-only)
- SSL: Let's Encrypt via CloudPanel

The whole flow assumes you already have CloudPanel installed and your Hostinger VPS reachable by SSH.

---

## 0. Prerequisites

On the VPS (CloudPanel root or a sudoer):

```bash
# Node.js 22 LTS — both packages pin engines.node >= 22.0.0.
# The NodeSource setup script installs Node + npm and adds an apt repo.
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
sudo apt-get install -y nodejs git
sudo npm i -g pm2
node -v   # should print v22.x
```

> If you already have an older Node via CloudPanel, swap it out:
> `sudo apt-get remove -y nodejs && curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash - && sudo apt-get install -y nodejs`

You'll also need a Supabase project, an Anthropic API key, and a Resend account (see Part 2).

---

## 1. DNS

In **Hostinger → Domains → hireorbitai.com → DNS Zone**, add the A records now:

| Type | Name | Value |
|------|------|-------|
| A    | `@`  | <your VPS IPv4> |
| A    | `www` | <your VPS IPv4> |
| TXT  | `_dmarc` | `v=DMARC1; p=none; rua=mailto:postmaster@hireorbitai.com` |

The SPF + DKIM TXT records depend on which email provider you pick — add those during Part 2 (Resend gives you `resend._domainkey`, Brevo gives you `mail._domainkey` + a `brevo-code…` verification record, SendGrid gives you `s1._domainkey` and `s2._domainkey`).

Wait for DNS to propagate (`dig hireorbitai.com` from the VPS should return its IP).

---

## 2. Email — pick a provider

The backend supports **Resend** (default), **Brevo**, or **SendGrid**. Pick one based on what you have:

| Provider | Free tier | Notes |
|---|---|---|
| **Resend** | 3 000 emails/mo, 100/day | Cleanest API, excellent deliverability, recommended. |
| **Brevo** | 300 emails/day (no monthly cap) | More daily headroom on free tier; covers send + receive on paid. |
| **SendGrid** | 100/day | Requires `npm i @sendgrid/mail` (not bundled). |

You only need to set up **one**. Both Resend and Brevo can also serve as Supabase's custom SMTP so invitations + password-reset emails come from `noreply@hireorbitai.com`.

### Option A — Resend

1. Sign up at https://resend.com
2. **Domains → Add Domain → `hireorbitai.com`**
3. Copy the SPF (TXT) and DKIM (TXT) records Resend shows; paste them into Hostinger DNS.
4. Click **Verify** — usually completes in 5–30 min.
5. **API Keys → Create API Key** with "Sending access" scope; copy the `re_…` key.
6. Point Supabase auth emails at Resend SMTP (see *Supabase SMTP wiring* below). Resend SMTP host: `smtp.resend.com`, port `465`, user `resend`, password = your API key.

In `backend/.env`:
```dotenv
EMAIL_PROVIDER=resend
RESEND_API_KEY=re_xxxxxxxxxxxxxxxxxxxx
```

### Option B — Brevo (formerly Sendinblue)

1. Sign up at https://www.brevo.com
2. **Senders, Domains & Dedicated IPs → Domains → Add a domain → `hireorbitai.com`**
3. Brevo shows DKIM, Brevo-code, and DMARC records (3–4 TXT entries). Paste each into Hostinger DNS.
4. Back in Brevo, click **Authenticate this domain** — usually verified in 5–30 min.
5. **SMTP & API → API Keys → Generate a new API key** → copy the `xkeysib-…` key. (This is the v3 REST key the backend uses.)
6. Same screen → **SMTP** tab: note the SMTP credentials (host `smtp-relay.brevo.com`, port `587`, login = your account email or the SMTP login Brevo shows, password = your SMTP key — **not** the v3 API key). You'll use these for the Supabase SMTP step below.

In `backend/.env`:
```dotenv
EMAIL_PROVIDER=brevo
BREVO_API_KEY=xkeysib-xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
```

The backend hits Brevo's REST API directly via `fetch` — no extra `npm install` needed.

### Option C — SendGrid

```bash
cd backend && npm i @sendgrid/mail
```
Then in `backend/.env`:
```dotenv
EMAIL_PROVIDER=sendgrid
SENDGRID_API_KEY=SG.xxxxxxxxxxxxxxxxxxxx
```

### Supabase SMTP wiring

**For this app — leave Supabase Custom SMTP DISABLED.** Every transactional
email (welcome + temp password, password reset, password-changed notice,
account locked) is sent by our backend through Brevo's REST API directly.
The Supabase recovery / invite email flows are not used. If you previously
enabled Custom SMTP in Supabase, disable it now to avoid double-sends.

(Below is kept for reference — only enable it if you decide to also surface
Supabase's built-in `signInWithPassword` recovery for some other reason.)

Out of the box, Supabase sends auth emails (invite + password reset) from a generic `noreply@mail.app.supabase.io` and rate-limits to ~2/hour. Pointing Supabase at your provider's SMTP fixes both.

In Supabase Dashboard → **Project Settings → Auth → SMTP Settings → Enable Custom SMTP**:

| Provider | Host | Port | Username | Password |
|---|---|---|---|---|
| Resend | `smtp.resend.com` | `465` | `resend` | your `re_…` API key |
| Brevo  | `smtp-relay.brevo.com` | `587` | the SMTP login Brevo shows on the SMTP tab | your Brevo SMTP key |
| SendGrid | `smtp.sendgrid.net` | `587` | `apikey` | your `SG.…` API key |

Sender email: `noreply@hireorbitai.com` · Sender name: `HireOrbit AI`

Then Supabase → **Auth → URL Configuration**:
- Site URL: `https://hireorbitai.com`
- Additional Redirect URLs: `https://hireorbitai.com/invite/accept`, `https://hireorbitai.com/reset-password`

Finally, Supabase → **Auth → Email Templates** → rebrand Invite / Reset Password / Confirm Signup with "HireOrbit AI".

---

## 3. Supabase

1. Apply the schema. In Supabase SQL editor, run `database/schema.sql` first, then apply the remaining migrations in this order:
   ```
   schema.sql
   tasks.sql
   tasks-tags.sql
   apply-flow-tables.sql
   applications-archived-status.sql
   feature-flags.sql
   recruiter-managers.sql
   roles-hierarchy.sql
   roles-developer-hr.sql
   consultant-skills.sql
   consultant-desired-positions.sql
   user-profile-fields.sql
   user-groups-and-presence.sql
   user-activity-tracking.sql
   messages.sql
   ai-job-search-and-apply.sql
   job-ingestion.sql
   job-ingestion-extra-sources.sql
   jobs-extras.sql
   jobs-publisher.sql
   jobs-unique-fix.sql
   jobs-apply-url-backfill.sql
   jsearch-source.sql
   jsearch-source-expansion.sql
   linkedin-source.sql
   monster-source.sql
   searchapi-source.sql
   all-sources-seed.sql
   ```
2. **Storage → Create bucket** named `resumes`, private.
3. Copy the Project URL and the `anon` + `service_role` keys (Settings → API).

---

## 4. CloudPanel sites

You'll create **one** site for the frontend (serves `hireorbitai.com`) and reverse-proxy `/api` to the backend on `127.0.0.1:4000`.

### 4.1 Create the site

CloudPanel → **+ Add Site → Create a Node.js Site** is convenient if you want CloudPanel to manage the Node process for you. But since the backend is a long-running API and Vite output is static, the cleaner setup is:

**Create a Static Site for the frontend:**
- Site → Add Site → **Static Site**
- Domain: `hireorbitai.com`
- Site User: e.g. `hireorbit`

This gives you a vhost at `/home/hireorbit/htdocs/hireorbitai.com/`.

### 4.2 Issue SSL

CloudPanel → site → **SSL/TLS → Let's Encrypt → Create**. Tick `hireorbitai.com` and `www.hireorbitai.com`. CloudPanel handles renewal.

### 4.3 Clone the repo

SSH in as the site user:

```bash
sudo su - hireorbit
cd ~
git clone <your-repo-url> talentbridgeai
cd talentbridgeai
```

---

## 5. Backend — build & run with PM2

```bash
cd ~/talentbridgeai/backend
cp .env.example .env
nano .env       # fill in all values (see template below)

npm ci
npm run build   # outputs dist/

# Start under PM2
pm2 start dist/server.js --name hireorbit-api --time
pm2 save
pm2 startup    # follow the printed sudo command once, so PM2 restarts on reboot
```

**Backend `.env` checklist** (every value below must be filled in):

```dotenv
PORT=4000
NODE_ENV=production
CORS_ORIGIN=https://hireorbitai.com
APP_URL=https://hireorbitai.com

SUPABASE_URL=https://<project>.supabase.co
SUPABASE_ANON_KEY=<anon>
SUPABASE_SERVICE_ROLE_KEY=<service-role>     # KEEP SECRET
SUPABASE_STORAGE_BUCKET=resumes

ANTHROPIC_API_KEY=sk-ant-...
ANTHROPIC_MODEL=claude-haiku-4-5-20251001

EMAIL_PROVIDER=resend
EMAIL_FROM="HireOrbit AI <noreply@hireorbitai.com>"
RESEND_API_KEY=re_...

INVITATION_EXPIRY_HOURS=72
```

Health check from the VPS:

```bash
curl http://127.0.0.1:4000/health
# → {"ok":true,"service":"talentbridge-api"}
```

---

## 6. Frontend — build static assets

```bash
cd ~/talentbridgeai/frontend
cp .env.example .env
nano .env
```

Frontend `.env`:

```dotenv
VITE_API_URL=https://hireorbitai.com/api
VITE_SUPABASE_URL=https://<project>.supabase.co
VITE_SUPABASE_ANON_KEY=<anon>
```

Build and publish:

```bash
npm ci
npm run build
# Vite outputs ./dist — copy into the CloudPanel web root.
rm -rf /home/hireorbit/htdocs/hireorbitai.com/*
cp -r dist/* /home/hireorbit/htdocs/hireorbitai.com/
```

---

## 7. Nginx — reverse proxy `/api` + SPA fallback

CloudPanel → site → **Vhost** → edit the Nginx config. **Don't replace** the CloudPanel-generated config — only edit/append inside the HTTPS `server { … }` block, and leave any `.well-known/acme-challenge/` location untouched (Let's Encrypt renewals fail silently if you remove or override it).

Add this inside the HTTPS `server { … }` block:

```nginx
# --- Security headers (HTTPS only) ---
add_header Strict-Transport-Security "max-age=31536000; includeSubDomains; preload" always;
add_header X-Frame-Options           "SAMEORIGIN" always;
add_header X-Content-Type-Options    "nosniff" always;
add_header Referrer-Policy           "strict-origin-when-cross-origin" always;
add_header Permissions-Policy        "camera=(), microphone=(), geolocation=()" always;

# --- Static assets — hashed by Vite, so safe to cache forever ---
location ~* ^/assets/.*\.(?:js|css|woff2?|png|jpg|jpeg|svg|webp|gif|ico)$ {
    expires 1y;
    add_header Cache-Control "public, max-age=31536000, immutable";
    try_files $uri =404;
}

# --- index.html must never be cached so users always get the latest bundle ---
location = /index.html {
    add_header Cache-Control "no-cache, no-store, must-revalidate";
    expires 0;
    try_files $uri =404;
}

# --- SPA fallback (must come AFTER the asset rules above) ---
location / {
    try_files $uri $uri/ /index.html;
}

# --- API reverse proxy ---
location /api/ {
    proxy_pass         http://127.0.0.1:4000/api/;
    proxy_http_version 1.1;
    proxy_set_header   Host              $host;
    proxy_set_header   X-Real-IP         $remote_addr;
    proxy_set_header   X-Forwarded-For   $proxy_add_x_forwarded_for;
    proxy_set_header   X-Forwarded-Proto $scheme;
    proxy_set_header   X-Request-ID      $request_id;
    proxy_read_timeout 120s;
    proxy_send_timeout 120s;
    client_max_body_size 25m;   # matches Express's 10 MB JSON + multipart overhead
}

# --- Liveness + readiness probes (point your uptime monitor here) ---
location = /health { proxy_pass http://127.0.0.1:4000/health; }
location = /ready  { proxy_pass http://127.0.0.1:4000/ready;  }
```

> If you've already replaced the CloudPanel-generated vhost and Let's Encrypt renewals are failing, regenerate from CloudPanel → site → **Vhost → Reset to default**, then re-apply the additions above.

Save → CloudPanel reloads Nginx automatically. Test:

```bash
curl -sS https://hireorbitai.com/api/health   # expect {"ok":true,...}
curl -sS -o /dev/null -w '%{http_code}\n' https://hireorbitai.com/   # 200
```

---

## 8. Bootstrap the first admin

The `/login` page no longer offers self-signup. The default admin is seeded directly by SQL — apply two migrations in this order in the Supabase SQL editor:

1. **`database/auth-hardening.sql`** — adds the `must_change_password` columns, the `password_reset_tokens` + `auth_audit_logs` tables. Required first.
2. **`database/seed-default-admin.sql`** — provisions the SUPER_ADMIN account:

   ```
   email:    satish.flex07@gmail.com
   password: Admin2123
   role:     SUPER_ADMIN
   ```

   The seed is idempotent — re-running it resets the password back to the default and re-arms `must_change_password=true`. To change the seeded credentials, edit the three `v_email` / `v_password` / `v_full_name` literals at the top of the file before running.

3. Sign in at `https://hireorbitai.com/login` with those credentials. The app **immediately routes you to `/change-password`** and blocks every other route until you set a new password. That's the forced-rotation policy — the public default credential becomes unusable as soon as the first human takes the bait.

**Alternative paths** (skip if the SQL seed worked):
- Node script: `npm run bootstrap:admin` (in `backend/`) — same effect, via the Supabase Admin API.
- Runtime auto-provision: set `ENABLE_DEFAULT_ADMIN=true` in `backend/.env` to have the server provision on every boot. Off by default.

After your account is admin, create the rest of the team via `POST /api/users` (use the admin UI when it's wired in, or curl):

```bash
curl -X POST https://hireorbitai.com/api/users \
  -H "Authorization: Bearer <your-access-token>" \
  -H "Content-Type: application/json" \
  -d '{"email":"new.user@hireorbitai.com","full_name":"New User","role":"RECRUITER"}'
```

The backend generates a 16-char temp password, emails it via Brevo, and arms `must_change_password=true` on the new account. The recipient signs in with that temp, gets sent to `/change-password` automatically, and only then can they reach `/dashboard`.

---

## 8.5. If you ever pasted real keys into `.env.example`

The committed file is public the moment it lands anywhere — repo, screenshot, paste bin. Rotate every key that was ever there, in the provider's dashboard:

| Key | Where to rotate |
|---|---|
| `SUPABASE_SERVICE_ROLE_KEY` | Supabase → Project Settings → API → "Reset service_role JWT" |
| `SUPABASE_ANON_KEY`         | Same screen → "Reset anon JWT" (note: invalidates all current sessions) |
| `ANTHROPIC_API_KEY`         | console.anthropic.com → API Keys → revoke + create new |
| `BREVO_API_KEY`             | Brevo → SMTP & API → API Keys → revoke + create new |
| `RESEND_API_KEY`            | Resend → API Keys → revoke + create new |
| `RAPIDAPI_KEY` / `JSEARCH_API_KEY` | rapidapi.com → My Apps → revoke |
| `OPENAI_API_KEY`            | platform.openai.com → API Keys → revoke + create new |

After rotating, put the new values into the server's real `.env` (never `.env.example`), then `pm2 restart hireorbit-api --update-env`.

## 9. Smoke tests after each deploy

1. `https://hireorbitai.com/health` — `{ok:true}` *(if you exposed it; otherwise check `/api/health` via tunnel)*
2. Log in.
3. Invite a recruiter — confirm the email arrives from `noreply@hireorbitai.com`.
4. Open the invite link → finish setup → log out → log back in.
5. Trigger "forgot password" on the login page — confirm Supabase auth email arrives.
6. Upload a resume and click "AI score" — confirm Anthropic calls return.

---

## 10. Re-deploy workflow

```bash
# On the VPS as the site user
cd ~/talentbridgeai
git pull

# Backend
cd backend
npm ci
npm run build
pm2 restart hireorbit-api

# Frontend
cd ../frontend
npm ci
npm run build
rm -rf /home/hireorbit/htdocs/hireorbitai.com/*
cp -r dist/* /home/hireorbit/htdocs/hireorbitai.com/
```

You can wrap this in a `scripts/deploy.sh` once it's stable.

---

## 11. Hardening checklist

- [ ] Firewall: only 22, 80, 443 open on the VPS (CloudPanel → Security → Firewall).
- [ ] SSH: disable root login + password auth, key-only.
- [ ] `helmet()` is already enabled in `server.ts`. Keep CSP defaults; tighten if you add embeds.
- [ ] `CORS_ORIGIN=https://hireorbitai.com` (no wildcard).
- [ ] `SUPABASE_SERVICE_ROLE_KEY` and `RESEND_API_KEY` live only in the backend `.env` — never commit, never expose to the frontend.
- [ ] `pm2 logs hireorbit-api --lines 200` to inspect; consider `pm2 install pm2-logrotate`.
- [ ] Supabase → Auth → Rate Limits: raise the email rate limit once custom SMTP is wired up.
- [ ] Add `https://hireorbitai.com` to the Supabase **Auth → URL Configuration → Site URL** and allow-list.

---

## 12. Where email is sent in the app

| Trigger | Sender | Path |
|---|---|---|
| Invite a new user (manager creates invitation) | Supabase Auth SMTP → Resend (with Resend fallback for already-registered users) | [invitation.service.ts:50](backend/src/services/invitation.service.ts#L50) |
| Forgot password | Supabase Auth SMTP → Resend | `supabase.auth.resetPasswordForEmail` in [Login.tsx](frontend/src/pages/Login.tsx) |
| Reminders (`due_at` notifications) | *Not wired yet* — rows are stored but no scheduler runs. Add a Supabase Edge Function or a cron job that calls `sendEmail()` to enable. | — |

Once Resend's domain is verified and Supabase SMTP is pointing at Resend, both flows work with no further code changes.
