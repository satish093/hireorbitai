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
  // Use the location key so each route change retriggers the page-enter
  // animation. Without `key`, React reuses the same DOM node and the
  // animation only plays on the first mount.
  const loc = useLocation();

  // Mobile sidebar lives as a slide-over overlay; desktop renders it inline.
  // State is lifted here so the Header's hamburger can toggle it without
  // wiring a context just for that.
  const [navOpen, setNavOpen] = useState(false);

  // Close the mobile nav whenever the route changes so the user isn't left
  // staring at the overlay after tapping a link.
  useEffect(() => {
    setNavOpen(false);
  }, [loc.pathname]);

  return (
    <div className="flex min-h-dvh bg-bg text-ink">
      <Sidebar mobileOpen={navOpen} onMobileClose={() => setNavOpen(false)} />
      <div className="flex-1 flex flex-col min-w-0">
        <Header title={title} crumbs={crumbs} onMenuClick={() => setNavOpen(true)} />
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
