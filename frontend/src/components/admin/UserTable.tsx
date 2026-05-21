import { ReactNode } from 'react';
import clsx from 'clsx';
import { Avatar } from '../TaskBits';
import { Button } from '../Button';
import { Skeleton } from '../Skeleton';
import { EmptyState } from '../EmptyState';
import { Check, GroupBadge, RoleChip, StatusPill } from './UserBits';
import {
  type AdminUserRow,
  type ColumnKey,
  type GroupLite,
  isOnline,
  relativeTime,
  statusOf,
} from './types';

type SortKey = 'full_name' | 'last_seen_at' | 'created_at';

function SortHeader({
  label,
  k,
  sort,
  order,
  onSort,
  className,
}: {
  label: string;
  k: SortKey;
  sort: string;
  order: 'asc' | 'desc';
  onSort: (k: SortKey) => void;
  className?: string;
}) {
  const active = sort === k;
  return (
    <th className={clsx('text-left font-medium px-3 py-2', className)}>
      <button
        onClick={() => onSort(k)}
        className={clsx(
          'inline-flex items-center gap-1 hover:text-ink transition-colors',
          active ? 'text-ink' : 'text-muted',
        )}
      >
        {label}
        <span className="text-[9px] text-faint">
          {active ? (order === 'asc' ? '▲' : '▼') : '⇅'}
        </span>
      </button>
    </th>
  );
}

/**
 * The admin user table. Selection (checkbox col + header select-all), sortable
 * headers, optional columns via the Columns picker, click-row-to-open. The
 * overflow menu per row is injected by the page via `rowMenu` so confirm-modal
 * wiring stays in one place.
 */
