// NOTE: must be zod v4 — the Anthropic SDK's zodOutputFormat calls
// z.toJSONSchema(), a v4 API that reads schema._zod.def. v3 schemas (._def)
// throw "Cannot read properties of undefined (reading 'def')" and every
// messages.parse() call silently fails (match scoring → baseline fallback).
// zod 3.25.x ships the v4 build under the 'zod/v4' subpath.
import { z } from 'zod/v4';
import { zodOutputFormat as zodOutputFormatRaw } from '@anthropic-ai/sdk/helpers/zod';

// The SDK helper's RUNTIME uses v4's z.toJSONSchema (verified), but its
// published TYPES still target zod v3, so it rejects our v4 schemas at
// compile time. Bridge the type gap here — safe because v4 is the
// runtime-correct shape.
const zodOutputFormat = zodOutputFormatRaw as unknown as (
  schema: z.ZodType,
  name?: string,
) => ReturnType<typeof zodOutputFormatRaw>;
import {
  anthropic,
  ANTHROPIC_MODEL,
  AI_MAX_INPUT_CHARS,
  AI_MAX_JOB_DESC_CHARS,
} from '../config/anthropic';
import { logAiUsage } from './aiUsage';

/**
 * Clip free-text inputs before sending them to the model. Input tokens are the
 * dominant API cost on the hot paths (resume bodies, job descriptions, and the
 * batch job matcher), so every large free-text field is clamped to a budget.
 * Output quality is unaffected for typical-length content; only very long
 * inputs are trimmed. Budgets are env-tunable (AI_MAX_INPUT_CHARS /
 * AI_MAX_JOB_DESC_CHARS) so cost can be dialed per environment.
 */
function clip(text: string | null | undefined, max: number = AI_MAX_INPUT_CHARS): string {
  const s = text ?? '';
  return s.length > max ? s.slice(0, max) : s;
}

const ResumeScoreSchema = z.object({
  score: z.number(),
  strengths: z.array(z.string()),
  weaknesses: z.array(z.string()),
  suggestions: z.array(z.string()),
});
type ResumeScoreResult = z.infer<typeof ResumeScoreSchema>;

const AtsScoreSchema = z.object({
  score: z.number(),
  matched_keywords: z.array(z.string()),
  missing_keywords: z.array(z.string()),
  summary: z.string(),
});
type AtsScoreResult = z.infer<typeof AtsScoreSchema>;

const VendorEmailSchema = z.object({
  subject: z.string(),
  body: z.string(),
});

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

export async function scoreResume(resumeText: string): Promise<ResumeScoreResult> {
  const prompt = `You are an expert technical recruiter. Score the following resume on a 0-100 scale based on clarity, impact, quantification, skill depth, and ATS-friendliness.\n\nResume:\n${clip(resumeText)}`;

  const response = await anthropic.messages.parse({
    model: ANTHROPIC_MODEL,
    max_tokens: 4096,
    messages: [{ role: 'user', content: prompt }],
    output_config: { format: zodOutputFormat(ResumeScoreSchema) },
  });
  logAiUsage('scoreResume', ANTHROPIC_MODEL, response.usage);
  return response.parsed_output!;
}

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

export async function parseResumeProfile(resumeText: string): Promise<ResumeProfile> {
  const prompt = `Extract structured profile information from this resume. Extract ONLY what is explicitly stated — never invent data.

Resume:
${clip(resumeText)}

Rules:
- Set null for any field not clearly present in the text
- experiences: list all jobs ordered most-recent first
- skills: include both technical and soft skills as stated
- certifications: standalone certs/licenses only (not degrees)
- languages: spoken languages only (not programming languages)
- age: extract the candidate's age as an integer if explicitly stated; otherwise null`;

  const response = await anthropic.messages.parse({
    model: ANTHROPIC_MODEL,
    max_tokens: 4096,
    messages: [{ role: 'user', content: prompt }],
    output_config: { format: zodOutputFormat(ResumeProfileSchema) },
  });
  logAiUsage('parseResumeProfile', ANTHROPIC_MODEL, response.usage);
  return response.parsed_output!;
}

