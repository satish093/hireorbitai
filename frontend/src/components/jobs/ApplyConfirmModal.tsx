import { createPortal } from 'react-dom';
import { Button } from '../Button';
import type { JobRow } from './types';

export function ApplyConfirmModal({
  job,
  onClose,
  onConfirm,
}: {
  job: JobRow;
  onClose: () => void;
  onConfirm: (yes: boolean) => void;
}) {
  return createPortal(
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 backdrop-blur-sm p-3 sm:p-6"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
    >
      <div
        className="bg-surface rounded-2xl shadow-xl w-full max-w-md p-6 max-h-[calc(100dvh-1.5rem)] sm:max-h-[calc(100dvh-3rem)] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="text-base font-semibold text-ink mb-1">Did you apply?</h2>
        <p className="text-sm text-muted mb-4">
          We just opened the apply page for <strong>{job.title}</strong>
          {job.company_name ? (
            <>
              {' '}
              at <strong>{job.company_name}</strong>
            </>
          ) : null}
          . Confirm Yes to record this submission against the consultant.
        </p>
        <div className="flex justify-end gap-2">
          <Button variant="outline" size="md" onClick={() => onConfirm(false)}>
            No, not yet
          </Button>
          <Button variant="accent" size="md" onClick={() => onConfirm(true)}>
            Yes, applied
          </Button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
