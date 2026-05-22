import { ButtonGroup, ButtonGroupItem } from '../ButtonGroup';
import { Button } from '../Button';
import { EmptyState } from '../EmptyState';
import { ResumePreview } from './ResumePreview';
import { ResumeDiff } from './ResumeDiff';
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

export function CenterPane({
  version,
  versions,
  mode,
  onMode,
  sessionId,
  resumeId,
  onMakeCurrent,
  onEdited,
}: Props) {
  if (!version) {
    return (
      <div className="bg-surface border border-border rounded-xl min-h-[420px] grid place-items-center">
        <EmptyState
          icon="📄"
          title="No version selected"
          description="Pick a version from the strip above, or upload a resume to begin."
        />
      </div>
    );
  }

  return (
    <div className="bg-surface border border-border rounded-xl flex flex-col min-h-[420px]">
      <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-2.5 border-b border-border">
        <div className="min-w-0 flex items-baseline gap-2">
          <span className="text-xs font-mono font-medium text-ink">v{version.version}</span>
          <span className="text-xs font-mono text-muted truncate">{version.file_name}</span>
        </div>
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

      <div className="flex-1 p-4 min-h-0">
        {mode === 'preview' && <ResumePreview resumeId={version.id} fileName={version.file_name} />}
        {mode === 'diff' && (
          <ResumeDiff
            resumeId={resumeId}
            version={version}
            sessionId={sessionId}
            prevVersionId={
              versions
                .filter((v) => v.version < version.version)
                .sort((a, b) => b.version - a.version)[0]?.id ?? null
            }
            onChanged={onEdited}
          />
        )}
        {mode === 'edit' && (
          <EmptyState compact title="Edit" description="Editor lands in a later step." />
        )}
      </div>
    </div>
  );
}
