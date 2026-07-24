/**
 * Interview reminder sync.
 *
 * When an interview is scheduled (or rescheduled), we auto-create reminder
 * rows ahead of `scheduled_at` so the interviewee gets a heads-up. The
 * existing reminders dispatcher (`jobs/reminders.job.ts`) then delivers them
 * via Brevo email + an in-app SSE toast — we don't add a second delivery path.
 *
 * Auto-generated reminders are tagged `related_type='interview'` +
 * `related_id=<interview id>`, which lets us find and regenerate them when an
 * interview moves or is cancelled, without disturbing reminders the user
 * created by hand.
 *
 * Best-effort: every failure here is logged and swallowed. Failing to write a
 * reminder must never roll back the interview INSERT/UPDATE that triggered it.
 */

import { db } from '../config/db';
import { logger } from '../config/logger';

// Lead times before the interview, in minutes. 24h and 1h ahead.
const LEAD_MINUTES = [24 * 60, 60];

interface InterviewForReminder {
  id: string;
  consultant_id: string | null;
  scheduled_at: string | null;
  status?: string | null;
  type?: string | null;
  is_mock?: boolean | null;
}

/** Resolve the user_id behind a consultant row (the interviewee we notify). */
async function consultantUserId(consultantId: string): Promise<string | null> {
  const { data } = await db
    .from('consultants')
    .select('user_id')
    .eq('id', consultantId)
    .maybeSingle();
  return (data as { user_id?: string } | null)?.user_id ?? null;
}

/** Drop any auto-generated PENDING reminders for this interview. */
async function clearExisting(interviewId: string): Promise<void> {
  await db
    .from('reminders')
    .delete()
    .eq('related_type', 'interview')
    .eq('related_id', interviewId)
    .eq('status', 'PENDING');
}

/**
 * Regenerate the reminder set for one interview. Deletes the previous
 * PENDING auto-reminders, then creates fresh ones for each lead time that is
 * still in the future — but only while the interview is live (SCHEDULED) and
 * has a date. A cancelled/completed interview ends up with its pending
 * reminders cleared and none recreated.
 */
export async function syncInterviewReminders(interview: InterviewForReminder): Promise<void> {
  try {
    await clearExisting(interview.id);

    const status = (interview.status ?? 'SCHEDULED').toUpperCase();
    if (status !== 'SCHEDULED' || !interview.scheduled_at || !interview.consultant_id) return;

    const when = new Date(interview.scheduled_at).getTime();
    if (Number.isNaN(when)) return;

    const ownerId = await consultantUserId(interview.consultant_id);
    if (!ownerId) return;

    const now = Date.now();
    const label = interview.is_mock ? 'Mock interview' : 'Interview';
    const rows = LEAD_MINUTES.map((mins) => {
      const dueMs = when - mins * 60_000;
      if (dueMs <= now) return null; // lead time already passed — skip
      const human = mins >= 60 ? `${Math.round(mins / 60)}h` : `${mins}m`;
      return {
        owner_id: ownerId,
        title: `${label} in ${human}`,
        description: `Your ${label.toLowerCase()} is scheduled for ${new Date(
          interview.scheduled_at!,
        ).toLocaleString()}.`,
        related_type: 'interview',
        related_id: interview.id,
        due_at: new Date(dueMs).toISOString(),
      };
    }).filter((r): r is NonNullable<typeof r> => r !== null);

    if (rows.length === 0) return;

    const { error } = await db.from('reminders').insert(rows);
    if (error) throw new Error(error.message);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    // Older installs may lack the reminders table — stay quiet about that,
    // loud about anything else.
    if (/relation .* does not exist|schema cache|column .* does not exist/i.test(msg)) {
      logger.warn(
        { interviewId: interview.id },
        'interviewReminders: reminders table missing — skipped',
      );
    } else {
      logger.warn({ err: msg, interviewId: interview.id }, 'interviewReminders: sync failed');
    }
  }
}
