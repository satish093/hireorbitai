---
description: Run the full pre-commit verification — shared:build + backend + frontend typecheck + lint + tests.
---

Run the same verification matrix CI runs. The single composed gate is the root `verify` script:

```
npm run verify
```

which runs, in order and stopping at the first failure:

1. `npm run format:check` — Prettier check across the repo.
2. `npm run typecheck` — `shared:build` then backend + frontend `tsc --noEmit`.
3. `npm run lint` — backend + frontend ESLint (`--max-warnings 0`).
4. `npm --prefix backend test` — Vitest (unit + security pattern-guard tests).

For the full pre-release pass (adds production build + Playwright UI smoke tests), run `npm run verify:full`. The browser suite needs a one-time `npx --prefix frontend playwright install chromium`.

If everything passes, print "All green — safe to commit." If anything fails, print the failing command and the first ~20 lines of its output.
