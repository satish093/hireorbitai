import { useEffect, useState } from 'react';
import { Layout } from '../components/Layout';
import { DataTable } from '../components/DataTable';
import { Modal } from '../components/Modal';
import { FormInput } from '../components/FormInput';
import { PageHeader } from '../components/PageHeader';
import { Button } from '../components/Button';
import { api } from '../services/api';
import toast from 'react-hot-toast';

const EMPTY = { company_name: '', industry: '', contact_name: '', contact_email: '', location: '' };

function valueOrDash(value?: string | null) {
  return value?.trim() ? value : '—';
}

function formatDate(value?: string | null) {
  if (!value) return '—';
  return new Date(value).toLocaleDateString();
}

export function Clients() {
  const [rows, setRows] = useState<any[]>([]);
  const [open, setOpen] = useState(false);
  const [selected, setSelected] = useState<any | null>(null);
  const [form, setForm] = useState<any>(EMPTY);
  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(true);

  function load() {
    setLoading(true);
    api
      .get('/clients')
      .then((r) => setRows(r.data ?? []))
      .catch((e) => toast.error(e?.response?.data?.error ?? 'Failed to load clients'))
      .finally(() => setLoading(false));
  }
  useEffect(() => {
    load();
  }, []);

  async function save() {
    if (saving) return;
    if (!form.company_name) {
      toast.error('Company is required');
      return;
    }
    setSaving(true);
    try {
      await api.post('/clients', form);
      toast.success('Client added');
      setOpen(false);
      setForm(EMPTY);
      load();
    } catch (e: any) {
      toast.error(e?.response?.data?.error ?? 'Something went wrong. Please try again.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <Layout title="Clients">
      <PageHeader
        title="Clients"
        description="End clients you place consultants with — used by application history and analytics."
        action={<Button onClick={() => setOpen(true)}>+ New client</Button>}
      />
      <DataTable
        loading={loading}
        empty="No clients yet."
        columns={[
          {
            key: 'company_name',
            header: 'Company',
            render: (row: any) => (
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  setSelected(row);
                }}
                className="text-sm font-medium text-brand-700 hover:underline"
              >
                {row.company_name}
              </button>
            ),
          },
          { key: 'industry', header: 'Industry' },
          { key: 'contact_name', header: 'Contact' },
          { key: 'location', header: 'Location' },
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
      <Modal
        open={open}
        onClose={() => {
          setOpen(false);
          setForm(EMPTY);
        }}
        title="New client"
        footer={
          <>
            <Button
              variant="secondary"
              onClick={() => {
                setOpen(false);
                setForm(EMPTY);
              }}
            >
              Cancel
            </Button>
            <Button onClick={save} loading={saving}>
              {saving ? 'Saving' : 'Save client'}
            </Button>
          </>
        }
      >
        <div className="space-y-3">
          <FormInput
            label="Company *"
            value={form.company_name}
            onChange={(e) => setForm({ ...form, company_name: e.target.value })}
          />
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <FormInput
              label="Industry"
              value={form.industry}
              onChange={(e) => setForm({ ...form, industry: e.target.value })}
            />
            <FormInput
              label="Location"
              value={form.location}
              onChange={(e) => setForm({ ...form, location: e.target.value })}
            />
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <FormInput
              label="Contact name"
              value={form.contact_name}
              onChange={(e) => setForm({ ...form, contact_name: e.target.value })}
            />
            <FormInput
              label="Contact email"
              type="email"
              value={form.contact_email}
              onChange={(e) => setForm({ ...form, contact_email: e.target.value })}
            />
          </div>
        </div>
      </Modal>
      <Modal
        open={!!selected}
        onClose={() => setSelected(null)}
        title={selected?.company_name ?? 'Client details'}
        footer={
          <Button variant="secondary" onClick={() => setSelected(null)}>
            Close
          </Button>
        }
      >
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-sm">
          <Detail label="Industry" value={valueOrDash(selected?.industry)} />
          <Detail label="Location" value={valueOrDash(selected?.location)} />
          <Detail label="Contact name" value={valueOrDash(selected?.contact_name)} />
          <Detail label="Contact email" value={valueOrDash(selected?.contact_email)} />
          <Detail label="Contact phone" value={valueOrDash(selected?.contact_phone)} />
          <Detail label="Created" value={formatDate(selected?.created_at)} />
          <div className="sm:col-span-2">
            <Detail label="Notes" value={valueOrDash(selected?.notes)} />
          </div>
        </div>
      </Modal>
    </Layout>
  );
}

function Detail({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-border bg-hover/50 px-3 py-2">
      <div className="text-[10px] font-semibold uppercase tracking-widest text-muted">{label}</div>
      <div className="mt-1 text-ink break-words">{value}</div>
    </div>
  );
}
