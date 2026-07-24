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

/** ISO (or Date) → local "YYYY-MM-DDTHH:mm" for the DateTimePicker. */
function isoToLocal(iso?: string | null): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return '';
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export interface EditInterview {
  id: string;
  consultant_id?: string | null;
  consultant_name?: string | null;
  type?: string | null;
  scheduled_at?: string | null;
  interviewer?: string | null;
  meeting_url?: string | null;
  duration_minutes?: number | null;
  notes?: string | null;
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
  duration_minutes: '',
  notes: '',
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
  defaultStartLocal,
  editInterview,
}: {
  open: boolean;
  mock: boolean;
  onClose: () => void;
  onScheduled: () => void;
  /** Prefill the "When" field (local "YYYY-MM-DDTHH:mm") — used by click-to-create. */
  defaultStartLocal?: string;
  /** When set, the modal edits an existing interview (PATCH) instead of creating. */
  editInterview?: EditInterview | null;
}): JSX.Element {
  const [consultants, setConsultants] = useState<any[]>([]);
  const [form, setForm] = useState<typeof EMPTY_FORM>(EMPTY_FORM);
  const [saving, setSaving] = useState(false);
  const isEdit = !!editInterview;

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

  // Seed the form when (re)opened — from the edited interview, or a prefilled
  // start time, or empty.
  useEffect(() => {
    if (!open) return;
    if (editInterview) {
      const local = isoToLocal(editInterview.scheduled_at);
      setForm({
        consultant_id: editInterview.consultant_id ?? '',
        type: editInterview.type ?? 'PHONE',
        scheduled_at: localToIso(local),
        scheduled_at_local: local,
        interviewer: editInterview.interviewer ?? '',
        meeting_url: editInterview.meeting_url ?? '',
        duration_minutes:
          editInterview.duration_minutes != null ? String(editInterview.duration_minutes) : '',
        notes: editInterview.notes ?? '',
      });
    } else if (defaultStartLocal) {
      setForm({
        ...EMPTY_FORM,
        scheduled_at_local: defaultStartLocal,
        scheduled_at: localToIso(defaultStartLocal),
      });
    } else {
      setForm(EMPTY_FORM);
    }
  }, [open, editInterview, defaultStartLocal]);

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
      const dur = parseInt(form.duration_minutes, 10);
      if (isEdit && editInterview) {
        // Edit/reschedule: PATCH only the mutable fields (type + consultant are
        // immutable server-side and excluded from updateSchema). duration is
        // sent only when a value is entered, so leaving it blank doesn't wipe it.
        const patch: Record<string, unknown> = {
          scheduled_at: form.scheduled_at,
          interviewer: form.interviewer || null,
          meeting_url: form.meeting_url || null,
          notes: form.notes || null,
        };
        if (Number.isFinite(dur)) patch.duration_minutes = dur;
        await api.patch(`/interviews/${editInterview.id}`, patch);
        toast.success('Interview updated');
      } else {
        const url = mock ? '/interviews/mock' : '/interviews';
        const { scheduled_at_local: _slocal, duration_minutes: _dm, ...rest } = form;
        void _slocal;
        void _dm;
        const payload: Record<string, unknown> = { ...rest, notes: form.notes || null };
        if (Number.isFinite(dur)) payload.duration_minutes = dur;
        if (mock) delete (payload as any).type;
        await api.post(url, payload);
        toast.success(mock ? 'Mock scheduled' : 'Interview scheduled');
      }
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
      title={
        isEdit
          ? 'Reschedule / edit interview'
          : mock
            ? 'Schedule mock interview'
            : 'Schedule interview'
      }
      description={
        isEdit
          ? 'Update the time, interviewer, or meeting link.'
          : mock
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
          disabled={isEdit}
          options={
            isEdit && editInterview
              ? [
                  {
                    value: editInterview.consultant_id ?? '',
                    label: editInterview.consultant_name ?? 'Consultant',
                  },
                ]
              : consultants.map((c) => ({
                  value: c.id,
                  label: c.user?.full_name ?? c.user?.email,
                }))
          }
          onChange={(e) => setForm({ ...form, consultant_id: e.target.value })}
        />
        {!mock && !isEdit && (
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
            label="Duration (minutes)"
            type="number"
            min={0}
            placeholder="60"
            value={form.duration_minutes}
            onChange={(e) => setForm({ ...form, duration_minutes: e.target.value })}
          />
        </div>
        <FormInput
          label="Meeting URL"
          placeholder="https://meet.google.com/…"
          value={form.meeting_url}
          onChange={(e) => setForm({ ...form, meeting_url: e.target.value })}
        />
        <label className="block">
          <span className="block text-xs font-medium text-ink mb-1.5">Notes</span>
          <textarea
            value={form.notes}
            onChange={(e) => setForm({ ...form, notes: e.target.value })}
            rows={3}
            className="w-full rounded-lg border border-border hover:border-muted bg-surface px-3 py-2 text-sm shadow-sm focus:outline-none focus:ring-2 focus:ring-brand-500/30 focus:border-brand-500"
          />
        </label>
      </div>
    </Modal>
  );
}
