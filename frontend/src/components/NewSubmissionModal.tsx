import { useEffect, useState, useCallback } from 'react';
import clsx from 'clsx';
import { Modal } from './Modal';
import { BottomSheet } from './BottomSheet';
import { Button } from './Button';
import { FormInput } from './FormInput';
import { SelectInput } from './SelectInput';
import { SearchSelect, type SearchSelectItem } from './SearchSelect';
import { Avatar } from './TaskBits';
import { api } from '../services/api';
import { invalidate } from '../hooks/useInvalidate';
import { useAuth } from '../context/AuthContext';
import toast from 'react-hot-toast';
import type { ResumeVersion } from './resumes/types';

// ── Breakpoint hook ────────────────────────────────────────────────────────

function useIsMobile(): boolean {
  const [mobile, setMobile] = useState(
    () => typeof window !== 'undefined' && window.innerWidth < 768,
  );
  useEffect(() => {
    const mq = window.matchMedia('(max-width: 767px)');
    setMobile(mq.matches);
    const handler = (e: MediaQueryListEvent) => setMobile(e.matches);
    mq.addEventListener('change', handler);
    return () => mq.removeEventListener('change', handler);
  }, []);
  return mobile;
}

// ── Types ──────────────────────────────────────────────────────────────────

interface ConsultantOption {
  id: string;
  primary_skill?: string | null;
  marketing_status?: string;
  user?: { full_name?: string | null; email?: string | null } | null;
}

interface FormState {
  consultant_id: string;
  job_id: string;
  vendor_id: string;
  resume_id: string;
  notes: string;
}

const EMPTY: FormState = {
  consultant_id: '',
  job_id: '',
  vendor_id: '',
  resume_id: '',
  notes: '',
};

// ── Stepper header ─────────────────────────────────────────────────────────

function Stepper({ step }: { step: number }) {
  const steps = ['Consultant', 'Job & vendor', 'Review'];
  return (
    <div className="flex items-center gap-0 mb-5">
      {steps.map((label, i) => {
        const n = i + 1;
        const done = n < step;
        const active = n === step;
        return (
          <div key={label} className="flex items-center flex-1 last:flex-none">
            <div className="flex flex-col items-center gap-1 shrink-0">
              <div
                className={clsx(
                  'w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold',
                  done
                    ? 'bg-brand-soft text-brand-on-soft'
                    : active
                      ? 'bg-ink text-bg'
                      : 'bg-hover text-muted',
                )}
              >
                {done ? '✓' : n}
              </div>
              <span
                className={clsx(
                  'text-[10px] font-semibold uppercase tracking-wide whitespace-nowrap',
                  active ? 'text-ink' : 'text-muted',
                )}
              >
                {label}
              </span>
            </div>
            {i < steps.length - 1 && (
              <div
                className="flex-1 h-px mx-2 mb-4"
                style={{ background: done ? 'var(--brand-on-soft)' : 'var(--border)' }}
              />
            )}
          </div>
        );
      })}
    </div>
  );
}

// ── Step 1: Select consultant ──────────────────────────────────────────────

function Step1({
  consultants,
  loading,
  form,
  setForm,
  selConsultant,
  setSelConsultant,
  profile,
}: {
  consultants: ConsultantOption[];
  loading: boolean;
  form: FormState;
  setForm: React.Dispatch<React.SetStateAction<FormState>>;
  selConsultant: SearchSelectItem | null;
  setSelConsultant: (item: SearchSelectItem | null) => void;
  profile: any;
}) {
  return (
    <div className="space-y-4">
      <p className="text-sm" style={{ color: 'var(--muted)' }}>
        Search and select the consultant you want to submit.
      </p>
      <SearchSelect
        key={loading ? 'loading' : `ready-${consultants.length}`}
        label="Consultant *"
        placeholder={loading ? 'Loading…' : 'Search consultants…'}
        value={form.consultant_id}
        selected={selConsultant}
        search={(q) =>
          consultants
            .map((c) => ({
              value: c.id,
              label: c.user?.full_name ?? c.user?.email ?? 'Unknown',
              sublabel: c.primary_skill ?? undefined,
            }))
            .filter((o) =>
              q ? `${o.label} ${o.sublabel ?? ''}`.toLowerCase().includes(q.toLowerCase()) : true,
            )
        }
        onSelect={(item) => {
          setSelConsultant(item);
          setForm((f) => ({ ...f, consultant_id: item?.value ?? '', resume_id: '' }));
        }}
        emptyText={
          loading
            ? 'Loading…'
            : profile?.role === 'RECRUITER'
              ? 'No consultants assigned to you yet'
              : 'No consultants found'
        }
      />

      {/* Selected consultant preview */}
      {selConsultant && (
        <div
          className="flex items-center gap-3 p-3 rounded-xl"
          style={{ background: 'var(--brand-soft)', border: '1px solid var(--brand-soft-border)' }}
        >
          <Avatar name={selConsultant.label} size={36} />
          <div className="flex-1 min-w-0">
            <div className="text-sm font-semibold" style={{ color: 'var(--brand-on-soft)' }}>
              {selConsultant.label}
            </div>
            {selConsultant.sublabel && (
              <div className="text-xs" style={{ color: 'var(--brand-on-soft)', opacity: 0.75 }}>
                {selConsultant.sublabel}
              </div>
            )}
          </div>
          <span className="text-xs font-bold" style={{ color: 'var(--brand-on-soft)' }}>
            ✓ Selected
          </span>
        </div>
      )}
    </div>
  );
}

