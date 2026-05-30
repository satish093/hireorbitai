import { useEffect, useMemo, useState } from 'react';
import { Layout } from '../components/Layout';
import { DataTable } from '../components/DataTable';
import { StatusBadge } from '../components/StatusBadge';
import { PageHeader } from '../components/PageHeader';
import { Button } from '../components/Button';
import { EmptyState } from '../components/EmptyState';
import { SkeletonCard } from '../components/Skeleton';
import { ApplicationCard, type ApplicationRow } from '../components/ApplicationCard';
import { NewSubmissionModal } from '../components/NewSubmissionModal';
import { api } from '../services/api';
import { invalidate, useInvalidationListener } from '../hooks/useInvalidate';
import { useAuth } from '../context/AuthContext';
import { IconFileText } from '../components/Icons';
import toast from 'react-hot-toast';
import clsx from 'clsx';

// Stage tabs with their API status values
const STAGES = [
  { key: 'ALL', label: 'All' },
  { key: 'SCREENING', label: 'Screening' },
  { key: 'INTERVIEW', label: 'Interview' },
  { key: 'OFFER', label: 'Offer' },
  { key: 'PLACED', label: 'Placed' },
  { key: 'REJECTED', label: 'Rejected' },
] as const;

type StageKey = (typeof STAGES)[number]['key'];

export function Applications() {
  const { profile } = useAuth();
  const [rows, setRows] = useState<ApplicationRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [stage, setStage] = useState<StageKey>('ALL');
  const [submissionOpen, setSubmissionOpen] = useState(false);

  function load() {
    setLoading(true);
    api
      .get('/applications')
      .then((r) => setRows(r.data ?? []))
      .catch((e) => toast.error(e?.response?.data?.error ?? 'Failed to load applications'))
      .finally(() => setLoading(false));
  }

  useEffect(() => {
    load();
  }, []);

  useInvalidationListener('applications', () => load());

  // Stage counts for tab badges
  const counts = useMemo<Record<StageKey, number>>(() => {
    const c: Record<string, number> = { ALL: rows.length };
    for (const r of rows) {
      c[r.status] = (c[r.status] ?? 0) + 1;
    }
    return c as Record<StageKey, number>;
  }, [rows]);

  // Filtered rows for the active stage
  const visible = useMemo(
    () => (stage === 'ALL' ? rows : rows.filter((r) => r.status === stage)),
    [rows, stage],
  );

  const canSubmit = profile?.role !== 'CONSULTANT';

  return (
    <Layout title="Applications">
      <PageHeader
        title="Applications"
        description="Submissions tied to a consultant + job + vendor. Duplicate detection runs before each submit."
        action={
          canSubmit && (
            <Button variant="primary" onClick={() => setSubmissionOpen(true)}>
              + Log submission
            </Button>
          )
        }
      />

      {/* ── Stage tabs ── */}
      <div
        className="flex items-center gap-1 overflow-x-auto mb-4 pb-0.5"
        style={{ borderBottom: '1px solid var(--border)' }}
        role="tablist"
        aria-label="Application stages"
      >
        {STAGES.map((s) => {
          const count = counts[s.key];
          const active = stage === s.key;
          return (
            <button
              key={s.key}
              role="tab"
              aria-selected={active}
              onClick={() => setStage(s.key)}
              className={clsx(
                'flex items-center gap-1.5 px-3.5 py-2.5 text-[13.5px] font-semibold whitespace-nowrap border-b-2 -mb-px transition-colors',
                active ? 'text-ink border-accent' : 'text-muted border-transparent hover:text-ink',
              )}
            >
              {s.label}
              {count != null && count > 0 && (
                <span
                  className={clsx(
                    'text-[11px] font-bold rounded-full px-1.5 py-px',
                    active ? 'bg-hover text-ink-2' : 'bg-hover text-muted',
                  )}
                >
                  {count}
                </span>
              )}
            </button>
          );
        })}
      </div>

      {/* ── Desktop: DataTable ── */}
      <div className="hidden md:block">
        <DataTable
          loading={loading}
          empty={`No ${stage === 'ALL' ? '' : stage.toLowerCase() + ' '}submissions yet.`}
          columns={[
            {
              key: 'consultant',
              header: 'Consultant',
              render: (a: ApplicationRow) =>
                a.consultant?.user?.full_name ?? a.consultant?.user?.email ?? '—',
            },
            { key: 'job', header: 'Job', render: (a: ApplicationRow) => a.job?.title ?? '—' },
            {
              key: 'vendor',
              header: 'Vendor',
              render: (a: ApplicationRow) => a.vendor?.company_name ?? '—',
            },
            {
              key: 'recruiter',
              header: 'Recruiter',
              hideOnMobile: true,
              render: (a: ApplicationRow) =>
                a.recruiter?.user?.full_name ?? a.recruiter?.user?.email ?? '—',
            },
            {
              key: 'date',
              header: 'Submitted',
              hideOnMobile: true,
              render: (a: ApplicationRow) =>
                a.submitted_at ? new Date(a.submitted_at).toLocaleDateString() : '—',
            },
            {
              key: 'status',
              header: 'Status',
              render: (a: ApplicationRow) => <StatusBadge status={a.status} />,
            },
          ]}
          rows={visible}
        />
      </div>

      {/* ── Mobile: entity cards ── */}
      <div className="flex md:hidden flex-col gap-3">
        {loading ? (
          <>
            <SkeletonCard />
            <SkeletonCard />
            <SkeletonCard />
          </>
        ) : visible.length === 0 ? (
          <EmptyState
            icon={<IconFileText size={22} className="text-muted" />}
            title="No submissions"
            description={
              stage === 'ALL'
                ? canSubmit
                  ? 'Log your first submission to get started.'
                  : 'No submissions yet.'
                : `No ${stage.toLowerCase()} submissions.`
            }
            action={
              canSubmit && stage === 'ALL' ? (
                <Button variant="accent" onClick={() => setSubmissionOpen(true)}>
                  Log submission
                </Button>
              ) : undefined
            }
            compact
          />
        ) : (
          visible.map((a) => <ApplicationCard key={a.id} application={a} />)
        )}
      </div>

      {/* ── New submission 3-step flow ── */}
      <NewSubmissionModal
        open={submissionOpen}
        onClose={() => setSubmissionOpen(false)}
        onSuccess={() => {
          setSubmissionOpen(false);
          load();
          invalidate('applications');
        }}
      />
    </Layout>
  );
}
