import { extractText, getDocumentProxy } from 'unpdf';
import { geminiClient, GEMINI_ENABLED, GEMINI_MODEL, withGeminiRetry } from '../config/gemini';
import { anthropic, ANTHROPIC_ENABLED } from '../config/anthropic';
import { logger } from '../config/logger';

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

function isImage(mimetype: string, name: string): boolean {
  return (
    ['image/jpeg', 'image/png', 'image/webp'].includes(mimetype) ||
    /\.(jpe?g|png|webp)$/i.test(name)
  );
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
    const result = await withGeminiRetry(() =>
      model.generateContent({
        contents: [
          {
            role: 'user',
            parts: [
              { inlineData: { mimeType: 'application/pdf', data: base64 } },
              {
                text: `Extract this resume and format it as clean Markdown:
- Candidate name → # Name
- Section headings (Experience, Education, Skills, Summary, etc.) → ## Section
- Job titles / degree entries → ### Title at Company  (or ### Degree at Institution)
- All bullet points → - item
- All other text as plain paragraphs

Output only the Markdown. No commentary, no code fences.`,
              },
            ],
          },
        ],
      }),
    );
    const text = result.response.text();
    return text.trim() || null;
  } catch (err) {
    logger.warn({ err: (err as Error).message }, 'Gemini PDF extraction failed — trying Claude');
    return null;
  }
}

/**
 * Use Gemini vision to extract resume text from an image file.
 * Returns null on any failure so the caller can fall back to Claude.
 */
async function extractImageWithGemini(buffer: Buffer, mimetype: string): Promise<string | null> {
  if (!GEMINI_ENABLED || !geminiClient) return null;
  try {
    const base64 = buffer.toString('base64');
    const model = geminiClient.getGenerativeModel({ model: GEMINI_MODEL });
    const result = await withGeminiRetry(() =>
      model.generateContent({
        contents: [
          {
            role: 'user',
            parts: [
              {
                inlineData: {
                  mimeType: mimetype as 'image/jpeg' | 'image/png' | 'image/webp',
                  data: base64,
                },
              },
              {
                text: `Extract this resume image and format it as clean Markdown:
- Candidate name → # Name
- Section headings (Experience, Education, Skills, Summary, etc.) → ## Section
- Job titles / degree entries → ### Title at Company  (or ### Degree at Institution)
- All bullet points → - item
- All other text as plain paragraphs

Output only the Markdown. No commentary, no code fences.`,
              },
            ],
          },
        ],
      }),
    );
    const text = result.response.text();
    return text.trim() || null;
  } catch (err) {
    logger.warn({ err: (err as Error).message }, 'Gemini image extraction failed — trying Claude');
    return null;
  }
}

/**
 * Use Claude vision to extract resume text from an image file (paid fallback).
 */
async function extractImageWithClaude(buffer: Buffer, mimetype: string): Promise<string | null> {
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
              type: 'image',
              source: {
                type: 'base64',
                media_type: mimetype as 'image/jpeg' | 'image/png' | 'image/webp',
                data: base64,
              },
            },
            {
              type: 'text',
              text: `Extract this resume image and format it as clean Markdown:
- Candidate name → # Name
- Section headings (Experience, Education, Skills, Summary, etc.) → ## Section
- Job titles / degree entries → ### Title at Company  (or ### Degree at Institution)
- All bullet points → - item
- All other text as plain paragraphs

Output only the Markdown. No commentary, no code fences.`,
            },
          ],
        },
      ],
    });
    const text = resp.content.find((b) => b.type === 'text')?.text ?? '';
    return text.trim() || null;
  } catch (err) {
    logger.warn({ err: (err as Error).message }, 'Claude image extraction failed');
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
    if (isImage(file.mimetype, file.originalname)) {
      // 1. Gemini vision — free tier.
      const geminiText = await extractImageWithGemini(file.buffer, file.mimetype);
      if (geminiText) return normalize(geminiText);

      // 2. Claude vision — paid fallback.
      const claudeText = await extractImageWithClaude(file.buffer, file.mimetype);
      if (claudeText) return normalize(claudeText);

      return '';
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
