import { RequestHandler } from 'express';
import { z } from 'zod';
import { db } from '../config/db';
import { httpError } from '../types';
import * as authSvc from '../services/auth.service';
import { SAFE_USER_SELF_COLUMNS } from '../config/userColumns';

// ---------------------------------------------------------------------------
// /me — current user's profile, plus onboarding hints + must_change_password.
// ---------------------------------------------------------------------------
export const me: RequestHandler = async (req, res) => {
  if (!req.user) throw httpError(401, 'Not authenticated');
  // Explicit safe column list — `select('*')` would leak password_hash,
  // session_version, and any future auth-secret column added by a later
  // migration. See backend/src/config/userColumns.ts.
  const { data: user, error } = await db
    .from('users')
    .select(SAFE_USER_SELF_COLUMNS)
    .eq('id', req.user.id)
    .single();
  if (error) throw httpError(500, 'Database error');

  let consultant_id: string | null = null;
  let recruiter_id: string | null = null;
  if (user.role === 'CONSULTANT') {
    const { data: c } = await db
      .from('consultants')
      .select('id')
      .eq('user_id', user.id)
      .maybeSingle();
    consultant_id = c?.id ?? null;
  } else if (user.role === 'RECRUITER') {
    const { data: r } = await db
      .from('recruiters')
      .select('id')
      .eq('user_id', user.id)
      .maybeSingle();
    recruiter_id = r?.id ?? null;
  }
  res.json({ ...user, consultant_id, recruiter_id });
};

