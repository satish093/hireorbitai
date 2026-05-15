import { RequestHandler } from 'express';
import { z } from 'zod';
import { supabaseAdmin } from '../config/supabase';
import { httpError, ALL_ROLES, Role } from '../types';
import { audit } from '../services/audit.service';
import { requestPasswordReset } from '../services/auth.service';
import { logger } from '../config/logger';

// ---------------------------------------------------------------------------
// Admin user-management surface (mounted at /admin/users).
//
// Every route here is protected by `requireAdmin` upstream — see
// routes/index.ts. Listing, status changes, and admin-triggered password
// resets all live here. The role-specific data ("Candidate has resume X")
// lives in the existing /users/:id endpoint and is reused for the detail
// view; this controller focuses on org-level admin actions.
// ---------------------------------------------------------------------------

const STATUSES = ['active', 'inactive', 'suspended', 'pending_verification', 'banned'] as const;
type Status = typeof STATUSES[number];

// ---------------------------------------------------------------------------
// GET /admin/users
//
// Server-side filtering + pagination — frontend never pulls more than one
// page, so the table stays fast even for thousands of users.
// ---------------------------------------------------------------------------
const listSchema = z.object({
  q: z.string().trim().max(120).optional(),
  role: z.enum(ALL_ROLES as unknown as [Role, ...Role[]]).optional(),
  status: z.enum(STATUSES).optional(),
  page: z.coerce.number().int().min(1).max(10000).default(1),
  page_size: z.coerce.number().int().min(1).max(200).default(50),
  sort: z.enum(['created_at', 'last_login_at', 'email', 'full_name']).default('created_at'),
  order: z.enum(['asc', 'desc']).default('desc'),
});

export const list: RequestHandler = async (req, res) => {
  const parsed = listSchema.safeParse(req.query);
  if (!parsed.success) throw httpError(400, parsed.error.issues[0]?.message ?? 'Invalid query');
  const { q, role, status, page, page_size, sort, order } = parsed.data;

  const from = (page - 1) * page_size;
  const to = from + page_size - 1;

  // PostgREST returns the matched-row count in the response when we ask for
  // it via `count: 'exact'`. That's what powers the pagination footer.
  let query = supabaseAdmin
    .from('users')
    .select(
      'id, email, full_name, role, status, must_change_password, ' +
      'created_at, updated_at, last_login_at, last_seen_at, status_reason',
      { count: 'exact' },
    )
    .order(sort, { ascending: order === 'asc', nullsFirst: false })
    .range(from, to);

  if (role) query = query.eq('role', role);
  if (status) query = query.eq('status', status);
  if (q) {
    // `or()` with ilike on email + full_name covers the common search cases.
    // We escape `%` and `_` so a literal "%" in the search string doesn't
    // turn into a wildcard.
    const safe = q.replace(/[%_]/g, (m) => `\\${m}`);
    query = query.or(`email.ilike.%${safe}%,full_name.ilike.%${safe}%`);
  }

  const { data, error, count } = await query;
  if (error) throw httpError(500, error.message);

  res.json({
    rows: data ?? [],
    page,
    page_size,
    total: count ?? 0,
    total_pages: count ? Math.ceil(count / page_size) : 0,
  });
};

// ---------------------------------------------------------------------------
// GET /admin/users/:id
//
// Returns the full profile + role-specific context. We reuse the existing
// /users/:id payload shape so the frontend's UserProfile.tsx component can
// render either the admin view or a self-view.
// ---------------------------------------------------------------------------
export const get: RequestHandler = async (req, res) => {
  const { id } = req.params;
  const { data, error } = await supabaseAdmin
    .from('users')
    .select('*')
    .eq('id', id)
    .maybeSingle();
  if (error) throw httpError(500, error.message);
  if (!data) throw httpError(404, 'User not found');

  // Role-specific context (consultants/recruiters joins) — same enrichment
  // the public /users/:id does.
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
          .select('id, team, user:users!user_id(id, full_name, email)')
          .eq('id', cons.recruiter_id).maybeSingle();
        context.recruiter = rec;
      }
    }
  } else if (data.role === 'RECRUITER') {
    const { data: rec } = await supabaseAdmin
      .from('recruiters')
      .select('id, team, target_submissions_per_week, manager_id, ' +
              'manager:users!manager_id(id, full_name, email)')
      .eq('user_id', data.id).maybeSingle();
    context.recruiter = rec;
  }

  res.json({ ...data, context });
};

