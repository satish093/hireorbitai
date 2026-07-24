import { useEffect, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { api } from '../services/api';
import { TourOverlay, TourStep } from './TourOverlay';

/** Custom event other parts of the app fire to re-open the tour on demand
 *  (e.g. a "Replay tour" button on the profile page). */
export const REPLAY_TOUR_EVENT = 'hireorbit:replay-tour';

/** Convenience helper for the replay button. */
export function replayTour() {
  window.dispatchEvent(new Event(REPLAY_TOUR_EVENT));
}

// Steps shared by everyone. Selectors point at the sidebar nav anchors added
// in Sidebar.tsx; when the sidebar is collapsed (mobile) the overlay falls
// back to a centered card automatically.
const COMMON_INTRO: TourStep = {
  title: 'Welcome to HireOrbit 👋',
  body: 'A quick 4-step tour of where things live. You can skip anytime and replay it later from your profile.',
};
const STEP_DASHBOARD: TourStep = {
  selector: '[data-tour="nav-/dashboard"]',
  title: 'Your dashboard',
  body: 'Your home base — a snapshot of what needs attention. You can always get back here from the top of the sidebar.',
};
const STEP_JOBS: TourStep = {
  selector: '[data-tour="nav-/jobs"]',
  title: 'Find jobs',
  body: 'Browse and search openings here. Click any listing to see the full detail and how it matches.',
};
const STEP_RESUMES: TourStep = {
  selector: '[data-tour="nav-/resumes"]',
  title: 'Manage resumes',
  body: 'Upload and version resumes. They power match scoring and one-click apply.',
};
const STEP_CONSULTANTS: TourStep = {
  selector: '[data-tour="nav-/consultants"]',
  title: 'Your consultants',
  body: 'See and manage the consultants you work with — their pipeline, applications, and interviews.',
};
const STEP_PROFILE: TourStep = {
  selector: '[data-tour="nav-profile"]',
  title: 'Your profile',
  body: 'Update your details here. You can replay this tour anytime from this page.',
};

function stepsForRole(role: string | undefined): TourStep[] {
  if (role === 'CONSULTANT') {
    return [COMMON_INTRO, STEP_DASHBOARD, STEP_JOBS, STEP_RESUMES, STEP_PROFILE];
  }
  if (role === 'RECRUITER') {
    return [COMMON_INTRO, STEP_DASHBOARD, STEP_CONSULTANTS, STEP_JOBS, STEP_PROFILE];
  }
  // Manager-tier and above.
  return [COMMON_INTRO, STEP_DASHBOARD, STEP_CONSULTANTS, STEP_JOBS, STEP_PROFILE];
}

/**
 * First-run product tour launcher. Mounted once at the App level.
 *
 * Auto-starts the tour the first time a signed-in user lands on /dashboard
 * and hasn't completed it (`profile.tour_completed_at` is null). Completing
 * or skipping persists via POST /auth/complete-tour and refreshes the
 * profile so it won't reappear. A `hireorbit:replay-tour` window event
 * re-opens it on demand.
 */
export function ProductTour() {
  const { profile, refreshProfile } = useAuth();
  const loc = useLocation();
  const [open, setOpen] = useState(false);
  // Guard so a dismissal within the session doesn't immediately re-trigger
  // before the profile refresh round-trips.
  const [handled, setHandled] = useState(false);

  // Auto-start on first dashboard visit.
  useEffect(() => {
    if (!profile || handled) return;
    if (profile.tour_completed_at) return;
    if (loc.pathname !== '/dashboard') return;
    // Small delay so the dashboard + sidebar have painted before we measure.
    const t = setTimeout(() => setOpen(true), 600);
    return () => clearTimeout(t);
  }, [profile, loc.pathname, handled]);

  // Replay on demand, regardless of completion state.
  useEffect(() => {
    const onReplay = () => {
      setHandled(true);
      setOpen(true);
    };
    window.addEventListener(REPLAY_TOUR_EVENT, onReplay);
    return () => window.removeEventListener(REPLAY_TOUR_EVENT, onReplay);
  }, []);

  if (!open || !profile) return null;

  async function finish() {
    setOpen(false);
    setHandled(true);
    try {
      await api.post('/auth/complete-tour', { completed: true });
      await refreshProfile();
    } catch {
      // Best-effort — if the persist call fails the tour may show again next
      // session, which is acceptable. Never block the UI on it.
    }
  }

  return <TourOverlay steps={stepsForRole(profile.role)} onClose={finish} onComplete={finish} />;
}
