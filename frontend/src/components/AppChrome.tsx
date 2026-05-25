import { createContext, useContext, useEffect, useState } from 'react';
import { Outlet, useLocation } from 'react-router-dom';
import { Sidebar } from './Sidebar';
import { useAuth } from '../context/AuthContext';

/**
 * Persistent application shell.
 *
 * Rendered ONCE as a layout route that wraps every in-app page. The sidebar
 * lives here — not inside each page's <Layout> — so navigating between routes
 * no longer unmounts/remounts it. That keeps the nav scroll position, the
 * collapsed-section state, the badge poller, and the active-link transition all
 * alive across navigation (previously the whole sidebar reloaded and jumped to
 * the top on every click).
 *
 * The mobile drawer open-state lives here too and is shared with the per-page
 * Header (which renders the hamburger) via NavContext.
 */

interface NavCtx {
  openNav: () => void;
}

const NavContext = createContext<NavCtx>({ openNav: () => {} });

/** Header reads this to wire its mobile hamburger to the shared drawer state. */
export function useNav(): NavCtx {
  return useContext(NavContext);
}

export function AppChrome() {
  const { profile } = useAuth();
  const loc = useLocation();
  const [navOpen, setNavOpen] = useState(false);

  // Close the mobile drawer whenever the route changes.
  useEffect(() => {
    setNavOpen(false);
  }, [loc.pathname]);

  return (
    <NavContext.Provider value={{ openNav: () => setNavOpen(true) }}>
      <div className="flex min-h-dvh bg-bg text-ink">
        {/* Only show the nav once we have an authenticated profile — the child
            routes are ProtectedRoute-gated, so an unauthed render is just the
            redirect flash. */}
        {profile && <Sidebar mobileOpen={navOpen} onMobileClose={() => setNavOpen(false)} />}
        <Outlet />
      </div>
    </NavContext.Provider>
  );
}