// ── Step 2: Job + vendor + resume + notes ──────────────────────────────────

function Step2({
  form,
  setForm,
  selJob,
  setSelJob,
  selVendor,
  setSelVendor,
  resumeVersions,
  vendors,
}: {
  form: FormState;
  setForm: React.Dispatch<React.SetStateAction<FormState>>;
  selJob: SearchSelectItem | null;
  setSelJob: (item: SearchSelectItem | null) => void;
  selVendor: SearchSelectItem | null;
  setSelVendor: (item: SearchSelectItem | null) => void;
  resumeVersions: ResumeVersion[];
  vendors: any[];
}) {
  return (
    <div className="space-y-4">
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

      {resumeVersions.length > 0 && (
        <SelectInput
          label="Resume version"
          placeholder="No resume attached"
          value={form.resume_id}
          options={resumeVersions.map((v) => ({
            value: v.id,
            label: `v${v.version} — ${v.file_name}${v.is_current ? ' (current)' : ''}`,
          }))}
          onChange={(e) => setForm((f) => ({ ...f, resume_id: e.target.value }))}
        />
      )}

      <FormInput
        label="Notes (optional)"
        placeholder="Anything the team should know"
        value={form.notes}
        onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))}
      />
    </div>
  );
}

// ── Step 3: Review ─────────────────────────────────────────────────────────

function Step3({
  form,
  selConsultant,
  selJob,
  selVendor,
  resumeVersions,
  duplicate,
}: {
  form: FormState;
  selConsultant: SearchSelectItem | null;
  selJob: SearchSelectItem | null;
  selVendor: SearchSelectItem | null;
  resumeVersions: ResumeVersion[];
  duplicate: boolean;
}) {
  const resume = resumeVersions.find((v) => v.id === form.resume_id);
  return (
    <div className="space-y-4">
      <div
        className="rounded-xl overflow-hidden"
        style={{ border: '1px solid var(--border)', background: 'var(--surface)' }}
      >
        <ReviewRow label="Consultant" value={selConsultant?.label ?? '—'} />
        <ReviewRow label="Job" value={selJob?.label ?? '—'} sub={selJob?.sublabel} />
        <ReviewRow label="Vendor" value={selVendor?.label ?? 'None'} />
        <ReviewRow
          label="Resume"
          value={resume ? `v${resume.version} — ${resume.file_name}` : 'None attached'}
        />
        {form.notes && <ReviewRow label="Notes" value={form.notes} />}
      </div>

      {duplicate && (
        <div
          className="flex items-start gap-2.5 p-3 rounded-xl text-sm"
          style={{
            background: 'var(--warn-soft)',
            border: '1px solid color-mix(in srgb, var(--warn) 30%, transparent)',
            color: 'var(--warn)',
          }}
        >
          <span className="text-lg leading-none mt-px">⚠</span>
          <div>
            <strong className="font-semibold">Duplicate detected.</strong> A submission already
            exists for this consultant + job + vendor. Submitting again will create a second record.
          </div>
        </div>
      )}
    </div>
  );
}

function ReviewRow({ label, value, sub }: { label: string; value: string; sub?: string | null }) {
  return (
    <div
      className="flex gap-3 px-4 py-3 border-b border-border last:border-b-0"
      style={{ borderColor: 'var(--border)' }}
    >
      <div
        className="w-20 shrink-0 text-xs font-semibold uppercase tracking-wide pt-0.5"
        style={{ color: 'var(--muted)' }}
      >
        {label}
      </div>
      <div className="flex-1 min-w-0">
        <div className="text-sm font-medium" style={{ color: 'var(--ink)' }}>
          {value}
        </div>
        {sub && (
          <div className="text-xs mt-0.5" style={{ color: 'var(--muted)' }}>
            {sub}
          </div>
        )}
      </div>
    </div>
  );
}

// ── Main component ─────────────────────────────────────────────────────────

interface Props {
  open: boolean;
  onClose: () => void;
  /** Pre-fill consultant when launched from a consultant's detail view. */
  preConsultantId?: string;
  preConsultantLabel?: string;
  /** Pre-fill job when launched from a job detail page. */
  preJobId?: string;
  preJobLabel?: string;
  preJobSublabel?: string;
  onSuccess?: () => void;
}

