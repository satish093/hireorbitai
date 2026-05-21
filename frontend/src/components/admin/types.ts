// Shared types, status tones, and small helpers for the admin Users surface.
import type { PillTone } from '../Pill';
import { Role } from '../../types';

export type Status = 'active' | 'inactive' | 'suspended' | 'pending_verification' | 'banned';

export interface AdminUserRow {
  id: string;
  email: string;
  full_name: string | null;
  role: Role;
  status: Status | null;
  must_change_password: boolean;
  group_id: string | null;
  created_at: string;
  last_login_at: string | null;
  last_seen_at: string | null;
  status_reason: string | null;
  /** Live (non-expired) refresh-token sessions — added by the list endpoint. */
  session_count?: number;
}

export interface GroupLite {
  id: string;
  name: string;
  color?: string | null;
  unique_group_id?: string | null;
}

export interface ListResponse {
  rows: AdminUserRow[];
  page: number;
  page_size: number;
  total: number;
  total_pages: number;
}

export interface UserKpi {
  active: number;
  online: number;
  pending: number;
  locked: number;
  inactive: number;
}

export interface UserSession {
  id: string;
  issued_at: string;
  expires_at: string;
  user_agent: string | null;
  ip_address: string | null;
}

export interface AuditEvent {
  id: string;
  action: string;
  ip_address: string | null;
  user_agent: string | null;
  metadata: Record<string, unknown> | null;
  created_at: string;
  email: string | null;
}

// Token-based status tones — no literal colors. Mirrors the Pill primitive's
// tone shape so any badge reads the same in light + dark.
export const STATUS_TONE: Record<Status, PillTone> = {
  active: { bg: 'bg-success-soft', text: 'text-success', dot: 'bg-success' },
  inactive: { bg: 'bg-bg-sunken', text: 'text-muted', dot: 'bg-[color:var(--muted)]' },
  suspended: { bg: 'bg-warn-soft', text: 'text-warn', dot: 'bg-warn' },
  pending_verification: { bg: 'bg-accent-soft', text: 'text-accent', dot: 'bg-accent' },
  banned: { bg: 'bg-danger-soft', text: 'text-danger', dot: 'bg-danger' },
};

export const STATUS_LABEL: Record<Status, string> = {
  active: 'Active',
  inactive: 'Inactive',
  suspended: 'Suspended',
  pending_verification: 'Pending',
  banned: 'Banned',
};

export const statusOf = (u: { status: Status | null }): Status => u.status ?? 'active';

/** Compact relative time, e.g. "3m ago" / "2d ago" / a date for older. */
export function relativeTime(iso: string | null): string {
  if (!iso) return 'Never';
  const ms = Date.now() - new Date(iso).getTime();
  if (ms < 60_000) return 'just now';
  const min = Math.round(ms / 60_000);
  if (min < 60) return `${min}m ago`;
  const hr = Math.round(min / 60);
  if (hr < 24) return `${hr}h ago`;
  const d = Math.round(hr / 24);
  if (d < 14) return `${d}d ago`;
  return new Date(iso).toLocaleDateString();
}

/** True when the user was seen within the last 5 minutes (matches the KPI). */
export const isOnline = (u: { last_seen_at: string | null }): boolean =>
  !!u.last_seen_at && Date.now() - new Date(u.last_seen_at).getTime() < 5 * 60_000;

/** Best-effort device label from a user-agent string. */
export function deviceLabel(ua: string | null): string {
  if (!ua) return 'Unknown device';
  const browser = /Edg/.test(ua)
    ? 'Edge'
    : /Chrome/.test(ua)
      ? 'Chrome'
      : /Firefox/.test(ua)
        ? 'Firefox'
        : /Safari/.test(ua)
          ? 'Safari'
          : 'Browser';
  const os = /Windows/.test(ua)
    ? 'Windows'
    : /Mac OS|Macintosh/.test(ua)
      ? 'macOS'
      : /Android/.test(ua)
        ? 'Android'
        : /iPhone|iPad|iOS/.test(ua)
          ? 'iOS'
          : /Linux/.test(ua)
            ? 'Linux'
            : 'Unknown OS';
  return `${browser} · ${os}`;
}
