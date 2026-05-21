import { useEffect, useState } from 'react';
import { Layout } from '../components/Layout';
import { DataTable } from '../components/DataTable';
import { StatusBadge } from '../components/StatusBadge';
import { Modal } from '../components/Modal';
import { FormInput } from '../components/FormInput';
import { DateTimePicker } from '../components/DateTimePicker';
import { SelectInput } from '../components/SelectInput';
import { PageHeader } from '../components/PageHeader';
import { Button } from '../components/Button';
import { api } from '../services/api';
import toast from 'react-hot-toast';

const EMPTY_FORM = {
  consultant_id: '',
  type: 'PHONE',
  scheduled_at: '',
  scheduled_at_local: '',
  interviewer: '',
  meeting_url: '',
};
const EMPTY_FEEDBACK = { rating: 3, strengths: '', weaknesses: '', notes: '' };

export function Interviews() {
  const [rows, setRows] = useState<any[]>([]);
  const [consultants, setConsultants] = useState<any[]>([]);
  const [openSchedule, setOpenSchedule] = useState(false);
  const [openMock, setOpenMock] = useState(false);
  const [openFeedback, setOpenFeedback] = useState<any | null>(null);
  const [form, setForm] = useState<any>(EMPTY_FORM);
  const [feedback, setFeedback] = useState(EMPTY_FEEDBACK);
  const [saving, setSaving] = useState(false);
  const [savingFeedback, setSavingFeedback] = useState(false);
  const [loading, setLoading] = useState(true);

  function load() {
    setLoading(true);
    api
      .get('/interviews')
      .then((r) => setRows(r.data ?? []))
      .catch((e) => toast.error(e?.response?.data?.error ?? 'Failed to load interviews'))
      .finally(() => setLoading(false));
  }
  useEffect(() => {
    let cancelled = false;
    load();
    api
      .get('/consultants')
      .then((r) => {
        if (!cancelled) setConsultants(r.data ?? []);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  async function schedule(mock = false) {
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
      if (mock) delete payload.type;
      await api.post(url, payload);
      toast.success(mock ? 'Mock scheduled' : 'Interview scheduled');
      setOpenSchedule(false);
      setOpenMock(false);
      setForm(EMPTY_FORM);
      load();
    } catch (e: any) {
      toast.error(e?.response?.data?.error ?? 'Something went wrong. Please try again.');
    } finally {
      setSaving(false);
    }
  }

  async function submitFeedback() {
    if (!openFeedback?.id || savingFeedback) return;
    if (feedback.rating < 1 || feedback.rating > 5) {
      toast.error('Rating must be between 1 and 5');
      return;
    }
    setSavingFeedback(true);
    try {
      await api.post(`/interviews/${openFeedback.id}/feedback`, { feedback });
      toast.success('Feedback saved');
      setOpenFeedback(null);
      setFeedback(EMPTY_FEEDBACK);
      load();
    } catch (e: any) {
      toast.error(e?.response?.data?.error ?? 'Something went wrong. Please try again.');
    } finally {
      setSavingFeedback(false);
    }
  }

  return (
    <Layout title="Interviews">
      <PageHeader
        title="Interviews"
        description="Real and mock interview rounds — feedback rolls up into the consultant pipeline report."
        action={
          <>
            <Button variant="secondary" onClick={() => setOpenMock(true)}>
              + Mock
            </Button>
            <Button onClick={() => setOpenSchedule(true)}>+ Schedule interview</Button>
          </>
        }
      />
      <DataTable
        loading={loading}
        empty="No interviews yet."
        columns={[
          {
            key: 'consultant',
            header: 'Consultant',
            render: (i: any) => i.consultant?.user?.full_name ?? i.consultant?.user?.email ?? '—',
          },
          { key: 'type', header: 'Type' },
          {
            key: 'when',
            header: 'When',
            render: (i: any) => (i.scheduled_at ? new Date(i.scheduled_at).toLocaleString() : '—'),
          },
          { key: 'interviewer', header: 'Interviewer' },
          {
            key: 'mock',
            header: 'Mock?',
            render: (i: any) =>
              i.is_mock ? (
                <span className="text-[11px] font-medium bg-amber-50 dark:bg-amber-500/15 text-amber-700 dark:text-amber-300 px-1.5 py-0.5 rounded">
                  Mock
                </span>
              ) : (
                <span className="text-muted text-xs">—</span>
              ),
          },
          {
            key: 'status',
            header: 'Status',
            render: (i: any) => <StatusBadge status={i.status} />,
          },
          {
            key: 'fb',
            header: '',
            align: 'right',
            render: (i: any) => (
              <Button size="sm" variant="ghost" onClick={() => setOpenFeedback(i)}>
                Feedback
              </Button>
            ),
          },
        ]}
        rows={rows}
      />

      <Modal
        open={openSchedule || openMock}
        onClose={() => {
          setOpenSchedule(false);
          setOpenMock(false);
          setForm(EMPTY_FORM);
        }}
        title={openMock ? 'Schedule mock interview' : 'Schedule interview'}
        description={
          openMock
            ? 'Internal practice run — feedback only.'
            : 'Records on the consultant timeline and calendar.'
        }
        footer={
          <>
            <Button
              variant="secondary"
              onClick={() => {
                setOpenSchedule(false);
                setOpenMock(false);
                setForm(EMPTY_FORM);
              }}
            >
              Cancel
            </Button>
            <Button onClick={() => schedule(openMock)} loading={saving}>
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
          {!openMock && (
            <SelectInput
              label="Type"
              value={form.type}
              options={[
                { value: 'PHONE', label: 'Phone' },
                { value: 'TECHNICAL', label: 'Technical' },
                { value: 'BEHAVIORAL', label: 'Behavioral' },
                { value: 'ONSITE', label: 'Onsite' },
                { value: 'FINAL', label: 'Final' },
              ]}
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

      <Modal
        open={!!openFeedback}
        onClose={() => {
          setOpenFeedback(null);
          setFeedback(EMPTY_FEEDBACK);
        }}
        title="Interview feedback"
        description="Captured against the interview record. Rolls into pipeline reports."
        footer={
          <>
            <Button
              variant="secondary"
              onClick={() => {
                setOpenFeedback(null);
                setFeedback(EMPTY_FEEDBACK);
              }}
            >
              Cancel
            </Button>
            <Button onClick={submitFeedback} loading={savingFeedback}>
              {savingFeedback ? 'Saving' : 'Save feedback'}
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
    </Layout>
  );
}

function localToIso(v: string): string {
  if (!v) return '';
  const withSeconds = /:\d{2}$/.test(v) && v.length === 16 ? `${v}:00` : v;
  const d = new Date(withSeconds);
  return isNaN(d.getTime()) ? '' : d.toISOString();
}
