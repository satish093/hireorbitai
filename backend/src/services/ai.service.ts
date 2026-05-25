/**
 * Core AI service — resume scoring, tailoring, job matching, copilot.
 *
 * Improvements vs. the original:
 *   1. Prompt caching — stable system-prompt blocks are marked `cache_control:
 *      ephemeral` so Anthropic re-uses the KV cache across repeated calls on the
 *      same resume/JD. Saves ~90 % of input tokens for repeated patterns.
 *   2. LRU response cache — identical inputs skip the API entirely for 15 min –
 *      24 h depending on the call type (see aiCache.ts for TTLs).
 *   3. Skill normalisation — "ReactJS", "React.js", "React" all resolve to the
 *      same canonical label before being sent to the model, so the AI never
 *      falsely reports a missing skill due to a naming variant.
 *   4. Substantially improved prompts — rubric-based scoring, chain-of-thought
 *      ATS strategy, per-section tailoring guidelines, professional email
 *      templates, and richer job-match reasoning.
 */

import { z } from 'zod/v4';
import type { MessageParam, TextBlockParam } from '@anthropic-ai/sdk/resources/messages';
import { anthropic, ANTHROPIC_MODEL, AI_MAX_INPUT_CHARS } from '../config/anthropic';
import { groqClient, GROQ_MODEL, GROQ_FAST_MODEL, GROQ_ENABLED } from '../config/groq';
import { geminiClient, GEMINI_ENABLED, GEMINI_MODEL } from '../config/gemini';
import { logAiUsage } from './aiUsage';
import {
  withCache,
  resumeScoreCache,
  resumeProfileCache,
  jobRequirementsCache,
  skillMatchCache,
  jobMatchCache,
} from './aiCache';
import { normalizeSkills } from './skillNorm';
import { logger } from '../config/logger';
import { env } from '../config/env';
import {
  scoreResumeRuleBased,
  parseResumeProfileRuleBased,
  extractJobRequirementsRuleBased,
  scoreResumeAgainstJobRuleBased,
  matchJobsForConsultantRuleBased,
} from './resumeRuleBased.service';
// atsScore lives in its own module to avoid a circular dependency with the
// rule-based service (which also needs atsScore as a scoring primitive).
export { atsScore, AtsScoreSchema } from './atsScore.service';
export type { AtsScoreResult } from './atsScore.service';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Hard-clip free-text inputs so we don't blow the token budget. */
function clip(text: string | null | undefined, max: number = AI_MAX_INPUT_CHARS): string {
  const s = (text ?? '').trim();
  return s.length > max ? s.slice(0, max) : s;
}

function usageFrom(response: { usage: { input_tokens: number; output_tokens: number } }) {
  return { input_tokens: response.usage.input_tokens, output_tokens: response.usage.output_tokens };
}

/**
 * Mark a text block as prompt-cacheable when it's large enough to benefit
 * (Anthropic requires ≥ 1 024 tokens for Haiku; we approximate at 4 chars/token).
 */
function cacheableBlock(text: string, minChars = 4_096): TextBlockParam {
  const block: TextBlockParam = { type: 'text', text };
  if (text.length >= minChars) {
    (block as { type: 'text'; text: string; cache_control?: object }).cache_control = {
      type: 'ephemeral',
    };
  }
  return block;
}

// ---------------------------------------------------------------------------
// Core structured-output wrapper — with prompt caching support
// ---------------------------------------------------------------------------

/**
 * Call the model with a structured system instruction + user content.
 *
 * `systemInstruction` is always marked cacheable (it's large and stable).
 * `userContent` can be an array of blocks so callers can mark specific parts
 * (e.g. the resume body) as cacheable independently.
 */
