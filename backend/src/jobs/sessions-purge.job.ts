/**
 * Auth sessions purge job.
 *
 * Deletes expired refresh-token rows from public.auth_sessions. Runs every
 * 30 minutes — the cost of leaving expired rows around is just a slightly
 * longer bcrypt-compare scan in `auth.local.refreshSession`, so this is
 * housekeeping not correctness.
 */

import * as authSessions from '../repositories/authSessions.repository';
import { logger } from '../config/logger';

export const sessionsPurgeJob = {
  name: 'auth_sessions.purge',
  intervalMs: 30 * 60_000,
  initialDelayMs: 60_000,
  async run() {
    const deleted = await authSessions.purgeExpired();
    if (deleted > 0) {
      logger.info({ deleted }, 'auth_sessions.purge: deleted expired rows');
    }
  },
};
