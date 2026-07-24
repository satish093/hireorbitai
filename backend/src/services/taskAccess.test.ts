/**
 * Centralised task-access guard — covers the rule the per-controller
 * `canAccessTask` and `isManagerLike` short-circuits did NOT (group leads
 * being treated as unscoped, which let them read / list / download / delete
 * tasks + comments + attachments outside their group).
 *
 *   ADMIN_TIER         → access every task.
 *   GROUP LEAD         → self-touched OR in-group assignee/creator only.
 *   Others (RECRUITER, → self-touched only (assignee or creator).
 *   CONSULTANT, etc.)
 *
 * DB mocked at module load (no Postgres / env).
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

const mock = vi.hoisted(() => {
  const rows: Record<string, Record<string, unknown>[]> = {};
  return { rows };
});

vi.mock('../config/db', () => {
  function builder(table: string) {
    const filters: Array<(r: Record<string, unknown>) => boolean> = [];
    const b: Record<string, unknown> = {};
    Object.assign(b, {
      select: () => b,
      eq: (col: string, v: unknown) => {
        filters.push((r) => r[col] === v);
        return b;
      },
      in: (col: string, vals: unknown[]) => {
        filters.push((r) => vals.includes(r[col]));
        return b;
      },
      neq: (col: string, v: unknown) => {
        filters.push((r) => r[col] !== v);
        return b;
      },
      apply() {
        return (mock.rows[table] ?? []).filter((r) => filters.every((f) => f(r)));
      },
      maybeSingle: () => Promise.resolve({ data: (b as any).apply()[0] ?? null, error: null }),
      single: () => Promise.resolve({ data: (b as any).apply()[0] ?? null, error: null }),
      then: (resolve: (v: unknown) => unknown) =>
        Promise.resolve({ data: (b as any).apply(), error: null }).then(resolve),
    });
    return b;
  }
  return { db: { from: (t: string) => builder(t) }, pool: {} };
});
vi.mock('../config/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

import { assertCanAccessTask, assertCanDeleteTaskChild, canAccessTask } from './taskAccess';

const G_A = 'group-aaaa';
const G_B = 'group-bbbb';
const ADMIN = { id: 'u-admin', role: 'DIRECTOR' as const };
const LEAD_A = { id: 'u-lead-a', role: 'MANAGER' as const, group_id: G_A };
const LEAD_B = { id: 'u-lead-b', role: 'MANAGER' as const, group_id: G_B };
const LEAD_NO_GROUP = { id: 'u-lead-x', role: 'HR_MANAGER' as const, group_id: null };
const REC = { id: 'u-rec', role: 'RECRUITER' as const, group_id: G_A };

function setup(opts: {
  assigneeId?: string | null;
  creatorId?: string | null;
  /** Map of userId → group_id for the leadCanAccessUser lookup. */
  userGroups?: Record<string, string>;
}) {
  mock.rows.tasks = [
    {
      id: 't-1',
      assignee_id: opts.assigneeId ?? null,
      created_by: opts.creatorId ?? null,
    },
  ];
  // managerGroupUserIds queries users by group_id — provide the rows leads
  // need to match against.
  const ug = opts.userGroups ?? {};
  mock.rows.users = Object.entries(ug).map(([id, group_id]) => ({ id, group_id }));
}

beforeEach(() => {
  for (const k of Object.keys(mock.rows)) delete mock.rows[k];
});

describe('assertCanAccessTask — admin tier', () => {
  it('admin reaches every task regardless of group', async () => {
    setup({ assigneeId: 'u-stranger', creatorId: 'u-stranger' });
    await expect(assertCanAccessTask(ADMIN, 't-1')).resolves.toMatchObject({ id: 't-1' });
  });

  it('admin sees a task whose assignee/creator is in another group', async () => {
    setup({ assigneeId: 'u-b', userGroups: { 'u-b': G_B } });
    await expect(assertCanAccessTask(ADMIN, 't-1')).resolves.toBeTruthy();
  });
});

