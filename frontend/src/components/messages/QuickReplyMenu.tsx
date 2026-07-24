import { Popover } from '../ui/Popover';

interface Props {
  /** Display name of the conversation peer (used for the {{name}} merge field). */
  peerName: string;
  /** Display name of the signed-in user (used for the {{my_name}} merge field). */
  myName: string;
  /** Insert resolved text into the composer draft. */
  onInsert: (text: string) => void;
}

/** One-tap canned lines. */
const QUICK_REPLIES = [
  'Thanks!',
  'Sounds good 👍',
  'Got it — will follow up shortly.',
  'Let me check and get back to you.',
];

/**
 * Reusable templates with `{{merge}}` fields. Supported tokens: {{name}} (the
 * peer's first name) and {{my_name}} (the sender's first name). Resolved at
 * insert time so the composer receives ready-to-send copy the user can still
 * edit before sending.
 */
const TEMPLATES: { label: string; body: string }[] = [
  {
    label: 'Resume request',
    body: 'Hi {{name}}, could you share your latest resume so I can submit you for a role? Thanks — {{my_name}}',
  },
  {
    label: 'Interview confirmation',
    body: "Hi {{name}}, confirming your interview is scheduled — I'll send the details shortly. Best, {{my_name}}",
  },
  {
    label: 'Submission update',
    body: "Hi {{name}}, quick update: I've submitted your profile and will let you know as soon as I hear back. — {{my_name}}",
  },
  {
    label: 'Availability check-in',
    body: 'Hi {{name}}, just checking in on your availability and interest right now. Let me know! — {{my_name}}',
  },
];

function firstName(full: string, fallback: string): string {
  const t = full?.trim().split(/\s+/)[0];
  return t || fallback;
}

function LightningIcon() {
  return (
    <svg
      width="18"
      height="18"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2" />
    </svg>
  );
}

/**
 * Composer affordance: quick replies + `{{merge}}` templates. Permission-neutral
 * (it only inserts text into the caller's own draft); the server still enforces
 * who may receive the message on send.
 */
export function QuickReplyMenu({ peerName, myName, onInsert }: Props) {
  const name = firstName(peerName, 'there');
  const myFirst = firstName(myName, '');
  const resolve = (t: string) =>
    t
      .replace(/\{\{\s*name\s*\}\}/g, name)
      .replace(/\{\{\s*my_name\s*\}\}/g, myFirst)
      .trim();

  return (
    <Popover
      align="left"
      button={(open) => (
        <button
          type="button"
          aria-label="Quick replies and templates"
          aria-expanded={open}
          className="shrink-0 h-10 w-10 flex items-center justify-center rounded-full text-muted hover:text-ink hover:bg-hover transition-colors"
        >
          <LightningIcon />
        </button>
      )}
    >
      {(close) => (
        <div className="w-[260px]">
          <div className="px-1 pb-1.5 text-[10px] font-semibold uppercase tracking-wider text-muted">
            Quick replies
          </div>
          <div className="flex flex-wrap gap-1.5 mb-2.5">
            {QUICK_REPLIES.map((q) => (
              <button
                key={q}
                type="button"
                onClick={() => {
                  onInsert(q);
                  close();
                }}
                className="text-xs px-2 py-1 rounded-full bg-hover text-ink-2 hover:bg-brand-soft hover:text-brand-on-soft transition-colors"
              >
                {q}
              </button>
            ))}
          </div>
          <div className="px-1 pb-1.5 pt-2 border-t border-border text-[10px] font-semibold uppercase tracking-wider text-muted">
            Templates
          </div>
          <div className="space-y-0.5">
            {TEMPLATES.map((t) => (
              <button
                key={t.label}
                type="button"
                onClick={() => {
                  onInsert(resolve(t.body));
                  close();
                }}
                className="w-full text-left px-2 py-1.5 rounded-md hover:bg-hover transition-colors"
              >
                <div className="text-[13px] font-medium text-ink">{t.label}</div>
                <div className="text-[11px] text-muted truncate">{resolve(t.body)}</div>
              </button>
            ))}
          </div>
        </div>
      )}
    </Popover>
  );
}
