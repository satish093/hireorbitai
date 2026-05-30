import { Link, useLocation } from 'react-router-dom';
import { useTheme } from '../hooks/useTheme';
import { Button } from './Button';

interface Crumb {
  label: string;
  to?: string;
}

interface Props {
  title: string;
  crumbs?: Crumb[];
  /** Called when the mobile hamburger is tapped. Layout wires this to the
   *  Sidebar's mobile-drawer state. */
  onMenuClick?: () => void;
}

export function Header({ title, crumbs, onMenuClick }: Props) {
  const loc = useLocation();
  const resolved: Crumb[] = crumbs ?? defaultCrumbs(loc.pathname, title);
  const { theme, toggle } = useTheme();

  return (
    <header className="bg-surface border-b border-border px-4 sm:px-6 py-3 flex items-center gap-3 sm:gap-4">
      {/* Hamburger — mobile only. Opens the sidebar drawer. */}
      <button
        type="button"
        onClick={onMenuClick}
        aria-label="Open navigation"
        className="hidden -ml-1 w-9 h-9 inline-flex items-center justify-center rounded-lg text-muted hover:text-ink hover:bg-hover"
      >
        <svg
          width="20"
          height="20"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
        >
          <line x1="3" y1="6" x2="21" y2="6" />
          <line x1="3" y1="12" x2="21" y2="12" />
          <line x1="3" y1="18" x2="21" y2="18" />
        </svg>
      </button>

      <nav
        aria-label="Breadcrumb"
        className="flex items-center gap-2 text-sm text-muted min-w-0 flex-1"
      >
        {resolved.map((c, i) => (
          <span key={i} className="flex items-center gap-2 min-w-0">
            {c.to ? (
              <Link to={c.to} className="hover:text-ink truncate">
                {c.label}
              </Link>
            ) : (
              <span
                className={i === resolved.length - 1 ? 'text-ink font-medium truncate' : 'truncate'}
              >
                {c.label}
              </span>
            )}
            {i < resolved.length - 1 && (
              <span className="text-muted opacity-50 hidden sm:inline">›</span>
            )}
          </span>
        ))}
      </nav>

      {/* Light / dark theme switcher — flips the [data-theme] attribute via
          useTheme(), persisted to localStorage. */}
      <div className="flex items-center shrink-0">
        <Button
          variant="ghost"
          size="sm"
          iconOnly
          onClick={toggle}
          aria-label={theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
          aria-pressed={theme === 'dark'}
          leftIcon={theme === 'dark' ? <SunIcon /> : <MoonIcon />}
        />
      </div>
    </header>
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
