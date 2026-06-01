import { useEffect, useState } from 'react';
import { Layout } from '../components/Layout';
import { DataTable } from '../components/DataTable';
import { Modal } from '../components/Modal';
import { StatusBadge } from '../components/StatusBadge';
import { FormInput } from '../components/FormInput';
import { DateTimePicker } from '../components/DateTimePicker';
import { PageHeader } from '../components/PageHeader';
import { Button } from '../components/Button';
import { EmptyState } from '../components/EmptyState';
import { SkeletonCard } from '../components/Skeleton';
import { ReminderCard } from '../components/ReminderCard';
import { api } from '../services/api';
import toast from 'react-hot-toast';

export function Reminders() {
  const [rows, setRows] = useState<any[]>([]);
  const [open, setOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
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

  function closeForm() {
    setOpen(false);
    setEditingId(null);
    setForm({});
  }

  function openEdit(r: any) {
    const local = r.due_at ? isoToLocal(r.due_at) : '';
    setForm({
      title: r.title ?? '',
      due_at: r.due_at ?? '',
      due_at_local: local,
      description: r.description ?? '',
    });
    setEditingId(r.id);
    setOpen(true);
  }

  async function save() {
    if (saving) return;
    if (!form.title || !form.due_at) {
      toast.error('Title and due date are required');
      return;
    }
    setSaving(true);
    try {
      // Strip the local-only mirror field. `due_at_local` is the raw
      // `YYYY-MM-DDTHH:mm` string we pass to the picker; the server only wants
      // `due_at` (ISO with timezone). The update schema is `.strict()`, so the
      // extra field would be rejected.
      const { due_at_local: _local, ...payload } = form;
      void _local;
      if (editingId) {
        await api.patch(`/reminders/${editingId}`, payload);
        toast.success('Reminder updated');
      } else {
        await api.post('/reminders', payload);
        toast.success('Reminder added');
      }
      closeForm();
      load();
    } catch (e: any) {
      toast.error(e?.response?.data?.error ?? 'Something went wrong. Please try again.');
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

  async function remove(id: string) {
    if (!confirm('Delete this reminder? This cannot be undone.')) return;
    try {
      await api.delete(`/reminders/${id}`);
      setRows((prev) => prev.filter((r) => r.id !== id));
      toast.success('Reminder deleted');
    } catch (e: any) {
      toast.error(e?.response?.data?.error ?? 'Delete failed');
    }
  }

  return (
    <Layout title="Reminders">
      <PageHeader
        title="Reminders & follow-ups"
        description="Personal nudges. The scheduler ships emails at due time once configured."
        action={<Button onClick={() => setOpen(true)}>+ New reminder</Button>}
      />
      {/* ── Mobile cards (< md) ── */}
      <div className="flex md:hidden flex-col gap-3 mb-4">
        {loading ? (
          <>
            <SkeletonCard />
            <SkeletonCard />
          </>
        ) : rows.length === 0 ? (
          <EmptyState
            title="No reminders"
            description="Add a reminder to track an upcoming follow-up."
            action={
              <Button variant="accent" onClick={() => setOpen(true)}>
                + New reminder
              </Button>
            }
            compact
          />
        ) : (
          rows.map((r: any) => (
            <ReminderCard
              key={r.id}
              reminder={r}
              onComplete={complete}
              onEdit={openEdit}
              onDelete={remove}
            />
          ))
        )}
      </div>

      {/* ── Desktop DataTable (≥ md) ── */}
      <div className="hidden md:block">
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
              render: (r: any) => (
                <div className="flex items-center justify-end gap-1">
                  {r.status !== 'DONE' && r.status !== 'SENT' && (
                    <Button size="sm" variant="ghost" onClick={() => complete(r.id)}>
                      Mark done
                    </Button>
                  )}
                  <Button size="sm" variant="ghost" onClick={() => openEdit(r)}>
                    Edit
                  </Button>
                  <Button size="sm" variant="danger-ghost" onClick={() => remove(r.id)}>
                    Delete
                  </Button>
                </div>
              ),
            },
          ]}
          rows={rows}
        />
      </div>
      {/* end desktop DataTable */}
      <Modal
        open={open}
        onClose={closeForm}
        title={editingId ? 'Edit reminder' : 'New reminder'}
        footer={
          <>
            <Button variant="secondary" onClick={closeForm}>
              Cancel
            </Button>
            <Button onClick={save} loading={saving}>
              {saving ? 'Saving' : editingId ? 'Save changes' : 'Save reminder'}
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
            <span className="block text-xs font-medium text-ink mb-1.5">Description</span>
            <textarea
              placeholder="Notes"
              value={form.description ?? ''}
              onChange={(e) => setForm({ ...form, description: e.target.value })}
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
  const withSeconds = v.length === 16 ? `${v}:00` : v;
  const d = new Date(withSeconds);
  return isNaN(d.getTime()) ? '' : d.toISOString();
}

// Inverse of localToIso — seeds the DateTimePicker (which wants a local
// `YYYY-MM-DDTHH:mm` string) from a stored ISO `due_at` when editing.
function isoToLocal(iso: string): string {
  const d = new Date(iso);
  if (isNaN(d.getTime())) return '';
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
