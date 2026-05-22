import { Calendar } from './Calendar';

/**
 * Interviews is a thin wrapper over the shared Calendar surface in `interviews`
 * mode: prefiltered to the interview + mock-loop calendars, with the full
 * scheduler (Day view, the Schedule modal, and per-interview feedback). The
 * standalone /calendar page uses the default `planner` mode — view-only for
 * interviews, with personal "Add to date" reminders instead.
 */
export function Interviews() {
  return <Calendar restrictTo={['interviews', 'mock']} mode="interviews" />;
}
