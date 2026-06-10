import { Router } from 'express';
import {
  requireAuth,
  blockIfMustChangePassword,
  requireRole,
  requireRoleOrCapability,
} from '../middleware/auth';
import { requireFeature } from '../middleware/featureFlag';
import { OPERATOR_TIER, MANAGER_TIER, BUSINESS_ROLES, MESSAGING_ROLES } from '../types';
import { authRouter } from './auth.routes';
import { devAuthRouter } from './devAuth.routes';
import { devToolsRouter } from './devTools.routes';
import { invitationsRouter } from './invitations.routes';
import * as invitationsCtl from '../controllers/invitations.controller';
import { consultantsRouter } from './consultants.routes';
import { recruitersRouter } from './recruiters.routes';
import { managersRouter } from './managers.routes';
import { resumesRouter } from './resumes.routes';
import { jobsRouter } from './jobs.routes';
import { vendorsRouter } from './vendors.routes';
import { clientsRouter } from './clients.routes';
import { applicationsRouter } from './applications.routes';
import { interviewsRouter } from './interviews.routes';
import { remindersRouter } from './reminders.routes';
import { reportsRouter } from './reports.routes';
import { aiRouter } from './ai.routes';
import { tasksRouter } from './tasks.routes';
import { taskViewsRouter } from './taskViews.routes';
import { messagesRouter } from './messages.routes';
import { supportRouter } from './support.routes';
import { callsRouter, callsUsageRouter } from './calls.routes';
import { realtimeRouter } from './realtime.routes';
import * as realtimeCtl from '../controllers/realtime.controller';
import { featureFlagsRouter } from './featureFlags.routes';
import * as featureFlagsCtl from '../controllers/featureFlags.controller';
import { userGroupsRouter } from './userGroups.routes';
import { usersRouter } from './users.routes';
import { adminUsersRouter } from './adminUsers.routes';
import { glassdoorRouter } from './glassdoor.routes';
import { activityRouter } from './activity.routes';
import { recruiterGoalsRouter } from './recruiterGoals.routes';
import { trainingRouter } from './training.routes';
import { filesRouter } from './files.routes';
import { aiUsageRouter } from './aiUsage.routes';
import { workAuthDocsRouter } from './workAuthDocs.routes';
import { invoicesRouter } from './invoices.routes';

export const router = Router();

// Public (auth handshake & invitation accept).
router.use('/auth', authRouter);

// Development-only role/user switching (no password). Mounted before
// requireAuth — the point is to log in with no existing session. Every route
// inside is gated by requireDevTools (404 unless env.devTools, which is
// force-disabled in production), so this is invisible on the live VPS.
router.use('/auth/dev', devAuthRouter);

// Super-Admin DEV test panel API. Mounted before the global requireAuth so its
// own requireDevTools 404s first in production (no "auth required" leak). The
// router re-applies requireAuth + requireRole(SUPER_ADMIN) internally.
router.use('/dev', devToolsRouter);

// Public file downloads. HMAC-signed URLs minted by storage.local — the route
// validates the signature + expiry before streaming the file. No bearer token
// required because we want the URLs embeddable in <a download> tags.
router.use('/files', filesRouter);

// Public invitation handshake (preview + set-password). Must be BEFORE requireAuth.
router.get('/invitations/preview', invitationsCtl.preview);
router.post('/invitations/setup', invitationsCtl.setup);

// Feature flags — read-only "what can THIS user see" lookup. Mounted before
// the password-change block because the frontend fires it from the top-level
// FeatureFlagsProvider on every page load (including /change-password). The
// data is non-sensitive (just toggles), so letting it through is safe.
// Admin write routes (PATCH /feature-flags/:key, etc.) stay behind the block
// via the full router below.
router.get('/feature-flags/me', requireAuth, featureFlagsCtl.myFlags);

// SSE stream — authenticated via short-lived SSE token in the query string,
// NOT a Bearer header, so it must be mounted before requireAuth.
// Token validation (and single-use invalidation) happens inside the controller.
router.get('/realtime/stream', realtimeCtl.stream);

// All other routes require auth. Additionally, every route below is blocked
// while the user is on a temporary password — they must rotate it first.
// (The /change-password route is mounted under /auth above and is exempt.)
router.use(requireAuth);
router.use(blockIfMustChangePassword);

