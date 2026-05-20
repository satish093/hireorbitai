import { useEffect, useState } from 'react';
import { Layout } from '../components/Layout';
import { DataTable } from '../components/DataTable';
import { Modal } from '../components/Modal';
import { StatusBadge } from '../components/StatusBadge';
import { FormInput } from '../components/FormInput';
import { DateTimePicker } from '../components/DateTimePicker';
import { PageHeader } from '../components/PageHeader';
import { Button } from '../components/Button';
import { api } from '../services/api';
import toast from 'react-hot-toast';

export function Reminders() {
  const [rows, setRows] = useState<any[]>([]);
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState<any>({});
  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(true);

  function load() {
    setLoading(true);
    api
      .get('/reminders')
      .then((r) => setRows(r.data ?? []))
      .catch((e) => toast.error(e?.response?.data?.error ?? 'Failed to load reminders'))
      .finally(() => setLoading(false));
  }
  useEffect(() => {
    load();
  }, []);

  async function save() {
    if (saving) return;
    if (!form.title || !form.due_at) {
      toast.error('Title and due date are required');
      return;
    }
    setSaving(true);
    try {
      // Strip the local-only mirror field before POST. `due_at_local` is the
      // raw `YYYY-MM-DDTHH:mm` string we pass to the picker; the server only
      // wants `due_at` (ISO with timezone). Sending the extra field can hit
      // strict-schema rejections or just bloat the payload.
      const { due_at_local: _local, ...payload } = form;
      void _local;
      await api.post('/reminders', payload);
      toast.success('Reminder added');
      setOpen(false);
      setForm({});
      load();
    } catch (e: any) {
      toast.error(e?.response?.data?.error ?? 'Failed');
    } finally {
      setSaving(false);
    }
  }

  async function complete(id: string) {
    try {
      await api.post(`/reminders/${id}/complete`);
      load();
    } catch (e: any) {
      toast.error(e?.response?.data?.error ?? 'Failed to mark done');
    }
  }

  return (
    <Layout title="Reminders">
      <PageHeader
        title="Reminders & follow-ups"
        description="Personal nudges. The scheduler ships emails at due time once configured."
        action={<Button onClick={() => setOpen(true)}>+ New reminder</Button>}
      />
      <DataTable
        loading={loading}
        empty="No reminders. Add one to track an upcoming follow-up."
        columns={[
          { key: 'title', header: 'Title' },
          {
            key: 'due_at',
            header: 'Due',
            render: (r: any) => (r.due_at ? new Date(r.due_at).toLocaleString() : '—'),
          },
          {
            key: 'status',
            header: 'Status',
            render: (r: any) => <StatusBadge status={r.status} />,
          },
          {
            key: 'actions',
            header: '',
            align: 'right',
            render: (r: any) =>
              r.status !== 'DONE' ? (
                <Button size="sm" variant="ghost" onClick={() => complete(r.id)}>
                  Mark done
                </Button>
              ) : null,
          },
        ]}
        rows={rows}
      />
      <Modal
        open={open}
        onClose={() => {
          setOpen(false);
          setForm({});
        }}
        title="New reminder"
        footer={
          <>
            <Button
              variant="secondary"
              onClick={() => {
                setOpen(false);
                setForm({});
              }}
            >
              Cancel
            </Button>
            <Button onClick={save} loading={saving}>
              {saving ? 'Saving' : 'Save reminder'}
            </Button>
          </>
        }
      >
        <div className="space-y-3">
          <FormInput
            label="Title *"
            value={form.title ?? ''}
            onChange={(e) => setForm({ ...form, title: e.target.value })}
          />
          <DateTimePicker
            label="Due at *"
            value={form.due_at_local ?? ''}
            onChange={(v) =>
              setForm({
                ...form,
                due_at_local: v,
                due_at: localToIso(v),
              })
            }
          />
          <label className="block">
            <span className="block text-xs font-medium text-slate-700 mb-1.5">Description</span>
            <textarea
              placeholder="Notes"
              value={form.description ?? ''}
              onChange={(e) => setForm({ ...form, description: e.target.value })}
              className="w-full rounded-lg border border-slate-300 hover:border-slate-400 bg-white px-3 py-2 text-sm shadow-sm focus:outline-none focus:ring-2 focus:ring-brand-500/30 focus:border-brand-500"
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
  const withSeconds = v.length === 16 ? `${v}:00` : v;
  const d = new Date(withSeconds);
  return isNaN(d.getTime()) ? '' : d.toISOString();
}
