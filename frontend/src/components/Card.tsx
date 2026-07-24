import { ReactNode } from 'react';
import clsx from 'clsx';

interface Props {
  /** Optional section title displayed in a header bar above the body. */
  title?: string;
  /** Right-side slot in the header (e.g. a "View all" link or action button). */
  action?: ReactNode;
  children: ReactNode;
  /** Extra Tailwind classes on the outer wrapper. */
  className?: string;
  /** Remove the default `p-4` body padding (e.g. when you render a flush list). */
  noPad?: boolean;
  /** Render as a clickable element. */
  onClick?: () => void;
}

/**
 * Generic surface card used throughout the app.
 *
 * Replaces the repeated `bg-surface border border-border rounded-xl shadow-card`
 * pattern that appeared across dozens of pages. Matches the design-system
 * `DCard` spec: `border-radius: 14px`, optional header bar with border-bottom,
 * padding-controlled body.
 *
 * Desktop: stays as-is.
 * Mobile (<768px): shared with the mobile entity-card pattern via Tailwind
 * responsive modifiers on the consuming page.
 */
export function Card({ title, action, children, className, noPad, onClick }: Props) {
  const Tag = onClick ? 'button' : 'div';
  return (
    <Tag
      {...(onClick ? { onClick, type: 'button' } : {})}
      className={clsx(
        'bg-surface border border-border rounded-xl shadow-card text-left w-full',
        onClick && 'hover:border-border-strong transition-colors cursor-pointer press',
        className,
      )}
    >
      {title && (
        <div className="flex items-center justify-between gap-3 px-4 py-3 border-b border-border">
          <h3 className="text-sm font-semibold text-ink">{title}</h3>
          {action && <div className="shrink-0">{action}</div>}
        </div>
      )}
      <div className={noPad ? '' : 'p-4'}>{children}</div>
    </Tag>
  );
}
