import { useEffect, useState } from 'react';
import { NavLink, useLocation, useNavigate } from 'react-router-dom';
import clsx from 'clsx';
import { useAuth } from '../context/AuthContext';
import {
  Role,
  ROLE_LABEL,
  OPERATOR_TIER,
  MANAGER_TIER,
  ALL_ROLES,
  BUSINESS_ROLES,
  MESSAGING_ROLES,
  ADMIN_TIER,
  OWNER_TIER,
  hasCapability,
  type DeveloperCapability,
  type UserProfile,
} from '../types';
import { useBadgeCounts } from '../hooks/useBadgeCounts';
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
  IconPhone,
  IconShield,
} from './Icons';
import type { ComponentType, SVGProps } from 'react';

type IconCmp = ComponentType<SVGProps<SVGSVGElement> & { size?: number; strokeWidth?: number }>;

export interface Item {
  to: string;
  label: string;
  roles: Role[];
  icon: IconCmp;
  badgeKey?: 'tasks' | 'reminders' | 'inbox';
  flagKey?: string;
  capability?: DeveloperCapability;
}

export interface Section {
  heading: string;
  items: Item[];
  collapsible?: boolean;
}

export const NAV_SECTIONS: Section[] = [
  {
    heading: 'Workspace',
    items: [
      { to: '/dashboard', label: 'Dashboard', icon: IconHome, roles: ALL_ROLES },
      {
        to: '/tasks',
        label: 'Tasks',
        icon: IconTasks,
        roles: BUSINESS_ROLES,
        badgeKey: 'tasks',
        flagKey: 'tasks',
      },
      { to: '/calendar', label: 'Calendar', icon: IconCalendar, roles: BUSINESS_ROLES },
      {
        to: '/messages',
        label: 'Inbox',
        icon: IconInbox,
        roles: MESSAGING_ROLES,
        badgeKey: 'inbox',
        flagKey: 'messages',
      },
      {
        to: '/reminders',
        label: 'Reminders',
        icon: IconReminder,
        roles: BUSINESS_ROLES,
        badgeKey: 'reminders',
        flagKey: 'reminders',
      },
      { to: '/my-resume', label: 'My Resume', icon: IconFile, roles: ['CONSULTANT'] },
    ],
  },
  {
    heading: 'Talent',
    items: [
      { to: '/consultants', label: 'Consultants', icon: IconUsers, roles: OPERATOR_TIER },
      { to: '/recruiters', label: 'Recruiters', icon: IconUser, roles: MANAGER_TIER },
      { to: '/managers', label: 'Managers', icon: IconUsersCog, roles: MANAGER_TIER },
      { to: '/jobs', label: 'Jobs', icon: IconBriefcase, roles: OPERATOR_TIER },
      { to: '/applications', label: 'Applications', icon: IconFileText, roles: OPERATOR_TIER },
      {
        to: '/interviews',
        label: 'Interviews',
        icon: IconVideo,
        roles: BUSINESS_ROLES,
        flagKey: 'interviews',
      },
      { to: '/resumes', label: 'Resumes', icon: IconFile, roles: OPERATOR_TIER },
      { to: '/vendors', label: 'Vendors', icon: IconBuilding, roles: OPERATOR_TIER },
      { to: '/clients', label: 'Clients', icon: IconBuilding2, roles: OPERATOR_TIER },
      {
        to: '/reports',
        label: 'Analytics',
        icon: IconBarChart,
        roles: OPERATOR_TIER,
        flagKey: 'reports',
        capability: 'reports',
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
        roles: BUSINESS_ROLES,
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
      {
        to: '/admin/users',
        label: 'Users',
        icon: IconUsers,
        roles: ADMIN_TIER,
        capability: 'users',
      },
      {
        to: '/invitations',
        label: 'Invitations',
        icon: IconMailPlus,
        roles: OPERATOR_TIER,
        capability: 'invitations',
      },
      {
        to: '/admin/groups',
        label: 'User Groups',
        icon: IconUsersCog,
        roles: ADMIN_TIER,
        capability: 'user_groups',
      },
      {
        to: '/ai-usage',
        label: 'AI Usage',
        icon: IconSparkles,
        roles: MANAGER_TIER,
        capability: 'ai_usage',
      },
      {
        to: '/ai-email',
        label: 'AI Email',
        icon: IconMailPlus,
        roles: OPERATOR_TIER,
        flagKey: 'ai_email',
      },
      { to: '/admin/deactivated', label: 'Deactivated', icon: IconUserX, roles: ADMIN_TIER },
      {
        to: '/admin/features',
        label: 'Feature Flags',
        icon: IconToggle,
        roles: ADMIN_TIER,
        capability: 'feature_flags',
      },
      { to: '/admin/ai-settings', label: 'AI Settings', icon: IconSparkles, roles: OWNER_TIER },
      { to: '/admin/audit-log', label: 'Audit Log', icon: IconClipboard, roles: ADMIN_TIER },
      {
        to: '/admin/calls-usage',
        label: 'Call Usage',
        icon: IconPhone,
        roles: OWNER_TIER,
        capability: 'calls_usage',
      },
    ],
  },
];

/**
 * Gate the nav model for a given user: drop items the role/capability/flag
 * rules hide, then drop now-empty sections. Shared by the Sidebar and the
 * global Command Palette so both surfaces show exactly the same destinations.
 */
export function filterNavSections(
  role: Role | undefined,
  profile: Pick<UserProfile, 'role' | 'capabilities'> | null | undefined,
  flags: Record<string, boolean | undefined>,
): Section[] {
  return NAV_SECTIONS.map((section) => ({
    ...section,
    items: section.items.filter((i) => {
      const roleOk =
        !role ||
        i.roles.includes(role) ||
        (i.capability ? hasCapability(profile, i.capability) : false);
      if (!roleOk) return false;
      if (i.flagKey && flags[i.flagKey] === false) return false;
      return true;
    }),
  })).filter((s) => s.items.length > 0);
}

// ── Avatar helpers ─────────────────────────────────────────────────────────

const AVATAR_COLORS = ['#2563eb', '#7c3aed', '#0369a1', '#2e7a42', '#b45309', '#be123c', '#4338ca'];

function avatarColor(seed: string): string {
  let h = 0;
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) >>> 0;
  return AVATAR_COLORS[h % AVATAR_COLORS.length]!;
}

