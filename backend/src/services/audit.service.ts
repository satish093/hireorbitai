import type { Request } from 'express';
import { db } from '../config/db';
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
  | 'admin_role_changed'
  | 'admin_user_status_changed'
  | 'admin_user_password_reset'
  | 'admin_user_deactivated'
  | 'admin_user_reactivated'
  | 'admin_user_deleted'
  | 'admin_user_impersonated'
  | 'admin_session_revoked'
  | 'admin_sessions_revoked_all'
  | 'admin_user_force_password_change'
  | 'admin_users_bulk_action'
  | 'group_created'
  | 'group_updated'
  | 'group_deleted'
  | 'group_user_assigned'
  | 'group_user_removed'
  | 'group_user_moved'
  | 'group_logo_updated'
  | 'ai_logo_analyzed'
  | 'invoice_emailed'
  | 'invoice_created'
  | 'invoice_updated'
  | 'invoice_status_changed'
  | 'invoice_archived'
  | 'invoice_restored'
  | 'invoice_deleted'
  | 'invoice_downloaded'
  | 'manager_group_grant_added'
  | 'manager_group_grant_removed'
  | 'daily_digest_sent'
  | 'daily_digest_skipped'
  | 'messages_permission_denied'
  | 'calls_permission_denied'
  | 'calls_monthly_cap_reached'
  | 'work_auth_doc_uploaded'
  | 'work_auth_doc_deleted'
  | 'upload_malware_detected'
  | 'resume_uploaded'
  | 'resume_downloaded'
  | 'resume_deleted'
  | 'resume_access_denied'
  | 'training_course_accessed'
  | 'training_lesson_accessed'
  | 'training_ai_generate'
  | 'data_access_denied'
  | 'consultant_recruiter_assigned'
  | 'ai_resume_scored'
  | 'ai_ats_scored'
  | 'ai_vendor_email_generated'
  | 'ai_resume_profile_parsed'
  | 'ai_feature_error'
  | 'dev_login'
  | 'developer_capabilities_set'
  | 'user_page_access_set'
  | 'feature_flag_changed'
  | 'feature_flag_group_override_changed';

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
  void db
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
