# Production runbook

Operational reference once the app is live. For first-time setup, see [cloudpanel.md](cloudpanel.md).

## Routine deploys

```bash
ssh hireorbitai@<host>
cd ~/hireorbitai
bash scripts/update.sh              # git pull + build + pm2 restart + smoke
```

The script aborts on:

- Non-zero `git pull` exit (merge conflicts, detached HEAD).
- Backend / frontend build failure.
- A failing smoke curl against `/api/healthz` after restart.

If any of the above happens, run [`scripts/restore.sh <stamp>`](../../scripts/restore.sh) or roll back manually with `git reset --hard <previous-sha>` + rebuild.

## Health surface

| Endpoint                    | What it tells you                                                                  |
| --------------------------- | ---------------------------------------------------------------------------------- |
| `GET /api/healthz`          | The Node process is alive and serving traffic. Cheap.                              |
| `GET /api/ready`            | The DB pool is reachable (`SELECT 1`). Suitable for orchestrator readiness probes. |
| `GET /api/feature-flags/me` | The auth pipeline + DB read paths are working end-to-end. Auth-gated.              |

`scripts/healthcheck.sh` exercises all three plus a TLS check.

## Logs

```bash
pm2 logs hireorbit-api               # tail (last 1000 lines + follow)
pm2 logs hireorbit-api --lines 5000  # bigger backlog
pm2 logs hireorbit-api --err         # stderr only
journalctl -u nginx -n 200           # Nginx
tail -n 200 /var/log/nginx/access.log
tail -n 200 /var/log/nginx/error.log
```

Pino emits structured JSON. Pipe through `pino-pretty` for human reading:

```bash
pm2 logs hireorbit-api --raw | pino-pretty
```

## Backups

```bash
bash scripts/backup.sh         # writes ~/backups/<UTC-stamp>/{db.sql.gz, uploads.tar.gz}
ls -lhS ~/backups | head        # newest first
bash scripts/restore.sh <stamp> # restore both db + uploads from a stamp
```

Cron-schedule daily:

```cron
0 3 * * * /home/hireorbitai/hireorbitai/scripts/backup.sh >> /home/hireorbitai/backups/backup.log 2>&1
```

Retention is the operator's responsibility — `backup.sh` doesn't auto-prune. A reasonable policy:

```cron
0 4 * * * find /home/hireorbitai/backups -mindepth 1 -maxdepth 1 -type d -mtime +14 -exec rm -rf {} +
```

## Incidents

### Symptom: 429 storm in browser dev tools

1. Check `pm2 logs hireorbit-api | grep RateLimit-`. If the limiter is firing on `/auth/me` / `/auth/sync` for a single user, that user's `lastLoadedUserId` may have stuck. Have them clear localStorage and re-login.
2. If multiple users hit, check NAT / proxy keying — the limiter decodes the JWT in [`server.ts`](../../backend/src/server.ts), but if the JWT is unparseable for some reason it falls back to IP. Inspect `RateLimit-*` response headers.
3. Temporary mitigation: bump `RATE_LIMIT_MAX` in `.env` and `pm2 restart hireorbit-api --update-env`.

### Symptom: every user gets bounced to /login

1. `bash scripts/healthcheck.sh` — is `/api/ready` returning 503? DB unreachable.
2. `pm2 logs hireorbit-api --err --lines 200` — look for `pg-pool` errors.
3. If `/api/healthz` is 200 but auth is broken, check `JWT_SECRET` — if it was rotated without `pm2 restart --update-env`, the process is signing tokens with the old secret and verifying with the new one.

### Symptom: file uploads succeed but downloads 404

1. Verify `UPLOADS_DIR` exists and is owned by the PM2 user.
2. Verify Nginx isn't blocking the path: `curl -I https://hireorbitai.com/api/files/healthcheck` should return 400 (signed-URL validation), not 502 (Nginx can't reach Node).

### Symptom: emails not arriving

1. Check Brevo dashboard → Statistics → Transactional. Look for bounces / spam complaints.
2. `curl -sS https://api.brevo.com/v3/account -H "api-key: $BREVO_API_KEY"` — the key still works?
3. Check the audit log: `psql "$DATABASE_URL" -c "SELECT * FROM auth_audit_logs WHERE action LIKE 'password_reset%' ORDER BY created_at DESC LIMIT 20"`.

## Rolling back

```bash
ssh hireorbitai@<host>
cd ~/hireorbitai
git log --oneline -20             # find the last-known-good commit
git checkout <sha>
cd backend && npm ci && npm run build && pm2 restart hireorbit-api --update-env
cd ../frontend && npm ci && npm run build && rsync -a --delete dist/ ~/htdocs/hireorbitai.com/
```

For a DB-touching release that needs a data rollback too, use `scripts/restore.sh <stamp>` against a backup taken before the deploy.

## Capacity hints (rough)

| Resource             | Headroom                                                                                                                                                               |
| -------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Postgres connections | Pool size 20; ~150 connections idle on Postgres 16's defaults — plenty for the single-node deployment.                                                                 |
| `RATE_LIMIT_MAX`     | Default 3000 / 15-min / user — supports an active Sidebar (3 reads/min) + Messages (8s active thread).                                                                 |
| Node memory          | PM2 restarts the process at `max_memory_restart: '512M'`.                                                                                                              |
| Nginx workers        | Default 1 worker / core. Increase `client_max_body_size` if you raise the upload caps in [`backend/src/middleware/upload.ts`](../../backend/src/middleware/upload.ts). |
