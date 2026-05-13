import { Link, useLocation } from 'react-router-dom';
import { IconSearch, IconBell } from './Icons';

interface Crumb {
  label: string;
  to?: string;
}

export function Header({ title, crumbs }: { title: string; crumbs?: Crumb[] }) {
  const loc = useLocation();
  const resolved: Crumb[] = crumbs ?? defaultCrumbs(loc.pathname, title);

  return (
    <header className="bg-white border-b border-slate-200 px-6 py-3 flex items-center justify-between gap-4">
      <nav className="flex items-center gap-2 text-sm text-slate-500 min-w-0">
        {resolved.map((c, i) => (
          <span key={i} className="flex items-center gap-2 min-w-0">
            {c.to ? (
              <Link to={c.to} className="hover:text-slate-700 truncate">{c.label}</Link>
            ) : (
              <span className={i === resolved.length - 1 ? 'text-slate-900 font-medium truncate' : 'truncate'}>{c.label}</span>
            )}
            {i < resolved.length - 1 && <span className="text-slate-300">›</span>}
          </span>
        ))}
      </nav>

      <div className="flex items-center gap-3 ml-auto">
        <div className="relative hidden md:block" title="Coming soon">
          <input
            type="text"
            disabled
            placeholder="Search (coming soon)"
            className="w-72 bg-slate-50 border border-slate-200 rounded-lg pl-9 pr-12 py-1.5 text-sm placeholder-slate-400 cursor-not-allowed"
          />
          <IconSearch size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
          <span className="absolute right-2 top-1/2 -translate-y-1/2 text-[10px] font-mono text-slate-400 bg-white border border-slate-200 rounded px-1 py-0.5">⌘K</span>
        </div>
        <button
          title="Notifications (coming soon)"
          disabled
          className="relative w-9 h-9 flex items-center justify-center rounded-full text-slate-400 cursor-not-allowed"
        >
          <IconBell size={18} />
        </button>
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
  // top-level segment as the section label
  out.push({ label: segs[0]!.charAt(0).toUpperCase() + segs[0]!.slice(1), to: `/${segs[0]}` });
  if (title && title.toLowerCase() !== segs[0]) out.push({ label: title });
  return out;
}
