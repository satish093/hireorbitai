# 05 · Deploy & rollback

## Dev deploy flow (continuous)

```
feature/x  →  PR into dev  →  merge  →  (push to dev)
                                          │
                                   dev.yml runs:
                                   verify:full → migrate Neon → Render deploy
                                          │
                                   test on the Render URLs
```

Day-to-day, on Windows:

```powershell
git switch -c feature/my-thing
# …work…
npm run verify            # optional local pre-check (same gate CI runs)
git push -u origin feature/my-thing
# open a PR into dev on GitHub, get CI green, merge
```

Merging into `dev` triggers `dev.yml`. Watch **Actions → Dev**; the run summary
links the dev URLs. A red `verify`/`verify:full` step means **nothing deployed** —
fix and push again.

## Weekend production release flow

Production is **push-to-main**, and only that. Do it deliberately.

```
dev (tested on Render)  →  PR: dev → main  →  CI green  →  merge/push to main
                                                              │
                                            deploy-production.yml runs:
                                            SSH → update.sh (pull, build, migrate, pm2 reload)
                                                              │
                                            curl https://hireorbitai.com/api/health
```

Steps (see the [checklist](07-weekend-release-checklist.md) for the full version):

1. Confirm the change is verified on the **Render dev** environment.
2. Open a PR `dev → main`. Let `ci.yml` go green.
3. Check for new migrations:
   ```powershell
   git diff --stat origin/main...dev -- database backend/migrations
   ```
4. Merge the PR (or `git push origin dev:main` if that's your promote habit).
   - If you enabled the `production` GitHub Environment reviewer ([04](04-github-actions.md)),
     approve the deploy when prompted.
5. `deploy-production.yml` SSHes in and runs `scripts/update.sh`, which **also runs
   `migrate:up`** — so migrations under `backend/migrations/` apply automatically.
   A migration that only exists as a `database/*.sql` file must be applied by hand
   (see below).
6. Verify: the workflow's post-deploy step curls `/api/health`; also run
   `bash scripts/healthcheck.sh https://hireorbitai.com` from the VPS or locally.

### Applying a `database/*.sql` migration by hand

`update.sh` runs `backend/migrations/` automatically but **not** files that only
live in `database/`. For those, on the VPS:

```bash
set -a; source ~/hireorbitai/backend/.env; set +a
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f ~/hireorbitai/database/<new-file>.sql
```

(The repo's `apply-migration` skill / `/check-deploy` shows what's queued.)

## Rollback

### Backend / frontend code rollback

The fastest, safest rollback is **redeploy the previous good commit**:

```bash
# On the VPS:
cd ~/hireorbitai
git log --oneline -n 10            # find the last-good SHA
git revert <bad-sha>               # preferred: a forward-fix commit
git push                           # to main → re-triggers deploy-production.yml
```

Or pin and rebuild directly on the box (no history rewrite):

```bash
cd ~/hireorbitai
git checkout <last-good-sha>
bash scripts/update.sh             # rebuild + pm2 reload from that SHA
# when ready, return to the branch tip: git checkout main
```

PM2 keeps the previous process alive until the new build is ready; a failed build
in `update.sh` aborts before the restart, so a broken build never takes prod down.

> Never `--force` push to `main` to "undo" — use `git revert`. The settings
> allowlist blocks force-push for this reason.

### Database rollback

```bash
cd ~/hireorbitai
ls ~/backups                       # pick a stamp from before the bad deploy
bash scripts/restore.sh <stamp> db --force
pm2 restart hireorbitai-api --update-env
```

For a single bad migration, `npm --prefix backend run migrate:down` reverts the
last one (only if it has a `down` block). When in doubt, restore the pre-deploy
backup — that's why `update.sh` deploys are paired with the daily `backup.sh` cron.

### Dev rollback

Dev is disposable: push a fix to `dev`, or run a [dev reset](06-fresh-reset.md).

→ Next: [06 · Fresh deployment / reset](06-fresh-reset.md)
