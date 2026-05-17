/**
 * Job registry. Wire new background jobs by registering them here, then
 * `start()` from server.ts.
 *
 * Each job has a stable `name`, an `intervalMs`, an optional `initialDelayMs`,
 * and a `run()`. See ./scheduler.ts for the contract.
 */

import { register, start, stop } from './scheduler';
import { remindersJob } from './reminders.job';
import { sessionsPurgeJob } from './sessions-purge.job';
import { jobsSyncJob } from './jobs-sync.job';
import { dailyDigestJob } from './daily-digest.job';

register(remindersJob);
register(sessionsPurgeJob);
register(jobsSyncJob);
register(dailyDigestJob);

export const jobs = { start, stop };
