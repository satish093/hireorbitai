import { ReactNode, useEffect, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { Sidebar } from './Sidebar';
import { Header } from './Header';

interface Crumb {
  label: string;
  to?: string;
}

export function Layout({
  title,
  crumbs,
  children,
}: {
  title: string;
  crumbs?: Crumb[];
  children: ReactNode;
}) {
  const loc = useLocation();
  const [navOpen, setNavOpen] = useState(false);

  useEffect(() => {
    setNavOpen(false);
  }, [loc.pathname]);

  return (
    <div className="flex min-h-dvh bg-bg text-ink">
      <Sidebar mobileOpen={navOpen} onMobileClose={() => setNavOpen(false)} />
      <div className="flex-1 flex flex-col min-w-0">
        <Header title={title} crumbs={crumbs} onMenuClick={() => setNavOpen(true)} />
        {/* key remounts <main> on every route change, re-triggering
            animate-page-enter and the CSS stagger cascade. */}
        <main
          key={loc.pathname}
          className="flex-1 p-4 sm:p-6 lg:p-8 overflow-auto animate-page-enter"
          tabIndex={0}
        >
          {children}
        </main>
      </div>
    </div>
  );
}
