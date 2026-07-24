import { useEffect, useState } from 'react';
import { Button } from '../Button';
import { Modal } from '../Modal';
import { SelectInput } from '../SelectInput';
import { FormInput } from '../FormInput';
import { api } from '../../services/api';
import toast from 'react-hot-toast';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface DailyRow {
  id?: string;
  recruiter_id: string;
  activity_date: string;
  submissions_count: number;
  interviews_scheduled: number;
  interviews_completed: number;
  vendor_calls: number;
  offers: number;
  placements: number;
  notes?: string;
}

interface RecruiterOption {
  id: string;
  user?: {
    full_name?: string | null;
    email?: string | null;
  } | null;
}

interface FormState {
  recruiter_id: string;
  activity_date: string;
  submissions_count: number;
  interviews_scheduled: number;
  interviews_completed: number;
  vendor_calls: number;
  offers: number;
  placements: number;
  notes: string;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function localYMD(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function blankForm(): FormState {
  return {
    recruiter_id: '',
    activity_date: localYMD(new Date()),
    submissions_count: 0,
    interviews_scheduled: 0,
    interviews_completed: 0,
    vendor_calls: 0,
    offers: 0,
    placements: 0,
    notes: '',
  };
}

// ---------------------------------------------------------------------------
// DailyActivityReport — public export
// ---------------------------------------------------------------------------

export function DailyActivityReport(): JSX.Element {
  const [rows, setRows] = useState<DailyRow[]>([]);
  const [recruiters, setRecruiters] = useState<RecruiterOption[]>([]);
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState<FormState>(blankForm);

  // ---- initial load --------------------------------------------------------

  function loadRows() {
    api
      .get('/reports/daily')
      .then((r) => setRows((r.data ?? []) as DailyRow[]))
      .catch((e: any) => toast.error(e?.response?.data?.error ?? 'Failed to load daily activity'));
  }

  useEffect(() => {
    loadRows();
    api
      .get('/recruiters')
      .then((r) => setRecruiters((r.data ?? []) as RecruiterOption[]))
      .catch((e: any) => toast.error(e?.response?.data?.error ?? 'Failed to load recruiters'));
  }, []);

  // ---- open / close --------------------------------------------------------

  function openModal() {
    setForm(blankForm());
    setOpen(true);
  }

  function closeModal() {
    setOpen(false);
  }

  // ---- save ----------------------------------------------------------------

  async function save() {
    if (saving) return;
    if (!form.recruiter_id) {
      toast.error('Pick a recruiter');
      return;
    }
    setSaving(true);
    try {
      await api.post('/reports/daily', form);
      toast.success('Saved');
      closeModal();
      loadRows();
    } catch (e: any) {
      toast.error(e?.response?.data?.error ?? 'Failed to save');
    } finally {
      setSaving(false);
    }
  }

  // ---- recruiter lookup ----------------------------------------------------

  function recruiterName(id: string): string {
    const rec = recruiters.find((r) => r.id === id);
    return rec?.user?.full_name ?? rec?.user?.email ?? id;
  }

  // ---- recruiter select options -------------------------------------------

  const recruiterOptions = recruiters.map((r) => ({
    value: r.id,
    label: r.user?.full_name ?? r.user?.email ?? r.id,
  }));

  // ---- number field helper -------------------------------------------------

  function numField(key: keyof FormState, label: string) {
    return (
      <FormInput
        label={label}
        type="number"
        min={0}
        value={form[key] as number}
        onChange={(e) =>
          setForm((prev) => ({
            ...prev,
            [key]: e.target.value === '' ? 0 : Number(e.target.value),
          }))
        }
      />
    );
  }

  // ---- render --------------------------------------------------------------

  return (
    <div className="space-y-4">
      {/* Action bar */}
      <div className="flex justify-end">
        <Button variant="primary" onClick={openModal}>
          + Log activity
        </Button>
      </div>

      {/* Table card */}
      <div className="rounded-xl border border-border bg-surface">
        <div className="px-4 py-3 border-b border-border">
          <h3 className="text-sm font-semibold text-ink">Daily activity log</h3>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border bg-bg-sunken">
                <th className="px-3 py-2.5 text-left text-xs font-medium text-muted uppercase tracking-wide whitespace-nowrap">
                  Date
                </th>
                <th className="px-3 py-2.5 text-left text-xs font-medium text-muted uppercase tracking-wide whitespace-nowrap">
                  Recruiter
                </th>
                <th className="px-3 py-2.5 text-right text-xs font-medium text-muted uppercase tracking-wide whitespace-nowrap">
                  Subs
                </th>
                <th className="px-3 py-2.5 text-right text-xs font-medium text-muted uppercase tracking-wide whitespace-nowrap">
                  Int. Sched
                </th>
                <th className="px-3 py-2.5 text-right text-xs font-medium text-muted uppercase tracking-wide whitespace-nowrap">
                  Int. Done
                </th>
                <th className="px-3 py-2.5 text-right text-xs font-medium text-muted uppercase tracking-wide whitespace-nowrap">
                  Vendor calls
                </th>
                <th className="px-3 py-2.5 text-right text-xs font-medium text-muted uppercase tracking-wide whitespace-nowrap">
                  Offers
                </th>
                <th className="px-3 py-2.5 text-right text-xs font-medium text-muted uppercase tracking-wide whitespace-nowrap">
                  Placements
                </th>
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 ? (
                <tr>
                  <td colSpan={8} className="py-10 text-center text-muted text-sm">
                    No daily logs yet.
                  </td>
                </tr>
              ) : (
                rows.map((row, idx) => (
                  <tr
                    key={row.id ?? idx}
                    className="border-b border-border last:border-0 hover:bg-hover transition-colors"
                  >
                    <td className="px-3 py-2.5 tabular-nums text-ink-2 whitespace-nowrap">
                      {row.activity_date}
                    </td>
                    <td className="px-3 py-2.5 text-ink whitespace-nowrap">
                      {recruiterName(row.recruiter_id)}
                    </td>
                    <td className="px-3 py-2.5 text-right tabular-nums text-ink-2">
                      {row.submissions_count ?? 0}
                    </td>
                    <td className="px-3 py-2.5 text-right tabular-nums text-ink-2">
                      {row.interviews_scheduled ?? 0}
                    </td>
                    <td className="px-3 py-2.5 text-right tabular-nums text-ink-2">
                      {row.interviews_completed ?? 0}
                    </td>
                    <td className="px-3 py-2.5 text-right tabular-nums text-ink-2">
                      {row.vendor_calls ?? 0}
                    </td>
                    <td className="px-3 py-2.5 text-right tabular-nums text-ink-2">
                      {row.offers ?? 0}
                    </td>
                    <td className="px-3 py-2.5 text-right tabular-nums text-ink-2">
                      {row.placements ?? 0}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Log activity modal */}
      <Modal
        open={open}
        onClose={closeModal}
        title="Log daily activity"
        footer={
          <Button variant="primary" loading={saving} onClick={save}>
            Save
          </Button>
        }
      >
        <div className="space-y-4">
          <SelectInput
            label="Recruiter"
            value={form.recruiter_id}
            options={recruiterOptions}
            placeholder="Select…"
            onChange={(e) => setForm((prev) => ({ ...prev, recruiter_id: e.target.value }))}
          />

          <FormInput
            label="Date"
            type="date"
            value={form.activity_date}
            onChange={(e) => setForm((prev) => ({ ...prev, activity_date: e.target.value }))}
          />

          <div className="grid grid-cols-2 gap-3">
            {numField('submissions_count', 'Submissions')}
            {numField('interviews_scheduled', 'Interviews scheduled')}
            {numField('interviews_completed', 'Interviews completed')}
            {numField('vendor_calls', 'Vendor calls')}
            {numField('offers', 'Offers')}
            {numField('placements', 'Placements')}
          </div>
        </div>
      </Modal>
    </div>
  );
}