export async function atsScore(
  resumeText: string,
  jobDescription: string,
): Promise<AtsScoreResult> {
  const prompt = `Compare the resume below against the job description and produce an ATS match score 0-100. Identify matched keywords, missing keywords, and a 1-2 sentence summary.\n\n=== RESUME ===\n${clip(resumeText)}\n\n=== JOB DESCRIPTION ===\n${clip(jobDescription)}`;

  const response = await anthropic.messages.parse({
    model: ANTHROPIC_MODEL,
    max_tokens: 4096,
    messages: [{ role: 'user', content: prompt }],
    output_config: { format: zodOutputFormat(AtsScoreSchema) },
  });
  logAiUsage('atsScore', ANTHROPIC_MODEL, response.usage);
  return response.parsed_output!;
}

interface VendorEmailInput {
  consultantName: string;
  consultantSkills: string[];
  consultantExperienceYears: number;
  jobTitle: string;
  jobDescription?: string;
  vendorName?: string;
  recruiterName: string;
}

export async function generateVendorSubmissionEmail(
  input: VendorEmailInput,
): Promise<{ subject: string; body: string }> {
  const prompt = `Write a concise, professional vendor submission email from a recruiter introducing a consultant for a role. Friendly, confident tone, no emojis, no fluff.\n\nDetails:\n- Recruiter: ${input.recruiterName}\n- Vendor: ${input.vendorName ?? 'Hiring Manager'}\n- Consultant: ${input.consultantName} (${input.consultantExperienceYears} yrs)\n- Skills: ${input.consultantSkills.join(', ')}\n- Job: ${input.jobTitle}\n- JD: ${clip(input.jobDescription) || '(not provided)'}\n`;

  const response = await anthropic.messages.parse({
    model: ANTHROPIC_MODEL,
    max_tokens: 2048,
    messages: [{ role: 'user', content: prompt }],
    output_config: { format: zodOutputFormat(VendorEmailSchema) },
  });
  logAiUsage('generateVendorSubmissionEmail', ANTHROPIC_MODEL, response.usage);
  return response.parsed_output!;
}

/**
 * Jobright-shape structured requirement extract. Same keys their UI uses, so
 * the frontend renders consistently regardless of which API the job came from.
 */
const JobRequirementsSchema = z.object({
  // Hard match signals
  must_haves: z.array(z.string()), // pure skill / tech names
  nice_to_haves: z.array(z.string()),
  required_skills: z.array(z.string()), // de-duped, normalized skill list for matching
  min_years_of_experience: z.number().nullable(),
  job_seniority: z.string().nullable(), // "Entry" | "Mid" | "Senior" | "Lead/Staff" | "Principal" | "Manager" | "Director"
  work_model: z.string().nullable(), // "Remote" | "Hybrid" | "Onsite" | null
  work_authorization: z.array(z.string()),
  location_requirements: z.string().nullable(),

  // Human-readable bullets
  core_responsibilities: z.array(z.string()), // 4-8 bullets
  skill_summaries: z.array(z.string()), // paraphrased required-skill bullets
  benefits_summaries: z.array(z.string()),
  education_summaries: z.array(z.string()),

  // Display chips
  highlights: z.array(z.string()), // 3-5 candidate-facing positives
  recommendation_tags: z.array(z.string()), // ["H1B Sponsor Likely", "No Sponsorship", "Security Clearance", ...]
});
export type JobRequirements = z.infer<typeof JobRequirementsSchema>;

/**
 * Extract structured requirements from a job description. Designed to match
 * the shape used in the Jobright UI so the frontend renders identically.
 */
