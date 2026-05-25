import mammoth from 'mammoth';
import { extractText, getDocumentProxy } from 'unpdf';
import { geminiClient, GEMINI_ENABLED, GEMINI_MODEL } from '../config/gemini';
import { anthropic, ANTHROPIC_ENABLED } from '../config/anthropic';
import { logger } from '../config/logger';

// word-extractor has no @types package; type the constructor inline.
const WordExtractor: new () => {
  extract(input: Buffer): Promise<{ getBody(): string }>;
} = require('word-extractor');

/**
 * Convert an uploaded resume file into plain, readable text so the site can
 * display it and the AI features (scoring, job match, copilot, tailoring) have
 * something to read. Without this, an uploaded PDF/DOCX is an opaque blob and
 * `resumes.body_text` stays empty.
 *
 * PDF extraction hierarchy (most accurate → fastest):
 *   1. Claude API (document block) — reads the PDF visually, handles any font
 *      encoding, merged glyphs, CamelCase artefacts like "HaydenSmith". Only
 *      used when ANTHROPIC_ENABLED; falls back automatically on error.
 *   2. unpdf (pdf.js) — pure-JS fallback; fast but misses font-spacing edge cases.
 *
 * DOCX → mammoth (raw text)
 * DOC  → word-extractor (binary Compound Document Format)
 *
 * Scanned/image-only PDFs: Claude handles these if ANTHROPIC_ENABLED; otherwise
 * returns '' and the upload still succeeds.
 *
 * Always non-throwing: a malformed file logs a warning and yields '' rather
 * than failing the upload request.
 */

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

function isDoc(mimetype: string, name: string): boolean {
  return mimetype === 'application/msword' || /\.doc$/i.test(name);
}

/**
 * Use Gemini's PDF document API to extract resume text (free tier).
 * Returns null on any failure so the caller can fall back to Claude / unpdf.
 */
async function extractPdfWithGemini(buffer: Buffer): Promise<string | null> {
  if (!GEMINI_ENABLED || !geminiClient) return null;
  try {
    const base64 = buffer.toString('base64');
    const model = geminiClient.getGenerativeModel({ model: GEMINI_MODEL });
    const result = await model.generateContent({
      contents: [
        {
          role: 'user',
          parts: [
            { inlineData: { mimeType: 'application/pdf', data: base64 } },
            {
              text: 'Extract the complete text from this resume. Output only the raw text, preserving line breaks, section headings, and structure. No commentary.',
            },
          ],
        },
      ],
    });
    const text = result.response.text();
    return text.trim() || null;
  } catch (err) {
    logger.warn({ err: (err as Error).message }, 'Gemini PDF extraction failed — trying Claude');
    return null;
  }
}

/**
 * Use Claude's PDF document API to extract resume text (paid fallback).
 * Returns null on any failure so the caller can fall back to unpdf.
 */
async function extractPdfWithClaude(buffer: Buffer): Promise<string | null> {
  if (!ANTHROPIC_ENABLED) return null;
  try {
    const base64 = buffer.toString('base64');
    const resp = await anthropic.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 4096,
      messages: [
        {
          role: 'user',
          content: [
            {
              type: 'document',
              source: {
                type: 'base64',
                media_type: 'application/pdf',
                data: base64,
              },
            } as const,
            {
              type: 'text',
              text: 'Extract the complete text from this resume. Output only the raw text, preserving the original line breaks, section headings, and structure. Do not add commentary, formatting markers, or explanations.',
            },
          ],
        },
      ],
    });
    const text = resp.content.find((b) => b.type === 'text')?.text ?? '';
    return text.trim() || null;
  } catch (err) {
    logger.warn(
      { err: (err as Error).message },
      'Claude PDF extraction failed — falling back to unpdf',
    );
    return null;
  }
}

export async function extractResumeText(file: {
  buffer: Buffer;
  mimetype: string;
  originalname: string;
}): Promise<string> {
  try {
    if (isPdf(file.mimetype, file.originalname)) {
      // 1. Gemini — free tier, reads the PDF visually.
      const geminiText = await extractPdfWithGemini(file.buffer);
      if (geminiText) return normalize(geminiText);

      // 2. Claude — paid fallback, also reads visually.
      const claudeText = await extractPdfWithClaude(file.buffer);
      if (claudeText) return normalize(claudeText);

      // 3. unpdf — pure-JS, zero AI cost, last resort.
      const pdf = await getDocumentProxy(new Uint8Array(file.buffer));
      const { text } = await extractText(pdf, { mergePages: true });
      const joined = Array.isArray(text) ? text.join('\n') : (text ?? '');
      return normalize(joined);
    }
    if (isDocx(file.mimetype, file.originalname)) {
      const { value } = await mammoth.extractRawText({ buffer: file.buffer });
      return normalize(value ?? '');
    }
    if (isDoc(file.mimetype, file.originalname)) {
      const extractor = new WordExtractor();
      const doc = await extractor.extract(file.buffer);
      return normalize(doc.getBody() ?? '');
    }
    return '';
  } catch (err) {
    logger.warn(
      { err: (err as Error).message, file: file.originalname, mimetype: file.mimetype },
      'resume text extraction failed — storing file without body_text',
    );
    return '';
  }
}
