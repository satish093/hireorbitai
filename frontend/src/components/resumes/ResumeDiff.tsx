import { useEffect, useState } from 'react';
import clsx from 'clsx';
import toast from 'react-hot-toast';
import { Button } from '../Button';
import { Pill } from '../Pill';
import { EmptyState } from '../EmptyState';
import { SkeletonCard } from '../Skeleton';
import { api } from '../../services/api';
import { MarkdownView } from './markdown';
import { DeltaPill } from './AtsBits';
import type { ResumeVersion, TailorEdit } from './types';

interface Props {
  resumeId: string;
  version: ResumeVersion;
  sessionId: string | null;
  prevVersionId: string | null;
  /** Bump tailor-history / strip after edits change so deltas stay in sync. */
  onChanged: () => void;
}

interface DiffData {
  changes: TailorEdit[];
  summary: string;
  scoreBefore: number | null;
  scoreAfter: number | null;
  fromLabel: string;
  toLabel: string;
  interactive: boolean; // only real sessions expose accept/reject/edit
}

const ADDED_TONE = { bg: 'bg-accent-soft', text: 'text-accent' };

export function ResumeDiff({ resumeId, version, sessionId, prevVersionId, onChanged }: Props) {
  const [data, setData] = useState<DiffData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(false);
    setData(null);

    async function load() {
      if (sessionId) {
        const { data: s } = await api.get(`/resumes/${resumeId}/tailor-sessions/${sessionId}`);
        if (cancelled) return;
        setData({
          changes: s.edits ?? [],
          summary: s.ai_summary ?? '',
          scoreBefore: s.score_before ?? null,
          scoreAfter: s.score_after ?? null,
          fromLabel: `v${version.version}`,
          toLabel: s.applied && s.result_version_id ? 'new version' : 'draft',
          interactive: !s.applied,
        });
        return;
      }
      if (prevVersionId) {
        const { data: d } = await api.get(`/resumes/${resumeId}/diff`, {
          params: { from: prevVersionId, to: resumeId },
        });
        if (cancelled) return;
        setData({
          changes: d.changes ?? [],
          summary: d.summary ?? '',
          scoreBefore: d.score_before ?? null,
          scoreAfter: d.score_after ?? null,
          fromLabel: d.from ? `v${d.from.version}` : 'older',
          toLabel: d.to ? `v${d.to.version}` : `v${version.version}`,
          interactive: false,
        });
        return;
      }
      if (cancelled) return;
      setData(null); // nothing to compare against
    }

    load()
      .catch(() => !cancelled && setError(true))
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, [resumeId, sessionId, prevVersionId, version.version]);

  function patchLocal(editId: string, patch: Partial<TailorEdit>) {
    setData((d) =>
      d ? { ...d, changes: d.changes.map((c) => (c.id === editId ? { ...c, ...patch } : c)) } : d,
    );
  }

  async function setStatus(edit: TailorEdit, status: TailorEdit['status'], afterText?: string) {
    if (!sessionId) return;
    const prev = { status: edit.status, after_text: edit.after_text };
    patchLocal(edit.id, { status, ...(afterText != null ? { after_text: afterText } : {}) });
    try {
      const body: any = { status };
      if (status === 'edited' && afterText != null) body.after_text = afterText;
      const { data: updated } = await api.patch(
        `/resumes/${resumeId}/tailor-sessions/${sessionId}/edits/${edit.id}`,
        body,
      );
      patchLocal(edit.id, updated);
      onChanged();
    } catch (e: any) {
      patchLocal(edit.id, prev); // roll back optimistic update
      toast.error(e?.response?.data?.error ?? 'Failed to update change');
    }
  }

  if (loading) return <SkeletonCard lines={4} />;
  if (error)
    return (
      <EmptyState compact title="Couldn't load diff" description="Try reopening this session." />
    );
  if (!data || data.changes.length === 0) {
    return (
      <EmptyState
        compact
        icon="≡"
        title={prevVersionId || sessionId ? 'No changes to show' : 'Nothing to compare'}
        description={
          prevVersionId || sessionId
            ? 'This version matches its predecessor section-for-section.'
            : 'This is the first version — there is no previous version to diff against.'
        }
      />
    );
  }

  const delta =
    data.scoreAfter != null && data.scoreBefore != null ? data.scoreAfter - data.scoreBefore : null;

  return (
    <div className="flex flex-col h-full min-h-0">
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs font-mono text-muted pb-3 mb-1 border-b border-border">
        <span className="text-ink font-medium">{data.fromLabel}</span>
        <span>→</span>
        <span className="text-ink font-medium">{data.toLabel}</span>
        <span className="text-border-strong">·</span>
        <span>
          ATS {data.scoreBefore ?? '—'} →{' '}
          <span className="text-success">{data.scoreAfter ?? '—'}</span>
        </span>
        <DeltaPill delta={delta} />
        <span className="text-border-strong">·</span>
        <span>
          {data.changes.length} change{data.changes.length === 1 ? '' : 's'}
        </span>
      </div>

      {data.summary && <p className="text-xs text-ink-2 mb-3">{data.summary}</p>}

      <div className="flex-1 min-h-0 overflow-y-auto space-y-3 -mr-1 pr-1">
        {data.changes.map((edit) => (
          <DiffCard
            key={edit.id}
            edit={edit}
            interactive={data.interactive}
            onAccept={() => setStatus(edit, 'accepted')}
            onRevert={() => setStatus(edit, 'rejected')}
            onSaveEdit={(text) => setStatus(edit, 'edited', text)}
          />
        ))}
      </div>
    </div>
  );
}

