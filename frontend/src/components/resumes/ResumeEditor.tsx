import { useEffect, useRef, useState } from 'react';
import toast from 'react-hot-toast';
import { Button } from '../Button';
import { EmptyState } from '../EmptyState';
import { Skeleton } from '../Skeleton';
import { api } from '../../services/api';
import { MarkdownView } from './markdown';

interface Props {
  resumeId: string;
  consultantId: string;
  /** Called with the new version id after a save (saves create a new version —
   *  resume versions are immutable). */
  onSaved: (newVersionId: string) => void;
}

/**
 * Minimum-viable markdown editor: a textarea with a B / I / list / heading
 * toolbar and a live preview. Saving writes a NEW resume version (versions are
 * immutable) via the upload endpoint with the edited text body.
 */
export function ResumeEditor({ resumeId, consultantId, onSaved }: Props) {
  const [text, setText] = useState<string | null>(null);
  const [original, setOriginal] = useState('');
  const [error, setError] = useState(false);
  const [saving, setSaving] = useState(false);
  const ref = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    let cancelled = false;
    setText(null);
    setError(false);
    api
      .get(`/resumes/${resumeId}/body`)
      .then((r) => {
        if (cancelled) return;
        setText(r.data?.body ?? '');
        setOriginal(r.data?.body ?? '');
      })
      .catch(() => !cancelled && setError(true));
    return () => {
      cancelled = true;
    };
  }, [resumeId]);

  function applyWrap(before: string, after: string) {
    const el = ref.current;
    if (el == null || text == null) return;
    const start = el.selectionStart;
    const end = el.selectionEnd;
    const sel = text.slice(start, end) || 'text';
    const next = text.slice(0, start) + before + sel + after + text.slice(end);
    setText(next);
    requestAnimationFrame(() => {
      el.focus();
      el.setSelectionRange(start + before.length, start + before.length + sel.length);
    });
  }

  function applyLinePrefix(prefix: string) {
    const el = ref.current;
    if (el == null || text == null) return;
    const start = el.selectionStart;
    const lineStart = text.lastIndexOf('\n', start - 1) + 1;
    const next = text.slice(0, lineStart) + prefix + text.slice(lineStart);
    setText(next);
    requestAnimationFrame(() => {
      el.focus();
      el.setSelectionRange(start + prefix.length, start + prefix.length);
    });
  }

  async function save() {
    if (text == null) return;
    if (!consultantId) return toast.error('No consultant in context');
    setSaving(true);
    try {
      const form = new FormData();
      form.append('file', new File([text], 'edited-resume.md', { type: 'text/markdown' }));
      form.append('consultant_id', consultantId);
      form.append('text', text);
      const { data } = await api.post('/resumes/upload', form);
      toast.success('Saved as new version');
      onSaved(data?.id);
    } catch (e: any) {
      toast.error(e?.response?.data?.error ?? 'Save failed');
    } finally {
      setSaving(false);
    }
  }

  if (error) {
    return (
      <EmptyState
        compact
        title="Couldn't load editor"
        description="The resume body failed to load."
      />
    );
  }
  if (text == null) {
    return (
      <div className="space-y-2">
        <Skeleton className="h-7 w-48" />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }

  const dirty = text !== original;

  return (
    <div className="flex flex-col h-full min-h-0">
      <div className="flex flex-wrap items-center gap-2 mb-2">
        <div className="inline-flex rounded-lg border border-border overflow-hidden">
          <ToolbarBtn label="B" title="Bold" onClick={() => applyWrap('**', '**')} bold />
          <ToolbarBtn label="I" title="Italic" onClick={() => applyWrap('*', '*')} italic />
          <ToolbarBtn label="• List" title="Bullet" onClick={() => applyLinePrefix('- ')} />
          <ToolbarBtn label="H" title="Heading" onClick={() => applyLinePrefix('## ')} />
        </div>
        <div className="ml-auto flex items-center gap-2">
          {dirty && <span className="text-[11px] text-muted">Unsaved changes</span>}
          <Button size="sm" variant="primary" onClick={save} loading={saving} disabled={!dirty}>
            Save as new version
          </Button>
        </div>
      </div>

      <div className="flex-1 min-h-0 grid lg:grid-cols-2 gap-3">
        <textarea
          ref={ref}
          value={text}
          onChange={(e) => setText(e.target.value)}
          spellCheck={false}
          className="w-full h-full min-h-[320px] resize-none rounded-lg border border-border bg-surface p-3 text-[13px] font-mono leading-relaxed focus:outline-none focus:ring-2 focus:ring-accent"
        />
        <div className="hidden lg:block overflow-y-auto rounded-lg border border-border bg-bg-sunken p-4">
          <MarkdownView md={text} className="text-[13px] text-ink" />
        </div>
      </div>
    </div>
  );
}

function ToolbarBtn({
  label,
  title,
  onClick,
  bold,
  italic,
}: {
  label: string;
  title: string;
  onClick: () => void;
  bold?: boolean;
  italic?: boolean;
}) {
  return (
    <button
      type="button"
      title={title}
      onClick={onClick}
      className={[
        'h-8 px-3 text-xs text-ink hover:bg-hover border-r border-border last:border-r-0 transition',
        bold ? 'font-bold' : '',
        italic ? 'italic' : '',
      ].join(' ')}
    >
      {label}
    </button>
  );
}
