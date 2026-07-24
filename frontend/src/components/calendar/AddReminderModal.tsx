import { useEffect, useState } from 'react';
import { Modal } from '../Modal';
import { Button } from '../Button';
import { FormInput } from '../FormInput';
import { DateTimePicker } from '../DateTimePicker';
import { api } from '../../services/api';
import toast from 'react-hot-toast';

/** Local "YYYY-MM-DDTHH:mm" string for a Date (for the DateTimePicker value). */
function toLocalInput(d: Date): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
}

function localToIso(v: string): string {
  if (!v) return '';
  const d = new Date(v);
  return isNaN(d.getTime()) ? '' : d.toISOString();
}

/**
 * "Set something on a date" — creates a personal reminder that shows on the
 * calendar (deadline tone). Used by the planner Calendar; it deliberately does
 * NOT schedule interviews (that's the Interviews surface's job).
 */
export function AddReminderModal({
  open,
  defaultDate,
  onClose,
  onAdded,
}: {
  open: boolean;
  defaultDate: Date;
  onClose: () => void;
  onAdded: () => void;
}): JSX.Element {
  const [title, setTitle] = useState('');
  const [whenLocal, setWhenLocal] = useState('');
  const [saving, setSaving] = useState(false);

  // Seed the date from the clicked day (default 9:00 AM) each time it opens.
  useEffect(() => {
    if (!open) return;
    const d = new Date(defaultDate);
    if (d.getHours() === 0 && d.getMinutes() === 0) d.setHours(9, 0, 0, 0);
    setWhenLocal(toLocalInput(d));
    setTitle('');
  }, [open, defaultDate]);

  function handleClose() {
    setTitle('');
    onClose();
  }

  async function save() {
    if (saving) return;
    const due_at = localToIso(whenLocal);
    if (!title.trim() || !due_at) {
      toast.error('Add a title and a date/time');
      return;
    }
    setSaving(true);
    try {
      await api.post('/reminders', { title: title.trim(), due_at });
      toast.success('Added to your calendar');
      handleClose();
      onAdded();
    } catch (e: any) {
      toast.error(e?.response?.data?.error ?? 'Could not add it. Please try again.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal
      open={open}
      onClose={handleClose}
      title="Add to calendar"
      description="A personal item on this date — a hold, a deadline, a note to yourself."
      footer={
        <>
          <Button variant="secondary" onClick={handleClose}>
            Cancel
          </Button>
          <Button onClick={save} loading={saving}>
            {saving ? 'Adding' : 'Add'}
          </Button>
        </>
      }
    >
      <div className="space-y-3">
        <FormInput
          label="Title *"
          placeholder="e.g. Block focus time, Follow up with Riley…"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          autoFocus
        />
        <DateTimePicker label="When *" value={whenLocal} onChange={setWhenLocal} />
      </div>
    </Modal>
  );
}
