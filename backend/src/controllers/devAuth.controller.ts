/**
 * Development-only auth: one-click role/user switching with NO password.
 *
 * These handlers mint a REAL session for a REAL seeded user via the same
 * impersonation primitive the admin flow uses (db.auth.admin.createSessionForUser
 * — see auth.local.ts and adminUsers.controller.ts `impersonate`). Because the
 * session is real, the entire production auth + RBAC pipeline (requireAuth,
 * requireRole, feature gates) runs unchanged — dev RBAC == prod RBAC, with no
 * second, weaker auth path.
 *
 * Every route is mounted behind `requireDevTools`, which 404s unless
 * `env.devTools` is true. `env.devTools` is itself force-disabled in production,
 * so none of this is reachable on the live VPS.
 */

import { RequestHandler } from 'express';
import { z } from 'zod';
import { db } from '../config/db';
import { httpError, Role } from '../types';
import { audit } from '../services/audit.service';

interface SeedUserRow {
  id: string;
  email: string;
  full_name: string | null;
  role: Role;
  status: string | null;
}

// Display order for the switcher — highest tier first.
const ROLE_ORDER: Role[] = [
  'SUPER_ADMIN',
  'CEO',
  'CTO',
  'DIRECTOR',
  'MANAGER',
  'HR_MANAGER',
  'DEVELOPER',
  'RECRUITER',
  'CONSULTANT',
];

// GET /auth/dev/users — active seeded users to switch between, sorted by tier.
export const listUsers: RequestHandler = async (_req, res) => {
  const { data, error } = await db
    .from('users')
    .select('id, email, full_name, role, status')
    .eq('status', 'active');
  if (error) throw httpError(500, error.message);

  const rows = ((data as SeedUserRow[]) ?? []).slice().sort((a, b) => {
    const ra = ROLE_ORDER.indexOf(a.role);
    const rb = ROLE_ORDER.indexOf(b.role);
    if (ra !== rb) return ra - rb;
    return (a.full_name ?? a.email).localeCompare(b.full_name ?? b.email);
  });

  res.json(rows.map((u) => ({ id: u.id, email: u.email, full_name: u.full_name, role: u.role })));
};

const loginSchema = z.object({ userId: z.string().uuid() }).strict();

// POST /auth/dev/login { userId } — mint a real session for any seeded user.
export const login: RequestHandler = async (req, res) => {
  const parsed = loginSchema.safeParse(req.body);
  if (parsed.success === false)
    throw httpError(400, 'A userId is required', parsed.error.flatten());

  const { data: target } = await db
    .from('users')
    .select('id, email, full_name, role, status, is_active')
    .eq('id', parsed.data.userId)
    .maybeSingle();
  if (!target) throw httpError(404, 'User not found');
  const t = target as SeedUserRow & { is_active?: boolean | null };
  // Fail-closed status check: if `status` is NULL on a legacy row, fall
  // back to is_active so a deactivated user can't slip through the dev-login
  // door just because the new column was never backfilled. The legacy
  // boolean is_active is still authoritative in that fallback case.
  const effectiveStatus = t.status ?? (t.is_active === false ? 'inactive' : 'active');
  if (effectiveStatus !== 'active') throw httpError(403, 'User is not active');

  const { data, error } = await db.auth.admin.createSessionForUser(t.id);
  if (error || !data?.session) throw httpError(500, 'Failed to start dev session');

  audit({
    action: 'dev_login',
    user_id: t.id,
    email: t.email,
    req,
    metadata: { role: t.role, via: 'dev_tools' },
  });

  const s = data.session;
  res.json({
    access_token: s.access_token,
    refresh_token: s.refresh_token,
    expires_at: s.expires_at,
    user: { id: t.id, email: t.email, full_name: t.full_name, role: t.role },
  });
};
