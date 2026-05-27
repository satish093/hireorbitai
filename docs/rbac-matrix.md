# RBAC permission matrix & definition of done

This is the authoritative, human-readable companion to the machine-checked matrix
in [`frontend/e2e/fixtures/rbacMatrix.ts`](../frontend/e2e/fixtures/rbacMatrix.ts).
The fixture drives the sidebar-parity and route-guard Playwright specs, so the two
cannot drift without a test failing.

Role constants are defined once in [`shared/src/roles.ts`](../shared/src/roles.ts)
and re-exported to both halves. **Never** hard-code role strings in a guard, a
sidebar item, or a dropdown — import the tier array or a helper
(`canAssignRole`, `assignableRolesFor`, `isAdminTier`, `isGroupLead`,
`hasCapability`) instead.

## Roles & tiers

```
SUPER_ADMIN > CEO > CTO > DIRECTOR > HR_MANAGER ≈ MANAGER > DEVELOPER > RECRUITER > CONSULTANT

OWNER_TIER     = SUPER_ADMIN, CEO
ADMIN_TIER     = OWNER_TIER + CTO, DIRECTOR
MANAGER_TIER   = ADMIN_TIER + HR_MANAGER, MANAGER
OPERATOR_TIER  = MANAGER_TIER + RECRUITER
BUSINESS_ROLES = every role EXCEPT DEVELOPER
ALL_ROLES      = BUSINESS_ROLES + DEVELOPER
GROUP_LEAD_ROLES = HR_MANAGER, MANAGER          (group-scoped via groupScope.ts)
SUPER_ADMIN_ONLY_ROLES = SUPER_ADMIN, DEVELOPER (only a SUPER_ADMIN may assign these)
```

`DEVELOPER` holds **no** tier — it is a scoped super-admin that reaches a gated
surface only when granted the matching capability
(`users, user_groups, feature_flags, invitations, reports, ai_usage`) via
`requireRoleOrCapability`.

## Definition of done

1. Every role has a clear allow/deny policy for every route. ✔ (this matrix + `route-guards.spec.ts`)
2. Every visible button/action is executable by that role. ✔ (page actions audited; UI gates mirror backend gates)
3. Every backend mutation independently verifies scope — frontend hiding is not security. ✔ (two-layer authz; ownership tests)
4. Every group-lead action is scoped to its group unless explicitly marked workspace-wide. ✔ (groupScope guards; exceptions below)
5. Every workspace-wide exception has a comment **and** a test. ✔ (see "Workspace-wide exceptions")
6. SUPER_ADMIN remains absolute; self-protection + last-super-admin protection remain. ✔ (`assertOutranks`, `assertNotLastSuperAdmin`, self-guard)
7. RECRUITER can invite consultants, and only consultants. ✔ (`canAssignRole`; recruiter outranks only CONSULTANT)
8. DEVELOPER access is capability-only, never business-role access by accident. ✔ (`BUSINESS_ROLES` excludes DEVELOPER; `requireRoleOrCapability`)

## Route / sidebar / gate matrix

