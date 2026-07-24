import { useEffect, useState } from 'react';
import { Button } from '../Button';

// Pin SVG — a simple geometric pin glyph using project token colors.
function PinIcon() {
  return (
    <svg
      aria-hidden="true"
      width="12"
      height="12"
      viewBox="0 0 16 16"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className="inline-block text-muted shrink-0"
    >
      {/* Pin head (circle) */}
      <circle cx="8" cy="6" r="3.5" stroke="currentColor" strokeWidth="1.5" />
      {/* Pin shaft */}
      <line
        x1="8"
        y1="9.5"
        x2="8"
        y2="14"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
      />
      {/* Top nub */}
      <line
        x1="5.5"
        y1="3"
        x2="10.5"
        y2="3"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
      />
    </svg>
  );
}

// Cheap relative-time formatter — no third-party dep.
function relativeTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const minutes = Math.floor(diff / 60_000);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}d ago`;
  const months = Math.floor(days / 30);
  if (months < 12) return `${months}mo ago`;
  return `${Math.floor(months / 12)}y ago`;
}

export function RecruiterNoteCard({
  note,
  author,
  updatedAt,
  onSave,
  editable = true,
}: {
  note: string;
  author?: string | null;
  updatedAt?: string | null;
  onSave: (body: string) => Promise<void> | void;
  editable?: boolean;
}): JSX.Element {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(note);
  const [saving, setSaving] = useState(false);

  // Keep draft in sync when the note prop changes externally.
  useEffect(() => {
    setDraft(note);
  }, [note]);

  async function handleSave() {
    setSaving(true);
    try {
      await onSave(draft);
    } finally {
      setSaving(false);
      setEditing(false);
    }
  }

  function handleCancel() {
    setDraft(note);
    setEditing(false);
  }

  return (
    <div className="rounded-xl border border-border bg-surface p-4">
      {/* Eyebrow with pin glyph */}
      <div className="flex items-center gap-1.5 mb-3">
        <PinIcon />
        <span className="text-[11px] font-mono uppercase tracking-wider text-muted">
          Recruiter note
        </span>
      </div>

      {/* Body: view or edit mode */}
      {editing ? (
        <>
          <textarea
            autoFocus
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            className="w-full min-h-[80px] rounded-lg border border-border-strong bg-surface p-2 text-[13px] text-ink focus:outline-none focus-visible:ring-2 focus-visible:border-accent resize-y"
          />
          <div className="mt-2 flex items-center justify-end gap-2">
            <Button size="sm" variant="ghost" onClick={handleCancel} disabled={saving}>
              Cancel
            </Button>
            <Button size="sm" variant="primary" loading={saving} onClick={handleSave}>
              Save
            </Button>
          </div>
        </>
      ) : (
        <>
          {/* Clicking the note body enters edit mode when editable */}
          <div
            role={editable ? 'button' : undefined}
            tabIndex={editable ? 0 : undefined}
            onClick={editable ? () => setEditing(true) : undefined}
            onKeyDown={
              editable
                ? (e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault();
                      setEditing(true);
                    }
                  }
                : undefined
            }
            title={editable ? 'Click to edit note' : undefined}
            className={
              'text-[13px] whitespace-pre-wrap rounded-lg ' +
              (editable
                ? 'cursor-pointer hover:bg-bg-sunken transition-colors px-2 py-1.5 -mx-2 -my-1.5 focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-1 '
                : '') +
              (note ? 'text-ink-2' : 'text-muted italic')
            }
          >
            {note || 'Add a note…'}
          </div>

          {/* Footer: author + relative time */}
          {author && (
            <div className="mt-3 text-[11px] text-muted">
              {author}
              {updatedAt && (
                <>
                  {' · '}
                  <time dateTime={updatedAt}>{relativeTime(updatedAt)}</time>
                </>
              )}
            </div>
          )}
        </>
      )}
    </div>
  );
}
