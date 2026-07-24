/**
 * uploadLogo → AI brand + Draft-invoice seeding (the brandAndDraftFromLogo hook).
 *
 * Verifies that after a logo upload the controller: applies the AI-derived brand
 * color + name to the company, seeds exactly one Draft invoice (idempotent), and
 * audits ai_logo_analyzed. db + storage + audit + the AI service are mocked.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

const mock = vi.hoisted(() => ({
  groupRow: { id: 'g1', logo_path: null as string | null, name: 'Zangle IT', color: '#6366F1' },
  groupUpdates: [] as any[],
  invoiceInsert: null as any,
  invoiceExisting: null as any, // what the Draft-existence lookup returns
}));

vi.mock('../config/db', () => {
  function builder(table: string) {
    const b: Record<string, unknown> = {};
    Object.assign(b, {
      select: () => b,
      eq: () => b,
      order: () => b,
      limit: () => b,
      not: () => b,
      update(p: any) {
        if (table === 'user_groups') mock.groupUpdates.push(p);
        return b;
      },
      insert(p: any) {
        if (table === 'invoices') mock.invoiceInsert = p;
        return Promise.resolve({ data: { id: 'inv-new' }, error: null });
      },
      single: () =>
        Promise.resolve({
          data: table === 'user_groups' ? { ...mock.groupRow, logo_path: 'g1/x.png' } : null,
          error: null,
        }),
      maybeSingle: () =>
        Promise.resolve({
          data: table === 'user_groups' ? mock.groupRow : mock.invoiceExisting,
          error: null,
        }),
      then: (r: (v: unknown) => unknown) => Promise.resolve({ data: [], error: null }).then(r),
    });
    return b;
  }
  const storageBucket = {
    upload: () => Promise.resolve({ data: { path: 'p' }, error: null }),
    remove: () => Promise.resolve({ data: {}, error: null }),
    createSignedUrl: (p: string) =>
      Promise.resolve({ data: { signedUrl: `https://x/${p}`, path: p }, error: null }),
  };
  return {
    db: { from: (t: string) => builder(t), storage: { from: () => storageBucket } },
    pool: {},
  };
});

vi.mock('../services/audit.service', () => ({ audit: vi.fn() }));
vi.mock('../services/aiLogo.service', () => ({ analyzeCompanyLogo: vi.fn() }));

import { uploadLogo } from './userGroups.controller';
import { audit } from '../services/audit.service';
import { analyzeCompanyLogo } from '../services/aiLogo.service';

const ADMIN = { id: 'u-admin', role: 'SUPER_ADMIN', email: 'a@x.test' };

function mkReq() {
  return {
    params: { id: 'g1' },
    user: ADMIN,
    file: { originalname: 'logo.png', mimetype: 'image/png', buffer: Buffer.from('PNGDATA') },
  };
}
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
  mock.groupUpdates = [];
  mock.invoiceInsert = null;
  mock.invoiceExisting = null;
  vi.clearAllMocks();
});

describe('uploadLogo — AI branding + Draft invoice', () => {
  it('applies the AI brand color + name and seeds a Draft invoice', async () => {
    (analyzeCompanyLogo as any).mockResolvedValue({
      company_name: 'Zangle Technologies',
      brand_color: '#17B5A8',
      tagline: null,
      confidence: 0.9,
    });
    await (uploadLogo as any)(mkReq(), mkRes(), vi.fn());

    const branding = mock.groupUpdates.find((u) => u.color === '#17B5A8');
    expect(branding).toMatchObject({ color: '#17B5A8', name: 'Zangle Technologies' });
    expect(mock.invoiceInsert).toMatchObject({ company_group_id: 'g1', status: 'Draft' });
    expect(audit).toHaveBeenCalledWith(expect.objectContaining({ action: 'ai_logo_analyzed' }));
    expect(audit).toHaveBeenCalledWith(expect.objectContaining({ action: 'group_logo_updated' }));
  });

  it('does not rename on a low-confidence read but still recolors', async () => {
    (analyzeCompanyLogo as any).mockResolvedValue({
      company_name: 'Maybe Corp',
      brand_color: '#112233',
      tagline: null,
      confidence: 0.4,
    });
    await (uploadLogo as any)(mkReq(), mkRes(), vi.fn());
    const branding = mock.groupUpdates.find((u) => u.color === '#112233');
    expect(branding).toBeTruthy();
    expect(branding).not.toHaveProperty('name');
  });

  it('does not create a second Draft when one already exists', async () => {
    (analyzeCompanyLogo as any).mockResolvedValue(null); // AI disabled / failed
    mock.invoiceExisting = { id: 'existing-draft' };
    await (uploadLogo as any)(mkReq(), mkRes(), vi.fn());
    expect(mock.invoiceInsert).toBeNull();
  });

  it('still uploads + seeds a Draft when AI is unavailable (returns null)', async () => {
    (analyzeCompanyLogo as any).mockResolvedValue(null);
    const res = mkRes();
    await (uploadLogo as any)(mkReq(), res, vi.fn());
    // No branding update (only the logo_path update happened), but a Draft is seeded.
    expect(mock.groupUpdates.some((u) => u.color)).toBe(false);
    expect(mock.invoiceInsert).toMatchObject({ status: 'Draft' });
    expect(audit).not.toHaveBeenCalledWith(expect.objectContaining({ action: 'ai_logo_analyzed' }));
  });
});