| Route                   | Sidebar       | Frontend allow | Capability    | Flag       | Backend gate                                                                          | Scope        |
| ----------------------- | ------------- | -------------- | ------------- | ---------- | ------------------------------------------------------------------------------------- | ------------ |
| `/dashboard`            | Dashboard     | ALL_ROLES      | —             | —          | requireAuth                                                                           | per-role     |
| `/tasks`                | Tasks         | BUSINESS_ROLES | —             | tasks      | requireRole(BUSINESS) + feature                                                       | group-scoped |
| `/calendar`             | Calendar      | BUSINESS_ROLES | —             | —          | requireRole(BUSINESS)                                                                 | owner        |
| `/messages`             | Inbox         | BUSINESS_ROLES | —             | messages   | requireRole(BUSINESS) + feature + permission.service                                  | owner        |
| `/reminders`            | Reminders     | BUSINESS_ROLES | —             | reminders  | requireRole(BUSINESS) + feature                                                       | owner        |
| `/consultants`          | Consultants   | OPERATOR_TIER  | —             | —          | requireRole(OPERATOR) + ownership                                                     | group-scoped |
| `/recruiters`           | Recruiters    | MANAGER_TIER   | —             | —          | requireRole(MANAGER) + group scope                                                    | group-scoped |
| `/jobs`                 | Jobs          | OPERATOR_TIER  | —             | —          | requireRole(OPERATOR) — CONSULTANT excluded                                           | global       |
| `/applications`         | Applications  | OPERATOR_TIER  | —             | —          | requireRole(OPERATOR) + assertCanAccessConsultant                                     | group-scoped |
| `/interviews`           | Interviews    | BUSINESS_ROLES | —             | interviews | requireRole(BUSINESS) + feature + ownership                                           | group-scoped |
| `/resumes`              | Resumes       | OPERATOR_TIER  | —             | —          | requireRole(OPERATOR) + authorizeConsultantAccess                                     | group-scoped |
| `/vendors`              | Vendors       | OPERATOR_TIER  | —             | —          | requireRole(OPERATOR)                                                                 | group-scoped |
| `/clients`              | Clients       | OPERATOR_TIER  | —             | —          | requireRole(OPERATOR)                                                                 | group-scoped |
| `/reports`              | Analytics     | MANAGER_TIER   | reports       | reports    | requireRoleOrCapability(MANAGER, reports) + feature                                   | **global** ⚑ |
| `/training`             | My Training   | BUSINESS_ROLES | —             | training   | requireRole(BUSINESS) + feature + own-assignment                                      | owner        |
| `/training/courses`     | Courses       | MANAGER_TIER   | —             | training   | requireRole(MANAGER) + feature                                                        | **global** ⚑ |
| `/training/assignments` | Assignments   | MANAGER_TIER   | —             | training   | requireRole(MANAGER) + feature                                                        | **global** ⚑ |
| `/training/reports`     | Reports       | MANAGER_TIER   | —             | training   | requireRole(MANAGER) + feature                                                        | **global** ⚑ |
| `/training/ai-activity` | AI Activity   | MANAGER_TIER   | —             | training   | requireRole(MANAGER); AI authoring = ADMIN_TIER                                       | global       |
| `/admin/users`          | Users         | ADMIN_TIER     | users         | —          | requireRoleOrCapability(ADMIN, users) + lifecycle guards                              | global       |
| `/invitations`          | Invitations   | OPERATOR_TIER  | invitations   | —          | requireRoleOrCapability(OPERATOR, invitations) + canAssignRole + assertCanAssignGroup | group-scoped |
| `/admin/groups`         | User Groups   | ADMIN_TIER     | user_groups   | —          | requireRoleOrCapability(ADMIN, user_groups)                                           | **global** ⚑ |
| `/ai-usage`             | AI Usage      | MANAGER_TIER   | ai_usage      | —          | requireRoleOrCapability(MANAGER, ai_usage)                                            | global       |
| `/ai-email`             | AI Email      | OPERATOR_TIER  | —             | ai_email   | requireRole(OPERATOR) + feature                                                       | group-scoped |
| `/admin/deactivated`    | Deactivated   | ADMIN_TIER     | —             | —          | requireRole(ADMIN)                                                                    | global       |
| `/admin/features`       | Feature Flags | OWNER_TIER     | feature_flags | —          | read ADMIN; **write OWNER_TIER**                                                      | **global** ⚑ |
| `/admin/ai-settings`    | AI Settings   | ADMIN_TIER     | —             | —          | requireRole(ADMIN)                                                                    | global       |
| `/admin/audit-log`      | Audit Log     | ADMIN_TIER     | —             | —          | requireRole(ADMIN)                                                                    | global       |

⚑ = workspace-wide exception (see below).

## Role expectations (summary)

- **SUPER_ADMIN** — absolute: all roles, all groups, all capabilities, impersonation. Bound only by self-protection + last-super-admin protection.
- **CEO** — owner/admin power **plus** feature-flag writes (OWNER_TIER). Cannot create/assign SUPER_ADMIN or DEVELOPER (`SUPER_ADMIN_ONLY_ROLES`).
- **CTO / DIRECTOR** — admin-tier operational access. No feature-flag writes, no impersonation, no SUPER_ADMIN/DEVELOPER grants.
- **HR_MANAGER / MANAGER** — group leads. Row-scoped to their own group on consultants/recruiters/applications/interviews/resumes/tasks (fail-closed with no group). Workspace-wide only on the ⚑ exceptions.
- **RECRUITER** — own assigned consultants; jobs/applications/resumes/vendors/clients; invitations (CONSULTANT only, own group).
- **CONSULTANT** — self-service only: own jobs/applications/interviews/messages/training. Denied resumes/consultants/admin.
- **DEVELOPER** — capability-only. No business surfaces; reaches an admin surface only when granted its capability.

## Workspace-wide exceptions (DoD #4/#5 — comment + test required)

