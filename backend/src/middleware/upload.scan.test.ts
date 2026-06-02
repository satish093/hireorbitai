/**
 * Virus-scan middleware (scanUpload). Verifies the ClamAV gate behaviour with
 * the scanner mocked — no real clamd needed:
 *   - clean file passes through
 *   - infected file → 422 + audit('upload_malware_detected')
 *   - disabled (CLAMAV_ENABLED=false) → skipped entirely
 *   - no file → no-op
 *   - scanner error + fail-closed → 503; fail-open → passes
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

const h = vi.hoisted(() => ({
  scan: vi.fn(),
  audit: vi.fn(),
  enabled: { value: true },
  failClosed: { value: true },
}));

vi.mock('../services/clamav.service', () => ({
  scanBuffer: h.scan,
  isClamavEnabled: () => h.enabled.value,
  clamavFailClosed: () => h.failClosed.value,
}));
vi.mock('../services/audit.service', () => ({ audit: h.audit }));
vi.mock('../config/logger', () => ({
  logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));

import { scanUpload } from './upload';

interface FakeFile {
  buffer: Buffer;
  originalname: string;
  mimetype: string;
  size: number;
}

function file(name = 'resume.pdf'): FakeFile {
  const buffer = Buffer.from('%PDF-1.7 hello');
  return { buffer, originalname: name, mimetype: 'application/pdf', size: buffer.length };
}

function run(f?: FakeFile, user?: { id: string; email: string }): Promise<{ err?: unknown }> {
  return new Promise((resolve) => {
    const req = { file: f, user, ip: '127.0.0.1', headers: {} } as never;
    scanUpload(req, {} as never, (err?: unknown) => resolve({ err }));
  });
}

beforeEach(() => {
  h.scan.mockReset();
  h.audit.mockReset();
  h.enabled.value = true;
  h.failClosed.value = true;
});

describe('scanUpload middleware', () => {
  it('passes a clean file through', async () => {
    h.scan.mockResolvedValue({ clean: true });
    const { err } = await run(file());
    expect(err).toBeUndefined();
    expect(h.scan).toHaveBeenCalledOnce();
  });

  it('rejects an infected file with 422 and audits it', async () => {
    h.scan.mockResolvedValue({ clean: false, virus: 'Eicar-Test-Signature' });
    const { err } = await run(file(), { id: 'u1', email: 'a@b.com' });
    expect((err as { status?: number }).status).toBe(422);
    expect(String((err as { message?: string }).message)).toMatch(/malware/i);
    expect(h.audit).toHaveBeenCalledOnce();
    expect(h.audit.mock.calls[0][0].action).toBe('upload_malware_detected');
    expect(h.audit.mock.calls[0][0].metadata.virus).toBe('Eicar-Test-Signature');
  });

  it('skips scanning entirely when disabled', async () => {
    h.enabled.value = false;
    const { err } = await run(file());
    expect(err).toBeUndefined();
    expect(h.scan).not.toHaveBeenCalled();
  });

  it('no-ops when there is no file', async () => {
    const { err } = await run(undefined);
    expect(err).toBeUndefined();
    expect(h.scan).not.toHaveBeenCalled();
  });

  it('fails closed (503) when the scanner errors and CLAMAV_FAIL_CLOSED', async () => {
    h.scan.mockRejectedValue(new Error('ECONNREFUSED'));
    const { err } = await run(file());
    expect((err as { status?: number }).status).toBe(503);
    expect(h.audit).not.toHaveBeenCalled();
  });

  it('fails open (passes) when the scanner errors and not fail-closed', async () => {
    h.failClosed.value = false;
    h.scan.mockRejectedValue(new Error('ECONNREFUSED'));
    const { err } = await run(file());
    expect(err).toBeUndefined();
  });
});
