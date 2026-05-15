# Branching strategy

HireOrbit AI uses a three-branch model. Each branch has a clearly defined audience and merge direction.

```
        feature/* ─┐
                   ├──► dev2 ──► dev ──► main
        fix/*     ─┘
```

## Branches

### `main` — production

- Reflects what's currently live at `hireorbitai.com`.
- **Protected**: no direct commits, no force-push, no rebase. Merges only.
- Every merge must come from `dev` via a green CI run + at least one reviewer.
- Tagged on every production deploy: `v0.1.0`, `v0.2.0`, …

### `dev` — staging / integration

- The default base for any feature / fix PR aimed at a near-term release.
- Should always be deployable; broken builds here block the next cut.
- CI runs typecheck + build on every push.
- Merged into `main` when a release is ready.

### `dev2` — experimental / refactor

- Long-running changes that take longer than one sprint: large migrations, architecture rewrites, performance work, infrastructure experiments.
- Allowed to be temporarily broken in ways that `dev` is not.
- Periodically rebased on top of `dev` so the eventual merge isn't painful.
- Merges back into `dev` (not `main`) once the experiment has stabilised.

## Topic branches

Short-lived branches that target `dev` (or, for a rewrite, `dev2`):

- `feat/<scope>-<short-slug>` — new feature
- `fix/<scope>-<short-slug>` — bug fix
- `chore/<scope>-<short-slug>` — tooling / docs / non-functional
- `hotfix/<scope>-<short-slug>` — emergency fix targeting `main` directly (must also be backported to `dev`)

Examples:

```
feat/training-quiz-attempts
fix/auth-refresh-cooldown
chore/deps-bump-node-22
hotfix/jobs-429-storm
```

## Commit conventions

We follow a relaxed [Conventional Commits](https://www.conventionalcommits.org/) style:

```
<type>(<scope>): <subject>
```

Types: `feat`, `fix`, `chore`, `docs`, `refactor`, `perf`, `test`, `build`, `ci`, `revert`.

Examples:

```
feat(training): add quiz attempt tracking
fix(api): debounce login redirect on burst 401s
docs(deploy): split DEPLOY.md into per-target guides
refactor(auth): collapse loadProfile inflight + cooldown into one ref
```

Body is optional. When present, explain **why**, not what — the diff already shows what.

## Pull request workflow

1. Branch off `dev` (or `dev2` for a long-running rewrite).
2. Push your branch; open a PR against the same base.
3. Fill out [the PR template](../.github/PULL_REQUEST_TEMPLATE.md) — every box matters.
4. Wait for the CI job ([.github/workflows/ci.yml](../.github/workflows/ci.yml)) to go green.
5. Request review from a [code owner](../.github/CODEOWNERS).
6. Squash-merge when approved. Delete the topic branch.

## Release workflow

When `dev` is ready for production:

1. Open a PR from `dev` → `main`. Title: `release: v0.X.0 — <one-line summary>`.
2. Body: bulleted changelog. Reference the version section in `CHANGELOG.md`.
3. Merge after CI + review (no squash — keep the merge commit so the release is visible in `git log --first-parent main`).
4. Tag the merge commit: `git tag -a v0.X.0 -m "v0.X.0" && git push --tags`.
5. Deploy: `bash scripts/deploy.sh` on the VPS (see [docs/deployment/cloudpanel.md](deployment/cloudpanel.md)).
6. Smoke-test the production smoke endpoints listed in `docs/deployment/production.md` §6.

## Hotfix workflow

Production is broken and `dev` has uncommitted/untested work that can't ship:

1. Branch `hotfix/<slug>` off `main`.
2. Fix + open PR against `main`.
3. After merge, **also** cherry-pick or merge the same commit into `dev` so future releases don't regress the fix.
4. Bump the patch version (`v0.X.Y` → `v0.X.Y+1`) and deploy.

## Branch protection (recommended GitHub settings)

| Branch | Require PR | Require status checks | Require reviewers | Allow force-push | Allow deletion |
| ------ | ---------- | --------------------- | ----------------- | ---------------- | -------------- |
| `main` | ✓          | ✓ (CI)                | 1                 | ✗                | ✗              |
| `dev`  | ✓          | ✓ (CI)                | 1                 | ✗                | ✗              |
| `dev2` | optional   | ✓ (CI)                | optional          | ✓ (rebases)      | ✗              |
