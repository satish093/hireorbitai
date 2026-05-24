import { useEffect, useState } from 'react';
import { NavLink } from 'react-router-dom';
import clsx from 'clsx';
import { useAuth } from '../context/AuthContext';
import {
  Role,
  ROLE_LABEL,
  OPERATOR_TIER,
  MANAGER_TIER,
  ALL_ROLES,
  OWNER_TIER,
  ADMIN_TIER,
} from '../types';
import { api } from '../services/api';
import { useFeatureFlags } from '../hooks/useFeatureFlags';
import { Brand } from './Brand';
import {
  IconHome,
  IconTasks,
  IconCalendar,
  IconInbox,
  IconReminder,
  IconUsers,
  IconUser,
  IconBriefcase,
  IconFileText,
  IconVideo,
  IconFile,
  IconBuilding,
  IconBuilding2,
  IconBarChart,
  IconSparkles,
  IconMailPlus,
  IconUsersCog,
  IconToggle,
  IconUserX,
  IconLogOut,
  IconGraduation,
  IconBookOpen,
  IconClipboard,
} from './Icons';
import type { ComponentType, SVGProps } from 'react';

type IconCmp = ComponentType<SVGProps<SVGSVGElement> & { size?: number; strokeWidth?: number }>;

interface Item {
  to: string;
  label: string;
  roles: Role[];
  icon: IconCmp;
  badgeKey?: 'tasks' | 'reminders' | 'inbox';
  /** Hide this item if the corresponding feature flag is disabled. */
  flagKey?: string;
}

interface Section {
  heading: string;
  items: Item[];
}

const sections: Section[] = [
  {
    heading: 'Workspace',
    items: [
      { to: '/dashboard', label: 'Dashboard', icon: IconHome, roles: ALL_ROLES },
      {
        to: '/tasks',
        label: 'Tasks',
        icon: IconTasks,
        roles: ALL_ROLES,
        badgeKey: 'tasks',
        flagKey: 'tasks',
      },
      { to: '/calendar', label: 'Calendar', icon: IconCalendar, roles: ALL_ROLES },
      {
        to: '/messages',
        label: 'Inbox',
        icon: IconInbox,
        roles: ALL_ROLES,
        badgeKey: 'inbox',
        flagKey: 'messages',
      },
      {
        to: '/reminders',
        label: 'Reminders',
        icon: IconReminder,
        roles: ALL_ROLES,
        badgeKey: 'reminders',
        flagKey: 'reminders',
      },
    ],
  },
  {
    heading: 'Talent',
    items: [
      { to: '/consultants', label: 'Consultants', icon: IconUsers, roles: OPERATOR_TIER },
      { to: '/recruiters', label: 'Recruiters', icon: IconUser, roles: MANAGER_TIER },
      { to: '/jobs', label: 'Jobs', icon: IconBriefcase, roles: ALL_ROLES },
      { to: '/applications', label: 'Applications', icon: IconFileText, roles: OPERATOR_TIER },
      {
        to: '/interviews',
        label: 'Interviews',
        icon: IconVideo,
        roles: ALL_ROLES,
        flagKey: 'interviews',
      },
      { to: '/resumes', label: 'Resumes', icon: IconFile, roles: ALL_ROLES },
    ],
  },
  {
    heading: 'Network',
    items: [
      { to: '/vendors', label: 'Vendors', icon: IconBuilding, roles: OPERATOR_TIER },
      { to: '/clients', label: 'Clients', icon: IconBuilding2, roles: OPERATOR_TIER },
    ],
  },
  {
    heading: 'Training',
    items: [
      {
        to: '/training',
        label: 'Overview',
        icon: IconGraduation,
        roles: MANAGER_TIER,
        flagKey: 'training',
      },
      {
        to: '/training/courses',
        label: 'Courses',
        icon: IconBookOpen,
        roles: MANAGER_TIER,
        flagKey: 'training',
      },
      {
        to: '/training/assignments',
        label: 'Assignments',
        icon: IconClipboard,
        roles: MANAGER_TIER,
        flagKey: 'training',
      },
      {
        to: '/training/reports',
        label: 'Reports',
        icon: IconBarChart,
        roles: MANAGER_TIER,
        flagKey: 'training',
      },
      {
        to: '/training/my',
        label: 'My training',
        icon: IconGraduation,
        roles: ALL_ROLES,
        flagKey: 'training',
      },
    ],
  },
  {
    heading: 'Admin',
    items: [
      { to: '/admin/users', label: 'All users', icon: IconUsers, roles: ADMIN_TIER },
      {
        to: '/reports',
        label: 'Reports',
        icon: IconBarChart,
        roles: MANAGER_TIER,
        flagKey: 'reports',
      },
      {
        to: '/ai-usage',
        label: 'AI Usage',
        icon: IconSparkles,
        roles: MANAGER_TIER,
      },
      {
        to: '/ai-email',
        label: 'AI Email',
        icon: IconSparkles,
        roles: OPERATOR_TIER,
        flagKey: 'ai_email',
      },
      { to: '/invitations', label: 'Invitations', icon: IconMailPlus, roles: MANAGER_TIER },
      { to: '/admin/groups', label: 'User groups', icon: IconUsersCog, roles: MANAGER_TIER },
      {
        to: '/admin/deactivated',
        label: 'Deactivated accounts',
        icon: IconUserX,
        roles: ADMIN_TIER,
      },
      { to: '/admin/features', label: 'Feature flags', icon: IconToggle, roles: OWNER_TIER },
      { to: '/admin/ai-settings', label: 'AI settings', icon: IconSparkles, roles: ADMIN_TIER },
    ],
  },
];

