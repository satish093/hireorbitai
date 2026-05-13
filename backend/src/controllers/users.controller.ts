import { RequestHandler } from 'express';
import { z } from 'zod';
import { supabaseAdmin } from '../config/supabase';
import { httpError, MANAGER_TIER, OPERATOR_TIER, Role, ALL_ROLES } from '../types';
import * as authSvc from '../services/auth.service';

/** Columns returned on every profile fetch. We keep this list explicit so a
 *  schema migration that lags doesn't break the read path. */
const PROFILE_COLS_FULL =
  'id, email, full_name, first_name, last_name, phone, role, avatar_url, is_active, ' +
  'last_seen_at, group_id, reports_to, ' +
  'address_line1, address_line2, city, state, postal_code, country, timezone, linkedin_url, ' +
  'created_at, updated_at';
const PROFILE_COLS_LEGACY = 'id, email, full_name, phone, role, avatar_url, is_active, created_at, updated_at';

function isManagerTier(role: Role | undefined): boolean {
  return !!role && (MANAGER_TIER as Role[]).includes(role);
}
function isOperatorTier(role: Role | undefined): boolean {
  return !!role && (OPERATOR_TIER as Role[]).includes(role);
}

/** Can the calling user view the target user's profile?
 *   - MANAGER_TIER / RECRUITER (= OPERATOR_TIER): yes, for anyone in the org.
 *   - CONSULTANT: only their own profile. */
async function canViewProfile(caller: { id: string; role: Role }, targetUserId: string): Promise<boolean> {
  if (caller.id === targetUserId) return true;
  if (isOperatorTier(caller.role)) return true;
  return false;
}

/** Can the calling user edit the target user's profile?
 *   - MANAGER_TIER: yes (full org admin).
 *   - Anyone else: only their own profile. */
function canEditProfile(caller: { id: string; role: Role }, targetUserId: string): boolean {
  if (caller.id === targetUserId) return true;
  return isManagerTier(caller.role);
}

/** GET /users/:id — fetch one user's profile (scoped). */
export const get: RequestHandler = async (req, res) => {
  if (!req.user) throw httpError(401, 'Not authenticated');
  if (!(await canViewProfile(req.user, req.params.id))) throw httpError(403, 'Forbidden');

  let data: any = null;
  let error: any = null;
  ({ data, error } = await supabaseAdmin
    .from('users').select(PROFILE_COLS_FULL).eq('id', req.params.id).maybeSingle());
  if (error && /column .* does not exist|schema cache/i.test(error.message)) {
    ({ data, error } = await supabaseAdmin
      .from('users').select(PROFILE_COLS_LEGACY).eq('id', req.params.id).maybeSingle());
  }
  if (error) throw httpError(500, error.message);
  if (!data) throw httpError(404, 'User not found');

  // Enrich with role-specific context (consultant + recruiter linkage), so
  // the profile page can show "Reports to: …" / "Recruiter: …".
  const context: any = {};
  if (data.role === 'CONSULTANT') {
    const consResult = await supabaseAdmin
      .from('consultants')
      .select('id, recruiter_id, primary_skill, skills, total_experience_years, ' +
              'visa_status, current_location, preferred_locations, marketing_status, ' +
              'linkedin_url, github_url')
      .eq('user_id', data.id).maybeSingle();
    const cons: any = consResult.data;
    if (cons) {
      context.consultant = cons;
      if (cons.recruiter_id) {
        const { data: rec } = await supabaseAdmin
          .from('recruiters')
          .select('id, team, user:users!user_id(id, full_name, email, phone)')
          .eq('id', cons.recruiter_id).maybeSingle();
        context.recruiter = rec;
      }
    }
  } else if (data.role === 'RECRUITER') {
    const { data: rec } = await supabaseAdmin
      .from('recruiters')
      .select('id, manager_id, team, target_submissions_per_week, ' +
              'manager:users!manager_id(id, full_name, email)')
      .eq('user_id', data.id).maybeSingle();
    context.recruiter = rec;
  }

  res.json({ ...data, context });
};

