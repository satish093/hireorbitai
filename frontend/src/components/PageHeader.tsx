import { ReactNode } from 'react';

/**
 * Standard page heading row. Used at the top of each main content area, below
 * the breadcrumbs. Pair the page title with an optional one-line description
 * and an `action` slot for the primary CTA (e.g. "+ New vendor").
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
      <div className="min-w-0">
        <h1 className="text-2xl font-semibold tracking-tight text-slate-900">{title}</h1>
        {description && <p className="text-sm text-slate-500 mt-1">{description}</p>}
      </div>
      {action && <div className="flex items-center gap-2">{action}</div>}
    </div>
  );
}