async function callStructured<T extends z.ZodType>(
  callName: string,
  systemInstruction: string,
  userContent: string | TextBlockParam[],
  schema: T,
  maxTokens = 1024,
  model = ANTHROPIC_MODEL,
): Promise<z.infer<T>> {
  const userBlocks: TextBlockParam[] =
    typeof userContent === 'string' ? [{ type: 'text', text: userContent }] : userContent;

  const messages: MessageParam[] = [{ role: 'user', content: userBlocks }];

  const response = await anthropic.messages.create({
    model,
    max_tokens: maxTokens,
    system: [cacheableBlock(systemInstruction, 0)],
    messages,
  });

  if (response.stop_reason === 'max_tokens') {
    logAiUsage(callName, model, usageFrom(response));
    throw new Error(`AI response truncated (hit ${maxTokens}-token limit) for ${callName}`);
  }

  const raw = response.content[0]?.type === 'text' ? response.content[0].text.trim() : '{}';
  let text = raw
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```\s*$/, '')
    .trim();

  // Extract only the outermost JSON object/array; the model sometimes appends
  // a trailing note after the closing brace which breaks JSON.parse.
  const jsonStart = text.search(/[\[{]/);
  if (jsonStart >= 0) {
    const opener = text[jsonStart];
    const closer = opener === '{' ? '}' : ']';
    let depth = 0,
      inStr = false,
      esc = false;
    for (let i = jsonStart; i < text.length; i++) {
      const ch = text[i];
      if (esc) {
        esc = false;
        continue;
      }
      if (ch === '\\' && inStr) {
        esc = true;
        continue;
      }
      if (ch === '"') {
        inStr = !inStr;
        continue;
      }
      if (inStr) continue;
      if (ch === opener) depth++;
      else if (ch === closer && --depth === 0) {
        text = text.slice(jsonStart, i + 1);
        break;
      }
    }
    if (depth !== 0) text = text.slice(jsonStart);
  }

  logAiUsage(callName, model, usageFrom(response));
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error(`AI returned malformed JSON for ${callName}`);
  }
  const result = schema.safeParse(parsed);
  if (!result.success) {
    logger.warn(
      { issues: result.error.issues.slice(0, 3), callName },
      'AI schema validation failed',
    );
    throw new Error(`AI returned an unexpected structure for ${callName} — please try again.`);
  }
  return result.data as z.infer<T>;
}

async function callText(
  callName: string,
  systemInstruction: string,
  userContent: string,
  maxTokens = 600,
  model = ANTHROPIC_MODEL,
): Promise<string> {
  const response = await anthropic.messages.create({
    model,
    max_tokens: maxTokens,
    system: [cacheableBlock(systemInstruction, 0)],
    messages: [{ role: 'user', content: userContent }],
  });
  const text = response.content[0]?.type === 'text' ? response.content[0].text.trim() : '';
  logAiUsage(callName, model, usageFrom(response));
  return text;
}

// ---------------------------------------------------------------------------
// Groq helpers — used for resume tailoring and job copilot (free tier)
// ---------------------------------------------------------------------------

/** JSON extractor reused from callStructured — strips markdown fences and
 *  finds the outermost JSON object/array in a model response. */
function extractJson(raw: string): string {
  let text = raw
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```\s*$/, '')
    .trim();
  const start = text.search(/[\[{]/);
  if (start >= 0) {
    const opener = text[start];
    const closer = opener === '{' ? '}' : ']';
    let depth = 0,
      inStr = false,
      esc = false;
    for (let i = start; i < text.length; i++) {
      const ch = text[i];
      if (esc) {
        esc = false;
        continue;
      }
      if (ch === '\\' && inStr) {
        esc = true;
        continue;
      }
      if (ch === '"') {
        inStr = !inStr;
        continue;
      }
      if (inStr) continue;
      if (ch === opener) depth++;
      else if (ch === closer && --depth === 0) {
        text = text.slice(start, i + 1);
        break;
      }
    }
    if (depth !== 0) text = text.slice(start);
  }
  return text;
}

async function callGroqStructured<T extends z.ZodType>(
  callName: string,
  systemPrompt: string,
  userContent: string,
  schema: T,
  maxTokens = 2048,
  model = GROQ_MODEL,
): Promise<z.infer<T>> {
  if (!GROQ_ENABLED || !groqClient) {
    throw new Error(`${callName} requires GROQ_API_KEY to be configured`);
  }
  const completion = await groqClient.chat.completions.create({
    model,
    messages: [
      { role: 'system', content: systemPrompt + '\n\nReturn valid JSON only, no markdown fences.' },
      { role: 'user', content: userContent },
    ],
    response_format: { type: 'json_object' },
    temperature: 0.3,
    max_tokens: maxTokens,
  });
  const raw = completion.choices[0]?.message?.content?.trim() ?? '{}';
  let parsed: unknown;
  try {
    parsed = JSON.parse(extractJson(raw));
  } catch {
    throw new Error(`Groq returned malformed JSON for ${callName}`);
  }
  const result = schema.safeParse(parsed);
  if (!result.success) {
    logger.warn(
      { issues: result.error.issues.slice(0, 3), callName },
      'Groq schema validation failed',
    );
    throw new Error(`Groq returned unexpected structure for ${callName} — please try again.`);
  }
  return result.data as z.infer<T>;
}

async function callGroqText(
  _callName: string,
  systemPrompt: string,
  userContent: string,
  maxTokens = 600,
  model = GROQ_FAST_MODEL,
): Promise<string> {
  if (!GROQ_ENABLED || !groqClient) {
    throw new Error('Job copilot requires GROQ_API_KEY to be configured');
  }
  const completion = await groqClient.chat.completions.create({
    model,
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userContent },
    ],
    temperature: 0.4,
    max_tokens: maxTokens,
  });
  return completion.choices[0]?.message?.content?.trim() ?? '';
}

// ---------------------------------------------------------------------------
// Gemini daily token quota (free tier = 1M tokens/day; hard-stop at 950k)
// ---------------------------------------------------------------------------

const geminiQuota = { date: '', tokens: 0 };

function geminiUtcDate(): string {
  return new Date().toISOString().slice(0, 10);
}

function checkGeminiQuota(): void {
  const today = geminiUtcDate();
  if (geminiQuota.date !== today) {
    geminiQuota.date = today;
    geminiQuota.tokens = 0;
  }
  const limit = env.gemini.dailyTokenLimit;
  if (geminiQuota.tokens >= limit) {
    logger.warn(
      { gemini_quota: { used: geminiQuota.tokens, limit, date: today } },
      'gemini.quota daily token limit reached — falling back to next provider',
    );
    throw new Error(`Gemini daily token quota (${limit.toLocaleString()}) reached`);
  }
}

function recordGeminiTokens(input: number, output: number): void {
  const today = geminiUtcDate();
  if (geminiQuota.date !== today) {
    geminiQuota.date = today;
    geminiQuota.tokens = 0;
  }
  geminiQuota.tokens += input + output;
  const limit = env.gemini.dailyTokenLimit;
  if (geminiQuota.tokens > limit * 0.9) {
    logger.warn(
      { gemini_quota: { used: geminiQuota.tokens, limit, date: today } },
      'gemini.quota >90% of daily token limit consumed',
    );
  }
}

// ---------------------------------------------------------------------------
// Gemini helpers
// ---------------------------------------------------------------------------

