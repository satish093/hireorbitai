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

export function DataTable<T extends { id?: string }>({ columns, rows, empty, loading, onRowClick }: Props<T>) {
  const alignClass = (a?: Column<T>['align']) =>
    a === 'right' ? 'text-right' : a === 'center' ? 'text-center' : 'text-left';

  return (
    <div className="bg-white rounded-xl border border-slate-200 overflow-hidden animate-fade-in">
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-[10px] font-semibold tracking-widest text-slate-500 uppercase">
            <tr>
              {columns.map((c) => (
                <th key={c.key} className={clsx('px-4 py-2.5', alignClass(c.align), c.className)}>
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
                <tr key={`skel-${i}`} className="border-t border-slate-100">
                  {columns.map((c, j) => (
                    <td key={c.key} className={clsx('px-4 py-3.5', alignClass(c.align))}>
                      <div className="skeleton h-3" style={{ width: `${50 + ((i * 7 + j * 11) % 40)}%` }} />
                    </td>
                  ))}
                </tr>
              ))
            ) : rows.length === 0 ? (
              <tr>
                <td colSpan={columns.length} className="px-4 py-12 text-center text-slate-500 text-sm animate-fade-in-up">
                  {empty ?? <span className="italic text-slate-400">No records yet</span>}
                </td>
              </tr>
            ) : (
              rows.map((row, i) => (
                <tr
                  key={row.id ?? i}
                  onClick={onRowClick ? () => onRowClick(row) : undefined}
                  style={{ animationDelay: `${Math.min(i, STAGGER_MAX) * 25}ms` }}
                  className={clsx(
                    'border-t border-slate-100 transition animate-fade-in-up',
                    onRowClick ? 'cursor-pointer hover:bg-slate-50' : 'hover:bg-slate-50/50',
                  )}
                >
                  {columns.map((c) => (
                    <td key={c.key} className={clsx('px-4 py-3 text-slate-700', alignClass(c.align), c.className)}>
                      {c.render ? c.render(row) : (row as any)[c.key] ?? <span className="text-slate-400">—</span>}
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
