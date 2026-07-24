import { useLocation, useNavigate } from 'react-router-dom';
import clsx from 'clsx';
import { useAuth } from '../context/AuthContext';
import { useBadgeCounts } from '../hooks/useBadgeCounts';
import { OPERATOR_TIER } from '../types';
import { IconHome, IconInbox, IconBriefcase, IconGraduation } from './Icons';
import type { ComponentType, SVGProps } from 'react';

type IconCmp = ComponentType<SVGProps<SVGSVGElement> & { size?: number; strokeWidth?: number }>;

/** Icon: three dots (More). Inline to avoid adding to Icons.tsx for just this. */
function IconMore({ size = 24, ...p }: { size?: number } & SVGProps<SVGSVGElement>) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.85}
      strokeLinecap="round"
      strokeLinejoin="round"
      {...p}
    >
      <circle cx="5" cy="12" r="1.5" fill="currentColor" stroke="none" />
      <circle cx="12" cy="12" r="1.5" fill="currentColor" stroke="none" />
      <circle cx="19" cy="12" r="1.5" fill="currentColor" stroke="none" />
    </svg>
  );
}

interface Tab {
  id: string;
  label: string;
  Icon: IconCmp | typeof IconMore;
  /** If set, navigate to this path. If absent, tab fires onMore. */
  to?: string;
  /** Which badge counter to show. */
  badge?: 'inbox';
  /** Paths that count as "active" for this tab. */
  activeOn?: string[];
}

/** Role → where the Work tab navigates. */
function workRoute(role: string | undefined): string {
  if (!role) return '/jobs';
  if (OPERATOR_TIER.includes(role as never)) {
    if (role === 'RECRUITER') return '/jobs';
    return '/consultants'; // MANAGER_TIER within OPERATOR_TIER
  }
  if (role === 'CONSULTANT') return '/tasks';
  if (role === 'DEVELOPER') return '/admin/features';
  return '/jobs';
}

/** Paths that count as the Work tab being active — all work-area routes. */
const WORK_PATHS = [
  '/jobs',
  '/consultants',
  '/recruiters',
  '/managers',
  '/applications',
  '/tasks',
  '/resumes',
  '/interviews',
  '/admin/users',
  '/admin/features',
  '/admin/groups',
  '/admin/ai-settings',
  '/admin/audit-log',
  '/admin/calls-usage',
  '/admin/deactivated',
  '/ai-usage',
  '/vendors',
  '/clients',
];

const TRAINING_PATHS = ['/training', '/training/courses', '/training/assignments'];

interface Props {
  onMore: () => void;
}

export function MobileBottomNav({ onMore }: Props) {
  const { profile } = useAuth();
  const counts = useBadgeCounts();
  const loc = useLocation();
  const navigate = useNavigate();

  const role = profile?.role;
  const workHref = workRoute(role);

  const tabs: Tab[] = [
    {
      id: 'home',
      label: 'Home',
      Icon: IconHome,
      to: '/dashboard',
      activeOn: ['/dashboard'],
    },
    {
      id: 'inbox',
      label: 'Inbox',
      Icon: IconInbox,
      to: '/messages',
      badge: 'inbox',
      activeOn: ['/messages'],
    },
    {
      id: 'work',
      label: 'Work',
      Icon: IconBriefcase,
      to: workHref,
      activeOn: WORK_PATHS,
    },
    {
      id: 'training',
      label: 'Training',
      Icon: IconGraduation,
      to: '/training',
      activeOn: TRAINING_PATHS,
    },
    {
      id: 'more',
      label: 'More',
      Icon: IconMore,
    },
  ];

  function isActive(tab: Tab): boolean {
    const paths = tab.activeOn ?? (tab.to ? [tab.to] : []);
    return paths.some((p) => loc.pathname === p || loc.pathname.startsWith(p + '/'));
  }

  return (
    <nav
      aria-label="Mobile navigation"
      className="fixed bottom-0 left-0 right-0 z-30 md:hidden"
      style={{
        background: 'var(--bg-elev)',
        borderTop: '1px solid var(--border)',
        paddingBottom: 'env(safe-area-inset-bottom)',
      }}
    >
      <div className="flex h-[58px]">
        {tabs.map((tab) => {
          const active = isActive(tab);
          const badgeCount = tab.badge ? (counts[tab.badge] ?? 0) : 0;

          return (
            <button
              key={tab.id}
              type="button"
              aria-label={tab.label}
              aria-current={active ? 'page' : undefined}
              onClick={() => {
                if (tab.to) {
                  navigate(tab.to);
                } else {
                  onMore();
                }
              }}
              className={clsx(
                'flex-1 flex flex-col items-center justify-center gap-[3px] min-h-[44px]',
                'border-none bg-transparent cursor-pointer transition-colors duration-150',
                active ? 'text-accent' : 'text-muted',
              )}
            >
              <div className="relative">
                <tab.Icon size={23} strokeWidth={active ? 2.1 : 1.75} />
                {badgeCount > 0 && (
                  <span
                    aria-label={`${badgeCount} unread`}
                    className="absolute -top-1 -right-2 min-w-[15px] h-[15px] px-[3px] rounded-full text-white grid place-items-center"
                    style={{
                      background: 'var(--danger)',
                      fontSize: 9,
                      fontWeight: 700,
                      border: '1.5px solid var(--bg-elev)',
                    }}
                  >
                    {badgeCount > 99 ? '99+' : badgeCount}
                  </span>
                )}
              </div>
              <span
                className="leading-none"
                style={{
                  fontSize: 10.5,
                  fontWeight: active ? 700 : 500,
                  letterSpacing: '0.01em',
                }}
              >
                {tab.label}
              </span>
            </button>
          );
        })}
      </div>
    </nav>
  );
}
