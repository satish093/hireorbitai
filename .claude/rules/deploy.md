---
name: deploy
description: Branch + deploy + migration discipline for the VPS.
---

# Deploy rules

## Production deploys are pull-based (VPS cron)

GitHub's runners **can't** SSH into the hardened VPS — the firewall drops their
rotating IPs (`dial tcp … i/o timeout`), and the repo is public (self-hosted
runner unsafe) so allow-listing GitHub's 6500+ CIDRs isn't an option. So
push-to-deploy via the GH Action is **disabled**; the **VPS pulls** instead: a
cron runs `scripts/auto-pull.sh` every ~3 min and, when `origin/main` advances,
runs the normal `scripts/update.sh` (build + migrate + pm2 reload + smoke).

So: **push to `main` → auto-deploys within ~3 min.** Pushing to `main` is still
the deploy action and needs explicit user authorization. Working branches
(`feat/*`, `fix/*`) don't auto-deploy. `.github/workflows/deploy-production.yml`
is kept `workflow_dispatch`-only (manual) and no longer auto-runs.

**Manual / immediate deploy** (don't wait for the cron) — SSH and run it:

```bash
ssh -i ~/.ssh/hireorbitai_vps hireorbitai@72.60.172.41
cd ~/hireorbitai && bash scripts/update.sh
```

## Never `--force` push to main

If a force-push is the answer, the question is wrong. The settings allowlist denies `git push --force:*` and `git push -f:*` globally; do not bypass.

## Post-deploy migrations

After every promote, check whether the new commit added a file under `database/` or `backend/migrations/`. If so, the user must apply it on the VPS:

```bash
set -a; source ~/hireorbitai/backend/.env; set +a
psql "$DATABASE_URL" -f ~/hireorbitai/database/<new-file>.sql
# or
npm --prefix ~/hireorbitai/backend run migrate:up
```

Don't attempt to run psql or ssh from the agent. The deny-list blocks both.

## PM2 + scripts/update.sh

The cron (`scripts/auto-pull.sh`) calls `scripts/update.sh`, which does `git checkout -- .` (resets stale changes incl. the VPS's rewritten `package-lock.json`) + `git pull --ff-only` + `npm install && npm run build` + `migrate:up` + `pm2 reload` + a smoke test. It also runs migrations automatically — `migrate:up` is part of every deploy, so a new `backend/migrations/*.sql` applies on the next deploy with no manual step. Manual `psql` is only needed for the historical `database/*.sql` baseline files.

## Conventional Commits

The commit-msg hook warns (not enforces) on non-Conventional messages. Types: `feat fix chore docs refactor perf test build ci revert release`. Use scopes (`fix(messages):`, `feat(tasks):`) — they show up in the auto-generated changelog grouping.
