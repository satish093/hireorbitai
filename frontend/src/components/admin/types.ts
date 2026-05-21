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
  // Segment counts (also served by /admin/users/kpi so the ribbon is global,
  // not page-scoped).
  total: number;
  recruiters: number;
  consultants: number;
  managers: number;
  forced_reset: number;
  no_login_30d: number;
}

export type SegmentKey =
  | 'all'
  | 'recruiters'
  | 'consultants'
  | 'managers'
  | 'pending'
  | 'locked'
  | 'forced_reset'
  | 'no_login_30d';

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

// Optional (toggleable) table columns. checkbox · User · Status · actions are
// always shown; these can be hidden via the Columns picker.
export type ColumnKey = 'role' | 'group' | 'last_seen' | 'sessions' | 'joined';

export const OPTIONAL_COLUMNS: { key: ColumnKey; label: string }[] = [
  { key: 'role', label: 'Role' },
  { key: 'group', label: 'Group' },
  { key: 'last_seen', label: 'Last seen' },
  { key: 'sessions', label: 'Sessions' },
  { key: 'joined', label: 'Joined' },
];

export const DEFAULT_COLUMNS: Record<ColumnKey, boolean> = {
  role: true,
  group: true,
  last_seen: true,
  sessions: true,
  joined: false,
};

export type LastSeenFilter = '' | '24h' | '7d' | '30d';

export const LAST_SEEN_OPTIONS: { value: LastSeenFilter; label: string }[] = [
  { value: '', label: 'Any time' },
  { value: '24h', label: 'Last 24 hours' },
  { value: '7d', label: 'Last 7 days' },
  { value: '30d', label: 'Last 30 days' },
];

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
