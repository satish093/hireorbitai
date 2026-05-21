import { useState } from 'react';
import { CALENDARS, type CalendarKey } from './types';

const STORE = 'ho-calendars';

function load(): Set<CalendarKey> {
  try {
    const raw = localStorage.getItem(STORE);
    if (raw) return new Set(JSON.parse(raw) as CalendarKey[]);
  } catch {
    /* ignore */
  }
  return new Set(CALENDARS.map((c) => c.key));
}

/** Visible-calendar set persisted to localStorage; filters the active view. */
export function useVisibleCalendars() {
  const [visible, setVisible] = useState<Set<CalendarKey>>(load);
  function toggle(k: CalendarKey) {
    setVisible((prev) => {
      const next = new Set(prev);
      if (next.has(k)) next.delete(k);
      else next.add(k);
      try {
        localStorage.setItem(STORE, JSON.stringify(Array.from(next)));
      } catch {
        /* ignore */
      }
      return next;
    });
  }
  return { visible, toggle };
}
