import { ReactNode } from 'react';
import clsx from 'clsx';

interface Props {
  children: ReactNode;
  className?: string;
}

/**
 * StickyActionBar — pins primary actions above the mobile safe-area gesture bar.
 *
 * Used on detail screens and form sheets where a single primary action (e.g.
 * "Submit", "Save changes", "Submit a consultant") must always be reachable
 * without scrolling. Sits at sticky bottom-0 so it scrolls into view as needed
 * on short-content pages, and stays fixed to the viewport on tall-content pages.
 *
 * Safe-area handled via `padding-bottom: env(safe-area-inset-bottom)` so the
 * bar never overlaps the iPhone gesture bar or Android nav strip.
 *
 * Desktop: visible as a page-footer action strip (no safe-area padding).
 * Mobile (<768px): floats over the bottom nav — z-index 5 keeps it below the
 * bottom nav (z-30) while still clearing page content.
 */
export function StickyActionBar({ children, className }: Props) {
  return (
    <div
      className={clsx(
        'sticky bottom-0 left-0 right-0 z-[5]',
        'flex items-center gap-2.5 px-4 pt-3',
        'bg-[var(--bg-elev)] border-t border-border',
        className,
      )}
      style={{
        paddingBottom: 'max(12px, env(safe-area-inset-bottom))',
        boxShadow: '0 -4px 16px rgba(0,0,0,.06)',
      }}
    >
      {children}
    </div>
  );
}
