import type { Page, Route } from '@playwright/test';

/**
 * Shared mocking helpers for the smoke suite.
 *
 * Every test runs against the real Vite-built app but with a fully mocked API.
 * `mockApi` installs a single catch-all route over `**​/api/**` and answers from
 * a small, overridable map. Tests pass `profile` / `flags` / per-endpoint
 * `handlers` to shape exactly the responses the flow under test needs; anything
 * unmocked falls back to an empty success so a dashboard's incidental fetches
 * never hang on a real host.
 *
 * Auth shapes mirror the real backend contract consumed by:
 *   - context/AuthContext.tsx  (POST /auth/login, GET /auth/me)
 *   - hooks/useFeatureFlags.tsx (GET /feature-flags/me)
 *   - services/session.ts       (localStorage key `hireorbitai.session`)
 */

export const SESSION_KEY = 'hireorbitai.session';

export type Role =
  | 'SUPER_ADMIN'
  | 'CEO'
  | 'CTO'
  | 'DIRECTOR'
  | 'MANAGER'
  | 'HR_MANAGER'
  | 'DEVELOPER'
  | 'RECRUITER'
  | 'CONSULTANT';

export interface MockProfile {
  id: string;
  email: string;
  full_name: string;
  role: Role;
  is_active: boolean;
  must_change_password?: boolean;
  consultant_id?: string | null;
  recruiter_id?: string | null;
  /** DEVELOPER-only grants. A DEVELOPER reaches a gated surface only if its
   *  capability string is listed here (mirrors the backend fail-closed gate). */
  capabilities?: string[];
  /** Set to a timestamp so the first-run ProductTour overlay never auto-opens
   *  over the dashboard (it would otherwise intercept clicks in tests). */
  tour_completed_at?: string | null;
  // Mandatory-profile fields (see src/utils/profileComplete.ts). Non-admin
  // users with any of these blank are bounced to /profile/complete by
  // ProtectedRoute, so every fixture below fills them via COMPLETE_PROFILE.
  first_name?: string | null;
  last_name?: string | null;
  phone?: string | null;
  address_line1?: string | null;
  address_line2?: string | null;
  city?: string | null;
  state?: string | null;
  postal_code?: string | null;
  country?: string | null;
  linkedin_url?: string | null;
}

/**
 * Filled mandatory-profile fields so the ProtectedRoute profile-completion gate
 * (src/utils/profileComplete.ts) treats a mocked user as complete and renders
 * the requested page instead of redirecting to /profile/complete. Admin-tier is
 * exempt from the gate, but including these is harmless.
 */
export const COMPLETE_PROFILE = {
  first_name: 'Test',
  last_name: 'User',
  phone: '+1 555 010 0000',
  address_line1: '1 Test Plaza',
  city: 'Austin',
  state: 'TX',
  postal_code: '78701',
  country: 'United States',
  linkedin_url: 'https://www.linkedin.com/in/testuser',
} as const;

/** A manager-tier profile — lands on the Manager dashboard, no onboarding gate. */
export const MANAGER: MockProfile = {
  id: 'u-manager',
  email: 'manager@test.local',
  full_name: 'Morgan Manager',
  role: 'MANAGER',
  is_active: true,
  must_change_password: false,
  tour_completed_at: '2024-01-01T00:00:00.000Z',
  ...COMPLETE_PROFILE,
};

/** A consultant who has finished onboarding (consultant_id set). */
export const CONSULTANT: MockProfile = {
  id: 'u-consultant',
  email: 'consultant@test.local',
  full_name: 'Casey Consultant',
  role: 'CONSULTANT',
  is_active: true,
  must_change_password: false,
  consultant_id: 'c-1',
  tour_completed_at: '2024-01-01T00:00:00.000Z',
  ...COMPLETE_PROFILE,
};

/** A recruiter who has finished onboarding (recruiter_id set) — no onboarding gate. */
export const RECRUITER: MockProfile = {
  id: 'u-recruiter',
  email: 'recruiter@test.local',
  full_name: 'Riley Recruiter',
  role: 'RECRUITER',
  is_active: true,
  must_change_password: false,
  recruiter_id: 'r-1',
  tour_completed_at: '2024-01-01T00:00:00.000Z',
  ...COMPLETE_PROFILE,
};

