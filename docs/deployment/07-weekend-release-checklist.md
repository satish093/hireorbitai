# 07 · Weekend release checklist

Copy this into the PR description or an issue and tick as you go. The whole point:
**production only changes on a deliberate push to `main`, after it's proven on dev.**

## Friday/Saturday — stage on dev

- [ ] All intended work merged to `dev` (via PRs, CI green).
- [ ] `dev.yml` run is **green** (verify:full passed → Render deployed).
- [ ] Smoke-tested on the dev URLs:
  - [ ] Frontend loads: `https://hireorbit-web-dev.onrender.com`
  - [ ] Backend healthy: `https://hireorbit-api-dev.onrender.com/health`
  - [ ] Logged in, exercised the changed feature end-to-end.
- [ ] Any new migration was created under `backend/migrations/` (not just `database/`).

## Pre-flight — what's queued for prod

- [ ] Review the diff going to prod:
  ```powershell
  git fetch origin
  git log --oneline origin/main..origin/dev
  ```
- [ ] List migrations that will apply:
  ```powershell
  git diff --stat origin/main...origin/dev -- backend/migrations database
  ```
- [ ] Note any `database/*.sql`-only file → must be applied **by hand** post-deploy.
- [ ] A recent production backup exists (`ls ~/backups` on the VPS, or run `bash scripts/backup.sh`).

## Release — push to main

- [ ] Open PR `dev → main`; wait for `ci.yml` green.
- [ ] Merge the PR (or `git push origin dev:main`).
- [ ] If the `production` GitHub Environment requires approval → approve in **Actions**.
- [ ] Watch **Actions → Deploy to production** finish green (it runs
      `update.sh`: pull → build → `migrate:up` → `pm2 reload` → `/api/health`).

## Post-deploy verification

- [ ] Workflow's post-deploy smoke step is green.
- [ ] Independent check:
  ```bash
  bash scripts/healthcheck.sh https://hireorbitai.com
  ```
- [ ] Apply any `database/*.sql`-only migration on the VPS:
  ```bash
  set -a; source ~/hireorbitai/backend/.env; set +a
  psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f ~/hireorbitai/database/<file>.sql
  ```
- [ ] Spot-check the changed feature on `https://hireorbitai.com`.
- [ ] Tail logs briefly for errors: `pm2 logs hireorbitai-api --lines 100`.

## If something's wrong — rollback

- [ ] Code: `git revert <bad-sha>` → push to `main` (re-deploys). _Never_ force-push.
- [ ] DB: `bash scripts/restore.sh <pre-deploy-stamp> db --force` then
      `pm2 restart hireorbitai-api --update-env`.
- [ ] Full detail in [05 · Deploy & rollback](05-deploy-and-rollback.md).

## Golden rules

- Production deploys **only** via push to `main`. Nothing else can reach prod.
- Never run `scripts/reset-prod.sh` as part of a release — it's a separate,
  deliberate wipe (see [06](06-fresh-reset.md)).
- `dev` is disposable; `main` is sacred. Test on dev first, every time.
- A red CI/verify step means **stop** — it already prevented a bad dev deploy;
  don't route around it for prod.
