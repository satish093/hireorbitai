import { ReactNode, useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import clsx from 'clsx';

interface Props {
  open: boolean;
  onClose: () => void;
  /** Optional title shown in a header bar below the drag handle. */
  title?: string;
  children: ReactNode;
  /** Sticky footer pinned above the safe-area (e.g. action buttons). */
  footer?: ReactNode;
  /**
   * Maximum sheet height as a dvh fraction (0–1). Defaults to 0.92.
   * Set lower for confirmation sheets, higher for full-screen forms.
   */
  maxHeightFraction?: number;
}

const FOCUSABLE =
  'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';

/**
 * BottomSheet — mobile-first slide-up overlay.
 *
 * Used for filters, sort pickers, create/edit forms, confirmations, and any
 * secondary action that shouldn't leave the current screen context. Rendered
 * via portal to escape transformed ancestors.
 *
 * Accessibility: focus trap, Escape key, body-scroll lock, focus restoration.
 * Motion: uses .animate-sheet-in (defined in tokens.css); disabled by
 * prefers-reduced-motion media query on that class.
 */
export function BottomSheet({
  open,
  onClose,
  title,
  children,
  footer,
  maxHeightFraction = 0.92,
}: Props) {
  const sheetRef = useRef<HTMLDivElement>(null);
  const previouslyFocused = useRef<HTMLElement | null>(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useEffect(() => {
    if (!open) return;

    previouslyFocused.current = (document.activeElement as HTMLElement) ?? null;

    const sheet = sheetRef.current;
    if (sheet) {
      const first = sheet.querySelector<HTMLElement>(FOCUSABLE);
      (first ?? sheet).focus();
    }

    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onCloseRef.current();
        return;
      }
      if (e.key !== 'Tab') return;
      const node = sheetRef.current;
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
      className="fixed inset-0 z-[60] flex flex-col justify-end"
      role="dialog"
      aria-modal="true"
      aria-labelledby={title ? 'bottom-sheet-title' : undefined}
    >
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-slate-900/50 backdrop-blur-[2px] animate-fade-in"
        onClick={onClose}
        aria-hidden="true"
      />

      {/* Sheet */}
      <div
        ref={sheetRef}
        tabIndex={-1}
        onClick={(e) => e.stopPropagation()}
        className={clsx(
          'relative flex flex-col animate-sheet-in focus:outline-none noscroll',
          'rounded-t-[20px] border-t border-border',
        )}
        style={{
          background: 'var(--bg-elev)',
          maxHeight: `${maxHeightFraction * 100}dvh`,
          boxShadow: 'var(--shadow-sheet)',
        }}
      >
        {/* Drag handle */}
        <div className="flex justify-center pt-2.5 pb-1 shrink-0">
          <span
            className="block w-[38px] h-1 rounded-full"
            style={{ background: 'var(--border-strong)' }}
          />
        </div>

        {/* Optional header */}
        {title && (
          <div className="flex items-center justify-between px-[18px] pb-3 pt-1 shrink-0">
            <h2
              id="bottom-sheet-title"
              className="text-[17px] font-bold tracking-tight"
              style={{ color: 'var(--ink)' }}
            >
              {title}
            </h2>
            <button
              onClick={onClose}
              aria-label="Close"
              className="w-8 h-8 rounded-full grid place-items-center transition-colors hover:bg-hover"
              style={{ color: 'var(--ink-2)' }}
            >
              <CloseIcon />
            </button>
          </div>
        )}

        {/* Scrollable body */}
        <div className="flex-1 min-h-0 overflow-y-auto px-[18px] pb-[18px] noscroll">
          {children}
        </div>

        {/* Optional footer — pinned above safe area */}
        {footer && (
          <div
            className="shrink-0 px-4 pt-3 border-t border-border"
            style={{
              background: 'var(--surface)',
              paddingBottom: 'max(16px, env(safe-area-inset-bottom))',
            }}
          >
            {footer}
          </div>
        )}
      </div>
    </div>,
    document.body,
  );
}

function CloseIcon() {
  return (
    <svg
      width="17"
      height="17"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <line x1="18" y1="6" x2="6" y2="18" />
      <line x1="6" y1="6" x2="18" y2="18" />
    </svg>
  );
}
