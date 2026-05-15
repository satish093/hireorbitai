# Changelog

All notable changes to this project. The original `TalentBridge AI` was rebuilt and rebranded to `HireOrbit AI` over a series of stabilization passes; entries here are grouped by release rather than date.

The format is loosely based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

---

## [0.3.0] — Stabilization pass 3

### Security
- **Fail-closed RBAC** (`ProtectedRoute`) — when a session exists but the profile load fails (e.g. `/auth/me` 403), the page now redirects to `/unauthorized` instead of rendering protected children with no role check. Closes a privilege-escalation hole.
- **`/users/:id` PATCH allowlist tightened** — schema is now `.strict()` (extra fields rejected outright) and URL fields require `^https?://` to block stored `javascript:` / `data:` URLs.
- **Upload type allowlists** — `uploadResume` (PDF/DOC/DOCX, 10 MB) and `uploadAttachment` (docs/images/spreadsheets/text, 15 MB) replace the permissive any-file uploader. MulterError translated to clean 400 in `errorHandler`.
- **Per-user rate limit keying** — global limiter now keys on `req.user.id` when authenticated, so users on the same NAT don't compete.
- **Strict CORS** — case- and trailing-slash-tolerant allowlist, no wildcard fallback. Failed origins logged via Pino.

### Added
- `frontend/src/utils/fileUrl.ts` — central resolver/opener for backend-served URLs. Handles absolute Supabase URLs vs relative API paths; applies `noopener,noreferrer`.
- `frontend/src/hooks/useInvalidate.ts` — typed pub/sub for cross-page cache invalidation. Channels: `users`, `tasks`, `jobs`, `applications`, `invitations`.
- `frontend/src/components/ErrorBoundary.tsx` — top-level boundary at `main.tsx`.
- `frontend/src/components/PasswordField.tsx` — show/hide eye + live strength hints matching backend rules.
- `frontend/src/pages/{ChangePassword,ForgotPassword,ResetPassword,Unauthorized,AdminUsers,AdminUserDetail,DeactivatedAccounts}.tsx`.
- `database/auth-hardening.sql` — `must_change_password`, `password_reset_tokens`, `auth_audit_logs`, indexes, cleanup function, RLS.
- `database/seed-default-admin.sql` — standalone-safe SQL seed for the SUPER_ADMIN account (`satish.flex07@gmail.com` / `Admin2123`).
- `database/admin-user-management.sql` — admin status / notes / impersonation columns.

