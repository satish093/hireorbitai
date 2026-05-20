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

export function Clients() {
  const [rows, setRows] = useState<any[]>([]);
  const [open, setOpen] = useState(false);
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
      toast.error(e?.response?.data?.error ?? 'Failed');
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
          { key: 'company_name', header: 'Company' },
          { key: 'industry', header: 'Industry' },
          { key: 'contact_name', header: 'Contact' },
          { key: 'location', header: 'Location' },
        ]}
        rows={rows}
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
    </Layout>
  );
}
