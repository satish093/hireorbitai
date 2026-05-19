---
description: Run the full pre-commit verification — shared:build + backend + frontend typecheck + lint + tests.
---

Run the same verification matrix CI runs, in order. Stop and report at the first failure.

1. `npm run shared:build` — rebuild `@hireorbitai/shared`.
2. `npm --prefix backend run typecheck`
3. `npm --prefix frontend run typecheck`
4. `npm --prefix backend run lint`
5. `npm --prefix frontend run lint`
6. `npm --prefix backend test`

If everything passes, print "All green — safe to commit." If anything fails, print the failing command and the first ~20 lines of its output.
