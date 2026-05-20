interface Props {
  consultantName: string;
  jobTitle: string;
  status: string;
  submittedAt?: string | null;
  onConfirm: () => void;
  onCancel: () => void;
}

/**
 * Styled "Submit again?" warning — replaces window.confirm() which renders
 * an ugly OS-native dialog.
 */
export function DuplicateSubmissionModal({
  consultantName,
  jobTitle,
  status,
  submittedAt,
  onConfirm,
  onCancel,
}: Props) {
  return (
    <div
      className="fixed inset-0 z-50 bg-slate-900/55 flex items-center justify-center p-4"
      onClick={onCancel}
    >
      <div
        className="bg-white rounded-2xl shadow-xl w-full max-w-md overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="px-6 pt-6 pb-4 flex items-start gap-3">
          <div className="w-10 h-10 rounded-full bg-amber-100 text-amber-700 flex items-center justify-center text-xl shrink-0">
            ⚠
          </div>
          <div className="flex-1 min-w-0">
            <h2 className="text-base font-semibold text-slate-900">Already submitted</h2>
            <p className="text-sm text-slate-600 mt-1 leading-relaxed">
              <strong>{consultantName}</strong> has already been submitted to{' '}
              <strong className="text-slate-900">{jobTitle}</strong>.
            </p>
            <div className="mt-3 flex items-center gap-2 flex-wrap">
              <span className="text-[10px] font-semibold uppercase tracking-widest bg-amber-50 text-amber-800 border border-amber-100 px-2 py-0.5 rounded">
                Status: {status}
              </span>
              {submittedAt && (
                <span className="text-xs text-slate-500">
                  on{' '}
                  {new Date(submittedAt).toLocaleDateString(undefined, {
                    year: 'numeric',
                    month: 'short',
                    day: 'numeric',
                  })}
                </span>
              )}
            </div>
          </div>
        </div>
        <p className="px-6 pb-5 text-xs text-slate-500 leading-relaxed">
          Submitting again will create a second application record. Most vendors only consider the
          first submission. Continue only if the vendor has explicitly asked for a re-submit.
        </p>
        <div className="px-6 py-3 border-t border-slate-100 bg-slate-50 flex items-center justify-end gap-2">
          <button
            onClick={onCancel}
            className="border border-slate-200 text-slate-700 text-sm font-medium px-4 py-2 rounded-lg hover:bg-white"
          >
            Cancel
          </button>
          <button
            onClick={onConfirm}
            className="bg-rose-500 hover:bg-rose-600 text-white text-sm font-semibold px-4 py-2 rounded-lg"
          >
            Submit again
          </button>
        </div>
      </div>
    </div>
  );
}
