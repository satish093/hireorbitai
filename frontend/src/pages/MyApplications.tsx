import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import toast from 'react-hot-toast';
import clsx from 'clsx';
import { Layout } from '../components/Layout';
import { PageHeader } from '../components/PageHeader';
import { EmptyState } from '../components/EmptyState';
import { SkeletonCard } from '../components/Skeleton';
import { StatusBadge } from '../components/StatusBadge';
import { Button } from '../components/Button';
import { Modal } from '../components/Modal';
import { IconFileText } from '../components/Icons';
import { api } from '../services/api';
import { useInvalidationListener } from '../hooks/useInvalidate';

interface MyApplicationRow {
  id: string;
  status: string;
  application_type: string | null;
  submitted_at: string | null;
  created_at: string;
  job: { id: string; title: string; company_name: string | null } | null;
  vendor: { id: string; company_name: string } | null;
}

interface ApplicationDetail {
  id: string;
  status: string;
  application_type: string | null;
  submitted_at: string | null;
  cover_letter_text: string | null;
  cover_letter_source: string | null;
  error_code: string | null;
  error_message: string | null;
  job: {
    id: string;
    title: string;
    company_name: string | null;
    linkedin_job_url: string | null;
  } | null;
  vendor: { id: string; company_name: string } | null;
}

interface ApplicationEvent {
  id: string;
  kind: string;
  payload: Record<string, unknown> | null;
  created_at: string;
}

const DRAFT_STATUSES = new Set(['READY_FOR_REVIEW', 'NEEDS_USER_ACTION', 'SUBMITTING']);
const ARCHIVED_STATUSES = new Set(['REJECTED', 'WITHDRAWN']);

const FILTERS = [
  { key: 'ALL', label: 'All' },
  { key: 'DRAFT', label: 'In progress' },
  { key: 'APPLIED', label: 'Applied' },
  { key: 'ARCHIVED', label: 'Archived' },
] as const;
type FilterKey = (typeof FILTERS)[number]['key'];

function matchesFilter(status: string, filter: FilterKey): boolean {
  if (filter === 'ALL') return true;
  if (filter === 'DRAFT') return DRAFT_STATUSES.has(status);
  if (filter === 'ARCHIVED') return ARCHIVED_STATUSES.has(status);
  return !DRAFT_STATUSES.has(status) && !ARCHIVED_STATUSES.has(status);
}

