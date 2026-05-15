# Contributing to HireOrbit AI

Thanks for working on HireOrbit. This is a quickstart; the canonical documents are:

- [docs/branching.md](docs/branching.md) — branch model, PR / release / hotfix workflows
- [docs/architecture.md](docs/architecture.md) — system overview, layer responsibilities, technical debt
- [docs/deployment/local.md](docs/deployment/local.md) — local dev setup
- [docs/deployment/cloudpanel.md](docs/deployment/cloudpanel.md) — production deploy on CloudPanel + VPS
- [docs/deployment/production.md](docs/deployment/production.md) — ops runbook (deploys, backups, incidents, rollback)

If anything below drifts from those, the docs/\* version is the source of truth.

## Branch model (summary — see [docs/branching.md](docs/branching.md) for full rules)

```
feature/* ─┐
fix/*      ├──▶ dev2 (or dev) ──▶ dev ──▶ main
chore/*    ─┘
```

| Branch | Purpose                                                               | Deploys to        |
| ------ | --------------------------------------------------------------------- | ----------------- |
| `main` | Production. Every commit is shippable. Tagged for releases.           | `hireorbitai.com` |
| `dev`  | Release candidate. What we'll ship to prod next. UAT happens here.    | staging           |
| `dev2` | Long-running experimental work — large migrations, rewrites.          | dev preview       |
| topic  | Short-lived: `feat/...`, `fix/...`, `chore/...`. Branched from `dev`. | —                 |

**Hotfix exception:** for prod-down bugs, branch `hotfix/<slug>` from `main`, PR back to `main` AND forward-port to `dev`.

## Commit messages

Plain English, present tense, lowercase verb. Body explains the **why**, not the what.

```
add feature flag enforcement on /tasks router

Without backend enforcement a savvy user could call the API directly and
bypass the flag. Adds requireFeature middleware that mirrors the
frontend's effectiveFlagsForUser logic.
```

We don't enforce Conventional Commits — readability beats prefixes.

## PR rules

- Target the right branch (see flow above). PRs into `main` from anywhere except `dev` or `hotfix/*` will be closed.
- One logical change per PR. If you find unrelated cleanup, open a separate PR.
- Fill out the PR template — especially the **Test plan** and **Risk / rollback** sections.
- CI must be green. Failing typecheck or build blocks merge.
- Get 1 approval. Self-merge is fine for owner-only changes to `dev2`.

## Local development

See [docs/deployment/local.md](docs/deployment/local.md) for the full walkthrough. TL;DR:

```bash
git clone https://github.com/<you>/hireorbitai && cd hireorbitai
nvm use

# Backend
cd backend && cp .env.example .env && npm ci && npm run build
npm run bootstrap:admin     # requires DEFAULT_ADMIN_EMAIL + DEFAULT_ADMIN_PASSWORD in .env
npm run dev                 # http://localhost:4000

# Frontend (in another terminal)
cd ../frontend && cp .env.example .env && npm ci && npm run dev
```

### Useful scripts

| Command                   | What it does                            |
| ------------------------- | --------------------------------------- |
| `npm run dev`             | Watch mode (backend or frontend)        |
| `npm run typecheck`       | TS compile check, no emit               |
| `npm run build`           | Production build                        |
| `npm run start:prod`      | Run the built backend (no `--env-file`) |
| `npm run bootstrap:admin` | Re-create the default admin user        |

## Code style

- TypeScript strict mode is on; new code must typecheck clean.
- Default to no comments. Only add one when the **why** is non-obvious — a hidden constraint, a workaround, surprising behavior.
- Prefer editing existing files over creating new ones.
- No new dependencies without a one-line justification in the PR body.

## Security

- Never commit a `.env` file. The `.gitignore` blocks it; if your editor saves a backup like `.env~`, add a rule.
- Never paste real API keys, service-role keys, or production secrets into PR bodies, issue comments, or chat. Rotate immediately if you do.
- Vulnerabilities go through GitHub Security Advisories (see `SECURITY.md`), not public issues.

## Questions

Open a discussion on this repo, or ping the maintainers.
