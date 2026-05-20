import { useEffect, useState } from 'react';
import toast from 'react-hot-toast';
import { Layout } from '../components/Layout';
import { api } from '../services/api';

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
      const [g, cons, recs] = await Promise.all([
        api.get('/user-groups'),
        api.get('/consultants').catch(() => ({ data: [] })),
        api.get('/recruiters').catch(() => ({ data: [] })),
      ]);
      setGroups(g.data ?? []);
      // Merge users from both consultants and recruiters lists (each row has
      // an embedded user). De-dupe by user id so a person who shows up in
      // both rosters isn't listed twice.
      const seen = new Map<string, UserLite>();
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
      toast.error(e?.response?.data?.error ?? 'Failed');
    }
  }

  async function remove(g: UserGroup) {
    if (!confirm(`Delete "${g.name}"? Members will fall back to no group.`)) return;
    try {
      await api.delete(`/user-groups/${g.id}`);
      toast.success('Removed');
      load();
    } catch (e: any) {
      toast.error(e?.response?.data?.error ?? 'Failed');
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
      <h1 className="text-2xl font-semibold tracking-tight text-slate-900 mb-5">User groups</h1>

      {/* Create */}
      <div className="bg-white border border-slate-200 rounded-xl p-4 mb-6 flex items-center gap-2 flex-wrap">
        <input
          value={name}
          onChange={(e) => {
            const v = e.target.value;
            setName(v);
            if (!slugEdited) setSlug(toSlug(v));
          }}
          placeholder="Group name (e.g. Cloudfen)"
          className="border border-slate-300 rounded-lg px-3 py-1.5 text-sm flex-1 min-w-[200px]"
        />
        <input
          value={slug}
          onChange={(e) => {
            setSlug(e.target.value);
            setSlugEdited(true);
          }}
          placeholder="slug"
          className="border border-slate-300 rounded-lg px-3 py-1.5 text-sm font-mono"
        />
        <button
          onClick={create}
          className="bg-slate-900 text-white text-sm px-4 py-1.5 rounded-lg hover:bg-slate-800"
        >
          + Create group
        </button>
      </div>

      {loading ? (
        <p className="text-sm text-slate-500">Loading…</p>
      ) : groups.length === 0 ? (
        <div className="bg-white border border-slate-200 rounded-xl p-10 text-center text-slate-500">
          No groups yet. Apply{' '}
          <span className="font-mono text-xs">database/user-groups-and-presence.sql</span> to seed
          Cloudfen / Zangle IT / Xeronix / Okta Solutions.
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {groups.map((g) => {
            const members = users.filter((u) => u.group_id === g.id);
            const candidates = users.filter((u) => u.group_id !== g.id);
            return (
              <div
                key={g.id}
                className="bg-white border border-slate-200 rounded-xl overflow-hidden"
              >
                <div className="px-5 py-3 border-b border-slate-100 flex items-center gap-3">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <h3 className="text-sm font-semibold text-slate-900">{g.name}</h3>
                      <span className="text-[10px] font-mono text-slate-500 bg-slate-100 px-1.5 py-0.5 rounded">
                        {g.slug}
                      </span>
                      {!g.is_active && (
                        <span className="text-[10px] uppercase tracking-widest text-amber-600">
                          paused
                        </span>
                      )}
                    </div>
                    <p className="text-xs text-slate-500">
                      {g.member_count} member{g.member_count === 1 ? '' : 's'}
                    </p>
                  </div>
                  <button
                    onClick={() => toggle(g)}
                    className="text-xs text-slate-500 hover:text-slate-900 px-2"
                  >
                    {g.is_active ? 'Pause' : 'Resume'}
                  </button>
                  <button
                    onClick={() => remove(g)}
                    className="text-xs text-red-600 hover:underline px-2"
                  >
                    Delete
                  </button>
                </div>

                <div className="px-5 py-3 max-h-64 overflow-y-auto">
                  {members.length === 0 ? (
                    <p className="text-xs italic text-slate-400 mb-2">No members yet.</p>
                  ) : (
                    <ul className="space-y-1.5 mb-3">
                      {members.map((u) => (
                        <li key={u.id} className="flex items-center justify-between text-sm">
                          <span className="text-slate-800 truncate">{u.full_name ?? u.email}</span>
                          <button
                            onClick={() => assign(u.id, null)}
                            className="text-[11px] text-red-500 hover:underline"
                          >
                            Remove
                          </button>
                        </li>
                      ))}
                    </ul>
                  )}
                  <details>
                    <summary className="text-xs text-slate-500 cursor-pointer hover:text-slate-900">
                      + Add member
                    </summary>
                    <div className="mt-2 max-h-44 overflow-y-auto border border-slate-100 rounded">
                      {candidates.length === 0 ? (
                        <p className="text-xs italic text-slate-400 p-2">No more users to add.</p>
                      ) : (
                        candidates.map((u) => (
                          <button
                            key={u.id}
                            onClick={() => assign(u.id, g.id)}
                            className="w-full text-left text-sm px-2 py-1.5 hover:bg-slate-50 flex items-center justify-between"
                          >
                            <span className="truncate">{u.full_name ?? u.email}</span>
                            <span className="text-[10px] uppercase tracking-wider text-slate-400">
                              {u.role}
                            </span>
                          </button>
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
