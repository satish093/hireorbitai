import { useEffect, useState } from 'react';
import { Layout } from '../components/Layout';
import { DataTable } from '../components/DataTable';
import { Modal } from '../components/Modal';
import { FormInput } from '../components/FormInput';
import { PageHeader } from '../components/PageHeader';
import { Button } from '../components/Button';
import { api } from '../services/api';
import { isSafeHttpsUrl } from '../utils/safeUrl';
import toast from 'react-hot-toast';

const EMPTY = {
  company_name: '',
  contact_name: '',
  contact_email: '',
  contact_phone: '',
  website: '',
  tier: '',
};

function valueOrDash(value?: string | null) {
  return value?.trim() ? value : '—';
}

function formatDate(value?: string | null) {
  if (!value) return '—';
  return new Date(value).toLocaleDateString();
}

export function Vendors() {
  const [rows, setRows] = useState<any[]>([]);
  const [open, setOpen] = useState(false);
  const [selected, setSelected] = useState<any | null>(null);
  const [form, setForm] = useState<any>(EMPTY);
  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(true);

  function load() {
    setLoading(true);
    api
      .get('/vendors')
      .then((r) => setRows(r.data ?? []))
      .catch((e) => toast.error(e?.response?.data?.error ?? 'Failed to load vendors'))
      .finally(() => setLoading(false));
  }
  useEffect(() => {
    load();
  }, []);

  async function save() {
    if (saving) return;
    if (!form.company_name) {
      toast.error('Company name is required');
      return;
    }
    setSaving(true);
    try {
      await api.post('/vendors', form);
      toast.success('Vendor added');
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
    <Layout title="Vendors">
      <PageHeader
        title="Vendors"
        description="Companies you submit consultant resumes to. Track tier, primary contact, and submission history."
        action={<Button onClick={() => setOpen(true)}>+ New vendor</Button>}
      />
      <DataTable
        loading={loading}
        empty="No vendors yet. Add your first vendor to start tracking submissions."
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
          { key: 'contact_name', header: 'Contact' },
          { key: 'contact_email', header: 'Email' },
          { key: 'tier', header: 'Tier' },
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
        title="New vendor"
        description="Create a vendor record so submissions can reference them."
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
              {saving ? 'Saving' : 'Save vendor'}
            </Button>
          </>
        }
      >
        <div className="space-y-3">
          <FormInput
            label="Company name *"
            value={form.company_name}
            onChange={(e) => setForm({ ...form, company_name: e.target.value })}
          />
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
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <FormInput
              label="Contact phone"
              value={form.contact_phone}
              onChange={(e) => setForm({ ...form, contact_phone: e.target.value })}
            />
            <FormInput
              label="Tier"
              placeholder="T1 / T2 / Prime"
              value={form.tier}
              onChange={(e) => setForm({ ...form, tier: e.target.value })}
            />
          </div>
          <FormInput
            label="Website"
            placeholder="https://…"
            value={form.website}
            onChange={(e) => setForm({ ...form, website: e.target.value })}
          />
        </div>
      </Modal>
      <Modal
        open={!!selected}
        onClose={() => setSelected(null)}
        title={selected?.company_name ?? 'Vendor details'}
        footer={
          <Button variant="secondary" onClick={() => setSelected(null)}>
            Close
          </Button>
        }
      >
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-sm">
          <Detail label="Contact name" value={valueOrDash(selected?.contact_name)} />
          <Detail label="Contact email" value={valueOrDash(selected?.contact_email)} />
          <Detail label="Contact phone" value={valueOrDash(selected?.contact_phone)} />
          <Detail label="Tier" value={valueOrDash(selected?.tier)} />
          <Detail label="Website" value={valueOrDash(selected?.website)} href={selected?.website} />
          <Detail label="Created" value={formatDate(selected?.created_at)} />
          <div className="sm:col-span-2">
            <Detail
              label="Tags"
              value={
                Array.isArray(selected?.tags) && selected.tags.length > 0
                  ? selected.tags.join(', ')
                  : '—'
              }
            />
          </div>
          <div className="sm:col-span-2">
            <Detail label="Notes" value={valueOrDash(selected?.notes)} />
          </div>
        </div>
      </Modal>
    </Layout>
  );
}

function Detail({ label, value, href }: { label: string; value: string; href?: string | null }) {
  // Only render an <a> if the user-supplied href is a real https URL.
  // Without this guard a vendor row containing `website = 'javascript:…'`
  // turns the workspace into an ATO target on click. rel uses
  // `noopener noreferrer` instead of bare `noreferrer` so the opened tab
  // can't reach window.opener and can't leak the referrer either.
  const isLinkable = href && value !== '—' && isSafeHttpsUrl(href);
  const content = isLinkable ? (
    <a
      href={href as string}
      target="_blank"
      rel="noopener noreferrer"
      className="text-brand-700 hover:underline break-all"
    >
      {value}
    </a>
  ) : (
    value
  );
  return (
    <div className="rounded-lg border border-border bg-hover/50 px-3 py-2">
      <div className="text-[10px] font-semibold uppercase tracking-widest text-muted">{label}</div>
      <div className="mt-1 text-ink break-words">{content}</div>
    </div>
  );
}