export async function extractJobRequirements(input: {
  title: string;
  description?: string | null;
  required_skills?: string[] | null;
  location?: string | null;
}): Promise<JobRequirements> {
  const prompt = `You are reading a real job posting and producing structured fields used by a job-matching UI. Identify ONLY what's explicitly stated or strongly implied — never invent. Use empty arrays / null when not stated.

Job title: ${input.title}
Existing skill tags (from feed): ${(input.required_skills ?? []).join(', ') || '(none)'}
Location: ${input.location ?? '(not provided)'}

Description:
${clip(input.description) || '(no description provided)'}

Produce:
- must_haves: hard requirements (specific technologies, certifications, degrees) — short phrases
- nice_to_haves: preferred but not required
- required_skills: clean, normalized skill names suitable for matching against a resume (e.g. "Java 8+", "Spring Boot", "React", "PostgreSQL"). 5-15 items max.
- min_years_of_experience: integer minimum years of experience, or null
- job_seniority: one of "Entry", "Mid", "Senior", "Lead/Staff", "Principal", "Manager", "Director", or null
- work_model: "Remote", "Hybrid", "Onsite", or null
- work_authorization: ["H1B Sponsor Likely", "No Sponsorship", "US Citizen", "Green Card", "Security Clearance", "Public Trust"]
- location_requirements: short string like "Hybrid - SF (3 days/week)" or null
- core_responsibilities: 4-8 short bullets describing what the role does
- skill_summaries: paraphrased required-skill bullets (e.g. "9+ years building Java microservices on Spring Boot")
- benefits_summaries: bullets — comp, equity, healthcare, PTO, remote allowance — only if mentioned
- education_summaries: e.g. "Bachelor's in CS or equivalent experience"
- highlights: 3-5 short positives a candidate would care about (e.g. "Backed by Sequoia", "Fully remote", "Strong equity")
- recommendation_tags: short chips for visa / clearance signals. Use "H1B Sponsor Likely" if the posting permits H-1B; "No Sponsorship" if explicitly excluded; "Security Clearance" if required; "Public Trust"; "Remote Friendly"; "Career Pivot Friendly"`;

  const response = await anthropic.messages.parse({
    model: ANTHROPIC_MODEL,
    max_tokens: 3072,
    messages: [{ role: 'user', content: prompt }],
    output_config: { format: zodOutputFormat(JobRequirementsSchema) },
  });
  logAiUsage('extractJobRequirements', ANTHROPIC_MODEL, response.usage);
  return response.parsed_output!;
}

/**
 * Per-skill match scoring against a consultant's resume.
 *
 * Returns 0..1 per skill, like Jobright's skillMatchingScores. Used in the
 * card's right-side match panel.
 */
const SkillMatchSchema = z.object({
  per_skill: z.array(
    z.object({
      skill: z.string(),
      score: z.number(), // 0..1
      evidence: z.string().nullable(), // short sentence from the resume that supports the score
    }),
  ),
  overall_score: z.number(), // 0..100
  rank_desc: z.string(), // "Strong Match" / "Good Match" / "Fair Match" / "Weak Match"
  feature_scores: z.object({
    seniority_match: z.number(), // 0..1
    skill_match: z.number(),
    industry_match: z.number(),
  }),
  rationale: z.array(z.string()), // 2-3 sentences explaining the score
});
export type SkillMatchResult = z.infer<typeof SkillMatchSchema>;

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
  const skills = input.job.required_skills ?? [];
  const prompt = `Score this resume against the job. Output one score 0..1 per required skill and an overall 0..100.

Resume:
${clip(input.resumeText)}

Job: ${input.job.title}
Seniority: ${input.job.job_seniority ?? 'unspecified'}
Min years experience: ${input.job.min_years_of_experience ?? 'unspecified'}
Required skills: ${skills.join(', ')}

JD:
${clip(input.job.description) || '(none)'}

Rules:
- per_skill: one entry per required skill above. score 1.0 = strong evidence; 0.5 = mentioned/adjacent; 0.0 = absent.
- evidence: a one-line quote/paraphrase from the resume justifying the score (null if 0).
- feature_scores.seniority_match: 1 if resume's years >= job min; scale down otherwise.
- feature_scores.skill_match: average of per-skill scores.
- feature_scores.industry_match: 1 if domain matches; 0.5 if adjacent; 0 if unrelated.
- overall_score: weighted blend (skill 60%, seniority 25%, industry 15%) on a 0..100 scale.
- rank_desc: "Strong Match" >=85, "Good Match" 70-84, "Fair Match" 50-69, "Weak Match" <50.
- rationale: 2-3 short sentences explaining the score from the candidate's perspective.`;

  const response = await anthropic.messages.parse({
    model: ANTHROPIC_MODEL,
    max_tokens: 2048,
    messages: [{ role: 'user', content: prompt }],
    output_config: { format: zodOutputFormat(SkillMatchSchema) },
  });
  logAiUsage('scoreResumeAgainstJob', ANTHROPIC_MODEL, response.usage);
  return response.parsed_output!;
}

