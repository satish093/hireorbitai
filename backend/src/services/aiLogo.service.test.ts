/**
 * Company-logo brand analysis (Claude vision) — parsing + resilience.
 *
 * Anthropic is mocked as enabled with a controllable messages.create so we can
 * exercise the JSON extraction + Zod coercion without a network call. The
 * disabled path (ANTHROPIC_FALLBACK_ENABLED=false → null) is the default in the
 * real test env and is covered by userGroups.logo.test.ts.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

const h = vi.hoisted(() => ({ create: vi.fn() }));
vi.mock('../config/anthropic', () => ({
  ANTHROPIC_FALLBACK_ENABLED: true,
  anthropic: { messages: { create: h.create } },
}));

import { analyzeCompanyLogo } from './aiLogo.service';

const textResp = (text: string) => ({ content: [{ type: 'text', text }] });

beforeEach(() => h.create.mockReset());

describe('analyzeCompanyLogo', () => {
  it('parses a valid JSON brand analysis', async () => {
    h.create.mockResolvedValue(
      textResp(
        '{"company_name":"Zangle Technologies","brand_color":"#17B5A8","tagline":null,"confidence":0.92}',
      ),
    );
    const r = await analyzeCompanyLogo(Buffer.from('x'), 'image/png');
    expect(r).toEqual({
      company_name: 'Zangle Technologies',
      brand_color: '#17B5A8',
      tagline: null,
      confidence: 0.92,
    });
  });

  it('tolerates code fences and surrounding prose', async () => {
    h.create.mockResolvedValue(
      textResp(
        'Here is the result:\n```json\n{"company_name":"Acme","brand_color":"#FF0000","tagline":"We build","confidence":0.8}\n```',
      ),
    );
    const r = await analyzeCompanyLogo(Buffer.from('x'), 'image/jpeg');
    expect(r?.company_name).toBe('Acme');
    expect(r?.brand_color).toBe('#FF0000');
    expect(r?.tagline).toBe('We build');
  });

  it('coerces malformed fields to safe defaults', async () => {
    h.create.mockResolvedValue(textResp('{"company_name":"","brand_color":"teal","confidence":5}'));
    const r = await analyzeCompanyLogo(Buffer.from('x'), 'image/png');
    expect(r).toEqual({ company_name: null, brand_color: null, tagline: null, confidence: 0 });
  });

  it('returns null when the model returns no JSON', async () => {
    h.create.mockResolvedValue(textResp('I cannot read this image.'));
    expect(await analyzeCompanyLogo(Buffer.from('x'), 'image/png')).toBeNull();
  });

  it('returns null on a malformed response (exercises the catch)', async () => {
    // No `.content` → resp.content.find() throws inside the try → caught → null.
    h.create.mockResolvedValue({ unexpected: true } as never);
    expect(await analyzeCompanyLogo(Buffer.from('x'), 'image/png')).toBeNull();
  });

  it('skips unsupported mimetypes without calling the model', async () => {
    expect(await analyzeCompanyLogo(Buffer.from('x'), 'image/svg+xml')).toBeNull();
    expect(h.create).not.toHaveBeenCalled();
  });
});
