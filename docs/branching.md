# Branching strategy

HireOrbit AI now uses a two-branch model.

```
        feature/* ─┐
                   ├──► dev ──► main
        fix/*     ─┘
```

## Branches

### `main` — production

- Reflects what is currently live at `hireorbitai.com`.
- Every push to `main` triggers the production deploy workflow.
- Recommended protection: require PRs, CI, at least one reviewer, and no force-push.
- Tagged on production releases: `v0.1.0`, `v0.2.0`, and so on.

### `dev` — development / integration

- The default base for feature and fix PRs.
- Every push to `dev` runs the dev pipeline: verification, dev DB migration, and Render deploy hooks.
- Should stay deployable; broken builds here block the next release.
- Merged into `main` when a release is ready.

## Topic branches

Short-lived branches target `dev`:

- `feat/<scope>-<short-slug>` — new feature
- `fix/<scope>-<short-slug>` — bug fix
- `chore/<scope>-<short-slug>` — tooling, docs, or non-functional work
- `hotfix/<scope>-<short-slug>` — emergency fix targeting `main` directly, then backported to `dev`

Examples:

```
feat/training-quiz-attempts
fix/auth-refresh-cooldown
chore/deps-bump-node-22
hotfix/jobs-429-storm
```

## Commit conventions

Use a relaxed Conventional Commits style:

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

Body is optional. When present, explain why; the diff already shows what.

## Pull request workflow

1. Branch off `dev`.
2. Push your branch and open a PR against `dev`.
3. Fill out [the PR template](../.github/PULL_REQUEST_TEMPLATE.md).
4. Wait for CI to go green.
5. Request review from a [code owner](../.github/CODEOWNERS).
6. Squash-merge when approved. Delete the topic branch.

## Release workflow

When `dev` is ready for production:

1. Open a PR from `dev` to `main`. Title: `release: v0.X.0 - <one-line summary>`.
2. Body: bulleted changelog. Reference the version section in `CHANGELOG.md`.
3. Merge after CI and review.
4. Tag the merge commit: `git tag -a v0.X.0 -m "v0.X.0" && git push --tags`.
5. Production deploy runs from `.github/workflows/deploy-production.yml`.
6. Smoke-test production with `bash scripts/healthcheck.sh https://hireorbitai.com`.

## Hotfix workflow

Production is broken and `dev` has untested work that cannot ship:

1. Branch `hotfix/<slug>` off `main`.
2. Fix and open a PR against `main`.
3. After merge, cherry-pick or merge the same commit into `dev`.
4. Bump the patch version (`v0.X.Y` to `v0.X.Y+1`) and let the production deploy run.

## Branch protection

| Branch | Require PR | Require status checks | Require reviewers | Allow force-push | Allow deletion |
| ------ | ---------- | --------------------- | ----------------- | ---------------- | -------------- |
| `main` | yes        | yes                   | 1                 | no               | no             |
| `dev`  | yes        | yes                   | 1                 | no               | no             |
