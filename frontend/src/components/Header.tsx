import { Link, useLocation, useNavigate } from 'react-router-dom';
import { useTheme } from '../hooks/useTheme';
import { useAuth } from '../context/AuthContext';
import { useBadgeCounts } from '../hooks/useBadgeCounts';
import { Button } from './Button';
import { openCommandPalette } from './CommandPalette';

interface Crumb {
  label: string;
  to?: string;
}

interface Props {
  title: string;
  crumbs?: Crumb[];
  onMenuClick?: () => void;
}

// ── Avatar helpers (same palette as Sidebar) ───────────────────────────────

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

// ── Header ─────────────────────────────────────────────────────────────────

export function Header({ title, crumbs, onMenuClick: _onMenuClick }: Props) {
  const loc = useLocation();
  const navigate = useNavigate();
  const resolved: Crumb[] = crumbs ?? defaultCrumbs(loc.pathname, title);
  const { theme, toggle } = useTheme();
  const { profile } = useAuth();
  const counts = useBadgeCounts();

  const inboxUnread = counts.inbox ?? 0;
  const seed = profile?.email ?? profile?.full_name ?? '';
  const bgColor = avatarColor(seed);
  const displayInitials = initials(profile?.full_name, profile?.email);

  return (
    <header
      className="sticky top-0 z-20 h-[60px] flex items-center gap-4 px-5 sm:px-6 border-b border-border shrink-0"
      style={{
        background: 'color-mix(in srgb, var(--bg-elev) 90%, transparent)',
        backdropFilter: 'blur(8px)',
        WebkitBackdropFilter: 'blur(8px)',
      }}
    >
      {/* ── Breadcrumb (desktop) / Page title (mobile) ── */}
      <nav
        aria-label="Breadcrumb"
        className="flex items-center gap-1.5 text-[13px] min-w-0 flex-1"
        style={{ color: 'var(--muted)' }}
      >
        {resolved.map((c, i) => (
          <span key={i} className="flex items-center gap-1.5 min-w-0">
            {c.to ? (
              <Link
                to={c.to}
                className="hover:text-ink truncate transition-colors hidden sm:inline"
              >
                {c.label}
              </Link>
            ) : (
              <span
                className={
                  i === resolved.length - 1 ? 'font-semibold truncate' : 'truncate hidden sm:inline'
                }
                style={{ color: i === resolved.length - 1 ? 'var(--ink)' : undefined }}
              >
                {c.label}
              </span>
            )}
            {i < resolved.length - 1 && <ChevronSep />}
          </span>
        ))}
      </nav>

      {/* ── ⌘K Search (desktop only) ── */}
      <div
        className="hidden md:flex items-center gap-2 h-9 px-3 rounded-[9px] cursor-text shrink-0"
        style={{
          width: 'min(280px, 32vw)',
          background: 'var(--surface-2)',
          border: '1px solid var(--border)',
          color: 'var(--muted)',
        }}
        role="button"
        aria-label="Search (⌘K)"
        tabIndex={0}
        onClick={openCommandPalette}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') e.currentTarget.click();
        }}
      >
        <SearchIcon />
        <span className="flex-1 text-[13.5px] select-none">Search…</span>
        <kbd
          className="text-[10.5px] font-semibold px-1 py-px rounded"
          style={{
            // --muted (≥4.5:1 in both themes); --faint failed WCAG AA on the
            // light search surface (2.54:1).
            color: 'var(--muted)',
            border: '1px solid var(--border)',
            lineHeight: 1.4,
          }}
        >
          ⌘K
        </kbd>
      </div>

      {/* ── Actions ── */}
      <div className="flex items-center gap-1 shrink-0">
        {/* Notification bell */}
        <button
          type="button"
          aria-label={inboxUnread > 0 ? `Inbox — ${inboxUnread} unread` : 'Inbox'}
          onClick={() => navigate('/messages')}
          className="relative w-9 h-9 rounded-[9px] grid place-items-center transition-colors hover:bg-hover"
          style={{ color: 'var(--ink-2)' }}
        >
          <BellIcon />
          {inboxUnread > 0 && (
            <span
              aria-hidden="true"
              className="absolute top-[7px] right-[7px] w-[7px] h-[7px] rounded-full border-[1.5px]"
              style={{
                background: 'var(--danger)',
                borderColor: 'var(--bg-elev)',
              }}
            />
          )}
        </button>

        {/* Theme toggle */}
        <Button
          variant="ghost"
          size="sm"
          iconOnly
          onClick={toggle}
          aria-label={theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
          aria-pressed={theme === 'dark'}
          leftIcon={theme === 'dark' ? <SunIcon /> : <MoonIcon />}
        />

        {/* Avatar (desktop only) */}
        {profile && (
          <button
            type="button"
            aria-label="Your profile"
            onClick={() => navigate(profile.id ? `/users/${profile.id}` : '#')}
            className="hidden md:flex w-8 h-8 ml-1 rounded-full items-center justify-center text-xs font-bold transition-opacity hover:opacity-80"
            style={{
              // Solid fill + white text. The previous tinted style (accent on
              // 13%-accent bg) failed WCAG AA contrast in dark mode (~3:1).
              background: bgColor,
              color: '#fff',
            }}
            title={profile.full_name ?? profile.email}
          >
            {displayInitials}
          </button>
        )}
      </div>
    </header>
  );
}

// ── Inline icons (keep Header self-contained) ──────────────────────────────

function ChevronSep() {
  return (
    <svg
      width="12"
      height="12"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      className="opacity-40 shrink-0 hidden sm:block"
    >
      <polyline points="9 18 15 12 9 6" />
    </svg>
  );
}

function SearchIcon() {
  return (
    <svg
      width="15"
      height="15"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <circle cx="11" cy="11" r="8" />
      <line x1="21" y1="21" x2="16.65" y2="16.65" />
    </svg>
  );
}

function BellIcon() {
  return (
    <svg
      width="18"
      height="18"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.75"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" />
      <path d="M13.73 21a2 2 0 0 1-3.46 0" />
    </svg>
  );
}

function MoonIcon() {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" />
    </svg>
  );
}

function SunIcon() {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <circle cx="12" cy="12" r="4" />
      <line x1="12" y1="1" x2="12" y2="3" />
      <line x1="12" y1="21" x2="12" y2="23" />
      <line x1="4.22" y1="4.22" x2="5.64" y2="5.64" />
      <line x1="18.36" y1="18.36" x2="19.78" y2="19.78" />
      <line x1="1" y1="12" x2="3" y2="12" />
      <line x1="21" y1="12" x2="23" y2="12" />
      <line x1="4.22" y1="19.78" x2="5.64" y2="18.36" />
      <line x1="18.36" y1="5.64" x2="19.78" y2="4.22" />
    </svg>
  );
}

// ── Default breadcrumb builder ─────────────────────────────────────────────

function defaultCrumbs(pathname: string, title: string): Crumb[] {
  const segs = pathname.split('/').filter(Boolean);
  const out: Crumb[] = [{ label: 'Workspace', to: '/dashboard' }];
  if (segs.length === 0 || segs[0] === 'dashboard') {
    out.push({ label: title });
    return out;
  }
  out.push({ label: segs[0]!.charAt(0).toUpperCase() + segs[0]!.slice(1), to: `/${segs[0]}` });
  if (title && title.toLowerCase() !== segs[0]) out.push({ label: title });
  return out;
}