function initials(name?: string | null, email?: string | null): string {
  const src = (name && name.trim()) || (email && email.split('@')[0]) || '';
  const parts = src.split(/\s+|\.|_|-/).filter(Boolean);
  if (parts.length === 0) return '?';
  if (parts.length === 1) return parts[0]!.slice(0, 2).toUpperCase();
  return (parts[0]![0]! + parts[1]![0]!).toUpperCase();
}

// ── Section collapse helpers ───────────────────────────────────────────────

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

const FLAT_THRESHOLD = 8;
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

// ── NavItem ────────────────────────────────────────────────────────────────

function NavItem({ item, badge }: { item: Item; badge?: number }) {
  const Icon = item.icon;
  return (
    <NavLink
      to={item.to}
      data-tour={`nav-${item.to}`}
      className={({ isActive }) =>
        clsx(
          // Base layout — position:relative for the left-bar pseudo-element
          'group relative flex items-center gap-2.5 px-2.5 py-[7.5px] rounded-lg',
          'text-[13.5px] transition-all duration-150 ease-out',
          isActive
            ? // Active: brand-soft fill + brand-on-soft text (design spec)
              'bg-brand-soft text-brand-on-soft font-semibold'
            : 'text-ink-2 font-medium hover:bg-hover hover:text-ink',
        )
      }
    >
      {({ isActive }) => (
        <>
          {/* 3px left accent bar — only visible when active */}
          <span
            aria-hidden="true"
            className={clsx(
              'absolute left-0 top-[7px] bottom-[7px] w-[3px] rounded-r-full',
              'origin-center transition-transform duration-200 ease-out',
              isActive ? 'scale-y-100 bg-brand-on-soft' : 'scale-y-0 bg-transparent',
            )}
          />
          <Icon
            size={17}
            className={clsx(
              'shrink-0 transition-colors',
              isActive ? 'text-brand-on-soft' : 'text-muted group-hover:text-ink',
            )}
          />
          <span className="flex-1 truncate leading-tight">{item.label}</span>
          {typeof badge === 'number' && badge > 0 && (
            <span
              key={badge}
              className={clsx(
                'ml-auto text-[10.5px] font-bold min-w-[18px] h-[18px] px-[5px]',
                'rounded-full grid place-items-center tabular-nums animate-pop',
                isActive
                  ? // Active badge: brand-on-soft bg + white text
                    'bg-brand-on-soft text-white'
                  : // Inactive badge: subtle
                    'bg-hover text-ink-2',
              )}
            >
              {badge > 99 ? '99+' : badge}
            </span>
          )}
        </>
      )}
    </NavLink>
  );
}

