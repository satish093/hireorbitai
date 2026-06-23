import { ADMIN_TIER, type UserProfile } from '../types';

/**
 * Profile fields every non-admin user MUST fill before using the app. Mirror of
 * the fields collected on the /profile/complete page and validated server-side
 * by PATCH /users/:id. `address_line2` (apt/suite) is intentionally optional.
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

/** True when every mandatory profile field is filled. */
export function isProfileComplete(profile: UserProfile): boolean {
  return REQUIRED_PROFILE_FIELDS.every((key) => filled(profile[key]));
}

/**
 * Whether the mandatory-profile gate applies to this user. Admin-tier
 * (SUPER_ADMIN / CEO / CTO / DIRECTOR) is exempt per product decision.
 */
export function profileGateApplies(profile: UserProfile): boolean {
  return !(ADMIN_TIER as readonly string[]).includes(profile.role);
}

/** Convenience: true when this user should be redirected to complete their profile. */
export function mustCompleteProfile(profile: UserProfile): boolean {
  return profileGateApplies(profile) && !isProfileComplete(profile);
}
