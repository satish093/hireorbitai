/**
 * Magic-byte verification for uploaded files. Defends against rename attacks
 * where a malicious payload is uploaded as e.g. `resume.pdf` but the bytes
 * are actually an executable / random binary. The multer mime+ext filter
 * trusts the user-agent and the filename; this verifier reads the actual
 * bytes and rejects mismatches.
 */

import { describe, it, expect } from 'vitest';
import { bufferMatchesExtension, verifyUploadMagic } from './upload';

// Real signatures we test against:
const PDF_SIG = Buffer.from([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x37]); // %PDF-1.7
const PNG_SIG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const JPEG_SIG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10]);
const WEBP_SIG = Buffer.from([
  0x52, 0x49, 0x46, 0x46, 0x24, 0x00, 0x00, 0x00, 0x57, 0x45, 0x42, 0x50, 0x56, 0x50,
]); // RIFF....WEBP
const DOCX_SIG = Buffer.from([0x50, 0x4b, 0x03, 0x04, 0x14, 0x00]); // PK..
const DOC_SIG = Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]);
const XLSX_SIG = Buffer.from([0x50, 0x4b, 0x03, 0x04, 0x14, 0x00]);
const RANDOM_GARBAGE = Buffer.from([0xff, 0xfe, 0xfd, 0xfc, 0xfb, 0xfa, 0xf9, 0xf8]);
const NULL_BYTES = Buffer.from([0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00]);

describe('bufferMatchesExtension — happy path', () => {
  it('accepts a real PDF', () => {
    expect(bufferMatchesExtension(PDF_SIG, 'resume.pdf')).toBe(true);
  });
  it('accepts a real PNG', () => {
    expect(bufferMatchesExtension(PNG_SIG, 'avatar.png')).toBe(true);
  });
  it('accepts a real JPEG', () => {
    expect(bufferMatchesExtension(JPEG_SIG, 'photo.jpg')).toBe(true);
    expect(bufferMatchesExtension(JPEG_SIG, 'photo.jpeg')).toBe(true);
  });
  it('accepts a real WebP (RIFF + WEBP at offset 8)', () => {
    expect(bufferMatchesExtension(WEBP_SIG, 'cover.webp')).toBe(true);
  });
  it('accepts a real DOCX (ZIP / OOXML)', () => {
    expect(bufferMatchesExtension(DOCX_SIG, 'resume.docx')).toBe(true);
  });
  it('accepts a real legacy .doc (Compound Document)', () => {
    expect(bufferMatchesExtension(DOC_SIG, 'resume.doc')).toBe(true);
  });
  it('accepts a real XLSX', () => {
    expect(bufferMatchesExtension(XLSX_SIG, 'data.xlsx')).toBe(true);
  });
});

describe('bufferMatchesExtension — disguise rejection', () => {
  it('REJECTS random garbage renamed as .pdf', () => {
    expect(bufferMatchesExtension(RANDOM_GARBAGE, 'malware.pdf')).toBe(false);
  });
  it('REJECTS null bytes renamed as .docx', () => {
    expect(bufferMatchesExtension(NULL_BYTES, 'resume.docx')).toBe(false);
  });
  it('REJECTS a PNG renamed as .pdf', () => {
    expect(bufferMatchesExtension(PNG_SIG, 'pretend.pdf')).toBe(false);
  });
  it('REJECTS a PDF renamed as .docx', () => {
    expect(bufferMatchesExtension(PDF_SIG, 'pretend.docx')).toBe(false);
  });
  it('REJECTS a DOCX renamed as .png', () => {
    expect(bufferMatchesExtension(DOCX_SIG, 'pretend.png')).toBe(false);
  });
  it('REJECTS a buffer that is too short to contain the signature', () => {
    expect(bufferMatchesExtension(Buffer.from([0x25, 0x50]), 'truncated.pdf')).toBe(false);
  });
});

describe('bufferMatchesExtension — pass-through cases', () => {
  it('passes a .txt file (no useful signature; plain text is allowed)', () => {
    expect(bufferMatchesExtension(Buffer.from('hello'), 'note.txt')).toBe(true);
  });
  it('passes a .csv file (same reason)', () => {
    expect(bufferMatchesExtension(Buffer.from('a,b,c'), 'data.csv')).toBe(true);
  });
  it('passes a file with no extension at all', () => {
    expect(bufferMatchesExtension(RANDOM_GARBAGE, 'noextension')).toBe(true);
  });
});

describe('verifyUploadMagic middleware', () => {
  function run(file?: { buffer: Buffer; originalname: string }) {
    let next: { err?: any } = {};
    const req = { file } as any;
    const res = {} as any;
    const nextFn = (err?: any) => {
      next.err = err;
    };
    verifyUploadMagic(req, res, nextFn);
    return next;
  }

  it('calls next() with no error for a real PDF', () => {
    const { err } = run({ buffer: PDF_SIG, originalname: 'resume.pdf' });
    expect(err).toBeUndefined();
  });

  it('calls next() with no error when no file is present', () => {
    const { err } = run(undefined);
    expect(err).toBeUndefined();
  });

  it('calls next(httpError 400) when bytes do not match the claimed extension', () => {
    const { err } = run({ buffer: RANDOM_GARBAGE, originalname: 'resume.pdf' });
    expect(err).toBeTruthy();
    expect((err as { status?: number }).status).toBe(400);
    expect(String((err as { message?: string }).message)).toMatch(/do not match its extension/);
  });
});