async function callGeminiStructured<T extends z.ZodType>(
  callName: string,
  systemPrompt: string,
  userContent: string,
  schema: T,
  _maxTokens = 2048,
): Promise<z.infer<T>> {
  if (!GEMINI_ENABLED || !geminiClient) {
    throw new Error(`${callName} requires GEMINI_API_KEY to be configured`);
  }
  checkGeminiQuota();
  const model = geminiClient.getGenerativeModel({
    model: GEMINI_MODEL,
    systemInstruction: systemPrompt + '\n\nReturn valid JSON only, no markdown fences.',
  });
  const result = await model.generateContent(userContent);
  const raw = result.response.text();
  const usage = result.response.usageMetadata;
  const inputTok = usage?.promptTokenCount ?? 0;
  const outputTok = usage?.candidatesTokenCount ?? 0;
  recordGeminiTokens(inputTok, outputTok);
  logAiUsage(callName, GEMINI_MODEL, {
    input_tokens: inputTok,
    output_tokens: outputTok,
  });
  let parsed: unknown;
  try {
    parsed = JSON.parse(extractJson(raw));
  } catch {
    throw new Error(`Gemini returned malformed JSON for ${callName}`);
  }
  const validated = schema.safeParse(parsed);
  if (!validated.success) {
    logger.warn(
      { issues: validated.error.issues.slice(0, 3), callName },
      'Gemini schema validation failed',
    );
    throw new Error(`Gemini returned unexpected structure for ${callName} — please try again.`);
  }
  return validated.data as z.infer<T>;
}

async function callGeminiText(
  callName: string,
  systemPrompt: string,
  userContent: string,
  _maxTokens = 600,
): Promise<string> {
  if (!GEMINI_ENABLED || !geminiClient) {
    throw new Error(`${callName} requires GEMINI_API_KEY to be configured`);
  }
  checkGeminiQuota();
  const model = geminiClient.getGenerativeModel({
    model: GEMINI_MODEL,
    systemInstruction: systemPrompt,
  });
  const result = await model.generateContent(userContent);
  const usage = result.response.usageMetadata;
  const inputTok = usage?.promptTokenCount ?? 0;
  const outputTok = usage?.candidatesTokenCount ?? 0;
  recordGeminiTokens(inputTok, outputTok);
  logAiUsage(callName, GEMINI_MODEL, {
    input_tokens: inputTok,
    output_tokens: outputTok,
  });
  return result.response.text();
}

// ---------------------------------------------------------------------------
// Provider-chain abstraction — replaces duplicated Groq/Anthropic fallback
// ---------------------------------------------------------------------------

/** Try each provider in order; log on failure and advance to next. Throws the
 *  last error only when all providers are exhausted. */
async function callWithProviders<T>(label: string, providers: Array<() => Promise<T>>): Promise<T> {
  let lastErr: unknown;
  for (const [i, call] of providers.entries()) {
    try {
      return await call();
    } catch (err) {
      logger.warn({ label, attempt: i + 1 }, 'ai: provider failed, trying next');
      lastErr = err;
    }
  }
  throw lastErr;
}

/** Groq-primary structured: Groq → Gemini → Anthropic */
async function callGroqStructuredWithFallback<T extends z.ZodType>(
  callName: string,
  systemPrompt: string,
  userContent: string,
  schema: T,
  maxTokens = 2048,
): Promise<z.infer<T>> {
  return callWithProviders(callName, [
    ...(GROQ_ENABLED
      ? [() => callGroqStructured(callName, systemPrompt, userContent, schema, maxTokens)]
      : []),
    ...(GEMINI_ENABLED
      ? [() => callGeminiStructured(callName, systemPrompt, userContent, schema, maxTokens)]
      : []),
    () => callStructured(callName, systemPrompt, userContent, schema, maxTokens),
  ]);
}

/** Groq-primary text: Groq → Gemini → Anthropic */
async function callGroqTextWithFallback(
  callName: string,
  systemPrompt: string,
  userContent: string,
  maxTokens = 600,
): Promise<string> {
  return callWithProviders(callName, [
    ...(GROQ_ENABLED ? [() => callGroqText(callName, systemPrompt, userContent, maxTokens)] : []),
    ...(GEMINI_ENABLED
      ? [() => callGeminiText(callName, systemPrompt, userContent, maxTokens)]
      : []),
    () => callText(callName, systemPrompt, userContent, maxTokens),
  ]);
}

/** Gemini-primary structured: Gemini → Groq → Anthropic
 *  Use for analysis/scoring tasks where reasoning over context beats raw speed. */
async function callGeminiStructuredWithFallback<T extends z.ZodType>(
  callName: string,
  systemPrompt: string,
  userContent: string,
  schema: T,
  maxTokens = 2048,
): Promise<z.infer<T>> {
  return callWithProviders(callName, [
    ...(GEMINI_ENABLED
      ? [() => callGeminiStructured(callName, systemPrompt, userContent, schema, maxTokens)]
      : []),
    ...(GROQ_ENABLED
      ? [() => callGroqStructured(callName, systemPrompt, userContent, schema, maxTokens)]
      : []),
    () => callStructured(callName, systemPrompt, userContent, schema, maxTokens),
  ]);
}

// ---------------------------------------------------------------------------
// Resume scoring — rubric-based, 5 dimensions × 20 pts
// ---------------------------------------------------------------------------

export const ResumeScoreSchema = z.object({
  score: z.number(),
  score_breakdown: z
    .object({
      quantified_impact: z.number(),
      action_verbs: z.number(),
      ats_formatting: z.number(),
      skills_depth: z.number(),
      clarity_brevity: z.number(),
    })
    .optional(),
  strengths: z.array(z.string()),
  weaknesses: z.array(z.string()),
  suggestions: z.array(z.string()),
});
export type ResumeScoreResult = z.infer<typeof ResumeScoreSchema>;

