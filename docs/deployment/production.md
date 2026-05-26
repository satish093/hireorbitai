# Production runbook

Operational reference for HireOrbit AI once it's live. This document is for the team that keeps the lights on. For first-time setup see [cloudpanel.md](cloudpanel.md); for local development see [local.md](local.md).

---

## At a glance

| Concern          | Where                                                        |
| ---------------- | ------------------------------------------------------------ |
| Application logs | `pm2 logs hireorbit-api`                                     |
| Web-server logs  | `/var/log/nginx/{access,error}.log`                          |
| Database         | PostgreSQL on `127.0.0.1:5432`                               |
| Uploads          | `/var/lib/hireorbitai/uploads`                               |
| Backups          | `~/backups/<UTC-stamp>/`                                     |
| PM2 process      | `hireorbit-api`                                              |
| Health probes    | `GET /api/healthz` (liveness) · `GET /api/ready` (readiness) |
| Frontend bundle  | `/home/hireorbitai/htdocs/hireorbitai.com/`                  |

---

## Routine deploys

```bash
ssh hireorbitai@<host>
cd ~/hireorbitai
bash scripts/update.sh                # both halves
```

The script:

1. `git fetch --tags --prune && git pull --ff-only` (refuses on merge conflicts or detached HEAD).
2. Reinstalls dependencies + rebuilds **only** if the relevant `package*.json` or source files changed.
3. Restarts PM2 with `--update-env` so any new env vars are picked up.
4. Re-publishes the Vite bundle to the webroot via `rsync -a --delete`.
5. Curls `GET /api/healthz` to confirm the process came back up. **Aborts non-zero** if any step fails, so a broken deploy never silently takes production offline.

Targeted deploys:

```bash
bash scripts/update.sh backend        # backend only
bash scripts/update.sh frontend       # frontend only
```