router.use('/invitations', invitationsRouter);
router.use('/consultants', consultantsRouter);
// Sensitive immigration PII (H1B/EAD/I-20/passport). Defense-in-depth outer
// gate: BUSINESS_ROLES (excludes DEVELOPER) — the controller's
// authorizeConsultantAccess still scopes per-row (consultant→self,
// recruiter→own, lead→group, admin→all, else 404).
router.use('/work-auth-docs', requireRole(...BUSINESS_ROLES), workAuthDocsRouter);
router.use('/recruiters', recruitersRouter);
router.use('/managers', managersRouter);
router.use('/resumes', resumesRouter);
// Jobs are an operator pipeline tool — OPERATOR_TIER (admins, group leads,
// recruiters) only. CONSULTANT is excluded (consultants don't browse jobs) and
// so is a capability-less DEVELOPER (OPERATOR_TIER has no DEVELOPER).
router.use('/jobs', requireRole(...OPERATOR_TIER), jobsRouter);
router.use('/vendors', vendorsRouter);
router.use('/clients', clientsRouter);
// Applications is an operator pipeline tool whose responses carry recruiter-
// side context (assigned recruiter, internal notes, ATS scoring) a consultant
// must not see — so every operator endpoint stays OPERATOR_TIER, gated
// PER-ROUTE inside applications.routes.ts. The mount is BUSINESS_ROLES (still
// excludes DEVELOPER) only so the self-scoped, narrowed-projection
// GET /applications/mine is reachable by a CONSULTANT for their own dashboard.
router.use('/applications', requireRole(...BUSINESS_ROLES), applicationsRouter);
router.use('/feature-flags', featureFlagsRouter);
router.use('/user-groups', userGroupsRouter);
router.use('/users', usersRouter);
router.use('/admin/users', adminUsersRouter);
// Interview-prep enrichment proxied from a third-party (RapidAPI) — read-only
// external data with no internal exposure, but a paid quota. No frontend calls
// it today; gate it to the operator interview-prep audience + the interviews
// feature so a CONSULTANT/DEVELOPER can't burn the external quota.
router.use(
  '/glassdoor',
  requireRole(...OPERATOR_TIER),
  requireFeature('interviews'),
  glassdoorRouter,
);
router.use('/activity', activityRouter);
// Bug reports / support tickets — any authenticated user may file one.
router.use('/support', supportRouter);
router.use('/recruiter-goals', recruiterGoalsRouter);
router.use('/ai-usage', aiUsageRouter);
// Mirrors /ai-usage: OWNER_TIER + DEVELOPER-with-cap can read the org-wide
// monthly call-hour budget. Separate from the /calls/* router because the
// latter sits behind messaging-feature + messaging-roles gates, neither of
// which is the right gate for a billing-visibility surface.
router.use('/calls-usage', callsUsageRouter);

// --- Feature-flag gated routers ---------------------------------------------
// Each module that maps 1:1 to a feature flag mounts behind requireFeature().
// When the flag is OFF for the user's group, every route under the prefix
// returns 403 with `{ error, details: { feature } }` — same envelope the
// frontend reads to render "Feature disabled" cards.
//
// Adding a new feature flag for a new module:
//   1. Insert into public.feature_flags (key, enabled).
//   2. Add `router.use('/X', requireFeature('flag_name'), xRouter)` here.
//   3. Add the flagKey to the matching Sidebar entry + ProtectedRoute guard.
// Business modules also deny a capability-less DEVELOPER (BUSINESS_ROLES = every
// role except DEVELOPER) on top of the per-group feature flag.
router.use(
  '/interviews',
  requireRole(...BUSINESS_ROLES),
  requireFeature('interviews'),
  interviewsRouter,
);
router.use(
  '/reminders',
  requireRole(...BUSINESS_ROLES),
  requireFeature('reminders'),
  remindersRouter,
);
router.use('/reports', requireFeature('reports'), reportsRouter);
// AI email assistance is an operator tool: OPERATOR_TIER (admins, group leads,
// recruiters) only — not CONSULTANT, and not a capability-less DEVELOPER. The
// feature flag gates availability per group; the role gate gates who may call.
router.use('/ai', requireRole(...OPERATOR_TIER), requireFeature('ai_email'), aiRouter);
router.use('/tasks', requireRole(...BUSINESS_ROLES), requireFeature('tasks'), tasksRouter);
router.use('/task-views', requireRole(...BUSINESS_ROLES), requireFeature('tasks'), taskViewsRouter);
// /messages is the ONE exception that admits DEVELOPER — see MESSAGING_ROLES in
// shared/src/roles.ts. Lets every user reach a developer for bug/error reports
// and lets the developer reply. All other business routes keep the
// BUSINESS_ROLES gate, so DEVELOPER stays excluded from jobs / tasks / training
// / etc. unless they have an explicit admin-page capability.
router.use(
  '/messages',
  requireRole(...MESSAGING_ROLES),
  requireFeature('messages'),
  messagesRouter,
);
// Calls share the same permission model as messages (same hierarchy, same feature flag).
router.use('/calls', requireRole(...MESSAGING_ROLES), requireFeature('messages'), callsRouter);
router.use('/training', requireRole(...BUSINESS_ROLES), requireFeature('training'), trainingRouter);
// Consultant invoice tracker — MANAGER_TIER by default, OR any user an admin has
// granted the 'invoices' page-access capability (requireRoleOrCapability).
router.use(
  '/invoices',
  requireRoleOrCapability(MANAGER_TIER, 'invoices'),
  requireFeature('invoices'),
  invoicesRouter,
);

// Realtime SSE stream — generic push channel used by messages,
// notifications, and any future feature that wants to push to a logged-in
// user without polling. Not behind a feature flag: the stream is the
// transport, individual features still gate their own events.
router.use('/realtime', realtimeRouter);
