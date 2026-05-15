import { Router } from 'express';
import { requireAuth, blockIfMustChangePassword } from '../middleware/auth';
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
import { featureFlagsRouter } from './featureFlags.routes';
import * as featureFlagsCtl from '../controllers/featureFlags.controller';
import { userGroupsRouter } from './userGroups.routes';
import { usersRouter } from './users.routes';
import { adminUsersRouter } from './adminUsers.routes';
import { glassdoorRouter } from './glassdoor.routes';

export const router = Router();

// Public (auth handshake & invitation accept).
router.use('/auth', authRouter);

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
router.use('/interviews', interviewsRouter);
router.use('/reminders', remindersRouter);
router.use('/reports', reportsRouter);
router.use('/ai', aiRouter);
router.use('/tasks', tasksRouter);
router.use('/messages', messagesRouter);
router.use('/feature-flags', featureFlagsRouter);
router.use('/user-groups', userGroupsRouter);
router.use('/users', usersRouter);
router.use('/admin/users', adminUsersRouter);
router.use('/glassdoor', glassdoorRouter);
