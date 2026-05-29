/**
 * Authorization + ownership tests for tasks.controller.
 *
 * Pins three security-sensitive behaviours:
 *   1. assertCanAccessTask ownership 404 — a non-manager who is neither the
 *      assignee nor the creator gets httpError(404) (not 403) when reaching a
 *      task-scoped resource (listSubtasks), so the endpoint can't be used as an
 *      existence oracle. The owner / creator path is allowed.
 *   2. update field restriction — a non-manager assignee may only change
 *      `status`; every other field they submit is dropped from the DB patch.
 *   3. create is manager-gated — the handler builds a payload only for the
 *      manager-tier caller; a non-manager update of a status keeps working.
 *
 * The db shim is mocked at module load (so importing never reaches config/env);
 * it records update payloads and serves rows per-table from a settable fixture.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

const mock = vi.hoisted(() => {
  // table -> rows the next select on that table resolves to.
  const rows: Record<string, unknown[]> = {};
  // captured update payloads, in order.
  const updates: { table: string; payload: Record<string, unknown> }[] = [];
  return { rows, updates };
});

vi.mock('../config/db', () => {
  function makeBuilder(table: string) {
    const b: Record<string, unknown> = {};
    Object.assign(b, {
      select: () => b,
      eq: () => b,
      neq: () => b,
      is: () => b,
      in: () => b,
      lt: () => b,
      lte: () => b,
      gte: () => b,
      ilike: () => b,
      not: () => b,
      or: () => b,
      order: () => b,
      limit: () => b,
      insert(payload: Record<string, unknown>) {
        mock.updates.push({ table: `insert:${table}`, payload });
        return b;
      },
      update(payload: Record<string, unknown>) {
        mock.updates.push({ table, payload });
        return b;
      },
      delete: () => b,
      maybeSingle: () =>
        Promise.resolve({ data: (mock.rows[table] ?? [])[0] ?? null, error: null }),
      single: () => Promise.resolve({ data: (mock.rows[table] ?? [])[0] ?? null, error: null }),
      then: (resolve: (v: unknown) => unknown) =>
        Promise.resolve({ data: mock.rows[table] ?? [], error: null }).then(resolve),
    });
    return b;
  }
  return { db: { from: (t: string) => makeBuilder(t) }, pool: {} };
});

vi.mock('../config/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

import * as tasks from './tasks.controller';

type Handler = (req: any, res: any, next: any) => unknown | Promise<unknown>;

function mkRes() {
  const res: any = {
    statusCode: 200,
    body: undefined,
    status(c: number) {
      this.statusCode = c;
      return this;
    },
    json(b: unknown) {
      this.body = b;
      return this;
    },
  };
  return res;
}

const log = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };

async function call(
  handler: Handler,
  user: { id: string; role: string } | undefined,
  opts: { body?: unknown; params?: Record<string, string> } = {},
): Promise<{ status?: number } | null> {
  try {
    await handler(
      { user, body: opts.body ?? {}, params: opts.params ?? {}, query: {}, log },
      mkRes(),
      vi.fn(),
    );
    return null;
  } catch (e) {
    return e as { status?: number };
  }
}

beforeEach(() => {
  for (const k of Object.keys(mock.rows)) delete mock.rows[k];
  mock.updates.length = 0;
});

const CONSULTANT = { id: 'u-consultant', role: 'CONSULTANT' };
const STRANGER = { id: 'u-stranger', role: 'RECRUITER' };
const MANAGER = { id: 'u-manager', role: 'HR_MANAGER' };
// Admin tier is unscoped; a group lead may only edit tasks for their group
// (resolved via managerGroupUserIds → reads `users` by group_id).
const ADMIN = { id: 'u-director', role: 'DIRECTOR' };
const GROUP_LEAD = { id: 'u-lead', role: 'MANAGER', group_id: 'g1' };

describe('tasks.controller — assertCanAccessTask ownership (via listSubtasks)', () => {
  it('returns 404 (not 403) for a non-manager who is neither assignee nor creator', async () => {
    mock.rows.tasks = [{ id: 't-1', assignee_id: 'u-owner', created_by: 'u-author' }];
    const err = await call(tasks.listSubtasks as Handler, STRANGER, { params: { id: 't-1' } });
    expect(err?.status).toBe(404);
  });

  it('returns 404 when the task row is missing (no existence leak)', async () => {
    mock.rows.tasks = [];
    const err = await call(tasks.listSubtasks as Handler, CONSULTANT, { params: { id: 't-x' } });
    expect(err?.status).toBe(404);
  });

  it('allows the assignee through to the subtasks query', async () => {
    mock.rows.tasks = [{ id: 't-1', assignee_id: CONSULTANT.id, created_by: 'u-author' }];
    mock.rows.task_subtasks = [{ id: 's-1', task_id: 't-1' }];
    const err = await call(tasks.listSubtasks as Handler, CONSULTANT, { params: { id: 't-1' } });
    expect(err).toBeNull();
  });

  it('allows the creator through even when not the assignee', async () => {
    mock.rows.tasks = [{ id: 't-1', assignee_id: 'u-someone', created_by: CONSULTANT.id }];
    mock.rows.task_subtasks = [];
    const err = await call(tasks.listSubtasks as Handler, CONSULTANT, { params: { id: 't-1' } });
    expect(err).toBeNull();
  });

  it('allows an admin-tier caller through to ANY task (workspace-wide)', async () => {
    mock.rows.tasks = [{ id: 't-1', assignee_id: 'u-owner', created_by: 'u-author' }];
    mock.rows.task_subtasks = [];
    const err = await call(tasks.listSubtasks as Handler, ADMIN, { params: { id: 't-1' } });
    expect(err).toBeNull();
  });

  it('GROUP LEAD is denied an out-of-group task (centralised guard, 404)', async () => {
    // The task's assignee + creator are users not in the lead's group, and the
    // lead is neither party themselves. Used to pass when isManagerLike →
    // unconditional access; the new shared guard scopes leads to in-group +
    // self-touched.
    mock.rows.tasks = [{ id: 't-1', assignee_id: 'u-other', created_by: 'u-other' }];
    mock.rows.users = []; // no in-group users
    mock.rows.task_subtasks = [];
    const err = await call(tasks.listSubtasks as Handler, GROUP_LEAD, { params: { id: 't-1' } });
    expect(err?.status).toBe(404);
  });

  it('GROUP LEAD CAN access a task whose participant is in their group', async () => {
    mock.rows.tasks = [{ id: 't-1', assignee_id: 'u-in-group', created_by: 'u-other' }];
    mock.rows.users = [{ id: 'u-in-group', group_id: 'g1' }];
    mock.rows.task_subtasks = [];
    const err = await call(tasks.listSubtasks as Handler, GROUP_LEAD, { params: { id: 't-1' } });
    expect(err).toBeNull();
  });
});

describe('tasks.controller — update field restriction for non-manager assignee', () => {
  it('a non-manager assignee can only patch status; other fields are dropped', async () => {
    // The assignee owns the task and submits status + a privileged field.
    mock.rows.tasks = [{ id: 't-1', assignee_id: CONSULTANT.id }];
    const err = await call(tasks.update as Handler, CONSULTANT, {
      params: { id: 't-1' },
      body: { status: 'IN_PROGRESS', title: 'hijacked', assignee_id: 'u-attacker' },
    });
    expect(err).toBeNull();
    const patch = mock.updates.find((u) => u.table === 'tasks')?.payload;
    expect(patch).toBeTruthy();
    expect(patch).toMatchObject({ status: 'IN_PROGRESS' });
    // Manager-only fields the assignee tried to set never reach the DB patch.
    expect(patch).not.toHaveProperty('title');
    expect(patch).not.toHaveProperty('assignee_id');
  });

  it('a non-manager who is neither assignee nor creator gets 404 on update (oracle hygiene)', async () => {
    mock.rows.tasks = [{ id: 't-1', assignee_id: 'u-owner' }];
    const err = await call(tasks.update as Handler, STRANGER, {
      params: { id: 't-1' },
      body: { status: 'IN_PROGRESS' },
    });
    // 404 (not 403) so the endpoint can't be used as an existence oracle —
    // matches tasks.remove's existing pattern.
    expect(err?.status).toBe(404);
    expect(mock.updates.find((u) => u.table === 'tasks')).toBeUndefined();
  });

  it('an ADMIN-tier user may patch non-status fields (no restriction)', async () => {
    mock.rows.tasks = [{ id: 't-1', assignee_id: 'u-owner' }];
    const err = await call(tasks.update as Handler, ADMIN, {
      params: { id: 't-1' },
      body: { title: 'Renamed', priority: 'HIGH' },
    });
    expect(err).toBeNull();
    const patch = mock.updates.find((u) => u.table === 'tasks')?.payload;
    expect(patch).toMatchObject({ title: 'Renamed', priority: 'HIGH' });
  });

  it('a group lead may patch a task assigned within their group', async () => {
    mock.rows.tasks = [{ id: 't-1', assignee_id: 'u-owner' }];
    mock.rows.users = [{ id: 'u-owner' }]; // assignee is in the lead's group
    const err = await call(tasks.update as Handler, GROUP_LEAD, {
      params: { id: 't-1' },
      body: { title: 'Renamed' },
    });
    expect(err).toBeNull();
    expect(mock.updates.find((u) => u.table === 'tasks')?.payload).toMatchObject({
      title: 'Renamed',
    });
  });

  it('a group lead gets 404 patching a task outside their group (oracle hygiene)', async () => {
    mock.rows.tasks = [{ id: 't-1', assignee_id: 'u-owner' }];
    mock.rows.users = []; // assignee not in the lead's group
    const err = await call(tasks.update as Handler, GROUP_LEAD, {
      params: { id: 't-1' },
      body: { title: 'Renamed' },
    });
    expect(err?.status).toBe(404);
    expect(mock.updates.find((u) => u.table === 'tasks')).toBeUndefined();
  });
});

describe('tasks.controller — create validation', () => {
  it('rejects a create with no title (400)', async () => {
    const err = await call(tasks.create as Handler, MANAGER, { body: {} });
    expect(err?.status).toBe(400);
  });

  it('sets created_by server-side from req.user, never the body', async () => {
    // insert(...).select('*').single() and the follow-up taskWithJoins both
    // read this row; supply one so the response re-fetch doesn't dereference null.
    mock.rows.tasks = [{ id: 't-new' }];
    const err = await call(tasks.create as Handler, MANAGER, {
      body: { title: 'Do thing', created_by: 'u-attacker' },
    });
    expect(err).toBeNull();
    const insert = mock.updates.find((u) => u.table === 'insert:tasks')?.payload;
    expect(insert?.created_by).toBe(MANAGER.id);
    expect(insert?.title).toBe('Do thing');
  });

  it('a group lead cannot create a task assigned to a user outside their group', async () => {
    mock.rows.users = []; // empty group → assignee not in scope → fail-closed
    const err = await call(tasks.create as Handler, GROUP_LEAD, {
      body: { title: 'Out of scope', assignee_id: 'u-outsider' },
    });
    expect(err?.status).toBe(403);
    expect(mock.updates.find((u) => u.table === 'insert:tasks')).toBeUndefined();
  });
});

describe('tasks.assignees — scoped assignable users', () => {
  it('returns 403 for a non-manager caller', async () => {
    const err = await call(tasks.assignees as Handler, CONSULTANT, {});
    expect(err?.status).toBe(403);
  });

  it('admin tier gets every active user (plus self)', async () => {
    mock.rows.users = [
      { id: 'u1', full_name: 'Dee', email: 'd@x', role: 'DIRECTOR' },
      { id: 'u2', full_name: 'Nik', email: 'n@x', role: 'HR_MANAGER' },
    ];
    const res = mkRes();
    await (tasks.assignees as Handler)(
      { user: ADMIN, body: {}, params: {}, query: {}, log },
      res,
      vi.fn(),
    );
    const ids = (res.body as { id: string }[]).map((u) => u.id);
    expect(ids).toEqual(expect.arrayContaining(['u1', 'u2', ADMIN.id]));
  });

  it('a group lead gets their group users (plus self)', async () => {
    mock.rows.users = [{ id: 'g-user', full_name: 'G', email: 'g@x', role: 'RECRUITER' }];
    const res = mkRes();
    await (tasks.assignees as Handler)(
      { user: GROUP_LEAD, body: {}, params: {}, query: {}, log },
      res,
      vi.fn(),
    );
    const ids = (res.body as { id: string }[]).map((u) => u.id);
    expect(ids).toContain('g-user');
    expect(ids).toContain(GROUP_LEAD.id);
  });
});
