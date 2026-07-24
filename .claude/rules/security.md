---
name: security
description: IDOR, mass-assignment, and auth-boundary rules for backend controllers + services.
applies_to:
  - backend/src/controllers/**
  - backend/src/services/**
  - backend/src/middleware/**
  - backend/src/routes/**
---

# Security rules

This codebase had a security review pass close 7 IDOR / privilege-escalation issues. The bar is now: every controller that touches a row-scoped resource follows the same pattern. Don't regress.

## Authorization is two-layered

1. **Route-level role gate.** `requireRole(...TIER)` in the router gates by tier. Bare `requireAuth` is NOT sufficient for anything that mutates or reads non-public data.
2. **Handler-level ownership check.** Every handler that operates on `:id` must:
   - Load the row.
   - Verify the caller is the owner OR a manager-tier user.
   - Throw **`httpError(404, 'Not found')`** — not 403 — when ownership fails, so the endpoint can't be used as an existence oracle.

The canonical patterns live in `backend/src/controllers/applications.controller.ts` (`loadAndAuthorize`) and `backend/src/controllers/interviews.controller.ts`. Mirror them.

## Never `db.update(req.body)`

Mass-assignment is the #1 bug source. Before any `db.from('x').update(...)` or `db.from('x').insert(...)`:

- Parse `req.body` against a Zod schema marked `.strict()`.
- The schema must **omit** server-controlled fields: `created_by`, `updated_by`, `user_id`, `recruiter_id`, `consultant_id`, `role`, `status_changed_by`, `is_active`, etc. Those are set server-side or via dedicated routes.
- Spread `parsed.data` into the DB call, not `req.body`.

## Admin lifecycle

Admin status / group / password-reset endpoints must call **both**:

- `assertOutranks(actor, targetRole)` — refuses to mutate equal-or-higher tier users.
- `assertNotLastSuperAdmin(targetId)` — refuses to deactivate the last active SUPER_ADMIN.

See `backend/src/controllers/adminUsers.controller.ts` for the canonical implementation. A DIRECTOR / CTO / CEO must not be able to lock out a SUPER_ADMIN.

## Email lookups

Use `.eq('email', email.toLowerCase())` — never `.ilike()`. `%` and `_` are RFC-5321-legal in email local parts and turn the lookup into a wildcard match. There is a `users_lower_email_unique_idx` functional index; rely on it.

## PostgREST `.or()` strings

If you must build an OR string, **escape user-supplied input** for `%`, `_`, `,`, `(`, `)`, and `.` (PostgREST control characters). The shim's `.or()` accepts nested `and(...)` / `or(...)` / `not.` groups; raw user input there is filter injection. See `backend/src/controllers/adminUsers.controller.ts:63` for the safe escape pattern.

## Audit trail

Security-relevant events (status changes, denied access, password resets, admin-created users) must call `audit({ action, user_id, email, req, metadata })` from `services/audit.service.ts`. Don't add new audit verbs without extending the `AuditAction` union — it's intentionally closed.
