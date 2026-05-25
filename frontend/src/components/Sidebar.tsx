import { useEffect, useState } from 'react';
import { NavLink, useLocation } from 'react-router-dom';
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
  flagKey?: string;
}

interface Section {
  heading: string;
  items: Item[];
  /** Show a collapse toggle on the heading. */
  collapsible?: boolean;
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
      { to: '/resumes', label: 'Resumes', icon: IconFile, roles: OPERATOR_TIER },
      { to: '/vendors', label: 'Vendors', icon: IconBuilding, roles: OPERATOR_TIER },
      { to: '/clients', label: 'Clients', icon: IconBuilding2, roles: OPERATOR_TIER },
      {
        to: '/reports',
        label: 'Analytics',
        icon: IconBarChart,
        roles: MANAGER_TIER,
        flagKey: 'reports',
      },
    ],
  },
  {
    heading: 'Training',
    items: [
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
        to: '/training/my',
        label: 'My Training',
        icon: IconGraduation,
        roles: ALL_ROLES,
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
        to: '/training/ai-activity',
        label: 'AI Activity',
        icon: IconSparkles,
        roles: MANAGER_TIER,
        flagKey: 'training',
      },
    ],
  },
  {
    heading: 'Admin',
    collapsible: true,
    items: [
      { to: '/admin/users', label: 'Users', icon: IconUsers, roles: ADMIN_TIER },
      { to: '/invitations', label: 'Invitations', icon: IconMailPlus, roles: MANAGER_TIER },
      { to: '/admin/groups', label: 'User Groups', icon: IconUsersCog, roles: MANAGER_TIER },
      { to: '/ai-usage', label: 'AI Usage', icon: IconSparkles, roles: MANAGER_TIER },
      {
        to: '/ai-email',
        label: 'AI Email',
        icon: IconMailPlus,
        roles: OPERATOR_TIER,
        flagKey: 'ai_email',
      },
      { to: '/admin/deactivated', label: 'Deactivated', icon: IconUserX, roles: ADMIN_TIER },
      { to: '/admin/features', label: 'Feature Flags', icon: IconToggle, roles: OWNER_TIER },
      { to: '/admin/ai-settings', label: 'AI Settings', icon: IconSparkles, roles: ADMIN_TIER },
      { to: '/admin/audit-log', label: 'Audit Log', icon: IconClipboard, roles: ADMIN_TIER },
    ],
  },
];

// ── Helpers ────────────────────────────────────────────────────────────────

function initials(name?: string | null, email?: string | null): string {
  const src = (name && name.trim()) || (email && email.split('@')[0]) || '';
  const parts = src.split(/\s+|\.|_|-/).filter(Boolean);
  if (parts.length === 0) return '?';
  if (parts.length === 1) return parts[0]!.slice(0, 2).toUpperCase();
  return (parts[0]![0]! + parts[1]![0]!).toUpperCase();
}

function ChevronIcon({ open }: { open: boolean }) {
  return (
    <svg
      width={12}
      height={12}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2.5}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      className={clsx(
        'shrink-0 transition-transform duration-200',
        open ? 'rotate-0' : '-rotate-90',
      )}
    >
      <path d="M6 9l6 6 6-6" />
    </svg>
  );
}

/**
 * When a role sees at most this many nav items total, skip the section
 * headings and render one flat list — grouping a short list just adds noise.
 * Longer lists (recruiters, managers, admins) keep the grouped headings.
 */
const FLAT_THRESHOLD = 8;