function formatEventKind(kind: string): string {
  return kind.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

/**
 * Consultant-facing self-apply history — LinkedIn Application Copilot drafts
 * + submissions, plus any quick-logged "I already applied on LinkedIn"
 * entries. Separate from the operator /applications pipeline view: this page
 * only ever shows the caller's own rows (backend scopes via loadAndAuthorize /
 * getCallerConsultantRowId, never a recruiter's book).
 */
export function MyApplications() {
  const navigate = useNavigate();
  const [rows, setRows] = useState<MyApplicationRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<FilterKey>('ALL');
  const [detailId, setDetailId] = useState<string | null>(null);
  const [detail, setDetail] = useState<ApplicationDetail | null>(null);
  const [events, setEvents] = useState<ApplicationEvent[]>([]);
  const [detailLoading, setDetailLoading] = useState(false);

  function load() {
    setLoading(true);
    api
      .get('/applications/mine')
      .then((r) => setRows(Array.isArray(r.data) ? r.data : []))
      .catch((e) => toast.error(e?.response?.data?.error ?? 'Failed to load your applications'))
      .finally(() => setLoading(false));
  }

  useEffect(() => {
    load();
  }, []);

  useInvalidationListener('applications', () => load());

  useEffect(() => {
    if (!detailId) {
      setDetail(null);
      setEvents([]);
      return;
    }
    setDetailLoading(true);
    Promise.all([api.get(`/applications/${detailId}`), api.get(`/applications/${detailId}/events`)])
      .then(([d, e]) => {
        setDetail(d.data);
        setEvents(Array.isArray(e.data) ? e.data : []);
      })
      .catch((e) => toast.error(e?.response?.data?.error ?? 'Failed to load application detail'))
      .finally(() => setDetailLoading(false));
  }, [detailId]);

  const counts = useMemo<Record<FilterKey, number>>(() => {
    const c: Record<FilterKey, number> = { ALL: rows.length, DRAFT: 0, APPLIED: 0, ARCHIVED: 0 };
    for (const r of rows) {
      if (DRAFT_STATUSES.has(r.status)) c.DRAFT += 1;
      else if (ARCHIVED_STATUSES.has(r.status)) c.ARCHIVED += 1;
      else c.APPLIED += 1;
    }
    return c;
  }, [rows]);

  const visible = rows.filter((r) => matchesFilter(r.status, filter));

  return (
    <Layout title="My Applications">
      <PageHeader
        title="My Applications"
        description="Everything you've applied to via the LinkedIn Application Copilot or logged yourself."
      />

      <div
        className="flex items-center gap-1 overflow-x-auto mb-4 pb-0.5"
        style={{ borderBottom: '1px solid var(--border)' }}
        role="tablist"
        aria-label="Application filters"
      >
        {FILTERS.map((f) => {
          const active = filter === f.key;
          const count = counts[f.key];
          return (
            <button
              key={f.key}
              role="tab"
              aria-selected={active}
              onClick={() => setFilter(f.key)}
              className={clsx(
                'flex items-center gap-1.5 px-3.5 py-2.5 text-[13.5px] font-semibold whitespace-nowrap border-b-2 -mb-px transition-colors',
                active ? 'text-ink border-accent' : 'text-muted border-transparent hover:text-ink',
              )}
            >
              {f.label}
              {count > 0 && (
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

      {loading ? (
        <div className="flex flex-col gap-3">
          <SkeletonCard />
          <SkeletonCard />
          <SkeletonCard />
        </div>
      ) : visible.length === 0 ? (
        <EmptyState
          icon={<IconFileText size={22} className="text-muted" />}
          title="No applications yet"
          description={
            filter === 'ALL'
              ? 'Apply to a LinkedIn job from Jobs to see it show up here.'
              : 'Nothing in this filter yet.'
          }
          action={
            <Button variant="accent" onClick={() => navigate('/jobs')}>
              Browse jobs
            </Button>
          }
        />
      ) : (
        <div className="flex flex-col gap-2.5">
          {visible.map((a) => (
            <button
              key={a.id}
              onClick={() => setDetailId(a.id)}
              className="w-full text-left bg-surface border border-border rounded-xl px-4 py-3.5 hover:border-border-strong transition flex items-center justify-between gap-3"
            >
              <div className="min-w-0">
                <div className="text-sm font-semibold text-ink truncate">
                  {a.job?.title ?? 'Job removed'}
                </div>
                <div className="text-xs text-muted truncate mt-0.5">
                  {a.job?.company_name ?? a.vendor?.company_name ?? '—'}
                  {a.application_type === 'linkedin_copilot' && ' · via LinkedIn Copilot'}
                  {a.application_type === 'linkedin_external' && ' · logged from LinkedIn'}
                </div>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <span className="text-[11px] text-muted hidden sm:inline">
                  {new Date(a.submitted_at ?? a.created_at).toLocaleDateString()}
                </span>
                <StatusBadge status={a.status} />
              </div>
            </button>
          ))}
        </div>
      )}

      <Modal
        open={!!detailId}
        onClose={() => setDetailId(null)}
        title={detail?.job?.title ?? 'Application'}
        description={detail?.job?.company_name ?? undefined}
        size="lg"
        footer={
          detail?.job?.linkedin_job_url ? (
            <Button
              variant="outline"
              onClick={() =>
                window.open(detail.job!.linkedin_job_url!, '_blank', 'noopener,noreferrer')
              }
            >
              View on LinkedIn
            </Button>
          ) : undefined
        }
      >
        {detailLoading || !detail ? (
          <div className="py-8 text-center text-sm text-muted">Loading…</div>
        ) : (
          <div className="space-y-5">
            <div className="flex items-center gap-2">
              <StatusBadge status={detail.status} />
              {detail.submitted_at && (
                <span className="text-xs text-muted">
                  Submitted {new Date(detail.submitted_at).toLocaleString()}
                </span>
              )}
            </div>

            {DRAFT_STATUSES.has(detail.status) && detail.job && (
              <div className="rounded-xl border border-amber-200 dark:border-amber-500/30 bg-amber-50 dark:bg-amber-500/15 p-3.5">
                <p className="text-xs text-amber-800 dark:text-amber-300 mb-2">
                  This application isn't submitted yet. Reopen it from the job to finish it.
                </p>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => navigate(`/jobs/${detail.job!.id}`)}
                >
                  Go to job
                </Button>
              </div>
            )}

            {detail.error_message && (
              <div className="rounded-xl border border-red-200 dark:border-red-500/30 bg-red-50 dark:bg-red-500/15 p-3.5">
                <p className="text-xs text-red-800 dark:text-red-300">{detail.error_message}</p>
              </div>
            )}

            {detail.cover_letter_text && (
              <div>
                <h4 className="text-xs font-semibold uppercase tracking-wide text-muted mb-1.5">
                  Cover letter
                </h4>
                <p className="text-sm text-ink whitespace-pre-wrap bg-hover rounded-lg p-3">
                  {detail.cover_letter_text}
                </p>
              </div>
            )}

            <div>
              <h4 className="text-xs font-semibold uppercase tracking-wide text-muted mb-1.5">
                Activity
              </h4>
              {events.length === 0 ? (
                <p className="text-xs text-muted italic">No activity recorded yet.</p>
              ) : (
                <ol className="space-y-2">
                  {events.map((e) => (
                    <li key={e.id} className="flex items-baseline justify-between gap-3 text-xs">
                      <span className="text-ink">{formatEventKind(e.kind)}</span>
                      <span className="text-muted shrink-0">
                        {new Date(e.created_at).toLocaleString()}
                      </span>
                    </li>
                  ))}
                </ol>
              )}
            </div>
          </div>
        )}
      </Modal>
    </Layout>
  );
}
