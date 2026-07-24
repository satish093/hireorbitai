import { useState, useCallback } from 'react';
import { Button } from '../Button';
import { Popover } from '../ui/Popover';
import type { UrgentItem } from './useUrgentItems';

// ---------------------------------------------------------------------------
// localStorage helpers
// ---------------------------------------------------------------------------

const STORAGE_KEY = 'ho-urgent-dismissed';

type DismissedMap = Record<string, string>; // { [id]: 'YYYY-MM-DD' }

function todayStr(): string {
  return new Date().toISOString().slice(0, 10);
}

function readDismissed(): DismissedMap {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as unknown;
    if (parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return parsed as DismissedMap;
    }
  } catch {
    // corrupted — start fresh
  }
  return {};
}

function writeDismissed(map: DismissedMap): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(map));
  } catch {
    // storage full / private mode — ignore
  }
}

// ---------------------------------------------------------------------------
// Severity dot
// ---------------------------------------------------------------------------

const DOT_COLOR: Record<UrgentItem['severity'], string> = {
  critical: 'bg-danger',
  warning: 'bg-warn',
  info: 'bg-accent',
};

function SeverityDot({ severity }: { severity: UrgentItem['severity'] }) {
  return (
    <span className={`shrink-0 w-1.5 h-1.5 rounded-full ${DOT_COLOR[severity]}`} aria-hidden />
  );
}

// ---------------------------------------------------------------------------
// Dismiss icon (×)
// ---------------------------------------------------------------------------

function CloseIcon() {
  return (
    <svg
      viewBox="0 0 12 12"
      width="12"
      height="12"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.75"
      strokeLinecap="round"
      aria-hidden
    >
      <line x1="1" y1="1" x2="11" y2="11" />
      <line x1="11" y1="1" x2="1" y2="11" />
    </svg>
  );
}

// ---------------------------------------------------------------------------
// Single row
// ---------------------------------------------------------------------------

function ItemRow({ item, onDismiss }: { item: UrgentItem; onDismiss: (id: string) => void }) {
  return (
    <div className="flex items-center gap-3 px-4 py-2.5">
      <SeverityDot severity={item.severity} />
      <span className="flex-1 text-[13px] text-ink-2 leading-snug">{item.body}</span>
      <Button variant="ghost" size="sm" onClick={item.action.onClick}>
        {item.action.label}
      </Button>
      <Button
        variant="ghost"
        size="sm"
        iconOnly
        aria-label="Dismiss"
        leftIcon={<CloseIcon />}
        onClick={() => onDismiss(item.id)}
      />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

const VISIBLE_LIMIT = 3;

export function UrgentRibbon({ items }: { items: UrgentItem[] }): JSX.Element | null {
  const [dismissed, setDismissed] = useState<DismissedMap>(readDismissed);

  const today = todayStr();

  const visible = items.filter((item) => dismissed[item.id] !== today);

  const dismiss = useCallback((id: string) => {
    setDismissed((prev) => {
      const next = { ...prev, [id]: todayStr() };
      writeDismissed(next);
      return next;
    });
  }, []);

  if (visible.length === 0) return null;

  const shown = visible.slice(0, VISIBLE_LIMIT);
  const overflow = visible.slice(VISIBLE_LIMIT);

  return (
    <div className="rounded-xl border border-border bg-surface overflow-hidden divide-y divide-border">
      {shown.map((item) => (
        <ItemRow key={item.id} item={item} onDismiss={dismiss} />
      ))}

      {overflow.length > 0 && (
        <div className="flex items-center gap-3 px-4 py-2.5">
          {/* spacer to align with item rows */}
          <span className="w-1.5 h-1.5 shrink-0" aria-hidden />
          <span className="flex-1 text-[13px] text-muted">
            +{overflow.length} more alert{overflow.length === 1 ? '' : 's'}
          </span>
          <Popover
            align="right"
            panelClassName="min-w-[320px]"
            button={(open) => (
              <Button variant="ghost" size="sm">
                {open ? 'Hide' : 'Show all'}
              </Button>
            )}
          >
            {(close) => (
              <div className="divide-y divide-border -m-2">
                {overflow.map((item) => (
                  <div key={item.id} onClick={close} className="contents">
                    <ItemRow item={item} onDismiss={dismiss} />
                  </div>
                ))}
              </div>
            )}
          </Popover>
        </div>
      )}
    </div>
  );
}