const SCORE_RESUME_SYSTEM = `You are a senior technical recruiter and certified resume coach with 15+ years of experience placing engineers and consultants. Score resumes with the rigour of a top-tier staffing agency reviewer.

SCORING RUBRIC — 5 dimensions × 20 points = 100 total:

1. QUANTIFIED IMPACT (0–20)
   20 = every role has ≥2 metrics (numbers, %, $, scale, time-saved)
   10 = roughly half the roles are quantified
   0  = purely descriptive ("responsible for") with no numbers

2. ACTION VERBS (0–20)
   20 = every bullet opens with a strong, specific verb (Led, Architected, Reduced, Launched, Negotiated)
   10 = mixed — some strong verbs, some weak ("worked on", "helped with")
   0  = passive voice or noun phrases throughout

3. ATS FORMATTING (0–20)
   20 = standard section headings, plain-text bullets, no tables/columns/graphics, consistent date format
   10 = minor issues (one non-standard heading, inconsistent dates)
   0  = tables, text boxes, columns, unusual section names, or embedded graphics

4. SKILLS DEPTH (0–20)
   20 = skills listed with versions/context (e.g. "React 18 + TypeScript 5"), grouped by category, ≥8 distinct skills
   10 = flat list, some duplication, vague entries ("Web development")
   0  = empty skills section or only 1–3 entries

5. CLARITY & BREVITY (0–20)
   20 = each bullet ≤2 lines, summary ≤4 lines, no filler ("team player", "detail-oriented"), strong narrative
   10 = some wordy bullets or generic summary phrases
   0  = paragraph-long bullets, no summary, or excessive filler

RESPONSE FORMAT — return JSON only:
{
  "score": <total 0–100>,
  "score_breakdown": { "quantified_impact": N, "action_verbs": N, "ats_formatting": N, "skills_depth": N, "clarity_brevity": N },
  "strengths": ["<cite specific text from the resume>", ...],  // 3–5 items
  "weaknesses": ["<quote or paraphrase exact weak text>", ...],  // 3–5 items
  "suggestions": ["<specific, actionable fix — e.g. 'Add a metric to your AWS Migration bullet in the Acme Corp role'>", ...]  // 5–8 items, ordered by impact
}`;

export async function scoreResume(resumeText: string): Promise<ResumeScoreResult> {
  const clipped = clip(resumeText);
  return withCache(resumeScoreCache, clipped, async () => {
    try {
      return await callGeminiStructuredWithFallback(
        'scoreResume',
        SCORE_RESUME_SYSTEM,
        clipped,
        ResumeScoreSchema,
        800,
      );
    } catch {
      return scoreResumeRuleBased(clipped);
    }
  });
}

// ---------------------------------------------------------------------------
// Resume profile extraction
// ---------------------------------------------------------------------------

const ExperienceItemSchema = z.object({
  company: z.string(),
  title: z.string(),
  start_date: z.string().nullable(),
  end_date: z.string().nullable(),
  is_current: z.boolean().optional(),
  description: z.string().nullable(),
});

const EducationItemSchema = z.object({
  institution: z.string(),
  degree: z.string().nullable(),
  field: z.string().nullable(),
  graduation_year: z.number().nullable(),
});

export const ResumeProfileSchema = z.object({
  name: z.string().nullable(),
  email: z.string().nullable(),
  phone: z.string().nullable(),
  location: z.string().nullable(),
  linkedin_url: z.string().nullable(),
  website: z.string().nullable(),
  summary: z.string().nullable(),
  total_years_experience: z.number().nullable(),
  age: z.number().nullable(),
  skills: z.array(z.string()),
  experiences: z.array(ExperienceItemSchema),
  education: z.array(EducationItemSchema),
  certifications: z.array(z.string()),
  languages: z.array(z.string()),
});
export type ResumeProfile = z.infer<typeof ResumeProfileSchema>;

const _PARSE_PROFILE_SYSTEM = `You are a precise data-extraction engine for resumes. Extract ONLY what is explicitly stated — never infer, guess, or fabricate. When a field isn't present, use null or an empty array.

EXTRACTION RULES:
- skills: Extract ALL technical and soft skills mentioned anywhere in the resume. Include programming languages, frameworks, tools, certifications, and methodologies. Normalise obvious abbreviations ("JS" → "JavaScript", "K8s" → "Kubernetes") but keep less obvious ones verbatim.
- total_years_experience: Sum work experience years. If current, count to today. Round to nearest 0.5.
- linkedin_url: Accept any URL containing "linkedin.com/in/".
- experiences: Sort most-recent first. description: include the full content of role bullets as a single string.
- age: Only if explicitly stated as a number (not inferred from graduation year).

Return valid JSON matching the schema. No markdown, no explanation.`;

export async function parseResumeProfile(resumeText: string): Promise<ResumeProfile> {
  const clipped = clip(resumeText);
  return withCache(resumeProfileCache, clipped, async () => parseResumeProfileRuleBased(clipped));
}

// atsScore, AtsScoreSchema, AtsScoreResult are re-exported at the top of this
// file from ./atsScore.service — see the import block.

// ---------------------------------------------------------------------------
// Vendor submission email
// ---------------------------------------------------------------------------

const VendorEmailSchema = z.object({
  subject: z.string(),
  body: z.string(),
});

export interface VendorEmailInput {
  consultantName: string;
  consultantSkills: string[];
  consultantExperienceYears: number;
  jobTitle: string;
  jobDescription?: string;
  vendorName?: string;
  recruiterName: string;
}

