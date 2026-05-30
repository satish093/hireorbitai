import { useEffect } from 'react';
import { NavLink, useLocation } from 'react-router-dom';
import clsx from 'clsx';
import { useAuth } from '../context/AuthContext';
import { useTheme } from '../hooks/useTheme';
import { ROLE_LABEL, MANAGER_TIER, ADMIN_TIER } from '../types';
import { Avatar } from './TaskBits';
import {
  IconCalendar,
  IconTasks,
  IconReminder,
  IconBriefcase,
  IconFileText,
  IconFile,
  IconBarChart,
  IconMailPlus,
  IconGraduation,
  IconBookOpen,
  IconClipboard,
  IconUsers,
  IconUser,
  IconUsersCog,
  IconToggle,
  IconSparkles,
  IconLogOut,
  IconX,
} from './Icons';
import type { ComponentType, SVGProps } from 'react';

type IconCmp = ComponentType<SVGProps<SVGSVGElement> & { size?: number; strokeWidth?: number }>;

interface NavItem {
  to: string;
  label: string;
  Icon: IconCmp;
}

interface NavGroup {
  heading: string;
  items: NavItem[];
}

function moreGroups(role: string | undefined): NavGroup[] {
  if (!role) return [];

  if (role === 'CONSULTANT') {
    return [
      {
        heading: 'Workspace',
        items: [
          { to: '/calendar', label: 'Calendar', Icon: IconCalendar },
          { to: '/reminders', label: 'Reminders', Icon: IconReminder },
        ],
      },
      {
        heading: 'Me',
        items: [
          { to: '/my-resume', label: 'My Resume', Icon: IconFile },
          { to: '/training', label: 'My Training', Icon: IconGraduation },
        ],
      },
    ];
  }

  if (role === 'RECRUITER') {
    return [
      {
        heading: 'Workspace',
        items: [
          { to: '/calendar', label: 'Calendar', Icon: IconCalendar },
          { to: '/tasks', label: 'Tasks', Icon: IconTasks },
          { to: '/reminders', label: 'Reminders', Icon: IconReminder },
        ],
      },
      {
        heading: 'Talent',
        items: [
          // Consultants + Applications are OPERATOR_TIER routes the recruiter
          // can access — surface them here so the mobile nav matches the
          // desktop sidebar (the bottom-nav Work tab only routes to /jobs).
          { to: '/consultants', label: 'Consultants', Icon: IconUsers },
          { to: '/applications', label: 'Applications', Icon: IconFileText },
          { to: '/resumes', label: 'Resumes', Icon: IconFile },
          { to: '/reports', label: 'Analytics', Icon: IconBarChart },
        ],
      },
      {
        heading: 'Pipeline',
        items: [
          { to: '/invitations', label: 'Invitations', Icon: IconMailPlus },
          { to: '/training', label: 'My Training', Icon: IconGraduation },
        ],
      },
    ];
  }

  if (MANAGER_TIER.includes(role as never) && role !== 'RECRUITER') {
    return [
      {
        heading: 'Workspace',
        items: [
          { to: '/calendar', label: 'Calendar', Icon: IconCalendar },
          { to: '/tasks', label: 'Tasks', Icon: IconTasks },
          { to: '/reminders', label: 'Reminders', Icon: IconReminder },
        ],
      },
      {
        heading: 'Talent',
        items: [
          { to: '/jobs', label: 'Jobs', Icon: IconBriefcase },
          { to: '/applications', label: 'Applications', Icon: IconFileText },
          { to: '/resumes', label: 'Resumes', Icon: IconFile },
        ],
      },
      {
        heading: 'Training',
        items: [
          { to: '/training/courses', label: 'Courses', Icon: IconBookOpen },
          { to: '/training/assignments', label: 'Assignments', Icon: IconClipboard },
          { to: '/training', label: 'My Training', Icon: IconGraduation },
        ],
      },
      {
        heading: 'Admin',
        items: [
          { to: '/invitations', label: 'Invitations', Icon: IconMailPlus },
          { to: '/ai-usage', label: 'AI Usage', Icon: IconSparkles },
        ],
      },
    ];
  }

  if (ADMIN_TIER.includes(role as never)) {
    return [
      {
        heading: 'Workspace',
        items: [
          { to: '/calendar', label: 'Calendar', Icon: IconCalendar },
          { to: '/tasks', label: 'Tasks', Icon: IconTasks },
        ],
      },
      {
        heading: 'Talent',
        items: [
          { to: '/consultants', label: 'Consultants', Icon: IconUsers },
          { to: '/recruiters', label: 'Recruiters', Icon: IconUser },
          { to: '/managers', label: 'Managers', Icon: IconUsersCog },
        ],
      },
      {
        heading: 'Admin',
        items: [
          { to: '/admin/users', label: 'Users', Icon: IconUsers },
          { to: '/admin/groups', label: 'User Groups', Icon: IconUsersCog },
          { to: '/invitations', label: 'Invitations', Icon: IconMailPlus },
          { to: '/admin/features', label: 'Feature Flags', Icon: IconToggle },
          { to: '/ai-usage', label: 'AI Usage', Icon: IconSparkles },
          { to: '/admin/audit-log', label: 'Audit Log', Icon: IconClipboard },
        ],
      },
    ];
  }

  // DEVELOPER
  return [
    {
      heading: 'Capabilities',
      items: [
        { to: '/admin/features', label: 'Feature Flags', Icon: IconToggle },
        { to: '/ai-usage', label: 'AI Usage', Icon: IconSparkles },
        { to: '/admin/audit-log', label: 'Audit Log', Icon: IconClipboard },
      ],
    },
    {
      heading: 'Support',
      items: [{ to: '/reminders', label: 'Reminders', Icon: IconReminder }],
    },
  ];
}