function initials(name?: string | null, email?: string | null): string {
  const src = (name && name.trim()) || (email && email.split('@')[0]) || '';
  const parts = src.split(/\s+|\.|_|-/).filter(Boolean);
  if (parts.length === 0) return '?';
  if (parts.length === 1) return parts[0]!.slice(0, 2).toUpperCase();
  return (parts[0]![0]! + parts[1]![0]!).toUpperCase();
}

interface SidebarProps {
  /** Whether the mobile slide-over is currently open. Layout owns this state. */
  mobileOpen?: boolean;
  /** Called when the user dismisses the overlay (tap-outside / Escape). */
  onMobileClose?: () => void;
}

export function Sidebar({ mobileOpen = false, onMobileClose }: SidebarProps = {}) {
  const { profile, signOut } = useAuth();
  const { flags } = useFeatureFlags();
  const role = profile?.role;
  const [counts, setCounts] = useState<{ tasks?: number; reminders?: number; inbox?: number }>({});

  useEffect(() => {
    if (!profile) return;
    let cancelled = false;
    let inflight = false; // skip if the previous tick is still running
    let timer: ReturnType<typeof setTimeout> | null = null;

    // Adaptive cadence: starts at 60s, doubles up to 5min on consecutive
    // failures, resets to 60s on the first success. This stops a single 429
    // burst from pinning the bucket for the full 15-minute window.
    const BASE_MS = 60_000;
    const MAX_MS = 5 * 60_000;
    let currentMs = BASE_MS;

    const tick = async () => {
      if (cancelled) return;
      // Pause polling when the tab isn't visible — most "background" updates
      // can wait until the user comes back. We also reschedule rather than
      // letting setInterval bunch up missed ticks behind a backgrounded tab.
      if (typeof document !== 'undefined' && document.hidden) {
        schedule();
        return;
      }
      if (inflight) {
        schedule();
        return;
      }
      inflight = true;
      try {
        const [t, r, u] = await Promise.all([
          api.get('/tasks/assigned-to-me').catch(() => null),
          api.get('/reminders', { params: { status: 'PENDING' } }).catch(() => null),
          api.get('/messages/unread-count').catch(() => null),
        ]);
        if (cancelled) return;
        // If ANY request failed, back off; if ALL succeeded, reset.
        if (t == null || r == null || u == null) {
          currentMs = Math.min(MAX_MS, currentMs * 2);
        } else {
          currentMs = BASE_MS;
        }
        setCounts({
          tasks: (t?.data ?? []).length,
          reminders: (r?.data ?? []).length,
          inbox: u?.data?.unread ?? 0,
        });
      } finally {
        inflight = false;
        schedule();
      }
    };

    function schedule() {
      if (cancelled) return;
      // 10% jitter — when many tabs come out of background at once they
      // don't all fire on the same millisecond.
      const jitter = currentMs * 0.1 * Math.random();
      timer = setTimeout(tick, currentMs + jitter);
    }

    // Fire once immediately; subsequent ticks self-schedule.
    void tick();

    // When the tab becomes visible again, do an opportunistic refresh —
    // but only if we don't already have a tick in flight or scheduled
    // imminently.
    const onVisibility = () => {
      if (cancelled || document.hidden || inflight) return;
      if (timer) {
        clearTimeout(timer);
        timer = null;
      }
      void tick();
    };
    document.addEventListener('visibilitychange', onVisibility);

    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
      document.removeEventListener('visibilitychange', onVisibility);
    };
    // We intentionally depend on `profile?.id` only — re-running on every
    // profile-object reference change (which useAuth re-creates on minor
    // session-state shifts) would tear down and re-arm the poller cycle
    // every few seconds. id is the only thing that actually matters for
    // "is this a different user".
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [profile?.id]);

  // Close on Escape when the mobile drawer is open.
  useEffect(() => {
    if (!mobileOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onMobileClose?.();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [mobileOpen, onMobileClose]);

  return (
    <>
      {/* Mobile backdrop — only rendered when the drawer is open. Tapping it
          dismisses the menu. Hidden on md+ where the sidebar is inline. */}
      {mobileOpen && (
        <div
          className="md:hidden fixed inset-0 z-40 bg-slate-900/40 backdrop-blur-sm animate-fade-in"
          onClick={onMobileClose}
          aria-hidden="true"
        />
      )}
      <aside
        className={clsx(
          'w-60 shrink-0 bg-surface border-r border-border flex flex-col',
          // Desktop: static column inside the flex shell.
          'md:static md:min-h-dvh md:translate-x-0',
          // Mobile: fixed slide-over with a translate transition. Uses dvh so
          // the drawer height tracks the iOS Safari URL bar correctly.
          'fixed inset-y-0 left-0 z-50 h-dvh transition-transform duration-200 ease-out safe-pt safe-pb',
          mobileOpen ? 'translate-x-0 shadow-2xl' : '-translate-x-full',
        )}
        aria-label="Primary navigation"
      >
        {/* Brand */}
        <div className="px-4 py-4 border-b border-border flex items-center justify-between">
          <Brand size="md" />
          {/* Close button on mobile only — desktop uses the inline sidebar. */}
          <button
            type="button"
            onClick={onMobileClose}
            aria-label="Close navigation"
            className="md:hidden -mr-1 w-8 h-8 inline-flex items-center justify-center rounded-md text-muted hover:text-ink hover:bg-hover"
          >
            ✕
          </button>
        </div>

        {/* Nav */}
        <nav className="flex-1 overflow-y-auto p-3 space-y-5">
          {sections.map((section) => {
            const visible = section.items.filter((i) => {
              if (role && !i.roles.includes(role)) return false;
              if (i.flagKey && flags[i.flagKey] === false) return false;
              return true;
            });
            if (visible.length === 0) return null;
            return (
              <div key={section.heading}>
                <div className="px-2 mb-1.5 text-[10px] font-semibold tracking-widest text-muted uppercase">
                  {section.heading}
                </div>
                <div className="space-y-0.5">
                  {visible.map((i) => {
                    const badge = i.badgeKey ? counts[i.badgeKey] : undefined;
                    const Icon = i.icon;
                    return (
                      <NavLink
                        key={i.to}
                        to={i.to}
                        data-tour={`nav-${i.to}`}
                        className={({ isActive }) =>
                          clsx(
                            'group relative flex items-center gap-2.5 px-2.5 py-1.5 rounded-md text-sm transition-all duration-200 ease-out',
                            isActive
                              ? 'bg-brand-50 text-brand-700 font-medium'
                              : 'text-ink hover:bg-hover hover:text-ink hover:translate-x-0.5',
                          )
                        }
                      >
                        {({ isActive }) => (
                          <>
                            {/* Animated active indicator: a vertical bar that
                              scales from 0 to full height when the link
                              becomes active. */}
                            <span
                              aria-hidden="true"
                              className={clsx(
                                'absolute left-0 top-1.5 bottom-1.5 w-0.5 rounded-r-full bg-brand-600 origin-center transition-transform duration-200 ease-out',
                                isActive ? 'scale-y-100' : 'scale-y-0',
                              )}
                            />
                            <Icon
                              size={17}
                              className={clsx(
                                'shrink-0 transition-colors',
                                isActive ? 'text-brand-600' : 'text-muted group-hover:text-ink',
                              )}
                            />
                            <span className="flex-1 truncate">{i.label}</span>
                            {typeof badge === 'number' && badge > 0 && (
                              <span
                                key={badge}
                                className={clsx(
                                  'text-[10px] font-semibold px-1.5 py-0.5 rounded-full tabular-nums animate-pop',
                                  isActive ? 'bg-brand-600 text-white' : 'bg-hover text-ink',
                                )}
                              >
                                {badge}
                              </span>
                            )}
                          </>
                        )}
                      </NavLink>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </nav>

        {/* User card pinned to bottom */}
        <div className="border-t border-border p-3">
          <div className="flex items-center gap-2.5 px-1.5 py-1.5 rounded-md hover:bg-hover">
            <NavLink
              to={profile?.id ? `/users/${profile.id}` : '#'}
              data-tour="nav-profile"
              className="flex items-center gap-2.5 flex-1 min-w-0 hover:bg-hover rounded-md -mx-1 px-1 py-0.5"
              title="View your profile"
            >
              <div className="relative">
                <div className="w-8 h-8 rounded-full bg-emerald-100 dark:bg-emerald-500/20 text-emerald-700 dark:text-emerald-300 flex items-center justify-center text-xs font-semibold">
                  {initials(profile?.full_name, profile?.email)}
                </div>
                <span className="absolute -bottom-0.5 -right-0.5 w-2.5 h-2.5 bg-emerald-500 border-2 border-surface rounded-full">
                  <span className="absolute inset-0 rounded-full bg-emerald-500 animate-ping opacity-60" />
                </span>
              </div>
              <div className="flex-1 min-w-0 leading-tight">
                <div className="text-[13px] font-medium text-ink truncate">
                  {profile?.full_name ?? profile?.email}
                </div>
                <div className="text-[10px] uppercase tracking-wider text-muted">
                  {role && ROLE_LABEL[role]}
                </div>
              </div>
            </NavLink>
            <button
              onClick={signOut}
              title="Sign out"
              className="text-muted hover:text-ink p-1.5 rounded-md hover:bg-hover transition-colors"
            >
              <IconLogOut size={16} />
            </button>
          </div>
        </div>
      </aside>
    </>
  );
}
