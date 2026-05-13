import { useEffect, useState } from 'react';
import { NavLink } from 'react-router-dom';
import clsx from 'clsx';
import { useAuth } from '../context/AuthContext';
import { Role, ROLE_LABEL, OPERATOR_TIER, MANAGER_TIER, ALL_ROLES, OWNER_TIER } from '../types';
import { api } from '../services/api';
import { useFeatureFlags } from '../hooks/useFeatureFlags';
import { Brand } from './Brand';
import {
  IconHome, IconTasks, IconCalendar, IconInbox, IconReminder,
  IconUsers, IconUser, IconBriefcase, IconFileText, IconVideo, IconFile,
  IconBuilding, IconBuilding2, IconBarChart, IconSparkles, IconMailPlus,
  IconUsersCog, IconToggle, IconLogOut,
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
      { to: '/tasks', label: 'Tasks', icon: IconTasks, roles: ALL_ROLES, badgeKey: 'tasks', flagKey: 'tasks' },
      { to: '/calendar', label: 'Calendar', icon: IconCalendar, roles: ALL_ROLES },
      { to: '/messages', label: 'Inbox', icon: IconInbox, roles: ALL_ROLES, badgeKey: 'inbox', flagKey: 'messages' },
      { to: '/reminders', label: 'Reminders', icon: IconReminder, roles: ALL_ROLES, badgeKey: 'reminders', flagKey: 'reminders' },
    ],
  },
  {
    heading: 'Talent',
    items: [
      { to: '/consultants', label: 'Consultants', icon: IconUsers, roles: OPERATOR_TIER },
      { to: '/recruiters', label: 'Recruiters', icon: IconUser, roles: MANAGER_TIER },
      { to: '/jobs', label: 'Jobs', icon: IconBriefcase, roles: ALL_ROLES },
      { to: '/applications', label: 'Applications', icon: IconFileText, roles: ALL_ROLES },
      { to: '/interviews', label: 'Interviews', icon: IconVideo, roles: ALL_ROLES, flagKey: 'interviews' },
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
    heading: 'Admin',
    items: [
      { to: '/reports', label: 'Reports', icon: IconBarChart, roles: MANAGER_TIER, flagKey: 'reports' },
      { to: '/ai-email', label: 'AI Email', icon: IconSparkles, roles: OPERATOR_TIER, flagKey: 'ai_email' },
      { to: '/invitations', label: 'Invitations', icon: IconMailPlus, roles: MANAGER_TIER },
      { to: '/admin/groups', label: 'User groups', icon: IconUsersCog, roles: MANAGER_TIER },
      { to: '/admin/features', label: 'Feature flags', icon: IconToggle, roles: OWNER_TIER },
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

export function Sidebar() {
  const { profile, signOut } = useAuth();
  const { flags } = useFeatureFlags();
  const role = profile?.role;
  const [counts, setCounts] = useState<{ tasks?: number; reminders?: number; inbox?: number }>({});

  useEffect(() => {
    if (!profile) return;
    let cancelled = false;
    const tick = async () => {
      const [t, r, u] = await Promise.all([
        api.get('/tasks/assigned-to-me').catch(() => ({ data: [] })),
        api.get('/reminders', { params: { status: 'PENDING' } }).catch(() => ({ data: [] })),
        api.get('/messages/unread-count').catch(() => ({ data: { unread: 0 } })),
      ]);
      if (cancelled) return;
      setCounts({
        tasks: (t.data ?? []).length,
        reminders: (r.data ?? []).length,
        inbox: u.data?.unread ?? 0,
      });
    };
    tick();
    const i = setInterval(tick, 15000);
    return () => { cancelled = true; clearInterval(i); };
  }, [profile?.id]);

  return (
    <aside className="w-60 shrink-0 bg-white border-r border-slate-200 min-h-screen flex flex-col">
      {/* Brand */}
      <div className="px-4 py-4 border-b border-slate-100">
        <Brand size="md" />
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
              <div className="px-2 mb-1.5 text-[10px] font-semibold tracking-widest text-slate-400 uppercase">
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
                      className={({ isActive }) =>
                        clsx(
                          'group relative flex items-center gap-2.5 px-2.5 py-1.5 rounded-md text-sm transition-all duration-200 ease-out',
                          isActive
                            ? 'bg-brand-50 text-brand-700 font-medium'
                            : 'text-slate-700 hover:bg-slate-50 hover:text-slate-900 hover:translate-x-0.5'
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
                          <Icon size={17} className={clsx(
                            'shrink-0 transition-colors',
                            isActive ? 'text-brand-600' : 'text-slate-500 group-hover:text-slate-700',
                          )} />
                          <span className="flex-1 truncate">{i.label}</span>
                          {typeof badge === 'number' && badge > 0 && (
                            <span
                              key={badge}
                              className={clsx(
                                'text-[10px] font-semibold px-1.5 py-0.5 rounded-full tabular-nums animate-pop',
                                isActive
                                  ? 'bg-brand-600 text-white'
                                  : 'bg-slate-200 text-slate-700'
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
      <div className="border-t border-slate-100 p-3">
        <div className="flex items-center gap-2.5 px-1.5 py-1.5 rounded-md hover:bg-slate-50">
          <NavLink
            to={profile?.id ? `/users/${profile.id}` : '#'}
            className="flex items-center gap-2.5 flex-1 min-w-0 hover:bg-slate-50 rounded-md -mx-1 px-1 py-0.5"
            title="View your profile"
          >
            <div className="relative">
              <div className="w-8 h-8 rounded-full bg-emerald-100 text-emerald-700 flex items-center justify-center text-xs font-semibold">
                {initials(profile?.full_name, profile?.email)}
              </div>
              <span className="absolute -bottom-0.5 -right-0.5 w-2.5 h-2.5 bg-emerald-500 border-2 border-white rounded-full">
                <span className="absolute inset-0 rounded-full bg-emerald-500 animate-ping opacity-60" />
              </span>
            </div>
            <div className="flex-1 min-w-0 leading-tight">
              <div className="text-[13px] font-medium text-slate-900 truncate">
                {profile?.full_name ?? profile?.email}
              </div>
              <div className="text-[10px] uppercase tracking-wider text-slate-500">{role && ROLE_LABEL[role]}</div>
            </div>
          </NavLink>
          <button
            onClick={signOut}
            title="Sign out"
            className="text-slate-400 hover:text-slate-700 p-1.5 rounded-md hover:bg-slate-100 transition-colors"
          >
            <IconLogOut size={16} />
          </button>
        </div>
      </div>
    </aside>
  );
}
