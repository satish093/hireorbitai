---
name: deploy
description: Branch + deploy + migration discipline for the VPS.
---

# Deploy rules

## Production deploys are push-to-main

`.github/workflows/deploy-production.yml` is gated on:

```yaml
on:
  push:
    branches: [main]
```

Working branches (`chore/full-refactor`, `feat/*`, `fix/*`) do **not** auto-deploy. Pushing to a working branch is safe to do without confirmation; pushing to `main` is the deploy action and always needs explicit user authorization.

The canonical promote command is:

```bash
git push hireorbitai chore/full-refactor:main
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

The deploy GH Action calls `scripts/update.sh` over SSH, which does `git checkout -- .` (resets stale changes) + `git pull` + `npm ci && npm run build` + `pm2 reload`. If a deploy fails because of a "your local changes would be overwritten" error, the fix is in `update.sh` — don't ssh in and manually reset the worktree.

## Conventional Commits

The commit-msg hook warns (not enforces) on non-Conventional messages. Types: `feat fix chore docs refactor perf test build ci revert release`. Use scopes (`fix(messages):`, `feat(tasks):`) — they show up in the auto-generated changelog grouping.
