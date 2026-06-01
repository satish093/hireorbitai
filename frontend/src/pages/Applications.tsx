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
import { Modal } from '../components/Modal';
import { api } from '../services/api';
import { invalidate, useInvalidationListener } from '../hooks/useInvalidate';
import { useAuth } from '../context/AuthContext';
import { ADMIN_TIER } from '../types';
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

// The application_status enum (database/schema.sql). The stage TABS use a
// product-friendly subset; this is the full set a row can be moved between.
const APP_STATUSES = [
  'SUBMITTED',
  'SCREENING',
  'INTERVIEW',
  'OFFER',
  'REJECTED',
  'WITHDRAWN',
] as const;

export function Applications() {
  const { profile } = useAuth();
  const [rows, setRows] = useState<ApplicationRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [stage, setStage] = useState<StageKey>('ALL');
  const [submissionOpen, setSubmissionOpen] = useState(false);
  // Manage-submission modal (status / notes / rejection reason). The page is
  // OPERATOR_TIER-gated, and PATCH /applications/:id scopes edits to the owning
  // recruiter + managers — so anyone who can open this page + see a row may
  // manage it (the backend 404s a row that isn't theirs).
  const [editApp, setEditApp] = useState<ApplicationRow | null>(null);
  const [editForm, setEditForm] = useState({ status: '', notes: '', rejection_reason: '' });
  const [savingEdit, setSavingEdit] = useState(false);

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
  // Only operators manage the pipeline. (Consultants can't reach this page, but
  // gate anyway so the edit affordance never attaches for them.)
  const canManage = canSubmit;
  // Admin-tier (SUPER_ADMIN / CEO / CTO / DIRECTOR) can hard-delete a
  // submission — matches the backend DELETE /applications/:id gate. Destructive:
  // it cascades to the submission's interviews + apply-event history.
  const canDelete = !!profile && ADMIN_TIER.includes(profile.role);

  function openEdit(a: ApplicationRow) {
    setEditApp(a);
    setEditForm({
      status: a.status,
      notes: (a as any).notes ?? '',
      rejection_reason: (a as any).rejection_reason ?? '',
    });
  }

  async function saveEdit() {
    if (!editApp || savingEdit) return;
    setSavingEdit(true);
    try {
      const payload: Record<string, unknown> = {
        status: editForm.status,
        notes: editForm.notes || null,
        // Only carry a rejection reason while REJECTED; clear it otherwise.
        rejection_reason: editForm.status === 'REJECTED' ? editForm.rejection_reason || null : null,
      };
      await api.patch(`/applications/${editApp.id}`, payload);
      const id = editApp.id;
      const nextStatus = editForm.status;
      setRows((prev) => prev.map((r) => (r.id === id ? { ...r, status: nextStatus } : r)));
      toast.success('Submission updated');
      setEditApp(null);
      invalidate('applications');
    } catch (e: any) {
      toast.error(e?.response?.data?.error ?? 'Update failed');
    } finally {
      setSavingEdit(false);
    }
  }

  async function remove(id: string) {
    if (
      !confirm(
        'Delete this submission? This also removes its scheduled interviews and apply history, and cannot be undone.',
      )
    )
      return;
    try {
      await api.delete(`/applications/${id}`);
      setRows((prev) => prev.filter((r) => r.id !== id));
      toast.success('Submission deleted');
      invalidate('applications');
    } catch (e: any) {
      toast.error(e?.response?.data?.error ?? 'Delete failed');
    }
  }

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
            ...(canDelete
              ? [
                  {
                    key: 'actions',
                    header: '',
                    align: 'right' as const,
                    render: (a: ApplicationRow) => (
                      <Button
                        variant="danger-ghost"
                        size="sm"
                        onClick={(e) => {
                          e.stopPropagation();
                          remove(a.id);
                        }}
                      >
                        Delete
                      </Button>
                    ),
                  },
                ]
              : []),
          ]}
          rows={visible}
          onRowClick={canManage ? openEdit : undefined}
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
          visible.map((a) => (
            <div key={a.id}>
              <ApplicationCard
                application={a}
                onClick={canManage ? () => openEdit(a) : undefined}
              />
              {canDelete && (
                <div className="mt-1 flex justify-end">
                  <Button variant="danger-ghost" size="sm" onClick={() => remove(a.id)}>
                    Delete
                  </Button>
                </div>
              )}
            </div>
          ))
        )}
      </div>

      {/* ── Manage submission (status / notes / rejection) ── */}
      <Modal
        open={!!editApp}
        onClose={() => !savingEdit && setEditApp(null)}
        title="Manage submission"
        description={
          editApp
            ? `${editApp.consultant?.user?.full_name ?? editApp.consultant?.user?.email ?? 'Consultant'} · ${editApp.job?.title ?? 'Job'}`
            : undefined
        }
        footer={
          <>
            <Button variant="secondary" onClick={() => setEditApp(null)} disabled={savingEdit}>
              Cancel
            </Button>
            <Button variant="primary" onClick={saveEdit} loading={savingEdit}>
              {savingEdit ? 'Saving…' : 'Save'}
            </Button>
          </>
        }
      >
        <div className="space-y-3">
          <label className="block">
            <span className="text-[10px] font-semibold uppercase tracking-widest text-muted">
              Status
            </span>
            <select
              value={editForm.status}
              onChange={(e) => setEditForm((f) => ({ ...f, status: e.target.value }))}
              className="mt-1 w-full text-sm bg-surface border border-border rounded-md px-2 py-1.5 focus:outline-none focus:ring-2 focus:ring-brand-500/40"
            >
              {APP_STATUSES.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
          </label>
          {editForm.status === 'REJECTED' && (
            <label className="block">
              <span className="text-[10px] font-semibold uppercase tracking-widest text-muted">
                Rejection reason
              </span>
              <input
                type="text"
                value={editForm.rejection_reason}
                onChange={(e) => setEditForm((f) => ({ ...f, rejection_reason: e.target.value }))}
                placeholder="e.g. Rate too high, role filled"
                className="mt-1 w-full text-sm bg-surface border border-border rounded-md px-2 py-1.5 focus:outline-none focus:ring-2 focus:ring-brand-500/40"
              />
            </label>
          )}
          <label className="block">
            <span className="text-[10px] font-semibold uppercase tracking-widest text-muted">
              Notes
            </span>
            <textarea
              value={editForm.notes}
              onChange={(e) => setEditForm((f) => ({ ...f, notes: e.target.value }))}
              rows={3}
              className="mt-1 w-full text-sm bg-surface border border-border rounded-md px-2 py-1.5 focus:outline-none focus:ring-2 focus:ring-brand-500/40"
            />
          </label>
        </div>
      </Modal>

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