interface Props {
  open: boolean;
  onClose: () => void;
}

/** MobileMoreSheet — slides up from the bottom on mobile (<md) to expose secondary navigation. */
export function MobileMoreSheet({ open, onClose }: Props) {
  const { profile, signOut } = useAuth();
  const { theme, toggle: toggleTheme } = useTheme();
  const loc = useLocation();

  // Close on route change (after a nav link is tapped).
  useEffect(() => {
    if (open) onClose();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loc.pathname]);

  if (!open) return null;

  const groups = moreGroups(profile?.role);
  const displayName = profile?.full_name || profile?.email || '';
  const roleLabel = profile?.role ? ROLE_LABEL[profile.role] : '';

  return (
    <div className="fixed inset-0 z-50 md:hidden flex flex-col justify-end">
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-slate-900/40 backdrop-blur-sm animate-fade-in"
        onClick={onClose}
        aria-hidden="true"
      />

      {/* Sheet panel */}
      <div
        className="relative animate-sheet-in noscroll overflow-y-auto"
        style={{
          background: 'var(--bg-elev)',
          borderRadius: '20px 20px 0 0',
          borderTop: '1px solid var(--border)',
          maxHeight: '92dvh',
          paddingBottom: 'env(safe-area-inset-bottom)',
        }}
      >
        {/* Drag handle */}
        <div className="flex justify-center pt-2.5 pb-1">
          <span
            className="block w-10 h-1 rounded-full"
            style={{ background: 'var(--border-strong)' }}
          />
        </div>

        {/* Sheet header */}
        <div className="flex items-center justify-between px-4 pb-3 pt-1">
          <span
            className="text-sm font-bold uppercase tracking-widest"
            style={{ color: 'var(--muted)', letterSpacing: '0.1em', fontSize: 11 }}
          >
            Menu
          </span>
          <button
            onClick={onClose}
            aria-label="Close menu"
            className="w-8 h-8 rounded-full grid place-items-center"
            style={{ background: 'var(--hover)', color: 'var(--ink-2)' }}
          >
            <IconX size={16} />
          </button>
        </div>

        <div className="px-4 pb-6 flex flex-col gap-5">
          {/* Profile card */}
          <div
            className="flex items-center gap-3 p-3.5 rounded-2xl"
            style={{
              background: 'var(--surface)',
              border: '1px solid var(--border)',
              boxShadow: 'var(--shadow-card)',
            }}
          >
            <Avatar name={displayName} email={profile?.email} size={46} />
            <div className="flex-1 min-w-0">
              <div className="text-base font-bold leading-tight truncate">
                {displayName || profile?.email}
              </div>
              <div
                className="text-xs mt-0.5 uppercase tracking-wider"
                style={{ color: 'var(--muted)', letterSpacing: '0.06em' }}
              >
                {roleLabel}
              </div>
            </div>
          </div>

          {/* Role-aware nav groups */}
          {groups.map((group) => (
            <div key={group.heading}>
              <div
                className="text-xs font-bold uppercase mb-2 px-1"
                style={{ color: 'var(--muted)', letterSpacing: '0.08em' }}
              >
                {group.heading}
              </div>
              <div
                className="rounded-2xl overflow-hidden"
                style={{
                  background: 'var(--surface)',
                  border: '1px solid var(--border)',
                  boxShadow: 'var(--shadow-card)',
                }}
              >
                {group.items.map((item, i) => (
                  <NavLink
                    key={item.to}
                    to={item.to}
                    className={({ isActive }) =>
                      clsx(
                        'flex items-center gap-3 px-3.5 py-3.5 w-full text-left',
                        i > 0 && 'border-t',
                        isActive ? 'text-accent' : 'text-ink',
                      )
                    }
                    style={{ borderColor: 'var(--border)', textDecoration: 'none' }}
                  >
                    <div
                      className="w-8 h-8 rounded-lg grid place-items-center shrink-0"
                      style={{ background: 'var(--hover)', color: 'var(--ink-2)' }}
                    >
                      <item.Icon size={17} />
                    </div>
                    <span className="flex-1 text-sm font-medium">{item.label}</span>
                    <svg
                      width="16"
                      height="16"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      style={{ color: 'var(--faint)', flexShrink: 0 }}
                    >
                      <polyline points="9 18 15 12 9 6" />
                    </svg>
                  </NavLink>
                ))}
              </div>
            </div>
          ))}

          {/* Appearance */}
          <div>
            <div
              className="text-xs font-bold uppercase mb-2 px-1"
              style={{ color: 'var(--muted)', letterSpacing: '0.08em' }}
            >
              Appearance
            </div>
            <div
              className="rounded-2xl overflow-hidden"
              style={{
                background: 'var(--surface)',
                border: '1px solid var(--border)',
                boxShadow: 'var(--shadow-card)',
              }}
            >
              <button
                type="button"
                onClick={toggleTheme}
                className="flex items-center gap-3 px-3.5 py-3.5 w-full text-left"
                style={{ color: 'var(--ink)', background: 'transparent', border: 'none' }}
              >
                <div
                  className="w-8 h-8 rounded-lg grid place-items-center shrink-0"
                  style={{ background: 'var(--hover)', color: 'var(--ink-2)' }}
                >
                  {theme === 'dark' ? (
                    /* sun */
                    <svg
                      width="17"
                      height="17"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    >
                      <circle cx="12" cy="12" r="5" />
                      <line x1="12" y1="1" x2="12" y2="3" />
                      <line x1="12" y1="21" x2="12" y2="23" />
                      <line x1="4.22" y1="4.22" x2="5.64" y2="5.64" />
                      <line x1="18.36" y1="18.36" x2="19.78" y2="19.78" />
                      <line x1="1" y1="12" x2="3" y2="12" />
                      <line x1="21" y1="12" x2="23" y2="12" />
                      <line x1="4.22" y1="19.78" x2="5.64" y2="18.36" />
                      <line x1="18.36" y1="5.64" x2="19.78" y2="4.22" />
                    </svg>
                  ) : (
                    /* moon */
                    <svg
                      width="17"
                      height="17"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    >
                      <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" />
                    </svg>
                  )}
                </div>
                <span className="flex-1 text-sm font-medium">Dark mode</span>
                {/* Toggle pill */}
                <div
                  className="relative shrink-0"
                  style={{
                    width: 44,
                    height: 26,
                    borderRadius: 999,
                    background: theme === 'dark' ? 'var(--accent)' : 'var(--border-strong)',
                    transition: 'background 0.2s',
                  }}
                >
                  <span
                    className="absolute top-[3px] rounded-full bg-white"
                    style={{
                      width: 20,
                      height: 20,
                      left: theme === 'dark' ? 21 : 3,
                      transition: 'left 0.2s',
                      boxShadow: '0 1px 3px rgba(0,0,0,0.3)',
                    }}
                  />
                </div>
              </button>
            </div>
          </div>

          {/* Sign out */}
          <button
            type="button"
            onClick={() => {
              onClose();
              void signOut();
            }}
            className="flex items-center justify-center gap-2 w-full py-3.5 rounded-2xl text-sm font-semibold"
            style={{
              color: 'var(--danger)',
              border: '1px solid var(--border)',
              background: 'var(--surface)',
            }}
          >
            <IconLogOut size={17} />
            Sign out
          </button>
        </div>
      </div>
    </div>
  );
}
