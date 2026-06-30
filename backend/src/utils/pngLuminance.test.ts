import { describe, it, expect } from 'vitest';
import zlib from 'node:zlib';
import { pngMeanLuminance, logoLooksLight, LOGO_LIGHT_THRESHOLD } from './pngLuminance';

// Build a minimal valid 8-bit RGBA PNG of a solid colour. CRCs are zeroed —
// the probe skips them — but the chunk structure + zlib stream are real.
function solidPng(w: number, h: number, r: number, g: number, b: number, a: number): Buffer {
  const sig = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const chunk = (type: string, data: Buffer) => {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length, 0);
    return Buffer.concat([len, Buffer.from(type, 'ascii'), data, Buffer.alloc(4)]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // colour type RGBA
  // [10] compression, [11] filter, [12] interlace all 0
  const raw = Buffer.alloc(h * (1 + w * 4));
  for (let y = 0; y < h; y++) {
    const row = y * (1 + w * 4);
    raw[row] = 0; // filter: none
    for (let x = 0; x < w; x++) {
      const p = row + 1 + x * 4;
      raw[p] = r;
      raw[p + 1] = g;
      raw[p + 2] = b;
      raw[p + 3] = a;
    }
  }
  return Buffer.concat([
    sig,
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

describe('pngMeanLuminance', () => {
  it('reads a white logo as ~1.0 (washes out on white)', () => {
    const l = pngMeanLuminance(solidPng(8, 8, 255, 255, 255, 255));
    expect(l).not.toBeNull();
    expect(l!).toBeGreaterThan(0.95);
    expect(logoLooksLight(solidPng(8, 8, 255, 255, 255, 255))).toBe(true);
  });

  it('reads a black logo as ~0 (fine on white)', () => {
    const l = pngMeanLuminance(solidPng(8, 8, 0, 0, 0, 255));
    expect(l!).toBeLessThan(0.05);
    expect(logoLooksLight(solidPng(8, 8, 0, 0, 0, 255))).toBe(false);
  });

  it('keeps a mid-tone teal logo on white (below the light threshold)', () => {
    // ~ZANGLE teal; luminance lands under LOGO_LIGHT_THRESHOLD.
    const l = pngMeanLuminance(solidPng(8, 8, 29, 187, 181, 255))!;
    expect(l).toBeLessThan(LOGO_LIGHT_THRESHOLD);
    expect(logoLooksLight(solidPng(8, 8, 29, 187, 181, 255))).toBe(false);
  });

  it('ignores fully transparent pixels (no opaque signal → null, not light)', () => {
    expect(pngMeanLuminance(solidPng(8, 8, 255, 255, 255, 0))).toBeNull();
    expect(logoLooksLight(solidPng(8, 8, 255, 255, 255, 0))).toBe(false);
  });

  it('returns null (and not-light) for non-PNG input', () => {
    expect(pngMeanLuminance(Buffer.from('not a png at all'))).toBeNull();
    expect(logoLooksLight(Buffer.from([0xff, 0xd8, 0xff]))).toBe(false); // JPEG magic
  });
});
