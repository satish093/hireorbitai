/**
 * Group-logo upload/remove coverage.
 *
 *   - uploadLogo: stores the file at group-logos/<id>/..., persists logo_path,
 *     returns a freshly-signed logo_url, and audits 'group_logo_updated'.
 *   - uploadLogo: 404 when the group is missing; 400 when no file is attached.
 *   - removeLogo: nulls logo_path, removes the stored file, and audits.
 *
 * The route-level admin gate (requireRoleOrCapability(ADMIN_TIER,...)) is tested
 * generically by the rbac suite — these handlers only see authenticated callers.
 *
 * DB + storage mocked at module load. audit mocked.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

const mock = vi.hoisted(() => ({
  groupRow: null as Record<string, unknown> | null, // select(...).maybeSingle()
  updatedRow: null as Record<string, unknown> | null, // update(...).single()
  updatePayload: null as Record<string, unknown> | null,
  uploaded: null as { path: string; contentType?: string } | null,
  removed: [] as string[],
  signedFor: null as string | null,
}));

vi.mock('../config/db', () => {
  function builder() {
    const b: Record<string, unknown> = {};
    Object.assign(b, {
      select: () => b,
      eq: () => b,
      order: () => b,
      limit: () => b,
      not: () => b,
      update(payload: Record<string, unknown>) {
        mock.updatePayload = payload;
        return b;
      },
      single: () => Promise.resolve({ data: mock.updatedRow, error: null }),
      maybeSingle: () => Promise.resolve({ data: mock.groupRow, error: null }),
      then: (resolve: (v: unknown) => unknown) =>
        Promise.resolve({ data: [], error: null }).then(resolve),
    });
    return b;
  }
  const storageBucket = {
    upload: (path: string, _buf: Buffer, opts?: { contentType?: string }) => {
      mock.uploaded = { path, contentType: opts?.contentType };
      return Promise.resolve({ data: { path }, error: null });
    },
    remove: (paths: string[]) => {
      mock.removed.push(...paths);
      return Promise.resolve({ data: {}, error: null });
    },
    createSignedUrl: (path: string) => {
      mock.signedFor = path;
      return Promise.resolve({
        data: { signedUrl: `https://app.test/api/files/group-logos/${path}?sig=abc`, path },
        error: null,
      });
    },
  };
  return { db: { from: () => builder(), storage: { from: () => storageBucket } }, pool: {} };
});

vi.mock('../services/audit.service', () => ({ audit: vi.fn() }));

import { uploadLogo, removeLogo } from './userGroups.controller';
import { audit } from '../services/audit.service';

const ADMIN = { id: 'u-admin', role: 'SUPER_ADMIN', email: 'a@x.test' };

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

beforeEach(() => {
  mock.groupRow = null;
  mock.updatedRow = null;
  mock.updatePayload = null;
  mock.uploaded = null;
  mock.removed = [];
  mock.signedFor = null;
  vi.clearAllMocks();
});

describe('userGroups.uploadLogo', () => {
  it('stores the file, persists logo_path, returns a signed logo_url, and audits', async () => {
    mock.groupRow = { id: 'g1', logo_path: null };
    mock.updatedRow = { id: 'g1', name: 'Acme', logo_path: 'g1/123-logo.png' };
    const res = mkRes();
    await (uploadLogo as any)(
      {
        params: { id: 'g1' },
        user: ADMIN,
        file: { originalname: 'logo.png', mimetype: 'image/png', buffer: Buffer.from('PNGDATA') },
      },
      res,
      vi.fn(),
    );

    expect(mock.uploaded?.path).toMatch(/^g1\//);
    expect(mock.uploaded?.contentType).toBe('image/png');
    expect(mock.updatePayload?.logo_path).toBe(mock.uploaded?.path);
    expect(res.body.logo_url).toContain('/api/files/group-logos/');
    expect(audit).toHaveBeenCalledWith(expect.objectContaining({ action: 'group_logo_updated' }));
  });

  it('removes the previous logo before uploading a replacement', async () => {
    mock.groupRow = { id: 'g1', logo_path: 'g1/old.png' };
    mock.updatedRow = { id: 'g1', logo_path: 'g1/999-new.png' };
    await (uploadLogo as any)(
      {
        params: { id: 'g1' },
        user: ADMIN,
        file: { originalname: 'new.png', mimetype: 'image/png', buffer: Buffer.from('x') },
      },
      mkRes(),
      vi.fn(),
    );
    expect(mock.removed).toContain('g1/old.png');
  });

  it('404s when the group does not exist', async () => {
    mock.groupRow = null;
    let err: { status?: number } | null = null;
    try {
      await (uploadLogo as any)(
        {
          params: { id: 'nope' },
          user: ADMIN,
          file: { originalname: 'x.png', mimetype: 'image/png', buffer: Buffer.from('x') },
        },
        mkRes(),
        vi.fn(),
      );
    } catch (e) {
      err = e as { status?: number };
    }
    expect(err?.status).toBe(404);
  });

  it('400s when no file is attached', async () => {
    mock.groupRow = { id: 'g1', logo_path: null };
    let err: { status?: number } | null = null;
    try {
      await (uploadLogo as any)({ params: { id: 'g1' }, user: ADMIN }, mkRes(), vi.fn());
    } catch (e) {
      err = e as { status?: number };
    }
    expect(err?.status).toBe(400);
  });
});

describe('userGroups.removeLogo', () => {
  it('nulls logo_path, removes the file, and audits', async () => {
    mock.groupRow = { id: 'g1', logo_path: 'g1/old.png' };
    mock.updatedRow = { id: 'g1', logo_path: null };
    const res = mkRes();
    await (removeLogo as any)({ params: { id: 'g1' }, user: ADMIN }, res, vi.fn());
    expect(mock.removed).toContain('g1/old.png');
    expect(mock.updatePayload?.logo_path).toBeNull();
    expect(res.body.logo_url).toBeNull();
    expect(audit).toHaveBeenCalledWith(expect.objectContaining({ action: 'group_logo_updated' }));
  });
});
