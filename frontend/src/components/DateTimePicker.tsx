import { useMemo, useRef, useState, useEffect } from 'react';
import { createPortal } from 'react-dom';
import clsx from 'clsx';
import { IconCalendar, IconReminder } from './Icons';
import { useAnchoredPosition } from './ui/useAnchoredPosition';

/**
 * Clean date + time picker. Replaces the browser-native `datetime-local`
 * input which renders a clunky vertical scrolling time column on Chrome.
 *
 * Composes of:
 *   - native `type="date"` for the day (well-supported, keyboard-friendly)
 *   - a styled time dropdown with 15-minute increments
 *   - quick presets ("Today 5pm", "Tomorrow 9am", "Next week 9am", "+1 hour")
 *
 * Emits the same ISO-local string the existing `datetime-local` consumers
 * expect (YYYY-MM-DDTHH:mm), so swapping it in is a drop-in change.
 */

interface Props {
  label?: string;
  value: string; // 'YYYY-MM-DDTHH:mm' (datetime-local format)
  onChange: (next: string) => void;
  required?: boolean;
  /** Optional helper text below the inputs. */
  hint?: string;
  /** Hide the quick-preset buttons (keeps only date+time fields). */
  hidePresets?: boolean;
}

const QUARTER_HOURS: string[] = (() => {
  const out: string[] = [];
  for (let h = 0; h < 24; h++) {
    for (let m = 0; m < 60; m += 15) {
      out.push(`${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`);
    }
  }
  return out;
})();

function splitISO(value: string): { date: string; time: string } {
  if (!value) {
    // Default to today @ 09:00.
    const now = new Date();
    const date = now.toISOString().slice(0, 10);
    return { date, time: '09:00' };
  }
  const [d, t] = value.split('T');
  return { date: d ?? '', time: (t ?? '').slice(0, 5) };
}

function combine(date: string, time: string): string {
  if (!date) return '';
  return `${date}T${time || '09:00'}`;
}

function pretty12hr(time: string): string {
  const [h, m] = time.split(':').map(Number);
  const period = (h ?? 0) >= 12 ? 'PM' : 'AM';
  const hour12 = (h ?? 0) % 12 || 12;
  return `${hour12}:${String(m ?? 0).padStart(2, '0')} ${period}`;
}

function isoLocalToday(hour: number, minute: number = 0, daysAhead: number = 0): string {
  const d = new Date();
  d.setDate(d.getDate() + daysAhead);
  d.setHours(hour, minute, 0, 0);
  // Local-ISO truncated to minute. We can't use toISOString (UTC) for a
  // datetime-local input, so build it manually.
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  const hh = String(d.getHours()).padStart(2, '0');
  const mi = String(d.getMinutes()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}T${hh}:${mi}`;
}

export function DateTimePicker({ label, value, onChange, required, hint, hidePresets }: Props) {
  const { date, time } = useMemo(() => splitISO(value), [value]);
  const [timeOpen, setTimeOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);
  // Time dropdown is portaled to <body> so it isn't clipped when this picker
  // sits inside a modal/scroll container.
  const { triggerRef, panelRef, style } = useAnchoredPosition(timeOpen, { align: 'right' });

  // Close the time popover on outside click or Escape. The dropdown is
  // portaled, so it lives outside wrapRef — spare both the picker and the
  // portaled panel. Listeners exist only while open (mirrors Popover).
  useEffect(() => {
    if (!timeOpen) return;
    function onDocClick(e: MouseEvent) {
      const target = e.target as Node;
      if (wrapRef.current?.contains(target)) return;
      if (panelRef.current?.contains(target)) return;
      setTimeOpen(false);
    }
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') setTimeOpen(false);
    }
    document.addEventListener('mousedown', onDocClick);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('mousedown', onDocClick);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [timeOpen, panelRef]);

  // Group the time slots by hour, with a "highlight" for the active value.
  return (
    <div className="space-y-1.5" ref={wrapRef}>
      {label && (
        <label className="text-sm font-medium text-ink">
          {label}
          {required && <span className="text-rose-500 ml-0.5">*</span>}
        </label>
      )}

      <div className="flex items-stretch gap-2">
        {/* Date field */}
        <div className="relative flex-1 min-w-0">
          <IconCalendar
            size={15}
            className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted pointer-events-none"
          />
          <input
            type="date"
            value={date}
            onChange={(e) => onChange(combine(e.target.value, time))}
            required={required}
            className="w-full text-sm bg-surface border border-border rounded-lg pl-8 pr-2 py-2 focus:outline-none focus:ring-2 focus:ring-brand-500/40 focus:border-brand-500/50"
          />
        </div>

        {/* Time field (button → custom popover so the UI is identical across browsers) */}
        <div className="relative" ref={triggerRef}>
          <button
            type="button"
            onClick={() => setTimeOpen((v) => !v)}
            className="text-sm bg-surface border border-border rounded-lg pl-8 pr-3 py-2 min-w-[120px] text-left hover:bg-hover focus:outline-none focus:ring-2 focus:ring-brand-500/40 relative"
          >
            <IconReminder
              size={15}
              className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted"
            />
            <span className="tabular-nums">{pretty12hr(time)}</span>
          </button>
          {timeOpen &&
            createPortal(
              <div
                ref={panelRef}
                style={style}
                className="z-50 bg-surface border border-border rounded-xl shadow-lg w-44 max-h-72 overflow-y-auto py-1.5"
              >
                {QUARTER_HOURS.map((t) => (
                  <button
                    key={t}
                    type="button"
                    onClick={() => {
                      onChange(combine(date, t));
                      setTimeOpen(false);
                    }}
                    className={clsx(
                      'w-full px-3 py-1.5 text-sm text-left hover:bg-brand-50 hover:text-brand-700 tabular-nums',
                      t === time && 'bg-brand-50 text-brand-700 font-semibold',
                    )}
                  >
                    {pretty12hr(t)}
                  </button>
                ))}
              </div>,
              document.body,
            )}
        </div>
      </div>

      {!hidePresets && (
        <div className="flex flex-wrap gap-1.5 pt-0.5">
          <Preset
            label="In 1 hour"
            onClick={() => {
              const d = new Date();
              d.setHours(d.getHours() + 1, 0, 0, 0);
              onChange(isoLocalFromDate(d));
            }}
          />
          <Preset label="Today 5 PM" onClick={() => onChange(isoLocalToday(17, 0))} />
          <Preset label="Tomorrow 9 AM" onClick={() => onChange(isoLocalToday(9, 0, 1))} />
          <Preset label="Next week 9 AM" onClick={() => onChange(isoLocalToday(9, 0, 7))} />
        </div>
      )}

      {hint && <p className="text-xs text-muted">{hint}</p>}
    </div>
  );
}

function Preset({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="text-[11px] font-medium px-2 py-0.5 rounded-full bg-hover text-ink hover:bg-brand-50 hover:text-brand-700 border border-border"
    >
      {label}
    </button>
  );
}

function isoLocalFromDate(d: Date): string {
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  const hh = String(d.getHours()).padStart(2, '0');
  const mi = String(d.getMinutes()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}T${hh}:${mi}`;
}
