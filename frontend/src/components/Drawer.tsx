import { ReactNode, useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import clsx from 'clsx';

interface Props {
  open: boolean;
  onClose: () => void;
  title: string;
  description?: string;
  children: ReactNode;
  footer?: ReactNode;
  /** Panel width. Default 'md' = 460px (design spec). */
  size?: 'sm' | 'md' | 'lg';
}

const SIZE_CLASS: Record<NonNullable<Props['size']>, string> = {
  sm: 'max-w-sm', // ~384px
  md: 'max-w-[460px]',
  lg: 'max-w-2xl', // ~672px
};

// Same focusable selector as Modal.tsx so the focus-trap behaves identically.
const FOCUSABLE =
  'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';

/**
 * Right-side drawer panel — the design-system companion to Modal.
 *
 * Use this instead of Modal when you want to show record detail/edit while
 * keeping the list visible behind (the design spec: "move record detail/edit
 * to a right-side Drawer; keep centred Modal only for focused create/confirm").
 *
 * Same accessibility contract as Modal: portal to body (escapes any transformed
 * ancestor), focus trap, Escape key, body-scroll lock, focus restoration.
 */
export function Drawer({
  open,
  onClose,
  title,
  description,
  children,
  footer,
  size = 'md',
}: Props) {
  const panelRef = useRef<HTMLDivElement>(null);
  const previouslyFocused = useRef<HTMLElement | null>(null);

  // Keep onClose stable across renders inside the effect (same pattern as Modal).
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useEffect(() => {
    if (!open) return;

    previouslyFocused.current = (document.activeElement as HTMLElement) ?? null;

    // Move focus into the panel on open.
    const panel = panelRef.current;
    if (panel) {
      const first = panel.querySelector<HTMLElement>(FOCUSABLE);
      (first ?? panel).focus();
    }

    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onCloseRef.current();
        return;
      }
      if (e.key !== 'Tab') return;
      const node = panelRef.current;
      if (!node) return;
      const focusables = Array.from(node.querySelectorAll<HTMLElement>(FOCUSABLE)).filter(
        (el) => !el.hasAttribute('disabled') && el.offsetParent !== null,
      );
      if (focusables.length === 0) {
        e.preventDefault();
        node.focus();
        return;
      }
      const first = focusables[0]!;
      const last = focusables[focusables.length - 1]!;
      const active = document.activeElement as HTMLElement | null;
      if (e.shiftKey && active === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && active === last) {
        e.preventDefault();
        first.focus();
      }
    };

    window.addEventListener('keydown', onKey);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';

    return () => {
      window.removeEventListener('keydown', onKey);
      document.body.style.overflow = prevOverflow;
      previouslyFocused.current?.focus?.();
    };
  }, [open]);

  if (!open) return null;

  return createPortal(
    <div
      className="fixed inset-0 z-50 flex justify-end animate-fade-in"
      role="dialog"
      aria-modal="true"
      aria-labelledby="drawer-title"
    >
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-slate-900/40 backdrop-blur-sm"
        onClick={onClose}
        aria-hidden="true"
      />

      {/* Panel */}
      <div
        ref={panelRef}
        tabIndex={-1}
        onClick={(e) => e.stopPropagation()}
        className={clsx(
          'relative flex flex-col h-full w-full bg-bg-elev border-l border-border shadow-2xl',
          'animate-slide-in-right focus:outline-none',
          SIZE_CLASS[size],
        )}
        style={{ background: 'var(--bg-elev)' }}
      >
        {/* Header */}
        <div className="flex items-start justify-between gap-4 px-5 py-4 border-b border-border shrink-0">
          <div className="min-w-0">
            <h2 id="drawer-title" className="text-base font-semibold tracking-tight text-ink">
              {title}
            </h2>
            {description && <p className="text-xs text-muted mt-0.5">{description}</p>}
          </div>
          <button
            onClick={onClose}
            aria-label="Close"
            className="-mr-1 -mt-0.5 w-8 h-8 inline-flex items-center justify-center rounded-lg text-muted hover:text-ink hover:bg-hover transition press shrink-0"
          >
            ✕
          </button>
        </div>

        {/* Body — owns the scroll so header/footer stay pinned */}
        <div className="flex-1 min-h-0 overflow-y-auto px-5 py-5">{children}</div>

        {/* Footer (optional) */}
        {footer && (
          <div className="px-5 py-3 border-t border-border bg-hover flex flex-wrap justify-end items-center gap-2 shrink-0">
            {footer}
          </div>
        )}
      </div>
    </div>,
    document.body,
  );
}
