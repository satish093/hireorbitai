import { useEffect, useState } from 'react';
import { Modal } from '../Modal';
import { Button } from '../Button';
import { FormInput } from '../FormInput';
import { SelectInput } from '../SelectInput';
import { DateTimePicker } from '../DateTimePicker';
import { api } from '../../services/api';
import toast from 'react-hot-toast';

// ---------------------------------------------------------------------------
// Helper
// ---------------------------------------------------------------------------

function localToIso(v: string): string {
  if (!v) return '';
  const withSeconds = /:\d{2}$/.test(v) && v.length === 16 ? `${v}:00` : v;
  const d = new Date(withSeconds);
  return isNaN(d.getTime()) ? '' : d.toISOString();
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const EMPTY_FORM = {
  consultant_id: '',
  type: 'PHONE',
  scheduled_at: '',
  scheduled_at_local: '',
  interviewer: '',
  meeting_url: '',
};

const TYPE_OPTIONS = [
  { value: 'PHONE', label: 'Phone' },
  { value: 'TECHNICAL', label: 'Technical' },
  { value: 'BEHAVIORAL', label: 'Behavioral' },
  { value: 'ONSITE', label: 'Onsite' },
  { value: 'FINAL', label: 'Final' },
];

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function ScheduleModal({
  open,
  mock,
  onClose,
  onScheduled,
}: {
  open: boolean;
  mock: boolean;
  onClose: () => void;
  onScheduled: () => void;
}): JSX.Element {
  const [consultants, setConsultants] = useState<any[]>([]);
  const [form, setForm] = useState<typeof EMPTY_FORM>(EMPTY_FORM);
  const [saving, setSaving] = useState(false);

  // Fetch consultants once when the modal first opens
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    api
      .get('/consultants')
      .then((r) => {
        if (!cancelled) setConsultants(r.data ?? []);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [open]);

  function handleClose() {
    setForm(EMPTY_FORM);
    onClose();
  }

  async function save() {
    if (saving) return;
    if (!form.consultant_id || !form.scheduled_at) {
      toast.error('Pick a consultant and a date/time');
      return;
    }
    setSaving(true);
    try {
      const url = mock ? '/interviews/mock' : '/interviews';
      const { scheduled_at_local: _slocal, ...payload } = form;
      void _slocal;
      if (mock) delete (payload as any).type;
      await api.post(url, payload);
      toast.success(mock ? 'Mock scheduled' : 'Interview scheduled');
      setForm(EMPTY_FORM);
      onClose();
      onScheduled();
    } catch (e: any) {
      toast.error(e?.response?.data?.error ?? 'Something went wrong. Please try again.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal
      open={open}
      onClose={handleClose}
      title={mock ? 'Schedule mock interview' : 'Schedule interview'}
      description={
        mock
          ? 'Internal practice run — feedback only.'
          : 'Records on the consultant timeline and calendar.'
      }
      footer={
        <>
          <Button variant="secondary" onClick={handleClose}>
            Cancel
          </Button>
          <Button onClick={save} loading={saving}>
            {saving ? 'Saving' : 'Save'}
          </Button>
        </>
      }
    >
      <div className="space-y-3">
        <SelectInput
          label="Consultant *"
          placeholder="Select a consultant…"
          value={form.consultant_id}
          options={consultants.map((c) => ({
            value: c.id,
            label: c.user?.full_name ?? c.user?.email,
          }))}
          onChange={(e) => setForm({ ...form, consultant_id: e.target.value })}
        />
        {!mock && (
          <SelectInput
            label="Type"
            value={form.type}
            options={TYPE_OPTIONS}
            onChange={(e) => setForm({ ...form, type: e.target.value })}
          />
        )}
        <DateTimePicker
          label="When *"
          value={form.scheduled_at_local ?? ''}
          onChange={(v) =>
            setForm({
              ...form,
              scheduled_at_local: v,
              scheduled_at: localToIso(v),
            })
          }
        />
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <FormInput
            label="Interviewer"
            value={form.interviewer}
            onChange={(e) => setForm({ ...form, interviewer: e.target.value })}
          />
          <FormInput
            label="Meeting URL"
            placeholder="https://meet.google.com/…"
            value={form.meeting_url}
            onChange={(e) => setForm({ ...form, meeting_url: e.target.value })}
          />
        </div>
      </div>
    </Modal>
  );
}
