import { useEffect, useState } from 'react';
import { Layout } from '../components/Layout';
import { DataTable } from '../components/DataTable';
import { Modal } from '../components/Modal';
import { FormInput } from '../components/FormInput';
import { SelectInput } from '../components/SelectInput';
import { PageHeader } from '../components/PageHeader';
import { Button } from '../components/Button';
import { Pill, PillTone } from '../components/Pill';
import { api } from '../services/api';
import { invalidate, useInvalidationListener } from '../hooks/useInvalidate';
import toast from 'react-hot-toast';

const STATUSES = ['Submitted', 'Approved', 'Paid', 'Overdue', 'Cancelled'] as const;
type Status = (typeof STATUSES)[number];

const EMPTY = {
  consultant_name: '',
  vendor_name: '',
  invoice_number: '',
  invoice_date: '',
  due_date: '',
  net_terms_days: '',
  pay_rate: '',
  billing_month: '',
  invoice_amount: '',
  status: 'Submitted' as Status,
  notes: '',
};

// Per-status Pill tone — mirrors the shared <Pill> tone-object shape used across
// the app (StatusBadge / PriorityBadge).
const STATUS_TONES: Record<Status, PillTone> = {
  Submitted: {
    bg: 'bg-blue-100 dark:bg-blue-900/40',
    text: 'text-blue-700 dark:text-blue-300',
    dot: 'bg-blue-500',
  },
  Approved: {
    bg: 'bg-violet-100 dark:bg-violet-900/40',
    text: 'text-violet-700 dark:text-violet-300',
    dot: 'bg-violet-500',
  },
  Paid: {
    bg: 'bg-green-100 dark:bg-green-900/40',
    text: 'text-green-700 dark:text-green-300',
    dot: 'bg-green-500',
  },
  Overdue: {
    bg: 'bg-red-100 dark:bg-red-900/40',
    text: 'text-red-700 dark:text-red-300',
    dot: 'bg-red-500',
  },
  Cancelled: {
    bg: 'bg-slate-100 dark:bg-slate-800',
    text: 'text-slate-600 dark:text-slate-300',
  },
};
function statusTone(status?: string): PillTone {
  return STATUS_TONES[status as Status] ?? STATUS_TONES.Submitted;
}

function formatDate(value?: string | null) {
  if (!value) return '—';
  // `date` columns return 'YYYY-MM-DD'; timestamps include a 'T'.
  const d = value.includes('T') ? new Date(value) : new Date(`${value}T00:00:00`);
  return Number.isNaN(d.getTime()) ? value : d.toLocaleDateString();
}

// USD currency for the money fields. Accepts a number or numeric string.
function formatMoney(value?: number | string | null) {
  if (value == null || value === '') return '—';
  const n = Number(value);
  if (Number.isNaN(n)) return String(value);
  return n.toLocaleString(undefined, {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: 2,
  });
}

// 'YYYY-MM' (from <input type="month">) → 'Mon YYYY'.
function formatMonth(value?: string | null) {
  if (!value) return '—';
  const m = /^(\d{4})-(\d{2})$/.exec(value);
  if (!m) return value;
  const d = new Date(Number(m[1]), Number(m[2]) - 1, 1);
  return Number.isNaN(d.getTime())
    ? value
    : d.toLocaleDateString(undefined, { month: 'short', year: 'numeric' });
}

