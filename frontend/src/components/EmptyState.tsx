import { ReactNode } from 'react';
import clsx from 'clsx';

interface Props {
  /** Big optional icon/illustration. An emoji or an Icon component both work. */
  icon?: ReactNode;
  title: string;
  description?: ReactNode;
  /** Primary CTA — pass a <Button> or <Link>. */
  action?: ReactNode;
  /** Tighter padding for use inside cards or smaller panels. */
  compact?: boolean;
  className?: string;
}

/**
 * Shared empty-state placeholder. Lives at the centre of an empty list,
 * dashboard panel, or detail view. Use compact={true} when nested inside an
 * already-bordered card so we don't get a double-border look.
 */
export function EmptyState({ icon, title, description, action, compact, className }: Props) {
  return (
    <div
      className={clsx(
        'flex flex-col items-center justify-center text-center animate-scale-in',
        compact ? 'py-8 px-4' : 'py-14 px-6 bg-surface border border-border rounded-xl',
        className,
      )}
    >
      {icon && (
        <div
          className={clsx(
            'mb-3 inline-flex items-center justify-center rounded-full bg-hover text-muted',
            compact ? 'w-10 h-10 text-lg' : 'w-14 h-14 text-2xl',
          )}
          aria-hidden="true"
        >
          {icon}
        </div>
      )}
      <h3 className={clsx('font-semibold text-ink', compact ? 'text-sm' : 'text-base')}>{title}</h3>
      {description && (
        <p className={clsx('text-muted mt-1 max-w-sm', compact ? 'text-xs' : 'text-sm')}>
          {description}
        </p>
      )}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}
