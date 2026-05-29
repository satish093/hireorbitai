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
import { attachmentsPurgeJob } from './attachments-purge.job';
import { workAuthExpiryJob } from './work-auth-expiry.job';
register(remindersJob);
register(sessionsPurgeJob);
register(jobsSyncJob);
register(dailyDigestJob);
register(attachmentsPurgeJob);
// H1B / EAD / I797 expiry alerts — runs daily, emails consultant + recruiter
// + manager at 60 / 30 / 7 days out. The job was implemented + tested against
// the schema + has a Brevo template, but the audit caught that it was never
// wired into the scheduler — so the alerts simply never fired in production.
register(workAuthExpiryJob);

export const jobs = { start, stop };