// ---------------------------------------------------------------------------
// /sync — ensures a public.users row exists for the auth'd user. Used by the
// frontend right after sign-in so we always have a profile to read /me from.
//
// Validates the user-supplied fields so a malicious client can't push
// oversized strings or a `javascript:` avatar URL that would later render
// in someone else's browser.
// ---------------------------------------------------------------------------
const syncSchema = z
  .object({
    full_name: z.string().trim().max(120).optional(),
    phone: z.string().trim().max(40).optional(),
    // Only http(s) avatars — `javascript:` and `data:` get rejected at the schema layer.
    avatar_url: z
      .string()
      .trim()
      .url()
      .max(2048)
      .refine((v) => /^https?:\/\//i.test(v), 'avatar_url must be http(s)')
      .optional(),
  })
  .strict();

export const syncProfile: RequestHandler = async (req, res) => {
  if (!req.user) throw httpError(401, 'Not authenticated');
  const parsed = syncSchema.safeParse(req.body ?? {});
  if (!parsed.success) throw httpError(400, parsed.error.issues[0]?.message ?? 'Invalid input');
  const patch: Record<string, unknown> = { id: req.user.id, email: req.user.email };
  // Only include keys the caller actually supplied — undefined would otherwise
  // overwrite an existing full_name set during invitation setup with null.
  if (parsed.data.full_name !== undefined) patch.full_name = parsed.data.full_name;
  if (parsed.data.phone !== undefined) patch.phone = parsed.data.phone;
  if (parsed.data.avatar_url !== undefined) patch.avatar_url = parsed.data.avatar_url;
  // .select() with no args returns every column — same leak surface as
  // select('*'). Pin to the safe self-profile list.
  const { data, error } = await db
    .from('users')
    .upsert(patch, { onConflict: 'id' })
    .select(SAFE_USER_SELF_COLUMNS)
    .single();
  if (error) throw httpError(500, 'Database error');
  res.json(data);
};

// ---------------------------------------------------------------------------
// /complete-tour — marks the first-run product tour as seen for this user.
// `completed` defaults to true; pass false to reset (the "Replay tour" link
// clears it so the tour shows again on the next dashboard visit).
// ---------------------------------------------------------------------------
const tourSchema = z.object({ completed: z.boolean().optional() }).strict();

export const completeTour: RequestHandler = async (req, res) => {
  if (!req.user) throw httpError(401, 'Not authenticated');
  const parsed = tourSchema.safeParse(req.body ?? {});
  if (!parsed.success) throw httpError(400, 'Invalid input', parsed.error.flatten());
  const completed = parsed.data.completed ?? true;
  const { error } = await db
    .from('users')
    .update({ tour_completed_at: completed ? new Date().toISOString() : null })
    .eq('id', req.user.id);
  if (error) {
    // Tolerate the column not existing yet (migration not applied) so the
    // frontend's fire-and-forget call never surfaces a 500.
    if (/schema cache|column .* does not exist/i.test(error.message)) {
      res.json({ ok: true, persisted: false });
      return;
    }
    throw httpError(500, 'Database error');
  }
  res.json({ ok: true, persisted: true });
};

// ---------------------------------------------------------------------------
// /job-alerts — per-user opt-in for the daily job-match email digest.
// ---------------------------------------------------------------------------
const jobAlertsSchema = z.object({ enabled: z.boolean() }).strict();

export const setJobAlerts: RequestHandler = async (req, res) => {
  if (!req.user) throw httpError(401, 'Not authenticated');
  const parsed = jobAlertsSchema.safeParse(req.body);
  if (!parsed.success) throw httpError(400, 'enabled (boolean) is required');
  const { error } = await db
    .from('users')
    .update({ job_alerts: parsed.data.enabled })
    .eq('id', req.user.id);
  if (error) {
    if (/schema cache|column .* does not exist/i.test(error.message)) {
      res.json({ ok: true, persisted: false });
      return;
    }
    throw httpError(500, 'Database error');
  }
  res.json({ ok: true, persisted: true });
};

// ---------------------------------------------------------------------------
// /login
// ---------------------------------------------------------------------------
const loginSchema = z
  .object({
    email: z.string().email().max(254),
    password: z.string().min(1).max(200),
  })
  .strict();

export const login: RequestHandler = async (req, res) => {
  const parsed = loginSchema.safeParse(req.body);
  if (!parsed.success) throw httpError(400, 'Email and password are required.');
  const result = await authSvc.login(parsed.data.email, parsed.data.password, req);
  res.json(result);
};

// ---------------------------------------------------------------------------
// /refresh — exchanges a refresh token for a fresh access/refresh pair.
//
// Public route (no requireAuth) — the refresh token itself is the credential.
// The api.ts interceptor on the frontend fires this when the access token is
// within ~60s of expiry.
// ---------------------------------------------------------------------------
const refreshSchema = z
  .object({
    refresh_token: z.string().min(20).max(500),
  })
  .strict();

export const refresh: RequestHandler = async (req, res) => {
  const parsed = refreshSchema.safeParse(req.body);
  if (!parsed.success) throw httpError(400, 'refresh_token required');
  const { data, error } = await db.auth.refreshSession(parsed.data.refresh_token);
  if (error || !data.session) throw httpError(401, error?.message ?? 'Invalid refresh token');
  res.json({
    access_token: data.session.access_token,
    refresh_token: data.session.refresh_token,
    expires_at: data.session.expires_at,
  });
};

// ---------------------------------------------------------------------------
// /logout — revokes all of the user's refresh tokens server-side.
// ---------------------------------------------------------------------------
export const logout: RequestHandler = async (req, res) => {
  if (!req.user) throw httpError(401, 'Not authenticated');
  await authSvc.logout(req.user.id, req);
  res.json({ ok: true });
};

// ---------------------------------------------------------------------------
// /change-password — used by the forced first-login flow AND voluntary changes
// ---------------------------------------------------------------------------
const changePwSchema = z
  .object({
    current_password: z.string().min(1).max(200),
    new_password: z.string().min(12).max(200),
    // No min length here — the "passwords do not match" branch below handles
    // a too-short confirm, and we'd rather show that message than a confusing
    // "must be at least 12 characters" error pointed at the confirm field.
    confirm_password: z.string().max(200),
  })
  .strict();

export const changePassword: RequestHandler = async (req, res) => {
  if (!req.user) throw httpError(401, 'Not authenticated');
  const parsed = changePwSchema.safeParse(req.body);
  if (!parsed.success) throw httpError(400, parsed.error.issues[0]?.message ?? 'Invalid input.');
  if (parsed.data.new_password !== parsed.data.confirm_password) {
    throw httpError(400, 'New passwords do not match.');
  }
  const session = await authSvc.changePassword({
    userId: req.user.id,
    email: req.user.email,
    currentPassword: parsed.data.current_password,
    newPassword: parsed.data.new_password,
    req,
  });
  res.json({ ok: true, ...session });
};

// ---------------------------------------------------------------------------
// /forgot-password — generates a token and emails it. Always returns 200 so
// we don't reveal whether an email is registered.
// ---------------------------------------------------------------------------
const forgotSchema = z.object({ email: z.string().email().max(254) }).strict();

export const forgotPassword: RequestHandler = async (req, res) => {
  const parsed = forgotSchema.safeParse(req.body);
  if (!parsed.success) {
    // Even malformed emails return 200 (after a small delay) to avoid leaking.
    await new Promise((r) => setTimeout(r, 100));
    res.json({ ok: true });
    return;
  }
  await authSvc.requestPasswordReset(parsed.data.email, req);
  res.json({ ok: true });
};

// ---------------------------------------------------------------------------
// /reset-password — consumes a token, sets a new password.
// ---------------------------------------------------------------------------
const resetSchema = z
  .object({
    token: z.string().min(20).max(500),
    new_password: z.string().min(12).max(200),
    // See changePwSchema — let the mismatch branch surface a clearer error.
    confirm_password: z.string().max(200),
  })
  .strict();

export const resetPassword: RequestHandler = async (req, res) => {
  const parsed = resetSchema.safeParse(req.body);
  if (!parsed.success) throw httpError(400, parsed.error.issues[0]?.message ?? 'Invalid input.');
  if (parsed.data.new_password !== parsed.data.confirm_password) {
    throw httpError(400, 'Passwords do not match.');
  }
  await authSvc.completePasswordReset({
    token: parsed.data.token,
    newPassword: parsed.data.new_password,
    req,
  });
  res.json({ ok: true });
};
