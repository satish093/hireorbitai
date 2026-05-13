import { ChangeEvent, useRef, useState } from 'react';

interface Props {
  label?: string;
  accept?: string;
  onFile: (file: File) => void;
}

export function FileUpload({ label = 'Upload file', accept, onFile }: Props) {
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
        onClick={() => inputRef.current?.click()}
        className="h-9 inline-flex items-center gap-1.5 bg-slate-900 hover:bg-slate-800 text-white text-sm font-medium px-3.5 rounded-lg shadow-sm transition focus:outline-none focus-visible:ring-2 focus-visible:ring-slate-900/40"
      >
        <span aria-hidden="true">📎</span> {label}
      </button>
      <input ref={inputRef} type="file" accept={accept} className="hidden" onChange={handle} />
      {name && <span className="text-xs text-slate-600 truncate max-w-[180px]" title={name}>{name}</span>}
    </div>
  );
}