const VENDOR_EMAIL_SYSTEM = `You are a senior technical recruiter writing a vendor submission email. Your emails are known for being concise, specific, and effective — hiring managers read them instead of skipping them.

STRUCTURE (follow exactly):
Subject line: "Submission: [Consultant Name] for [Job Title] — [Top Skill] / [Years] yrs"

Body paragraphs:
1. ONE sentence greeting + why you're writing (name the role and the consultant).
2. TWO to THREE sentences on the consultant's most relevant experience, citing 1–2 specific skills from the JD and a quantified achievement if the JD mentions metrics or scale.
3. ONE sentence on availability / start date readiness (keep generic: "available for immediate / 2-week notice start").
4. ONE sentence call-to-action: suggest a quick call to discuss the profile.
5. Sign-off: recruiter's name.

STYLE RULES:
- No emojis, no exclamation marks, no buzzwords ("rockstar", "guru", "ninja").
- Formal but warm — not corporate stiff.
- Total body: 100–150 words.

Return JSON: { subject: string, body: string }`;

export async function generateVendorSubmissionEmail(
  input: VendorEmailInput,
): Promise<{ subject: string; body: string }> {
  const skills = input.consultantSkills.slice(0, 8).join(', ');
  const jdContext = input.jobDescription
    ? `\n\nJob description excerpt:\n${clip(input.jobDescription, 800)}`
    : '';

  const userContent = `Recruiter: ${input.recruiterName}
Vendor / hiring manager: ${input.vendorName ?? 'Hiring Team'}
Consultant: ${input.consultantName} — ${input.consultantExperienceYears} years total experience
Top skills: ${skills}
Target role: ${input.jobTitle}${jdContext}`;

  return callGroqStructuredWithFallback(
    'generateVendorSubmissionEmail',
    VENDOR_EMAIL_SYSTEM,
    userContent,
    VendorEmailSchema,
    700,
  );
}

// ---------------------------------------------------------------------------
// Job requirements extraction
// ---------------------------------------------------------------------------

export const JobRequirementsSchema = z.object({
  must_haves: z.array(z.string()),
  nice_to_haves: z.array(z.string()),
  required_skills: z.array(z.string()),
  min_years_of_experience: z.number().nullable(),
  job_seniority: z.string().nullable(),
  work_model: z.string().nullable(),
  work_authorization: z.array(z.string()),
  location_requirements: z.string().nullable(),
  core_responsibilities: z.array(z.string()),
  skill_summaries: z.array(z.string()),
  benefits_summaries: z.array(z.string()),
  education_summaries: z.array(z.string()),
  highlights: z.array(z.string()),
  recommendation_tags: z.array(z.string()),
});
export type JobRequirements = z.infer<typeof JobRequirementsSchema>;

const _EXTRACT_JOB_SYSTEM = `You are parsing a job posting to produce structured fields for a candidate-matching UI. Extract ONLY what is explicitly stated or strongly implied — never invent or assume.

FIELD-BY-FIELD RULES:
- must_haves: hard gates — if the candidate lacks these, a recruiter would not submit them. Use short phrases (≤ 8 words each).
- nice_to_haves: preferred but not disqualifying.
- required_skills: clean, canonical skill names ready for fuzzy matching. Normalise ("React.js" → "React"). 5–15 items, no duplicates.
- job_seniority: MUST be exactly one of: "Entry", "Mid", "Senior", "Lead/Staff", "Principal", "Manager", "Director", or null.
- work_model: MUST be exactly one of: "Remote", "Hybrid", "Onsite", or null.
- work_authorization: array from: ["H1B Sponsor Likely", "No Sponsorship", "US Citizen", "Green Card", "Security Clearance", "Public Trust"]. Only include items that are clearly stated.
- highlights: 3–5 selling points a strong candidate would care about (interesting tech, impact, growth, perks).
- recommendation_tags: short chips like "Visa Friendly", "Fully Remote", "Clearance Required", "Fast Growth", "Series B".

Return JSON only. Empty arrays / null when a field is not in the posting.`;

export async function extractJobRequirements(input: {
  title: string;
  description?: string | null;
  required_skills?: string[] | null;
  location?: string | null;
}): Promise<JobRequirements> {
  const clippedDesc = clip(input.description);
  return withCache(jobRequirementsCache, { title: input.title, desc: clippedDesc }, async () =>
    extractJobRequirementsRuleBased({ ...input, description: clippedDesc }),
  );
}

// ---------------------------------------------------------------------------
// Per-skill match scoring  (resume vs job)
// ---------------------------------------------------------------------------

export const SkillMatchSchema = z.object({
  per_skill: z.array(
    z.object({
      skill: z.string(),
      score: z.number(),
      evidence: z.string().nullable(),
    }),
  ),
  overall_score: z.number(),
  rank_desc: z.string(),
  feature_scores: z.object({
    seniority_match: z.number(),
    skill_match: z.number(),
    industry_match: z.number(),
  }),
  rationale: z.array(z.string()),
});
export type SkillMatchResult = z.infer<typeof SkillMatchSchema>;

const SKILL_MATCH_SYSTEM = `You are a technical skills assessor for a staffing agency. Score how well a consultant's resume matches a job posting.

SCORING MODEL:
overall_score = round(skill_match × 0.60 + seniority_match × 0.25 + industry_match × 0.15)

skill_match: average of per_skill scores (0–1 each)
  1.0 = skill clearly evidenced in the resume (named or demonstrated)
  0.7 = adjacent / transferable skill evident
  0.4 = partial evidence only (mentioned briefly or in older role)
  0.0 = no evidence at all

seniority_match (0–1): how well total experience and role scope matches the job's level
  1.0 = exact fit  |  0.7 = ±1 level  |  0.4 = ±2 levels  |  0.0 = severe mismatch

industry_match (0–1): domain familiarity — relevant industry, company type, or product category

rank_desc: "Strong Match" (≥85), "Good Match" (70–84), "Fair Match" (50–69), "Weak Match" (<50)

RESPONSE FORMAT — JSON only, no markdown:
{
  "per_skill": [{ "skill": "...", "score": 0.0–1.0, "evidence": "one-line quote/paraphrase or null" }],
  "overall_score": 0–100,
  "rank_desc": "...",
  "feature_scores": { "seniority_match": 0–1, "skill_match": 0–1, "industry_match": 0–1 },
  "rationale": ["<2–3 sentences from the candidate's perspective explaining the key gaps or strengths>"]
}`;