/** A DEVELOPER with no capabilities — scoped super-admin with nothing granted.
 *  Lands on the neutral DeveloperHome, never a business dashboard. Override
 *  `capabilities` in a spec (via the /auth/me handler) to grant a surface. */
export const DEVELOPER: MockProfile = {
  id: 'u-developer',
  email: 'developer@test.local',
  full_name: 'Devon Developer',
  role: 'DEVELOPER',
  is_active: true,
  must_change_password: false,
  tour_completed_at: '2024-01-01T00:00:00.000Z',
  ...COMPLETE_PROFILE,
};

interface FulfillSpec {
  status?: number;
  json?: unknown;
  /** Raw body — use for literal `null` responses (`{ body: 'null' }`). */
  body?: string;
  contentType?: string;
}

export interface MockApiOptions {
  /** Response for GET /auth/me. Omit → 401 (simulates an invalid token). */
  profile?: MockProfile | null;
  /** Effective feature-flag map for GET /feature-flags/me. */
  flags?: Record<string, boolean>;
  /**
   * Per-endpoint overrides keyed by `"<METHOD> <path>"` or just `"<path>"`
   * (path is the part after `/api`, e.g. `/auth/login`). Highest priority.
   */
  handlers?: Record<string, FulfillSpec>;
}

function fulfill(route: Route, spec: FulfillSpec): Promise<void> {
  if (spec.body !== undefined) {
    return route.fulfill({
      status: spec.status ?? 200,
      contentType: spec.contentType ?? 'application/json',
      body: spec.body,
    });
  }
  return route.fulfill({ status: spec.status ?? 200, json: spec.json ?? {} });
}

export async function mockApi(page: Page, opts: MockApiOptions = {}): Promise<void> {
  await page.route('**/api/**', async (route) => {
    const req = route.request();
    const method = req.method().toUpperCase();
    const path = new URL(req.url()).pathname.replace(/^\/api/, '');

    const override = opts.handlers?.[`${method} ${path}`] ?? opts.handlers?.[path];
    if (override) return fulfill(route, override);

    switch (path) {
      case '/auth/me':
        if (!opts.profile) return route.fulfill({ status: 401, json: { error: 'Unauthorized' } });
        // Default-fill the mandatory-profile fields so ProtectedRoute's
        // profile-completion gate (src/utils/profileComplete.ts) doesn't bounce
        // mocked users to /profile/complete. A spec can still override any field
        // by setting it on its profile (e.g. to exercise the gate itself).
        return route.fulfill({ json: { ...COMPLETE_PROFILE, ...opts.profile } });
      case '/feature-flags/me':
        return route.fulfill({ json: opts.flags ?? {} });
      case '/auth/refresh':
        return route.fulfill({
          json: {
            access_token: 'test-access-refreshed',
            refresh_token: 'test-refresh-refreshed',
            expires_at: Math.floor(Date.now() / 1000) + 3600,
          },
        });
      case '/auth/logout':
        return route.fulfill({ json: { ok: true } });
      case '/realtime/stream':
        // The SSE transport. Answer with a valid (empty) event-stream so the
        // browser's EventSource doesn't log a MIME-type console error — an
        // incidental connection unrelated to whatever a spec is asserting.
        return route.fulfill({
          status: 200,
          contentType: 'text/event-stream',
          body: ': connected\n\n',
        });
      default:
        // Unmocked endpoint: empty-but-valid success. Lists get `[]`, writes `{}`.
        return route.fulfill({ json: method === 'GET' ? [] : {} });
    }
  });
}

/** Seed a logged-in session into localStorage before the app boots. */
export async function seedSession(page: Page, profile: MockProfile): Promise<void> {
  await page.addInitScript(
    ([key, p]) => {
      const prof = p as MockProfile;
      window.localStorage.setItem(
        key as string,
        JSON.stringify({
          access_token: 'test-access',
          refresh_token: 'test-refresh',
          expires_at: Math.floor(Date.now() / 1000) + 3600,
          user: { id: prof.id, email: prof.email, role: prof.role },
        }),
      );
    },
    [SESSION_KEY, profile] as const,
  );
}

/** Collect uncaught page exceptions so a spec can assert the app never crashed. */
export function trackPageErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on('pageerror', (err) => errors.push(err.message));
  return errors;
}
