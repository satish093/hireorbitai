import { z } from 'zod';
import { anthropic, ANTHROPIC_FALLBACK_ENABLED } from '../config/anthropic';
import { logger } from '../config/logger';

// ---------------------------------------------------------------------------
// Company-logo brand analysis (Claude vision).
//
// Given an uploaded company logo image, extract the brand identity: company
// name, dominant brand color (hex), and tagline. Used by userGroups.uploadLogo
// to auto-theme the company + seed a branded Draft invoice.
//
// Claude-only by user decision (Groq has no vision; prod Gemini is quota-broken).
// Mirrors extractImageWithClaude in resumeText.service.ts — gated on
// ANTHROPIC_FALLBACK_ENABLED (AI_ALLOW_ANTHROPIC=true + a credential). Returns
// null on any failure / when disabled, so callers degrade gracefully.
// ---------------------------------------------------------------------------

export interface LogoAnalysis {
  company_name: string | null;
  brand_color: string | null; // #RRGGBB
  tagline: string | null;
  confidence: number; // 0..1, for company_name
}

// Per-field `.catch` makes the parse total — a malformed/partial model response
// degrades each field to a safe default instead of throwing.
const LogoAnalysisSchema = z.object({
  company_name: z.string().trim().min(1).max(120).nullable().catch(null),
  brand_color: z
    .string()
    .regex(/^#[0-9A-Fa-f]{6}$/)
    .nullable()
    .catch(null),
  tagline: z.string().trim().min(1).max(200).nullable().catch(null),
  confidence: z.number().min(0).max(1).catch(0),
});

const PROMPT = `You are a brand analyst. Look at this company logo image and extract its brand identity.
Respond with ONLY a JSON object — no markdown, no code fences, no commentary — of exactly this shape:
{
  "company_name": string | null,   // the company name exactly as written in the logo, or null if no readable text
  "brand_color": string | null,    // the dominant brand color as a 6-digit hex like "#1AB2C3", or null
  "tagline": string | null,        // any tagline/strapline text in the logo, or null
  "confidence": number             // 0..1 — your confidence in company_name
}
For brand_color use the most prominent non-neutral color (ignore black, white and gray). Be conservative: use null for anything you cannot read clearly.`;

type ClaudeMedia = 'image/jpeg' | 'image/png' | 'image/webp' | 'image/gif';
const CLAUDE_IMAGE_TYPES: ClaudeMedia[] = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];

/** Pull the first balanced JSON object out of a model response (tolerates stray
 *  prose or ```json fences). */
function extractJson(text: string): unknown {
  const cleaned = text
    .replace(/```json/gi, '')
    .replace(/```/g, '')
    .trim();
  const start = cleaned.indexOf('{');
  const end = cleaned.lastIndexOf('}');
  if (start === -1 || end === -1 || end < start) return null;
  try {
    return JSON.parse(cleaned.slice(start, end + 1));
  } catch {
    return null;
  }
}

export async function analyzeCompanyLogo(
  buffer: Buffer,
  mimetype: string,
): Promise<LogoAnalysis | null> {
  if (!ANTHROPIC_FALLBACK_ENABLED) return null;
  if (!CLAUDE_IMAGE_TYPES.includes(mimetype as ClaudeMedia)) return null;
  try {
    const resp = await anthropic.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 512,
      messages: [
        {
          role: 'user',
          content: [
            {
              type: 'image',
              source: {
                type: 'base64',
                media_type: mimetype as ClaudeMedia,
                data: buffer.toString('base64'),
              },
            },
            { type: 'text', text: PROMPT },
          ],
        },
      ],
    });
    const text = resp.content.find((b) => b.type === 'text')?.text ?? '';
    const json = extractJson(text);
    if (!json) return null;
    return LogoAnalysisSchema.parse(json);
  } catch (err) {
    logger.warn({ err: (err as Error).message }, 'Claude logo analysis failed');
    return null;
  }
}
