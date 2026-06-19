import { useEffect, useMemo, useState } from 'react';
import { Layout } from '../components/Layout';
import { DataTable } from '../components/DataTable';
import { Modal } from '../components/Modal';
import { FormInput } from '../components/FormInput';
import { SelectInput } from '../components/SelectInput';
import { PageHeader } from '../components/PageHeader';
import { Button } from '../components/Button';
import { Pill, PillTone } from '../components/Pill';
import { ConfirmDialog, type ConfirmSpec } from '../components/admin/ConfirmDialog';
import { api } from '../services/api';
import { invalidate, useInvalidationListener } from '../hooks/useInvalidate';
import toast from 'react-hot-toast';

type LifecycleStatus = 'Draft' | 'Submitted' | 'Approved' | 'Paid' | 'Cancelled';
type DisplayStatus = LifecycleStatus | 'Overdue';

interface Party {
  name: string;
  address: string;
  email: string;
  phone: string;
  website: string;
  country: string;
  tax_id: string;
}

interface LineItem {
  description: string;
  service_period: string;
  quantity: string | number;
  unit: string;
  unit_rate: string | number;
  amount?: string | number;
}

interface Actions {
  edit?: boolean;
  submit?: boolean;
  approve?: boolean;
  mark_paid?: boolean;
  cancel?: boolean;
  email?: boolean;
  download?: boolean;
  delete?: boolean;
  archive?: boolean;
  restore?: boolean;
}

interface Invoice {
  id: string;
  company_group_id: string;
  invoice_number: string;
  invoice_date?: string | null;
  due_date?: string | null;
  net_terms_days?: number | null;
  currency: string;
  discount_amount: number | string;
  tax_percent: number | string;
  subtotal: number | string;
  tax_amount: number | string;
  total_amount: number | string;
  status: LifecycleStatus;
  display_status: DisplayStatus;
  notes?: string | null;
  issuer_snapshot: Party;
  bill_to_snapshot: Party;
  line_items?: LineItem[];
  status_history?: Array<{
    id: string;
    from_status?: string | null;
    to_status: string;
    changed_at: string;
    note?: string | null;
  }>;
  archived_at?: string | null;
  last_emailed_at?: string | null;
  created_at?: string | null;
  permitted_actions?: Actions;
}

interface Company {
  id: string;
  name: string;
  email?: string | null;
  color?: string | null;
}

interface InvoiceListResponse {
  items: Invoice[];
  total: number;
  page: number;
  page_size: number;
  summary: {
    outstanding_by_currency: Record<string, string | number>;
    overdue_count: number;
    draft_count: number;
  };
}

interface InvoiceForm {
  company_group_id: string;
  invoice_number: string;
  invoice_date: string;
  due_date: string;
  net_terms_days: string;
  currency: string;
  discount_amount: string;
  tax_percent: string;
  notes: string;
  issuer_snapshot: Party;
  bill_to_snapshot: Party;
  line_items: LineItem[];
}

const EMPTY_PARTY: Party = {
  name: '',
  address: '',
  email: '',
  phone: '',
  website: '',
  country: '',
  tax_id: '',
};

const EMPTY_FORM: InvoiceForm = {
  company_group_id: '',
  invoice_number: '',
  invoice_date: new Date().toISOString().slice(0, 10),
  due_date: '',
  net_terms_days: '30',
  currency: 'USD',
  discount_amount: '0',
  tax_percent: '0',
  notes: '',
  issuer_snapshot: { ...EMPTY_PARTY },
  bill_to_snapshot: { ...EMPTY_PARTY },
  line_items: [
    {
      description: 'Professional consulting services',
      service_period: '',
      quantity: '1',
      unit: 'hours',
      unit_rate: '0',
    },
  ],
};

const STATUS_TONES: Record<DisplayStatus, PillTone> = {
  Draft: { bg: 'bg-slate-100 dark:bg-slate-800', text: 'text-slate-600 dark:text-slate-300' },
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
  Cancelled: { bg: 'bg-slate-100 dark:bg-slate-800', text: 'text-slate-500' },
};

function fmtMoney(value: unknown, currency = 'USD') {
  const number = Number(value ?? 0);
  try {
    return number.toLocaleString(undefined, { style: 'currency', currency });
  } catch {
    return `${currency} ${number.toFixed(2)}`;
  }
}

function fmtDate(value?: string | null) {
  if (!value) return '—';
  const date = new Date(value.includes('T') ? value : `${value}T00:00:00`);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleDateString();
}

