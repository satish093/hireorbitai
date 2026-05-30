import { useEffect, useState } from 'react';

/**
 * `true` when the viewport is below Tailwind's `md` breakpoint (768px) — i.e.
 * the same cutoff as `md:hidden` / `hidden md:block`. Use this to render EITHER
 * a mobile surface OR a desktop one (so a heavy component mounts once, not
 * twice) rather than relying on CSS `hidden` which still mounts both.
 *
 * Tracks live via matchMedia so a resize / device-rotation flips it.
 */
export function useIsMobile(): boolean {
  const [mobile, setMobile] = useState(
    () => typeof window !== 'undefined' && window.innerWidth < 768,
  );
  useEffect(() => {
    const mq = window.matchMedia('(max-width: 767px)');
    setMobile(mq.matches);
    const handler = (e: MediaQueryListEvent) => setMobile(e.matches);
    mq.addEventListener('change', handler);
    return () => mq.removeEventListener('change', handler);
  }, []);
  return mobile;
}