// due = invoice_date + net_terms_days, computed in UTC so it never drifts a day.
function addDays(isoDate: string, days: number): string {
  const d = new Date(`${isoDate}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

export function Invoices() {
  const [rows, setRows] = useState<any[]>([]);
  const [open, setOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [selected, setSelected] = useState<any | null>(null);
  const [form, setForm] = useState<any>(EMPTY);
  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(true);

  function load() {
    setLoading(true);
    api
      .get('/invoices')
      .then((r) => setRows(r.data ?? []))
      .catch((e) => toast.error(e?.response?.data?.error ?? 'Failed to load invoices'))
      .finally(() => setLoading(false));
  }
  useEffect(() => {
    load();
  }, []);
  useInvalidationListener('invoices', load);

  function openCreate() {
    setForm(EMPTY);
    setEditingId(null);
    setOpen(true);
  }

  function closeForm() {
    setOpen(false);
    setEditingId(null);
    setForm(EMPTY);
  }

  // Prefill with ONLY writable fields — the update schema is `.strict()`.
  function openEdit(row: any) {
    setForm({
      consultant_name: row.consultant_name ?? '',
      vendor_name: row.vendor_name ?? '',
      invoice_number: row.invoice_number ?? '',
      invoice_date: row.invoice_date ?? '',
      due_date: row.due_date ?? '',
      net_terms_days: row.net_terms_days ?? '',
      pay_rate: row.pay_rate ?? '',
      billing_month: row.billing_month ?? '',
      invoice_amount: row.invoice_amount ?? '',
      status: (row.status as Status) ?? 'Submitted',
      notes: row.notes ?? '',
    });
    setEditingId(row.id);
    setSelected(null);
    setOpen(true);
  }

  // Auto-fill due date from invoice date + net terms when both are present.
  // Stays fully editable — the user can override the suggested due date.
  function patchDates(next: Partial<typeof EMPTY>) {
    const f = { ...form, ...next };
    if (f.invoice_date && f.net_terms_days !== '' && f.net_terms_days != null) {
      const days = Number(f.net_terms_days);
      if (!Number.isNaN(days)) f.due_date = addDays(f.invoice_date, days);
    }
    setForm(f);
  }

  async function save() {
    if (saving) return;
    if (!form.consultant_name?.trim()) return toast.error('Consultant name is required');
    if (!form.vendor_name?.trim()) return toast.error('Vendor is required');
    setSaving(true);
    const payload = {
      consultant_name: form.consultant_name.trim(),
      vendor_name: form.vendor_name.trim(),
      invoice_number: form.invoice_number?.trim() || null,
      invoice_date: form.invoice_date || null,
      due_date: form.due_date || null,
      net_terms_days:
        form.net_terms_days === '' || form.net_terms_days == null
          ? null
          : Number(form.net_terms_days),
      // Send null (not '') for empty money fields so the backend doesn't coerce
      // a blank into 0.
      pay_rate: form.pay_rate === '' || form.pay_rate == null ? null : Number(form.pay_rate),
      invoice_amount:
        form.invoice_amount === '' || form.invoice_amount == null
          ? null
          : Number(form.invoice_amount),
      billing_month: form.billing_month || null,
      status: form.status,
      notes: form.notes?.trim() || null,
    };
    try {
      if (editingId) {
        await api.patch(`/invoices/${editingId}`, payload);
        toast.success('Invoice updated');
      } else {
        await api.post('/invoices', payload);
        toast.success('Invoice added');
      }
      closeForm();
      invalidate('invoices');
      load();
    } catch (e: any) {
      toast.error(e?.response?.data?.error ?? 'Something went wrong. Please try again.');
    } finally {
      setSaving(false);
    }
  }

  async function remove(row: any) {
    const label = row.invoice_number ? `#${row.invoice_number}` : `for ${row.consultant_name}`;
    if (!confirm(`Delete invoice ${label}? This cannot be undone.`)) return;
    try {
      await api.delete(`/invoices/${row.id}`);
      setRows((prev) => prev.filter((r) => r.id !== row.id));
      setSelected(null);
      invalidate('invoices');
      toast.success('Invoice deleted');
    } catch (e: any) {
      toast.error(e?.response?.data?.error ?? 'Delete failed');
    }
  }

  return (
    <Layout title="Invoices">
      <PageHeader
        title="Invoices"
        description="Track consultant invoices — vendor, dates, net terms, and payment status."
        action={<Button onClick={openCreate}>+ New invoice</Button>}
      />
      <DataTable
        loading={loading}
        empty="No invoices yet. Add your first invoice to start tracking."
        columns={[
          {
            key: 'invoice_number',
            header: 'Invoice #',
            render: (row: any) => row.invoice_number || '—',
          },
          { key: 'consultant_name', header: 'Consultant' },
          { key: 'vendor_name', header: 'Vendor' },
          {
            key: 'billing_month',
            header: 'Billing month',
            render: (row: any) => formatMonth(row.billing_month),
          },
          {
            key: 'pay_rate',
            header: 'Pay rate',
            align: 'right',
            render: (row: any) => formatMoney(row.pay_rate),
          },
          {
            key: 'invoice_amount',
            header: 'Invoice amount',
            align: 'right',
            render: (row: any) => formatMoney(row.invoice_amount),
          },
          {
            key: 'invoice_date',
            header: 'Invoice date',
            render: (row: any) => formatDate(row.invoice_date),
          },
          { key: 'due_date', header: 'Due date', render: (row: any) => formatDate(row.due_date) },
          {
            key: 'net_terms_days',
            header: 'Net terms',
            render: (row: any) => (row.net_terms_days != null ? `${row.net_terms_days} days` : '—'),
          },
          {
            key: 'status',
            header: 'Status',
            render: (row: any) => <Pill tone={statusTone(row.status)}>{row.status}</Pill>,
          },
          {
            key: 'actions',
            header: '',
            align: 'right',
            render: (row: any) => (
              <Button
                size="sm"
                variant="ghost"
                onClick={(e) => {
                  e.stopPropagation();
                  setSelected(row);
                }}
              >
                View
              </Button>
            ),
          },
        ]}
        rows={rows}
        onRowClick={setSelected}
      />

      {/* Create / Edit */}
      <Modal
        open={open}
        onClose={closeForm}
        title={editingId ? 'Edit invoice' : 'New invoice'}
        description={editingId ? 'Update this invoice record.' : 'Add an invoice to the tracker.'}
        footer={
          <>
            <Button variant="secondary" onClick={closeForm}>
              Cancel
            </Button>
            <Button onClick={save} loading={saving}>
              {saving ? 'Saving' : editingId ? 'Save changes' : 'Save invoice'}
            </Button>
          </>
        }
      >
        <div className="space-y-3">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <FormInput
              label="Consultant name *"
              value={form.consultant_name}
              onChange={(e) => setForm({ ...form, consultant_name: e.target.value })}
            />
            <FormInput
              label="Vendor *"
              value={form.vendor_name}
              onChange={(e) => setForm({ ...form, vendor_name: e.target.value })}
            />
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <FormInput
              label="Invoice number"
              value={form.invoice_number}
              onChange={(e) => setForm({ ...form, invoice_number: e.target.value })}
            />
            <FormInput
              label="Net terms (days)"
              type="number"
              value={form.net_terms_days}
              onChange={(e) => patchDates({ net_terms_days: e.target.value })}
            />
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <FormInput
              label="Invoice date"
              type="date"
              value={form.invoice_date}
              onChange={(e) => patchDates({ invoice_date: e.target.value })}
            />
            <FormInput
              label="Due date"
              type="date"
              value={form.due_date}
              onChange={(e) => setForm({ ...form, due_date: e.target.value })}
            />
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <FormInput
              label="Pay rate ($)"
              type="number"
              step="0.01"
              min="0"
              placeholder="e.g. 65.00"
              value={form.pay_rate}
              onChange={(e) => setForm({ ...form, pay_rate: e.target.value })}
            />
            <FormInput
              label="Invoice amount ($)"
              type="number"
              step="0.01"
              min="0"
              placeholder="e.g. 10400.00"
              value={form.invoice_amount}
              onChange={(e) => setForm({ ...form, invoice_amount: e.target.value })}
            />
          </div>
          <FormInput
            label="Billing month"
            type="month"
            value={form.billing_month}
            onChange={(e) => setForm({ ...form, billing_month: e.target.value })}
          />
          <SelectInput
            label="Status"
            value={form.status}
            onChange={(e) => setForm({ ...form, status: e.target.value as Status })}
            options={STATUSES.map((s) => ({ value: s, label: s }))}
          />
          <FormInput
            label="Notes"
            value={form.notes}
            onChange={(e) => setForm({ ...form, notes: e.target.value })}
          />
        </div>
      </Modal>

      {/* Detail */}
      <Modal
        open={!!selected}
        onClose={() => setSelected(null)}
        title={selected?.invoice_number ? `Invoice #${selected.invoice_number}` : 'Invoice'}
        footer={
          <>
            {selected && (
              <Button variant="danger-ghost" className="mr-auto" onClick={() => remove(selected)}>
                Delete
              </Button>
            )}
            {selected && (
              <Button variant="secondary" onClick={() => openEdit(selected)}>
                Edit
              </Button>
            )}
            <Button variant="secondary" onClick={() => setSelected(null)}>
              Close
            </Button>
          </>
        }
      >
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-sm">
          <Detail label="Consultant" value={selected?.consultant_name} />
          <Detail label="Vendor" value={selected?.vendor_name} />
          <Detail label="Invoice #" value={selected?.invoice_number} />
          <div className="rounded-lg border border-border bg-hover/50 px-3 py-2">
            <div className="text-[10px] font-semibold uppercase tracking-widest text-muted">
              Status
            </div>
            <div className="mt-1">
              <Pill tone={statusTone(selected?.status)}>{selected?.status ?? '—'}</Pill>
            </div>
          </div>
          <Detail label="Billing month" value={formatMonth(selected?.billing_month)} />
          <Detail label="Pay rate" value={formatMoney(selected?.pay_rate)} />
          <Detail label="Invoice amount" value={formatMoney(selected?.invoice_amount)} />
          <Detail label="Invoice date" value={formatDate(selected?.invoice_date)} />
          <Detail label="Due date" value={formatDate(selected?.due_date)} />
          <Detail
            label="Net terms"
            value={selected?.net_terms_days != null ? `${selected.net_terms_days} days` : '—'}
          />
          <Detail label="Created" value={formatDate(selected?.created_at)} />
          <div className="sm:col-span-2">
            <Detail label="Notes" value={selected?.notes} />
          </div>
        </div>
      </Modal>
    </Layout>
  );
}

function Detail({ label, value }: { label: string; value?: string | null }) {
  const content = value && String(value).trim() ? value : '—';
  return (
    <div className="rounded-lg border border-border bg-hover/50 px-3 py-2">
      <div className="text-[10px] font-semibold uppercase tracking-widest text-muted">{label}</div>
      <div className="mt-1 text-ink break-words">{content}</div>
    </div>
  );
}
