import { useEffect } from 'react';
import { useLocation } from 'react-router-dom';

// React Router preserves scroll position across navigations by default. The
// app's layout uses window scroll (Layout's <main> has overflow-auto but no
// constrained height, so content grows past the viewport and the body itself
// scrolls). Without this component, navigating from a long page to a short
// one leaves the new page scrolled halfway down. Reset on every pathname
// change. Doesn't fire for hash-only changes (e.g. anchor links).
export function ScrollToTop() {
  const { pathname } = useLocation();
  useEffect(() => {
    window.scrollTo({ top: 0, left: 0, behavior: 'auto' });
  }, [pathname]);
  return null;
}