### Fixed
- **Account lifecycle** — single `setUserStatus()` writer in `auth.service.ts`; both `status` and `is_active` always in sync; refresh tokens revoked on every non-active transition; audit-logged. `/users/:id/deactivate|reactivate` now route through the same code path as `/admin/users/:id/status`.
- **Profile name** — backend recomputes `full_name` whenever first/last is in the patch (previously only when `full_name` was absent — frontend's stale value silently won).
- **Calendar** — date cells are now buttons with `selectedDate` state; detail list filters to the selected day; "Click a date to filter" copy now matches behaviour.
- **AdminUsers search debounce** — switched to functional `setSearchParams((prev) => …)` so concurrent role/status/sort changes survive the 300ms window.
- **Tasks + TaskDetail `isManager`** — was hard-coded to `SUPER_ADMIN`/`MANAGER`; now uses shared `MANAGER_TIER` so DIRECTOR/CTO/CEO/HR_MANAGER/DEVELOPER get the create button + edit affordance the backend already allowed.
- **TaskDetail "Open consultant profile"** — was routing CONSULTANT viewers at `/consultants` (OPERATOR_TIER → 403); now routes at `/users/:id`.
- **TasksAssignedToMe** — removed dead "Today" button, dead row checkbox, and the recruiter-only "Log activity" link that pointed at `/reports` (MANAGER_TIER only).
- **Invitations** — backend dropdown filters out SUPER_ADMIN unless inviter is SUPER_ADMIN; backend was already gating but the UI showed the option anyway.
- **Recruiters ManageManagersModal** — refetches and re-pins `picked` after a child mutation so the "Current supervisors" panel doesn't show stale data.
- **Reports DailyActivity** — number FormInputs now controlled (visible-empty == state).
- **Reminders POST** — strips local-only `due_at_local` field before send.
- **Resumes download** — uses `openExternal()` helper with `noopener,noreferrer`.
- **`/invitations/setup`** — now sets `must_change_password=false` (user just chose their password), validates strength like other flows, returns a session pair (no second-roundtrip race).
- **`AcceptInvitation`** — kills any existing session on mount so an invite link can never overwrite the signed-in user's password.
- **`supabaseAnon` for `signInWithPassword`** — calling on `supabaseAdmin` mutates the admin client's auth state; subsequent admin writes silently RLS-fail. Critical for `must_change_password` rotation.
- **JobSearch race** — replaced `setX(v); setTimeout(load, 0)` stale-closure pattern with a single effect keyed on filter deps + AbortController.
- **Sidebar polling** — 15s → 60s, paused while `document.hidden`.

### Changed
- **README** — full rewrite with features, stack, env tables, deployment, production checklist, auth flow diagram, architecture notes, known follow-ups.
- **Cross-page invalidation** wired into AdminUsers, AdminUserDetail, DeactivatedAccounts, UserProfile, Tasks, TaskDetail, TasksAssignedToMe, Applications, JobSearch, Invitations.
- **Routes mounted at both `/` and `/api`** so dedicated `api.` subdomain works without an `/api` prefix; legacy single-domain deploys keep working via the `/api` alias.

### Removed
- **`backend/src/config/email.ts`** — multi-provider shim. All transactional email is Brevo-only now.
- **`EMAIL_PROVIDER` / `RESEND_API_KEY` / `SENDGRID_API_KEY`** env vars. `BREVO_API_KEY` is required.
- **`Path A` in AcceptInvitation** — the `supabase.auth.updateUser({password})` branch could overwrite the signed-in user's password if they clicked an invite link.

### Verified
- `backend: npm run typecheck` clean
- `backend: npm run build` clean
- `frontend: npm run typecheck` clean
- `frontend: npm run build` clean

---

## [0.2.0] — Production-ready rewrite

### Added
- **Node.js 22 LTS** pin (`.nvmrc`, `engines.node >= 22.0.0`).
- **Zod-validated env** on both backend and frontend, fail-fast at startup.
- **Pino + pino-http** structured logging with `requestId` and sensitive-field redaction.
- **`/health` and `/ready`** probes.
- **Graceful shutdown** on SIGTERM/SIGINT with 25s drain.
- **Helmet + hpp + compression + express-rate-limit**.
- **Brevo-only email service** with branded HTML templates.
- **Forced password change on first login** (`must_change_password` column + middleware gate).
- **Custom forgot-password / reset-password flow** (no Supabase recovery emails).
- **Account lockout** after N failed logins.
- **Audit logging** (`auth_audit_logs` table + service with 17 typed actions).
- **Admin-only user creation** with crypto-secure 16-char temp password.
- **Default-admin bootstrap** (`scripts/bootstrap-admin.mjs` + opt-in runtime).
- **Design system pass** — shared `Button`, `PageHeader`, `Modal v2`, upgraded `DataTable` + `StatusBadge` + `FormInput` + `SelectInput` + `FileUpload`.
- **Animation pass** — 9 keyframes, `.stagger-children`, `.skeleton`, `.hover-lift`, `.press`, `prefers-reduced-motion` neutralisation.

### Fixed
- **80+ functional bugs across 27 pages** — see git log `1738bef` for the full list. Highlights: AbortController everywhere, double-submit guards, multipart Content-Type fixes, datetime-local TZ fixes, Tasks search debounce, JobSearch filter/load race, UserGroups recruiter+manager loading, UserProfile PATCH allowlist, Calendar UTC/local boundary, Messages polling race.

### Branding
- **TalentBridge AI → HireOrbit AI** across UI, emails, and metadata.

---

## [0.1.0] — Initial

Original TalentBridge AI release. Documented in the legacy README; superseded.
