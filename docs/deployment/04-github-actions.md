# 04 · GitHub Actions — secrets & variables

Three workflows are relevant:

| Workflow                | Trigger                                           | Job                                                 |
| ----------------------- | ------------------------------------------------- | --------------------------------------------------- |
| `ci.yml`                | PRs to `main`/`dev`/`dev2`; push to `main`/`dev2` | typecheck + build + e2e + audit                     |
| `dev.yml`               | push to `dev`                                     | verify:full → migrate Neon → trigger Render deploys |
| `deploy-production.yml` | push to `main`                                    | SSH → `scripts/update.sh` → health                  |

> `dev.yml` owns pushes to `dev`, so `dev` was removed from `ci.yml`'s push list
> (no double-run). PRs into `dev` still get full CI.

Set everything at **Settings → Secrets and variables → Actions**.

## Secrets (the `🔒 Secrets` tab)

### For `dev.yml` (free dev hosting)

| Secret                        | Value                                   | Where from                                |
| ----------------------------- | --------------------------------------- | ----------------------------------------- |
| `DEV_DATABASE_URL`            | Neon `hireorbit_dev` connection string  | Neon dashboard ([02](02-databases.md))    |
| `RENDER_DEPLOY_HOOK_BACKEND`  | deploy-hook URL for `hireorbit-api-dev` | Render → service → Settings → Deploy Hook |
| `RENDER_DEPLOY_HOOK_FRONTEND` | deploy-hook URL for `hireorbit-web-dev` | Render → service → Settings → Deploy Hook |

### For `deploy-production.yml` (VPS)

| Secret           | Value                                                  | Notes                    |
| ---------------- | ------------------------------------------------------ | ------------------------ |
| `DEPLOY_HOST`    | VPS IP or hostname                                     |                          |
| `DEPLOY_USER`    | `hireorbitai`                                          | the CloudPanel site user |
| `DEPLOY_PORT`    | `22`                                                   | SSH port                 |
| `DEPLOY_SSH_KEY` | **private** key, full text incl. `-----BEGIN/END-----` | see deploy key below     |

> `deploy-staging.yml` (SSH-to-staging-VPS) still exists but is dormant — it skips
> cleanly unless you set `STAGING_HOST`. Dev now lives on Render, so leave it
> alone; only set `STAGING_*` if you later want a VPS staging box too.

## Variables (the `Variables` tab — non-secret, shown in logs)

| Variable      | Value                                    | Used for                |
| ------------- | ---------------------------------------- | ----------------------- |
| `DEV_WEB_URL` | `https://hireorbit-web-dev.onrender.com` | the deploy summary link |
| `DEV_API_URL` | `https://hireorbit-api-dev.onrender.com` | the deploy summary link |

These are optional cosmetics; the pipeline runs without them.

## Generating the production SSH deploy key

On any machine (or the VPS), create a **dedicated** key for CI — don't reuse a
personal key:

```bash
ssh-keygen -t ed25519 -C "github-actions-deploy" -f deploy_key -N ""
```

- **Public** part (`deploy_key.pub`) → append to the VPS site user's
  `~/.ssh/authorized_keys`:
  ```bash
  cat deploy_key.pub | ssh hireorbitai@<VPS_IP> 'cat >> ~/.ssh/authorized_keys'
  ```
- **Private** part (`deploy_key`, the whole file) → GitHub secret `DEPLOY_SSH_KEY`.
- Delete the local `deploy_key*` files afterward.

Test it: push a trivial commit to `main` (or use **Actions → Deploy to production
→ Run workflow**) and watch the run.

## GitHub Environments (optional but recommended)

`deploy-production.yml` targets a `production` environment. Under **Settings →
Environments → production** you can add a **required reviewer** so every push to
`main` waits for a human click before deploying — a strong safety net for weekend
releases. (The deploy job pauses until approved.)

## What runs when — quick map

```
PR → dev/main         ci.yml            (typecheck, build, e2e, audit)
push → dev            dev.yml           (verify:full → migrate Neon → Render deploy)
push → main           deploy-production (SSH → update.sh → /api/health)
                      ci.yml            (also runs on main push)
```

→ Next: [05 · Deploy & rollback](05-deploy-and-rollback.md)
