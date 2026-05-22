import { useState } from 'react';
import toast from 'react-hot-toast';
import { ButtonGroup, ButtonGroupItem } from '../ButtonGroup';
import { Button } from '../Button';
import { Modal } from '../Modal';
import { EmptyState } from '../EmptyState';
import { api } from '../../services/api';
import { ResumePreview } from './ResumePreview';
import { ResumeDiff } from './ResumeDiff';
import { ResumeEditor } from './ResumeEditor';
import type { CenterMode, ResumeVersion } from './types';

interface Props {
  version: ResumeVersion | null;
  versions: ResumeVersion[];
  consultantId: string;
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
  consultantId,
  mode,
  onMode,
  sessionId,
  resumeId,
  onMakeCurrent,
  onApplied,
  onEdited,
}: Props) {
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [reextracting, setReextracting] = useState(false);
  // Bumped after a re-extraction so the preview re-fetches the new body text.
  const [previewKey, setPreviewKey] = useState(0);

  async function reextract() {
    if (!version) return;
    setReextracting(true);
    try {
      const { data } = await api.post(`/resumes/${version.id}/reextract`);
      if (data?.extracted) {
        toast.success(
          `Extracted ${Number(data.chars ?? 0).toLocaleString()} chars` +
            (data.ai_score != null ? ` · ATS ${Math.round(data.ai_score)}` : ''),
        );
        setPreviewKey((k) => k + 1);
        onEdited(); // reload versions so the score pill reflects the new value
      } else {
        toast('No extractable text in this file — original kept. Use Download.', { icon: '📄' });
      }
    } catch (e: any) {
      toast.error(e?.response?.data?.error ?? 'Re-extract failed');
    } finally {
      setReextracting(false);
    }
  }

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

  // A live session draft in Diff mode applies into a NEW version; otherwise the
  // displayed version is simply flagged current. Disable only when there's
  // nothing to do (already current and no draft to apply).
  const applyingDraft = mode === 'diff' && !!sessionId;
  const disabled = version.is_current && !applyingDraft;

  async function confirmMakeCurrent() {
    if (!version) return;
    setBusy(true);
    try {
      if (applyingDraft && sessionId) {
        const { data } = await api.post(`/resumes/${resumeId}/tailor-sessions/${sessionId}/apply`);
        const newId = data?.resume?.id;
        if (!newId) throw new Error('Apply did not return a version');
        await api.post(`/resumes/${newId}/set-current`);
        toast.success('Applied draft and made it current');
        onApplied(newId);
      } else {
        await api.post(`/resumes/${version.id}/set-current`);
        toast.success(`v${version.version} is now current`);
        onMakeCurrent();
      }
      setConfirmOpen(false);
    } catch (e: any) {
      toast.error(e?.response?.data?.error ?? 'Failed to make current');
    } finally {
      setBusy(false);
    }
  }

  const prevVersionId =
    versions.filter((v) => v.version < version.version).sort((a, b) => b.version - a.version)[0]
      ?.id ?? null;

  return (
    <div className="bg-surface border border-border rounded-xl flex flex-col min-h-[420px]">
      <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-2.5 border-b border-border">
        <div className="min-w-0 flex items-baseline gap-2">
          <span className="text-xs font-mono font-medium text-ink">v{version.version}</span>
          <span className="text-xs font-mono text-muted truncate">{version.file_name}</span>
          {version.ai_score != null && (
            <span
              title="AI resume score (0–100)"
              className={`text-[11px] font-semibold px-1.5 py-0.5 rounded self-center ${
                version.ai_score >= 80
                  ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300'
                  : version.ai_score >= 60
                    ? 'bg-amber-100 text-amber-700 dark:bg-amber-500/15 dark:text-amber-300'
                    : 'bg-red-100 text-red-700 dark:bg-red-500/15 dark:text-red-300'
              }`}
            >
              ATS {Math.round(version.ai_score)}
            </span>
          )}
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
        <div className="flex items-center gap-2">
          <Button size="sm" variant="ghost" onClick={reextract} loading={reextracting}>
            ↻ Re-extract
          </Button>
          <Button
            size="sm"
            variant="outline"
            disabled={disabled}
            onClick={() => setConfirmOpen(true)}
          >
            {version.is_current && !applyingDraft ? 'Current' : 'Make current'}
          </Button>
        </div>
      </div>

      <div className="flex-1 p-4 min-h-0">
        {mode === 'preview' && (
          <ResumePreview
            resumeId={version.id}
            fileName={version.file_name}
            refreshKey={previewKey}
            onReextract={reextract}
            reextracting={reextracting}
          />
        )}
        {mode === 'diff' && (
          <ResumeDiff
            resumeId={resumeId}
            version={version}
            sessionId={sessionId}
            prevVersionId={prevVersionId}
            onChanged={onEdited}
          />
        )}
        {mode === 'edit' && (
          <ResumeEditor resumeId={version.id} consultantId={consultantId} onSaved={onApplied} />
        )}
      </div>

      <Modal
        open={confirmOpen}
        onClose={busy ? () => undefined : () => setConfirmOpen(false)}
        title={applyingDraft ? 'Apply draft & make current' : 'Make current version'}
        description={
          applyingDraft
            ? 'This materializes the accepted changes into a new resume version and marks it current. The original version is preserved.'
            : `Mark v${version.version} as the current resume? This is the version that gets submitted.`
        }
        size="sm"
        footer={
          <>
            <Button variant="ghost" onClick={() => setConfirmOpen(false)} disabled={busy}>
              Cancel
            </Button>
            <Button variant="primary" onClick={confirmMakeCurrent} loading={busy}>
              {applyingDraft ? 'Apply & make current' : 'Make current'}
            </Button>
          </>
        }
      >
        <p className="text-sm text-muted">
          {applyingDraft
            ? 'Rejected changes are reverted; accepted and hand-edited changes are kept.'
            : 'You can switch the current version again at any time.'}
        </p>
      </Modal>
    </div>
  );
}
