import { useEffect, useState } from 'react';
import { Layout } from '../components/Layout';
import { DataTable } from '../components/DataTable';
import { StatusBadge } from '../components/StatusBadge';
import { Modal } from '../components/Modal';
import { FormInput } from '../components/FormInput';
import { SelectInput } from '../components/SelectInput';
import { SearchSelect, type SearchSelectItem } from '../components/SearchSelect';
import { PageHeader } from '../components/PageHeader';
import { Button } from '../components/Button';
import { api } from '../services/api';
import { invalidate, useInvalidationListener } from '../hooks/useInvalidate';
import { useAuth } from '../context/AuthContext';
import toast from 'react-hot-toast';
import type { ResumeVersion } from '../components/resumes/types';

const EMPTY = { consultant_id: '', job_id: '', vendor_id: '', notes: '', resume_id: '' };

export function Applications() {
  const { profile } = useAuth();
  const [rows, setRows] = useState<any[]>([]);
  // Consultants are fetched lazily when the modal opens so the SearchSelect
  // always receives a populated list — pre-loading at mount caused the
  // SearchSelect to fire its initial search before the fetch returned and then
  // never refresh because its effect only re-runs on query changes.
  const [consultants, setConsultants] = useState<any[]>([]);
  const [consultantsLoading, setConsultantsLoading] = useState(false);
  const [vendors, setVendors] = useState<any[]>([]);
  const [resumeVersions, setResumeVersions] = useState<ResumeVersion[]>([]);
  const [open, setOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [loading, setLoading] = useState(true);
  const [form, setForm] = useState(EMPTY);
  // Pinned selections for the searchable pickers — keep the chosen row visible
  // even when it falls out of the current (server-searched) result set.
  const [selJob, setSelJob] = useState<SearchSelectItem | null>(null);
  const [selConsultant, setSelConsultant] = useState<SearchSelectItem | null>(null);
  const [selVendor, setSelVendor] = useState<SearchSelectItem | null>(null);

  function resetForm() {
    setForm(EMPTY);
    setSelJob(null);
    setSelConsultant(null);
    setSelVendor(null);
    setConsultants([]);
  }

  function load() {
    setLoading(true);
    api
      .get('/applications')
      .then((r) => setRows(r.data ?? []))
      .catch((e) => toast.error(e?.response?.data?.error ?? 'Failed to load applications'))
      .finally(() => setLoading(false));
  }

  // Lazy-load consultants + vendors when the modal opens. Vendors are fetched
  // once and cached in state; consultants are always fresh so the scope
  // (admin-sees-all / recruiter-sees-assigned / manager-sees-group) is correct.
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setConsultantsLoading(true);
    api
      .get('/consultants')
      .then((r) => {
        if (!cancelled) setConsultants(r.data ?? []);
      })
      .catch(() => {
        if (!cancelled) setConsultants([]);
      })
      .finally(() => {
        if (!cancelled) setConsultantsLoading(false);
      });
    if (vendors.length === 0) {
      api
        .get('/vendors')
        .then((r) => {
          if (!cancelled) setVendors(r.data ?? []);
        })
        .catch(() => {});
    }
    return () => {
      cancelled = true;
    };
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    load();
  }, []);

  // Refetch when a sibling page (JobSearch's "I applied" flow, etc.)
  // mutates the applications dataset.
  useInvalidationListener('applications', () => load());

  useEffect(() => {
    if (!form.consultant_id) {
      setResumeVersions([]);
      return;
    }
    api
      .get(`/resumes/consultant/${form.consultant_id}`)
      .then((r) => {
        const versions: ResumeVersion[] = r.data ?? [];
        setResumeVersions(versions);
        const current = versions.find((v) => v.is_current);
        setForm((f) => ({ ...f, resume_id: current?.id ?? '' }));
      })
      .catch(() => setResumeVersions([]));
  }, [form.consultant_id]);

  async function submit() {
    if (submitting) return;
    if (!form.consultant_id || !form.job_id) {
      toast.error('Pick a consultant and a job');
      return;
    }
    setSubmitting(true);
    try {
      const { notes: _n, resume_id: _r, ...dupParams } = form;
      void _n;
      void _r;
      const dupRes = await api.get('/applications/check-duplicate', { params: dupParams });
      const payload = { ...form, resume_id: form.resume_id || null };
      if (dupRes.data.duplicate) {
        if (!confirm('Duplicate submission detected — submit anyway?')) return;
        await api.post('/applications', { ...payload, force: true });
      } else {
        await api.post('/applications', payload);
      }
      toast.success('Submitted');
      setOpen(false);
      resetForm();
      load();
      // Notify JobSearch (Applied tab), dashboards, Reports.
      invalidate('applications');
    } catch (e: any) {
      toast.error(e?.response?.data?.error ?? 'Something went wrong. Please try again.');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Layout title="Applications">
      <PageHeader
        title="Applications"
        description="Submissions tied to a consultant + job + vendor. Duplicate detection runs before each submit."
        action={
          // Only operator-tier users (recruiter / manager / admin) create
          // submissions. CONSULTANT reaches this page but should not see the
          // button unless a self-submit flow is explicitly added.
          profile?.role !== 'CONSULTANT' && (
            <Button variant="primary" onClick={() => setOpen(true)}>
              + New submission
            </Button>
          )
        }
      />
      <DataTable
        loading={loading}
        empty="No submissions yet."
        columns={[
          {
            key: 'consultant',
            header: 'Consultant',
            render: (a: any) => a.consultant?.user?.full_name ?? a.consultant?.user?.email ?? '—',
          },
          { key: 'job', header: 'Job', render: (a: any) => a.job?.title ?? '—' },
          { key: 'vendor', header: 'Vendor', render: (a: any) => a.vendor?.company_name ?? '—' },
          {
            key: 'ats',
            header: 'ATS',
            align: 'right',
            hideOnMobile: true,
            render: (a: any) => a.ats_score ?? '—',
          },
          {
            key: 'date',
            header: 'Submitted',
            hideOnMobile: true,
            render: (a: any) =>
              a.submitted_at ? new Date(a.submitted_at).toLocaleDateString() : '—',
          },
          {
            key: 'status',
            header: 'Status',
            render: (a: any) => <StatusBadge status={a.status} />,
          },
        ]}
        rows={rows}
      />

      <Modal
        open={open}
        size="lg"
        onClose={() => {
          setOpen(false);
          resetForm();
        }}
        title="New submission"
        description="Pick a consultant, a job, and a vendor. The system pre-checks for duplicates."
        footer={
          <>
            <Button
              variant="outline"
              onClick={() => {
                setOpen(false);
                resetForm();
              }}
            >
              Cancel
            </Button>
            <Button variant="primary" onClick={submit} loading={submitting}>
              {submitting ? 'Submitting' : 'Submit'}
            </Button>
          </>
        }
      >
        <div className="space-y-3">
          {/* key changes when consultants load so SearchSelect re-runs its
               initial search against the populated list, not the empty one. */}
          <SearchSelect
            key={consultantsLoading ? 'loading' : `ready-${consultants.length}`}
            label="Consultant *"
            placeholder={consultantsLoading ? 'Loading…' : 'Search consultants…'}
            value={form.consultant_id}
            selected={selConsultant}
            search={(q) =>
              consultants
                .map((c) => ({
                  value: c.id,
                  label: c.user?.full_name ?? c.user?.email ?? 'Unknown',
                  sublabel: c.user?.full_name ? c.user?.email : undefined,
                }))
                .filter((o) =>
                  q
                    ? `${o.label} ${o.sublabel ?? ''}`.toLowerCase().includes(q.toLowerCase())
                    : true,
                )
            }
            onSelect={(item) => {
              setSelConsultant(item);
              setForm((f) => ({ ...f, consultant_id: item?.value ?? '' }));
            }}
            emptyText={
              consultantsLoading
                ? 'Loading consultants…'
                : profile?.role === 'RECRUITER'
                  ? 'No consultants assigned to you yet'
                  : 'No consultants found'
            }
          />
          <SearchSelect
            label="Job *"
            placeholder="Search jobs by title or keyword…"
            value={form.job_id}
            selected={selJob}
            search={(q) =>
              api
                .get('/jobs', { params: q ? { q } : {} })
                .then((r) =>
                  ((r.data ?? []) as any[]).slice(0, 25).map((j) => ({
                    value: j.id,
                    label: j.title,
                    sublabel: j.company_name ?? undefined,
                  })),
                )
                .catch(() => [])
            }
            onSelect={(item) => {
              setSelJob(item);
              setForm((f) => ({ ...f, job_id: item?.value ?? '' }));
            }}
            emptyText="No jobs found"
          />
          {resumeVersions.length > 0 && (
            <SelectInput
              label="Resume version"
              placeholder="No resume attached"
              value={form.resume_id}
              options={resumeVersions.map((v) => ({
                value: v.id,
                label: `v${v.version} — ${v.file_name}${v.is_current ? ' (current)' : ''}`,
              }))}
              onChange={(e) => setForm({ ...form, resume_id: e.target.value })}
            />
          )}
          <SearchSelect
            label="Vendor"
            placeholder="Search vendors…"
            value={form.vendor_id}
            selected={selVendor}
            search={(q) =>
              vendors
                .map((v) => ({ value: v.id, label: v.company_name }))
                .filter((o) => (q ? o.label?.toLowerCase().includes(q.toLowerCase()) : true))
            }
            onSelect={(item) => {
              setSelVendor(item);
              setForm((f) => ({ ...f, vendor_id: item?.value ?? '' }));
            }}
            emptyText="No vendors found"
          />
          <FormInput
            label="Notes"
            placeholder="Anything the team should know"
            value={form.notes}
            onChange={(e) => setForm({ ...form, notes: e.target.value })}
          />
        </div>
      </Modal>
    </Layout>
  );
}
