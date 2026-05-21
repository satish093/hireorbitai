import { ReactNode, useEffect, useState } from 'react';
import { Modal } from '../Modal';
import { Button } from '../Button';

export interface ConfirmSpec {
  title: string;
  message: ReactNode;
  confirmLabel: string;
  tone?: 'danger' | 'default';
  /** If set, the user must type this exact phrase to enable the confirm
   *  button — used for bulk destructive actions. */
  requireTyped?: string;
  run: () => Promise<void>;
}

/**
 * Single confirm dialog driven by a ConfirmSpec. Always names the action
 * explicitly in its title/message (the caller builds the copy). When
 * `requireTyped` is set the confirm button stays disabled until the phrase is
 * typed verbatim — the guard against an accidental bulk deactivate.
 */
export function ConfirmDialog({
  spec,
  onClose,
}: {
  spec: ConfirmSpec | null;
  onClose: () => void;
}) {
  const [typed, setTyped] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    setTyped('');
    setBusy(false);
  }, [spec]);

  if (!spec) return null;
  const needsType = !!spec.requireTyped;
  const canConfirm = !needsType || typed.trim() === spec.requireTyped;

  async function confirm() {
    if (!spec || busy || !canConfirm) return;
    setBusy(true);
    try {
      await spec.run();
      onClose();
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal
      open
      onClose={onClose}
      title={spec.title}
      size="sm"
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button
            variant={spec.tone === 'danger' ? 'danger' : 'primary'}
            onClick={confirm}
            loading={busy}
            disabled={!canConfirm}
          >
            {spec.confirmLabel}
          </Button>
        </>
      }
    >
      <div className="space-y-3 text-sm text-ink-2">
        <div>{spec.message}</div>
        {needsType && (
          <label className="block">
            <span className="block text-xs text-muted mb-1.5">
              Type <span className="font-mono font-semibold text-ink">{spec.requireTyped}</span> to
              confirm
            </span>
            <input
              value={typed}
              onChange={(e) => setTyped(e.target.value)}
              autoFocus
              className="w-full h-9 px-3 rounded-lg border border-border bg-surface text-sm text-ink focus:outline-none focus-visible:ring-2 focus-visible:ring-danger/40 focus-visible:border-danger"
            />
          </label>
        )}
      </div>
    </Modal>
  );
}
