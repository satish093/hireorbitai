import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { useAnchoredPosition } from './useAnchoredPosition';

export function Popover({
  button,
  children,
  align = 'left',
  panelClassName,
}: {
  button: (open: boolean) => React.ReactNode;
  children: (close: () => void) => React.ReactNode;
  align?: 'left' | 'right';
  panelClassName?: string;
}): JSX.Element {
  const [open, setOpen] = useState(false);
  // The panel is portaled to <body> and positioned in viewport coords, so it
  // can never be clipped by an ancestor's overflow/transform/stacking context.
  const { triggerRef, panelRef, style } = useAnchoredPosition(open, { align });

  const toggle = () => setOpen((prev) => !prev);
  const close = () => setOpen(false);

  useEffect(() => {
    if (!open) return;

    const handleMouseDown = (e: MouseEvent) => {
      const target = e.target as Node;
      // The panel now lives outside the trigger's subtree (it's portaled), so
      // dismiss-on-outside-click must spare BOTH the trigger and the panel.
      if (triggerRef.current?.contains(target)) return;
      if (panelRef.current?.contains(target)) return;
      close();
    };

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        close();
      }
    };

    document.addEventListener('mousedown', handleMouseDown);
    document.addEventListener('keydown', handleKeyDown);

    return () => {
      document.removeEventListener('mousedown', handleMouseDown);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [open, triggerRef, panelRef]);

  return (
    <div ref={triggerRef} className="relative inline-block">
      <div onClick={toggle}>{button(open)}</div>
      {open &&
        createPortal(
          <div
            ref={panelRef}
            style={style}
            className={[
              // z-50 = the app's top chrome tier (modals/drawers). Portaled to
              // the end of <body>, so it reliably overlays page content.
              'z-50 max-h-[calc(100dvh-1rem)] overflow-y-auto animate-scale-in',
              'bg-bg-elev border border-border rounded-lg shadow-btn-hover p-2 min-w-[220px]',
              panelClassName ?? '',
            ]
              .filter(Boolean)
              .join(' ')}
          >
            {children(close)}
          </div>,
          document.body,
        )}
    </div>
  );
}
