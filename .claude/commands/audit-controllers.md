---
description: Sweep backend controllers for IDOR / mass-assignment patterns matching the ones already fixed.
---

Walk every file under `backend/src/controllers/*.controller.ts` and report any handler that:

1. Calls `db.from('X').update(req.body)` or `db.from('X').insert({ ...req.body })` **without** a Zod `.strict()` schema gating the body first.
2. Calls `db.from('X').update(...).eq('id', req.params.id)` **without** a preceding ownership check (load row + verify `req.user`).
3. Mounts on a route without `requireRole(...)` upstream, when the resource is not public.
4. Uses `.ilike('email', ...)` on user-supplied email (should be `.eq` after `.toLowerCase()`).
5. Interpolates `req.query.q` directly into a `.or()` template string without escaping `%`, `_`, `,`, `(`, `)`.

Output one row per finding: file, line, pattern, severity (HIGH if mutation, MEDIUM if read-leak). Stop at the first scan — don't fix anything in this command, just report. The user will decide what to patch.

Use `.claude/rules/security.md` as the canonical reference for what "safe" looks like.
