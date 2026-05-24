import { ChangeEvent, useRef, useState } from 'react';
import clsx from 'clsx';

interface Props {
  label?: string;
  accept?: string;
  disabled?: boolean;
  onFile: (file: File) => void;
  /** Extra classes applied to the outer wrapper div (e.g. flex-1 for mobile stretch). */
  className?: string;
}

export function FileUpload({ label = 'Upload file', accept, disabled, onFile, className }: Props) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [name, setName] = useState('');

  function handle(e: ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    if (!f) return;
    setName(f.name);
    onFile(f);
    // Reset so the same file can be picked again (e.g. after a failed upload).
    if (inputRef.current) inputRef.current.value = '';
  }

  return (
    <div className={clsx('flex items-center gap-2', className)}>
      <button
        type="button"
        disabled={disabled}
        onClick={() => !disabled && inputRef.current?.click()}
        className={clsx(
          'h-9 flex-1 inline-flex items-center justify-center gap-1.5 bg-ink text-bg text-sm font-medium px-3.5 rounded-lg shadow-sm transition focus:outline-none focus-visible:ring-2 focus-visible:ring-ring',
          disabled ? 'opacity-50 cursor-not-allowed' : 'hover:opacity-90',
        )}
      >
        <span aria-hidden="true">📎</span> {label}
      </button>
      <input ref={inputRef} type="file" accept={accept} className="hidden" onChange={handle} />
      {name && (
        <span className="text-xs text-muted truncate max-w-[180px]" title={name}>
          {name}
        </span>
      )}
    </div>
  );
}
