import { Link, useLocation } from 'react-router-dom';
import { ThemeToggle } from './ui/curtain-theme-toggle';
import { setTheme } from '../lib/theme';

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

  return (
    <header className="bg-card border-b border-border px-4 sm:px-6 py-3 flex items-center gap-3 sm:gap-4">
      {/* Hamburger — mobile only. Opens the sidebar drawer. */}
      <button
        type="button"
        onClick={onMenuClick}
        aria-label="Open navigation"
        className="md:hidden -ml-1 w-9 h-9 inline-flex items-center justify-center rounded-lg text-muted-foreground hover:text-foreground hover:bg-muted"
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
        className="flex items-center gap-2 text-sm text-muted-foreground min-w-0 flex-1"
      >
        {resolved.map((c, i) => (
          <span key={i} className="flex items-center gap-2 min-w-0">
            {c.to ? (
              <Link to={c.to} className="hover:text-foreground truncate">
                {c.label}
              </Link>
            ) : (
              <span
                className={
                  i === resolved.length - 1 ? 'text-foreground font-medium truncate' : 'truncate'
                }
              >
                {c.label}
              </span>
            )}
            {i < resolved.length - 1 && (
              <span className="text-muted-foreground opacity-50 hidden sm:inline">›</span>
            )}
          </span>
        ))}
      </nav>

      {/* Light / dark theme switcher — the curtain toggle drives the global
          `.dark` class; we persist the choice via setTheme. */}
      <div className="flex items-center shrink-0">
        <ThemeToggle variant="icon" buttonSize={32} onThemeChange={setTheme} />
      </div>
    </header>
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