function addDays(date: string, days: number) {
  const parsed = new Date(`${date}T00:00:00Z`);
  parsed.setUTCDate(parsed.getUTCDate() + days);
  return parsed.toISOString().slice(0, 10);
}

function cleanParty(party: Party) {
  return Object.fromEntries(
    Object.entries(party).map(([key, value]) => [key, value.trim() || null]),
  ) as unknown as Party;
}

export function Invoices() {
  const [rows, setRows] = useState<Invoice[]>([]);
  const [companies, setCompanies] = useState<Company[]>([]);
  const [total, setTotal] = useState(0);
  const [summary, setSummary] = useState<InvoiceListResponse['summary']>({
    outstanding_by_currency: {},
    overdue_count: 0,
    draft_count: 0,
  });
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(1);
  const [query, setQuery] = useState('');
  const [companyFilter, setCompanyFilter] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [archivedFilter, setArchivedFilter] = useState('false');
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<Invoice | null>(null);
  const [form, setForm] = useState<InvoiceForm>(EMPTY_FORM);
  const [saving, setSaving] = useState(false);
  const [selected, setSelected] = useState<Invoice | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [recipient, setRecipient] = useState('');
  const [docBusy, setDocBusy] = useState(false);
  const [confirm, setConfirm] = useState<ConfirmSpec | null>(null);
  const pageSize = 25;

  async function loadCompanies() {
    try {
      const response = await api.get<Company[]>('/invoices/companies');
      setCompanies(response.data ?? []);
    } catch {
      setCompanies([]);
    }
  }

  async function load() {
    setLoading(true);
    try {
      const response = await api.get<InvoiceListResponse>('/invoices', {
        params: {
          page,
          page_size: pageSize,
          q: query || undefined,
          company_group_id: companyFilter || undefined,
          display_status: statusFilter || undefined,
          archived: archivedFilter,
        },
      });
      setRows(response.data.items ?? []);
      setTotal(response.data.total ?? 0);
      setSummary(response.data.summary ?? summary);
    } catch (error: any) {
      toast.error(error?.response?.data?.error ?? 'Failed to load invoices');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void loadCompanies();
  }, []);
  useEffect(() => {
    const timer = window.setTimeout(() => void load(), query ? 250 : 0);
    return () => window.clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [page, query, companyFilter, statusFilter, archivedFilter]);
  useInvalidationListener('invoices', load);

  const totals = useMemo(() => {
    const subtotal = form.line_items.reduce(
      (sum, item) => sum + Number(item.quantity || 0) * Number(item.unit_rate || 0),
      0,
    );
    const discount = Math.max(0, Number(form.discount_amount || 0));
    const tax = Math.max(
      0,
      (Math.max(0, subtotal - discount) * Number(form.tax_percent || 0)) / 100,
    );
    return { subtotal, discount, tax, total: Math.max(0, subtotal - discount) + tax };
  }, [form.line_items, form.discount_amount, form.tax_percent]);

  function chooseCompany(companyId: string) {
    const company = companies.find((item) => item.id === companyId);
    setForm((current) => ({
      ...current,
      company_group_id: companyId,
      issuer_snapshot: {
        ...current.issuer_snapshot,
        name: company?.name ?? '',
        email: company?.email ?? '',
      },
    }));
  }

  function openCreate() {
    const company = companies.length === 1 ? companies[0] : undefined;
    setEditing(null);
    setForm({
      ...EMPTY_FORM,
      issuer_snapshot: {
        ...EMPTY_PARTY,
        name: company?.name ?? '',
        email: company?.email ?? '',
      },
      bill_to_snapshot: { ...EMPTY_PARTY },
      line_items: EMPTY_FORM.line_items.map((item) => ({ ...item })),
      company_group_id: company?.id ?? '',
    });
    setFormOpen(true);
  }

  function openEdit(invoice: Invoice) {
    setEditing(invoice);
    setSelected(null);
    setForm({
      company_group_id: invoice.company_group_id,
      invoice_number: invoice.invoice_number,
      invoice_date: invoice.invoice_date ?? '',
      due_date: invoice.due_date ?? '',
      net_terms_days: invoice.net_terms_days == null ? '' : String(invoice.net_terms_days),
      currency: invoice.currency || 'USD',
      discount_amount: String(invoice.discount_amount ?? 0),
      tax_percent: String(invoice.tax_percent ?? 0),
      notes: invoice.notes ?? '',
      issuer_snapshot: { ...EMPTY_PARTY, ...(invoice.issuer_snapshot ?? {}) },
      bill_to_snapshot: { ...EMPTY_PARTY, ...(invoice.bill_to_snapshot ?? {}) },
      line_items: (invoice.line_items ?? []).map((item) => ({
        description: item.description,
        service_period: item.service_period ?? '',
        quantity: item.quantity,
        unit: item.unit,
        unit_rate: item.unit_rate,
      })),
    });
    setFormOpen(true);
  }

  function patchDates(patch: Partial<InvoiceForm>) {
    setForm((current) => {
      const next = { ...current, ...patch };
      const days = Number(next.net_terms_days);
      if (next.invoice_date && next.net_terms_days !== '' && !Number.isNaN(days)) {
        next.due_date = addDays(next.invoice_date, days);
      }
      return next;
    });
  }

  function patchParty(
    side: 'issuer_snapshot' | 'bill_to_snapshot',
    key: keyof Party,
    value: string,
  ) {
    setForm((current) => ({ ...current, [side]: { ...current[side], [key]: value } }));
  }

  function patchItem(index: number, patch: Partial<LineItem>) {
    setForm((current) => ({
      ...current,
      line_items: current.line_items.map((item, i) => (i === index ? { ...item, ...patch } : item)),
    }));
  }

  async function save() {
    if (!form.company_group_id) return toast.error('Company is required');
    if (!form.invoice_number.trim()) return toast.error('Invoice number is required');
    if (!form.bill_to_snapshot.name.trim()) return toast.error('Bill-to name is required');
    if (form.line_items.some((item) => !item.description.trim())) {
      return toast.error('Every line item needs a description');
    }
    setSaving(true);
    const payload = {
      ...form,
      invoice_number: form.invoice_number.trim(),
      invoice_date: form.invoice_date || null,
      due_date: form.due_date || null,
      net_terms_days: form.net_terms_days === '' ? null : Number(form.net_terms_days),
      discount_amount: Number(form.discount_amount || 0),
      tax_percent: Number(form.tax_percent || 0),
      notes: form.notes.trim() || null,
      issuer_snapshot: cleanParty(form.issuer_snapshot),
      bill_to_snapshot: cleanParty(form.bill_to_snapshot),
      line_items: form.line_items.map((item) => ({
        description: item.description.trim(),
        service_period: item.service_period || null,
        quantity: Number(item.quantity),
        unit: item.unit.trim(),
        unit_rate: Number(item.unit_rate),
      })),
    };
    try {
      const response = editing
        ? await api.patch<Invoice>(`/invoices/${editing.id}`, payload)
        : await api.post<Invoice>('/invoices', payload);
      toast.success(editing ? 'Invoice updated' : 'Draft invoice created');
      setFormOpen(false);
      setEditing(null);
      invalidate('invoices');
      await load();
      await openDetail(response.data.id);
    } catch (error: any) {
      toast.error(error?.response?.data?.error ?? 'Unable to save invoice');
    } finally {
      setSaving(false);
    }
  }

  async function openDetail(id: string) {
    setDetailLoading(true);
    try {
      const response = await api.get<Invoice>(`/invoices/${id}`);
      setSelected(response.data);
      setRecipient(response.data.bill_to_snapshot?.email ?? '');
    } catch (error: any) {
      toast.error(error?.response?.data?.error ?? 'Failed to load invoice');
    } finally {
      setDetailLoading(false);
    }
  }

  async function refreshAfterAction(invoice?: Invoice) {
    invalidate('invoices');
    await load();
    if (invoice) {
      setSelected(invoice);
      setRecipient(invoice.bill_to_snapshot?.email ?? '');
    } else {
      setSelected(null);
    }
  }

  function requestTransition(to_status: LifecycleStatus, label: string) {
    if (!selected) return;
    setConfirm({
      title: `${label} invoice`,
      message: `Invoice #${selected.invoice_number} will move from ${selected.status} to ${to_status}.`,
      confirmLabel: label,
      tone: to_status === 'Cancelled' ? 'danger' : 'default',
      run: async () => {
        const response = await api.post<Invoice>(`/invoices/${selected.id}/transition`, {
          to_status,
        });
        toast.success(`Invoice ${to_status.toLowerCase()}`);
        await refreshAfterAction(response.data);
      },
    });
  }

  function requestArchive() {
    if (!selected) return;
    setConfirm({
      title: selected.archived_at ? 'Restore invoice' : 'Archive invoice',
      message: selected.archived_at
        ? `Restore invoice #${selected.invoice_number} to active records?`
        : `Archive invoice #${selected.invoice_number}? It remains in the audit history.`,
      confirmLabel: selected.archived_at ? 'Restore' : 'Archive',
      run: async () => {
        const action = selected.archived_at ? 'restore' : 'archive';
        const response = await api.post<Invoice>(`/invoices/${selected.id}/${action}`);
        toast.success(selected.archived_at ? 'Invoice restored' : 'Invoice archived');
        await refreshAfterAction(response.data);
      },
    });
  }

  function requestDelete() {
    if (!selected) return;
    setConfirm({
      title: 'Delete draft invoice',
      message: `Permanently delete draft invoice #${selected.invoice_number}? This cannot be undone.`,
      confirmLabel: 'Delete draft',
      tone: 'danger',
      run: async () => {
        await api.delete(`/invoices/${selected.id}`);
        toast.success('Draft deleted');
        await refreshAfterAction();
      },
    });
  }

  async function download(invoice: Invoice) {
    setDocBusy(true);
    try {
      const response = await api.get(`/invoices/${invoice.id}/document`, { responseType: 'blob' });
      const url = URL.createObjectURL(response.data);
      const link = document.createElement('a');
      link.href = url;
      link.download = `invoice-${invoice.invoice_number}.pdf`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(url);
    } catch (error: any) {
      toast.error(error?.response?.data?.error ?? 'Failed to generate PDF');
    } finally {
      setDocBusy(false);
    }
  }

  async function email(invoice: Invoice) {
    if (!recipient.trim()) return toast.error('Recipient email is required');
    setDocBusy(true);
    try {
      const response = await api.post(`/invoices/${invoice.id}/send`, {
        recipient_email: recipient.trim(),
      });
      toast.success(`Invoice emailed to ${response.data.emailed_to}`);
      await openDetail(invoice.id);
      await load();
    } catch (error: any) {
      toast.error(error?.response?.data?.error ?? 'Failed to email invoice');
    } finally {
      setDocBusy(false);
    }
  }

  const pageCount = Math.max(1, Math.ceil(total / pageSize));
  const outstanding = Object.entries(summary.outstanding_by_currency ?? {})
    .map(([currency, amount]) => fmtMoney(amount, currency))
    .join(' · ');

  return (
    <Layout title="Invoices">
      <PageHeader
        title="Invoices"
        description="Create, approve, deliver, and track company invoices."
        action={<Button onClick={openCreate}>+ New invoice</Button>}
      />

      <div className="mb-4 grid grid-cols-1 gap-3 sm:grid-cols-3">
        <Metric label="Outstanding" value={outstanding || '—'} />
        <Metric label="Overdue" value={String(summary.overdue_count ?? 0)} tone="danger" />
        <Metric label="Drafts" value={String(summary.draft_count ?? 0)} />
      </div>

      <div className="mb-3 grid grid-cols-1 gap-2 rounded-xl border border-border bg-surface p-3 md:grid-cols-4">
        <FormInput
          aria-label="Search invoices"
          placeholder="Search number or party…"
          value={query}
          onChange={(event) => {
            setPage(1);
            setQuery(event.target.value);
          }}
        />
        <SelectInput
          aria-label="Filter by company"
          value={companyFilter}
          onChange={(event) => {
            setPage(1);
            setCompanyFilter(event.target.value);
          }}
          options={[
            { value: '', label: 'All companies' },
            ...companies.map((company) => ({ value: company.id, label: company.name })),
          ]}
        />
        <SelectInput
          aria-label="Filter by status"
          value={statusFilter}
          onChange={(event) => {
            setPage(1);
            setStatusFilter(event.target.value);
          }}
          options={[
            { value: '', label: 'All statuses' },
            ...(['Draft', 'Submitted', 'Approved', 'Paid', 'Overdue', 'Cancelled'] as const).map(
              (status) => ({ value: status, label: status }),
            ),
          ]}
        />
        <SelectInput
          aria-label="Filter archived invoices"
          value={archivedFilter}
          onChange={(event) => {
            setPage(1);
            setArchivedFilter(event.target.value);
          }}
          options={[
            { value: 'false', label: 'Active invoices' },
            { value: 'true', label: 'Archived invoices' },
            { value: 'all', label: 'Active + archived' },
          ]}
        />
      </div>

      <DataTable
        loading={loading}
        empty="No invoices match these filters."
        rows={rows}
        onRowClick={(row) => void openDetail(row.id)}
        columns={[
          { key: 'invoice_number', header: 'Invoice #' },
          {
            key: 'bill_to',
            header: 'Bill to',
            render: (row) => row.bill_to_snapshot?.name || '—',
          },
          {
            key: 'company',
            header: 'Issuer',
            render: (row) => row.issuer_snapshot?.name || '—',
            hideOnMobile: true,
          },
          {
            key: 'invoice_date',
            header: 'Invoice date',
            render: (row) => fmtDate(row.invoice_date),
            hideOnMobile: true,
          },
          { key: 'due_date', header: 'Due date', render: (row) => fmtDate(row.due_date) },
          {
            key: 'total_amount',
            header: 'Total',
            align: 'right',
            render: (row) => fmtMoney(row.total_amount, row.currency),
          },
          {
            key: 'status',
            header: 'Status',
            render: (row) => (
              <Pill tone={STATUS_TONES[row.display_status ?? row.status]}>
                {row.display_status ?? row.status}
              </Pill>
            ),
          },
        ]}
      />

      <div className="mt-3 flex items-center justify-between text-xs text-muted">
        <span>
          {total
            ? `${(page - 1) * pageSize + 1}–${Math.min(page * pageSize, total)} of ${total}`
            : '0 invoices'}
        </span>
        <div className="flex gap-2">
          <Button
            size="sm"
            variant="secondary"
            disabled={page <= 1}
            onClick={() => setPage(page - 1)}
          >
            Previous
          </Button>
          <span className="self-center">
            Page {page} of {pageCount}
          </span>
          <Button
            size="sm"
            variant="secondary"
            disabled={page >= pageCount}
            onClick={() => setPage(page + 1)}
          >
            Next
          </Button>
        </div>
      </div>

      <Modal
        open={formOpen}
        onClose={() => setFormOpen(false)}
        size="xl"
        title={editing ? `Edit invoice #${editing.invoice_number}` : 'New draft invoice'}
        description="Totals are calculated and validated by the server."
        footer={
          <>
            <Button variant="secondary" onClick={() => setFormOpen(false)}>
              Cancel
            </Button>
            <Button onClick={save} loading={saving}>
              {editing ? 'Save changes' : 'Create draft'}
            </Button>
          </>
        }
      >
        <div className="space-y-6">
          <section>
            <SectionTitle>Invoice details</SectionTitle>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <SelectInput
                label="Issuing company *"
                value={form.company_group_id}
                onChange={(event) => chooseCompany(event.target.value)}
                options={[
                  { value: '', label: 'Select company' },
                  ...companies.map((company) => ({ value: company.id, label: company.name })),
                ]}
              />
              <FormInput
                label="Invoice number *"
                value={form.invoice_number}
                onChange={(event) => setForm({ ...form, invoice_number: event.target.value })}
              />
              <FormInput
                label="Invoice date"
                type="date"
                value={form.invoice_date}
                onChange={(event) => patchDates({ invoice_date: event.target.value })}
              />
              <FormInput
                label="Net terms (days)"
                type="number"
                min="0"
                value={form.net_terms_days}
                onChange={(event) => patchDates({ net_terms_days: event.target.value })}
              />
              <FormInput
                label="Due date"
                type="date"
                value={form.due_date}
                onChange={(event) => setForm({ ...form, due_date: event.target.value })}
              />
              <FormInput
                label="Currency"
                maxLength={3}
                value={form.currency}
                onChange={(event) =>
                  setForm({ ...form, currency: event.target.value.toUpperCase() })
                }
              />
              <FormInput
                label="Discount amount"
                type="number"
                min="0"
                step="0.01"
                value={form.discount_amount}
                onChange={(event) => setForm({ ...form, discount_amount: event.target.value })}
              />
              <FormInput
                label="Tax %"
                type="number"
                min="0"
                max="100"
                step="0.01"
                value={form.tax_percent}
                onChange={(event) => setForm({ ...form, tax_percent: event.target.value })}
              />
            </div>
          </section>

          <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
            <PartyFields
              title="Issuer snapshot"
              party={form.issuer_snapshot}
              onChange={(key, value) => patchParty('issuer_snapshot', key, value)}
            />
            <PartyFields
              title="Bill-to snapshot"
              party={form.bill_to_snapshot}
              onChange={(key, value) => patchParty('bill_to_snapshot', key, value)}
            />
          </div>

          <section>
            <div className="mb-2 flex items-center justify-between">
              <SectionTitle>Line items</SectionTitle>
              <Button
                size="sm"
                variant="secondary"
                onClick={() =>
                  setForm({
                    ...form,
                    line_items: [
                      ...form.line_items,
                      {
                        description: '',
                        service_period: '',
                        quantity: '1',
                        unit: 'hours',
                        unit_rate: '0',
                      },
                    ],
                  })
                }
              >
                + Add item
              </Button>
            </div>
            <div className="space-y-3">
              {form.line_items.map((item, index) => (
                <div key={index} className="rounded-xl border border-border bg-hover/30 p-3">
                  <div className="grid grid-cols-1 gap-2 md:grid-cols-[2fr_1fr_.8fr_.8fr_1fr_auto]">
                    <FormInput
                      label="Description *"
                      value={item.description}
                      onChange={(event) => patchItem(index, { description: event.target.value })}
                    />
                    <FormInput
                      label="Service month"
                      type="month"
                      value={item.service_period}
                      onChange={(event) => patchItem(index, { service_period: event.target.value })}
                    />
                    <FormInput
                      label="Quantity"
                      type="number"
                      min="0.0001"
                      step="0.01"
                      value={item.quantity}
                      onChange={(event) => patchItem(index, { quantity: event.target.value })}
                    />
                    <FormInput
                      label="Unit"
                      value={item.unit}
                      onChange={(event) => patchItem(index, { unit: event.target.value })}
                    />
                    <FormInput
                      label="Unit rate"
                      type="number"
                      min="0"
                      step="0.01"
                      value={item.unit_rate}
                      onChange={(event) => patchItem(index, { unit_rate: event.target.value })}
                    />
                    <div className="flex items-end">
                      <Button
                        size="sm"
                        variant="danger-ghost"
                        disabled={form.line_items.length === 1}
                        onClick={() =>
                          setForm({
                            ...form,
                            line_items: form.line_items.filter((_, i) => i !== index),
                          })
                        }
                      >
                        Remove
                      </Button>
                    </div>
                  </div>
                  <div className="mt-2 text-right text-xs font-medium text-ink">
                    {fmtMoney(
                      Number(item.quantity || 0) * Number(item.unit_rate || 0),
                      form.currency,
                    )}
                  </div>
                </div>
              ))}
            </div>
          </section>

          <div className="grid grid-cols-1 gap-4 lg:grid-cols-[1fr_320px]">
            <label className="block">
              <span className="mb-1.5 block text-xs font-medium text-ink">Notes</span>
              <textarea
                rows={5}
                value={form.notes}
                onChange={(event) => setForm({ ...form, notes: event.target.value })}
                className="w-full rounded-md border border-border-strong bg-surface px-3 py-2 text-[13px] text-ink focus:outline-none focus-visible:ring-2 focus-visible:border-accent"
              />
            </label>
            <div className="rounded-xl border border-border bg-hover/30 p-4 text-sm">
              <TotalRow label="Subtotal" value={fmtMoney(totals.subtotal, form.currency)} />
              <TotalRow label="Discount" value={`− ${fmtMoney(totals.discount, form.currency)}`} />
              <TotalRow label="Tax" value={fmtMoney(totals.tax, form.currency)} />
              <div className="mt-3 border-t border-border pt-3">
                <TotalRow label="Total" value={fmtMoney(totals.total, form.currency)} strong />
              </div>
            </div>
          </div>
        </div>
      </Modal>

      <Modal
        open={!!selected || detailLoading}
        onClose={() => setSelected(null)}
        size="lg"
        title={selected ? `Invoice #${selected.invoice_number}` : 'Loading invoice'}
        footer={
          selected ? (
            <>
              {selected.permitted_actions?.delete && (
                <Button variant="danger-ghost" className="mr-auto" onClick={requestDelete}>
                  Delete draft
                </Button>
              )}
              {selected.permitted_actions?.archive && (
                <Button variant="secondary" className="mr-auto" onClick={requestArchive}>
                  Archive
                </Button>
              )}
              {selected.permitted_actions?.restore && (
                <Button variant="secondary" className="mr-auto" onClick={requestArchive}>
                  Restore
                </Button>
              )}
              {selected.permitted_actions?.edit && (
                <Button variant="secondary" onClick={() => openEdit(selected)}>
                  Edit
                </Button>
              )}
              <Button variant="secondary" onClick={() => setSelected(null)}>
                Close
              </Button>
            </>
          ) : undefined
        }
      >
        {selected ? (
          <div className="space-y-5">
            <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-border bg-hover/30 p-3">
              <div>
                <Pill tone={STATUS_TONES[selected.display_status]}>{selected.display_status}</Pill>
                {selected.archived_at && (
                  <span className="ml-2 text-xs text-muted">
                    Archived {fmtDate(selected.archived_at)}
                  </span>
                )}
              </div>
              <div className="flex flex-wrap gap-2">
                {selected.permitted_actions?.submit && (
                  <Button size="sm" onClick={() => requestTransition('Submitted', 'Submit')}>
                    Submit
                  </Button>
                )}
                {selected.permitted_actions?.approve && (
                  <Button size="sm" onClick={() => requestTransition('Approved', 'Approve')}>
                    Approve
                  </Button>
                )}
                {selected.permitted_actions?.mark_paid && (
                  <Button size="sm" onClick={() => requestTransition('Paid', 'Mark paid')}>
                    Mark paid
                  </Button>
                )}
                {selected.permitted_actions?.cancel && (
                  <Button
                    size="sm"
                    variant="danger-ghost"
                    onClick={() => requestTransition('Cancelled', 'Cancel')}
                  >
                    Cancel invoice
                  </Button>
                )}
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">
              <Detail label="Invoice date" value={fmtDate(selected.invoice_date)} />
              <Detail label="Due date" value={fmtDate(selected.due_date)} />
              <Detail label="Currency" value={selected.currency} />
              <Detail label="Total" value={fmtMoney(selected.total_amount, selected.currency)} />
            </div>

            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <PartyCard label="Bill to" party={selected.bill_to_snapshot} />
              <PartyCard label="From" party={selected.issuer_snapshot} />
            </div>

            <div className="overflow-x-auto rounded-xl border border-border">
              <table className="w-full min-w-[620px] text-sm">
                <thead className="bg-hover text-left text-[10px] uppercase tracking-widest text-muted">
                  <tr>
                    <th className="px-3 py-2">Description</th>
                    <th className="px-3 py-2">Period</th>
                    <th className="px-3 py-2 text-right">Quantity</th>
                    <th className="px-3 py-2 text-right">Rate</th>
                    <th className="px-3 py-2 text-right">Amount</th>
                  </tr>
                </thead>
                <tbody>
                  {(selected.line_items ?? []).map((item, index) => (
                    <tr key={index} className="border-t border-border">
                      <td className="px-3 py-2 font-medium text-ink">{item.description}</td>
                      <td className="px-3 py-2 text-muted">{item.service_period || '—'}</td>
                      <td className="px-3 py-2 text-right">
                        {item.quantity} {item.unit}
                      </td>
                      <td className="px-3 py-2 text-right">
                        {fmtMoney(item.unit_rate, selected.currency)}
                      </td>
                      <td className="px-3 py-2 text-right font-medium">
                        {fmtMoney(item.amount, selected.currency)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="ml-auto w-full max-w-sm rounded-xl border border-border bg-hover/30 p-4">
              <TotalRow label="Subtotal" value={fmtMoney(selected.subtotal, selected.currency)} />
              <TotalRow
                label="Discount"
                value={`− ${fmtMoney(selected.discount_amount, selected.currency)}`}
              />
              <TotalRow
                label={`Tax (${selected.tax_percent}%)`}
                value={fmtMoney(selected.tax_amount, selected.currency)}
              />
              <div className="mt-3 border-t border-border pt-3">
                <TotalRow
                  label="Total"
                  value={fmtMoney(selected.total_amount, selected.currency)}
                  strong
                />
              </div>
            </div>

            {selected.notes && <Detail label="Notes" value={selected.notes} />}

            {!!selected.status_history?.length && (
              <div className="rounded-xl border border-border p-4">
                <div className="mb-3 font-semibold text-ink">Status history</div>
                <div className="space-y-2">
                  {selected.status_history.map((entry) => (
                    <div
                      key={entry.id}
                      className="flex flex-wrap items-center justify-between gap-2 text-xs"
                    >
                      <span className="text-ink">
                        {entry.from_status ? `${entry.from_status} → ` : ''}
                        <span className="font-semibold">{entry.to_status}</span>
                        {entry.note ? ` · ${entry.note}` : ''}
                      </span>
                      <span className="text-muted">{fmtDate(entry.changed_at)}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {(selected.permitted_actions?.download || selected.permitted_actions?.email) && (
              <div className="rounded-xl border border-border p-4">
                <div className="mb-3">
                  <div className="font-semibold text-ink">Document delivery</div>
                  <div className="text-xs text-muted">
                    Download the current PDF or email it when the workflow permits.
                  </div>
                </div>
                <div className="flex flex-wrap items-end gap-2">
                  {selected.permitted_actions?.download && (
                    <Button
                      variant="secondary"
                      onClick={() => void download(selected)}
                      loading={docBusy}
                    >
                      Download PDF
                    </Button>
                  )}
                  {selected.permitted_actions?.email && (
                    <>
                      <div className="min-w-[220px] flex-1">
                        <FormInput
                          label="Recipient email"
                          type="email"
                          value={recipient}
                          onChange={(event) => setRecipient(event.target.value)}
                        />
                      </div>
                      <Button
                        onClick={() => void email(selected)}
                        loading={docBusy}
                        disabled={!recipient.trim()}
                      >
                        Send invoice
                      </Button>
                    </>
                  )}
                </div>
                {selected.last_emailed_at && (
                  <div className="mt-2 text-xs text-muted">
                    Last emailed {fmtDate(selected.last_emailed_at)}
                  </div>
                )}
              </div>
            )}
          </div>
        ) : (
          <div className="py-12 text-center text-sm text-muted">Loading…</div>
        )}
      </Modal>

      <ConfirmDialog spec={confirm} onClose={() => setConfirm(null)} />
    </Layout>
  );
}

function Metric({ label, value, tone }: { label: string; value: string; tone?: 'danger' }) {
  return (
    <div className="rounded-xl border border-border bg-surface p-4">
      <div className="text-[10px] font-semibold uppercase tracking-widest text-muted">{label}</div>
      <div
        className={`mt-1 text-xl font-semibold ${tone === 'danger' ? 'text-danger' : 'text-ink'}`}
      >
        {value}
      </div>
    </div>
  );
}

function SectionTitle({ children }: { children: string }) {
  return <h4 className="mb-3 text-sm font-semibold text-ink">{children}</h4>;
}

function PartyFields({
  title,
  party,
  onChange,
}: {
  title: string;
  party: Party;
  onChange: (key: keyof Party, value: string) => void;
}) {
  return (
    <section className="rounded-xl border border-border p-4">
      <SectionTitle>{title}</SectionTitle>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <FormInput
          label="Name *"
          value={party.name}
          onChange={(event) => onChange('name', event.target.value)}
        />
        <FormInput
          label="Email"
          type="email"
          value={party.email}
          onChange={(event) => onChange('email', event.target.value)}
        />
        <FormInput
          label="Phone"
          value={party.phone}
          onChange={(event) => onChange('phone', event.target.value)}
        />
        <FormInput
          label="Website"
          value={party.website}
          onChange={(event) => onChange('website', event.target.value)}
        />
        <FormInput
          label="Country"
          value={party.country}
          onChange={(event) => onChange('country', event.target.value)}
        />
        <FormInput
          label="Tax ID"
          value={party.tax_id}
          onChange={(event) => onChange('tax_id', event.target.value)}
        />
        <label className="block sm:col-span-2">
          <span className="mb-1.5 block text-xs font-medium text-ink">Address</span>
          <textarea
            rows={3}
            value={party.address}
            onChange={(event) => onChange('address', event.target.value)}
            className="w-full rounded-md border border-border-strong bg-surface px-3 py-2 text-[13px] text-ink focus:outline-none focus-visible:ring-2 focus-visible:border-accent"
          />
        </label>
      </div>
    </section>
  );
}

function PartyCard({ label, party }: { label: string; party?: Party | null }) {
  const lines = party
    ? [
        party.name,
        party.address,
        party.country,
        party.email,
        party.phone,
        party.website,
        party.tax_id ? `Tax ID: ${party.tax_id}` : '',
      ].filter(Boolean)
    : [];
  return <Detail label={label} value={lines.join('\n')} />;
}

function Detail({ label, value }: { label: string; value?: string | null }) {
  return (
    <div className="whitespace-pre-line rounded-xl border border-border bg-hover/30 px-3 py-2">
      <div className="text-[10px] font-semibold uppercase tracking-widest text-muted">{label}</div>
      <div className="mt-1 break-words text-sm text-ink">{value?.trim() || '—'}</div>
    </div>
  );
}

function TotalRow({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <div
      className={`flex items-center justify-between gap-4 py-1 ${strong ? 'text-base font-semibold text-ink' : 'text-sm text-ink-2'}`}
    >
      <span>{label}</span>
      <span>{value}</span>
    </div>
  );
}