export async function scoreResumeAgainstJob(input: {
  resumeText: string;
  job: {
    title: string;
    description?: string | null;
    required_skills?: string[] | null;
    min_years_of_experience?: number | null;
    job_seniority?: string | null;
  };
}): Promise<SkillMatchResult> {
  const clippedResume = clip(input.resumeText);
  const normSkills = normalizeSkills(input.job.required_skills ?? []);
  return withCache(
    skillMatchCache,
    { resume: clippedResume, title: input.job.title, skills: normSkills },
    async () => {
      const userContent = `Job title: ${input.job.title}
Seniority: ${input.job.job_seniority ?? 'Not specified'}
Min years required: ${input.job.min_years_of_experience ?? 'Not specified'}
Required skills: ${normSkills.join(', ')}
${input.job.description ? `\nJob description:\n${clip(input.job.description, 1500)}` : ''}

=== CANDIDATE RESUME ===
${clippedResume}`;
      try {
        return await callGeminiStructuredWithFallback(
          'scoreResumeAgainstJob',
          SKILL_MATCH_SYSTEM,
          userContent,
          SkillMatchSchema,
          1024,
        );
      } catch {
        return scoreResumeAgainstJobRuleBased({ ...input, resumeText: clippedResume });
      }
    },
  );
}

// ---------------------------------------------------------------------------
// Job copilot — conversational Q&A about a specific role
// ---------------------------------------------------------------------------

const JOB_COPILOT_SYSTEM = `You are a concise, expert job-search copilot helping a candidate evaluate ONE specific job. You have been given the full job context and, optionally, the candidate's resume.

BEHAVIOUR RULES:
1. Answer only from the provided context. If the answer isn't in the context, say "I don't have that information from the job posting" — never fabricate company facts, salaries, or processes.
2. Be specific and actionable. If the candidate asks "should I apply?", compare their resume to the JD requirements you can see.
3. Keep answers under 180 words. Use short paragraphs or a bullet list — never dense walls of text.
4. Never reveal raw salaries unless they appear explicitly in the JD.
5. If the candidate has no resume uploaded, prompt them to upload one for more personalised answers.`;

export async function jobCopilot(input: {
  question: string;
  job: {
    title: string;
    company?: string | null;
    location?: string | null;
    description?: string | null;
    required_skills?: string[] | null;
    seniority?: string | null;
  };
  resumeText?: string | null;
}): Promise<string> {
  const jobBlock = [
    `Job: ${input.job.title}`,
    input.job.company ? `Company: ${input.job.company}` : '',
    input.job.location ? `Location: ${input.job.location}` : '',
    input.job.seniority ? `Seniority: ${input.job.seniority}` : '',
    input.job.required_skills?.length
      ? `Required skills: ${normalizeSkills(input.job.required_skills).join(', ')}`
      : '',
    input.job.description ? `\nJD:\n${clip(input.job.description)}` : '',
  ]
    .filter(Boolean)
    .join('\n');

  const resumeBlock = input.resumeText?.trim()
    ? `\n\n=== CANDIDATE RESUME ===\n${clip(input.resumeText)}`
    : '\n\n(No resume on file — answer from the job context and note where a resume would help.)';

  const userContent = `${jobBlock}${resumeBlock}\n\n=== CANDIDATE QUESTION ===\n${input.question}`;
  const text = await callGroqTextWithFallback('jobCopilot', JOB_COPILOT_SYSTEM, userContent, 600);
  return text || 'Unable to generate an answer. Try rephrasing your question.';
}

// ---------------------------------------------------------------------------
// Lesson coach — conversational tutor grounded in ONE training lesson
// ---------------------------------------------------------------------------

const LESSON_COACH_SYSTEM = `You are a patient, encouraging learning coach helping a student understand ONE specific training lesson. You have been given the full lesson content.

BEHAVIOUR RULES:
1. Answer ONLY from the lesson content provided. If the answer isn't in the lesson, say "That isn't covered in this lesson." — never invent facts, definitions, examples, or outside information.
2. Be clear and encouraging. Explain concepts in plain language; use analogies drawn only from the lesson where helpful.
3. Keep answers under 180 words. Use short paragraphs or a bullet list — never dense walls of text.
4. If the student asks something adjacent to the lesson, point them to the relevant part of the lesson rather than guessing.
5. Stay on-topic — politely decline questions unrelated to learning this lesson.`;

export async function lessonCoach(input: {
  question: string;
  lesson: {
    title: string;
    description?: string | null;
    content?: string | null;
    practical_example?: string | null;
    key_takeaways?: string[] | null;
  };
  courseTitle?: string | null;
}): Promise<string> {
  const lessonBlock = [
    `Lesson: ${input.lesson.title}`,
    input.courseTitle ? `Course: ${input.courseTitle}` : '',
    input.lesson.description ? `Summary: ${input.lesson.description}` : '',
    input.lesson.content ? `\n=== LESSON CONTENT ===\n${clip(input.lesson.content)}` : '',
    input.lesson.practical_example
      ? `\n=== WORKED EXAMPLE ===\n${clip(input.lesson.practical_example, 2_000)}`
      : '',
    input.lesson.key_takeaways?.length
      ? `\n=== KEY TAKEAWAYS ===\n${input.lesson.key_takeaways.map((t) => `- ${t}`).join('\n')}`
      : '',
  ]
    .filter(Boolean)
    .join('\n');

  const userContent = `${lessonBlock}\n\n=== STUDENT QUESTION ===\n${input.question}`;
  const text = await callGroqTextWithFallback('lessonCoach', LESSON_COACH_SYSTEM, userContent, 600);
  return text || 'Unable to generate an answer. Try rephrasing your question.';
}

