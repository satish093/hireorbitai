import { ReactNode } from 'react';
import clsx from 'clsx';

export interface Column<T> {
  key: string;
  header: string;
  render?: (row: T) => ReactNode;
  className?: string;
  /** Right-align numeric columns. */
  align?: 'left' | 'right' | 'center';
  /** Omit this column from the mobile card view (still shown on desktop). */
  hideOnMobile?: boolean;
}

interface Props<T> {
  columns: Column<T>[];
  rows: T[];
  empty?: ReactNode;
  loading?: boolean;
  onRowClick?: (row: T) => void;
}

const STAGGER_MAX = 12;

export function DataTable<T extends { id?: string }>({
  columns,
  rows,
  empty,
  loading,
  onRowClick,
}: Props<T>) {
  const alignClass = (a?: Column<T>['align']) =>
    a === 'right' ? 'text-right' : a === 'center' ? 'text-center' : 'text-left';

  const isEmpty = !loading && rows.length === 0;

  // Mobile view: all columns except those marked hideOnMobile.
  const mobileColumns = columns.filter((c) => !c.hideOnMobile);
  const [primaryCol, ...restCols] = mobileColumns;

  function renderCell(c: Column<T>, row: T) {
    return c.render
      ? c.render(row)
      : ((row as any)[c.key] ?? <span className="text-muted">—</span>);
  }

  return (
    <div className="bg-surface rounded-xl border border-border overflow-hidden animate-fade-in">
      {/* ── DESKTOP TABLE — hidden below sm ─────────────────────────── */}
      <div className="hidden sm:block overflow-x-auto" tabIndex={isEmpty ? undefined : 0}>
        <table className="w-full text-sm min-w-[560px]">
          <thead className="bg-hover text-[10px] font-semibold tracking-widest text-ink-2 uppercase">
            <tr>
              {columns.map((c) => (
                <th
                  key={c.key}
                  className={clsx(
                    'px-3 sm:px-4 py-2.5 whitespace-nowrap',
                    alignClass(c.align),
                    c.className,
                  )}
                >
                  {c.header}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {loading
              ? Array.from({ length: 5 }).map((_, i) => (
                  <tr key={`skel-${i}`} className="border-t border-border">
                    {columns.map((c, j) => (
                      <td key={c.key} className={clsx('px-3 sm:px-4 py-3.5', alignClass(c.align))}>
                        <div
                          className="skeleton h-3"
                          style={{ width: `${50 + ((i * 7 + j * 11) % 40)}%` }}
                        />
                      </td>
                    ))}
                  </tr>
                ))
              : rows.map((row, i) => (
                  <tr
                    key={row.id ?? i}
                    onClick={onRowClick ? () => onRowClick(row) : undefined}
                    style={{ animationDelay: `${Math.min(i, STAGGER_MAX) * 25}ms` }}
                    className={clsx(
                      'border-t border-border transition animate-fade-in-up',
                      onRowClick ? 'cursor-pointer hover:bg-hover' : 'hover:bg-hover',
                    )}
                  >
                    {columns.map((c) => (
                      <td
                        key={c.key}
                        className={clsx(
                          'px-3 sm:px-4 py-3 text-ink align-middle',
                          alignClass(c.align),
                          c.className,
                        )}
                      >
                        {renderCell(c, row)}
                      </td>
                    ))}
                  </tr>
                ))}
          </tbody>
        </table>
      </div>

      {/* ── MOBILE CARDS — hidden at sm+ ─────────────────────────────── */}
      <div className="sm:hidden">
        {loading ? (
          <>
            {Array.from({ length: 3 }).map((_, i) => (
              <div
                key={`m-skel-${i}`}
                className={clsx('px-4 py-3.5 space-y-2.5', i > 0 && 'border-t border-border')}
              >
                <div className="skeleton h-4 w-2/3" />
                <div className="skeleton h-3 w-1/2" />
                <div className="skeleton h-3 w-2/5" />
              </div>
            ))}
          </>
        ) : (
          rows.map((row, i) => (
            <div
              key={row.id ?? i}
              onClick={onRowClick ? () => onRowClick(row) : undefined}
              style={{ animationDelay: `${Math.min(i, STAGGER_MAX) * 25}ms` }}
              className={clsx(
                'px-4 py-3.5 animate-fade-in-up',
                i > 0 && 'border-t border-border',
                onRowClick && 'cursor-pointer active:bg-hover',
              )}
            >
              {/* Primary field — card title */}
              {primaryCol && (
                <div className="text-sm font-medium text-ink mb-2 min-w-0">
                  {renderCell(primaryCol, row)}
                </div>
              )}
              {/* Secondary fields — label : value rows */}
              {restCols.length > 0 && (
                <dl className="space-y-1">
                  {restCols.map((c) => (
                    <div key={c.key} className="flex items-start justify-between gap-3">
                      <dt className="text-xs text-muted shrink-0">{c.header}</dt>
                      <dd
                        className={clsx(
                          'text-xs text-ink min-w-0',
                          c.align === 'right' ? 'text-right' : 'text-right',
                        )}
                      >
                        {renderCell(c, row)}
                      </dd>
                    </div>
                  ))}
                </dl>
              )}
            </div>
          ))
        )}
      </div>

      {/* Empty state — visible on all sizes */}
      {isEmpty && (
        <div className="px-4 py-12 text-center text-muted text-sm animate-fade-in-up">
          {empty ?? <span className="italic text-muted">No records yet</span>}
        </div>
      )}
    </div>
  );
}
