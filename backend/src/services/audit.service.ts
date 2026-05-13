import type { Request } from 'express';
import { supabaseAdmin } from '../config/supabase';
import { logger } from '../config/logger';

export type AuditAction =
  | 'login_success'
  | 'login_failed'
  | 'login_blocked_locked'
  | 'logout'
  | 'must_change_password_enforced'
  | 'password_changed'
  | 'password_reset_requested'
  | 'password_reset_completed'
  | 'password_reset_invalid_token'
  | 'account_locked'
  | 'account_unlocked'
  | 'admin_created_user'
  | 'admin_disabled_user'
  | 'admin_role_changed';

interface AuditInput {
  action: AuditAction;
  user_id?: string | null;
  email?: string | null;
  req?: Pick<Request, 'ip' | 'headers'>;
  metadata?: Record<string, unknown>;
}

/**
 * Fire-and-forget auth audit logger. Writes one row per security event to
 * `public.auth_audit_logs`. Failures are logged but never propagated — the
 * audit trail must never break the auth flow that triggered it.
 *
 * IP + user-agent are pulled from the Express request when provided. Behind
 * Nginx with `app.set('trust proxy', N)` the `req.ip` is the real client IP.
 */
export function audit(input: AuditInput): void {
  const ip = input.req?.ip ?? null;
  const ua = (input.req?.headers?.['user-agent'] as string | undefined) ?? null;
  void supabaseAdmin
    .from('auth_audit_logs')
    .insert({
      user_id: input.user_id ?? null,
      email: input.email ?? null,
      action: input.action,
      ip_address: ip,
      user_agent: ua,
      metadata: input.metadata ?? null,
    })
    .then(({ error }) => {
      if (error) {
        logger.warn({ err: error, action: input.action }, 'audit insert failed');
      }
    });
}
