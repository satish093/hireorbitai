# Continuous deployment (push-to-deploy)

Every commit on `main` automatically deploys to the production VPS. No SSH-ing, no `bash scripts/update.sh` by hand — push, watch the green tick in the Actions tab, done.

```
your laptop ── git push main ──▶ GitHub
                                    │
                                    ├── triggers Action (.github/workflows/deploy-production.yml)
                                    │
                                    ▼
                                  SSH into Hostinger VPS as `hireorbitai`
                                    │
                                    ▼
                                  bash scripts/update.sh
                                    │
                                    ├── git pull --ff-only
                                    ├── npm install (only if package.json changed)
                                    ├── npm run build (backend + frontend)
                                    ├── pm2 restart hireorbit-api --update-env
                                    ├── rsync dist/ → /home/hireorbitai/htdocs/hireorbitai.com/
                                    └── curl /api/healthz  ← aborts non-zero if down
```

Total runtime: 30–90 seconds. Concurrent deploys are serialised (never parallel), so two quick pushes don't race.

---

## One-time setup (10 min)

### 1. Generate a deploy SSH key

On your laptop:

```bash
ssh-keygen -t ed25519 -C "github-actions-deploy" -f ~/.ssh/hireorbitai_deploy -N ""
```

This creates `~/.ssh/hireorbitai_deploy` (private) and `~/.ssh/hireorbitai_deploy.pub` (public).

### 2. Authorize the public key on the VPS

```bash
# From your laptop
cat ~/.ssh/hireorbitai_deploy.pub | ssh hireorbitai@<vps-ip> "cat >> ~/.ssh/authorized_keys"

# Verify
ssh -i ~/.ssh/hireorbitai_deploy hireorbitai@<vps-ip> "echo ok"
# Should print "ok" with no password prompt.
```

### 3. Give the VPS its own GitHub deploy key

The Action runs `scripts/update.sh`, which calls `git pull`. The VPS needs to authenticate to GitHub without prompts.

On the VPS as `hireorbitai`:

```bash
ssh-keygen -t ed25519 -C "vps-deploy" -f ~/.ssh/id_ed25519 -N ""
cat ~/.ssh/id_ed25519.pub
```

Copy the printed `ssh-ed25519 AAAA...` line.

Then in GitHub:

1. Go to **Repo → Settings → Deploy keys → Add deploy key**.
2. **Title**: `VPS hireorbitai.com`
3. **Key**: paste the line.
4. **Allow write access**: leave **unchecked** — `git pull` is read-only.
5. **Add key**.

Switch the VPS's clone to SSH so it uses this key:

```bash
# On the VPS
cd ~/hireorbitai
git remote set-url origin git@github.com:satish093/hireorbitai.git
ssh -T git@github.com    # answer "yes" once; should respond "Hi satish093!"
git pull                  # confirm it works
```

### 4. Add the GitHub Actions secrets

Go to **Repo → Settings → Secrets and variables → Actions → New repository secret**. Add these four:

| Secret           | Value                                                                                                            |
| ---------------- | ---------------------------------------------------------------------------------------------------------------- |
| `DEPLOY_HOST`    | VPS IP (e.g. `123.45.67.89`) or hostname (`hireorbitai.com`)                                                     |
| `DEPLOY_USER`    | `hireorbitai`                                                                                                    |
| `DEPLOY_PORT`    | `22` (or whatever SSH port you use)                                                                              |
| `DEPLOY_SSH_KEY` | Output of `cat ~/.ssh/hireorbitai_deploy` — the **full** private key including the `-----BEGIN`/`-----END` lines |

GitHub encrypts secrets at rest, masks them in logs, and never exposes them to fork PRs.

### 5. Test it

Push any commit to `main`:

```bash
git commit --allow-empty -m "chore: test deploy"
git push origin main
```

Then watch:

```
https://github.com/satish093/hireorbitai/actions
```

You should see a "Deploy to production" run, taking ~60s, with a green ✓.

---

## How updates flow after setup

| Where you change something        | What happens                                                                                                              |
| --------------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| Local code → push to `main`       | GitHub Action deploys to the VPS.                                                                                         |
| Local code → push to `dev`        | Staging deploy (if you configured `STAGING_*` secrets).                                                                   |
| `.env` file on the VPS            | Run `pm2 restart hireorbit-api --update-env` manually. Env vars never leave the VPS — by design, they're not in the repo. |
| A `database/*.sql` file           | Push to `main` triggers the deploy, but **schema changes don't auto-apply**. See "Database changes" below.                |
| Manually editing files on the VPS | They survive only until the next `git pull`. Always commit + push locally instead.                                        |

