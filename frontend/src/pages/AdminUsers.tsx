import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import toast from 'react-hot-toast';
import { useIsMobile } from '../hooks/useIsMobile';
import { Layout } from '../components/Layout';
import { PageHeader } from '../components/PageHeader';
import { Button } from '../components/Button';
import { useAuth } from '../context/AuthContext';
import { api } from '../services/api';
import { invalidate } from '../hooks/useInvalidate';
import { Role } from '../types';
import { AdminKpiStrip } from '../components/admin/AdminKpiStrip';
import { UserSegments } from '../components/admin/UserSegments';
import { useUserSegments } from '../components/admin/useUserSegments';
import { UserFilterBar } from '../components/admin/UserFilterBar';
import { UserBulkBar } from '../components/admin/UserBulkBar';
import { UserTable, Pager } from '../components/admin/UserTable';
import { UserDetailPane } from '../components/admin/UserDetailPane';
import { ConfirmDialog, type ConfirmSpec } from '../components/admin/ConfirmDialog';
import { useAdminUsers, useColumnPrefs } from '../components/admin/useAdminUsers';
import { SuperAdminBanner } from '../components/admin/SuperAdminBanner';

type BulkAction = 'reset-password' | 'change-role' | 'move-group' | 'suspend' | 'deactivate';

/** Admin Users — single workspace: KPI strip, segments, filter/bulk bar, a
 *  selectable table, and a slide-in detail pane (selection persisted in ?user). */