/** A single nav row. Module-level so it isn't recreated each render. */
function NavItem({ item, badge }: { item: Item; badge?: number }) {
  const Icon = item.icon;
  return (
    <NavLink
      to={item.to}
      data-tour={`nav-${item.to}`}
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
          <span className="flex-1 truncate">{item.label}</span>
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
}

const COLLAPSE_KEY = 'hireorbit-nav-collapsed';

function loadCollapsed(): Set<string> {
  try {
    const s = localStorage.getItem(COLLAPSE_KEY);
    return s ? new Set(JSON.parse(s) as string[]) : new Set<string>();
  } catch {
    return new Set<string>();
  }
}

function saveCollapsed(set: Set<string>) {
  try {
    localStorage.setItem(COLLAPSE_KEY, JSON.stringify([...set]));
  } catch {
    /* storage unavailable */
  }
}

// ── Component ─────────────────────────────────────────────────────────────

interface SidebarProps {
  mobileOpen?: boolean;
  onMobileClose?: () => void;
}

export function Sidebar({ mobileOpen = false, onMobileClose }: SidebarProps = {}) {
  const { profile, signOut } = useAuth();
  const { flags } = useFeatureFlags();
  const location = useLocation();
  const role = profile?.role;
  const [counts, setCounts] = useState<{ tasks?: number; reminders?: number; inbox?: number }>({});
  const [collapsed, setCollapsed] = useState<Set<string>>(loadCollapsed);

  const toggleSection = (heading: string) => {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(heading)) {
        next.delete(heading);
      } else {
        next.add(heading);
      }
      saveCollapsed(next);
      return next;
    });
  };

  // ── Badge polling ────────────────────────────────────────────────────────
  useEffect(() => {
    if (!profile) return;
    let cancelled = false;
    let inflight = false;
    let timer: ReturnType<typeof setTimeout> | null = null;

    const BASE_MS = 60_000;
    const MAX_MS = 5 * 60_000;
    let currentMs = BASE_MS;

    const tick = async () => {
      if (cancelled) return;
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
      const jitter = currentMs * 0.1 * Math.random();
      timer = setTimeout(tick, currentMs + jitter);
    }

    void tick();

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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [profile?.id]);

  // ── Close on Escape (mobile) ─────────────────────────────────────────────
  useEffect(() => {
    if (!mobileOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onMobileClose?.();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [mobileOpen, onMobileClose]);

  // ── Render ───────────────────────────────────────────────────────────────
  return (
    <>
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
          'md:static md:min-h-dvh md:translate-x-0',
          'fixed inset-y-0 left-0 z-50 h-dvh transition-transform duration-200 ease-out safe-pt safe-pb',
          mobileOpen ? 'translate-x-0 shadow-2xl' : '-translate-x-full',
        )}
        aria-label="Primary navigation"
      >
        {/* Brand */}
        <div className="px-4 py-4 border-b border-border flex items-center justify-between">
          <Brand size="md" />
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
        <nav className="flex-1 overflow-y-auto p-3 space-y-4">
          {(() => {
            // Resolve which sections/items this role can see.
            const visibleSections = sections
              .map((section) => ({
                ...section,
                items: section.items.filter((i) => {
                  if (role && !i.roles.includes(role)) return false;
                  if (i.flagKey && flags[i.flagKey] === false) return false;
                  return true;
                }),
              }))
              .filter((section) => section.items.length > 0);

            const totalItems = visibleSections.reduce((n, s) => n + s.items.length, 0);

            // Short nav (e.g. consultants) → one flat list, no headings.
            if (totalItems <= FLAT_THRESHOLD) {
              return (
                <div className="space-y-0.5">
                  {visibleSections.flatMap((section) =>
                    section.items.map((i) => (
                      <NavItem
                        key={i.to}
                        item={i}
                        badge={i.badgeKey ? counts[i.badgeKey] : undefined}
                      />
                    )),
                  )}
                </div>
              );
            }

            // Long nav → grouped headings with smooth collapse.
            return visibleSections.map((section) => {
              const hasActive = section.items.some((i) => location.pathname.startsWith(i.to));
              const isOpen = !section.collapsible || hasActive || !collapsed.has(section.heading);

              return (
                <div key={section.heading}>
                  {section.collapsible ? (
                    <button
                      type="button"
                      onClick={() => toggleSection(section.heading)}
                      className="w-full flex items-center justify-between px-2 mb-1.5 group"
                      aria-expanded={isOpen}
                    >
                      <span className="text-[10px] font-semibold tracking-widest text-muted uppercase group-hover:text-ink transition-colors">
                        {section.heading}
                      </span>
                      <ChevronIcon open={isOpen} />
                    </button>
                  ) : (
                    <div className="px-2 mb-1.5 text-[10px] font-semibold tracking-widest text-muted uppercase">
                      {section.heading}
                    </div>
                  )}

                  {/* grid-rows 0fr→1fr animates the collapse height smoothly. */}
                  <div
                    className={clsx(
                      'grid transition-[grid-template-rows] duration-200 ease-out',
                      isOpen ? 'grid-rows-[1fr]' : 'grid-rows-[0fr]',
                    )}
                  >
                    <div className="overflow-hidden min-h-0">
                      <div className="space-y-0.5">
                        {section.items.map((i) => (
                          <NavItem
                            key={i.to}
                            item={i}
                            badge={i.badgeKey ? counts[i.badgeKey] : undefined}
                          />
                        ))}
                      </div>
                    </div>
                  </div>
                </div>
              );
            });
          })()}
        </nav>

        {/* User card */}
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
