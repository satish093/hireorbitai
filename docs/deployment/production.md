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

## Backups & migration (`scripts/ops.sh`)

One operator tool covers off-site backups, restore drills, and host migration. It wraps the low-level
primitives ([backup.sh](../../scripts/backup.sh), [restore.sh](../../scripts/restore.sh)) with memorable verbs.

| Verb                                                | What it does                                                                                                                                    |
| --------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| `ops.sh setup`                                      | Installs rclone, configures the **Mega** remote from your email/password, creates the folder, and installs the weekly cron. Turnkey — run once. |
| `ops.sh backup [--prune-weeks N]`                   | Snapshot the DB + uploads locally, then copy the stamp off-site. This is what the weekly cron runs.                                             |
| `ops.sh verify`                                     | Restore-drill: loads the newest dump into a throwaway DB and prints canary row counts. Proves backups aren't silently broken.                   |
| `ops.sh ship`                                       | Build a migration bundle (db + uploads + **`.env`**) and push it off-site. Run on the OLD host.                                                 |
| `ops.sh land [name\|path] --force`                  | Pull/import a bundle, then `npm ci && build && migrate:up && pm2`. One command on the NEW host.                                                 |
| `ops.sh restore <stamp> [db\|uploads\|all] --force` | Restore a local backup (passthrough to `restore.sh`).                                                                                           |

Off-site target is **[Mega](https://mega.nz)** — 20 GB free, **no credit card**, and rclone configures it
non-interactively from an email + password (so the auto-setup below stays fully hands-off). Any rclone
remote works via `RCLONE_REMOTE` / `RCLONE_DEST` if you prefer another provider.

### One-time setup — auto-wired on deploy (recommended)

Create a free account at [mega.nz](https://mega.nz) (use a dedicated account for backups, not your personal
one). Add the credentials to **`backend/.env` on the VPS** (it's gitignored — never committed):

```dotenv
MEGA_EMAIL=backups@example.com
MEGA_PASSWORD=...
```

That's the only manual step. On the **next push to `main`**, `scripts/update.sh` calls `ops.sh ensure`,
which idempotently creates the rclone `mega:` remote, the destination folder, and the weekly cron — so
backups stay wired across every deploy. rclone must be installed once (`curl https://rclone.org/install.sh | sudo bash`,
or run `ops.sh setup`); after that, deploys handle the rest. The installed cron (Sunday 03:00, prunes >8 weeks):

```cron
0 3 * * 0 /home/hireorbitai/hireorbitai/scripts/ops.sh backup --prune-weeks 8 >> /home/hireorbitai/backups/ops.log 2>&1
```

**Manual / first-time alternative** (also installs rclone, prompts if `MEGA_*` aren't in `.env` yet):

```bash
bash scripts/ops.sh setup     # installs rclone + configures Mega + weekly cron
bash scripts/ops.sh backup    # test it — should appear under: rclone lsf mega:hireorbitai-backups
```

### Verify a backup is restorable

```bash
bash scripts/ops.sh verify
# Creates hireorbitai_verify_<ts> (via sudo→postgres), loads the newest dump,
# prints row counts for users/recruiters/consultants/jobs/applications, then drops it.
```

### Migrate to a new VPS

The migration bundle is db + uploads + **`.env`**, so the new host comes up byte-identical — existing
signed file URLs and refresh tokens keep working because `STORAGE_URL_SECRET` / `JWT_SECRET` /
`COOKIE_SECRET` travel with it.

> ⚠ **The bundle holds live secrets.** It moves only over your private Mega account (or `scp`), is written
> `chmod 600`, and `land`/`ship` remind you to delete it from every host **and** the remote once verified.

```bash
# OLD host:
bash scripts/ops.sh ship                       # bundle → Mega (prints scp fallback too)

# NEW host (provisioned per "First-time setup", repo cloned):
bash scripts/ops.sh setup                      # so rclone can reach Mega
bash scripts/ops.sh land                       # dry run — prints what it will do
bash scripts/ops.sh land --force               # pull + restore db/uploads/.env + npm ci/build/migrate/pm2
```

No host-to-host SSH needed (the bundle rides through Mega). For a direct transfer instead, `ship` prints an
`scp` command and `land` accepts a local path: `ops.sh land ~/migrate/<bundle>.tar.gz --force`.

`land` backs up any existing `backend/.env` to `.pre-migrate.<unix>` and moves the live uploads dir aside to
`<UPLOADS_DIR>.pre-migrate.<unix>` before extracting — same roll-back safety as `restore`.

> **DB name guard:** `DB_GUARD` keys on the database name in `DATABASE_URL`. Keep the new host's db named
> `hireorbitai*`, or set `DB_GUARD=off` in `.env`.

### Primitives (advanced / manual)

`scripts/backup.sh` writes `~/backups/<UTC-stamp>/{db.sql.gz, uploads.tar.gz, manifest.txt}` (no off-site,
no prune). `scripts/restore.sh <stamp> [db|uploads|all] --force` restores one stamp with move-aside
rollback. `ops.sh` is the front door; reach for these only when you need a step in isolation.

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
