import { ReactNode } from 'react';
import clsx from 'clsx';

export interface Column<T> {
  key: string;
  header: string;
  render?: (row: T) => ReactNode;
  className?: string;
  /** Right-align numeric columns. */
  align?: 'left' | 'right' | 'center';
}

interface Props<T> {
  columns: Column<T>[];
  rows: T[];
  empty?: ReactNode;
  loading?: boolean;
  onRowClick?: (row: T) => void;
}

/** Cap the row-stagger delay so a 500-row table doesn't stutter for seconds. */
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

  return (
    <div className="bg-surface rounded-xl border border-border overflow-hidden animate-fade-in">
      {/* `overflow-x-auto` scrolls the table on narrow viewports instead of
          squashing every column. A min-width keeps the columns from collapsing
          before the scroller engages. */}
      <div className="overflow-x-auto">
        <table className="w-full text-sm min-w-[560px]">
          <thead className="bg-hover text-[10px] font-semibold tracking-widest text-muted uppercase">
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
            {loading ? (
              // Animated skeleton rows give the loading state real presence
              // instead of a single italic "Loading…" line.
              Array.from({ length: 5 }).map((_, i) => (
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
            ) : rows.length === 0 ? (
              <tr>
                <td
                  colSpan={columns.length}
                  className="px-4 py-12 text-center text-muted text-sm animate-fade-in-up"
                >
                  {empty ?? <span className="italic text-muted">No records yet</span>}
                </td>
              </tr>
            ) : (
              rows.map((row, i) => (
                <tr
                  key={row.id ?? i}
                  onClick={onRowClick ? () => onRowClick(row) : undefined}
                  style={{ animationDelay: `${Math.min(i, STAGGER_MAX) * 25}ms` }}
                  className={clsx(
                    'border-t border-border transition animate-fade-in-up',
                    onRowClick ? 'cursor-pointer hover:bg-hover' : 'hover:bg-slate-50/50',
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
                      {c.render
                        ? c.render(row)
                        : ((row as any)[c.key] ?? <span className="text-muted">—</span>)}
                    </td>
                  ))}
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