// ── Super Admin ribbon ─────────────────────────────────────────────────────

function SuperAdminRibbon() {
  return (
    <div
      className="mx-3 mb-1.5 px-2.5 py-2 rounded-[9px] flex items-center gap-2"
      style={{
        background: 'linear-gradient(120deg, #1e293b, #0f172a)',
        border: '1px solid rgba(255,255,255,0.08)',
      }}
    >
      <IconShield
        size={13}
        strokeWidth={2}
        className="shrink-0"
        style={{ color: 'rgba(255,255,255,0.7)' }}
      />
      <span
        className="flex-1 text-[11px] font-bold tracking-[0.04em] uppercase"
        style={{ color: 'rgba(255,255,255,0.85)' }}
      >
        Full access
      </span>
      {/* Online/active status dot */}
      <span
        className="w-1.5 h-1.5 rounded-full shrink-0"
        style={{
          background: '#34d399',
          boxShadow: '0 0 0 3px rgba(52,211,153,0.2)',
        }}
      />
    </div>
  );
}

// ── Component ──────────────────────────────────────────────────────────────

interface SidebarProps {
  mobileOpen?: boolean;
  onMobileClose?: () => void;
}

export function Sidebar({ mobileOpen = false, onMobileClose }: SidebarProps = {}) {
  const { profile, signOut } = useAuth();
  const { flags } = useFeatureFlags();
  const location = useLocation();
  const navigate = useNavigate();
  const role = profile?.role;
  const counts = useBadgeCounts();
  const [collapsed, setCollapsed] = useState<Set<string>>(loadCollapsed);

  const isSuperAdmin = role === 'SUPER_ADMIN';

  const toggleSection = (heading: string) => {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(heading)) next.delete(heading);
      else next.add(heading);
      saveCollapsed(next);
      return next;
    });
  };

  // Close on Escape (mobile drawer)
  useEffect(() => {
    if (!mobileOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onMobileClose?.();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [mobileOpen, onMobileClose]);

  // Avatar
  const seed = profile?.email ?? profile?.full_name ?? '';
  const bgColor = avatarColor(seed);
  const displayInitials = initials(profile?.full_name, profile?.email);

  return (
    <>
      {/* Mobile backdrop */}
      {mobileOpen && (
        <div
          className="md:hidden fixed inset-0 z-40 bg-slate-900/40 backdrop-blur-sm animate-fade-in"
          onClick={onMobileClose}
          aria-hidden="true"
        />
      )}

      <aside
        className={clsx(
          // Desktop: static column, full viewport height
          'md:static md:min-h-dvh md:translate-x-0',
          // Mobile: off-canvas drawer
          'fixed inset-y-0 left-0 z-50 h-dvh transition-transform duration-200 ease-out safe-pt safe-pb',
          mobileOpen ? 'translate-x-0 shadow-2xl' : '-translate-x-full',
          // Shared
          'w-[248px] shrink-0 flex flex-col',
          isSuperAdmin ? 'border-r border-border-strong' : 'border-r border-border',
        )}
        style={{ background: 'var(--surface)' }}
        aria-label="Primary navigation"
      >
        {/* ── Brand header (60px) ── */}
        <div className="h-[60px] px-[18px] flex items-center justify-between shrink-0 border-b border-border">
          <Brand size="md" />
          <button
            type="button"
            onClick={onMobileClose}
            aria-label="Close navigation"
            className="md:hidden -mr-1 w-8 h-8 inline-flex items-center justify-center rounded-lg text-muted hover:text-ink hover:bg-hover"
          >
            ✕
          </button>
        </div>

        {/* ── Super Admin ribbon ── */}
        {isSuperAdmin && (
          <div className="pt-3">
            <SuperAdminRibbon />
          </div>
        )}

        {/* ── Nav ── */}
        <nav className="flex-1 overflow-y-auto px-3 py-[14px] space-y-4" aria-label="Sidebar">
          {(() => {
            // Don't render the nav until the role is known. With role===undefined
            // (profile still loading), filterNavSections keeps EVERY item (the
            // `!role` short-circuit), which (a) briefly flashes admin-only items
            // to every user and (b) re-renders the whole list down to the real
            // set once the role resolves — a churn that momentarily unmounts
            // items (jarring for users, and flaky for the sidebar-parity e2e).
            if (!role) return null;
            const visibleSections = filterNavSections(role, profile, flags);

            const totalItems = visibleSections.reduce((n, s) => n + s.items.length, 0);

            // Short nav (e.g. consultant) → flat list, no headings
            if (totalItems <= FLAT_THRESHOLD) {
              return (
                <div className="space-y-0.5">
                  {visibleSections.flatMap((s) =>
                    s.items.map((i) => (
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

            // Long nav → grouped headings with smooth collapse
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
                      <span
                        className="text-[10px] font-semibold tracking-[0.12em] uppercase group-hover:text-ink transition-colors"
                        style={{ color: 'var(--muted)' }}
                      >
                        {section.heading}
                      </span>
                      <ChevronIcon open={isOpen} />
                    </button>
                  ) : (
                    <div
                      className="px-2 mb-1.5 text-[10px] font-semibold tracking-[0.12em] uppercase"
                      style={{ color: 'var(--muted)' }}
                    >
                      {section.heading}
                    </div>
                  )}

                  {/* grid-rows 0fr→1fr animates collapse height */}
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

        {/* ── Pinned user card ── */}
        {/* The row is a plain container, NOT role="button": it holds two real
            buttons (view-profile + sign-out). A button-wrapping-buttons is a
            WCAG nested-interactive violation, so the profile area is its own
            <button> sibling to the sign-out <button>. */}
        <div className="shrink-0 border-t border-border px-3 py-[10px]">
          <div className="flex items-center gap-2.5 px-2 py-2 rounded-[9px] hover:bg-hover transition-colors">
            <button
              type="button"
              onClick={() => navigate(profile?.id ? `/users/${profile.id}` : '#')}
              data-tour="nav-profile"
              title="View your profile"
              className="flex items-center gap-2.5 flex-1 min-w-0 text-left rounded-[9px] focus:outline-none focus-visible:ring-2 focus-visible:ring-accent"
            >
              {/* Avatar with dynamic color */}
              <div className="relative shrink-0">
                <div
                  className="w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold"
                  style={{
                    // Solid fill + white text — the tinted style failed WCAG AA
                    // contrast in dark mode (~3:1).
                    background: bgColor,
                    color: '#fff',
                  }}
                >
                  {displayInitials}
                </div>
                {/* Online status dot */}
                <span
                  className="absolute -bottom-0.5 -right-0.5 w-2.5 h-2.5 rounded-full border-2"
                  style={{
                    background: 'var(--success)',
                    borderColor: 'var(--surface)',
                  }}
                >
                  <span
                    className="absolute inset-0 rounded-full animate-ping opacity-60"
                    style={{ background: 'var(--success)' }}
                  />
                </span>
              </div>

              <div className="flex-1 min-w-0 leading-tight">
                <div className="text-[13px] font-medium truncate" style={{ color: 'var(--ink)' }}>
                  {profile?.full_name ?? profile?.email}
                </div>
                <div
                  className="text-[10px] uppercase tracking-[0.06em]"
                  style={{ color: 'var(--muted)' }}
                >
                  {role && ROLE_LABEL[role]}
                </div>
              </div>
            </button>

            <button
              onClick={() => void signOut()}
              title="Sign out"
              aria-label="Sign out"
              className="shrink-0 p-1.5 rounded-md transition-colors hover:bg-hover"
              style={{ color: 'var(--muted)' }}
            >
              <IconLogOut size={15} />
            </button>
          </div>
        </div>
      </aside>
    </>
  );
}
