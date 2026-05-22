# /release-checklist

Pre-release checklist. Run through this before every production deploy, especially weekend releases.

## 1. Verify gate (must be green)

```bash
npm run verify        # format + types + lint + backend tests
npm run verify:full   # + production build + E2E Playwright tests
```

Both must exit 0. Fix failures before proceeding.

## 2. Check branch status

```bash
git log --oneline origin/main..HEAD   # commits not yet on main
git status                            # no uncommitted changes
```

## 3. DB migrations check

If there are new files in `database/` or `backend/migrations/`:

- Document the migration step (paste into your deploy notes)
- Know the exact `psql` or `migrate:up` command to run post-deploy

```bash
git diff origin/main -- database/ backend/migrations/
```

## 4. Cut the release

```bash
npm run release   # runs scripts/release.sh
# Choose: patch / minor / major / vX.Y.Z
# Edit CHANGELOG.md when prompted
# The script commits + tags; you still must push
```

## 5. Push the tag and trigger deploy

```bash
git push origin main          # triggers deploy-production.yml
git push origin <tag>         # triggers release.yml (GitHub Release)
```

## 6. Watch the deploy

- GitHub Actions → Deploy to production → live tail
- Smoke test fires automatically: `curl https://hireorbitai.com/api/health`

## 7. Apply DB migrations (if any)

```bash
# SSH into VPS
set -a; source ~/hireorbitai/backend/.env; set +a

npm --prefix ~/hireorbitai/backend run migrate:up
# or for manual SQL:
psql "$DATABASE_URL" -f ~/hireorbitai/database/<new-file>.sql
```

## 8. Post-deploy verification

```bash
bash scripts/healthcheck.sh https://hireorbitai.com
# All checks must be green
```

## 9. Weekend release notes

- Deploy before Friday 18:00 UTC (avoids overnight incidents with no coverage)
- If deploying on Saturday/Sunday: test the rollback path BEFORE deploying
- Keep the last-good SHA noted: `git log --oneline -5`
- Keep `ROLLBACK_APPROVED` authorization process fresh in memory

## Rollback if needed

See `/rollback` or `docs/deployment/rollback.md`.

## See also

- Full checklist: `docs/deployment/weekend-release-checklist.md`
- Release script: `scripts/release.sh`
- CHANGELOG: `CHANGELOG.md`
