import { useEffect, useRef, useState } from 'react';

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
  const wrapperRef = useRef<HTMLDivElement>(null);

  const toggle = () => setOpen((prev) => !prev);
  const close = () => setOpen(false);

  useEffect(() => {
    if (!open) return;

    const handleMouseDown = (e: MouseEvent) => {
      if (wrapperRef.current && !wrapperRef.current.contains(e.target as Node)) {
        close();
      }
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
  }, [open]);

  const alignClass = align === 'right' ? 'right-0' : 'left-0';

  return (
    <div ref={wrapperRef} className="relative inline-block">
      <div onClick={toggle}>{button(open)}</div>
      {open && (
        <div
          className={[
            'absolute z-30 mt-1',
            alignClass,
            'bg-bg-elev border border-border rounded-lg shadow-btn-hover p-2 min-w-[220px]',
            panelClassName ?? '',
          ]
            .filter(Boolean)
            .join(' ')}
        >
          {children(close)}
        </div>
      )}
    </div>
  );
}
