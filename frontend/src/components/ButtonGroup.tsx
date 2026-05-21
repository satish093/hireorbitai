import type { ReactNode } from 'react';
import clsx from 'clsx';

/**
 * Segmented control. Wrap a set of <ButtonGroupItem> for mutually-exclusive
 * view toggles (Kanban/List, Day/Week/Month, Recommended/Saved/Applied, …).
 * Replaces the old ad-hoc `flex bg-slate-100 rounded-md` toggles.
 */
export function ButtonGroup({ children }: { children: ReactNode }) {
  return (
    <div className="inline-flex bg-bg-sunken border border-border rounded-[7px] p-[3px] gap-0.5">
      {children}
    </div>
  );
}

export function ButtonGroupItem({
  pressed,
  onClick,
  children,
}: {
  pressed?: boolean;
  onClick?: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      aria-pressed={pressed}
      onClick={onClick}
      className={clsx(
        'h-6 px-2.5 text-xs font-medium rounded-[4px] transition-colors',
        pressed
          ? 'bg-surface text-ink shadow-sm dark:bg-[oklch(0.30_0.011_260)]'
          : 'text-muted hover:text-ink',
      )}
    >
      {children}
    </button>
  );
}
