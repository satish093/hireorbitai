import clsx from 'clsx';

interface SkeletonProps {
  className?: string;
  /** Inline width override — useful for varying skeleton bar lengths inline. */
  width?: string | number;
  /** Inline height override — defaults via Tailwind class. */
  height?: string | number;
}

/**
 * Single skeleton bar primitive. The animated background class
 * `.skeleton` is defined in the global stylesheet — keep this component
 * stateless so it works in any container.
 */
export function Skeleton({ className, width, height }: SkeletonProps) {
  return (
    <div
      className={clsx('skeleton rounded-md h-3', className)}
      style={{
        width: typeof width === 'number' ? `${width}px` : width,
        height: typeof height === 'number' ? `${height}px` : height,
      }}
      aria-hidden="true"
    />
  );
}

/** Stacked card-shaped skeleton — title row plus body lines. Use this for
 *  dashboards or detail panels where the loading state should mimic the
 *  structure of the loaded UI, not a blank box. */
export function SkeletonCard({ lines = 3, className }: { lines?: number; className?: string }) {
  return (
    <div className={clsx('bg-surface border border-border rounded-xl p-5 space-y-3', className)}>
      <Skeleton className="h-4 w-1/3" />
      <div className="space-y-2 pt-1">
        {Array.from({ length: lines }).map((_, i) => (
          <Skeleton key={i} className="h-3" width={`${60 + ((i * 13) % 35)}%`} />
        ))}
      </div>
    </div>
  );
}

/** Grid of metric-card skeletons sized to match a DashboardCard row. */
export function SkeletonMetricGrid({ count = 4 }: { count?: number }) {
  return (
    <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
      {Array.from({ length: count }).map((_, i) => (
        <div key={i} className="bg-surface border border-border rounded-xl p-5 space-y-3">
          <Skeleton className="h-2.5 w-1/2" />
          <Skeleton className="h-7 w-1/3" />
          <Skeleton className="h-2.5 w-2/3" />
        </div>
      ))}
    </div>
  );
}