export function NewSubmissionModal({
  open,
  onClose,
  preConsultantId,
  preConsultantLabel,
  preJobId,
  preJobLabel,
  preJobSublabel,
  onSuccess,
}: Props) {
  const { profile } = useAuth();
  const isMobile = useIsMobile();

  // ── Step state ──
  const [step, setStep] = useState(1);

  // ── Form state ──
  const [form, setForm] = useState<FormState>(EMPTY);
  const [selConsultant, setSelConsultant] = useState<SearchSelectItem | null>(null);
  const [selJob, setSelJob] = useState<SearchSelectItem | null>(null);
  const [selVendor, setSelVendor] = useState<SearchSelectItem | null>(null);

  // ── Data ──
  const [consultants, setConsultants] = useState<ConsultantOption[]>([]);
  const [consultantsLoading, setConsultantsLoading] = useState(false);
  const [vendors, setVendors] = useState<any[]>([]);
  const [resumeVersions, setResumeVersions] = useState<ResumeVersion[]>([]);
  const [duplicate, setDuplicate] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  // Apply prefills whenever the modal opens
  useEffect(() => {
    if (!open) return;
    setStep(1);
    setDuplicate(false);

    const initForm: FormState = { ...EMPTY };
    let initConsultant: SearchSelectItem | null = null;
    let initJob: SearchSelectItem | null = null;

    if (preConsultantId && preConsultantLabel) {
      initForm.consultant_id = preConsultantId;
      initConsultant = { value: preConsultantId, label: preConsultantLabel };
    }
    if (preJobId && preJobLabel) {
      initForm.job_id = preJobId;
      initJob = { value: preJobId, label: preJobLabel, sublabel: preJobSublabel };
    }

    setForm(initForm);
    setSelConsultant(initConsultant);
    setSelJob(initJob);
    setSelVendor(null);
    setResumeVersions([]);
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps

  // Load consultants + vendors when the modal opens
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

  // Load resume versions when consultant changes
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

  // Duplicate check when reaching step 3
  useEffect(() => {
    if (step !== 3 || !form.consultant_id || !form.job_id) {
      setDuplicate(false);
      return;
    }
    const { notes: _n, resume_id: _r, ...dupParams } = form;
    void _n;
    void _r;
    api
      .get('/applications/check-duplicate', { params: dupParams })
      .then((r) => setDuplicate(!!r.data?.duplicate))
      .catch(() => setDuplicate(false));
  }, [step]); // eslint-disable-line react-hooks/exhaustive-deps

  const close = useCallback(() => {
    onClose();
    // Reset is handled by the open→true effect
  }, [onClose]);

  const canAdvance = step === 1 ? !!form.consultant_id : step === 2 ? !!form.job_id : true;

  async function submit() {
    if (submitting) return;
    setSubmitting(true);
    try {
      const payload = { ...form, resume_id: form.resume_id || null };
      if (duplicate) {
        await api.post('/applications', { ...payload, force: true });
      } else {
        await api.post('/applications', payload);
      }
      toast.success('Submission logged');
      invalidate('applications');
      onSuccess?.();
      close();
    } catch (e: any) {
      toast.error(e?.response?.data?.error ?? 'Something went wrong. Please try again.');
    } finally {
      setSubmitting(false);
    }
  }

  // ── Shared inner content ──
  const stepContent =
    step === 1 ? (
      <Step1
        consultants={consultants}
        loading={consultantsLoading}
        form={form}
        setForm={setForm}
        selConsultant={selConsultant}
        setSelConsultant={setSelConsultant}
        profile={profile}
      />
    ) : step === 2 ? (
      <Step2
        form={form}
        setForm={setForm}
        selJob={selJob}
        setSelJob={setSelJob}
        selVendor={selVendor}
        setSelVendor={setSelVendor}
        resumeVersions={resumeVersions}
        vendors={vendors}
      />
    ) : (
      <Step3
        form={form}
        selConsultant={selConsultant}
        selJob={selJob}
        selVendor={selVendor}
        resumeVersions={resumeVersions}
        duplicate={duplicate}
      />
    );

  const backBtn =
    step > 1 ? (
      <Button variant="outline" onClick={() => setStep((s) => s - 1)}>
        Back
      </Button>
    ) : (
      <Button variant="ghost" onClick={close}>
        Cancel
      </Button>
    );

  const nextBtn =
    step < 3 ? (
      <Button variant="primary" disabled={!canAdvance} onClick={() => setStep((s) => s + 1)}>
        Continue
      </Button>
    ) : (
      <Button variant="accent" loading={submitting} onClick={submit}>
        {submitting ? 'Submitting…' : duplicate ? 'Submit anyway' : 'Submit'}
      </Button>
    );

  // ── Desktop: Modal ──────────────────────────────────────────────────────
  if (!isMobile) {
    return (
      <Modal
        open={open}
        onClose={close}
        size="lg"
        title="New submission"
        description="Submit a consultant to a job opening."
        footer={
          <>
            {backBtn}
            {nextBtn}
          </>
        }
      >
        <Stepper step={step} />
        {stepContent}
      </Modal>
    );
  }

  // ── Mobile: BottomSheet + StickyActionBar ──────────────────────────────
  return (
    <BottomSheet
      open={open}
      onClose={close}
      title="New submission"
      maxHeightFraction={0.92}
      footer={
        <div className="flex gap-2.5">
          {backBtn}
          <div className="flex-1">{nextBtn}</div>
        </div>
      }
    >
      <Stepper step={step} />
      {stepContent}
    </BottomSheet>
  );
}
