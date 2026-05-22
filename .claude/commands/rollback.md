# /rollback

Roll back production (or staging) to a previous commit.

## Quick steps

```bash
# 1. Find the last-known-good commit SHA
git log --oneline -20

# 2. Authorize the rollback (GitHub → Settings → Secrets → Actions)
#    Set ROLLBACK_APPROVED = true

# 3. Trigger rollback via GitHub Actions
#    Actions → Rollback deployment → Run workflow
#    Enter the SHA and choose production or staging

# 4. After completion: CLEAR ROLLBACK_APPROVED immediately
#    Set ROLLBACK_APPROVED = (empty or delete the secret)
```

## Manual VPS fallback

If GitHub Actions is unavailable:

```bash
ssh user@vps-ip
cd ~/hireorbitai

# Roll back to the good SHA
git fetch origin
git checkout <good-sha>          # detached HEAD

# Rebuild from the rolled-back source
npm install && npm run build

# Reload the server
pm2 reload hireorbitai-api --update-env

# Sync frontend bundle (if using CloudPanel webroot)
rsync -a --delete frontend/dist/ ~/htdocs/hireorbitai.com/

# Verify
curl https://hireorbitai.com/api/health
bash scripts/healthcheck.sh https://hireorbitai.com
```

## After a rollback

1. File a post-mortem or incident note (what broke, what SHA was good)
2. Fix the bug on the correct branch (feature/\* → dev → main)
3. Return to main branch on the VPS after the fix is deployed:
   ```bash
   git checkout main && git pull origin main
   ```
4. Clear `ROLLBACK_APPROVED` secret if not already done

## Safety contract

- `rollback.yml` is **manual-only** — never auto-triggered
- It requires `ROLLBACK_APPROVED=true` secret — without it, the workflow fails the gate step
- The production job targets the `production` GitHub environment (can require reviewers)
- The workflow never pushes code — it only checks out the target SHA and rebuilds

## See also

- Workflow file: `.github/workflows/rollback.yml`
- Detailed procedure: `docs/deployment/rollback.md`
- Backup/restore: `scripts/backup.sh`, `scripts/restore.sh`
