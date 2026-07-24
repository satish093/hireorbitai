import { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { Layout } from '../components/Layout';
import { DataTable } from '../components/DataTable';
import { Modal } from '../components/Modal';
import { Drawer } from '../components/Drawer';
import { BottomSheet } from '../components/BottomSheet';
import { SelectInput } from '../components/SelectInput';
import { Avatar } from '../components/TaskBits';
import { StatusBadge } from '../components/StatusBadge';
import { PageHeader } from '../components/PageHeader';
import { Button } from '../components/Button';
import { EmptyState } from '../components/EmptyState';
import { SkeletonCard } from '../components/Skeleton';
import { GroupBadge, useUserGroups, invalidateUserGroupsCache } from '../components/GroupBadge';
import { MarketingStatusSelect, MarketingStatusPills } from '../components/MarketingStatusSelect';
import {
  ConsultantCard,
  filterConsultants,
  type ConsultantRow,
} from '../components/ConsultantCard';
import { NewSubmissionModal } from '../components/NewSubmissionModal';
import { useEntityList } from '../hooks/useEntityList';
import { api } from '../services/api';
import { useAuth } from '../context/AuthContext';
import { ADMIN_TIER, MANAGER_TIER } from '../types';
import { IconSearch, IconUsers } from '../components/Icons';
import toast from 'react-hot-toast';
import clsx from 'clsx';

// ── Re-export so existing callers still compile ─────────────────────────────
export type { ConsultantRow };

interface RecruiterRow {
  id: string;
  team?: string | null;
  user?: {
    id?: string;
    full_name?: string | null;
    email?: string | null;
    group_id?: string | null;
  } | null;
}

export function Consultants() {
  const { profile } = useAuth();
  const { groups } = useUserGroups();
  const canAssignRecruiter =
    !!profile && (MANAGER_TIER as readonly string[]).includes(profile.role);
  const canEditGroup = !!profile && (MANAGER_TIER as readonly string[]).includes(profile.role);
  const isAdminTierUser = !!profile && (ADMIN_TIER as readonly string[]).includes(profile.role);

  const [searchParams, setSearchParams] = useSearchParams();
  const recruiterFilter = searchParams.get('recruiter');

  // ── Data ──
  const [rows, setRows] = useState<ConsultantRow[]>([]);
  const [recruiters, setRecruiters] = useState<RecruiterRow[]>([]);
  const [listLoading, setListLoading] = useState(true);

  // ── Entity list state (search + status filter) ──
  const { query, setQuery, filters, setFilter } = useEntityList<{ status: string }>({
    status: 'ALL',
  });

  // ── Detail drawer ──
  const [detail, setDetail] = useState<ConsultantRow | null>(null);
  const [filterSheetOpen, setFilterSheetOpen] = useState(false);
  const [submissionFor, setSubmissionFor] = useState<ConsultantRow | null>(null);

  // ── Assign recruiter modal ──
  const [picked, setPicked] = useState<ConsultantRow | null>(null);
  const [selectedRecruiter, setSelectedRecruiter] = useState('');
  const [saving, setSaving] = useState(false);

  // ── Group edit modal ──
  const [groupPicked, setGroupPicked] = useState<ConsultantRow | null>(null);
  const [selectedGroup, setSelectedGroup] = useState<string>('');
  const [selectedGroupRecruiter, setSelectedGroupRecruiter] = useState<string>('');
  const [confirmGroupMoveOpen, setConfirmGroupMoveOpen] = useState(false);
  const [savingGroup, setSavingGroup] = useState(false);

  function load() {
    setListLoading(true);
    api
      .get('/consultants', recruiterFilter ? { params: { recruiter_id: recruiterFilter } } : {})
      .then((r) => setRows(r.data ?? []))
      .catch((e) => toast.error(e?.response?.data?.error ?? 'Failed to load consultants'))
      .finally(() => setListLoading(false));
  }

  useEffect(() => {
    let cancelled = false;
    load();
    if (canAssignRecruiter) {
      api
        .get('/recruiters')
        .then((r) => {
          if (!cancelled) setRecruiters(r.data ?? []);
        })
        .catch((e) => {
          if (!cancelled) toast.error(e?.response?.data?.error ?? 'Failed to load recruiters');
        });
    }
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canAssignRecruiter, recruiterFilter]);

  const filteredRecruiterName = recruiterFilter
    ? (recruiters.find((r) => r.id === recruiterFilter)?.user?.full_name ??
      rows.find((r) => r.recruiter_id === recruiterFilter)?.recruiter?.user?.full_name ??
      'selected recruiter')
    : null;

  // Client-side filtering (search + status)
  const filtered = filterConsultants(rows, query, filters.status);

  // ── Assign recruiter ──
  function openAssign(c: ConsultantRow) {
    setPicked(c);
    setSelectedRecruiter(c.recruiter_id ?? '');
  }

  async function save() {
    if (!picked) return;
    if (!selectedRecruiter) {
      toast.error('Pick a recruiter');
      return;
    }
    if (selectedRecruiter === picked.recruiter_id) {
      setPicked(null);
      return;
    }
    setSaving(true);
    try {
      await api.post(`/consultants/${picked.id}/assign-recruiter`, {
        recruiter_id: selectedRecruiter,
      });
      toast.success('Recruiter assigned');
      setPicked(null);
      load();
    } catch (e: any) {
      toast.error(e?.response?.data?.error ?? 'Failed to assign');
    } finally {
      setSaving(false);
    }
  }

  // ── Group edit ──
  function openGroupEdit(c: ConsultantRow) {
    setGroupPicked(c);
    setSelectedGroup(c.user?.group_id ?? '');
    setSelectedGroupRecruiter(c.recruiter_id ?? '');
    setConfirmGroupMoveOpen(false);
  }

  async function saveGroup() {
    if (!groupPicked) return;
    if (selectedGroup && !selectedGroupRecruiter) {
      toast.error('Pick a recruiter in the selected group');
      return;
    }
    setConfirmGroupMoveOpen(true);
  }

  async function confirmSaveGroup() {
    if (!groupPicked) return;
    setSavingGroup(true);
    try {
      await api.post(`/consultants/${groupPicked.id}/move-group`, {
        group_id: selectedGroup || null,
        recruiter_id: selectedGroup ? selectedGroupRecruiter : null,
      });
      toast.success('Group updated');
      invalidateUserGroupsCache();
      setConfirmGroupMoveOpen(false);
      setGroupPicked(null);
      setSelectedGroupRecruiter('');
      load();
    } catch (e: any) {
      toast.error(e?.response?.data?.error ?? 'Failed to update group');
    } finally {
      setSavingGroup(false);
    }
  }

  async function setStatus(id: string, marketing_status: string) {
    try {
      await api.post(`/consultants/${id}/marketing-status`, { marketing_status });
      load();
    } catch (e: any) {
      toast.error(e?.response?.data?.error ?? 'Something went wrong. Please try again.');
    }
  }

  return (
    <Layout title="Consultants">
      <PageHeader
        title="Consultants"
        description={
          canAssignRecruiter
            ? 'Active bench. Assign recruiters, set marketing status, and open profiles for full context.'
            : 'Active bench. Review profiles and update marketing status.'
        }
      />

      {/* Recruiter filter banner */}
      {recruiterFilter && (
        <div className="mb-3 flex items-center justify-between gap-3 rounded-lg border border-brand-200 bg-brand-50 px-3 py-2 text-sm text-brand-800">
          <span>
            Showing consultants assigned to{' '}
            <span className="font-semibold">{filteredRecruiterName}</span>
          </span>
          <button
            type="button"
            onClick={() => {
              searchParams.delete('recruiter');
              setSearchParams(searchParams, { replace: true });
            }}
            className="text-xs font-medium text-brand-700 hover:underline"
          >
            Clear filter
          </button>
        </div>
      )}

      {/* ── Desktop toolbar (search + status pills) ── */}
      <div className="hidden md:flex items-center gap-3 mb-4 flex-wrap">
        <div
          className="flex items-center gap-2 h-9 px-3 rounded-lg flex-1 max-w-xs"
          style={{ background: 'var(--surface)', border: '1px solid var(--border)' }}
        >
          <IconSearch size={15} className="text-muted shrink-0" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search consultants…"
            className="flex-1 bg-transparent text-sm outline-none text-ink placeholder:text-muted"
            style={{ fontSize: 14 }}
          />
        </div>
        <MarketingStatusPills active={filters.status} onChange={(v) => setFilter('status', v)} />
      </div>

      {/* ── Mobile toolbar (search + filter button) ── */}
      <div className="flex md:hidden items-center gap-2 mb-4">
        <div
          className="flex items-center gap-2 h-10 px-3 rounded-xl flex-1"
          style={{ background: 'var(--surface)', border: '1px solid var(--border)' }}
        >
          <IconSearch size={15} className="text-muted shrink-0" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search…"
            className="flex-1 bg-transparent outline-none text-ink placeholder:text-muted"
            style={{ fontSize: 16 }}
          />
        </div>
        <button
          onClick={() => setFilterSheetOpen(true)}
          className={clsx(
            'h-10 px-3 rounded-xl text-sm font-semibold border shrink-0',
            filters.status !== 'ALL'
              ? 'bg-ink text-bg border-ink'
              : 'bg-surface text-ink-2 border-border',
          )}
        >
          {filters.status !== 'ALL' ? filters.status : 'Filter'}
        </button>
      </div>

      {/* ── Desktop: DataTable ── */}
      <div className="hidden md:block">
        <DataTable
          rows={filtered}
          loading={listLoading}
          empty="No consultants match."
          onRowClick={(c) => setDetail(c)}
          columns={[
            {
              key: 'name',
              header: 'Name',
              render: (c: ConsultantRow) =>
                c.user?.id ? (
                  <Link
                    to={`/users/${c.user.id}`}
                    className="inline-flex items-center gap-2 hover:bg-hover rounded-md -mx-1 px-1 py-0.5"
                    onClick={(e) => e.stopPropagation()}
                  >
                    <Avatar name={c.user?.full_name} email={c.user?.email} size={26} />
                    <div className="leading-tight">
                      <div className="text-sm font-medium text-ink hover:underline">
                        {c.user?.full_name ?? c.user?.email ?? '—'}
                      </div>
                      {c.current_location && (
                        <div className="text-[11px] text-muted">{c.current_location}</div>
                      )}
                    </div>
                  </Link>
                ) : (
                  <div className="inline-flex items-center gap-2">
                    <Avatar name={c.user?.full_name} email={c.user?.email} size={26} />
                    <div className="leading-tight">
                      <div className="text-sm font-medium text-ink">
                        {c.user?.full_name ?? c.user?.email ?? '—'}
                      </div>
                      {c.current_location && (
                        <div className="text-[11px] text-muted">{c.current_location}</div>
                      )}
                    </div>
                  </div>
                ),
            },
            {
              key: 'group',
              header: 'Group',
              hideOnMobile: true,
              render: (c: ConsultantRow) => <GroupBadge groupId={c.user?.group_id ?? null} />,
            },
            {
              key: 'primary_skill',
              header: 'Primary skill',
              render: (c: ConsultantRow) => c.primary_skill ?? '—',
            },
            {
              key: 'visa_status',
              header: 'Visa',
              hideOnMobile: true,
              render: (c: ConsultantRow) => c.visa_status ?? '—',
            },
            {
              key: 'experience',
              header: 'Exp',
              hideOnMobile: true,
              render: (c: ConsultantRow) => `${c.total_experience_years ?? 0} yrs`,
            },
            {
              key: 'recruiter',
              header: 'Recruiter',
              render: (c: ConsultantRow) =>
                c.recruiter ? (
                  <div className="inline-flex items-center gap-1.5">
                    <Avatar
                      name={c.recruiter.user?.full_name}
                      email={c.recruiter.user?.email}
                      size={20}
                    />
                    <div className="leading-tight">
                      <div className="text-sm text-ink">
                        {c.recruiter.user?.full_name ?? c.recruiter.user?.email ?? '—'}
                      </div>
                      {c.recruiter.team && (
                        <div className="text-[11px] text-muted">{c.recruiter.team}</div>
                      )}
                    </div>
                  </div>
                ) : (
                  <span className="text-xs italic text-muted">Unassigned</span>
                ),
            },
            {
              key: 'status',
              header: 'Status',
              render: (c: ConsultantRow) => (
                <span onClick={(e) => e.stopPropagation()}>
                  <MarketingStatusSelect
                    value={c.marketing_status}
                    onChange={(v) => setStatus(c.id, v)}
                  />
                </span>
              ),
            },
            ...(canAssignRecruiter || canEditGroup
              ? [
                  {
                    key: 'actions',
                    header: '',
                    align: 'right' as const,
                    render: (c: ConsultantRow) => (
                      <div
                        className="flex items-center justify-end gap-1"
                        onClick={(e) => e.stopPropagation()}
                      >
                        {canAssignRecruiter && (
                          <Button size="sm" variant="ghost" onClick={() => openAssign(c)}>
                            {c.recruiter ? 'Reassign' : 'Assign'}
                          </Button>
                        )}
                        {canEditGroup && (
                          <Button size="sm" variant="ghost" onClick={() => openGroupEdit(c)}>
                            Group
                          </Button>
                        )}
                      </div>
                    ),
                  },
                ]
              : []),
          ]}
        />
      </div>

      {/* ── Mobile: entity cards ── */}
      <div className="flex md:hidden flex-col gap-3">
        {listLoading ? (
          <>
            <SkeletonCard />
            <SkeletonCard />
            <SkeletonCard />
          </>
        ) : filtered.length === 0 ? (
          <EmptyState
            icon={<IconUsers size={22} className="text-muted" />}
            title="No consultants"
            description={
              query || filters.status !== 'ALL'
                ? 'Try clearing your search or filter.'
                : 'No consultants on the bench yet.'
            }
            compact
          />
        ) : (
          filtered.map((c) => (
            <ConsultantCard key={c.id} consultant={c} onClick={() => setDetail(c)} />
          ))
        )}
      </div>

      {/* ── Consultant detail Drawer ── */}
      <Drawer
        open={!!detail}
        onClose={() => setDetail(null)}
        title={detail?.user?.full_name ?? detail?.user?.email ?? 'Consultant'}
        description={detail?.primary_skill ?? undefined}
        footer={
          detail ? (
            <div className="flex gap-2 flex-wrap">
              <Button
                variant="accent"
                onClick={() => {
                  setSubmissionFor(detail);
                  setDetail(null);
                }}
              >
                New submission
              </Button>
              {canAssignRecruiter && (
                <Button
                  variant="outline"
                  onClick={() => {
                    openAssign(detail);
                    setDetail(null);
                  }}
                >
                  {detail.recruiter ? 'Reassign' : 'Assign recruiter'}
                </Button>
              )}
            </div>
          ) : null
        }
      >
        {detail && (
          <div className="space-y-6">
            {/* Profile header */}
            <div className="flex items-center gap-4">
              <Avatar name={detail.user?.full_name} email={detail.user?.email} size={56} />
              <div>
                <div className="text-lg font-semibold text-ink">
                  {detail.user?.full_name ?? detail.user?.email ?? '—'}
                </div>
                {detail.primary_skill && (
                  <div className="text-sm text-muted mt-0.5">{detail.primary_skill}</div>
                )}
                <div className="mt-1.5">
                  <StatusBadge status={detail.marketing_status} />
                </div>
              </div>
            </div>

            {/* Facts grid */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {[
                { label: 'Visa', value: detail.visa_status ?? '—' },
                {
                  label: 'Experience',
                  value:
                    detail.total_experience_years != null
                      ? `${detail.total_experience_years} years`
                      : '—',
                },
                { label: 'Location', value: detail.current_location ?? '—' },
                {
                  label: 'Recruiter',
                  value:
                    detail.recruiter?.user?.full_name ??
                    detail.recruiter?.user?.email ??
                    'Unassigned',
                },
              ].map(({ label, value }) => (
                <div
                  key={label}
                  className="rounded-xl px-3 py-2.5"
                  style={{ background: 'var(--surface-2)', border: '1px solid var(--border)' }}
                >
                  <div
                    className="text-[10.5px] font-bold uppercase tracking-wide mb-1"
                    style={{ color: 'var(--muted)' }}
                  >
                    {label}
                  </div>
                  <div className="text-sm font-medium" style={{ color: 'var(--ink)' }}>
                    {value}
                  </div>
                </div>
              ))}
            </div>

            {/* Group */}
            {detail.user?.group_id && (
              <div>
                <div className="text-xs font-semibold uppercase tracking-wide text-muted mb-2">
                  Group
                </div>
                <GroupBadge groupId={detail.user.group_id} />
              </div>
            )}

            {/* Manager-only actions */}
            {canEditGroup && (
              <div className="pt-2 border-t border-border">
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => {
                    openGroupEdit(detail);
                    setDetail(null);
                  }}
                >
                  Move group…
                </Button>
              </div>
            )}
          </div>
        )}
      </Drawer>

      {/* ── Mobile filter BottomSheet ── */}
      <BottomSheet
        open={filterSheetOpen}
        onClose={() => setFilterSheetOpen(false)}
        title="Filter consultants"
        footer={
          <div className="flex gap-2">
            <Button
              variant="ghost"
              block
              onClick={() => {
                setFilter('status', 'ALL');
                setFilterSheetOpen(false);
              }}
            >
              Reset
            </Button>
            <Button variant="primary" block onClick={() => setFilterSheetOpen(false)}>
              Done
            </Button>
          </div>
        }
      >
        <div className="pt-2">
          <div className="text-xs font-semibold uppercase tracking-wide text-muted mb-3">
            Status
          </div>
          <MarketingStatusPills active={filters.status} onChange={(v) => setFilter('status', v)} />
        </div>
      </BottomSheet>

      {/* ── New submission modal (pre-filled from detail) ── */}
      <NewSubmissionModal
        open={!!submissionFor}
        onClose={() => setSubmissionFor(null)}
        preConsultantId={submissionFor?.id}
        preConsultantLabel={
          submissionFor?.user?.full_name ?? submissionFor?.user?.email ?? undefined
        }
        onSuccess={() => setSubmissionFor(null)}
      />

      {/* ── Assign recruiter modal ── */}
      <Modal
        open={!!picked}
        onClose={() => setPicked(null)}
        title={
          picked?.recruiter
            ? `Reassign ${picked.user?.full_name ?? 'consultant'}`
            : 'Assign recruiter'
        }
        footer={
          <>
            <Button variant="secondary" onClick={() => setPicked(null)}>
              Cancel
            </Button>
            <Button
              onClick={save}
              loading={saving}
              disabled={!selectedRecruiter || selectedRecruiter === picked?.recruiter_id}
            >
              {saving ? 'Saving' : 'Save assignment'}
            </Button>
          </>
        }
      >
        <div className="space-y-3">
          {picked?.recruiter && (
            <div className="text-xs text-muted">
              Currently assigned to{' '}
              <span className="font-medium text-ink">
                {picked.recruiter.user?.full_name ?? picked.recruiter.user?.email}
              </span>
              .
            </div>
          )}
          <SelectInput
            label="Recruiter"
            placeholder="Select a recruiter…"
            value={selectedRecruiter}
            onChange={(e) => setSelectedRecruiter(e.target.value)}
            options={recruiters.map((r) => ({
              value: r.id,
              label: `${r.user?.full_name ?? r.user?.email ?? r.id}${r.team ? ' · ' + r.team : ''}`,
            }))}
          />
        </div>
      </Modal>

      {/* ── Group edit modal ── */}
      <Modal
        open={!!groupPicked}
        onClose={() => setGroupPicked(null)}
        title={`Move ${groupPicked?.user?.full_name ?? 'consultant'} to a group`}
        footer={
          <>
            <Button variant="secondary" onClick={() => setGroupPicked(null)}>
              Cancel
            </Button>
            <Button
              onClick={saveGroup}
              loading={savingGroup}
              disabled={
                selectedGroup === (groupPicked?.user?.group_id ?? '') ||
                (!!selectedGroup && !selectedGroupRecruiter)
              }
            >
              {savingGroup ? 'Saving' : 'Save'}
            </Button>
          </>
        }
      >
        <div className="space-y-3">
          {groupPicked?.recruiter && (
            <p className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-md px-3 py-2">
              This consultant is assigned to{' '}
              <span className="font-medium">
                {groupPicked.recruiter.user?.full_name ?? groupPicked.recruiter.user?.email}
              </span>
              . Their recruiter must belong to the same group.
            </p>
          )}
          <SelectInput
            label="Group"
            placeholder="No group (clear)"
            value={selectedGroup}
            onChange={(e) => {
              const nextGroup = e.target.value;
              setSelectedGroup(nextGroup);
              const firstRecruiter =
                recruiters.find((r) => r.user?.group_id === nextGroup)?.id ?? '';
              setSelectedGroupRecruiter(firstRecruiter);
            }}
            options={(isAdminTierUser
              ? groups
              : groups.filter((g) => g.id === profile?.group_id)
            ).map((g) => ({ value: g.id, label: g.name }))}
          />
          {selectedGroup && (
            <SelectInput
              label="Recruiter in selected group"
              placeholder="Select a recruiter..."
              value={selectedGroupRecruiter}
              onChange={(e) => setSelectedGroupRecruiter(e.target.value)}
              options={recruiters
                .filter((r) => r.user?.group_id === selectedGroup)
                .map((r) => ({
                  value: r.id,
                  label: `${r.user?.full_name ?? r.user?.email ?? r.id}${r.team ? ' - ' + r.team : ''}`,
                }))}
            />
          )}
          {selectedGroup &&
            recruiters.filter((r) => r.user?.group_id === selectedGroup).length === 0 && (
              <p className="text-xs text-danger">No recruiters are in the selected group.</p>
            )}
        </div>
      </Modal>

      {/* ── Confirm group move ── */}
      <Modal
        open={confirmGroupMoveOpen}
        onClose={() => setConfirmGroupMoveOpen(false)}
        title="Confirm group change"
        description="This change will update the consultant's group and recruiter assignment."
        footer={
          <>
            <Button variant="secondary" onClick={() => setConfirmGroupMoveOpen(false)}>
              Cancel
            </Button>
            <Button onClick={confirmSaveGroup} loading={savingGroup}>
              Confirm
            </Button>
          </>
        }
      >
        <p className="text-sm text-ink">
          Move{' '}
          <span className="font-semibold">
            {groupPicked?.user?.full_name ?? groupPicked?.user?.email ?? 'this consultant'}
          </span>{' '}
          to the selected group and assign them to{' '}
          <span className="font-semibold">
            {recruiters.find((r) => r.id === selectedGroupRecruiter)?.user?.full_name ??
              recruiters.find((r) => r.id === selectedGroupRecruiter)?.user?.email ??
              'the selected recruiter'}
          </span>
          ?
        </p>
      </Modal>
    </Layout>
  );
}
