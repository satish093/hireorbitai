import mammoth from 'mammoth';
import { extractText, getDocumentProxy } from 'unpdf';
import { logger } from '../config/logger';

/**
 * Convert an uploaded resume file into plain, readable text so the site can
 * display it and the AI features (scoring, job match, copilot, tailoring) have
 * something to read. Without this, an uploaded PDF/DOCX is an opaque blob and
 * `resumes.body_text` stays empty.
 *
 * Pure-JS extractors, no native deps:
 *   - PDF  → unpdf (pdf.js under the hood)
 *   - DOCX → mammoth (raw text)
 *
 * Legacy binary .doc and scanned/image-only PDFs are NOT handled (no OCR) —
 * those return '' and the upload still succeeds (the caller treats an empty
 * result as "no extractable text", same as a file the user never pasted).
 *
 * Always non-throwing: a malformed file logs a warning and yields '' rather
 * than failing the upload request.
 */

// Cap what we persist so a pathological file can't write megabytes into the
// row. AI calls clip further at call time (AI_MAX_INPUT_CHARS).
const MAX_STORED_CHARS = 200_000;

function normalize(s: string): string {
  return s
    .replace(/\r\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .replace(/[ \t]{2,}/g, ' ')
    .trim()
    .slice(0, MAX_STORED_CHARS);
}

function isPdf(mimetype: string, name: string): boolean {
  return mimetype === 'application/pdf' || /\.pdf$/i.test(name);
}

function isDocx(mimetype: string, name: string): boolean {
  return (
    mimetype === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' ||
    /\.docx$/i.test(name)
  );
}

export async function extractResumeText(file: {
  buffer: Buffer;
  mimetype: string;
  originalname: string;
}): Promise<string> {
  try {
    if (isPdf(file.mimetype, file.originalname)) {
      const pdf = await getDocumentProxy(new Uint8Array(file.buffer));
      const { text } = await extractText(pdf, { mergePages: true });
      const joined = Array.isArray(text) ? text.join('\n') : (text ?? '');
      return normalize(joined);
    }
    if (isDocx(file.mimetype, file.originalname)) {
      const { value } = await mammoth.extractRawText({ buffer: file.buffer });
      return normalize(value ?? '');
    }
    // Legacy .doc / unsupported type — no pure-JS extractor; skip gracefully.
    return '';
  } catch (err) {
    logger.warn(
      { err: (err as Error).message, file: file.originalname, mimetype: file.mimetype },
      'resume text extraction failed — storing file without body_text',
    );
    return '';
  }
}
