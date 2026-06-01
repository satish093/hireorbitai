import { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import toast from 'react-hot-toast';
import { Layout } from '../components/Layout';
import { SkeletonCard } from '../components/Skeleton';
import { Button } from '../components/Button';
import { Modal } from '../components/Modal';
import { Avatar } from '../components/TaskBits';
import { PresencePill } from '../components/PresenceDot';
import { useAuth } from '../context/AuthContext';
import { api } from '../services/api';
import { invalidate } from '../hooks/useInvalidate';
import { ADMIN_TIER, MANAGER_TIER, ROLE_LABEL, Role } from '../types';
import { GroupBadge } from '../components/GroupBadge';
import { replayTour } from '../components/ProductTour';

interface UserProfile {
  id: string;
  email: string;
  full_name: string | null;
  first_name?: string | null;
  last_name?: string | null;
  phone: string | null;
  role: Role;
  avatar_url: string | null;
  is_active: boolean;
  last_seen_at: string | null;
  group_id: string | null;
  reports_to?: string | null;
  address_line1?: string | null;
  address_line2?: string | null;
  city?: string | null;
  state?: string | null;
  postal_code?: string | null;
  country?: string | null;
  timezone?: string | null;
  linkedin_url?: string | null;
  context?: {
    consultant?: {
      id: string;
      primary_skill?: string | null;
      skills?: string[] | null;
      total_experience_years?: number | null;
      visa_status?: string | null;
      current_location?: string | null;
      preferred_locations?: string[] | null;
      marketing_status?: string | null;
      linkedin_url?: string | null;
      github_url?: string | null;
    };
    recruiter?: any;
  };
}

export function UserProfile() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { profile: me } = useAuth();
  const isManagerTier = !!me && (MANAGER_TIER as string[]).includes(me.role);
  const isAdmin = !!me && (ADMIN_TIER as string[]).includes(me.role);
  const isSelf = me?.id === id;
  const canEdit = isManagerTier || isSelf;

  const [user, setUser] = useState<UserProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState<Partial<UserProfile>>({});
  // Consultant-detail draft — lives on the `consultants` table, so it saves via
  // a separate PATCH /consultants/:id. Kept as strings for the inputs; parsed
  // and normalised in save(). marketing_status has its own OPERATOR_TIER route.
  const [consForm, setConsForm] = useState({
    primary_skill: '',
    total_experience_years: '',
    visa_status: '',
    current_location: '',
    skills: '',
    marketing_status: '',
  });
  const [saving, setSaving] = useState(false);
  const [actBusy, setActBusy] = useState(false);
  const [showDelete, setShowDelete] = useState(false);
  const [showDeactivate, setShowDeactivate] = useState(false);
  const [deleteConfirmText, setDeleteConfirmText] = useState('');

  // Seed the consultant draft from a loaded profile (mount / save / cancel).
  function seedConsForm(k?: NonNullable<UserProfile['context']>['consultant']) {
    setConsForm({
      primary_skill: k?.primary_skill ?? '',
      total_experience_years:
        k?.total_experience_years != null ? String(k.total_experience_years) : '',
      visa_status: k?.visa_status ?? '',
      current_location: k?.current_location ?? '',
      skills: (k?.skills ?? []).join(', '),
      marketing_status: k?.marketing_status ?? '',
    });
  }

  // Close any open admin modal on Escape (when not mid-action). Native
  // window.confirm was previously used for the deactivate step — switching
  // to a styled modal here for consistency with the delete dialog.
  useEffect(() => {
    if (!showDelete && !showDeactivate) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !actBusy) {
        setShowDelete(false);
        setShowDeactivate(false);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [showDelete, showDeactivate, actBusy]);

  useEffect(() => {
    if (!id) return;
    let cancelled = false;
    setLoading(true);
    (async () => {
      try {
        const r = await api.get(`/users/${id}`);
        if (cancelled) return;
        setUser(r.data);
        setForm(r.data);
        seedConsForm(r.data.context?.consultant);
      } catch (e: any) {
        if (cancelled) return;
        const status = e?.response?.status;
        if (status === 403) toast.error("You don't have permission to view this profile");
        else if (status === 404) toast.error('User not found');
        else toast.error(e?.response?.data?.error ?? 'Failed to load profile');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [id]);

  // Allowlist of user-editable fields. Anything not in this list (role,
  // is_active, group_id, reports_to, last_seen_at, context, etc.) stays
  // server-managed and is dropped from the PATCH payload.
  //
  // NOTE: `full_name` is intentionally NOT here. The server recomputes it
  // from first_name + last_name whenever either changes. If we sent the
  // stale `full_name` that came back on the GET, the server would treat it
  // as "user explicitly chose this" and skip the recompute (the bug we
  // hit before — typing a new last name didn't update the displayed full
  // name).
  const EDITABLE_FIELDS = [
    'first_name',
    'last_name',
    'phone',
    'linkedin_url',
    'avatar_url',
    'address_line1',
    'address_line2',
    'city',
    'state',
    'postal_code',
    'country',
    'timezone',
  ] as const;

  async function deactivate() {
    if (!user || actBusy) return;
    setActBusy(true);
    try {
      const r = await api.post(`/users/${user.id}/deactivate`);
      // The endpoint returns a compact row; merge into local state to flip the badge.
      setUser({ ...user, is_active: false, ...(r.data?.user ?? {}) });
      toast.success('Account deactivated');
      setShowDeactivate(false);
      // Notify the admin list / deactivated page so they refetch.
      invalidate('users');
    } catch (e: any) {
      toast.error(e?.response?.data?.error ?? 'Failed to deactivate');
    } finally {
      setActBusy(false);
    }
  }

  async function reactivate() {
    if (!user || actBusy) return;
    setActBusy(true);
    try {
      const r = await api.post(`/users/${user.id}/reactivate`);
      setUser({ ...user, is_active: true, ...(r.data?.user ?? {}) });
      toast.success('Account reactivated');
      invalidate('users');
    } catch (e: any) {
      toast.error(e?.response?.data?.error ?? 'Failed to reactivate');
    } finally {
      setActBusy(false);
    }
  }

  async function remove() {
    if (!user || actBusy) return;
    if (deleteConfirmText.trim().toLowerCase() !== user.email.toLowerCase()) {
      toast.error('Type the email exactly to confirm deletion');
      return;
    }
    setActBusy(true);
    try {
      await api.delete(`/users/${user.id}`);
      toast.success('Account deleted');
      // The user is gone — invalidate so any open admin tab drops the row.
      invalidate('users');
      navigate('/admin/deactivated', { replace: true });
    } catch (e: any) {
      toast.error(e?.response?.data?.error ?? 'Failed to delete');
    } finally {
      setActBusy(false);
    }
  }

  async function save() {
    if (!user || saving) return;
    setSaving(true);
    const patch: Record<string, unknown> = {};
    for (const k of EDITABLE_FIELDS) {
      if (k in form) patch[k] = (form as any)[k];
    }
    try {
      // 1) User-table fields.
      await api.patch(`/users/${user.id}`, patch);

      // 2) Consultant-table fields (separate resource). Only the onboarding
      //    allowlist keys — marketing_status has its own route below. Backend
      //    scopes who may edit (admin/lead/recruiter-of-them/self); the page's
      //    Edit button is already gated by canEdit.
      const cons = user.context?.consultant;
      if (cons?.id) {
        const consPatch: Record<string, unknown> = {
          primary_skill: consForm.primary_skill,
          visa_status: consForm.visa_status,
          current_location: consForm.current_location,
          skills: consForm.skills
            .split(',')
            .map((s) => s.trim())
            .filter(Boolean),
        };
        const yrs = parseFloat(consForm.total_experience_years);
        if (!Number.isNaN(yrs)) consPatch.total_experience_years = yrs;
        await api.patch(`/consultants/${cons.id}`, consPatch);

        // marketing_status: dedicated OPERATOR_TIER route; only manager-tier can
        // set it (a consultant can't market themselves), and only when changed.
        if (
          isManagerTier &&
          consForm.marketing_status &&
          consForm.marketing_status !== (cons.marketing_status ?? '')
        ) {
          await api.post(`/consultants/${cons.id}/marketing-status`, {
            marketing_status: consForm.marketing_status,
          });
        }
      }

      // Refetch the merged profile (user + consultant context) so the view is
      // authoritative rather than a hand-merged guess.
      const fresh = await api.get(`/users/${user.id}`);
      setUser(fresh.data);
      setForm(fresh.data);
      seedConsForm(fresh.data.context?.consultant);
      setEditing(false);
      toast.success('Profile saved');
    } catch (e: any) {
      toast.error(e?.response?.data?.error ?? 'Failed to save');
    } finally {
      setSaving(false);
    }
  }

  if (loading)
    return (
      <Layout title="Profile">
        <div className="max-w-3xl">
          <SkeletonCard lines={6} />
        </div>
      </Layout>
    );
  if (!user)
    return (
      <Layout title="Profile">
        <div className="text-sm text-muted">User not available.</div>
      </Layout>
    );

  const displayName =
    user.full_name?.trim() ||
    [user.first_name, user.last_name].filter(Boolean).join(' ').trim() ||
    user.email;

  return (
    <Layout
      title={displayName}
      crumbs={[{ label: 'Workspace', to: '/dashboard' }, { label: 'Profile' }]}
    >
      <Button variant="ghost" size="sm" onClick={() => navigate(-1)} className="mb-3">
        ← Back
      </Button>

      <div className="bg-surface border border-border rounded-2xl overflow-hidden">
        {/* Header */}
        <div className="px-6 py-5 border-b border-border flex items-start gap-4">
          <Avatar name={displayName} email={user.email} size={64} />
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <h1 className="text-xl font-semibold tracking-tight text-ink">{displayName}</h1>
              <PresencePill lastSeenAt={user.last_seen_at} />
              {!user.is_active && (
                <span className="text-[10px] font-semibold uppercase tracking-wider bg-hover text-muted px-1.5 py-0.5 rounded">
                  Inactive
                </span>
              )}
            </div>
            <div className="text-sm text-muted mt-0.5 flex items-center gap-2 flex-wrap">
              <span className="text-[10px] font-semibold uppercase tracking-widest bg-hover text-ink px-1.5 py-0.5 rounded">
                {ROLE_LABEL[user.role] ?? user.role}
              </span>
              <GroupBadge groupId={user.group_id} />
              <span>·</span>
              <span>{user.email}</span>
            </div>
          </div>
          {canEdit && !editing && (
            <div className="flex items-center gap-2">
              {isAdmin && !isSelf && (
                <>
                  {user.is_active ? (
                    <Button
                      variant="outline"
                      onClick={() => setShowDeactivate(true)}
                      disabled={actBusy}
                    >
                      Deactivate
                    </Button>
                  ) : (
                    <Button variant="outline" onClick={reactivate} disabled={actBusy}>
                      Reactivate
                    </Button>
                  )}
                  <Button
                    variant="danger"
                    onClick={() => {
                      setShowDelete(true);
                      setDeleteConfirmText('');
                    }}
                    disabled={actBusy}
                  >
                    Delete
                  </Button>
                </>
              )}
              {isSelf && (
                <Button variant="ghost" onClick={replayTour} title="Replay the product tour">
                  Replay tour
                </Button>
              )}
              <Button variant="primary" onClick={() => setEditing(true)}>
                Edit
              </Button>
            </div>
          )}
          {editing && (
            <div className="flex items-center gap-2">
              <Button
                variant="outline"
                onClick={() => {
                  setEditing(false);
                  setForm(user);
                  seedConsForm(user.context?.consultant);
                }}
              >
                Cancel
              </Button>
              <Button variant="primary" onClick={save} disabled={saving} loading={saving}>
                {saving ? 'Saving…' : 'Save'}
              </Button>
            </div>
          )}
        </div>

        {/* Sections */}
        <div className="p-6 grid grid-cols-1 md:grid-cols-2 gap-6 stagger-children">
          {/* Editable fields bind `value` to the `form` draft, not the
              immutable `user` object. Binding to `user` meant keystrokes
              updated `form` but the input kept showing the old `user` value —
              so typing appeared to do nothing. `form` is seeded from the
              loaded profile on mount / save / cancel, so the non-editing
              display reads correctly too. */}
          <Card title="Contact">
            <Field
              label="First name"
              value={editing ? (form.first_name ?? '') : user.first_name}
              editing={editing}
              onChange={(v) => setForm((f) => ({ ...f, first_name: v }))}
            />
            <Field
              label="Last name"
              value={editing ? (form.last_name ?? '') : user.last_name}
              editing={editing}
              onChange={(v) => setForm((f) => ({ ...f, last_name: v }))}
            />
            <Field label="Email" value={user.email} readonly />
            <Field
              label="Phone"
              value={editing ? (form.phone ?? '') : (user.phone ?? '')}
              editing={editing}
              onChange={(v) => setForm((f) => ({ ...f, phone: v }))}
            />
            <Field
              label="LinkedIn"
              value={editing ? (form.linkedin_url ?? '') : (user.linkedin_url ?? '')}
              editing={editing}
              onChange={(v) => setForm((f) => ({ ...f, linkedin_url: v }))}
              type="url"
            />
          </Card>

          <Card title="Address">
            <Field
              label="Street"
              value={editing ? (form.address_line1 ?? '') : (user.address_line1 ?? '')}
              editing={editing}
              onChange={(v) => setForm((f) => ({ ...f, address_line1: v }))}
            />
            <Field
              label="Apt / Suite"
              value={editing ? (form.address_line2 ?? '') : (user.address_line2 ?? '')}
              editing={editing}
              onChange={(v) => setForm((f) => ({ ...f, address_line2: v }))}
            />
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <Field
                label="City"
                value={editing ? (form.city ?? '') : (user.city ?? '')}
                editing={editing}
                onChange={(v) => setForm((f) => ({ ...f, city: v }))}
              />
              <Field
                label="State"
                value={editing ? (form.state ?? '') : (user.state ?? '')}
                editing={editing}
                onChange={(v) => setForm((f) => ({ ...f, state: v }))}
              />
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <Field
                label="Postal code"
                value={editing ? (form.postal_code ?? '') : (user.postal_code ?? '')}
                editing={editing}
                onChange={(v) => setForm((f) => ({ ...f, postal_code: v }))}
              />
              <Field
                label="Country"
                value={editing ? (form.country ?? '') : (user.country ?? '')}
                editing={editing}
                onChange={(v) => setForm((f) => ({ ...f, country: v }))}
              />
            </div>
            <Field
              label="Timezone"
              value={editing ? (form.timezone ?? '') : (user.timezone ?? '')}
              editing={editing}
              onChange={(v) => setForm((f) => ({ ...f, timezone: v }))}
              placeholder="America/New_York"
            />
          </Card>

          {/* Consultant / Recruiter context */}
          {user.context?.consultant && (
            <Card title="Consultant details">
              <Field
                label="Primary skill"
                value={
                  editing ? consForm.primary_skill : (user.context.consultant.primary_skill ?? '')
                }
                editing={editing}
                onChange={(v) => setConsForm((f) => ({ ...f, primary_skill: v }))}
              />
              <Field
                label="Years of experience"
                type="number"
                value={
                  editing
                    ? consForm.total_experience_years
                    : String(user.context.consultant.total_experience_years ?? '')
                }
                editing={editing}
                onChange={(v) => setConsForm((f) => ({ ...f, total_experience_years: v }))}
              />
              <Field
                label="Visa status"
                value={editing ? consForm.visa_status : (user.context.consultant.visa_status ?? '')}
                editing={editing}
                onChange={(v) => setConsForm((f) => ({ ...f, visa_status: v }))}
              />
              <Field
                label="Current location"
                value={
                  editing
                    ? consForm.current_location
                    : (user.context.consultant.current_location ?? '')
                }
                editing={editing}
                onChange={(v) => setConsForm((f) => ({ ...f, current_location: v }))}
              />
              {/* Marketing status is a manager-tier decision via its own route —
                  a consultant editing their own profile sees it read-only. */}
              {editing && isManagerTier ? (
                <label className="block">
                  <span className="text-[10px] font-semibold uppercase tracking-widest text-muted">
                    Marketing status
                  </span>
                  <select
                    value={consForm.marketing_status}
                    onChange={(e) =>
                      setConsForm((f) => ({ ...f, marketing_status: e.target.value }))
                    }
                    className="mt-1 w-full text-sm bg-surface border border-border rounded-md px-2 py-1.5 focus:outline-none focus:ring-2 focus:ring-brand-500/40"
                  >
                    <option value="">Not set</option>
                    <option value="ACTIVE">ACTIVE</option>
                    <option value="PAUSED">PAUSED</option>
                    <option value="PLACED">PLACED</option>
                  </select>
                </label>
              ) : (
                <Field
                  label="Marketing status"
                  value={user.context.consultant.marketing_status ?? ''}
                  readonly
                />
              )}
              {editing ? (
                <Field
                  label="Skills (comma-separated)"
                  value={consForm.skills}
                  editing={editing}
                  onChange={(v) => setConsForm((f) => ({ ...f, skills: v }))}
                  placeholder="React, Node.js, AWS"
                />
              ) : (
                user.context.consultant.skills &&
                user.context.consultant.skills.length > 0 && (
                  <div className="pt-2">
                    <div className="text-[10px] font-semibold uppercase tracking-widest text-muted mb-1">
                      Skills
                    </div>
                    <div className="flex flex-wrap gap-1.5">
                      {user.context.consultant.skills.map((s) => (
                        <span
                          key={s}
                          className="text-[11px] bg-hover text-ink px-2 py-0.5 rounded-full"
                        >
                          {s}
                        </span>
                      ))}
                    </div>
                  </div>
                )
              )}
            </Card>
          )}

          {user.context?.recruiter && (
            <Card title="Recruiter details">
              <Field label="Team" value={user.context.recruiter.team ?? ''} readonly />
              {user.context.recruiter.manager && (
                <Field
                  label="Manager"
                  value={
                    user.context.recruiter.manager.full_name ??
                    user.context.recruiter.manager.email ??
                    ''
                  }
                  readonly
                />
              )}
              {typeof user.context.recruiter.target_submissions_per_week === 'number' && (
                <Field
                  label="Target submissions / week"
                  value={String(user.context.recruiter.target_submissions_per_week)}
                  readonly
                />
              )}
            </Card>
          )}
        </div>
      </div>

      {/* Replaced inline `fixed inset-0` divs with the shared <Modal> — the
          inline version rendered as a child of <main>, which carries the
          `animate-page-enter` transform. A transformed ancestor re-anchors
          `position:fixed` to itself, so the dialog visually centered against
          the content area instead of the viewport on every page that scrolled.
          <Modal> portals to document.body + handles focus trap + Escape +
          scroll lock. */}
      <Modal
        open={showDeactivate}
        onClose={() => !actBusy && setShowDeactivate(false)}
        title="Deactivate account?"
        size="md"
        footer={
          <div className="flex items-center justify-end gap-2">
            <Button variant="outline" onClick={() => setShowDeactivate(false)} disabled={actBusy}>
              Cancel
            </Button>
            <Button variant="danger" onClick={deactivate} disabled={actBusy} loading={actBusy}>
              {actBusy ? 'Deactivating…' : 'Deactivate'}
            </Button>
          </div>
        }
      >
        <p className="text-sm text-muted">
          <span className="font-medium text-ink">{user.email}</span> will be signed out of every
          session and unable to log in until you reactivate them. Their data is preserved.
        </p>
      </Modal>

      <Modal
        open={showDelete}
        onClose={() => !actBusy && setShowDelete(false)}
        title="Delete account permanently?"
        size="md"
        footer={
          <div className="flex items-center justify-end gap-2">
            <Button variant="outline" onClick={() => setShowDelete(false)} disabled={actBusy}>
              Cancel
            </Button>
            <Button
              variant="danger"
              onClick={remove}
              disabled={
                actBusy || deleteConfirmText.trim().toLowerCase() !== user.email.toLowerCase()
              }
              loading={actBusy}
            >
              {actBusy ? 'Deleting…' : 'Delete permanently'}
            </Button>
          </div>
        }
      >
        <p className="text-sm text-muted">
          This will permanently remove <span className="font-medium text-ink">{user.email}</span>'s
          auth user, profile row, and active sessions. This action cannot be undone.
        </p>
        <p className="text-xs text-muted mt-3">
          Prefer{' '}
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => {
              setShowDelete(false);
              setShowDeactivate(true);
            }}
            className="text-amber-700 dark:text-amber-300 hover:underline"
          >
            deactivate
          </Button>{' '}
          if you want to keep the audit trail.
        </p>
        <label className="block mt-4">
          <span className="text-[10px] font-semibold uppercase tracking-widest text-muted">
            Type <span className="text-ink">{user.email}</span> to confirm
          </span>
          <input
            type="text"
            value={deleteConfirmText}
            onChange={(e) => setDeleteConfirmText(e.target.value)}
            autoComplete="off"
            className="mt-1 w-full text-sm bg-surface border border-border rounded-md px-2 py-1.5 focus:outline-none focus:ring-2 focus:ring-red-500/40"
          />
        </label>
      </Modal>
    </Layout>
  );
}

function Card({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="bg-hover border border-border rounded-xl p-4">
      <div className="text-[10px] font-semibold uppercase tracking-widest text-muted mb-3">
        {title}
      </div>
      <div className="space-y-2.5">{children}</div>
    </div>
  );
}

function Field({
  label,
  value,
  editing,
  onChange,
  readonly,
  placeholder,
  type,
}: {
  label: string;
  value: string | null | undefined;
  editing?: boolean;
  onChange?: (v: string) => void;
  readonly?: boolean;
  placeholder?: string;
  type?: string;
}) {
  if (editing && !readonly && onChange) {
    return (
      <label className="block">
        <span className="text-[10px] font-semibold uppercase tracking-widest text-muted">
          {label}
        </span>
        <input
          type={type ?? 'text'}
          value={value ?? ''}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
          className="mt-1 w-full text-sm bg-surface border border-border rounded-md px-2 py-1.5 focus:outline-none focus:ring-2 focus:ring-brand-500/40"
        />
      </label>
    );
  }
  return (
    <div>
      <div className="text-[10px] font-semibold uppercase tracking-widest text-muted">{label}</div>
      <div className="text-sm text-ink mt-0.5">
        {value || <span className="text-muted italic">Not set</span>}
      </div>
    </div>
  );
}
