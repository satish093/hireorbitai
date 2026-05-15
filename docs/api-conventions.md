# API conventions

The HTTP contract HireOrbit AI's backend speaks. Frontend code, integration tests, and any future SDK should rely on these shapes.

## Base URL

- Single-domain deploy: `https://hireorbitai.com/api`
- Split-domain deploy: `https://api.hireorbitai.com`

Either works — the frontend reads `VITE_API_URL` and never hardcodes a host.

## Success response

Every successful response returns JSON with the resource at the top level. There is no wrapping `{ data: ... }` envelope on success:

```http
GET /api/consultants/:id  →  200 OK
Content-Type: application/json

{ "id": "uuid", "user_id": "uuid", "primary_skill": "Senior Data Engineer", ... }
```

List endpoints return a top-level array:

```http
GET /api/consultants  →  200 OK

[ { "id": "uuid", ... }, { "id": "uuid", ... } ]
```

`POST` / `PATCH` / `PUT` typically return the mutated resource. `DELETE` returns either the deleted row or `{ "ok": true }` — consult the controller.

## Error response

EVERY non-2xx response is a JSON object with at least an `error` field:

```ts
interface ApiErrorBody {
  error: string; // human-readable, safe to display to end users
  details?: unknown; // dev mode only — never present in production
  retry_after_seconds?: number; // 429 only
  status?: string; // 403 lifecycle-block only (e.g. "suspended")
}
```

Status codes used:

| Status | Meaning                                                                                                                                                                                                         |
| ------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 200    | Success                                                                                                                                                                                                         |
| 201    | Resource created (typically returned by POST endpoints that create new rows)                                                                                                                                    |
| 400    | Validation / malformed input. `error` describes which field.                                                                                                                                                    |
| 401    | Missing / invalid / expired bearer token. Frontend axios client auto-redirects to `/login`.                                                                                                                     |
| 403    | Authenticated but not permitted. Could be RBAC (`Forbidden — insufficient role`), feature flag (`Feature disabled`, `details: { feature }`), or account status (`Account is suspended`, `status: 'suspended'`). |
| 404    | Resource doesn't exist.                                                                                                                                                                                         |
| 409    | Conflict — duplicate unique key, optimistic-lock failure.                                                                                                                                                       |
| 422    | Payload understood but semantically invalid (e.g. status transition not allowed).                                                                                                                               |
| 423    | Account locked after `MAX_FAILED_LOGINS`. Frontend treats this like 401 → boot to `/login`.                                                                                                                     |
| 429    | Rate-limited. Always includes `Retry-After` header (seconds) AND `retry_after_seconds` in the body. Axios client respects both.                                                                                 |
| 500    | Unhandled server error — logged with `req.log` (pino requestId), generic `error: "Internal Server Error"` to the client.                                                                                        |

Errors are produced by [`httpError(status, message, details?)`](../backend/src/types/index.ts) in controllers/services, and rendered by the centralised [`errorHandler`](../backend/src/middleware/errorHandler.ts) middleware. The middleware also translates `multer.MulterError` into clean 400s.

## Authentication

Every protected endpoint expects:

```http
Authorization: Bearer <jwt>
```

The JWT is HS256-signed with `env.jwt.secret`. Claims: `{ sub, email, sv, iat, exp }` where `sv` is the user's `session_version`. Frontend stores both `access_token` + `refresh_token` in `localStorage` under the `hireorbitai.session` key.

### Auth endpoints

| Method | Path                        | Purpose                                                                                      | Public? |
| ------ | --------------------------- | -------------------------------------------------------------------------------------------- | ------- |
| POST   | `/api/auth/login`           | Email + password → `{ access_token, refresh_token, expires_at, user, must_change_password }` | yes     |
| POST   | `/api/auth/refresh`         | Refresh token → fresh pair                                                                   | yes     |
| POST   | `/api/auth/forgot-password` | Email → 204-on-any-input (anti-enumeration). Sends a Brevo email.                            | yes     |
| POST   | `/api/auth/reset-password`  | `{ token, new_password, confirm_password }` → 204                                            | yes     |
| GET    | `/api/auth/me`              | Current user profile, including `consultant_id` / `recruiter_id` if applicable               | bearer  |
| POST   | `/api/auth/sync`            | Idempotently provision a missing public.users row for a valid JWT subject                    | bearer  |
| POST   | `/api/auth/change-password` | `{ current_password, new_password, confirm_password }` → fresh session pair                  | bearer  |
| POST   | `/api/auth/logout`          | Revoke every refresh token for the user (bumps `session_version`)                            | bearer  |

`must_change_password=true` forces the frontend to route the user through `/change-password`; the [`blockIfMustChangePassword`](../backend/src/middleware/auth.ts) middleware 403s every other protected route until rotation.

## Rate limiting

| Surface                                                                                                             | Key                           | Window                          | Max                     |
| ------------------------------------------------------------------------------------------------------------------- | ----------------------------- | ------------------------------- | ----------------------- |
| Global (everything mounted under `router`)                                                                          | JWT `sub` if present, else IP | 15 min (`RATE_LIMIT_WINDOW_MS`) | 3000 (`RATE_LIMIT_MAX`) |
| Brute-forceable auth surface (`/auth/login`, `/auth/forgot-password`, `/auth/reset-password`, `/invitations/setup`) | IP                            | 15 min                          | 20                      |
| `/auth/refresh`                                                                                                     | exempt from global limiter    | —                               | —                       |
| `/health`, `/ready`                                                                                                 | exempt                        | —                               | —                       |

Rate-limit responses include `RateLimit-*` headers per [draft-7](https://datatracker.ietf.org/doc/draft-ietf-httpapi-ratelimit-headers/) plus a `Retry-After` (capped at 60s on the server side so clients don't sleep forever).

## File downloads

Files live on the VPS filesystem under `UPLOADS_DIR`. The backend mints short-lived HMAC-signed URLs:

```
GET /api/files/<bucket>/<path>?exp=<unix-seconds>&sig=<hex sha256>
```

`exp` is the expiry timestamp; `sig` is the hex sha256 HMAC of `bucket:path:exp` using `env.storage.urlSecret`. The route verifies with `crypto.timingSafeEqual` before streaming the file.

Public-by-URL: anyone holding a valid signature can fetch the file until `exp`. Security relies on signature unforgeability, not session auth.

## Feature flags

Modules that map 1:1 to a feature flag are mounted behind [`requireFeature('flag_name')`](../backend/src/middleware/featureFlag.ts). When the flag is OFF for the caller's group:

```http
403 Forbidden
{ "error": "Feature disabled", "details": { "feature": "training" } }
```

Frontend's [`<FeatureGuard>`](../frontend/src/hooks/useFeatureFlags.tsx) reads `/api/feature-flags/me` and short-circuits the corresponding route before it ever fires a request.

## Pagination

We don't have universal pagination yet — see [docs/architecture.md §Technical debt](architecture.md). Endpoints that return lists currently return everything (typically bounded by a 1000-row LIMIT inside the controller).

When pagination is added, the convention will be:

```
GET /api/<resource>?limit=50&offset=100&order=created_at.desc
```

Response: `{ rows: [...], total: <int>, limit: <int>, offset: <int> }`. Until then, lists stay top-level arrays.

## Versioning

No `/v1/` prefix is in use today. The API is treated as a single rolling contract with backwards-compatible changes; breaking changes get a new endpoint path or query parameter rather than a version bump. Add `/v1/` if/when an external SDK consumer arrives.
