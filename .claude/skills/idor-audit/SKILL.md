---
name: idor-audit
description: Auto-invoke when the user asks for an IDOR / authorization audit, or when a new controller is added under backend/src/controllers/. Sweeps for mass-assignment + missing ownership checks in the patterns previously seen in this codebase.
trigger:
  - 'audit controllers'
  - 'check for IDORs'
  - 'security review of controllers'
  - 'new controller'
---

# IDOR audit skill

This codebase has been swept for IDORs once already. Seven findings were closed (consultants PATCH, applications cluster, interviews cluster, training upload, admin lockout, ILIKE auth, reminders cluster). The patterns are now established. Any _new_ controller — especially anything generated, copy-pasted, or scaffolded — must be checked against the same shape.

## What to check

For every file under `backend/src/controllers/*.controller.ts` (or just the file the user names):

1. **Mass-assignment.** Search for `update(req.body)` or `insert({ ...req.body })`. If the body isn't parsed against a `.strict()` Zod schema first, that's a HIGH finding.
2. **Missing ownership.** For every handler with `req.params.id` reaching a `.eq('id', req.params.id)` clause:
   - Is there a preceding row-load + `req.user` ownership check?
   - Does it throw `httpError(404, 'Not found')` (preferred) rather than 403 on failure, to avoid an existence oracle?
3. **Missing role gate.** Cross-reference the matching `routes/*.routes.ts`. Does the route have `requireRole(...)`? `requireAuth` alone is **not** enough for write surfaces.
4. **Admin lifecycle.** If the controller mutates `users.status` / `users.group_id` / triggers a password reset, does it call both `assertOutranks(...)` and `assertNotLastSuperAdmin(...)`? Mirror `adminUsers.controller.ts`.
5. **Email lookup.** `.ilike('email', ...)` is wrong — should be `.eq('email', email.toLowerCase())`.

## Output

Per finding: file, line range, severity (HIGH / MEDIUM), the specific pattern, and a one-line fix that mirrors the existing safe patterns in the codebase. Don't modify code in this skill — just produce the report.

## Canonical safe patterns

- Ownership preflight: `backend/src/controllers/applications.controller.ts` → `loadAndAuthorize`.
- Caller-principal scoping in lists: `backend/src/controllers/interviews.controller.ts` → `list` handler.
- Zod allowlist: `backend/src/controllers/applications.controller.ts` → `updateSchema`.
- Admin lifecycle: `backend/src/controllers/adminUsers.controller.ts` → `assertOutranks` + `assertNotLastSuperAdmin`.
