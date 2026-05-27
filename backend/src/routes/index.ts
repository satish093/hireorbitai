import { Router } from 'express';
import { requireAuth, blockIfMustChangePassword, requireRole } from '../middleware/auth';
import { requireFeature } from '../middleware/featureFlag';
import { OPERATOR_TIER, BUSINESS_ROLES } from '../types';
import { authRouter } from './auth.routes';
import { devAuthRouter } from './devAuth.routes';
import { devToolsRouter } from './devTools.routes';
import { invitationsRouter } from './invitations.routes';
import * as invitationsCtl from '../controllers/invitations.controller';
import { consultantsRouter } from './consultants.routes';
import { recruitersRouter } from './recruiters.routes';
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
router.use('/work-auth-docs', workAuthDocsRouter);
router.use('/recruiters', recruitersRouter);
router.use('/resumes', resumesRouter);
// Business modules deny a capability-less DEVELOPER (BUSINESS_ROLES = every role
// except DEVELOPER). DEVELOPER has no default business access — only the
// capability-gated admin surfaces it has been granted.
router.use('/jobs', requireRole(...BUSINESS_ROLES), jobsRouter);
router.use('/vendors', vendorsRouter);
router.use('/clients', clientsRouter);
router.use('/applications', applicationsRouter);
router.use('/feature-flags', featureFlagsRouter);
router.use('/user-groups', userGroupsRouter);
router.use('/users', usersRouter);
router.use('/admin/users', adminUsersRouter);
router.use('/glassdoor', glassdoorRouter);
router.use('/activity', activityRouter);
router.use('/recruiter-goals', recruiterGoalsRouter);
router.use('/ai-usage', aiUsageRouter);

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
router.use('/messages', requireRole(...BUSINESS_ROLES), requireFeature('messages'), messagesRouter);
router.use('/training', requireRole(...BUSINESS_ROLES), requireFeature('training'), trainingRouter);

// Realtime SSE stream — generic push channel used by messages,
// notifications, and any future feature that wants to push to a logged-in
// user without polling. Not behind a feature flag: the stream is the
// transport, individual features still gate their own events.
router.use('/realtime', realtimeRouter);
