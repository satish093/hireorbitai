import { createContext, useContext, useEffect, useState } from 'react';
import { Outlet, useLocation } from 'react-router-dom';
import { Sidebar } from './Sidebar';
import { MobileBottomNav } from './MobileBottomNav';
import { MobileMoreSheet } from './MobileMoreSheet';
import { CommandPalette } from './CommandPalette';
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
 *
 * MobileBottomNav + MobileMoreSheet are also mounted here — they are
 * `position: fixed` and `md:hidden` so they only appear below the md breakpoint
 * and don't affect the desktop layout flow.
 */

interface NavCtx {
  openNav: () => void;
  openMore: () => void;
}

const NavContext = createContext<NavCtx>({ openNav: () => {}, openMore: () => {} });

/** Header reads this to wire its mobile hamburger to the shared drawer state. */
export function useNav(): NavCtx {
  return useContext(NavContext);
}

export function AppChrome() {
  const { profile } = useAuth();
  const loc = useLocation();
  const [navOpen, setNavOpen] = useState(false);
  const [moreOpen, setMoreOpen] = useState(false);

  // Close the mobile drawer whenever the route changes.
  useEffect(() => {
    setNavOpen(false);
  }, [loc.pathname]);

  return (
    <NavContext.Provider
      value={{
        openNav: () => setNavOpen(true),
        openMore: () => setMoreOpen(true),
      }}
    >
      {/* Fixed-height app shell (h-dvh, was min-h-dvh): the sidebar stays put
          and a page's <Layout> <main> becomes a real internal scroll region
          (flex-1 + min-h-0 + overflow-auto). Previously min-h-dvh let the BODY
          be the scroll container (body's overflow-x:hidden computes
          overflow-y:auto), which is flaky on iOS Safari — the page often
          wouldn't scroll. NOT overflow-hidden: a few in-app pages render bare
          (no <Layout>) and must keep their own body-scroll fallback rather than
          be clipped. */}
      <div className="flex h-dvh bg-bg text-ink">
        {/* Only show the nav once we have an authenticated profile — the child
            routes are ProtectedRoute-gated, so an unauthed render is just the
            redirect flash. */}
        {profile && <Sidebar mobileOpen={navOpen} onMobileClose={() => setNavOpen(false)} />}
        <Outlet />
      </div>

      {/* Mobile-only navigation — fixed overlay, hidden above md breakpoint. */}
      {profile && <MobileBottomNav onMore={() => setMoreOpen(true)} />}
      {profile && <MobileMoreSheet open={moreOpen} onClose={() => setMoreOpen(false)} />}

      {/* Global ⌘K command palette — mounted once so it survives navigation. */}
      {profile && <CommandPalette />}
    </NavContext.Provider>
  );
}