---

## Database changes

Schema changes are **never** applied automatically by the deploy pipeline — that's deliberate. A bad migration is hard to roll back, and the deploy script's smoke test won't catch a corrupted table.

Workflow for a schema change:

1. Locally: edit a per-feature file under `database/`, or create a new migration under `backend/migrations/`.
2. Locally: regenerate `database/init.sql` with `npm run db:build-init` if you edited a baseline file.
3. Commit + push. The Action deploys the code but leaves the schema alone.
4. SSH into the VPS and apply the change manually:

   ```bash
   ssh hireorbitai@<vps-ip>
   cd ~/hireorbitai/backend

   # Either the migration runner:
   npm run migrate:up

   # …or a specific SQL file:
   PGPASSWORD='...' psql -h 127.0.0.1 -U hireorbitai -d hireorbitai -f ../database/<new-file>.sql
   ```

5. `pm2 restart hireorbit-api --update-env` if the new schema requires the new code.

---

## Manual deploys (always available as a fallback)

The push-to-deploy flow is just a convenience around `scripts/update.sh`. If you ever need to deploy outside the Action:

```bash
ssh hireorbitai@<vps-ip>
cd ~/hireorbitai
bash scripts/update.sh                # both halves
bash scripts/update.sh backend        # backend only
bash scripts/update.sh frontend       # frontend only
```

Or trigger the Action manually without a code change:

```
Actions tab → "Deploy to production" → "Run workflow" → Run
```

---

## Rolling back a bad deploy

The Action fails fast on a broken build or a `/api/healthz` 5xx, so a truly broken deploy never lands. But if a deploy succeeds and something turns out to be wrong:

```bash
ssh hireorbitai@<vps-ip>
cd ~/hireorbitai
git log --oneline -10                 # find the last-known-good SHA

git checkout <good-sha>
cd backend && npm ci && npm run build && pm2 restart hireorbit-api --update-env
cd ../frontend && npm ci && npm run build && rsync -a --delete dist/ ~/htdocs/hireorbitai.com/
```

For a release that included a destructive DB migration, also restore the pre-deploy backup:

```bash
bash scripts/restore.sh <pre-deploy-stamp> all --force
```

The full incident playbook is in [production.md](production.md).

---

## Security notes

- **The deploy SSH key is single-purpose.** Don't reuse it for anything else; if it leaks, you can revoke it by removing the public key from `~/.ssh/authorized_keys` on the VPS without affecting your other SSH access.
- **The GitHub deploy key is read-only** (we left "Allow write access" unchecked). It can `git pull` but it can't push back to the repo. Even if the VPS is compromised, the attacker can't corrupt the source.
- **`.env` files never leave the VPS.** Secrets stay on the box. The repo only has `.env.example` with placeholders.
- **`appleboy/ssh-action` is pinned to a specific version** (`v1.2.0`). Bumping it requires a deliberate PR — keeps a malicious release from auto-deploying.
- **Concurrent deploys are serialised.** Two quick pushes don't race `update.sh` against itself.

---

## Troubleshooting

| Symptom                                                               | Fix                                                                                                                                                         |
| --------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Action fails at "Deploy via SSH" with `permission denied (publickey)` | The `DEPLOY_SSH_KEY` secret is wrong (missing BEGIN/END lines, or wrong key). Regenerate and re-paste.                                                      |
| Action passes, but the VPS isn't updated                              | The Action ran `update.sh` on the wrong checkout. SSH in and run `git status` — you might have local uncommitted changes blocking the `git pull --ff-only`. |
| `update.sh` fails at `git pull` with `Permission denied (publickey)`  | The VPS doesn't have a GitHub deploy key. See §3 above.                                                                                                     |
| Action passes, but `/api/healthz` post-deploy curl 502s               | PM2 didn't pick up the new build. `ssh` in, `pm2 logs hireorbit-api --err`.                                                                                 |
| Deploy is slow (> 2 min)                                              | `npm install` is doing a cold install. That's normal on the first deploy after a `package-lock.json` change.                                                |
| You want to skip auto-deploy for a commit                             | Add `[skip ci]` to the commit message. GitHub Actions respects it.                                                                                          |

---

## What's next

- [cloudpanel.md](cloudpanel.md) — first-time VPS setup
- [production.md](production.md) — day-2 ops (backups, restore, incident playbooks)
- [../branching.md](../branching.md) — when to push to `main` vs `dev` vs `dev2`
