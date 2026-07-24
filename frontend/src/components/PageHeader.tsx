import { ReactNode } from 'react';

/**
 * Standard page heading row. Used at the top of each main content area, below
 * the breadcrumbs. Pair the page title with an optional one-line description
 * and an `action` slot for the primary CTA (e.g. "+ New vendor").
 *
 * Title and description wrap naturally; action(s) drop to a new row on
 * narrow viewports rather than truncating off-screen.
 */
export function PageHeader({
  title,
  description,
  action,
}: {
  title: string;
  description?: string;
  action?: ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-end justify-between gap-3 mb-5 animate-fade-in-down">
      <div className="min-w-0 flex-1">
        <h1 className="text-xl sm:text-2xl font-semibold tracking-tight text-ink break-words">
          {title}
        </h1>
        {description && <p className="text-sm text-muted mt-1 break-words">{description}</p>}
      </div>
      {action && <div className="flex flex-wrap items-center gap-2 w-full sm:w-auto">{action}</div>}
    </div>
  );
}
