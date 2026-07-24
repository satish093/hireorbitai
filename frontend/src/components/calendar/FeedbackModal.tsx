import { useEffect, useState } from 'react';
import { Modal } from '../Modal';
import { Button } from '../Button';
import { FormInput } from '../FormInput';
import { api } from '../../services/api';
import toast from 'react-hot-toast';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const EMPTY_FEEDBACK = { rating: 3, strengths: '', weaknesses: '', notes: '' };

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function FeedbackModal({
  interview,
  onClose,
  onSaved,
}: {
  interview: { id: string; title?: string } | null;
  onClose: () => void;
  onSaved: () => void;
}): JSX.Element {
  const [feedback, setFeedback] = useState(EMPTY_FEEDBACK);
  const [saving, setSaving] = useState(false);

  // Reset feedback state whenever the modal opens for a new interview
  useEffect(() => {
    setFeedback(EMPTY_FEEDBACK);
  }, [interview?.id]);

  function handleClose() {
    setFeedback(EMPTY_FEEDBACK);
    onClose();
  }

  async function submit() {
    if (!interview?.id || saving) return;
    if (feedback.rating < 1 || feedback.rating > 5) {
      toast.error('Rating must be between 1 and 5');
      return;
    }
    setSaving(true);
    try {
      await api.post(`/interviews/${interview.id}/feedback`, { feedback });
      toast.success('Feedback saved');
      setFeedback(EMPTY_FEEDBACK);
      onClose();
      onSaved();
    } catch (e: any) {
      toast.error(e?.response?.data?.error ?? 'Something went wrong. Please try again.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal
      open={interview !== null}
      onClose={handleClose}
      title="Interview feedback"
      description="Captured against the interview record. Rolls into pipeline reports."
      footer={
        <>
          <Button variant="secondary" onClick={handleClose}>
            Cancel
          </Button>
          <Button onClick={submit} loading={saving}>
            {saving ? 'Saving' : 'Save feedback'}
          </Button>
        </>
      }
    >
      <div className="space-y-3">
        <FormInput
          label="Rating (1–5)"
          type="number"
          min={1}
          max={5}
          value={feedback.rating}
          onChange={(e) => {
            const v = e.target.value;
            setFeedback({ ...feedback, rating: v === '' ? 0 : Number(v) });
          }}
        />
        <FormInput
          label="Strengths"
          value={feedback.strengths}
          onChange={(e) => setFeedback({ ...feedback, strengths: e.target.value })}
        />
        <FormInput
          label="Weaknesses"
          value={feedback.weaknesses}
          onChange={(e) => setFeedback({ ...feedback, weaknesses: e.target.value })}
        />
        <label className="block">
          <span className="block text-xs font-medium text-ink mb-1.5">Notes</span>
          <textarea
            placeholder="Anything else worth capturing"
            value={feedback.notes}
            onChange={(e) => setFeedback({ ...feedback, notes: e.target.value })}
            className="w-full rounded-lg border border-border hover:border-muted bg-surface px-3 py-2 text-sm shadow-sm focus:outline-none focus:ring-2 focus:ring-brand-500/30 focus:border-brand-500"
            rows={3}
          />
        </label>
      </div>
    </Modal>
  );
}
