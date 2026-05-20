import { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import toast from 'react-hot-toast';
import { Layout } from '../components/Layout';
import { Avatar } from '../components/TaskBits';
import { PresencePill } from '../components/PresenceDot';
import { useAuth } from '../context/AuthContext';
import { api } from '../services/api';
import { invalidate } from '../hooks/useInvalidate';
import { ADMIN_TIER, MANAGER_TIER, ROLE_LABEL, Role } from '../types';
import { GroupBadge } from '../components/GroupBadge';

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
  const [saving, setSaving] = useState(false);
  const [actBusy, setActBusy] = useState(false);
  const [showDelete, setShowDelete] = useState(false);
  const [showDeactivate, setShowDeactivate] = useState(false);
  const [deleteConfirmText, setDeleteConfirmText] = useState('');

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
      const r = await api.patch(`/users/${user.id}`, patch);
      setUser(r.data);
      setForm(r.data);
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
        <div className="text-sm text-slate-500">Loading…</div>
      </Layout>
    );
  if (!user)
    return (
      <Layout title="Profile">
        <div className="text-sm text-slate-500">User not available.</div>
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
      <button
        onClick={() => navigate(-1)}
        className="text-xs text-slate-500 hover:text-slate-900 mb-3"
      >
        ← Back
      </button>

      <div className="bg-white border border-slate-200 rounded-2xl overflow-hidden">
        {/* Header */}
        <div className="px-6 py-5 border-b border-slate-100 flex items-start gap-4">
          <Avatar name={displayName} email={user.email} size={64} />
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <h1 className="text-xl font-semibold tracking-tight text-slate-900">{displayName}</h1>
              <PresencePill lastSeenAt={user.last_seen_at} />
              {!user.is_active && (
                <span className="text-[10px] font-semibold uppercase tracking-wider bg-slate-100 text-slate-500 px-1.5 py-0.5 rounded">
                  Inactive
                </span>
              )}
            </div>
            <div className="text-sm text-slate-500 mt-0.5 flex items-center gap-2 flex-wrap">
              <span className="text-[10px] font-semibold uppercase tracking-widest bg-slate-100 text-slate-700 px-1.5 py-0.5 rounded">
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
                    <button
                      onClick={() => setShowDeactivate(true)}
                      disabled={actBusy}
                      className="border border-amber-300 text-amber-700 text-sm px-3 py-1.5 rounded-lg hover:bg-amber-50 disabled:opacity-50 press transition-colors"
                    >
                      Deactivate
                    </button>
                  ) : (
                    <button
                      onClick={reactivate}
                      disabled={actBusy}
                      className="border border-emerald-300 text-emerald-700 text-sm px-3 py-1.5 rounded-lg hover:bg-emerald-50 disabled:opacity-50 press transition-colors"
                    >
                      Reactivate
                    </button>
                  )}
                  <button
                    onClick={() => {
                      setShowDelete(true);
                      setDeleteConfirmText('');
                    }}
                    disabled={actBusy}
                    className="border border-red-300 text-red-700 text-sm px-3 py-1.5 rounded-lg hover:bg-red-50 disabled:opacity-50 press transition-colors"
                  >
                    Delete
                  </button>
                </>
              )}
              <button
                onClick={() => setEditing(true)}
                className="bg-slate-900 text-white text-sm px-4 py-1.5 rounded-lg hover:bg-slate-800"
              >
                Edit
              </button>
            </div>
          )}
          {editing && (
            <div className="flex items-center gap-2">
              <button
                onClick={() => {
                  setEditing(false);
                  setForm(user);
                }}
                className="border border-slate-200 text-slate-700 text-sm px-3 py-1.5 rounded-lg hover:bg-slate-50"
              >
                Cancel
              </button>
              <button
                onClick={save}
                disabled={saving}
                className="bg-slate-900 text-white text-sm px-4 py-1.5 rounded-lg hover:bg-slate-800 disabled:opacity-50"
              >
                {saving ? 'Saving…' : 'Save'}
              </button>
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
            <div className="grid grid-cols-2 gap-3">
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
            <div className="grid grid-cols-2 gap-3">
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
                value={user.context.consultant.primary_skill ?? ''}
                readonly
              />
              <Field
                label="Years of experience"
                value={String(user.context.consultant.total_experience_years ?? '')}
                readonly
              />
              <Field
                label="Visa status"
                value={user.context.consultant.visa_status ?? ''}
                readonly
              />
              <Field
                label="Current location"
                value={user.context.consultant.current_location ?? ''}
                readonly
              />
              <Field
                label="Marketing status"
                value={user.context.consultant.marketing_status ?? ''}
                readonly
              />
              {user.context.consultant.skills && user.context.consultant.skills.length > 0 && (
                <div className="pt-2">
                  <div className="text-[10px] font-semibold uppercase tracking-widest text-slate-500 mb-1">
                    Skills
                  </div>
                  <div className="flex flex-wrap gap-1.5">
                    {user.context.consultant.skills.map((s) => (
                      <span
                        key={s}
                        className="text-[11px] bg-slate-100 text-slate-800 px-2 py-0.5 rounded-full"
                      >
                        {s}
                      </span>
                    ))}
                  </div>
                </div>
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

      {showDeactivate && (
        <div
          className="fixed inset-0 z-50 bg-slate-900/40 backdrop-blur-[2px] flex items-center justify-center p-6 animate-fade-in"
          onClick={() => !actBusy && setShowDeactivate(false)}
          role="dialog"
          aria-modal="true"
        >
          <div
            className="bg-white rounded-2xl border border-slate-200 shadow-xl w-full max-w-md p-6 animate-scale-in"
            onClick={(e) => e.stopPropagation()}
          >
            <h2 className="text-lg font-semibold text-slate-900">Deactivate account?</h2>
            <p className="text-sm text-slate-600 mt-2">
              <span className="font-medium text-slate-900">{user.email}</span> will be signed out of
              every session and unable to log in until you reactivate them. Their data is preserved.
            </p>
            <div className="flex items-center justify-end gap-2 mt-5">
              <button
                onClick={() => setShowDeactivate(false)}
                disabled={actBusy}
                className="border border-slate-200 text-slate-700 text-sm px-3 py-1.5 rounded-lg hover:bg-slate-50 disabled:opacity-50 press"
              >
                Cancel
              </button>
              <button
                onClick={deactivate}
                disabled={actBusy}
                className="bg-amber-600 text-white text-sm px-3 py-1.5 rounded-lg hover:bg-amber-700 disabled:opacity-50 press"
              >
                {actBusy ? 'Deactivating…' : 'Deactivate'}
              </button>
            </div>
          </div>
        </div>
      )}

      {showDelete && (
        <div
          className="fixed inset-0 z-50 bg-slate-900/40 backdrop-blur-[2px] flex items-center justify-center p-6 animate-fade-in"
          onClick={() => !actBusy && setShowDelete(false)}
          role="dialog"
          aria-modal="true"
        >
          <div
            className="bg-white rounded-2xl border border-slate-200 shadow-xl w-full max-w-md p-6 animate-scale-in"
            onClick={(e) => e.stopPropagation()}
          >
            <h2 className="text-lg font-semibold text-slate-900">Delete account permanently?</h2>
            <p className="text-sm text-slate-600 mt-2">
              This will permanently remove{' '}
              <span className="font-medium text-slate-900">{user.email}</span>'s auth user, profile
              row, and active sessions. This action cannot be undone.
            </p>
            <p className="text-xs text-slate-500 mt-3">
              Prefer{' '}
              <button
                type="button"
                onClick={() => {
                  setShowDelete(false);
                  setShowDeactivate(true);
                }}
                className="text-amber-700 hover:underline"
              >
                deactivate
              </button>{' '}
              if you want to keep the audit trail.
            </p>
            <label className="block mt-4">
              <span className="text-[10px] font-semibold uppercase tracking-widest text-slate-500">
                Type <span className="text-slate-900">{user.email}</span> to confirm
              </span>
              <input
                type="text"
                value={deleteConfirmText}
                onChange={(e) => setDeleteConfirmText(e.target.value)}
                autoComplete="off"
                className="mt-1 w-full text-sm bg-white border border-slate-200 rounded-md px-2 py-1.5 focus:outline-none focus:ring-2 focus:ring-red-500/40"
              />
            </label>
            <div className="flex items-center justify-end gap-2 mt-5">
              <button
                onClick={() => setShowDelete(false)}
                disabled={actBusy}
                className="border border-slate-200 text-slate-700 text-sm px-3 py-1.5 rounded-lg hover:bg-slate-50 disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                onClick={remove}
                disabled={
                  actBusy || deleteConfirmText.trim().toLowerCase() !== user.email.toLowerCase()
                }
                className="bg-red-600 text-white text-sm px-3 py-1.5 rounded-lg hover:bg-red-700 disabled:opacity-50"
              >
                {actBusy ? 'Deleting…' : 'Delete permanently'}
              </button>
            </div>
          </div>
        </div>
      )}
    </Layout>
  );
}

function Card({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="bg-slate-50 border border-slate-200 rounded-xl p-4">
      <div className="text-[10px] font-semibold uppercase tracking-widest text-slate-500 mb-3">
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
        <span className="text-[10px] font-semibold uppercase tracking-widest text-slate-500">
          {label}
        </span>
        <input
          type={type ?? 'text'}
          value={value ?? ''}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
          className="mt-1 w-full text-sm bg-white border border-slate-200 rounded-md px-2 py-1.5 focus:outline-none focus:ring-2 focus:ring-brand-500/40"
        />
      </label>
    );
  }
  return (
    <div>
      <div className="text-[10px] font-semibold uppercase tracking-widest text-slate-500">
        {label}
      </div>
      <div className="text-sm text-slate-900 mt-0.5">
        {value || <span className="text-slate-400 italic">Not set</span>}
      </div>
    </div>
  );
}
