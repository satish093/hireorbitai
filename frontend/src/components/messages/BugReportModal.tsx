import { useState } from 'react';
import toast from 'react-hot-toast';
import { Modal } from '../Modal';
import { Button } from '../Button';
import { FormInput } from '../FormInput';
import { SelectInput } from '../SelectInput';
import { api } from '../../services/api';

const SEVERITIES = [
  { value: 'low', label: 'Low' },
  { value: 'medium', label: 'Medium' },
  { value: 'high', label: 'High' },
  { value: 'critical', label: 'Critical' },
];

/**
 * Structured bug-report form → POST /support/tickets. Reusable across the
 * trigger points in the comms spec (context panel, mobile context sheet, …).
 * The current page URL is auto-attached; the reporter is set server-side.
 */
export function BugReportModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [severity, setSeverity] = useState('low');
  const [summary, setSummary] = useState('');
  const [steps, setSteps] = useState('');
  const [saving, setSaving] = useState(false);

  async function submit() {
    if (summary.trim().length < 3) {
      toast.error('Please add a short summary');
      return;
    }
    setSaving(true);
    try {
      await api.post('/support/tickets', {
        severity,
        summary: summary.trim(),
        steps: steps.trim() || undefined,
        page_url: window.location.href,
      });
      toast.success('Bug report sent — thank you!');
      setSummary('');
      setSteps('');
      setSeverity('low');
      onClose();
    } catch (e: unknown) {
      const msg =
        (e as { response?: { data?: { error?: string } } })?.response?.data?.error ??
        'Could not send the report';
      toast.error(msg);
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Report an issue"
      description="Tell us what went wrong — it goes straight to the dev team."
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" onClick={submit} loading={saving}>
            {saving ? 'Sending…' : 'Send report'}
          </Button>
        </>
      }
    >
      <div className="space-y-3">
        <SelectInput
          label="Severity"
          value={severity}
          onChange={(e) => setSeverity(e.target.value)}
          options={SEVERITIES}
        />
        <FormInput
          label="Summary *"
          placeholder="Briefly, what happened?"
          value={summary}
          onChange={(e) => setSummary(e.target.value)}
        />
        <div>
          <label className="block text-xs font-medium text-muted mb-1">
            Steps to reproduce (optional)
          </label>
          <textarea
            value={steps}
            onChange={(e) => setSteps(e.target.value)}
            rows={4}
            placeholder="1. Go to…  2. Click…  3. See…"
            className="w-full rounded-lg px-3 py-2 resize-none outline-none focus:ring-2 focus:ring-brand-500/40"
            style={{
              background: 'var(--surface-2)',
              border: '1px solid var(--border)',
              color: 'var(--ink)',
              fontSize: 16,
            }}
          />
        </div>
        <p className="text-[11px] text-muted">
          We'll attach the current page automatically:{' '}
          <span className="font-mono break-all">{window.location.pathname}</span>
        </p>
      </div>
    </Modal>
  );
}