// ---------------------------------------------------------------------------
// Resume tailoring — "Fix My Resume" fast path
// ---------------------------------------------------------------------------

const TailoredResumeSchema = z.object({
  tailored_resume_markdown: z.string(),
  changes_summary: z.array(z.string()),
  keywords_added: z.array(z.string()),
  sections_modified: z.array(z.string()),
  estimated_match_score: z.number(),
});
export type TailoredResumeResult = z.infer<typeof TailoredResumeSchema>;

const TAILOR_RESUME_SYSTEM = `You are the world's foremost ATS-optimisation expert and senior technical recruiter. Your task is to rewrite a consultant's resume so it scores 90 %+ against a specific job while remaining 100 % truthful.

=== SECTION-BY-SECTION STRATEGY ===

SUMMARY (always rewrite):
Line 1: Job title (use JD's exact title) + total years experience.
Line 2: Top 3–4 required skills from the JD that exist in the resume.
Line 3: One quantified achievement (numbers, %, $, scale).
Line 4: Location / work-model preference (keep generic if not stated).

SKILLS (always rewrite):
• Group by category: Backend / Frontend / Cloud & DevOps / Databases / Tools.
• First category = the one with the most JD required_skills.
• Include EVERY required skill that has ANY evidence in the resume body.
• List skills with version/context where possible: "React 18", "PostgreSQL 14".
• Do NOT add skills that have no evidence.

WORK EXPERIENCE bullets (rewrite targeted bullets only):
• Structure: [Strong Verb] + [what you did] + [quantified result] + [JD keyword].
• Insert the JD keyword near the END of the bullet for natural reading + ATS weight.
• Aim for ≥2 metrics per role (numbers, %, $, user counts, latency, uptime).
• For must_haves: the term must appear in at least one bullet, not just the Skills section.

=== ATS COMPLIANCE RULES (violations lower the score) ===
1. Section headings: ONLY "Summary", "Skills", "Work Experience", "Education", "Certifications", "Projects".
2. No tables, columns, text boxes, or graphical elements.
3. Dates: "Mon YYYY" format (e.g. "Jan 2022 – Mar 2024").
4. File-safe output: pure Markdown with ## headings and - bullets.

=== KEYWORD DENSITY TARGET ===
• Each of the top-5 required skills should appear 3+ times across the full document.
• For nice_to_haves: 1 appearance each is sufficient.
• Never keyword-stuff — every occurrence must be in a real sentence.

=== TRUTHFULNESS (non-negotiable) ===
NEVER invent employers, titles, dates, degrees, certifications, or metrics.
NEVER rearrange dates to hide gaps.
Evidence re-surfacing is allowed: if an older role proves a current skill, bring it forward.

Return JSON only:
{
  "tailored_resume_markdown": "<full rewritten resume in clean Markdown>",
  "changes_summary": ["<4–8 specific bullets: what changed and why>"],
  "keywords_added": ["<verbatim list of JD keywords woven in>"],
  "sections_modified": ["<section heading names touched>"],
  "estimated_match_score": <honest 0–100; conservative when < 3 required skills had evidence>
}`;

export async function tailorResumeForJob(input: {
  resumeText: string;
  job: {
    title: string;
    company?: string | null;
    description?: string | null;
    required_skills?: string[] | null;
    must_haves?: string[] | null;
  };
  sections: string[];
  keywords: string[];
  mode?: 'polish' | 'aggressive';
}): Promise<TailoredResumeResult> {
  const normSkills = normalizeSkills(input.job.required_skills ?? []);
  const sectionList =
    input.sections.length > 0 ? input.sections.join(', ') : 'all sections that need improvement';
  const keywordList = input.keywords.length > 0 ? input.keywords.join(', ') : '(infer from JD)';

  const aggressiveAddendum =
    input.mode === 'aggressive'
      ? '\n=== AGGRESSIVE MODE ===\nRe-surface skills buried in older roles. Expand abbreviations to full JD forms. Maximise keyword density while staying truthful. Prioritise ATS score over brevity.'
      : '';

  const userContent = `=== ORIGINAL RESUME ===\n${clip(input.resumeText)}\n\n=== TARGET ROLE ===
Title: ${input.job.title}
Company: ${input.job.company ?? '(not specified)'}
Required skills (normalised): ${normSkills.join(', ') || '(see JD)'}
Must-haves: ${(input.job.must_haves ?? []).join(', ') || '(see JD)'}

JD:
${clip(input.job.description) || '(none)'}

Sections to rewrite: ${sectionList}
Keywords to weave in: ${keywordList}${aggressiveAddendum}`;

  return callGroqStructuredWithFallback(
    'tailorResumeForJob',
    TAILOR_RESUME_SYSTEM,
    userContent,
    TailoredResumeSchema,
    4096,
  );
}

// ---------------------------------------------------------------------------
// Structured tailoring — deep workspace variant with per-section diffs
// ---------------------------------------------------------------------------

const TailorEditSchema = z.object({
  section: z.string(),
  before_text: z.string().nullable(),
  after_text: z.string(),
  ai_reason: z.string(),
});

