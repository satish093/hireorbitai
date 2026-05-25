import { useEffect } from 'react';
import { flushSync } from 'react-dom';
import { useNavigate } from 'react-router-dom';

/**
 * Intercepts internal <Link> clicks and wraps navigation in
 * document.startViewTransition so the browser captures a screenshot of the
 * current page and crossfades it to the incoming page.
 *
 * Progressive enhancement: when the API is not available (Firefox < 126,
 * older Safari) the click handler returns immediately and React Router handles
 * the navigation normally — only the enter animation plays.
 *
 * Must be rendered INSIDE <BrowserRouter> so useNavigate works.
 */
export function ViewTransition() {
  const navigate = useNavigate();

  useEffect(() => {
    if (!('startViewTransition' in document)) return;

    const handler = (e: MouseEvent) => {
      // Let the browser handle modified clicks (new tab, etc.)
      if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
      // Already handled (e.g. by a nested handler that called preventDefault)
      if (e.defaultPrevented) return;

      const link = (e.target as Element).closest('a[href]') as HTMLAnchorElement | null;
      if (!link || link.target === '_blank' || link.target === '_top') return;

      const href = link.getAttribute('href');
      // Only intercept relative / root-relative internal paths
      if (!href || !href.startsWith('/')) return;

      e.preventDefault();
      // flushSync forces React to render the new route synchronously inside
      // the VT callback so the browser captures the updated DOM correctly.
      (document as any).startViewTransition(() => {
        flushSync(() => navigate(href));
      });
    };

    // Capture phase so we fire before React Router's synthetic-event handler.
    // React Router's <Link> skips its own navigate when event.defaultPrevented
    // is true, so calling e.preventDefault() here stops the double-navigate.
    document.addEventListener('click', handler, true);
    return () => document.removeEventListener('click', handler, true);
  }, [navigate]);

  return null;
}