export function UserTable({
  rows,
  groupsById,
  columns,
  loading,
  selectedIds,
  onToggleSelect,
  onToggleAll,
  openId,
  onOpen,
  sort,
  order,
  onSort,
  rowMenu,
}: {
  rows: AdminUserRow[];
  groupsById: Record<string, GroupLite>;
  columns: Record<ColumnKey, boolean>;
  loading?: boolean;
  selectedIds: Set<string>;
  onToggleSelect: (id: string) => void;
  onToggleAll: () => void;
  openId: string | null;
  onOpen: (id: string) => void;
  sort: string;
  order: 'asc' | 'desc';
  onSort: (k: SortKey) => void;
  rowMenu?: (u: AdminUserRow) => ReactNode;
}) {
  const allOnPage = rows.length > 0 && rows.every((r) => selectedIds.has(r.id));
  const someOnPage = rows.some((r) => selectedIds.has(r.id));
  const colCount =
    3 +
    (columns.role ? 1 : 0) +
    (columns.group ? 1 : 0) +
    (columns.last_seen ? 1 : 0) +
    (columns.sessions ? 1 : 0) +
    (columns.joined ? 1 : 0);

  return (
    <div className="bg-surface border border-border rounded-xl overflow-hidden">
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border bg-bg-sunken/40 text-xs">
              <th className="w-10 px-3 py-2">
                <Check
                  checked={allOnPage}
                  indeterminate={someOnPage}
                  onChange={onToggleAll}
                  label="Select all on page"
                />
              </th>
              <SortHeader label="User" k="full_name" sort={sort} order={order} onSort={onSort} />
              {columns.role && <th className="text-left font-medium text-muted px-3 py-2">Role</th>}
              {columns.group && (
                <th className="text-left font-medium text-muted px-3 py-2">Group</th>
              )}
              <th className="text-left font-medium text-muted px-3 py-2">Status</th>
              {columns.last_seen && (
                <SortHeader
                  label="Last seen"
                  k="last_seen_at"
                  sort={sort}
                  order={order}
                  onSort={onSort}
                />
              )}
              {columns.sessions && (
                <th className="text-right font-medium text-muted px-3 py-2">Sessions</th>
              )}
              {columns.joined && (
                <SortHeader
                  label="Joined"
                  k="created_at"
                  sort={sort}
                  order={order}
                  onSort={onSort}
                />
              )}
              <th className="w-10 px-2 py-2" />
            </tr>
          </thead>
          <tbody>
            {loading ? (
              Array.from({ length: 6 }).map((_, i) => (
                <tr key={i} className="border-b border-border">
                  <td colSpan={colCount} className="px-3 py-3">
                    <Skeleton className="h-6 w-full" />
                  </td>
                </tr>
              ))
            ) : rows.length === 0 ? (
              <tr>
                <td colSpan={colCount} className="p-0">
                  <EmptyState
                    compact
                    icon="🔍"
                    title="No users match these filters"
                    description="Try clearing a filter or switching segments."
                  />
                </td>
              </tr>
            ) : (
              rows.map((u) => {
                const s = statusOf(u);
                const selected = selectedIds.has(u.id);
                const open = openId === u.id;
                return (
                  <tr
                    key={u.id}
                    onClick={() => onOpen(u.id)}
                    className={clsx(
                      'border-b border-border cursor-pointer transition-colors',
                      open ? 'bg-accent-soft/60' : selected ? 'bg-hover' : 'hover:bg-hover',
                    )}
                  >
                    <td className="px-3 py-2.5" onClick={(e) => e.stopPropagation()}>
                      <Check
                        checked={selected}
                        onChange={() => onToggleSelect(u.id)}
                        label={`Select ${u.email}`}
                      />
                    </td>
                    <td className="px-3 py-2.5">
                      <div className="flex items-center gap-2.5 min-w-0">
                        <div className="relative shrink-0">
                          <Avatar name={u.full_name} email={u.email} size={30} />
                          {isOnline(u) && (
                            <span
                              className="absolute -bottom-0.5 -right-0.5 w-2.5 h-2.5 rounded-full bg-success ring-2 ring-surface"
                              title="Online now"
                            />
                          )}
                        </div>
                        <div className="leading-tight min-w-0">
                          <div className="text-sm font-medium text-ink truncate">
                            {u.full_name ?? u.email}
                          </div>
                          <div className="text-[11px] text-muted font-mono truncate">{u.email}</div>
                        </div>
                      </div>
                    </td>
                    {columns.role && (
                      <td className="px-3 py-2.5">
                        <RoleChip role={u.role} />
                      </td>
                    )}
                    {columns.group && (
                      <td className="px-3 py-2.5">
                        <GroupBadge group={u.group_id ? groupsById[u.group_id] : null} />
                      </td>
                    )}
                    <td className="px-3 py-2.5">
                      <StatusPill status={s} reason={u.status_reason} />
                    </td>
                    {columns.last_seen && (
                      <td className="px-3 py-2.5">
                        <span
                          className="text-xs text-ink-2 font-mono"
                          title={
                            u.last_seen_at ? new Date(u.last_seen_at).toLocaleString() : 'Never'
                          }
                        >
                          {relativeTime(u.last_seen_at)}
                        </span>
                      </td>
                    )}
                    {columns.sessions && (
                      <td className="px-3 py-2.5 text-right">
                        <span className="text-xs tabular-nums text-ink-2">
                          {u.session_count ?? 0}
                        </span>
                      </td>
                    )}
                    {columns.joined && (
                      <td className="px-3 py-2.5">
                        <span className="text-xs text-muted">
                          {new Date(u.created_at).toLocaleDateString()}
                        </span>
                      </td>
                    )}
                    <td className="px-2 py-2.5 text-right" onClick={(e) => e.stopPropagation()}>
                      {rowMenu?.(u)}
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

/** Prev/next pager shown under the table when there's more than one page. */
export function Pager({
  page,
  totalPages,
  onPage,
}: {
  page: number;
  totalPages: number;
  onPage: (p: number) => void;
}) {
  if (totalPages <= 1) return null;
  return (
    <div className="flex items-center justify-between mt-3 text-sm">
      <span className="text-muted">
        Page {page} of {totalPages}
      </span>
      <div className="flex gap-2">
        <Button size="sm" variant="secondary" disabled={page <= 1} onClick={() => onPage(page - 1)}>
          ‹ Prev
        </Button>
        <Button
          size="sm"
          variant="secondary"
          disabled={page >= totalPages}
          onClick={() => onPage(page + 1)}
        >
          Next ›
        </Button>
      </div>
    </div>
  );
}
