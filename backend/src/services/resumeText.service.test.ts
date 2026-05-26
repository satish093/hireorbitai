/**
 * Tests for resume text extraction (upload → readable data). The PDF/DOCX
 * parser libs are mocked so the suite is fast and deterministic; we verify the
 * dispatch (route by mime/extension), normalization, and the non-fatal
 * contract (a parser error yields '' rather than throwing).
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

const mock = vi.hoisted(() => ({
  pdfText: 'PDF   resume\r\n\r\n\r\ntext  ' as unknown,
  pdfThrows: false,
}));

vi.mock('unpdf', () => ({
  getDocumentProxy: vi.fn(async () => ({})),
  extractText: vi.fn(async () => {
    if (mock.pdfThrows) throw new Error('corrupt pdf');
    return { totalPages: 1, text: mock.pdfText };
  }),
}));
vi.mock('../config/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));
// Prevent config/db (and pg) from loading — pg's class constructor throws
// under vitest's CJS/ESM interop. All tests in this file are pure-function
// tests that never touch the database.
vi.mock('../config/db', () => ({
  db: { from: vi.fn() },
  pool: { query: vi.fn(), connect: vi.fn() },
}));
vi.mock('./aiUsage', () => ({ logLlamaParseUsage: vi.fn() }));

import { extractResumeText } from './resumeText.service';

const file = (mimetype: string, originalname: string) => ({
  buffer: Buffer.from('x'),
  mimetype,
  originalname,
});

beforeEach(() => {
  mock.pdfThrows = false;
  mock.pdfText = 'PDF   resume\r\n\r\n\r\ntext  ';
});

describe('extractResumeText', () => {
  it('extracts + normalizes a PDF (by mime type)', async () => {
    const out = await extractResumeText(file('application/pdf', 'cv.pdf'));
    // CRLF collapsed, 3+ newlines → 2, multi-space → single, trimmed.
    expect(out).toBe('PDF resume\n\ntext');
  });

  it('extracts a PDF by .pdf extension even with a generic mime', async () => {
    const out = await extractResumeText(file('application/octet-stream', 'cv.PDF'));
    expect(out).toBe('PDF resume\n\ntext');
  });

  it('handles unpdf returning a per-page array', async () => {
    mock.pdfText = ['page one', 'page two'];
    const out = await extractResumeText(file('application/pdf', 'cv.pdf'));
    expect(out).toBe('page one\npage two');
  });

  it('returns empty string for DOCX — uploads are restricted to PDF + images', async () => {
    // DOCX/mammoth support was removed when uploads were restricted to PDF +
    // images (commit c91d191). Unsupported types yield '' rather than throwing.
    const out = await extractResumeText(
      file('application/vnd.openxmlformats-officedocument.wordprocessingml.document', 'cv.docx'),
    );
    expect(out).toBe('');
  });

  it('returns empty string for legacy .doc / unsupported types (no throw)', async () => {
    const out = await extractResumeText(file('application/msword', 'cv.doc'));
    expect(out).toBe('');
  });

  it('is non-fatal: a parser error yields empty string', async () => {
    mock.pdfThrows = true;
    const out = await extractResumeText(file('application/pdf', 'broken.pdf'));
    expect(out).toBe('');
  });
});
