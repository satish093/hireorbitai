import { RequestHandler } from 'express';
import { z } from 'zod';
import { db } from '../config/db';
import { httpError } from '../types';
import * as authSvc from '../services/auth.service';
import { SAFE_USER_SELF_COLUMNS } from '../config/userColumns';

// Self-profile columns that landed in a late migration — if the deployed DB
// hasn't picked them up yet (Render dev DB, fresh test instance, restored
// snapshot), selecting them errors with "column ... does not exist". We strip
// the missing one and retry instead of 500-ing the whole /auth/me bootstrap,
// since a no-profile response cascades into every user hitting /unauthorized.
// Convention matches users.controller / messages.controller / tasks.controller.
const OPTIONAL_SELF_COLUMNS = ['tour_completed_at', 'job_alerts', 'last_seen_at', 'capabilities'];

function stripMissingColumn(cols: string, msg: string): string | null {
  for (const c of OPTIONAL_SELF_COLUMNS) {
    if (msg.includes(c) && cols.includes(c)) {
      return cols
        .split(',')
        .map((s) => s.trim())
        .filter((s) => s !== c)
        .join(', ');
    }
  }
  return null;
}

async function selectSelfWithRetry(userId: string): Promise<Record<string, unknown>> {
  let cols = SAFE_USER_SELF_COLUMNS;
  // Up to OPTIONAL.length attempts: each schema-cache error peels one column.
  for (let i = 0; i <= OPTIONAL_SELF_COLUMNS.length; i++) {
    const { data, error } = await db.from('users').select(cols).eq('id', userId).single();
    if (!error) return data as Record<string, unknown>;
    const msg = error.message ?? '';
    if (!/schema cache|column .* does not exist/i.test(msg)) break;
    const stripped = stripMissingColumn(cols, msg);
    if (!stripped) break;
    cols = stripped;
  }
  throw httpError(500, 'Database error');
}

// ---------------------------------------------------------------------------
// /me — current user's profile, plus onboarding hints + must_change_password.
// ---------------------------------------------------------------------------
export const me: RequestHandler = async (req, res) => {
  if (!req.user) throw httpError(401, 'Not authenticated');
  // Explicit safe column list — `select('*')` would leak password_hash,
  // session_version, and any future auth-secret column added by a later
  // migration. See backend/src/config/userColumns.ts.
  const user = (await selectSelfWithRetry(req.user.id)) as {
    id: string;
    role: string;
    [k: string]: unknown;
  };

  let consultant_id: string | null = null;
  let recruiter_id: string | null = null;
  if (user.role === 'CONSULTANT') {
    const { data: c } = await db
      .from('consultants')
      .select('id')
      .eq('user_id', user.id)
      .maybeSingle();
    consultant_id = (c as { id?: string } | null)?.id ?? null;
  } else if (user.role === 'RECRUITER') {
    const { data: r } = await db
      .from('recruiters')
      .select('id')
      .eq('user_id', user.id)
      .maybeSingle();
    recruiter_id = (r as { id?: string } | null)?.id ?? null;
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
  // Upsert THEN reselect with strip-retry. Folding the returning select into
  // the upsert means a single missing optional column (Render dev DB lagging
  // a migration) would 500 the entire sign-in bootstrap. Splitting the round
  // trips lets the upsert succeed unconditionally and the select tolerate
  // schema lag, matching users.controller's pattern.
  const { error } = await db.from('users').upsert(patch, { onConflict: 'id' });
  if (error) throw httpError(500, 'Database error');
  const fresh = await selectSelfWithRetry(req.user.id);
  res.json(fresh);
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
// /job-alert-prefs — criteria-based filters layered on the on/off toggle.
// The daily digest narrows what it emails using these. A missing row means
// "no extra criteria"; reads/writes are fail-open if the table isn't migrated.
// ---------------------------------------------------------------------------

const DEFAULT_ALERT_PREFS = {
  keywords: [] as string[],
  locations: [] as string[],
  remote_only: false,
  min_match: 60,
  job_function: null as string | null,
};

const jobAlertPrefsSchema = z
  .object({
    keywords: z.array(z.string().trim().min(1).max(40)).max(20).optional(),
    locations: z.array(z.string().trim().min(1).max(80)).max(10).optional(),
    remote_only: z.boolean().optional(),
    min_match: z.number().int().min(0).max(100).optional(),
    job_function: z.string().trim().max(60).nullable().optional(),
  })
  .strict();

export const getJobAlertPrefs: RequestHandler = async (req, res) => {
  if (!req.user) throw httpError(401, 'Not authenticated');
  const { data, error } = await db
    .from('user_job_alert_prefs')
    .select('keywords, locations, remote_only, min_match, job_function')
    .eq('user_id', req.user.id)
    .maybeSingle();
  if (error) {
    // Table not migrated yet → behave as "no criteria set".
    if (/schema cache|does not exist/i.test(error.message)) {
      res.json(DEFAULT_ALERT_PREFS);
      return;
    }
    throw httpError(500, 'Database error');
  }
  res.json(data ?? DEFAULT_ALERT_PREFS);
};

export const setJobAlertPrefs: RequestHandler = async (req, res) => {
  if (!req.user) throw httpError(401, 'Not authenticated');
  const parsed = jobAlertPrefsSchema.safeParse(req.body);
  if (!parsed.success) throw httpError(400, 'Invalid alert preferences', parsed.error.flatten());
  // user_id is server-set from the session — never trust a body value.
  const row = {
    user_id: req.user.id,
    ...parsed.data,
    updated_at: new Date().toISOString(),
  };
  const { error } = await db.from('user_job_alert_prefs').upsert(row, { onConflict: 'user_id' });
  if (error) {
    if (/schema cache|does not exist/i.test(error.message)) {
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
