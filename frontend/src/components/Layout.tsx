import { ReactNode } from 'react';
import { useLocation } from 'react-router-dom';
import { Header } from './Header';
import { useNav } from './AppChrome';

interface Crumb {
  label: string;
  to?: string;
}

/**
 * Per-page content column. The sidebar + flex shell now live in <AppChrome> (a
 * persistent layout route), so Layout only renders the header + scrollable main
 * for the current page. The hamburger toggle comes from the shared NavContext.
 */
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
  const { openNav } = useNav();

  return (
    <div className="flex-1 flex flex-col min-w-0">
      <Header title={title} crumbs={crumbs} onMenuClick={openNav} />
      {/* key remounts <main> on every route change, re-triggering
          animate-page-enter and the CSS stagger cascade. */}
      <main
        key={loc.pathname}
        className="flex-1 p-4 sm:p-6 lg:p-8 pb-20 md:pb-6 lg:pb-8 overflow-auto animate-page-enter"
        tabIndex={0}
      >
        {children}
      </main>
    </div>
  );
}
