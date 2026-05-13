import { RequestHandler } from 'express';
import { z } from 'zod';
import { supabaseAdmin } from '../config/supabase';
import { httpError } from '../types';
import * as authSvc from '../services/auth.service';

// ---------------------------------------------------------------------------
// /me — current user's profile, plus onboarding hints + must_change_password.
// ---------------------------------------------------------------------------
export const me: RequestHandler = async (req, res) => {
  if (!req.user) throw httpError(401, 'Not authenticated');
  const { data: user, error } = await supabaseAdmin
    .from('users').select('*').eq('id', req.user.id).single();
  if (error) throw httpError(500, error.message);

  let consultant_id: string | null = null;
  let recruiter_id: string | null = null;
  if (user.role === 'CONSULTANT') {
    const { data: c } = await supabaseAdmin
      .from('consultants').select('id').eq('user_id', user.id).maybeSingle();
    consultant_id = c?.id ?? null;
  } else if (user.role === 'RECRUITER') {
    const { data: r } = await supabaseAdmin
      .from('recruiters').select('id').eq('user_id', user.id).maybeSingle();
    recruiter_id = r?.id ?? null;
  }
  res.json({ ...user, consultant_id, recruiter_id });
};

// ---------------------------------------------------------------------------
// /sync — ensures a public.users row exists for the auth'd user. Used by the
// frontend right after sign-in so we always have a profile to read /me from.
// ---------------------------------------------------------------------------
export const syncProfile: RequestHandler = async (req, res) => {
  if (!req.user) throw httpError(401, 'Not authenticated');
  const { full_name, phone, avatar_url } = req.body ?? {};
  const { data, error } = await supabaseAdmin
    .from('users')
    .upsert(
      { id: req.user.id, email: req.user.email, full_name, phone, avatar_url },
      { onConflict: 'id' },
    )
    .select()
    .single();
  if (error) throw httpError(500, error.message);
  res.json(data);
};

// ---------------------------------------------------------------------------
// /login
// ---------------------------------------------------------------------------
const loginSchema = z.object({
  email: z.string().email().max(254),
  password: z.string().min(1).max(200),
});

export const login: RequestHandler = async (req, res) => {
  const parsed = loginSchema.safeParse(req.body);
  if (!parsed.success) throw httpError(400, 'Email and password are required.');
  const result = await authSvc.login(parsed.data.email, parsed.data.password, req);
  res.json(result);
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
const changePwSchema = z.object({
  current_password: z.string().min(1).max(200),
  new_password: z.string().min(12).max(200),
  confirm_password: z.string().min(12).max(200),
});

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
const forgotSchema = z.object({ email: z.string().email().max(254) });

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
const resetSchema = z.object({
  token: z.string().min(20).max(500),
  new_password: z.string().min(12).max(200),
  confirm_password: z.string().min(12).max(200),
});

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
