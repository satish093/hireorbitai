# Deployment

This file is a pointer. The canonical deployment guides live under [`docs/deployment/`](docs/deployment/).

| Where you want to go                                            | Read                                                             |
| --------------------------------------------------------------- | ---------------------------------------------------------------- |
| Run the app on your laptop                                      | [`docs/deployment/local.md`](docs/deployment/local.md)           |
| First-time production setup on a Hostinger VPS + CloudPanel     | [`docs/deployment/cloudpanel.md`](docs/deployment/cloudpanel.md) |
| Day-2 operations: deploys, backups, restore, incident playbooks | [`docs/deployment/production.md`](docs/deployment/production.md) |
| System design overview                                          | [`docs/architecture.md`](docs/architecture.md)                   |
| API contract (status codes, rate limits, signed URLs)           | [`docs/api-conventions.md`](docs/api-conventions.md)             |
| Branch model + release flow                                     | [`docs/branching.md`](docs/branching.md)                         |

## Quick links by audience

**Developer joining the project for the first time** — start with [local.md](docs/deployment/local.md). On Windows, the one-liner `scripts\dev-windows.cmd` gets you from `git clone` to a running app in under 10 minutes.

**Operator deploying to a fresh Hostinger VPS** — follow [cloudpanel.md](docs/deployment/cloudpanel.md) top to bottom. Allow ~30 minutes; every step is idempotent.

**On-call engineer chasing an incident** — [production.md](docs/deployment/production.md) has the incident playbooks for 429 storms, mass /login bounces, broken downloads, missing emails, and AI 5xx.

**Releasing a new version** — `bash scripts/release.sh patch|minor|major`, then `git push --tags`. The [release workflow](.github/workflows/release.yml) publishes a GitHub Release with the matching CHANGELOG section.
