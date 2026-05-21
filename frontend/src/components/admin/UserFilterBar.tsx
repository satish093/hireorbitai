import { RefObject } from 'react';
import clsx from 'clsx';
import { Popover } from '../ui/Popover';
import { ALL_ROLES, Role, ROLE_LABEL } from '../../types';
import {
  type ColumnKey,
  type GroupLite,
  type LastSeenFilter,
  LAST_SEEN_OPTIONS,
  OPTIONAL_COLUMNS,
} from './types';

export interface UserFilters {
  q: string;
  role: Role | '';
  group_id: string;
  last_seen: LastSeenFilter;
}

/** A filter chip that opens a single-select dropdown. Shows the active value
 *  inline; tinted accent when a non-default value is set. */
function ChipSelect<T extends string>({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: T;
  options: { value: T; label: string }[];
  onChange: (v: T) => void;
}) {
  const active = value !== ('' as T);
  const current = options.find((o) => o.value === value);
  return (
    <Popover
      button={(open) => (
        <button
          className={clsx(
            'inline-flex items-center gap-1.5 h-9 px-3 rounded-lg border text-sm transition-colors press',
            active
              ? 'bg-accent-soft border-accent/40 text-accent'
              : 'bg-surface border-border text-ink-2 hover:bg-hover',
            open && 'ring-2 ring-accent/30',
          )}
        >
          <span className="text-muted">{label}</span>
          {active && <span className="font-medium">{current?.label}</span>}
          <span aria-hidden="true" className="text-faint">
            ▾
          </span>
        </button>
      )}
    >
      {(close) => (
        <div className="min-w-[180px]">
          {options.map((o) => (
            <button
              key={o.value}
              onClick={() => {
                onChange(o.value);
                close();
              }}
              className={clsx(
                'block w-full text-left px-2.5 py-1.5 rounded-md text-sm hover:bg-hover',
                o.value === value ? 'text-accent font-medium' : 'text-ink',
              )}
            >
              {o.label}
            </button>
          ))}
        </div>
      )}
    </Popover>
  );
}

/**
 * Default toolbar above the table: search (focusable via `/`), Role / Group /
 * Last-seen filter chips, result count, and a Columns visibility picker.
 * Replaced by <UserBulkBar> when rows are selected.
 */
export function UserFilterBar({
  filters,
  onChange,
  groups,
  total,
  shown,
  loading,
  searchRef,
  columns,
  onToggleColumn,
  onReset,
}: {
  filters: UserFilters;
  onChange: (patch: Partial<UserFilters>) => void;
  groups: GroupLite[];
  total: number;
  shown: number;
  loading?: boolean;
  searchRef: RefObject<HTMLInputElement>;
  columns: Record<ColumnKey, boolean>;
  onToggleColumn: (key: ColumnKey) => void;
  onReset: () => void;
}) {
  const hasFilter = !!(filters.q || filters.role || filters.group_id || filters.last_seen);
  return (
    <div className="flex flex-wrap items-center gap-2 mb-3">
      {/* Search */}
      <div className="relative flex-1 min-w-[220px]">
        <span className="absolute left-3 top-1/2 -translate-y-1/2 text-faint text-sm" aria-hidden>
          ⌕
        </span>
        <input
          ref={searchRef}
          value={filters.q}
          onChange={(e) => onChange({ q: e.target.value })}
          placeholder="Search name or email…  (press /)"
          className="w-full h-9 pl-8 pr-3 rounded-lg border border-border bg-surface text-sm text-ink placeholder:text-faint focus:outline-none focus-visible:ring-2 focus-visible:ring-accent/40 focus-visible:border-accent"
        />
      </div>

      <ChipSelect
        label="Role"
        value={filters.role}
        onChange={(v) => onChange({ role: v })}
        options={[
          { value: '' as Role | '', label: 'All roles' },
          ...ALL_ROLES.map((r) => ({ value: r as Role | '', label: ROLE_LABEL[r] })),
        ]}
      />
      <ChipSelect
        label="Group"
        value={filters.group_id}
        onChange={(v) => onChange({ group_id: v })}
        options={[
          { value: '', label: 'All groups' },
          ...groups.map((g) => ({ value: g.id, label: g.name })),
        ]}
      />
      <ChipSelect
        label="Last seen"
        value={filters.last_seen}
        onChange={(v) => onChange({ last_seen: v })}
        options={LAST_SEEN_OPTIONS}
      />

      {hasFilter && (
        <button
          onClick={onReset}
          className="h-9 px-2.5 rounded-lg text-sm text-muted hover:text-ink hover:bg-hover press"
        >
          Reset
        </button>
      )}

      <div className="ml-auto flex items-center gap-2">
        <span className="text-xs text-muted tabular-nums">
          {loading ? 'Loading…' : `${shown} of ${total.toLocaleString()}`}
        </span>
        {/* Columns picker */}
        <Popover
          align="right"
          button={(open) => (
            <button
              className={clsx(
                'inline-flex items-center gap-1.5 h-9 px-3 rounded-lg border border-border bg-surface text-sm text-ink-2 hover:bg-hover press',
                open && 'ring-2 ring-accent/30',
              )}
            >
              Columns <span className="text-faint">▾</span>
            </button>
          )}
        >
          {() => (
            <div className="min-w-[180px]">
              {OPTIONAL_COLUMNS.map((c) => (
                <label
                  key={c.key}
                  className="flex items-center gap-2 px-2.5 py-1.5 rounded-md text-sm text-ink hover:bg-hover cursor-pointer"
                >
                  <input
                    type="checkbox"
                    checked={columns[c.key]}
                    onChange={() => onToggleColumn(c.key)}
                    className="accent-[color:var(--accent)]"
                  />
                  {c.label}
                </label>
              ))}
            </div>
          )}
        </Popover>
      </div>
    </div>
  );
}
