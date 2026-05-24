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
import {
  anthropic,
  ANTHROPIC_MODEL,
  AI_MAX_INPUT_CHARS,
  AI_MAX_JOB_DESC_CHARS,
} from '../config/anthropic';
import { logAiUsage } from './aiUsage';
import {
  withCache,
  resumeScoreCache,
  resumeProfileCache,
  jobRequirementsCache,
  skillMatchCache,
  atsScoreCache,
  jobMatchCache,
} from './aiCache';
import { normalizeSkills, diffSkills, extractKnownSkills } from './skillNorm';
import { logger } from '../config/logger';

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
// Resume scoring — rubric-based, 5 dimensions × 20 pts
// ---------------------------------------------------------------------------

const ResumeScoreSchema = z.object({
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
  return withCache(resumeScoreCache, clipped, () =>
    callStructured(
      'scoreResume',
      SCORE_RESUME_SYSTEM,
      [cacheableBlock(`RESUME TO SCORE:\n\n${clipped}`)],
      ResumeScoreSchema,
      800,
    ),
  );
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

const ResumeProfileSchema = z.object({
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

const PARSE_PROFILE_SYSTEM = `You are a precise data-extraction engine for resumes. Extract ONLY what is explicitly stated — never infer, guess, or fabricate. When a field isn't present, use null or an empty array.

EXTRACTION RULES:
- skills: Extract ALL technical and soft skills mentioned anywhere in the resume. Include programming languages, frameworks, tools, certifications, and methodologies. Normalise obvious abbreviations ("JS" → "JavaScript", "K8s" → "Kubernetes") but keep less obvious ones verbatim.
- total_years_experience: Sum work experience years. If current, count to today. Round to nearest 0.5.
- linkedin_url: Accept any URL containing "linkedin.com/in/".
- experiences: Sort most-recent first. description: include the full content of role bullets as a single string.
- age: Only if explicitly stated as a number (not inferred from graduation year).

Return valid JSON matching the schema. No markdown, no explanation.`;

export async function parseResumeProfile(resumeText: string): Promise<ResumeProfile> {
  const clipped = clip(resumeText);
  return withCache(resumeProfileCache, clipped, async () => {
    const raw = await callStructured(
      'parseResumeProfile',
      PARSE_PROFILE_SYSTEM,
      [
        cacheableBlock(`RESUME:\n\n${clipped}`),
        {
          type: 'text',
          text: `Fields: name, email, phone, location, linkedin_url, website, summary, total_years_experience, age, skills (string[]), experiences ({ company, title, start_date, end_date, is_current, description }[]), education ({ institution, degree, field, graduation_year }[]), certifications (string[]), languages (string[])`,
        },
      ],
      ResumeProfileSchema,
      1500,
    );
    // Normalise extracted skills before returning so downstream consumers get clean labels.
    return { ...raw, skills: normalizeSkills(raw.skills) };
  });
}

// ---------------------------------------------------------------------------
// ATS keyword score vs a job description
// ---------------------------------------------------------------------------

export const AtsScoreSchema = z.object({
  score: z.number(),
  matched_keywords: z.array(z.string()),
  missing_keywords: z.array(z.string()),
  summary: z.string(),
});
export type AtsScoreResult = z.infer<typeof AtsScoreSchema>;

/**
 * Keyword-based ATS scorer — no AI call required.
 *
 * Strategy: scan both the JD and the resume for any skill that appears in
 * the canonical alias table (skillNorm.ts). Compare the two sets. The score
 * is (matched / jdSkills) × 100. This is fast, deterministic, free, and
 * cached — identical inputs skip even the CPU work.
 */
export async function atsScore(
  resumeText: string,
  jobDescription: string,
): Promise<AtsScoreResult> {
  const clippedResume = clip(resumeText);
  const clippedJd = clip(jobDescription);

  return withCache(atsScoreCache, { r: clippedResume, jd: clippedJd }, async () => {
    const jdSkills = extractKnownSkills(clippedJd);
    const resumeSkillSet = new Set(extractKnownSkills(clippedResume).map((s) => s.toLowerCase()));

    const matched: string[] = [];
    const missing: string[] = [];
    for (const skill of jdSkills) {
      if (resumeSkillSet.has(skill.toLowerCase())) {
        matched.push(skill);
      } else {
        missing.push(skill);
      }
    }

    const total = jdSkills.length || 1;
    const score = Math.round((matched.length / total) * 100);

    const gapPhrase =
      missing.length === 0
        ? 'All identified technical requirements are covered.'
        : `Key gaps: ${missing.slice(0, 3).join(', ')}${missing.length > 3 ? ` and ${missing.length - 3} more` : ''}.`;

    const summary = `Resume matches ${matched.length} of ${total} technical skills detected in the job description. ${gapPhrase}`;

    return { score, matched_keywords: matched, missing_keywords: missing, summary };
  });
}

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

  return callStructured(
    'generateVendorSubmissionEmail',
    VENDOR_EMAIL_SYSTEM,
    `Recruiter: ${input.recruiterName}
Vendor / hiring manager: ${input.vendorName ?? 'Hiring Team'}
Consultant: ${input.consultantName} — ${input.consultantExperienceYears} years total experience
Top skills: ${skills}
Target role: ${input.jobTitle}${jdContext}`,
    VendorEmailSchema,
    700,
  );
}

// ---------------------------------------------------------------------------
// Job requirements extraction
// ---------------------------------------------------------------------------

const JobRequirementsSchema = z.object({
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

const EXTRACT_JOB_SYSTEM = `You are parsing a job posting to produce structured fields for a candidate-matching UI. Extract ONLY what is explicitly stated or strongly implied — never invent or assume.

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
  return withCache(jobRequirementsCache, { title: input.title, desc: clippedDesc }, async () => {
    const raw = await callStructured(
      'extractJobRequirements',
      EXTRACT_JOB_SYSTEM,
      [
        {
          type: 'text',
          text: `Job title: ${input.title}\nLocation: ${input.location ?? '(not provided)'}\nExisting skill tags: ${(input.required_skills ?? []).join(', ') || '(none)'}`,
        },
        cacheableBlock(`Job description:\n${clippedDesc || '(no description provided)'}`),
      ],
      JobRequirementsSchema,
      1200,
    );
    return { ...raw, required_skills: normalizeSkills(raw.required_skills) };
  });
}

// ---------------------------------------------------------------------------
// Per-skill match scoring  (resume vs job)
// ---------------------------------------------------------------------------

const SkillMatchSchema = z.object({
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
  const clippedJd = clip(input.job.description);
  // Normalise required skills before passing to the model so "ReactJS" and
  // "React" don't generate two separate scoring rows.
  const normSkills = normalizeSkills(input.job.required_skills ?? []);

  return withCache(
    skillMatchCache,
    { resume: clippedResume, title: input.job.title, skills: normSkills },
    () =>
      callStructured(
        'scoreResumeAgainstJob',
        SKILL_MATCH_SYSTEM,
        [
          cacheableBlock(`RESUME:\n${clippedResume}`),
          {
            type: 'text',
            text: `JOB: ${input.job.title}
Seniority: ${input.job.job_seniority ?? 'unspecified'}
Min experience: ${input.job.min_years_of_experience ?? 'unspecified'} years
Required skills (normalised): ${normSkills.join(', ') || '(see JD)'}
JD:
${clippedJd || '(none)'}`,
          },
        ],
        SkillMatchSchema,
        1600,
      ),
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
  const text = await callText('jobCopilot', JOB_COPILOT_SYSTEM, userContent, 600);
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

  return callStructured(
    'tailorResumeForJob',
    TAILOR_RESUME_SYSTEM,
    [
      cacheableBlock(`=== ORIGINAL RESUME ===\n${clip(input.resumeText)}`),
      {
        type: 'text',
        text: `=== TARGET ROLE ===
Title: ${input.job.title}
Company: ${input.job.company ?? '(not specified)'}
Required skills (normalised): ${normSkills.join(', ') || '(see JD)'}
Must-haves: ${(input.job.must_haves ?? []).join(', ') || '(see JD)'}

JD:
${clip(input.job.description) || '(none)'}

Sections to rewrite: ${sectionList}
Keywords to weave in: ${keywordList}${aggressiveAddendum}`,
      },
    ],
    TailoredResumeSchema,
    3500,
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

  return callStructured(
    'tailorResumeForJobStructured',
    TAILOR_RESUME_SYSTEM +
      `\n\nADDITIONAL OUTPUT REQUIRED — produce a per-section diff list:
"edits": ONE entry per section changed or added. Each:
  { "section": "<heading name>", "before_text": "<original verbatim or null if new section>", "after_text": "<rewritten — wrap changed tokens in **double asterisks**>", "ai_reason": "<one concise sentence>" }
"ai_summary": one-sentence plain-English overview of the whole tailoring pass.`,
    [
      cacheableBlock(`=== ORIGINAL RESUME ===\n${clip(input.resumeText)}`),
      {
        type: 'text',
        text: `=== TARGET ROLE ===
Title: ${input.job.title}
Company: ${input.job.company ?? '(not specified)'}
Required skills (normalised): ${normSkills.join(', ') || '(see JD)'}
Must-haves: ${(input.job.must_haves ?? []).join(', ') || '(see JD)'}

JD:
${clip(input.job.description) || '(none)'}

Sections to rewrite: ${sectionList}
Keywords to weave in: ${keywordList}`,
      },
    ],
    TailorSessionSchema,
    4096,
  );
}

// ---------------------------------------------------------------------------
// Batch job matching for the recommended-jobs feed
// ---------------------------------------------------------------------------

const JobMatchListSchema = z.object({
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
  const hasResume =
    !!consultantProfile.resume_excerpt && consultantProfile.resume_excerpt.trim().length > 50;

  const slimJobs = jobs.map((j) => ({
    id: j.id,
    title: j.title,
    required_skills: normalizeSkills(j.required_skills ?? []),
    location: j.location ?? null,
    description: clip(j.description, AI_MAX_JOB_DESC_CHARS),
  }));

  // Pre-compute skill diffs deterministically so the model has pre-normalised data.
  const jobContextLines = slimJobs.map((j) => {
    const { matched, missing } = diffSkills(j.required_skills, normProfileSkills);
    return `${JSON.stringify({ ...j, _matched: matched.length, _missing: missing.length })}`;
  });

  const cacheKeyData = {
    skills: normProfileSkills,
    years: consultantProfile.experienceYears,
    jobs: slimJobs.map((j) => j.id + j.title),
  };

  const result = await withCache(jobMatchCache, cacheKeyData, () =>
    callStructured(
      'matchJobsForConsultant',
      JOB_MATCH_SYSTEM,
      [
        hasResume
          ? cacheableBlock(`=== CONSULTANT RESUME ===\n${clip(consultantProfile.resume_excerpt!)}`)
          : ({
              type: 'text',
              text: '(No resume on file — score against curated skills only, cap at 79)',
            } as TextBlockParam),
        {
          type: 'text',
          text: `=== CONSULTANT PROFILE ===
Skills (normalised): ${normProfileSkills.join(', ') || '(none listed)'}
Years of experience: ${consultantProfile.experienceYears}
Preferred locations: ${(consultantProfile.preferredLocations ?? []).join(', ') || '(any / flexible)'}

=== JOBS TO RANK ===
${jobContextLines.join('\n')}`,
        },
      ],
      JobMatchListSchema,
      900,
    ),
  );
  return result.matches;
}