export function AdminUsers() {
  const { profile: me } = useAuth();
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const a = useAdminUsers();
  const rows = a.data?.rows ?? [];
  const total = a.data?.total ?? 0;
  const totalPages = a.data?.total_pages ?? 0;
  const segments = useUserSegments(a.kpi);

  // Render the detail EITHER inline (desktop) OR as a full-screen overlay
  // (mobile) — never both — so UserDetailPane mounts (and fetches) once.
  const isMobile = useIsMobile();

  const selectedUserId = params.get('user');
  const setSelected = (id: string | null) =>
    setParams((prev) => {
      const next = new URLSearchParams(prev);
      if (id) next.set('user', id);
      else next.delete('user');
      return next;
    });

  // Row selection (per-view; cleared when the query changes).
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const { q, role, group_id, last_seen } = a.filters;
  useEffect(() => {
    setSelectedIds(new Set());
  }, [a.segment, q, role, group_id, last_seen, a.page]);
  const toggleSelect = (id: string) =>
    setSelectedIds((s) => {
      const n = new Set(s);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });
  const toggleAll = () =>
    setSelectedIds((s) =>
      rows.every((r) => s.has(r.id)) ? new Set() : new Set(rows.map((r) => r.id)),
    );

  const { columns, toggleColumn } = useColumnPrefs();

  // `/` focuses search; Esc closes the pane.
  const searchRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const tag = (e.target as HTMLElement | null)?.tagName;
      if (e.key === '/' && tag !== 'INPUT' && tag !== 'TEXTAREA') {
        e.preventDefault();
        searchRef.current?.focus();
      } else if (e.key === 'Escape' && selectedUserId) {
        setSelected(null);
      }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  // Bulk runner — every action is confirmed; deactivate needs a typed phrase.
  const [confirm, setConfirm] = useState<ConfirmSpec | null>(null);
  const ids = useMemo(() => Array.from(selectedIds), [selectedIds]);
  function runBulk(action: BulkAction, label: string, payload?: unknown, danger?: boolean) {
    const n = ids.length;
    setConfirm({
      title: `${label} ${n} ${n === 1 ? 'user' : 'users'}?`,
      message: `This applies "${label}" to ${n} selected ${n === 1 ? 'account' : 'accounts'}. Actions you don't outrank are skipped.`,
      confirmLabel: label,
      tone: danger ? 'danger' : 'default',
      requireTyped: action === 'deactivate' ? 'DEACTIVATE' : undefined,
      run: async () => {
        const { data } = await api.post('/admin/users/bulk', { ids, action, payload });
        const ok = (data.results ?? []).filter((r: { ok: boolean }) => r.ok).length;
        toast.success(`${label}: ${ok}/${n} applied`);
        setSelectedIds(new Set());
        a.reload();
        invalidate('users');
      },
    });
  }

  return (
    <Layout title="Admin · Users">
      <PageHeader
        title="Users"
        description="Every account in the workspace — filter, inspect, and manage lifecycle."
        action={
          <>
            <span className="text-sm text-muted">
              {a.loading
                ? 'Loading…'
                : `${total.toLocaleString()} ${total === 1 ? 'user' : 'users'}`}
            </span>
            <Link
              to="/admin/deactivated"
              className="inline-flex items-center h-9 px-3 rounded-lg border border-border bg-surface text-sm text-ink-2 hover:bg-hover press"
            >
              Deactivated
            </Link>
            <Button variant="primary" size="sm" onClick={() => navigate('/invitations')}>
              Invite
            </Button>
          </>
        }
      />

      {/* Super Admin full-access banner — shown only to SUPER_ADMIN viewers */}
      {me?.role === 'SUPER_ADMIN' && <SuperAdminBanner />}

      <AdminKpiStrip kpi={a.kpi} loading={a.loading && !a.kpi} />
      <UserSegments segments={segments} active={a.segment} onSelect={a.setSegment} />

      {ids.length > 0 ? (
        <UserBulkBar
          count={ids.length}
          groups={a.groups}
          onClear={() => setSelectedIds(new Set())}
          onResetPassword={() => runBulk('reset-password', 'Send reset')}
          onChangeRole={(role: Role) => runBulk('change-role', `Set role ${role}`, { role })}
          onMoveGroup={(group_id) => runBulk('move-group', 'Move group', { group_id })}
          onSuspend={() => runBulk('suspend', 'Suspend', undefined, true)}
          onDeactivate={() => runBulk('deactivate', 'Deactivate', undefined, true)}
        />
      ) : (
        <UserFilterBar
          filters={{ ...a.filters, q: a.qInput }}
          onChange={a.setFilter}
          groups={a.groups}
          total={total}
          shown={rows.length}
          loading={a.loading}
          searchRef={searchRef}
          columns={columns}
          onToggleColumn={toggleColumn}
          onReset={a.resetFilters}
        />
      )}

      {/* Desktop: split grid with inline detail pane. Mobile: single column, detail pane hidden. */}
      <div
        className="md:grid gap-4 items-start transition-[grid-template-columns] duration-300 ease-out"
        style={{
          gridTemplateColumns: selectedUserId ? 'minmax(0,1fr) 380px' : 'minmax(0,1fr) 0px',
        }}
      >
        <div className="min-w-0">
          <UserTable
            rows={rows}
            groupsById={Object.fromEntries(a.groups.map((g) => [g.id, g]))}
            columns={columns}
            loading={a.loading}
            selectedIds={selectedIds}
            onToggleSelect={toggleSelect}
            onToggleAll={toggleAll}
            openId={selectedUserId}
            onOpen={setSelected}
            sort={a.sort}
            order={a.order}
            onSort={a.setSort}
          />
          {!a.loading && <Pager page={a.page} totalPages={totalPages} onPage={a.setPage} />}
        </div>
        {/* No `overflow-hidden` here: an overflow-clipped ancestor becomes the
            sticky pane's scroll container and breaks `position: sticky`, so the
            detail would render at the top of the page instead of pinning to the
            viewport when a row far down the list is clicked. */}
        <div className="hidden md:block">
          {!isMobile && selectedUserId && (
            <div className="sticky top-4 h-[calc(100dvh-8rem)] overflow-hidden rounded-xl border border-border">
              <UserDetailPane
                userId={selectedUserId}
                onClose={() => setSelected(null)}
                groups={a.groups}
                me={me ? { id: me.id } : null}
                onChanged={a.reload}
              />
            </div>
          )}
        </div>
      </div>

      {/* ── Mobile user detail (< md): full-screen takeover ──
          UserDetailPane is self-contained (own header + close button) and
          fills h-full, so it gets a plain portaled fixed overlay rather than
          Drawer/BottomSheet chrome. z-50 sits above the z-30 MobileBottomNav. */}
      {isMobile &&
        selectedUserId &&
        createPortal(
          <div
            className="fixed inset-0 z-50 animate-fade-in safe-pt safe-pb"
            style={{ background: 'var(--bg-elev)' }}
            role="dialog"
            aria-modal="true"
            aria-label="User detail"
          >
            <UserDetailPane
              userId={selectedUserId}
              onClose={() => setSelected(null)}
              groups={a.groups}
              me={me ? { id: me.id } : null}
              onChanged={a.reload}
            />
          </div>,
          document.body,
        )}

      <ConfirmDialog spec={confirm} onClose={() => setConfirm(null)} />
    </Layout>
  );
}
