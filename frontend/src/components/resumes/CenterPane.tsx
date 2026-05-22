import { ButtonGroup, ButtonGroupItem } from '../ButtonGroup';
import { Button } from '../Button';
import { EmptyState } from '../EmptyState';
import type { CenterMode, ResumeVersion } from './types';

interface Props {
  version: ResumeVersion | null;
  versions: ResumeVersion[];
  mode: CenterMode;
  onMode: (m: CenterMode) => void;
  sessionId: string | null;
  resumeId: string;
  onMakeCurrent: () => void;
  onApplied: (newVersionId: string) => void;
  onEdited: () => void;
}

// Placeholder shell — Preview / Diff / Edit modes are filled in their steps.
export function CenterPane({ version, mode, onMode, onMakeCurrent }: Props) {
  if (!version) {
    return (
      <div className="bg-surface border border-border rounded-xl min-h-[420px] grid place-items-center">
        <EmptyState
          title="No version selected"
          description="Pick a version from the strip above."
        />
      </div>
    );
  }
  return (
    <div className="bg-surface border border-border rounded-xl flex flex-col min-h-[420px]">
      <div className="flex items-center justify-between gap-3 px-4 py-2.5 border-b border-border">
        <div className="min-w-0 text-xs font-mono text-muted truncate">{version.file_name}</div>
        <ButtonGroup>
          <ButtonGroupItem pressed={mode === 'preview'} onClick={() => onMode('preview')}>
            Preview
          </ButtonGroupItem>
          <ButtonGroupItem pressed={mode === 'diff'} onClick={() => onMode('diff')}>
            Diff vs prev
          </ButtonGroupItem>
          <ButtonGroupItem pressed={mode === 'edit'} onClick={() => onMode('edit')}>
            Edit
          </ButtonGroupItem>
        </ButtonGroup>
        <Button size="sm" variant="outline" disabled={version.is_current} onClick={onMakeCurrent}>
          {version.is_current ? 'Current' : 'Make current'}
        </Button>
      </div>
      <div className="flex-1 p-4 text-sm text-muted">Mode: {mode}</div>
    </div>
  );
}