After a failed deploy, see [Rolling back](#rolling-back) below.

---

## Health surface

| Endpoint                    | Status          | What it tells you                                                            |
| --------------------------- | --------------- | ---------------------------------------------------------------------------- |
| `GET /api/healthz`          | unauthenticated | Node process is alive and serving traffic. Cheap, OK for liveness probes.    |
| `GET /api/ready`            | unauthenticated | Database pool reachable (`SELECT 1`). Use for orchestrator readiness probes. |
| `GET /api/feature-flags/me` | bearer JWT      | Auth pipeline + DB reads working end-to-end.                                 |

A single command exercises all three plus TLS:

```bash
bash scripts/healthcheck.sh https://hireorbitai.com
```

Exit code is 0 if everything is green, 1 otherwise. Suitable as the predicate of an external uptime monitor.

---

## Logs

```bash
# Application logs (Pino JSON)
pm2 logs hireorbit-api                    # tail (last 1000 lines + follow)
pm2 logs hireorbit-api --lines 5000       # bigger backlog
pm2 logs hireorbit-api --err              # stderr only
pm2 logs hireorbit-api --raw | pino-pretty   # human-readable formatting

# Nginx
journalctl -u nginx -n 200
tail -n 200 /var/log/nginx/access.log
tail -n 200 /var/log/nginx/error.log

# Postgres
sudo journalctl -u postgresql -n 200
sudo tail -n 200 /var/log/postgresql/postgresql-*.log
```

Every API request is logged with a `requestId` and a redacted body. To trace a single request across logs, grep on its requestId:

```bash
pm2 logs hireorbit-api --raw --nostream | jq 'select(.req.id == "01H...")'
```

---

## Backups

The included script captures both the database and the uploads directory under a UTC-stamped folder.

```bash
bash scripts/backup.sh
# Writes ~/backups/<UTC-stamp>/{db.sql.gz, uploads.tar.gz, manifest.txt}

ls -lhS ~/backups | head                  # newest first
```

### Daily cron

```cron
0 3 * * * /home/hireorbitai/hireorbitai/scripts/backup.sh >> /home/hireorbitai/backups/backup.log 2>&1
```

### Retention

`backup.sh` does not auto-prune. Add a separate cron job to discard old stamps:

```cron
0 4 * * * find /home/hireorbitai/backups -mindepth 1 -maxdepth 1 -type d -mtime +14 -exec rm -rf {} +
```

### Weekly off-site backup (Cloudflare R2)

Daily backups on the same disk only protect against application-level mistakes — they die with the VPS.
For real disaster recovery, push a copy off-host. [scripts/backup-offsite.sh](../../scripts/backup-offsite.sh)
takes a fresh snapshot and copies it to **Cloudflare R2** via [rclone](https://rclone.org). R2 is the best
free fit for backups: 10 GB free, **zero egress fees** (a full restore during a disaster costs nothing),
S3-compatible, and it authenticates with non-expiring API tokens — so cron won't silently break the way an
OAuth token (Google Drive) eventually does.

> Any rclone remote works — the script is backend-agnostic. To use Backblaze B2, S3, or Drive instead,
> just point `RCLONE_REMOTE` at that remote. R2 is the documented default.

**One-time setup:**

1. In the Cloudflare dashboard → **R2** → create a bucket named `hireorbitai-backups`.
2. R2 → **Manage API Tokens** → create a token with **Object Read & Write**; note the **Access Key ID**,
   **Secret Access Key**, and your **Account ID** (the endpoint is `https://<ACCOUNT_ID>.r2.cloudflarestorage.com`).
3. On the VPS:

```bash
# Install rclone
curl https://rclone.org/install.sh | sudo bash

# Create a remote named "r2": type → s3, provider → Cloudflare,
# access_key_id / secret_access_key → the R2 token pair,
# region → auto, endpoint → https://<ACCOUNT_ID>.r2.cloudflarestorage.com
rclone config

# Verify the remote + bucket are reachable
rclone lsd r2:
```

**Run it once by hand** to confirm the upload lands:

```bash
bash scripts/backup-offsite.sh
rclone lsf r2:hireorbitai-backups                # should list the new <stamp>/ folder
```

**Weekly cron** (end of week — Sunday 03:00, as the `hireorbitai` user via `crontab -e`):

```cron
0 3 * * 0 /home/hireorbitai/hireorbitai/scripts/backup-offsite.sh >> /home/hireorbitai/backups/backup-offsite.log 2>&1
```

To cap storage, add `--prune-weeks N` (deletes remote copies older than N weeks):

```cron
0 3 * * 0 /home/hireorbitai/hireorbitai/scripts/backup-offsite.sh --prune-weeks 8 >> /home/hireorbitai/backups/backup-offsite.log 2>&1
```

Env overrides: `RCLONE_REMOTE` (default `r2`), `RCLONE_DEST` (default `hireorbitai-backups`).
Use `--no-snapshot` to push the newest existing local stamp without taking a fresh dump.

---

## Restore

```bash
ls ~/backups                                  # list available stamps
bash scripts/restore.sh <stamp>               # both DB + uploads
bash scripts/restore.sh <stamp> db            # DB only
bash scripts/restore.sh <stamp> uploads       # uploads only
```

The script **refuses to run without `--force`** — restoring is a destructive operation. After confirming you really mean it:

```bash
bash scripts/restore.sh <stamp> all --force
pm2 restart hireorbit-api --update-env
```

The existing uploads directory is moved aside to `<UPLOADS_DIR>.pre-restore.<unix>` before extract — if the restored tree is bad you can roll back manually with a single `mv`.

---

## VPS-to-VPS migration

[scripts/migrate.sh](../../scripts/migrate.sh) packs the database, the uploads directory, **and**
`backend/.env` into one portable tarball so a new host comes up byte-identical — existing signed file
URLs and refresh tokens keep working because `STORAGE_URL_SECRET` / `JWT_SECRET` / `COOKIE_SECRET`
travel with the bundle.

> ⚠ **The bundle contains live secrets.** Move it only over `scp`/SSH or your **private** R2 bucket —
> never email, public links, or shared drives. It is written `chmod 600`. Delete it from every host
> **and from R2** once the new VPS is verified.

**On the OLD host** — build the bundle:

```bash
cd ~/hireorbitai
bash scripts/migrate.sh export
# → ~/migrate/hireorbitai-migrate-<stamp>.tar.gz  (db + uploads + .env)
```

Then move it to the new host with **either** transport:

**Option A — direct scp** (needs SSH between the two hosts):

```bash
scp ~/migrate/hireorbitai-migrate-<stamp>.tar.gz  hireorbitai@NEW_HOST:~/migrate/
```

**Option B — via R2** (no host-to-host SSH; reuses the rclone `r2` remote from the backup setup):

```bash
# old host: upload the newest bundle to <bucket>/migrate/
bash scripts/migrate.sh push
# new host (after rclone config): download it
bash scripts/migrate.sh pull
```

**On the NEW host** — provision per "First-time setup" above, then restore:

```bash
git clone <repo-url> ~/hireorbitai && cd ~/hireorbitai
bash scripts/migrate.sh import ~/migrate/hireorbitai-migrate-<stamp>.tar.gz          # dry run — prints the plan
bash scripts/migrate.sh import ~/migrate/hireorbitai-migrate-<stamp>.tar.gz --force  # restore db + uploads + .env

npm ci
npm run build
npm --prefix backend run migrate:up        # apply any migrations newer than the dump
pm2 start backend/ecosystem.config.cjs     # or: pm2 reload hireorbit-api --update-env
curl -fsS http://127.0.0.1:${PORT:-4000}/api/health
```

The import backs up any existing `backend/.env` to `backend/.env.pre-migrate.<unix>` and moves the live
uploads dir aside to `<UPLOADS_DIR>.pre-migrate.<unix>` before extracting — same roll-back safety as restore.

> **DB name guard:** the backend's `DB_GUARD` check keys on the database name in `DATABASE_URL`. Keep the
> same `hireorbitai_prod` / `hireorbitai_dev` naming on the new host, or set `DB_GUARD=off` in `.env`.
> Finally, **delete the bundle** everywhere: `rm ~/migrate/hireorbitai-migrate-<stamp>.tar.gz` on both
> hosts, and if you used R2, `rclone deletefile r2:hireorbitai-backups/migrate/hireorbitai-migrate-<stamp>.tar.gz`.

---

## Incident playbooks

### Symptom: clients seeing repeated HTTP 429

**Diagnosis**:

```bash
pm2 logs hireorbit-api | grep -i "ratelimit\|429"
```

**Common causes** (in order of likelihood):

1. A genuine spike — check `pm2 monit` for request volume.
2. NAT collision — many users sharing one IP, before they're signed in. The limiter is keyed by JWT `sub` post-auth, but pre-auth requests fall back to IP. See [api-conventions.md "Rate limiting"](../api-conventions.md#rate-limiting).
3. A single user's frontend stuck in a re-fetch loop. Have them clear `localStorage` and reload — that drops the stale session and breaks the loop.

**Mitigation**: temporarily raise the limit, then `pm2 restart`:

```bash
# In backend/.env
RATE_LIMIT_MAX=6000
RATE_LIMIT_WINDOW_MS=900000

pm2 restart hireorbit-api --update-env
```

### Symptom: every user gets bounced to /login

**Diagnosis**:

```bash
bash scripts/healthcheck.sh                       # is /api/ready 503?
pm2 logs hireorbit-api --err --lines 200          # look for pg-pool errors
```

**Common causes**:

- Database unreachable (`pg-pool` errors in the log). Check `systemctl status postgresql`.
- `JWT_SECRET` was rotated but the process wasn't restarted with `--update-env` — tokens get signed with one secret and verified with another.
- Refresh-token table corrupted or wiped. Check `SELECT count(*) FROM public.auth_sessions`.

**Mitigation**:

```bash
sudo systemctl restart postgresql                 # if DB is the issue
pm2 restart hireorbit-api --update-env            # picks up any env changes
```

### Symptom: file uploads succeed but downloads return 404

**Diagnosis**:

```bash
ls -la /var/lib/hireorbitai/uploads/              # ownership + permissions
curl -I https://hireorbitai.com/api/files/healthcheck
```

If the curl returns 502 → Nginx can't reach Node. If 400 → the route is up but the signature failed (expected for an unsigned request).

**Common causes**:

- `UPLOADS_DIR` permissions wrong — the PM2 user can't read the file. `chown -R hireorbitai:hireorbitai /var/lib/hireorbitai`.
- `STORAGE_URL_SECRET` was rotated, invalidating all previously-minted signed URLs. New uploads work; old links don't. Either accept this or roll back the secret.

### Symptom: invitations / password-resets / lockout emails not arriving

**Diagnosis**:

```bash
# Is the Brevo key still valid?
curl -sS https://api.brevo.com/v3/account -H "api-key: $BREVO_API_KEY" | jq .

# Did the app actually try to send?
psql "$DATABASE_URL" -c "
  SELECT action, email, metadata, created_at
    FROM auth_audit_logs
   WHERE action LIKE 'password_reset%' OR action LIKE 'admin_created%'
   ORDER BY created_at DESC LIMIT 20"
```

**Common causes**:

- Brevo domain reputation problem — check Brevo dashboard → Statistics → Transactional for bounces / spam complaints.
- SPF/DKIM/DMARC out of sync (DNS records edited without re-verifying in Brevo).
- The audit log shows `delivered: false` with a `reason` — the message field will tell you what happened.

### Symptom: 5xx on every AI endpoint

**Diagnosis**:

```bash
pm2 logs hireorbit-api | grep -i anthropic
```

**Common causes**:

- `ANTHROPIC_API_KEY` missing or revoked.
- Anthropic API outage — check https://status.anthropic.com/.
- Hit a per-minute rate limit on the API key (raise the tier in the Anthropic dashboard).

---

## Rolling back

### Code-only rollback

```bash
ssh hireorbitai@<host>
cd ~/hireorbitai
git log --oneline -20                              # find the last-known-good SHA
git checkout <sha>

cd backend && npm ci && npm run build
pm2 restart hireorbit-api --update-env

cd ../frontend && npm ci && npm run build
rsync -a --delete dist/ /home/hireorbitai/htdocs/hireorbitai.com/
```

### Code + data rollback

For a release that included a destructive migration, you need the backup taken **before** the deploy:

```bash
bash scripts/restore.sh <pre-deploy-stamp> all --force
git checkout <pre-deploy-sha>
cd backend && npm ci && npm run build
pm2 restart hireorbit-api --update-env
cd ../frontend && npm ci && npm run build
rsync -a --delete dist/ /home/hireorbitai/htdocs/hireorbitai.com/
```

---

## Routine maintenance

### Weekly

- Spot-check the previous week's audit log for anomalies (locked accounts, repeated reset requests from the same IP).
- Verify the backup cron ran every day: `ls -d ~/backups/2*/` shows seven directories.
- Verify the offsite copy is current.

### Monthly

- Patch the OS: `sudo apt update && sudo apt -y upgrade && sudo reboot` during a low-traffic window.
- Verify Let's Encrypt auto-renewal in CloudPanel.
- Review `RATE_LIMIT_MAX` against actual peak traffic.

### Per-release

- Tag the commit (`scripts/release.sh patch|minor|major` then `git push --tags`).
- Watch `pm2 logs hireorbit-api` for the first 5–10 minutes after deploy.
- Run `bash scripts/healthcheck.sh https://hireorbitai.com` against production.

---

## Capacity hints

| Resource             | Headroom on a 1 vCPU / 4 GB VPS                                                                                                                                                                               |
| -------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Postgres connections | Pool size 20; Postgres 16 default `max_connections=100` — plenty for a single-instance API.                                                                                                                   |
| `RATE_LIMIT_MAX`     | Default 3000 / 15 min / authenticated user covers the Sidebar (3 reads/min) + Messages active-thread (8 s) + page reads.                                                                                      |
| Node memory          | PM2 restarts the process at `max_memory_restart: '512M'`. Bump to `'1G'` if the AI service starts OOM'ing on large prompts.                                                                                   |
| Nginx workers        | One per CPU core. `client_max_body_size 20m` covers resume + task-attachment uploads — raise it if you raise the multer caps in [`backend/src/middleware/upload.ts`](../../backend/src/middleware/upload.ts). |
| Disk                 | Database growth ≈ 50 MB / 1000 active users; uploads dominate (≈ 200 KB / resume). Keep ≥ 20 GB free.                                                                                                         |

---

## Escalation order

When something is broken and you're not sure where to start:

1. `bash scripts/healthcheck.sh` — narrows the problem to frontend, backend, auth, or DB.
2. `pm2 logs hireorbit-api --err --lines 200` — finds backend exceptions.
3. `psql "$DATABASE_URL" -c "SELECT now()"` — confirms DB is reachable.
4. `journalctl -u nginx -n 100` — finds web-server errors.
5. The relevant **incident playbook** above.
6. Roll back to the last-known-good SHA + DB stamp.

---

## What's next

- First-time setup → [cloudpanel.md](cloudpanel.md)
- Local development → [local.md](local.md)
- System design overview → [../architecture.md](../architecture.md)
- API contract → [../api-conventions.md](../api-conventions.md)
- Branching + release flow → [../branching.md](../branching.md)
