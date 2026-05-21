import { Calendar } from './Calendar';

/**
 * Interviews is now a thin wrapper over the unified Calendar surface,
 * prefiltered to the interview + mock-loop calendars. Scheduling and feedback
 * happen inline on the calendar (Schedule button + event detail bar), so the
 * old standalone management table has been retired in favour of one surface.
 */
export function Interviews() {
  return <Calendar restrictTo={['interviews', 'mock']} />;
}
