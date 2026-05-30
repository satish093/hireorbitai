import type { Role } from '../types';

/**
 * Client-side pre-check for whether `viewer` is potentially allowed to message
 * `target` based on role pairings alone (no assignment data required).
 *
 * This is a UI gate only — the server enforces the real check (including
 * assignment-level rules like "recruiter can only message their own consultants")
 * on POST /messages and GET /messages/contacts/allowed. Never rely on this
 * alone for security.
 *
 * Returns `true` when the role pairing is permitted by the access table in the
 * Communication Spec. Unknown roles default to `false`.
 */
export function canMessage(
  viewerRole: Role | null | undefined,
  targetRole: Role | null | undefined,
): boolean {
  if (!viewerRole || !targetRole) return false;
  // Support is universally reachable from every role
  if (targetRole === 'DEVELOPER') return true;

  switch (viewerRole) {
    case 'SUPER_ADMIN':
    case 'CEO':
    case 'CTO':
    case 'DIRECTOR':
      // Leadership can message anyone
      return true;

    case 'MANAGER':
    case 'HR_MANAGER':
      // Managers message other managers/HR/directors + recruiters + group consultants
      return [
        'MANAGER',
        'HR_MANAGER',
        'DIRECTOR',
        'CTO',
        'CEO',
        'SUPER_ADMIN',
        'RECRUITER',
        'CONSULTANT',
      ].includes(targetRole);

    case 'RECRUITER':
      // Recruiters message peer recruiters + their manager + their assigned consultants
      // (assignment-level enforced server-side; here we allow the role pairing)
      return [
        'RECRUITER',
        'MANAGER',
        'HR_MANAGER',
        'DIRECTOR',
        'CTO',
        'CEO',
        'SUPER_ADMIN',
        'CONSULTANT',
      ].includes(targetRole);

    case 'CONSULTANT':
      // Consultants message their assigned recruiter only
      // (assignment-level enforced server-side; here we allow the role pairing)
      return ['RECRUITER'].includes(targetRole);

    case 'DEVELOPER':
      // Developers can reply inside support/reporting threads but don't initiate
      return false;

    default:
      return false;
  }
}

/** Returns a readable label describing the sender's relationship to the target. */
export function relationshipLabel(
  viewerRole: Role | null | undefined,
  targetRole: Role | null | undefined,
): string {
  if (targetRole === 'DEVELOPER') return 'Support & Engineering';
  if (viewerRole === 'CONSULTANT') return 'Your recruiter';
  if (viewerRole === 'RECRUITER') {
    if (targetRole === 'CONSULTANT') return 'Your assigned consultant';
    if (
      ['MANAGER', 'HR_MANAGER', 'DIRECTOR', 'CTO', 'CEO', 'SUPER_ADMIN'].includes(targetRole ?? '')
    )
      return 'Your manager';
    if (targetRole === 'RECRUITER') return 'Peer recruiter';
  }
  if (['MANAGER', 'HR_MANAGER'].includes(viewerRole ?? '')) {
    if (targetRole === 'CONSULTANT') return 'Group consultant';
    if (targetRole === 'RECRUITER') return 'Your recruiter';
    if (['MANAGER', 'HR_MANAGER', 'DIRECTOR', 'CTO', 'CEO'].includes(targetRole ?? ''))
      return 'Peer manager';
  }
  if (['DIRECTOR', 'CTO', 'CEO', 'SUPER_ADMIN'].includes(viewerRole ?? '')) return 'Team member';
  return 'Contact';
}