| Surface                                      | Decision                                                                                         | Comment                                    | Test                                                     |
| -------------------------------------------- | ------------------------------------------------------------------------------------------------ | ------------------------------------------ | -------------------------------------------------------- |
| Reports / analytics                          | Workspace-wide for all MANAGER_TIER incl. group leads (aggregate org metrics, not row PII).      | `reports.controller.ts` RBAC POLICY block  | `rbac.workspaceWide.test.ts` (leads admitted)            |
| Training admin (courses/assignments/reports) | Workspace-wide for MANAGER_TIER (org training catalog; learners still see only own assignments). | `training.controller.ts` RBAC POLICY block | `rbac.workspaceWide.test.ts`                             |
| Feature-flag writes                          | OWNER_TIER (SUPER_ADMIN + CEO). CEO owner-power intentional; CTO/DIRECTOR read-only.             | `featureFlags.routes.ts` gate              | `capability.guard.test.ts`, `rbac.workspaceWide.test.ts` |
| User Groups admin                            | ADMIN_TIER-global; group leads do **not** administer groups.                                     | `userGroups.routes.ts` gate comment        | `rbac.workspaceWide.test.ts` (leads denied)              |

## Page-action checklist (audited 2026-05-28)

- **Consultants** — recruiter: view own + update allowed fields/status only (no reassign, no mass-assign). Manager/admin: reassign recruiter, group-scoped for leads. `setMarketingStatus` now group-scopes leads (was a hole — fixed).
- **Recruiters** — manager/admin manage supervisor assignments; leads scoped to own-group recruiter rows + in-group manager targets.
- **Invitations** — dropdown from `assignableRolesFor`; recruiter → CONSULTANT only; group restricted via `assertCanAssignGroup`; SUPER_ADMIN all roles.
- **Admin Users** — impersonate SUPER_ADMIN-only (UI + backend); DEVELOPER-capabilities editor SUPER_ADMIN-only & DEVELOPER targets only; role dropdown from `assignableRolesFor`; backend `assertOutranks` + `canAssignRole` + `assertNotLastSuperAdmin` + self-guard.
- **Tasks** — create/delete/assign manager-gated (route + handler); assignee limited to status; assignee picker + create/update scoped via `assertTaskTargetsInScope`. No standalone bulk endpoint (bulk = per-row against gated endpoints).
- **Training** — learner own-assignment only (404 otherwise); manager authoring/assignment/feedback; AI generation/backfill/retry/delete ADMIN_TIER; no learner link to manager-only course detail (catalog renders `<span>` for learners).
- **Reports** — MANAGER_TIER or DEVELOPER+reports; global by design.
- **Resumes** — the operator Resumes **page** (`/resumes`) stays OPERATOR_TIER (CONSULTANT denied at the route); recruiter scoped to own consultants; empty-state link role-aware (admin → Users, else → Invitations). A CONSULTANT manages **their own** resume from a "My resume" panel on their dashboard, which hits the same backend (self-scoped via `authorizeConsultantAccess`). Backend resume routes are `selfOrOperator` for the self endpoints (upload/list/download/set-current/view/delete/re-extract) and `operatorOnly` for the AI/tailoring tools. Uploads accept PDF, images, and Word (`.doc`/`.docx`, extracted via word-extractor / mammoth).
- **Messages** — STAFF chat is broadened for recruiters (product decision): a RECRUITER may message **all active staff (OPERATOR_TIER)** org-wide plus their own assigned consultants. CONSULTANT stays assignment-bound (their recruiter + that recruiter's managers only). Conversations require both sides to view, so `canMessageUser` also allows the reverse direction (skipping admin-tier targets so admins aren't made universally reachable). Admins still reach everyone; no reports-to / prior-thread carve-out.

## Product decisions (confirmed against stated role expectations)

These were called out for confirmation. Current behavior matches the stated role
expectations, so they are documented as intentional. Flag here if policy changes:

1. **CEO can write feature flags** (OWNER_TIER) — intentional (CEO = owner power). To tighten, change the gate to SUPER_ADMIN-only in `featureFlags.routes.ts`.
2. **User Groups are ADMIN_TIER-global; group leads cannot manage their own group** — intentional. To allow leads to manage their own group's membership, add a scoped path.
3. **Training assignment/reports are workspace-wide** (a MANAGER may assign training to any org user) — intentional, consistent with the org training catalog model. To group-scope, route `assign`/`listAssignments` through `managerGroupUserIds`.
