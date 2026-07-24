import { useState } from 'react';
import toast from 'react-hot-toast';
import { Button } from '../Button';
import { Modal } from '../Modal';
import { AiProgressCard } from '../AiProgressCard';
import { EmptyState } from '../EmptyState';
import { api } from '../../services/api';
import { ResumePreview } from './ResumePreview';
import { ResumeDiff } from './ResumeDiff';
import { ResumeEditor } from './ResumeEditor';
import { ResumeProfileCard } from './ResumeProfileCard';
import type { CenterMode, ResumeVersion } from './types';

interface Props {
  version: ResumeVersion | null;
  versions: ResumeVersion[];
  consultantId: string;
  mode: CenterMode;
  onMode: (m: CenterMode) => void;
  sessionId: string | null;
  resumeId: string;
  onApplied: (newVersionId: string) => void;
  onEdited: () => void;
}

const TABS: { id: CenterMode; label: string }[] = [
  { id: 'profile', label: 'Profile' },
  { id: 'preview', label: 'Preview' },
  { id: 'edit', label: 'Edit' },
  { id: 'diff', label: 'Diff vs prev' },
];

export function CenterPane({
  version,
  versions,
  consultantId,
  mode,
  onMode,
  sessionId,
  resumeId,
  onApplied,
  onEdited,
}: Props) {
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [reextracting, setReextracting] = useState(false);
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
        onEdited();
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
      <div className="bg-surface border border-border rounded-2xl min-h-[480px] grid place-items-center">
        <EmptyState
          icon="📄"
          title="No version selected"
          description="Pick a version from the strip above, or upload a resume to begin."
        />
      </div>
    );
  }

  const applyingDraft = mode === 'diff' && !!sessionId;

  async function confirmApplyDraft() {
    if (!version || !sessionId) return;
    setBusy(true);
    try {
      const { data } = await api.post(`/resumes/${resumeId}/tailor-sessions/${sessionId}/apply`);
      const newId = data?.resume?.id;
      if (!newId) throw new Error('Apply did not return a version');
      toast.success('Applied draft as a new version');
      onApplied(newId);
      setConfirmOpen(false);
    } catch (e: any) {
      toast.error(e?.response?.data?.error ?? 'Failed to apply draft');
    } finally {
      setBusy(false);
    }
  }

  const prevVersionId =
    versions.filter((v) => v.version < version.version).sort((a, b) => b.version - a.version)[0]
      ?.id ?? null;

  const atsScore = version.ai_score != null ? Math.round(version.ai_score) : null;

  return (
    <div className="bg-surface border border-border rounded-2xl flex flex-col overflow-hidden">
      <AiProgressCard
        open={reextracting}
        title="Re-extracting resume"
        stages={['Reading the file…', 'Extracting text…', 'Re-scoring against ATS…']}
        note="Large PDFs can take up to a minute."
      />
      {/* ── Header ── */}
      <div className="border-b border-border">
        {/* Row 1: version meta + action buttons */}
        <div className="flex flex-wrap items-center justify-between gap-2 px-5 pt-4 pb-3">
          <div className="flex items-center gap-2 min-w-0">
            {/* Version badge */}
            <span className="text-[11px] font-mono font-bold bg-ink text-surface px-2 py-0.5 rounded-md shrink-0">
              v{version.version}
            </span>

            {/* ATS score */}
            {atsScore != null && (
              <span
                className={`text-[11px] font-semibold px-1.5 py-0.5 rounded shrink-0 ${
                  atsScore >= 80
                    ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-400'
                    : atsScore >= 60
                      ? 'bg-amber-100 text-amber-700 dark:bg-amber-500/15 dark:text-amber-400'
                      : 'bg-red-100 text-red-700 dark:bg-red-500/15 dark:text-red-400'
                }`}
              >
                ATS {atsScore}
              </span>
            )}

            {/* Filename */}
            <span className="text-xs text-muted font-mono truncate hidden sm:block">
              {version.file_name}
            </span>
          </div>

          {/* Actions */}
          <div className="flex items-center gap-2 shrink-0">
            <Button size="sm" variant="ghost" onClick={reextract} loading={reextracting}>
              ↻ Re-extract
            </Button>
            {applyingDraft && (
              <Button size="sm" variant="primary" onClick={() => setConfirmOpen(true)}>
                Apply draft
              </Button>
            )}
          </div>
        </div>

        {/* Row 2: underline tabs */}
        <div className="flex px-5 gap-0">
          {TABS.map((tab) => (
            <button
              key={tab.id}
              type="button"
              onClick={() => onMode(tab.id)}
              className={`px-4 py-2.5 text-sm font-medium border-b-2 transition-colors -mb-px ${
                mode === tab.id
                  ? 'border-accent text-accent'
                  : 'border-transparent text-muted hover:text-ink hover:border-border-strong'
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>
      </div>

      {/* ── Content area ── */}
      <div className="flex-1 p-5 min-h-0">
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
        {mode === 'profile' && (
          <ResumeProfileCard
            key={version.id}
            profile={version.parsed_profile}
            resumeId={version.id}
            onParsed={onEdited}
          />
        )}
      </div>

      {/* ── Confirm modal ── */}
      <Modal
        open={confirmOpen}
        onClose={busy ? () => undefined : () => setConfirmOpen(false)}
        title="Apply draft as new version"
        description="This materializes the accepted changes into a new resume version. The original version is preserved."
        size="sm"
        footer={
          <>
            <Button variant="ghost" onClick={() => setConfirmOpen(false)} disabled={busy}>
              Cancel
            </Button>
            <Button variant="primary" onClick={confirmApplyDraft} loading={busy}>
              Apply draft
            </Button>
          </>
        }
      >
        <p className="text-sm text-muted">
          Rejected changes are reverted; accepted and hand-edited changes are kept.
        </p>
      </Modal>
    </div>
  );
}
