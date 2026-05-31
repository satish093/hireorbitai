import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useNavigate } from 'react-router-dom';
import clsx from 'clsx';
import { useAuth } from '../context/AuthContext';
import { useFeatureFlags } from '../hooks/useFeatureFlags';
import { filterNavSections, type Item } from './Sidebar';
import { IconSearch } from './Icons';

const OPEN_EVENT = 'hireorbit:open-command-palette';

/**
 * Open the global command palette from anywhere (e.g. the Header search box).
 * Decoupled via a window event so callers don't need a shared context.
 */
export function openCommandPalette() {
  window.dispatchEvent(new Event(OPEN_EVENT));
}

interface Destination {
  item: Item;
  section: string;
}

/**
 * Global ⌘K / Ctrl-K command palette — a keyboard-first "jump to" navigator.
 *
 * Mounted once at the app root so it is reachable from every page. It searches
 * the SAME role/capability/flag-gated nav model the Sidebar renders (via the
 * shared `filterNavSections`), so it never offers a destination the user can't
 * open. Navigation-only for now; entity search (consultants, jobs, …) arrives
 * with the data-rich pages in later phases.
 *
 * Owns the ⌘K shortcut on the capture phase + `stopPropagation` so it cleanly
 * preempts page-level handlers (e.g. the Jobs AI-search focus shortcut).
 */
export function CommandPalette() {
  const { profile } = useAuth();
  const { flags } = useFeatureFlags();
  const navigate = useNavigate();

  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);

  const inputRef = useRef<HTMLInputElement>(null);
  const prevFocus = useRef<HTMLElement | null>(null);

  // Flatten the gated nav model into a searchable destination list.
  const destinations = useMemo<Destination[]>(
    () =>
      filterNavSections(profile?.role, profile, flags).flatMap((s) =>
        s.items.map((item) => ({ item, section: s.heading })),
      ),
    [profile, flags],
  );

  const results = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return destinations;
    return destinations.filter(
      (d) => d.item.label.toLowerCase().includes(q) || d.section.toLowerCase().includes(q),
    );
  }, [destinations, query]);

  // ⌘K owner (capture phase preempts page-level shortcuts) + custom open event.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        e.stopPropagation();
        setOpen((o) => !o);
      }
    }
    function onOpen() {
      setOpen(true);
    }
    window.addEventListener('keydown', onKey, true);
    window.addEventListener(OPEN_EVENT, onOpen);
    return () => {
      window.removeEventListener('keydown', onKey, true);
      window.removeEventListener(OPEN_EVENT, onOpen);
    };
  }, []);

  // On open: reset, lock body scroll, focus the input, remember prior focus.
  // On close: restore focus to whatever opened it.
  useEffect(() => {
    if (!open) {
      prevFocus.current?.focus?.();
      return;
    }
    prevFocus.current = (document.activeElement as HTMLElement) ?? null;
    setQuery('');
    setActive(0);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const t = setTimeout(() => inputRef.current?.focus(), 0);
    return () => {
      clearTimeout(t);
      document.body.style.overflow = prevOverflow;
    };
  }, [open]);

  // Keep the highlight in range as results shrink, and scroll it into view.
  useEffect(() => {
    setActive((a) => Math.min(a, Math.max(0, results.length - 1)));
  }, [results.length]);
  useEffect(() => {
    if (open) document.getElementById(`cmdk-opt-${active}`)?.scrollIntoView({ block: 'nearest' });
  }, [active, open]);

  if (!open || !profile) return null;

  const go = (to: string) => {
    setOpen(false);
    navigate(to);
  };

  return createPortal(
    <div
      className="fixed inset-0 z-[70] flex items-start justify-center p-4 sm:pt-[12vh] bg-slate-900/40 backdrop-blur-sm animate-fade-in"
      onClick={() => setOpen(false)}
      role="presentation"
    >
      <div
        className="w-full max-w-lg rounded-2xl border border-border shadow-2xl overflow-hidden animate-scale-in"
        style={{ background: 'var(--bg-elev)' }}
        role="dialog"
        aria-modal="true"
        aria-label="Command palette"
        onClick={(e) => e.stopPropagation()}
        onKeyDown={(e) => {
          if (e.key === 'Escape') {
            e.preventDefault();
            setOpen(false);
          } else if (e.key === 'Tab') {
            // Trap focus — arrows handle list navigation, so there is nowhere
            // for Tab to go inside the palette.
            e.preventDefault();
          } else if (e.key === 'ArrowDown') {
            e.preventDefault();
            setActive((a) => Math.min(results.length - 1, a + 1));
          } else if (e.key === 'ArrowUp') {
            e.preventDefault();
            setActive((a) => Math.max(0, a - 1));
          } else if (e.key === 'Enter') {
            e.preventDefault();
            const r = results[active];
            if (r) go(r.item.to);
          }
        }}
      >
        {/* Search input */}
        <div className="flex items-center gap-2.5 px-4 h-12 border-b border-border">
          <IconSearch size={16} className="text-muted shrink-0" />
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setActive(0);
            }}
            placeholder="Jump to…"
            className="flex-1 bg-transparent outline-none text-ink placeholder:text-muted"
            style={{ fontSize: 16 }}
            role="combobox"
            aria-expanded="true"
            aria-controls="cmdk-list"
            aria-activedescendant={results[active] ? `cmdk-opt-${active}` : undefined}
            aria-label="Search navigation"
          />
          <kbd className="hidden sm:block text-[10.5px] font-semibold px-1 py-px rounded border border-border text-faint">
            ESC
          </kbd>
        </div>

        {/* Results */}
        <div
          id="cmdk-list"
          role="listbox"
          aria-label="Navigation destinations"
          className="max-h-[min(60vh,380px)] overflow-y-auto py-1.5"
        >
          {results.length === 0 ? (
            <div className="px-4 py-8 text-center text-sm text-muted">
              No matches for “{query.trim()}”.
            </div>
          ) : (
            results.map((r, i) => {
              const Icon = r.item.icon;
              const isActive = i === active;
              return (
                <button
                  key={r.item.to}
                  id={`cmdk-opt-${i}`}
                  role="option"
                  aria-selected={isActive}
                  type="button"
                  onMouseMove={() => setActive(i)}
                  onClick={() => go(r.item.to)}
                  className={clsx(
                    'w-full flex items-center gap-2.5 px-4 py-2 text-left text-[13.5px]',
                    isActive ? 'bg-brand-soft text-brand-on-soft' : 'text-ink-2 hover:bg-hover',
                  )}
                >
                  <Icon
                    size={16}
                    className={clsx('shrink-0', isActive ? 'text-brand-on-soft' : 'text-muted')}
                  />
                  <span className="flex-1 truncate">{r.item.label}</span>
                  <span
                    className={clsx(
                      'text-[10px] uppercase tracking-wider shrink-0',
                      isActive ? 'text-brand-on-soft/70' : 'text-faint',
                    )}
                  >
                    {r.section}
                  </span>
                </button>
              );
            })
          )}
        </div>

        {/* Screen-reader result count */}
        <div aria-live="polite" className="sr-only">
          {results.length} result{results.length === 1 ? '' : 's'}
        </div>
      </div>
    </div>,
    document.body,
  );
}
