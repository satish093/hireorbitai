import { useEffect, useRef, useState, useCallback } from 'react';
import { Layout } from '../components/Layout';
import { DataTable } from '../components/DataTable';
import { StatusBadge } from '../components/StatusBadge';
import { Modal } from '../components/Modal';
import { BottomSheet } from '../components/BottomSheet';
import { FormInput } from '../components/FormInput';
import { SelectInput } from '../components/SelectInput';
import { PageHeader } from '../components/PageHeader';
import { Button } from '../components/Button';
import { EmptyState } from '../components/EmptyState';
import { SkeletonCard } from '../components/Skeleton';
import { InvitationCard } from '../components/InvitationCard';
import { IconMailPlus } from '../components/Icons';
import { api } from '../services/api';
import { useAuth } from '../context/AuthContext';
import { invalidate } from '../hooks/useInvalidate';
import { ADMIN_TIER, ROLE_LABEL, assignableRolesFor } from '../types';
import toast from 'react-hot-toast';
import { useIsMobile } from '../hooks/useIsMobile';

type ParentUser = { id: string; full_name: string | null; email: string; role: string };

type ParentsResponse = {
  auto_parent: ParentUser | null;
  candidates: ParentUser[];
};

export function Invitations() {
  const { profile } = useAuth();
  const isMobile = useIsMobile();
  const isAdmin = !!profile && (ADMIN_TIER as string[]).includes(profile.role);

  // Only show roles this actor may actually invite (strictly below their own
  // rank; SUPER_ADMIN may invite anyone). Mirrors the backend ceiling so the
  // dropdown never offers a role the server will reject.
  const ROLE_OPTIONS = profile?.role
    ? assignableRolesFor(profile.role).map((r) => ({ value: r, label: ROLE_LABEL[r] }))
    : [];

  const [rows, setRows] = useState<any[]>([]);
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState<{
    email: string;
    role: string;
    group_id: string;
    parent_user_id: string;
    manual_override: boolean;
  }>({
    email: '',
    role: 'CONSULTANT',
    group_id: '',
    parent_user_id: '',
    manual_override: false,
  });
  const [sending, setSending] = useState(false);
  // Synchronous re-entry guard. `sending` (async state) can't stop a fast
  // double-activation (Enter then click, or a double-tap on the mobile sheet)
  // because React hasn't flipped it yet — that would POST two invites for the
  // same email. This ref flips synchronously at the top of send(). Mirrors the
  // sendInFlightRef pattern in Messages.tsx (commit c25e978).
  const sendInFlight = useRef(false);
  const [loading, setLoading] = useState(true);
  const [groups, setGroups] = useState<{ id: string; name: string; unique_group_id?: string }[]>(
    [],
  );

  // Server-resolved parent state — the frontend never computes this itself.
  const [parentsResp, setParentsResp] = useState<ParentsResponse | null>(null);
  const [parentsLoading, setParentsLoading] = useState(false);
  // When an admin clicks "Change", show the full dropdown with override mode.
  const [showOverride, setShowOverride] = useState(false);

  function load() {
    setLoading(true);
    api
      .get('/invitations')
      .then((r) => setRows(r.data ?? []))
      .catch((e) => toast.error(e?.response?.data?.error ?? 'Failed to load invitations'))
      .finally(() => setLoading(false));
  }

  useEffect(() => {
    load();
    api
      .get('/user-groups')
      .then((r) => setGroups(r.data ?? []))
      .catch(() => {});
  }, []);

  // Ask the server to resolve the parent whenever the role changes.
  // The server is the sole source of truth for auto_parent.
  const fetchParents = useCallback(async (role: string) => {
    setParentsLoading(true);
    setParentsResp(null);
    setShowOverride(false);
    setForm((f) => ({ ...f, parent_user_id: '', manual_override: false }));
    try {
      const r = await api.get<ParentsResponse>('/invitations/available-parents', {
        params: { invited_role: role },
      });
      const resp = r.data;
      setParentsResp(resp);
      // Pre-fill parent_user_id with the server-resolved auto_parent (if any).
      if (resp.auto_parent) {
        setForm((f) => ({ ...f, parent_user_id: resp.auto_parent!.id }));
      } else if (resp.candidates.length === 1) {
        setForm((f) => ({ ...f, parent_user_id: resp.candidates[0]!.id }));
      }
    } catch {
      setParentsResp({ auto_parent: null, candidates: [] });
    } finally {
      setParentsLoading(false);
    }
  }, []);

  // Re-fetch when modal opens or role changes.
  useEffect(() => {
    if (open) fetchParents(form.role);
  }, [open, form.role, fetchParents]);

  function handleRoleChange(e: React.ChangeEvent<HTMLSelectElement>) {
    setForm((f) => ({ ...f, role: e.target.value, parent_user_id: '', manual_override: false }));
  }

  async function send() {
    if (sendInFlight.current || sending) return;
    if (!form.email) {
      toast.error('Email is required');
      return;
    }
    // Require parent if the server returned candidates (role needs a parent).
    if (parentsResp && (parentsResp.auto_parent || parentsResp.candidates.length > 0)) {
      if (!form.parent_user_id) {
        toast.error('Please select a parent user for this role');
        return;
      }
    }
    sendInFlight.current = true;
    setSending(true);
    try {
      const payload: Record<string, unknown> = {
        email: form.email,
        role: form.role,
        group_id: form.group_id || null,
        parent_user_id: form.parent_user_id || null,
      };
      if (form.manual_override) payload.manual_override = true;

      const r = await api.post('/invitations', payload);
      if (r.data?.email_sent) {
        toast.success('Invitation email sent');
      } else {
        toast(
          (t) => (
            <div className="space-y-1">
              <div className="font-medium">Invitation created, but email failed</div>
              <div className="text-xs text-muted">
                {r.data?.email_error ?? 'Unknown email error'}
              </div>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => {
                  copyLink(r.data.invite_url);
                  toast.dismiss(t.id);
                }}
                className="text-xs text-brand-700 hover:underline"
              >
                Copy invite link
              </Button>
            </div>
          ),
          { duration: 12000 },
        );
      }
      setOpen(false);
      setForm({
        email: '',
        role: 'CONSULTANT',
        group_id: '',
        parent_user_id: '',
        manual_override: false,
      });
      setShowOverride(false);
      load();
      invalidate('invitations');
    } catch (e: any) {
      toast.error(e?.response?.data?.error ?? 'Something went wrong. Please try again.');
    } finally {
      sendInFlight.current = false;
      setSending(false);
    }
  }

  async function revoke(id: string) {
    if (!confirm('Revoke this invitation?')) return;
    try {
      await api.post(`/invitations/${id}/revoke`);
      toast.success('Invitation revoked');
      load();
      invalidate('invitations');
    } catch (e: any) {
      toast.error(e?.response?.data?.error ?? 'Revoke failed');
    }
  }

  async function copyLink(url: string) {
    if (!url) return;
    try {
      await navigator.clipboard.writeText(url);
      toast.success('Invite link copied');
    } catch {
      window.prompt('Copy this invite link', url);
    }
  }

  // Parent field — frontend only renders what the server resolved.
  function renderParentField() {
    // No parent needed for this role (admin tier).
    if (parentsResp && !parentsResp.auto_parent && parentsResp.candidates.length === 0) {
      return null;
    }

    if (parentsLoading || !parentsResp) {
      return <div className="text-xs text-muted py-1">Resolving parent…</div>;
    }

    // Server resolved an auto-parent — show green chip unless admin chose to override.
    if (parentsResp.auto_parent && !showOverride) {
      const ap = parentsResp.auto_parent;
      return (
        <div className="flex items-center justify-between rounded-lg border border-green-200 dark:border-green-800 bg-green-50 dark:bg-green-900/20 px-3 py-2">
          <div>
            <span className="text-xs font-medium text-green-700 dark:text-green-400">
              Auto-assigned
            </span>
            <span className="ml-1.5 text-xs text-muted">
              {ap.full_name ?? ap.email} · {ap.role}
            </span>
          </div>
          {isAdmin && parentsResp.candidates.length > 1 && (
            <button
              type="button"
              className="text-xs text-brand-600 hover:underline ml-2 shrink-0"
              onClick={() => {
                setShowOverride(true);
                setForm((f) => ({ ...f, manual_override: true }));
              }}
            >
              Change
            </button>
          )}
        </div>
      );
    }

    // No auto-parent or admin override — show required dropdown.
    if (parentsResp.candidates.length === 0) {
      return (
        <div className="rounded-lg border border-yellow-200 dark:border-yellow-800 bg-yellow-50 dark:bg-yellow-900/20 px-3 py-2 text-xs text-yellow-700 dark:text-yellow-400">
          No eligible parent users found for this role. Invite a{' '}
          {parentsResp.auto_parent?.role ?? 'higher-tier'} user first, or contact an admin.
        </div>
      );
    }

    return (
      <SelectInput
        label={`Parent user *`}
        value={form.parent_user_id}
        onChange={(e) => setForm((f) => ({ ...f, parent_user_id: e.target.value }))}
        options={[
          { value: '', label: 'Select parent…' },
          ...parentsResp.candidates.map((o) => ({
            value: o.id,
            label: `${o.full_name ?? o.email} (${o.role})`,
          })),
        ]}
      />
    );
  }

  return (
    <Layout title="Invitations">
      <PageHeader
        title="Invitations"
        description="Send role-scoped invites by email. Recipients land on /invite/accept and set their own password."
        action={<Button onClick={() => setOpen(true)}>+ Invite user</Button>}
      />
      {/* ── Mobile cards (< md) ── */}
      <div className="flex md:hidden flex-col gap-3 mb-4">
        {loading ? (
          <>
            <SkeletonCard />
            <SkeletonCard />
          </>
        ) : rows.length === 0 ? (
          <EmptyState
            icon={<IconMailPlus size={22} className="text-muted" />}
            title="No invitations yet"
            description="Send the first invite to bring someone on board."
            action={
              <Button variant="accent" onClick={() => setOpen(true)}>
                + Invite user
              </Button>
            }
            compact
          />
        ) : (
          rows.map((r: any) => (
            <InvitationCard
              key={r.id}
              invitation={r}
              onCopyLink={r.invite_url ? () => copyLink(r.invite_url) : undefined}
              onRevoke={() => revoke(r.id)}
            />
          ))
        )}
      </div>

      {/* ── Desktop DataTable (≥ md) ── */}
      <div className="hidden md:block">
        <DataTable
          loading={loading}
          empty="No invitations yet."
          columns={[
            { key: 'email', header: 'Email' },
            {
              key: 'role',
              header: 'Role',
              render: (r: any) => (
                <span className="text-[11px] font-medium bg-hover text-ink px-1.5 py-0.5 rounded">
                  {r.role}
                </span>
              ),
            },
            {
              key: 'status',
              header: 'Status',
              render: (r: any) => <StatusBadge status={r.status} />,
            },
            {
              key: 'expires_at',
              header: 'Expires',
              hideOnMobile: true,
              render: (r: any) => (r.expires_at ? new Date(r.expires_at).toLocaleString() : '—'),
            },
            {
              key: 'actions',
              header: '',
              align: 'right',
              render: (r: any) =>
                r.status === 'PENDING' ? (
                  <div className="flex items-center justify-end gap-1">
                    {r.invite_url && (
                      <Button size="sm" variant="ghost" onClick={() => copyLink(r.invite_url)}>
                        Copy link
                      </Button>
                    )}
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => revoke(r.id)}
                      className="text-red-600 dark:text-red-400 hover:text-red-700"
                    >
                      Revoke
                    </Button>
                  </div>
                ) : null,
            },
          ]}
          rows={rows}
        />
      </div>
      {/* end desktop DataTable */}

      {/* ── Create form — Modal on desktop, BottomSheet on mobile ── */}
      {isMobile ? (
        <BottomSheet
          open={open}
          onClose={() => {
            setOpen(false);
            setShowOverride(false);
          }}
          title="Invite user"
          footer={
            <div className="flex gap-2">
              <Button variant="ghost" block onClick={() => setOpen(false)}>
                Cancel
              </Button>
              <Button block onClick={send} loading={sending}>
                {sending ? 'Sending…' : 'Send invite'}
              </Button>
            </div>
          }
        >
          <div className="space-y-4 pt-1">
            <FormInput
              label="Email *"
              type="email"
              value={form.email}
              onChange={(e) => setForm({ ...form, email: e.target.value })}
            />
            <SelectInput
              label="Role"
              value={form.role}
              onChange={handleRoleChange}
              options={ROLE_OPTIONS}
            />
            {renderParentField()}
            {isAdmin ? (
              <SelectInput
                label="Group"
                value={form.group_id}
                onChange={(e) => setForm({ ...form, group_id: e.target.value })}
                options={[
                  { value: '', label: 'No Group' },
                  ...groups.map((g) => ({
                    value: g.id,
                    label: g.unique_group_id ? `${g.name} (${g.unique_group_id})` : g.name,
                  })),
                ]}
              />
            ) : (
              // Non-admin (group lead / recruiter): the invitee always lands in
              // YOUR group — the backend defaults missing group_id to the
              // caller's own and rejects any other group_id (assertCanAssignGroup).
              // Don't expose an arbitrary picker that the backend will reject.
              <p className="text-xs text-muted">Invitee will be added to your group.</p>
            )}
          </div>
        </BottomSheet>
      ) : (
        <Modal
          open={open}
          onClose={() => {
            setOpen(false);
            setShowOverride(false);
          }}
          title="Invite user"
          description="A welcome email goes out with a one-time setup link."
          footer={
            <>
              <Button variant="secondary" onClick={() => setOpen(false)}>
                Cancel
              </Button>
              <Button onClick={send} loading={sending}>
                {sending ? 'Sending…' : 'Send invite'}
              </Button>
            </>
          }
        >
          <div className="space-y-3">
            <FormInput
              label="Email *"
              type="email"
              value={form.email}
              onChange={(e) => setForm({ ...form, email: e.target.value })}
            />
            <SelectInput
              label="Role"
              value={form.role}
              onChange={handleRoleChange}
              options={ROLE_OPTIONS}
            />
            {renderParentField()}
            {isAdmin ? (
              <SelectInput
                label="Group"
                value={form.group_id}
                onChange={(e) => setForm({ ...form, group_id: e.target.value })}
                options={[
                  { value: '', label: 'No Group' },
                  ...groups.map((g) => ({
                    value: g.id,
                    label: g.unique_group_id ? `${g.name} (${g.unique_group_id})` : g.name,
                  })),
                ]}
              />
            ) : (
              <p className="text-xs text-muted">Invitee will be added to your group.</p>
            )}
          </div>
        </Modal>
      )}
    </Layout>
  );
}
