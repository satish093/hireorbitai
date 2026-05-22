# 01 · Production VPS with CloudPanel

Goal: production runs on your existing VPS, served by **Nginx (CloudPanel) → PM2
→ Node 22**, with `hireorbitai.com` on HTTPS. CloudPanel is already installed —
this adapts to it, it does not replace it.

> If your VPS is already serving production, skip to the **"What deploy expects"**
> box at the bottom and just confirm the names match. Don't recreate the site.

## 0. What you need

- SSH access to the VPS (CloudPanel admin too).
- A domain pointed at the VPS IP (`hireorbitai.com` A record → VPS IP).
- Node 22 (`node -v` ≥ 22). CloudPanel's Node.js site type installs it; otherwise
  install via `nvm` for the site user.

## 1. Create the site in CloudPanel

CloudPanel UI → **Sites → Add Site → Node.js**:

- **Domain name:** `hireorbitai.com`
- **Node.js version:** 22
- **App port:** `4000` (matches `PORT` in the backend env)
- **Site user:** `hireorbitai` (CloudPanel creates `/home/hireorbitai/…`)

CloudPanel provisions an Nginx vhost, a Linux user, and an `htdocs` web root at
`/home/hireorbitai/htdocs/hireorbitai.com`.

## 2. Get the code onto the VPS

SSH in as the **site user** (not root):

```bash
ssh hireorbitai@<VPS_IP>
cd ~
git clone https://github.com/<you>/hireorbitai.git hireorbitai   # or your remote
cd ~/hireorbitai
npm ci
npm run shared:build
```

The deploy script and PM2 both assume the repo lives at `~/hireorbitai`.

## 3. Backend env file

```bash
cp backend/.env.production.example backend/.env
nano backend/.env       # fill in real values
```

Generate the three secrets:

```bash
node -e "console.log(require('crypto').randomBytes(48).toString('base64'))"   # run 3×
# → JWT_SECRET, COOKIE_SECRET, STORAGE_URL_SECRET
```

`DATABASE_URL` comes from [02 · Databases](02-databases.md). Keep
`NODE_ENV=production` and `DB_GUARD=enforce`.

## 4. Uploads directory (persistent storage)

```bash
sudo mkdir -p /var/lib/hireorbitai/uploads
sudo chown -R hireorbitai:hireorbitai /var/lib/hireorbitai
```

This path must survive deploys — it lives **outside** the repo. It matches
`UPLOADS_DIR` in `backend/.env`.

## 5. First build + start under PM2

```bash
cd ~/hireorbitai
npm --prefix backend run build
npm --prefix frontend run build
rsync -a --delete frontend/dist/ ~/htdocs/hireorbitai.com/   # publish the SPA

# Start the API under PM2 (name MUST be hireorbitai-api — update.sh expects it)
pm2 start backend/dist/server.js --name hireorbitai-api --update-env
pm2 save
pm2 startup    # follow the printed command so PM2 survives reboots
```

> The repo ships `backend/ecosystem.config.cjs` — you can `pm2 start backend/ecosystem.config.cjs`
> instead if you prefer config-driven PM2. Either way the process name must be
> `hireorbitai-api`.

## 6. Nginx reverse proxy

CloudPanel's vhost serves the static SPA from the web root and must proxy
`/api` (and the SSE stream) to Node on `:4000`. In CloudPanel → site →
**Vhost**, ensure these location blocks exist:

```nginx
# API → Node
location /api/ {
    proxy_pass http://127.0.0.1:4000;
    proxy_http_version 1.1;
    proxy_set_header Host              $host;
    proxy_set_header X-Real-IP         $remote_addr;
    proxy_set_header X-Forwarded-For   $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
}

# Server-Sent Events stream — buffering MUST be off or realtime stalls
location /api/realtime/stream {
    proxy_pass http://127.0.0.1:4000;
    proxy_http_version 1.1;
    proxy_set_header Connection '';
    proxy_buffering off;
    proxy_cache off;
    proxy_read_timeout 3600s;
}

# SPA fallback — client-side routing
location / {
    try_files $uri $uri/ /index.html;
}
```

`TRUST_PROXY=1` in the env tells Express to trust `X-Forwarded-*` from Nginx.

## 7. SSL

CloudPanel → site → **SSL/TLS → Let's Encrypt → Issue**. Enable
"Force HTTPS". Renewal is automatic. Confirm `https://hireorbitai.com` loads.

## 8. Smoke test

```bash
bash scripts/healthcheck.sh https://hireorbitai.com
```

All probes should be green (`/api/health`, `/api/ready`, auth pipeline 401, TLS).

## What deploy expects (the contract)

`scripts/update.sh` (run by `deploy-production.yml`) assumes:

| Thing       | Value                                | Override            |
| ----------- | ------------------------------------ | ------------------- |
| Repo path   | `~/hireorbitai`                      | (fixed in workflow) |
| Web root    | `~/htdocs/hireorbitai.com`           | `WEBROOT` env       |
| PM2 process | `hireorbitai-api`                    | `PM2_NAME` env      |
| Smoke URL   | `https://hireorbitai.com/api/health` | `SMOKE_URL` env     |

If your CloudPanel paths differ, export the overrides in the site user's shell
profile (e.g. `~/.bashrc`) rather than editing `update.sh`.

→ Next: [02 · Databases](02-databases.md)
