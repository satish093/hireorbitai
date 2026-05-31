# HireOrbit AI — Mobile, Desktop & Communication Redesign

_Stakeholder release notes. Engineering detail lives in the commit history and
`design_handoff_hireorbitai/` (the design source of truth)._

## What's new

**A brand-new mobile experience.** Every screen now works on a phone — a fixed
bottom navigation bar, role-aware "Work" hub, slide-up sheets for forms and
filters, swipe-friendly entity cards instead of cramped tables, and full
safe-area + light/dark support. Tapping a task, user, consultant, or record
opens a proper full-screen detail (previously mobile taps did nothing on some
screens).

**A polished desktop.** Same familiar layout, upgraded: grouped sidebar
(Workspace · Talent · Training · Admin) with an active-item accent bar and live
count badges, a sticky header with breadcrumbs, a notification bell, a theme
toggle, and a global **⌘K command palette** that jumps to any screen you're
allowed to see. Record detail now opens in a right-side drawer that keeps the
list in view. KPI cards carry an accent edge-bar and trend delta.

**A redesigned communication center.** Inbox + messaging + calling, rebuilt and
**permission-aware**: a 3-pane desktop layout (conversations · thread · context)
and a mobile inbox → thread → context flow, delivery ticks, attachments,
typing indicators, unread badges, **quick replies and `{{merge}}` templates**,
and voice calling that survives navigation (a minimized call pill follows you
between pages). Who you can message — and call — is enforced on the server, not
just hidden in the UI.

## Security & access (enforced server-side)

- **Messaging boundaries** are enforced in the contact picker, on send, _and_ on
  thread-fetch — a recruiter can never message or call a consultant who isn't
  assigned to them, and the rule is fail-closed (a reassignment immediately
  revokes access). Support is reachable from every role.
- **Capability-driven admin** — a Developer reaches only the surfaces it's been
  granted (not by tier). Feature-flag writes, AI credential management, and the
  call-budget dashboard are owner-tier only.
- **Audit trail** — security-relevant events are logged; the Audit Log is now
  exportable to CSV.

## This release also fixed

- Mobile detail panes for Tasks & Admin Users (taps now open a full-screen view).
- Missing mobile actions on Recruiter / Manager / Invitation cards.
- A standalone, importable status-tone helper for consistent chips.
- RecruiterDashboard KPI row upgraded to the accent-edge KpiCard.
- **AI Settings is now correctly owner-tier** (it previously showed CTO/Director
  a page whose actions would fail).
- The mobile "More" menu now lists every page a user can reach (Vendors, Clients,
  Interviews, AI Email, Call Usage, AI Settings, Training AI Activity) — derived
  from the same gated nav model as the desktop sidebar, so the two can't drift.
- User Groups gained a color picker; Audit Log gained CSV export.
- Build/tooling: removed stale `esbuild`/`vite` overrides that broke strict
  `npm ci` on staging.

## Feature-flag rollout plan

The redesign ships behind the existing flags (Admin → Feature Flags, owner-write).
Recommended staged enablement, per group, watching error rates between steps:

| Step | Flags to enable                    | Audience                  |
| ---- | ---------------------------------- | ------------------------- |
| 1    | `messages`                         | Internal staff group only |
| 2    | `tasks`, `reminders`, `interviews` | Internal staff group      |
| 3    | `training`, `ai_match`, `ai_email` | One pilot client group    |
| 4    | all of the above                   | All groups                |

Calling rides on `messages`. Roll back a step by toggling the flag off (no deploy
needed) if error rates or support tickets spike.

## QA & accessibility checklist (run on staging before promote)

- [ ] No horizontal scroll at 360px; no text/button overlap; 44px touch targets; 16px inputs.
- [ ] Sheets/drawers/command-palette trap focus + close on Esc/backdrop; focus restores on close.
- [ ] Role gating hides nav + pages + actions for each role (Recruiter, Consultant, Manager/HR, Director/CTO/CEO, Developer, Super Admin).
- [ ] `canMessage` enforced in picker + on send + on thread-fetch (recruiter↔unassigned-consultant blocked); Support reachable from every role.
- [ ] Calling: incoming/outgoing/active/missed/declined/ended, minimize-pill persistence across navigation, permission-gated start.
- [ ] Light + dark pass — no glowing pastels on dark; contrast ≥ 4.5:1.
- [ ] `prefers-reduced-motion` disables pulse/typing/entrance animations.
- [ ] Live regions announce new messages + incoming calls; status conveyed by text+icon (not color alone).
- [ ] Empty / loading / error state on every list.

Automated coverage: backend `npm run verify` (707 unit/security tests incl. IDOR
guards) and the mocked-backend Playwright UI smoke suite
(`npm --prefix frontend run test:e2e`).

## Known deferred items (not in this release)

These need dedicated, tested backend work and were intentionally not rushed:

- Internal-note messages (needs an `is_internal` column + visibility enforcement
  so staff notes can never reach a consultant).
- Inbox Pinned/Archived filters (need per-conversation flags).
- In-call "add note" / "report→bug ticket" and the composer bug-report form
  (need `/support/tickets` + a call-notes store).
- Context-panel "related job/application" link (needs a resolver endpoint).
- Training quiz as a one-question-at-a-time stepper (today: all questions on one
  page; per-answer completion already persists).

## Promote

Staging is the `dev` branch (auto-deploys to the Render staging environment).
Production is push-to-`main` and **requires explicit owner authorization** — run
the QA checklist on staging first.
