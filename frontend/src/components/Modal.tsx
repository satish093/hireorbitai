import { ReactNode, useEffect, useRef } from 'react';

interface Props {
  open: boolean;
  onClose: () => void;
  title: string;
  description?: string;
  children: ReactNode;
  footer?: ReactNode;
  size?: 'sm' | 'md' | 'lg' | 'xl';
}

const SIZE_CLASS: Record<NonNullable<Props['size']>, string> = {
  sm: 'max-w-sm',
  md: 'max-w-lg',
  lg: 'max-w-2xl',
  xl: 'max-w-4xl',
};

// Selector for elements that should participate in the focus trap. Same set
// most a11y libraries use; keeps focus inside the dialog while it's open.
const FOCUSABLE =
  'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';

export function Modal({ open, onClose, title, description, children, footer, size = 'md' }: Props) {
  const dialogRef = useRef<HTMLDivElement>(null);
  const previouslyFocused = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (!open) return;

    // Remember where focus was so we can restore it on close.
    previouslyFocused.current = (document.activeElement as HTMLElement) ?? null;

    // Move focus into the dialog on open — prefer the first focusable
    // element, fall back to the dialog itself.
    const dlg = dialogRef.current;
    if (dlg) {
      const first = dlg.querySelector<HTMLElement>(FOCUSABLE);
      (first ?? dlg).focus();
    }

    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onClose();
        return;
      }
      if (e.key !== 'Tab') return;
      // Cycle focus inside the dialog.
      const node = dialogRef.current;
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
    // Lock body scroll while the modal is open so the page behind doesn't drift.
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';

    return () => {
      window.removeEventListener('keydown', onKey);
      document.body.style.overflow = prevOverflow;
      // Restore focus to the trigger when the modal closes.
      previouslyFocused.current?.focus?.();
    };
  }, [open, onClose]);

  if (!open) return null;
  return (
    <div
      className="fixed inset-0 z-50 flex items-start sm:items-center justify-center bg-slate-900/40 backdrop-blur-sm p-3 sm:p-6 animate-fade-in"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-labelledby="modal-title"
    >
      <div
        ref={dialogRef}
        tabIndex={-1}
        className={`bg-white rounded-2xl shadow-2xl ring-1 ring-slate-900/5 w-full ${SIZE_CLASS[size]} my-4 sm:my-8 flex flex-col max-h-[calc(100dvh-2rem)] sm:max-h-[calc(100dvh-4rem)] overflow-hidden animate-scale-in focus:outline-none`}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="px-5 sm:px-6 pt-5 pb-4 border-b border-slate-100 shrink-0">
          <div className="flex items-start justify-between gap-4">
            <div className="min-w-0">
              <h3
                id="modal-title"
                className="text-base font-semibold tracking-tight text-slate-900"
              >
                {title}
              </h3>
              {description && <p className="text-xs text-slate-500 mt-0.5">{description}</p>}
            </div>
            <button
              onClick={onClose}
              aria-label="Close"
              className="-mr-2 -mt-1 w-8 h-8 inline-flex items-center justify-center rounded-lg text-slate-400 hover:text-slate-700 hover:bg-slate-100 transition press"
            >
              ✕
            </button>
          </div>
        </div>
        {/* The body owns the scroll so the header and footer stay pinned even
            with long content. Previously, long modals scrolled the whole
            viewport which felt jarring. */}
        <div className="px-5 sm:px-6 py-5 overflow-y-auto flex-1 min-h-0">{children}</div>
        {footer && (
          <div className="px-5 sm:px-6 py-3 bg-slate-50 border-t border-slate-100 flex flex-wrap justify-end items-center gap-2 shrink-0">
            {footer}
          </div>
        )}
      </div>
    </div>
  );
}