const TailorSessionSchema = z.object({
  tailored_resume_markdown: z.string(),
  ai_summary: z.string(),
  edits: z.array(TailorEditSchema),
  estimated_match_score: z.number(),
});
export type TailorSessionResult = z.infer<typeof TailorSessionSchema>;

export async function tailorResumeForJobStructured(input: {
  resumeText: string;
  job: {
    title: string;
    company?: string | null;
    description?: string | null;
    required_skills?: string[] | null;
    must_haves?: string[] | null;
  };
  sections: string[];
  keywords: string[];
}): Promise<TailorSessionResult> {
  const normSkills = normalizeSkills(input.job.required_skills ?? []);
  const sectionList =
    input.sections.length > 0 ? input.sections.join(', ') : 'all sections that need work';
  const keywordList = input.keywords.length > 0 ? input.keywords.join(', ') : '(infer from JD)';

  const structuredSystem =
    TAILOR_RESUME_SYSTEM +
    `\n\nADDITIONAL OUTPUT REQUIRED — produce a per-section diff list:
"edits": ONE entry per section changed or added. Each:
  { "section": "<heading name>", "before_text": "<original verbatim or null if new section>", "after_text": "<rewritten — wrap changed tokens in **double asterisks**>", "ai_reason": "<one concise sentence>" }
"ai_summary": one-sentence plain-English overview of the whole tailoring pass.`;

  const userContent = `=== ORIGINAL RESUME ===\n${clip(input.resumeText)}\n\n=== TARGET ROLE ===
Title: ${input.job.title}
Company: ${input.job.company ?? '(not specified)'}
Required skills (normalised): ${normSkills.join(', ') || '(see JD)'}
Must-haves: ${(input.job.must_haves ?? []).join(', ') || '(see JD)'}

JD:
${clip(input.job.description) || '(none)'}

Sections to rewrite: ${sectionList}
Keywords to weave in: ${keywordList}`;

  return callGroqStructuredWithFallback(
    'tailorResumeForJobStructured',
    structuredSystem,
    userContent,
    TailorSessionSchema,
    4096,
  );
}

// ---------------------------------------------------------------------------
// Batch job matching for the recommended-jobs feed
// ---------------------------------------------------------------------------

export const JobMatchListSchema = z.object({
  matches: z.array(
    z.object({
      job_id: z.string(),
      match_score: z.number(),
      reasons: z.array(z.string()),
    }),
  ),
});
export type JobMatchResult = z.infer<typeof JobMatchListSchema>['matches'][number];

const JOB_MATCH_SYSTEM = `You are ranking job opportunities for a specific consultant. Your scores feed directly into the consultant's recommended-jobs feed — accuracy matters more than generosity.

SCORING BANDS:
85–100 = Strong Match: most required skills are clearly evidenced; seniority fits within ±0 levels; location/remote aligns.
70–84  = Good Match: majority of required skills present; at most one seniority level off; location workable.
50–69  = Fair Match: 40–60 % skill overlap; 1–2 important gaps; seniority borderline.
<50    = Weak Match: ≤ 30 % skill coverage OR severe seniority mismatch OR hard location conflict.

SCORING RULES:
1. Trust the resume over the curated skill list — if the resume proves a skill, it's present.
2. Normalise skill names when matching: "ReactJS" === "React", "Postgres" === "PostgreSQL".
3. Partial credit: adjacent skills (Vue.js when React is required) are worth 40 % of a full match.
4. With no resume on file, score conservatively — cap at 79 and note the uncertainty.
5. reasons: 2–3 bullets citing SPECIFIC evidence ("Led Kubernetes migration at Acme Corp" not "has DevOps skills").

Return JSON only: { "matches": [{ "job_id": "...", "match_score": 0–100, "reasons": [...] }] }
Sort by match_score descending.`;

export async function matchJobsForConsultant(
  consultantProfile: {
    skills: string[];
    experienceYears: number;
    preferredLocations?: string[];
    resume_excerpt?: string;
  },
  jobs: Array<{
    id: string;
    title: string;
    required_skills?: string[];
    location?: string;
    description?: string;
  }>,
): Promise<JobMatchResult[]> {
  if (jobs.length === 0) return [];

  const normProfileSkills = normalizeSkills(consultantProfile.skills);
  const cacheKeyData = {
    skills: normProfileSkills,
    years: consultantProfile.experienceYears,
    jobs: jobs.map((j) => j.id + j.title),
  };

  return withCache(jobMatchCache, cacheKeyData, async () => {
    const jobsBlock = jobs
      .map(
        (j) =>
          `Job ID: ${j.id}
Title: ${j.title}
Location: ${j.location ?? 'Not specified'}
Required skills: ${(j.required_skills ?? []).join(', ')}
${j.description ? `Description: ${clip(j.description, 400)}` : ''}`,
      )
      .join('\n\n---\n\n');

    const userContent = `Consultant skills: ${normProfileSkills.join(', ')}
Experience: ${consultantProfile.experienceYears} years
${consultantProfile.preferredLocations?.length ? `Preferred locations: ${consultantProfile.preferredLocations.join(', ')}` : ''}
${consultantProfile.resume_excerpt ? `\nResume excerpt:\n${clip(consultantProfile.resume_excerpt, 1500)}` : ''}

=== JOBS TO RANK ===
${jobsBlock}`;

    try {
      const result = await callGeminiStructuredWithFallback(
        'matchJobsForConsultant',
        JOB_MATCH_SYSTEM,
        userContent,
        JobMatchListSchema,
        1500,
      );
      return result.matches;
    } catch {
      return matchJobsForConsultantRuleBased(consultantProfile, jobs);
    }
  });
}