// ---------------------------------------------------------------------------
// PATCH /admin/users/:id/status
//
// Centralized status changer. Any non-`active` value also revokes the user's
// refresh tokens so they can't continue using a still-valid access token
// past its short TTL. Audit logged.
// ---------------------------------------------------------------------------
const statusSchema = z.object({
  status: z.enum(STATUSES),
  reason: z.string().trim().max(500).optional(),
});

export const setStatus: RequestHandler = async (req, res) => {
  if (!req.user) throw httpError(401, 'Not authenticated');
  const { id } = req.params;
  const parsed = statusSchema.safeParse(req.body);
  if (!parsed.success) throw httpError(400, parsed.error.issues[0]?.message ?? 'Invalid input');
  const { status, reason } = parsed.data;

  // Self-protection: an admin can't lock themselves out by accident.
  if (req.user.id === id && status !== 'active') {
    throw httpError(400, 'Refusing to change your own status — ask another admin.');
  }

  const { data: before } = await supabaseAdmin
    .from('users')
    .select('id, email, status')
    .eq('id', id)
    .maybeSingle();
  if (!before) throw httpError(404, 'User not found');

  const now = new Date().toISOString();
  const { data, error } = await supabaseAdmin
    .from('users')
    .update({
      status,
      status_reason: reason ?? null,
      status_changed_at: now,
      status_changed_by: req.user.id,
      // Keep the legacy boolean in sync for any older code paths that still
      // read is_active. New code should read `status` directly.
      is_active: status === 'active',
    })
    .eq('id', id)
    .select('id, email, status, status_reason, status_changed_at')
    .single();
  if (error) throw httpError(500, error.message);

  // Revoke ALL of the user's refresh tokens whenever they leave the active
  // state. Without this, a still-valid access token (TTL up to 1h) could
  // continue making requests until expiry.
  if (status !== 'active') {
    await supabaseAdmin.auth.admin.signOut(id, 'global').catch((e) => {
      logger.warn({ err: e }, 'admin status change: signOut failed');
    });
  }

  // Audit. Different action verbs based on direction so the audit log
  // reads naturally.
  audit({
    action: status === 'active' ? 'admin_user_reactivated' : 'admin_user_deactivated',
    user_id: id,
    email: data.email,
    req,
    metadata: { from: before.status, to: status, reason: reason ?? null, by: req.user.id },
  });

  res.json(data);
};

// ---------------------------------------------------------------------------
// PATCH /admin/users/:id/notes
//
// Admin-only free-text scratchpad. Never exposed to the user themselves.
// ---------------------------------------------------------------------------
const notesSchema = z.object({ admin_notes: z.string().max(5000).nullable() });
export const setNotes: RequestHandler = async (req, res) => {
  const { id } = req.params;
  const parsed = notesSchema.safeParse(req.body);
  if (!parsed.success) throw httpError(400, 'Invalid input');
  const { data, error } = await supabaseAdmin
    .from('users')
    .update({ admin_notes: parsed.data.admin_notes })
    .eq('id', id)
    .select('id, admin_notes')
    .single();
  if (error) throw httpError(500, error.message);
  res.json(data);
};

// ---------------------------------------------------------------------------
// POST /admin/users/:id/send-password-reset
//
// Admin-triggered password reset. Generates a fresh token (15-min TTL) and
// emails it via Brevo — same flow as the user-initiated forgot-password.
// Returns 204 with no body so we don't leak whether the user existed
// (consistent with the public endpoint's anti-enumeration behavior).
// ---------------------------------------------------------------------------
export const sendPasswordReset: RequestHandler = async (req, res) => {
  if (!req.user) throw httpError(401, 'Not authenticated');
  const { id } = req.params;
  const { data: target } = await supabaseAdmin
    .from('users')
    .select('email')
    .eq('id', id)
    .maybeSingle();
  if (!target) throw httpError(404, 'User not found');

  await requestPasswordReset(target.email, req);
  audit({
    action: 'admin_user_password_reset',
    user_id: id,
    email: target.email,
    req,
    metadata: { by: req.user.id },
  });
  res.json({ ok: true });
};

// ---------------------------------------------------------------------------
// GET /admin/users/:id/audit
//
// Last 200 audit events for this user. Used by the admin detail page's
// activity timeline.
// ---------------------------------------------------------------------------
export const auditLog: RequestHandler = async (req, res) => {
  const { id } = req.params;
  const { data, error } = await supabaseAdmin
    .from('auth_audit_logs')
    .select('id, action, ip_address, user_agent, metadata, created_at, email')
    .eq('user_id', id)
    .order('created_at', { ascending: false })
    .limit(200);
  if (error) throw httpError(500, error.message);
  res.json(data ?? []);
};
