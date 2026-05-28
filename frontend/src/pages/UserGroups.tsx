import { useEffect, useState } from 'react';
import toast from 'react-hot-toast';
import { Layout } from '../components/Layout';
import { SkeletonCard } from '../components/Skeleton';
import { Button } from '../components/Button';
import { api } from '../services/api';
import { useAuth } from '../context/AuthContext';
import { canAssignRole, Role, ROLE_LABEL } from '../types';

interface UserGroup {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  is_active: boolean;
  member_count: number;
}

interface UserLite {
  id: string;
  email: string;
  full_name: string | null;
  role: string;
  group_id: string | null;
}

export function UserGroups() {
  const { profile } = useAuth();
  const callerRole = profile?.role as Role | undefined;
  const callerId = profile?.id;
  const [groups, setGroups] = useState<UserGroup[]>([]);
  const [users, setUsers] = useState<UserLite[]>([]);
  const [loading, setLoading] = useState(true);
  const [name, setName] = useState('');
  const [slug, setSlug] = useState('');
  // Whether the user has manually edited the slug. While false, the slug
  // auto-tracks the name. Once the user types in the slug field directly,
  // we stop overwriting it.
  const [slugEdited, setSlugEdited] = useState(false);

  async function load() {
    setLoading(true);
    try {
      // /admin/users is the authoritative source — it returns every user with
      // role + group_id, including MANAGER / HR_MANAGER / admin-tier rows the
      // old /consultants + /recruiters roster missed (which made group leads
      // invisible in their own group's member list). This page is admin-gated
      // (allow=ADMIN_TIER + capability 'users' on /admin/groups), so the call
      // always succeeds; the legacy roster endpoints stay as a fallback only.
      const [g, admins, cons, recs] = await Promise.all([
        api.get('/user-groups'),
        // /admin/users returns { rows, total, page, page_size }. Default page
        // size is 50; request the max (200) so a small/mid org loads in one
        // call. Anything bigger will need page-walking, but pre-200 orgs work.
        api
          .get('/admin/users', { params: { page_size: 200 } })
          .catch(() => ({ data: { rows: [] } })),
        api.get('/consultants').catch(() => ({ data: [] })),
        api.get('/recruiters').catch(() => ({ data: [] })),
      ]);
      setGroups(g.data ?? []);
      // De-dupe by user id; /admin/users wins because it's pushed first.
      const seen = new Map<string, UserLite>();
      const pushUsers = (rows: any[]) => {
        for (const u of rows ?? []) {
          const id = u?.id;
          if (!id || seen.has(id)) continue;
          seen.set(id, {
            id,
            email: u.email ?? '',
            full_name: u.full_name ?? null,
            role: u.role ?? 'UNKNOWN',
            group_id: u.group_id ?? null,
          });
        }
      };
      const pushFromRoster = (rows: any[], defaultRole: string) => {
        for (const row of rows ?? []) {
          const u = row.user;
          const id = u?.id ?? row.user_id;
          if (!id || seen.has(id)) continue;
          seen.set(id, {
            id,
            email: u?.email ?? '',
            full_name: u?.full_name ?? null,
            role: u?.role ?? defaultRole,
            group_id: u?.group_id ?? null,
          });
        }
      };
      pushUsers(admins.data?.rows ?? []);
      pushFromRoster(cons.data ?? [], 'CONSULTANT');
      pushFromRoster(recs.data ?? [], 'RECRUITER');
      setUsers(Array.from(seen.values()));
    } catch (e: any) {
      const msg = e?.response?.data?.error ?? 'Failed to load groups';
      if (/user_groups|user-groups/i.test(String(msg))) {
        toast.error(`${msg} — run database/user-groups-and-presence.sql`);
      } else {
        toast.error(msg);
      }
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => {
    load();
  }, []);

  async function create() {
    if (!name.trim() || !slug.trim()) {
      toast.error('Name and slug required');
      return;
    }
    try {
      await api.post('/user-groups', {
        name: name.trim(),
        slug: slug.trim().toLowerCase().replace(/\s+/g, '-'),
      });
      setName('');
      setSlug('');
      setSlugEdited(false);
      toast.success('Group created');
      load();
    } catch (e: any) {
      toast.error(e?.response?.data?.error ?? 'Failed to create');
    }
  }

  async function toggle(g: UserGroup) {
    try {
      await api.patch(`/user-groups/${g.id}`, { is_active: !g.is_active });
      load();
    } catch (e: any) {
      toast.error(e?.response?.data?.error ?? 'Something went wrong. Please try again.');
    }
  }

  async function remove(g: UserGroup) {
    if (!confirm(`Delete "${g.name}"? Members will fall back to no group.`)) return;
    try {
      await api.delete(`/user-groups/${g.id}`);
      toast.success('Removed');
      load();
    } catch (e: any) {
      toast.error(e?.response?.data?.error ?? 'Something went wrong. Please try again.');
    }
  }

  async function assign(userId: string, groupId: string | null) {
    try {
      await api.put('/user-groups/assign', { user_id: userId, group_id: groupId });
      load();
    } catch (e: any) {
      toast.error(e?.response?.data?.error ?? 'Failed to assign');
    }
  }

  return (
    <Layout
      title="User groups"
      crumbs={[{ label: 'Workspace', to: '/dashboard' }, { label: 'Admin' }, { label: 'Groups' }]}
    >
      <h1 className="text-2xl font-semibold tracking-tight text-ink mb-5">User groups</h1>

      {/* Create */}
      <div className="bg-surface border border-border rounded-xl p-4 mb-6 flex items-center gap-2 flex-wrap">
        <input
          value={name}
          onChange={(e) => {
            const v = e.target.value;
            setName(v);
            if (!slugEdited) setSlug(toSlug(v));
          }}
          placeholder="Group name (e.g. Cloudfen)"
          className="border border-border rounded-lg px-3 py-1.5 text-sm flex-1 min-w-[200px]"
        />
        <input
          value={slug}
          onChange={(e) => {
            setSlug(e.target.value);
            setSlugEdited(true);
          }}
          placeholder="slug"
          className="border border-border rounded-lg px-3 py-1.5 text-sm font-mono"
        />
        <Button variant="primary" onClick={create}>
          + Create group
        </Button>
      </div>

      {loading ? (
        <SkeletonCard lines={5} />
      ) : groups.length === 0 ? (
        <div className="bg-surface border border-border rounded-xl p-10 text-center text-muted">
          No groups yet. Apply{' '}
          <span className="font-mono text-xs">database/user-groups-and-presence.sql</span> to seed
          Cloudfen / Zangle IT / Xeronix / Okta Solutions.
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {groups.map((g) => {
            // Rank-based visibility: a caller can only see/manage users whose
            // role they can actually assign (`canAssignRole`). A DIRECTOR should
            // not see a SUPER_ADMIN in either the members list or the "+ Add
            // member" dropdown because they couldn't move them anyway — the
            // backend would reject it (canAssignRole + assertOutranks). The
            // caller always sees their own row regardless of rank.
            const visibleUsers = callerRole
              ? users.filter((u) => u.id === callerId || canAssignRole(callerRole, u.role as Role))
              : users;
            const members = visibleUsers.filter((u) => u.group_id === g.id);
            const candidates = visibleUsers.filter((u) => u.group_id !== g.id);
            return (
              <div
                key={g.id}
                className="bg-surface border border-border rounded-xl overflow-hidden"
              >
                <div className="px-5 py-3 border-b border-border flex items-center gap-3">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <h3 className="text-sm font-semibold text-ink">{g.name}</h3>
                      <span className="text-[10px] font-mono text-muted bg-hover px-1.5 py-0.5 rounded">
                        {g.slug}
                      </span>
                      {!g.is_active && (
                        <span className="text-[10px] uppercase tracking-widest text-amber-600 dark:text-amber-400">
                          paused
                        </span>
                      )}
                    </div>
                    <p className="text-xs text-muted">
                      {members.length} member{members.length === 1 ? '' : 's'}
                      {g.member_count > members.length && (
                        <span
                          className="ml-1 text-muted/70"
                          title={`${g.member_count - members.length} member(s) hidden — outside your rank`}
                        >
                          (of {g.member_count})
                        </span>
                      )}
                    </p>
                  </div>
                  <Button variant="ghost" size="sm" onClick={() => toggle(g)}>
                    {g.is_active ? 'Pause' : 'Resume'}
                  </Button>
                  <Button variant="danger-ghost" size="sm" onClick={() => remove(g)}>
                    Delete
                  </Button>
                </div>

                <div className="px-5 py-3 max-h-64 overflow-y-auto">
                  {members.length === 0 ? (
                    <p className="text-xs italic text-muted mb-2">No members yet.</p>
                  ) : (
                    <ul className="space-y-1.5 mb-3">
                      {members.map((u) => (
                        <li key={u.id} className="flex items-center justify-between text-sm">
                          <span className="min-w-0 flex items-center gap-2">
                            <span className="text-ink truncate">{u.full_name ?? u.email}</span>
                            <span className="shrink-0 rounded-full border border-border bg-hover px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wider text-muted">
                              {ROLE_LABEL[u.role as Role] ?? u.role}
                            </span>
                          </span>
                          <Button
                            variant="danger-ghost"
                            size="sm"
                            onClick={() => assign(u.id, null)}
                          >
                            Remove
                          </Button>
                        </li>
                      ))}
                    </ul>
                  )}
                  <details>
                    <summary className="text-xs text-muted cursor-pointer hover:text-ink">
                      + Add member
                    </summary>
                    <div className="mt-2 max-h-44 overflow-y-auto border border-border rounded">
                      {candidates.length === 0 ? (
                        <p className="text-xs italic text-muted p-2">No more users to add.</p>
                      ) : (
                        candidates.map((u) => (
                          <Button
                            key={u.id}
                            variant="ghost"
                            size="sm"
                            onClick={() => assign(u.id, g.id)}
                            className="w-full text-left px-2 py-1.5 flex items-center justify-between"
                          >
                            <span className="truncate">{u.full_name ?? u.email}</span>
                            <span className="text-[10px] uppercase tracking-wider text-muted">
                              {u.role}
                            </span>
                          </Button>
                        ))
                      )}
                    </div>
                  </details>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </Layout>
  );
}

function toSlug(s: string): string {
  return s
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '');
}
