import { ADMIN_TIER, type UserProfile } from '../types';

/**
 * Profile fields every non-admin user MUST fill before using the app. Mirror of
 * frontend/src/utils/profileComplete.ts and of the fields validated server-side
 * by PATCH /users/:id. `address_line2` (apt/suite) is intentionally optional.
 *
 * Keep this list identical to the web's. If they diverge, one client will let a
 * user through a gate the other blocks.
 */
export const REQUIRED_PROFILE_FIELDS = [
  'first_name',
  'last_name',
  'phone',
  'address_line1',
  'city',
  'state',
  'postal_code',
  'country',
  'linkedin_url',
] as const satisfies readonly (keyof UserProfile)[];

/** A required field counts as filled only when it has non-whitespace content. */
function filled(value: unknown): boolean {
  return typeof value === 'string' ? value.trim().length > 0 : value != null;
}

export function isProfileComplete(profile: UserProfile): boolean {
  return REQUIRED_PROFILE_FIELDS.every((key) => filled(profile[key]));
}

/** Admin tier (SUPER_ADMIN / CEO / CTO / DIRECTOR) is exempt from the gate. */
export function profileGateApplies(profile: UserProfile): boolean {
  return !(ADMIN_TIER as readonly string[]).includes(profile.role);
}

export function mustCompleteProfile(profile: UserProfile): boolean {
  return profileGateApplies(profile) && !isProfileComplete(profile);
}

/** Fields still missing — drives the checklist on the complete-profile screen. */
export function missingProfileFields(profile: UserProfile): (keyof UserProfile)[] {
  return REQUIRED_PROFILE_FIELDS.filter((key) => !filled(profile[key]));
}