// ---------------------------------------------------------------------------
// AI job copilot — Jobright "Orion"-style assistant. Answers a candidate's
// question about a specific job using the job context + (optionally) their
// resume/skills. Plain-text answer, no structured schema.
// ---------------------------------------------------------------------------
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
  const ctx = [
    `Job title: ${input.job.title}`,
    input.job.company ? `Company: ${input.job.company}` : '',
    input.job.location ? `Location: ${input.job.location}` : '',
    input.job.seniority ? `Seniority: ${input.job.seniority}` : '',
    input.job.required_skills?.length
      ? `Required skills: ${input.job.required_skills.join(', ')}`
      : '',
    input.job.description ? `Job description:\n${clip(input.job.description)}` : '',
  ]
    .filter(Boolean)
    .join('\n');
  const candidate = input.resumeText
    ? `\n\n=== CANDIDATE RESUME ===\n${clip(input.resumeText)}`
    : '\n\n(No candidate resume available — answer from the job context, and note when a resume would let you be more specific.)';

  const prompt = `You are a concise, practical job-search copilot helping a candidate evaluate and pursue ONE specific job. Use only the context provided; if something isn't in it, say so briefly rather than inventing. Keep answers under ~180 words, use short paragraphs or bullets, and be specific and actionable. Never fabricate company facts or salary.

=== JOB CONTEXT ===
${ctx}${candidate}

=== QUESTION ===
${input.question}`;

  const response = await anthropic.messages.create({
    model: ANTHROPIC_MODEL,
    max_tokens: 700,
    messages: [{ role: 'user', content: prompt }],
  });
  logAiUsage('jobCopilot', ANTHROPIC_MODEL, response.usage);
  const text = response.content
    .filter((b): b is { type: 'text'; text: string } & typeof b => b.type === 'text')
    .map((b) => b.text)
    .join('\n')
    .trim();
  return text || 'I could not generate an answer for that. Try rephrasing your question.';
}

// ---------------------------------------------------------------------------
// Resume tailoring — Jobright's "Fix My Resume" flow
//
// Takes the consultant's current resume text, the job's description + extracted
// requirements, an opt-in list of sections to rewrite, and a curated list of
// missing keywords to weave in. Returns the rewritten resume body plus a diff
// summary the recruiter can review side-by-side with the original.
// ---------------------------------------------------------------------------
const TailoredResumeSchema = z.object({
  tailored_resume_markdown: z.string(), // full rewritten resume in markdown
  changes_summary: z.array(z.string()), // 3-8 bullets describing what changed
  keywords_added: z.array(z.string()), // keywords actually woven in
  sections_modified: z.array(z.string()), // which named sections changed
  estimated_match_score: z.number(), // 0..100 — the model's own pre-score
});
export type TailoredResumeResult = z.infer<typeof TailoredResumeSchema>;

