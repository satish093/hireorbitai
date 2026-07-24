---
description: Show what's queued for the next push to main — commits, changed migrations, pending env vars.
---

Inspect the local working branch vs `main` (or the `hireorbitai/main` remote) and report:

1. Output of `git log --oneline hireorbitai/main..HEAD` — every commit that would ship.
2. Files matching `database/*.sql` or `backend/migrations/*.sql` in those commits — these need manual `psql` application on the VPS after deploy.
3. Whether `backend/.env.example` or `frontend/.env.example` changed — those mean new env vars are required.
4. Whether `package-lock.json` files at any level changed — that means a fresh `npm ci` after deploy.

Don't push. Just summarize what would ship and what post-deploy steps are needed.
