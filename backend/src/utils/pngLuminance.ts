/**
 * Tiny dependency-free PNG luminance probe (uses Node's built-in zlib).
 *
 * Purpose: decide whether a company logo is "light" — i.e. predominantly
 * near-white — so the invoice PDF can drop it onto a dark backdrop instead of
 * rendering an invisible white-on-white wordmark (see invoicePdf.service.ts).
 *
 * Scope kept deliberately small: 8-bit, non-interlaced PNGs (colour types
 * 0/2/3/4/6), which covers every uploaded logo. Anything it can't parse
 * (16-bit, interlaced, JPEG, corrupt) returns null → callers treat that as
 * "not light" and render on white as before. Never throws.
 */

import zlib from 'node:zlib';

const PNG_SIG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

/** A logo at/above this mean opaque luminance (0..1) washes out on white. */
export const LOGO_LIGHT_THRESHOLD = 0.78;

function paeth(a: number, b: number, c: number): number {
  const p = a + b - c;
  const pa = Math.abs(p - a);
  const pb = Math.abs(p - b);
  const pc = Math.abs(p - c);
  return pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
}

/**
 * Mean perceptual luminance (0..1) over the logo's sufficiently-opaque pixels,
 * or null when the image can't be analysed. Samples up to ~20k pixels.
 */
export function pngMeanLuminance(buf: Buffer): number | null {
  try {
    if (!buf || buf.length < 8 || !buf.subarray(0, 8).equals(PNG_SIG)) return null;
    let off = 8;
    let width = 0;
    let height = 0;
    let bitDepth = 0;
    let colorType = 0;
    let interlace = 0;
    let palette: Buffer | null = null;
    let trns: Buffer | null = null;
    const idat: Buffer[] = [];

    while (off + 8 <= buf.length) {
      const len = buf.readUInt32BE(off);
      const type = buf.toString('ascii', off + 4, off + 8);
      const dataStart = off + 8;
      const dataEnd = dataStart + len;
      if (dataEnd + 4 > buf.length) break;
      const data = buf.subarray(dataStart, dataEnd);
      if (type === 'IHDR') {
        width = data.readUInt32BE(0);
        height = data.readUInt32BE(4);
        bitDepth = data[8]!;
        colorType = data[9]!;
        interlace = data[12]!;
      } else if (type === 'PLTE') palette = Buffer.from(data);
      else if (type === 'tRNS') trns = Buffer.from(data);
      else if (type === 'IDAT') idat.push(data);
      else if (type === 'IEND') break;
      off = dataEnd + 4; // skip the 4-byte CRC
    }

    if (!width || !height || bitDepth !== 8 || interlace !== 0) return null;
    const channels =
      colorType === 0
        ? 1
        : colorType === 2
          ? 3
          : colorType === 3
            ? 1
            : colorType === 4
              ? 2
              : colorType === 6
                ? 4
                : 0;
    if (!channels || idat.length === 0) return null;

    const raw = zlib.inflateSync(Buffer.concat(idat));
    const stride = width * channels;
    if (raw.length < (stride + 1) * height) return null;

    // Reverse the per-scanline PNG filters into a flat pixel buffer.
    const out = Buffer.alloc(stride * height);
    const bpp = channels;
    for (let y = 0; y < height; y++) {
      const filter = raw[y * (stride + 1)]!;
      const inRow = y * (stride + 1) + 1;
      const outRow = y * stride;
      for (let x = 0; x < stride; x++) {
        const rb = raw[inRow + x]!;
        const a = x >= bpp ? out[outRow + x - bpp]! : 0;
        const b = y > 0 ? out[outRow - stride + x]! : 0;
        const c = x >= bpp && y > 0 ? out[outRow - stride + x - bpp]! : 0;
        let v: number;
        switch (filter) {
          case 0:
            v = rb;
            break;
          case 1:
            v = rb + a;
            break;
          case 2:
            v = rb + b;
            break;
          case 3:
            v = rb + ((a + b) >> 1);
            break;
          case 4:
            v = rb + paeth(a, b, c);
            break;
          default:
            return null;
        }
        out[outRow + x] = v & 0xff;
      }
    }

    let sum = 0;
    let count = 0;
    const step = Math.max(1, Math.floor((width * height) / 20000));
    for (let i = 0; i < width * height; i += step) {
      const px = i * channels;
      let r: number;
      let g: number;
      let bl: number;
      let alpha = 255;
      if (colorType === 0) {
        r = g = bl = out[px]!;
      } else if (colorType === 4) {
        r = g = bl = out[px]!;
        alpha = out[px + 1]!;
      } else if (colorType === 2) {
        r = out[px]!;
        g = out[px + 1]!;
        bl = out[px + 2]!;
      } else if (colorType === 6) {
        r = out[px]!;
        g = out[px + 1]!;
        bl = out[px + 2]!;
        alpha = out[px + 3]!;
      } else {
        // palette
        const idx = out[px]!;
        if (!palette || idx * 3 + 2 >= palette.length) continue;
        r = palette[idx * 3]!;
        g = palette[idx * 3 + 1]!;
        bl = palette[idx * 3 + 2]!;
        if (trns && idx < trns.length) alpha = trns[idx]!;
      }
      if (alpha < 128) continue; // ignore transparent areas
      sum += (0.2126 * r + 0.7152 * g + 0.0722 * bl) / 255;
      count++;
    }
    if (count < 10) return null; // too little opaque signal to judge
    return sum / count;
  } catch {
    return null;
  }
}

/** True when a logo is light enough to wash out on a white background. */
export function logoLooksLight(buf: Buffer): boolean {
  const luma = pngMeanLuminance(buf);
  return luma !== null && luma >= LOGO_LIGHT_THRESHOLD;
}
