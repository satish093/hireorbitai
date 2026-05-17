import { Link, useLocation } from 'react-router-dom';

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
    <header className="bg-white border-b border-slate-200 px-4 sm:px-6 py-3 flex items-center gap-3 sm:gap-4">
      {/* Hamburger — mobile only. Opens the sidebar drawer. */}
      <button
        type="button"
        onClick={onMenuClick}
        aria-label="Open navigation"
        className="md:hidden -ml-1 w-9 h-9 inline-flex items-center justify-center rounded-lg text-slate-600 hover:text-slate-900 hover:bg-slate-100"
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
        className="flex items-center gap-2 text-sm text-slate-500 min-w-0 flex-1"
      >
        {resolved.map((c, i) => (
          <span key={i} className="flex items-center gap-2 min-w-0">
            {c.to ? (
              <Link to={c.to} className="hover:text-slate-700 truncate">
                {c.label}
              </Link>
            ) : (
              <span
                className={
                  i === resolved.length - 1 ? 'text-slate-900 font-medium truncate' : 'truncate'
                }
              >
                {c.label}
              </span>
            )}
            {i < resolved.length - 1 && <span className="text-slate-300 hidden sm:inline">›</span>}
          </span>
        ))}
      </nav>

      {/* Header right-side actions intentionally left empty for now. The
          previous disabled search + bell icons looked like broken UI; they'll
          come back once search and notifications actually land. */}
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