function DiffCard({
  edit,
  interactive,
  onAccept,
  onRevert,
  onSaveEdit,
}: {
  edit: TailorEdit;
  interactive: boolean;
  onAccept: () => void;
  onRevert: () => void;
  onSaveEdit: (text: string) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(edit.after_text);
  const isAdded = edit.before_text == null;
  const accepted = edit.status === 'accepted';
  const rejected = edit.status === 'rejected';
  const edited = edit.status === 'edited';

  return (
    <div
      className={clsx(
        'rounded-xl border bg-surface transition',
        accepted ? 'border-success/40' : rejected ? 'border-border opacity-60' : 'border-border',
      )}
    >
      <div className="flex flex-wrap items-center gap-2 px-3 py-2 border-b border-border">
        <span className="text-sm font-semibold text-ink">{edit.section}</span>
        {isAdded && (
          <Pill tone={ADDED_TONE} size="xs">
            ADDED
          </Pill>
        )}
        {accepted && <span className="text-[10px] font-mono text-success">✓ accepted</span>}
        {rejected && <span className="text-[10px] font-mono text-muted">reverted</span>}
        {edited && <span className="text-[10px] font-mono text-accent">✎ edited</span>}
        {edit.ai_reason && (
          <span className="ml-auto inline-flex items-center gap-1 text-[11px] font-mono text-muted min-w-0">
            <span aria-hidden>✦</span>
            <span className="truncate">{edit.ai_reason}</span>
          </span>
        )}
      </div>

      <div className="grid sm:grid-cols-2 gap-px bg-border">
        <div className="bg-bg-sunken p-3">
          <div className="text-[10px] font-semibold uppercase tracking-wider text-muted mb-1">
            Before
          </div>
          {isAdded ? (
            <p className="text-xs italic text-muted">This section didn't exist.</p>
          ) : (
            <MarkdownView md={edit.before_text ?? ''} className="text-xs text-muted" />
          )}
        </div>
        <div className="bg-accent-soft/40 p-3">
          <div className="text-[10px] font-semibold uppercase tracking-wider text-accent mb-1">
            After
          </div>
          {editing ? (
            <textarea
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              rows={Math.min(14, Math.max(4, draft.split('\n').length + 1))}
              className="w-full text-xs font-mono rounded-md border border-border bg-surface p-2 focus:outline-none focus:ring-2 focus:ring-accent"
            />
          ) : (
            <MarkdownView md={edit.after_text} className="text-xs text-ink" />
          )}
        </div>
      </div>

      {interactive && (
        <div className="flex items-center justify-end gap-2 px-3 py-2 border-t border-border">
          {editing ? (
            <>
              <Button
                size="sm"
                variant="ghost"
                onClick={() => {
                  setDraft(edit.after_text);
                  setEditing(false);
                }}
              >
                Cancel
              </Button>
              <Button
                size="sm"
                variant="primary"
                onClick={() => {
                  onSaveEdit(draft);
                  setEditing(false);
                }}
              >
                Save edit
              </Button>
            </>
          ) : (
            <>
              <Button size="sm" variant="ghost" onClick={onRevert} disabled={rejected}>
                Revert
              </Button>
              <Button size="sm" variant="outline" onClick={() => setEditing(true)}>
                Edit
              </Button>
              <Button size="sm" variant="primary" onClick={onAccept} disabled={accepted}>
                Accept
              </Button>
            </>
          )}
        </div>
      )}
    </div>
  );
}