export async function tailorResumeForJob(input: {
  resumeText: string;
  job: {
    title: string;
    company?: string | null;
    description?: string | null;
    required_skills?: string[] | null;
    must_haves?: string[] | null;
  };
  sections: string[]; // ["Summary", "Skills", "Work Experience", ...]
  keywords: string[]; // recruiter-chosen missing keywords to inject
  /** "polish" (default) or "aggressive" — the iterative refinement loop
   *  passes 'aggressive' when the first attempt scored below the target. */
  mode?: 'polish' | 'aggressive';
}): Promise<TailoredResumeResult> {
  const sectionList =
    input.sections.length > 0 ? input.sections.join(', ') : 'all sections that need work';
  const keywordList =
    input.keywords.length > 0 ? input.keywords.join(', ') : '(let the model infer from the JD)';
  const skills = (input.job.required_skills ?? []).join(', ');
  const musts = (input.job.must_haves ?? []).join(', ');
  const mode = input.mode ?? 'polish';

  const prompt = `You are a senior recruiter and ATS-optimization expert. Rewrite the candidate's resume so it scores 85% or higher against the job below. Resumes scoring under 80% routinely get filtered out by ATS before a human reviews them — your goal is to push the score over 85%.

== JOB ==
Title: ${input.job.title}
Company: ${input.job.company ?? '(not specified)'}
Required skills: ${skills || '(see JD)'}
Must-haves: ${musts || '(see JD)'}

JD:
${clip(input.job.description) || '(none)'}

== ORIGINAL RESUME ==
${clip(input.resumeText)}

== TARGETING ==
Sections you may rewrite: ${sectionList}.
Keywords to weave in (only where truthful given the resume's existing evidence): ${keywordList}.

== RULES ==
1. **Truthfulness is non-negotiable.** Never invent employers, titles, dates, degrees, or credentials. Do NOT add a skill the resume gives no evidence of. If the resume says "5 years Java", do not bump it to 8. If "Spring Boot" appears anywhere — including projects — you may surface it more prominently and add it to the Skills section.
2. **Mirror the JD's exact phrasing** when the resume already supports it. ATS systems do literal keyword matching — "Spring Boot" and "Spring Framework" score differently. Use the JD's tokens verbatim.
3. **Rewrite bullets for impact + keyword density.** Replace passive bullets ("Worked on backend services") with action verb + quantified outcome + JD keywords ("Led 4-engineer team building Spring Boot microservices on AWS, cutting p99 latency from 850ms to 240ms"). Aim for 2 JD keywords per bullet on average.
4. **Surface the strongest evidence first.** If the JD asks for "8+ years Java + Kafka" and one of the roles has both, lead with that role.
5. **Skills section must include EVERY required skill that has any resume evidence.** Group them ("Backend: Java, Spring Boot, Kafka, RabbitMQ" / "Cloud: AWS, GCP, Docker, Kubernetes") so ATS picks each one up.
6. **Summary: rewrite as a 3-4 line value pitch** that name-drops the role title, total years, the top 5 JD keywords with resume evidence, and a quantified achievement. ATS systems heavily weight the top ~200 words.
${
  mode === 'aggressive'
    ? `7. **AGGRESSIVE MODE (retry — previous pass scored below target):** Be more assertive: re-surface evidence buried in older roles, expand abbreviations to their full keyword form ("k8s" → "Kubernetes (k8s)"), and tighten every bullet that doesn't name at least one JD keyword. Maximum keyword density while still being truthful.`
    : ''
}

== OUTPUT ==
- tailored_resume_markdown: FULL rewritten resume in clean markdown. Use \`##\` for section headings (Summary, Skills, Experience, Projects, Certifications, Education). Use \`-\` for bullets. Do NOT add prose outside the resume body.
- changes_summary: 4–8 concrete bullets ("Added Spring Boot + Spring MVC to Skills line", "Rewrote Lead Engineer @ Acme bullet to lead with Java + Kafka + AWS", "Quantified p99 latency improvement in Stripe role").
- keywords_added: keywords actually woven into the final resume (verbatim).
- sections_modified: section heading names you touched.
- estimated_match_score: honest 0–100 estimate. Be conservative — if fewer than 3 required skills had truthful evidence to surface, score under 75 even if the writing improved.`;

  const response = await anthropic.messages.parse({
    model: ANTHROPIC_MODEL,
    max_tokens: 8192,
    messages: [{ role: 'user', content: prompt }],
    output_config: { format: zodOutputFormat(TailoredResumeSchema) },
  });
  logAiUsage('tailorResumeForJob', ANTHROPIC_MODEL, response.usage);
  return response.parsed_output!;
}

