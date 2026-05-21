import { Router } from 'express';
import { requireAuth, blockIfMustChangePassword } from '../middleware/auth';
import { requireFeature } from '../middleware/featureFlag';
import { authRouter } from './auth.routes';
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
import { messagesRouter } from './messages.routes';
import { realtimeRouter } from './realtime.routes';
import { featureFlagsRouter } from './featureFlags.routes';
import * as featureFlagsCtl from '../controllers/featureFlags.controller';
import { userGroupsRouter } from './userGroups.routes';
import { usersRouter } from './users.routes';
import { adminUsersRouter } from './adminUsers.routes';
import { glassdoorRouter } from './glassdoor.routes';
import { activityRouter } from './activity.routes';
import { trainingRouter } from './training.routes';
import { filesRouter } from './files.routes';

export const router = Router();

// Public (auth handshake & invitation accept).
router.use('/auth', authRouter);

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

// All other routes require auth. Additionally, every route below is blocked
// while the user is on a temporary password — they must rotate it first.
// (The /change-password route is mounted under /auth above and is exempt.)
router.use(requireAuth);
router.use(blockIfMustChangePassword);

router.use('/invitations', invitationsRouter);
router.use('/consultants', consultantsRouter);
router.use('/recruiters', recruitersRouter);
router.use('/resumes', resumesRouter);
router.use('/jobs', jobsRouter);
router.use('/vendors', vendorsRouter);
router.use('/clients', clientsRouter);
router.use('/applications', applicationsRouter);
router.use('/feature-flags', featureFlagsRouter);
router.use('/user-groups', userGroupsRouter);
router.use('/users', usersRouter);
router.use('/admin/users', adminUsersRouter);
router.use('/glassdoor', glassdoorRouter);
router.use('/activity', activityRouter);

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
router.use('/interviews', requireFeature('interviews'), interviewsRouter);
router.use('/reminders', requireFeature('reminders'), remindersRouter);
router.use('/reports', requireFeature('reports'), reportsRouter);
router.use('/ai', requireFeature('ai_email'), aiRouter);
router.use('/tasks', requireFeature('tasks'), tasksRouter);
router.use('/messages', requireFeature('messages'), messagesRouter);
router.use('/training', requireFeature('training'), trainingRouter);

// Realtime SSE stream — generic push channel used by messages,
// notifications, and any future feature that wants to push to a logged-in
// user without polling. Not behind a feature flag: the stream is the
// transport, individual features still gate their own events.
router.use('/realtime', realtimeRouter);
