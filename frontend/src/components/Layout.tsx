import { ReactNode, useEffect, useRef, useState } from 'react';
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

  // Snapshot of the page currently on screen. Holds the previous page's
  // content during the exit animation so it stays visible while fading out.
  const [snap, setSnap] = useState<{ path: string; children: ReactNode }>({
    path: loc.pathname,
    children,
  });
  const [leaving, setLeaving] = useState(false);

  // Always reflects the latest incoming props. Read by handleExitEnd so it
  // grabs the most recent children even if the user navigated multiple times
  // before the exit animation finished.
  const latestRef = useRef({ path: loc.pathname, children });
  latestRef.current = { path: loc.pathname, children };

  useEffect(() => {
    setNavOpen(false);
  }, [loc.pathname]);

  useEffect(() => {
    if (loc.pathname === snap.path) return;
    setLeaving(true);
  }, [loc.pathname, snap.path]);

  const handleExitEnd = (e: React.AnimationEvent<HTMLElement>) => {
    // Ignore animationend events bubbling up from staggered children.
    if (e.target !== e.currentTarget) return;
    setSnap(latestRef.current);
    setLeaving(false);
  };

  return (
    <div className="flex min-h-dvh bg-bg text-ink">
      <Sidebar mobileOpen={navOpen} onMobileClose={() => setNavOpen(false)} />
      <div className="flex-1 flex flex-col min-w-0">
        <Header title={title} crumbs={crumbs} onMenuClick={() => setNavOpen(true)} />
        {/* key={snap.path} remounts <main> when the snapshot swaps, which
            re-triggers animate-page-enter on the incoming page. */}
        <main
          key={snap.path}
          className={`flex-1 p-4 sm:p-6 lg:p-8 overflow-auto ${leaving ? 'animate-page-exit' : 'animate-page-enter'}`}
          onAnimationEnd={leaving ? handleExitEnd : undefined}
          tabIndex={0}
        >
          {snap.children}
        </main>
      </div>
    </div>
  );
}
