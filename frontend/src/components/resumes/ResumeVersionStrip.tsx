import type { ResumeVersion } from './types';

interface Props {
  versions: ResumeVersion[];
  activeId: string;
  onSelect: (id: string) => void;
  onNew: () => void;
}

// Placeholder — fleshed out in the version-strip step.
export function ResumeVersionStrip({ versions, activeId, onSelect, onNew }: Props) {
  return (
    <div className="flex items-center gap-2 overflow-x-auto pb-1">
      {versions.map((v) => (
        <button
          key={v.id}
          onClick={() => onSelect(v.id)}
          className={`shrink-0 rounded-lg border px-3 py-2 text-xs ${
            v.id === activeId ? 'border-ink' : 'border-border'
          }`}
        >
          v{v.version}
        </button>
      ))}
      <button
        onClick={onNew}
        className="shrink-0 rounded-lg border border-dashed border-border px-3 py-2 text-xs text-muted"
      >
        + New
      </button>
    </div>
  );
}
