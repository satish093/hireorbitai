import { useEffect } from 'react';
import { useLocation } from 'react-router-dom';

// React Router preserves scroll position across navigations by default. The
// app shell is now fixed-height and the page's <main> owns scrolling (see
// AppChrome/Layout), so reset THAT element — not the window — on every pathname
// change. (Layout also remounts <main> via key={pathname}, which resets scroll;
// this is a belt-and-braces reset that also covers any non-Layout scrollers.)
// Falls back to window for safety. Doesn't fire for hash-only changes.
export function ScrollToTop() {
  const { pathname } = useLocation();
  useEffect(() => {
    const main = document.querySelector('main');
    if (main) main.scrollTo({ top: 0, left: 0, behavior: 'auto' });
    window.scrollTo({ top: 0, left: 0, behavior: 'auto' });
  }, [pathname]);
  return null;
}