/** PATCH /users/:id — update profile fields (self or admin). */
export const update: RequestHandler = async (req, res) => {
  if (!req.user) throw httpError(401, 'Not authenticated');
  if (!canEditProfile(req.user, req.params.id)) throw httpError(403, 'Forbidden');

  const schema = z.object({
    full_name: z.string().max(120).optional(),
    first_name: z.string().max(60).optional(),
    last_name: z.string().max(60).optional(),
    phone: z.string().max(40).optional().nullable(),
    avatar_url: z.string().url().optional().or(z.literal('')).nullable(),
    address_line1: z.string().max(120).optional().nullable(),
    address_line2: z.string().max(120).optional().nullable(),
    city: z.string().max(80).optional().nullable(),
    state: z.string().max(80).optional().nullable(),
    postal_code: z.string().max(20).optional().nullable(),
    country: z.string().max(60).optional().nullable(),
    timezone: z.string().max(60).optional().nullable(),
    linkedin_url: z.string().url().optional().or(z.literal('')).nullable(),
  });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) throw httpError(400, 'Invalid input', parsed.error.flatten());

  // Keep full_name in sync when first/last are supplied.
  const patch: Record<string, unknown> = { ...parsed.data, updated_at: new Date().toISOString() };
  if ((parsed.data.first_name || parsed.data.last_name) && !parsed.data.full_name) {
    patch.full_name = [parsed.data.first_name, parsed.data.last_name].filter(Boolean).join(' ').trim();
  }

  // Strip columns that aren't present yet (migration lag) and retry.
  const OPTIONAL = ['first_name', 'last_name', 'address_line1', 'address_line2',
                    'city', 'state', 'postal_code', 'country', 'timezone', 'linkedin_url'];
  let { data, error } = await supabaseAdmin
    .from('users').update(patch).eq('id', req.params.id)
    .select(PROFILE_COLS_FULL).single();
  let attempts = 0;
  while (error && attempts < OPTIONAL.length) {
    const msg = error.message ?? '';
    const isSchemaErr = /schema cache|column .* does not exist/i.test(msg);
    if (!isSchemaErr) break;
    let removed = false;
    for (const col of OPTIONAL) {
      if (msg.includes(col) && col in patch) {
        delete patch[col];
        removed = true;
        attempts++;
        break;
      }
    }
    if (!removed) break;
    ({ data, error } = await supabaseAdmin
      .from('users').update(patch).eq('id', req.params.id)
      .select(PROFILE_COLS_LEGACY).single());
  }
  if (error) throw httpError(500, error.message);
  res.json(data);
};

// ---------------------------------------------------------------------------
// POST /users — admin-only user creation
//
// Generates a temp password, creates the Supabase auth user, inserts the
// matching public.users row with must_change_password=true, then emails the
// temp credentials via Brevo. The route is gated by requireAdmin upstream.
// ---------------------------------------------------------------------------
const ROLE_VALUES = ALL_ROLES as readonly Role[];
const adminCreateSchema = z.object({
  email: z.string().email().max(254),
  full_name: z.string().min(1).max(120).optional(),
  role: z.enum(ROLE_VALUES as unknown as [Role, ...Role[]]),
});

export const adminCreate: RequestHandler = async (req, res) => {
  if (!req.user) throw httpError(401, 'Not authenticated');
  const parsed = adminCreateSchema.safeParse(req.body);
  if (!parsed.success) throw httpError(400, parsed.error.issues[0]?.message ?? 'Invalid input');

  const { user_id } = await authSvc.adminCreateUser({
    email: parsed.data.email,
    fullName: parsed.data.full_name,
    role: parsed.data.role,
    createdBy: { id: req.user.id, email: req.user.email },
    req,
  });

  res.status(201).json({ ok: true, user_id });
};

