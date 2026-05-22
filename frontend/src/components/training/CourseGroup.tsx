import { useState, type ReactNode } from 'react';
import clsx from 'clsx';

const STORE = 'ho-training-groups';

function loadCollapsed(key: string, fallback: boolean): boolean {
  try {
    const raw = localStorage.getItem(STORE);
    if (raw) {
      const map = JSON.parse(raw) as Record<string, boolean>;
      if (key in map) return map[key]!;
    }
  } catch {
    /* ignore */
  }
  return fallback;
}

function persist(key: string, collapsed: boolean) {
  try {
    const raw = localStorage.getItem(STORE);
    const map = raw ? (JSON.parse(raw) as Record<string, boolean>) : {};
    map[key] = collapsed;
    localStorage.setItem(STORE, JSON.stringify(map));
  } catch {
    /* ignore */
  }
}

/**
 * Collapsible course group with chevron disclosure. Collapse state persists per
 * group key in localStorage so "Completed" stays folded across visits.
 */
export function CourseGroup({
  groupKey,
  label,
  count,
  defaultCollapsed = false,
  children,
}: {
  groupKey: string;
  label: string;
  count: number;
  defaultCollapsed?: boolean;
  children: ReactNode;
}) {
  const [collapsed, setCollapsed] = useState(() => loadCollapsed(groupKey, defaultCollapsed));
  const toggle = () => {
    setCollapsed((c) => {
      persist(groupKey, !c);
      return !c;
    });
  };

  return (
    <section>
      <button
        onClick={toggle}
        aria-expanded={!collapsed}
        className="flex items-center gap-2 w-full text-left py-2 group"
      >
        <span
          className={clsx(
            'text-faint transition-transform text-xs',
            collapsed ? '-rotate-90' : 'rotate-0',
          )}
          aria-hidden="true"
        >
          ▼
        </span>
        <span className="text-sm font-semibold text-ink">{label}</span>
        <span className="text-[11px] font-mono text-muted bg-bg-sunken rounded px-1.5">
          {count}
        </span>
      </button>
      {!collapsed && count > 0 && <div className="space-y-2 pb-2">{children}</div>}
    </section>
  );
}