describe('assertCanAccessTask — group lead scoping', () => {
  it('lead can access a task whose ASSIGNEE is in their group', async () => {
    setup({ assigneeId: 'u-in-a', userGroups: { 'u-in-a': G_A } });
    await expect(assertCanAccessTask(LEAD_A, 't-1')).resolves.toBeTruthy();
  });

  it('lead can access a task whose CREATOR is in their group', async () => {
    setup({ creatorId: 'u-in-a', userGroups: { 'u-in-a': G_A } });
    await expect(assertCanAccessTask(LEAD_A, 't-1')).resolves.toBeTruthy();
  });

  it('lead CANNOT access a task whose participants are in another group', async () => {
    setup({
      assigneeId: 'u-in-b',
      creatorId: 'u-in-b',
      userGroups: { 'u-in-b': G_B },
    });
    // Throws 404 (existence-oracle safe).
    await expect(assertCanAccessTask(LEAD_A, 't-1')).rejects.toMatchObject({ status: 404 });
  });

  it('lead from another group CANNOT access the same task', async () => {
    setup({ assigneeId: 'u-in-a', userGroups: { 'u-in-a': G_A } });
    await expect(assertCanAccessTask(LEAD_B, 't-1')).rejects.toMatchObject({ status: 404 });
  });

  it('lead with NO group_id is fail-closed except for self-touched tasks', async () => {
    setup({ assigneeId: 'u-other', userGroups: { 'u-other': G_A } });
    await expect(assertCanAccessTask(LEAD_NO_GROUP, 't-1')).rejects.toMatchObject({ status: 404 });
  });

  it('lead WITH no group CAN access a task they are the assignee of (self-touched)', async () => {
    setup({ assigneeId: LEAD_NO_GROUP.id });
    await expect(assertCanAccessTask(LEAD_NO_GROUP, 't-1')).resolves.toBeTruthy();
  });
});

describe('assertCanAccessTask — non-manager (recruiter / consultant)', () => {
  it('non-manager can access a task they are the assignee of', async () => {
    setup({ assigneeId: REC.id });
    await expect(assertCanAccessTask(REC, 't-1')).resolves.toBeTruthy();
  });

  it('non-manager can access a task they CREATED', async () => {
    setup({ creatorId: REC.id });
    await expect(assertCanAccessTask(REC, 't-1')).resolves.toBeTruthy();
  });

  it('non-manager CANNOT access an unrelated task (even one in their group)', async () => {
    setup({ assigneeId: 'u-other', userGroups: { 'u-other': G_A } });
    await expect(assertCanAccessTask(REC, 't-1')).rejects.toMatchObject({ status: 404 });
  });
});

describe('assertCanAccessTask — missing task / boolean wrapper', () => {
  it('missing task → 404 (not 403, existence-oracle safe)', async () => {
    setup({});
    mock.rows.tasks = []; // override
    await expect(assertCanAccessTask(ADMIN, 't-missing')).rejects.toMatchObject({ status: 404 });
  });

  it('canAccessTask returns false on denied access (does not throw)', async () => {
    setup({
      assigneeId: 'u-in-b',
      creatorId: 'u-in-b',
      userGroups: { 'u-in-b': G_B },
    });
    expect(await canAccessTask(LEAD_A, 't-1')).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// assertCanDeleteTaskChild — stricter than assertCanAccessTask: only the
// owner, admin-tier, or a group lead with in-group reach may delete someone
// else's comment/attachment. The owner check is at the controller's call
// site (this helper is only invoked when the caller is NOT the owner).
// ─────────────────────────────────────────────────────────────────────────────
describe('assertCanDeleteTaskChild — non-owner authorisation', () => {
  it("ADMIN tier may delete anyone's child item", async () => {
    setup({ assigneeId: 'u-other', userGroups: { 'u-other': G_B } });
    await expect(assertCanDeleteTaskChild(ADMIN, 't-1')).resolves.toBeUndefined();
  });

  it('GROUP LEAD may delete when the parent task is in their group', async () => {
    setup({ assigneeId: 'u-in-a', userGroups: { 'u-in-a': G_A } });
    await expect(assertCanDeleteTaskChild(LEAD_A, 't-1')).resolves.toBeUndefined();
  });

  it('GROUP LEAD is DENIED for an out-of-group task', async () => {
    setup({ assigneeId: 'u-in-b', userGroups: { 'u-in-b': G_B } });
    await expect(assertCanDeleteTaskChild(LEAD_A, 't-1')).rejects.toMatchObject({ status: 404 });
  });

  it("plain RECRUITER who is the task ASSIGNEE is still DENIED on someone else's child", async () => {
    // The recruiter is the task's assignee — assertCanAccessTask would let
    // them READ the comment, but they must NOT be able to delete a comment
    // they did not author. This is the regression the audit flagged.
    setup({ assigneeId: REC.id });
    await expect(assertCanDeleteTaskChild(REC, 't-1')).rejects.toMatchObject({ status: 403 });
  });

  it("plain CONSULTANT who CREATED the task is still DENIED on someone else's child", async () => {
    const CONS = { id: 'u-cons', role: 'CONSULTANT' as const, group_id: null };
    setup({ creatorId: CONS.id });
    await expect(assertCanDeleteTaskChild(CONS, 't-1')).rejects.toMatchObject({ status: 403 });
  });

  it('DEVELOPER (no task connection) is DENIED', async () => {
    const DEV = { id: 'u-dev', role: 'DEVELOPER' as const, group_id: null };
    setup({ assigneeId: 'u-other', userGroups: { 'u-other': G_A } });
    await expect(assertCanDeleteTaskChild(DEV, 't-1')).rejects.toMatchObject({ status: 403 });
  });
});