// ---------------------------------------------------------------------------
// Structured resume tailoring — the deep "tailoring workspace" variant.
//
// Unlike tailorResumeForJob (which returns a flat changes_summary), this
// returns a reviewable per-SECTION edit list: each entry carries the original
// section text (before_text — null when the section is brand new), the
// rewritten text (after_text, with **bold** markers around the keywords/tokens
// that changed), and a one-line AI rationale. The workspace renders one diff
// card per edit, and "apply" materializes the accepted subset.
// ---------------------------------------------------------------------------
const TailorEditSchema = z.object({
  section: z.string(), // section heading, e.g. "Summary", "Skills", "Experience — Acme"
  before_text: z.string().nullable(), // null when this section did not exist before
  after_text: z.string(), // rewritten section; wrap changed tokens in **bold**
  ai_reason: z.string(), // one-line rationale for the change
});

const TailorSessionSchema = z.object({
  tailored_resume_markdown: z.string(), // full rewritten resume in markdown
  ai_summary: z.string(), // 1-2 sentence plain-English summary of the whole pass
  edits: z.array(TailorEditSchema), // one entry per section that changed or was added
  estimated_match_score: z.number(), // 0..100 — model's own pre-score
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
  const sectionList =
    input.sections.length > 0 ? input.sections.join(', ') : 'all sections that need work';
  const keywordList =
    input.keywords.length > 0 ? input.keywords.join(', ') : '(let the model infer from the JD)';
  const skills = (input.job.required_skills ?? []).join(', ');
  const musts = (input.job.must_haves ?? []).join(', ');

  const prompt = `You are a senior recruiter and ATS-optimization expert. Rewrite the candidate's resume so it scores 85%+ against the job below, then produce a SECTION-BY-SECTION edit list a reviewer can accept or reject one change at a time.

== JOB ==
Title: ${input.job.title}
Company: ${input.job.company ?? '(not specified)'}
Required skills: ${skills || '(see JD)'}
Must-haves: ${musts || '(see JD)'}

JD:
${clip(input.job.description) || '(none)'}

== ORIGINAL RESUME ==
${clip(input.resumeText)}

== TARGETING ==
Sections you may rewrite: ${sectionList}.
Keywords to weave in (only where truthful given the resume's existing evidence): ${keywordList}.

== RULES ==
1. **Truthfulness is non-negotiable.** Never invent employers, titles, dates, degrees, or credentials, and never add a skill the resume gives no evidence of.
2. **Mirror the JD's exact phrasing** for keywords the resume already supports — ATS does literal matching.
3. **Rewrite bullets for impact + keyword density**: action verb + quantified outcome + JD keywords.
4. **Skills section must list every required skill that has resume evidence**, grouped so ATS picks each one up.
5. **Summary**: a 3-4 line value pitch naming the role title, total years, top JD keywords with evidence, and a quantified win.

== OUTPUT ==
- tailored_resume_markdown: FULL rewritten resume in clean markdown (\`##\` headings, \`-\` bullets). No prose outside the resume body.
- ai_summary: 1-2 sentences, plain English, summarizing the whole tailoring pass (e.g. "Surfaced Kafka + AWS evidence into the Summary and Skills, and quantified two backend roles to lift keyword coverage.").
- edits: ONE entry per section you changed or added. For each:
    - section: the section heading (e.g. "Summary", "Skills", "Experience — Acme Corp").
    - before_text: the original text of that section verbatim, or null if the section did not exist before.
    - after_text: the rewritten section. Wrap the specific tokens/keywords you added or changed in **double asterisks** so the reviewer sees exactly what moved.
    - ai_reason: one line explaining why (e.g. "Added Spring Boot + Kafka to match 2 must-haves with resume evidence").
- estimated_match_score: honest 0-100 estimate; be conservative when fewer than 3 required skills had truthful evidence to surface.`;

  const response = await anthropic.messages.parse({
    model: ANTHROPIC_MODEL,
    max_tokens: 8192,
    messages: [{ role: 'user', content: prompt }],
    output_config: { format: zodOutputFormat(TailorSessionSchema) },
  });
  logAiUsage('tailorResumeForJobStructured', ANTHROPIC_MODEL, response.usage);
  return response.parsed_output!;
}

export async function matchJobsForConsultant(
  consultantProfile: {
    skills: string[];
    experienceYears: number;
    preferredLocations?: string[];
    /** Plain-text resume excerpt — when present, the model uses it as the
     *  primary matching signal (extracting actual tech/experience from it)
     *  instead of relying on the skills keyword list alone. */
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

  const hasResume =
    !!consultantProfile.resume_excerpt && consultantProfile.resume_excerpt.trim().length > 0;
  // Cost control: this is the hottest AI path (recommended feed, many jobs per
  // call). Send only the fields needed to rank, and clip each description hard
  // — title + required_skills carry most of the matching signal. Without this
  // the prompt balloons with N full job descriptions of input tokens.
  const slimJobs = jobs.map((j) => ({
    id: j.id,
    title: j.title,
    required_skills: j.required_skills ?? [],
    location: j.location ?? null,
    description: clip(j.description, AI_MAX_JOB_DESC_CHARS),
  }));
  const skillsBlock =
    consultantProfile.skills.length > 0
      ? consultantProfile.skills.join(', ')
      : '(none listed — derive skills from the resume below)';

  const prompt = `You are ranking jobs for a specific consultant. Score each job on a 0-100 scale and produce a sorted list.

== CONSULTANT ==
Skills (recruiter-curated): ${skillsBlock}
Years of experience: ${consultantProfile.experienceYears}
Preferred locations: ${(consultantProfile.preferredLocations ?? []).join(', ') || '(any)'}
${
  hasResume
    ? `\n== RESUME (primary source of truth — extract actual technologies, frameworks, domains, and years from this) ==\n${clip(consultantProfile.resume_excerpt)}\n`
    : '\n(No resume on file — use the curated skills list above as the primary signal.)\n'
}
== JOBS ==
${JSON.stringify(slimJobs)}

== INSTRUCTIONS ==
For EACH job above, output a match entry with:
- job_id: the job's id (verbatim)
- match_score: 0-100 (integer or one decimal). Higher = stronger fit.
  - 85+ = strong match: most required skills evidenced in resume / skills list, seniority fits.
  - 70-84 = good match: majority of required skills present, seniority within ±1.
  - 50-69 = fair match: some overlap, gaps in 2-4 required skills.
  - <50  = weak match: ≤30% of required skills present or seniority mismatch.
- reasons: 2-3 short bullets citing SPECIFIC evidence (e.g. "9 years Java + Spring Boot in resume", "Required AWS — resume mentions AWS at Acme", "JD asks for 8+ years; resume shows 11"). Be concrete, not generic.

${
  hasResume
    ? 'IMPORTANT: When scoring, trust the resume over the curated skills list. If the resume shows React but skills list does not, count React as present. Do not fabricate skills that are not in the resume.'
    : 'IMPORTANT: With no resume, score conservatively — match strictly against the curated skill keywords.'
}

Return matches sorted by match_score descending. Include every job in the list (don't drop low matches).`;

  const response = await anthropic.messages.parse({
    model: ANTHROPIC_MODEL,
    max_tokens: 8192,
    messages: [{ role: 'user', content: prompt }],
    output_config: { format: zodOutputFormat(JobMatchListSchema) },
  });
  logAiUsage('matchJobsForConsultant', ANTHROPIC_MODEL, response.usage);
  return response.parsed_output!.matches;
}
