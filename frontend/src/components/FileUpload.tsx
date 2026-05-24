import { ChangeEvent, useRef, useState } from 'react';

interface Props {
  label?: string;
  accept?: string;
  disabled?: boolean;
  onFile: (file: File) => void;
}

export function FileUpload({ label = 'Upload file', accept, disabled, onFile }: Props) {
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
    <div className="flex items-center gap-2">
      <button
        type="button"
        disabled={disabled}
        onClick={() => !disabled && inputRef.current?.click()}
        className={`h-9 inline-flex items-center gap-1.5 bg-ink text-bg text-sm font-medium px-3.5 rounded-lg shadow-sm transition focus:outline-none focus-visible:ring-2 focus-visible:ring-ring ${disabled ? 'opacity-50 cursor-not-allowed' : 'hover:opacity-90'}`}
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
