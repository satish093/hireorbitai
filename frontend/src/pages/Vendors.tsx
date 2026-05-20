import { useEffect, useState } from 'react';
import { Layout } from '../components/Layout';
import { DataTable } from '../components/DataTable';
import { Modal } from '../components/Modal';
import { FormInput } from '../components/FormInput';
import { PageHeader } from '../components/PageHeader';
import { Button } from '../components/Button';
import { api } from '../services/api';
import toast from 'react-hot-toast';

const EMPTY = {
  company_name: '',
  contact_name: '',
  contact_email: '',
  contact_phone: '',
  website: '',
  tier: '',
};

export function Vendors() {
  const [rows, setRows] = useState<any[]>([]);
  const [open, setOpen] = useState(false);
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
      toast.error(e?.response?.data?.error ?? 'Failed');
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
          { key: 'company_name', header: 'Company' },
          { key: 'contact_name', header: 'Contact' },
          { key: 'contact_email', header: 'Email' },
          { key: 'tier', header: 'Tier' },
        ]}
        rows={rows}
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
    </Layout>
  );
}
