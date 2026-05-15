import { useEffect, useState } from 'react';
import { Layout } from '../components/Layout';
import { DataTable } from '../components/DataTable';
import { StatusBadge } from '../components/StatusBadge';
import { Modal } from '../components/Modal';
import { FormInput } from '../components/FormInput';
import { SelectInput } from '../components/SelectInput';
import { PageHeader } from '../components/PageHeader';
import { Button } from '../components/Button';
import { api } from '../services/api';
import { invalidate, useInvalidationListener } from '../hooks/useInvalidate';
import toast from 'react-hot-toast';

const EMPTY = { consultant_id: '', job_id: '', vendor_id: '', notes: '' };

export function Applications() {
  const [rows, setRows] = useState<any[]>([]);
  const [consultants, setConsultants] = useState<any[]>([]);
  const [jobs, setJobs] = useState<any[]>([]);
  const [vendors, setVendors] = useState<any[]>([]);
  const [open, setOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [loading, setLoading] = useState(true);
  const [form, setForm] = useState(EMPTY);

  function load() {
    setLoading(true);
    api.get('/applications')
      .then((r) => setRows(r.data ?? []))
      .catch((e) => toast.error(e?.response?.data?.error ?? 'Failed to load applications'))
      .finally(() => setLoading(false));
  }
  useEffect(() => {
    let cancelled = false;
    load();
    api.get('/consultants').then((r) => { if (!cancelled) setConsultants(r.data ?? []); }).catch(() => {});
    api.get('/jobs').then((r) => { if (!cancelled) setJobs(r.data ?? []); }).catch(() => {});
    api.get('/vendors').then((r) => { if (!cancelled) setVendors(r.data ?? []); }).catch(() => {});
    return () => { cancelled = true; };
  }, []);

  // Refetch when a sibling page (JobSearch's "I applied" flow, etc.)
  // mutates the applications dataset.
  useInvalidationListener('applications', () => load());

  async function submit() {
    if (submitting) return;
    if (!form.consultant_id || !form.job_id) {
      toast.error('Pick a consultant and a job');
      return;
    }
    setSubmitting(true);
    try {
      const { notes: _n, ...dupParams } = form;
      void _n;
      const dupRes = await api.get('/applications/check-duplicate', { params: dupParams });
      if (dupRes.data.duplicate) {
        if (!confirm('Duplicate submission detected — submit anyway?')) return;
        await api.post('/applications', { ...form, force: true });
      } else {
        await api.post('/applications', form);
      }
      toast.success('Submitted');
      setOpen(false);
      setForm(EMPTY);
      load();
      // Notify JobSearch (Applied tab), dashboards, Reports.
      invalidate('applications');
    } catch (e: any) {
      toast.error(e?.response?.data?.error ?? 'Failed');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Layout title="Applications">
      <PageHeader
        title="Applications"
        description="Submissions tied to a consultant + job + vendor. Duplicate detection runs before each submit."
        action={<Button onClick={() => setOpen(true)}>+ New submission</Button>}
      />
      <DataTable
        loading={loading}
        empty="No submissions yet."
        columns={[
          { key: 'consultant', header: 'Consultant', render: (a: any) => a.consultant?.user?.full_name ?? a.consultant?.user?.email ?? '—' },
          { key: 'job', header: 'Job', render: (a: any) => a.job?.title ?? '—' },
          { key: 'vendor', header: 'Vendor', render: (a: any) => a.vendor?.company_name ?? '—' },
          { key: 'ats', header: 'ATS', align: 'right', render: (a: any) => a.ats_score ?? '—' },
          { key: 'date', header: 'Submitted', render: (a: any) => a.submitted_at ? new Date(a.submitted_at).toLocaleDateString() : '—' },
          { key: 'status', header: 'Status', render: (a: any) => <StatusBadge status={a.status} /> },
        ]}
        rows={rows}
      />

      <Modal
        open={open}
        onClose={() => { setOpen(false); setForm(EMPTY); }}
        title="New submission"
        description="Pick a consultant, a job, and a vendor. The system pre-checks for duplicates."
        footer={
          <>
            <Button variant="secondary" onClick={() => { setOpen(false); setForm(EMPTY); }}>Cancel</Button>
            <Button onClick={submit} loading={submitting}>{submitting ? 'Submitting' : 'Submit'}</Button>
          </>
        }
      >
        <div className="space-y-3">
          <SelectInput label="Consultant *" placeholder="Select a consultant…"
            value={form.consultant_id}
            options={consultants.map((c) => ({ value: c.id, label: c.user?.full_name ?? c.user?.email }))}
            onChange={(e) => setForm({ ...form, consultant_id: e.target.value })}
          />
          <SelectInput label="Job *" placeholder="Select a job…"
            value={form.job_id}
            options={jobs.map((j) => ({ value: j.id, label: j.title }))}
            onChange={(e) => setForm({ ...form, job_id: e.target.value })}
          />
          <SelectInput label="Vendor" placeholder="Select a vendor…"
            value={form.vendor_id}
            options={vendors.map((v) => ({ value: v.id, label: v.company_name }))}
            onChange={(e) => setForm({ ...form, vendor_id: e.target.value })}
          />
          <FormInput label="Notes" placeholder="Anything the team should know" value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} />
        </div>
      </Modal>
    </Layout>
  );
}
