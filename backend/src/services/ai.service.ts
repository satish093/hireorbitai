import { z } from 'zod/v4';
import {
  anthropic,
  ANTHROPIC_MODEL,
  AI_MAX_INPUT_CHARS,
  AI_MAX_JOB_DESC_CHARS,
} from '../config/anthropic';
import { logAiUsage } from './aiUsage';

function clip(text: string | null | undefined, max: number = AI_MAX_INPUT_CHARS): string {
  const s = text ?? '';
  return s.length > max ? s.slice(0, max) : s;
}

function usage(response: { usage: { input_tokens: number; output_tokens: number } }) {
  return { input_tokens: response.usage.input_tokens, output_tokens: response.usage.output_tokens };
}

async function anthropicParse<T extends z.ZodType>(
  call: string,
  prompt: string,
  schema: T,
  maxTokens = 1024,
): Promise<z.infer<T>> {
  const response = await anthropic.messages.create({
    model: ANTHROPIC_MODEL,
    max_tokens: maxTokens,
    system: 'Output valid JSON only. No markdown fences, no explanation.',
    messages: [{ role: 'user', content: prompt }],
  });
  const raw = response.content[0].type === 'text' ? response.content[0].text.trim() : '{}';
  // Strip markdown code fences that Claude occasionally adds despite the system prompt.
  const text = raw.replace(/^```(?:json)?\s*/i, '').replace(/\s*```\s*$/, '');
  logAiUsage(call, ANTHROPIC_MODEL, usage(response));
  return schema.parse(JSON.parse(text)) as z.infer<T>;
}

async function anthropicText(call: string, prompt: string, maxTokens = 600): Promise<string> {
  const response = await anthropic.messages.create({
    model: ANTHROPIC_MODEL,
    max_tokens: maxTokens,
    messages: [{ role: 'user', content: prompt }],
  });
  const text = response.content[0].type === 'text' ? response.content[0].text.trim() : '';
  logAiUsage(call, ANTHROPIC_MODEL, usage(response));
  return text;
}

// ---------------------------------------------------------------------------
// Resume scoring
// ---------------------------------------------------------------------------

const ResumeScoreSchema = z.object({
  score: z.number(),
  strengths: z.array(z.string()),
  weaknesses: z.array(z.string()),
  suggestions: z.array(z.string()),
});
type ResumeScoreResult = z.infer<typeof ResumeScoreSchema>;

export async function scoreResume(resumeText: string): Promise<ResumeScoreResult> {
  return anthropicParse(
    'scoreResume',
    `You are an expert technical recruiter. Score the following resume on a 0-100 scale based on clarity, impact, quantification, skill depth, and ATS-friendliness. Return JSON with: score (number), strengths (string[]), weaknesses (string[]), suggestions (string[]).

Resume:
${clip(resumeText)}`,
    ResumeScoreSchema,
    512,
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

export async function parseResumeProfile(resumeText: string): Promise<ResumeProfile> {
  return anthropicParse(
    'parseResumeProfile',
    `Extract structured profile information from this resume. Extract ONLY what is explicitly stated — never invent data. Return JSON matching the exact field names below.

Resume:
${clip(resumeText)}

Fields to extract:
- name: full name or null
- email: email address or null
- phone: phone number or null
- location: city/state/country or null
- linkedin_url: LinkedIn profile URL or null
- website: personal site URL or null
- summary: professional summary paragraph or null
- total_years_experience: total years of work experience as a number or null
- age: candidate's age as an integer if explicitly stated; otherwise null
- skills: array of all technical and soft skills mentioned
- experiences: array of jobs, most-recent first. Each: { company, title, start_date, end_date, is_current (bool), description }
- education: array of { institution, degree, field, graduation_year }
- certifications: array of standalone cert/license names (not degrees)
- languages: array of spoken language names (not programming languages)

Set null (not empty string) for any field not clearly present.`,
    ResumeProfileSchema,
    1200,
  );
}

// ---------------------------------------------------------------------------
// ATS score against a job description
// ---------------------------------------------------------------------------

const AtsScoreSchema = z.object({
  score: z.number(),
  matched_keywords: z.array(z.string()),
  missing_keywords: z.array(z.string()),
  summary: z.string(),
});
type AtsScoreResult = z.infer<typeof AtsScoreSchema>;

export async function atsScore(
  resumeText: string,
  jobDescription: string,
): Promise<AtsScoreResult> {
  return anthropicParse(
    'atsScore',
    `Compare the resume below against the job description and produce an ATS match score 0-100. Return JSON with: score (number 0-100), matched_keywords (string[]), missing_keywords (string[]), summary (1-2 sentence string).

=== RESUME ===
${clip(resumeText)}

=== JOB DESCRIPTION ===
${clip(jobDescription)}`,
    AtsScoreSchema,
    512,
  );
}

// ---------------------------------------------------------------------------
// Vendor submission email
// ---------------------------------------------------------------------------

const VendorEmailSchema = z.object({
  subject: z.string(),
  body: z.string(),
});

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
  return anthropicParse(
    'generateVendorSubmissionEmail',
    `Write a concise, professional vendor submission email from a recruiter introducing a consultant for a role. Friendly, confident tone, no emojis, no fluff. Return JSON with: subject (string), body (string).

Details:
- Recruiter: ${input.recruiterName}
- Vendor: ${input.vendorName ?? 'Hiring Manager'}
- Consultant: ${input.consultantName} (${input.consultantExperienceYears} yrs)
- Skills: ${input.consultantSkills.join(', ')}
- Job: ${input.jobTitle}
- JD: ${clip(input.jobDescription) || '(not provided)'}`,
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

export async function extractJobRequirements(input: {
  title: string;
  description?: string | null;
  required_skills?: string[] | null;
  location?: string | null;
}): Promise<JobRequirements> {
  return anthropicParse(
    'extractJobRequirements',
    `You are reading a real job posting and producing structured fields used by a job-matching UI. Identify ONLY what's explicitly stated or strongly implied — never invent. Use empty arrays / null when not stated. Return JSON with the exact field names listed.

Job title: ${input.title}
Existing skill tags (from feed): ${(input.required_skills ?? []).join(', ') || '(none)'}
Location: ${input.location ?? '(not provided)'}

Description:
${clip(input.description) || '(no description provided)'}

Fields to return:
- must_haves: hard requirements (specific technologies, certifications, degrees) — short phrases
- nice_to_haves: preferred but not required
- required_skills: clean, normalized skill names for matching (e.g. "Java 8+", "Spring Boot", "React"). 5-15 items max.
- min_years_of_experience: integer or null
- job_seniority: one of "Entry", "Mid", "Senior", "Lead/Staff", "Principal", "Manager", "Director", or null
- work_model: "Remote", "Hybrid", "Onsite", or null
- work_authorization: array from ["H1B Sponsor Likely", "No Sponsorship", "US Citizen", "Green Card", "Security Clearance", "Public Trust"]
- location_requirements: short string like "Hybrid - SF (3 days/week)" or null
- core_responsibilities: 4-8 short bullets describing what the role does
- skill_summaries: paraphrased required-skill bullets
- benefits_summaries: comp/equity/healthcare/PTO bullets (only if mentioned)
- education_summaries: e.g. "Bachelor's in CS or equivalent experience"
- highlights: 3-5 short positives a candidate would care about
- recommendation_tags: short chips for visa/clearance signals`,
    JobRequirementsSchema,
    1024,
  );
}

// ---------------------------------------------------------------------------
// Per-skill match scoring
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
  return anthropicParse(
    'scoreResumeAgainstJob',
    `Score this resume against the job. Return JSON with exact field names.

Resume:
${clip(input.resumeText)}

Job: ${input.job.title}
Seniority: ${input.job.job_seniority ?? 'unspecified'}
Min years experience: ${input.job.min_years_of_experience ?? 'unspecified'}
Required skills: ${skills.join(', ')}

JD:
${clip(input.job.description) || '(none)'}

Fields to return:
- per_skill: one entry per required skill. Each: { skill, score (0..1, where 1=strong evidence 0.5=adjacent 0=absent), evidence (one-line quote/paraphrase or null if 0) }
- overall_score: weighted blend (skill 60%, seniority 25%, industry 15%) on 0..100 scale
- rank_desc: "Strong Match" (>=85), "Good Match" (70-84), "Fair Match" (50-69), "Weak Match" (<50)
- feature_scores: { seniority_match (0..1), skill_match (avg of per_skill), industry_match (0..1) }
- rationale: 2-3 short sentences from the candidate's perspective`,
    SkillMatchSchema,
    1024,
  );
}

// ---------------------------------------------------------------------------
// Job copilot — plain text answer about a specific job
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

  const text = await anthropicText('jobCopilot', prompt, 600);
  return text || 'I could not generate an answer for that. Try rephrasing your question.';
}

// ---------------------------------------------------------------------------
// Resume tailoring — "Fix My Resume" flow
// ---------------------------------------------------------------------------

const TailoredResumeSchema = z.object({
  tailored_resume_markdown: z.string(),
  changes_summary: z.array(z.string()),
  keywords_added: z.array(z.string()),
  sections_modified: z.array(z.string()),
  estimated_match_score: z.number(),
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
  sections: string[];
  keywords: string[];
  mode?: 'polish' | 'aggressive';
}): Promise<TailoredResumeResult> {
  const sectionList =
    input.sections.length > 0 ? input.sections.join(', ') : 'all sections that need work';
  const keywordList =
    input.keywords.length > 0 ? input.keywords.join(', ') : '(let the model infer from the JD)';
  const skills = (input.job.required_skills ?? []).join(', ');
  const musts = (input.job.must_haves ?? []).join(', ');
  const mode = input.mode ?? 'polish';

  return anthropicParse(
    'tailorResumeForJob',
    `You are a senior recruiter and ATS-optimization expert. Rewrite the candidate's resume so it scores 85% or higher against the job below. Return JSON with exact field names.

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
1. Truthfulness is non-negotiable. Never invent employers, titles, dates, degrees, or credentials.
2. Mirror the JD's exact phrasing for keywords the resume already supports — ATS does literal matching.
3. Rewrite bullets for impact + keyword density: action verb + quantified outcome + JD keywords.
4. Skills section must include every required skill that has resume evidence.
5. Summary: 3-4 line value pitch naming role title, total years, top JD keywords, and a quantified win.
${
  mode === 'aggressive'
    ? '6. AGGRESSIVE MODE: Re-surface evidence buried in older roles, expand abbreviations to full keyword form, and tighten every bullet. Maximum keyword density while still truthful.'
    : ''
}

== FIELDS TO RETURN ==
- tailored_resume_markdown: FULL rewritten resume in clean markdown (## headings, - bullets)
- changes_summary: 4-8 concrete bullets describing specific changes made
- keywords_added: keywords actually woven into the final resume (verbatim)
- sections_modified: section heading names you touched
- estimated_match_score: honest 0-100 estimate (conservative if fewer than 3 required skills had evidence)`,
    TailoredResumeSchema,
    2048,
  );
}

// ---------------------------------------------------------------------------
// Structured resume tailoring — deep workspace variant with per-section edits
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
  const sectionList =
    input.sections.length > 0 ? input.sections.join(', ') : 'all sections that need work';
  const keywordList =
    input.keywords.length > 0 ? input.keywords.join(', ') : '(let the model infer from the JD)';
  const skills = (input.job.required_skills ?? []).join(', ');
  const musts = (input.job.must_haves ?? []).join(', ');

  return anthropicParse(
    'tailorResumeForJobStructured',
    `You are a senior recruiter and ATS-optimization expert. Rewrite the candidate's resume so it scores 85%+ against the job below, then produce a SECTION-BY-SECTION edit list a reviewer can accept or reject one change at a time. Return JSON with exact field names.

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
Keywords to weave in (only where truthful): ${keywordList}.

== RULES ==
1. Truthfulness is non-negotiable. Never invent employers, titles, dates, degrees, or credentials.
2. Mirror the JD's exact phrasing for keywords — ATS does literal matching.
3. Rewrite bullets: action verb + quantified outcome + JD keywords.
4. Skills section must list every required skill with resume evidence, grouped.
5. Summary: 3-4 line value pitch naming role title, total years, top JD keywords, and a quantified win.

== FIELDS TO RETURN ==
- tailored_resume_markdown: FULL rewritten resume in clean markdown (## headings, - bullets)
- ai_summary: 1-2 sentences plain-English summary of the whole tailoring pass
- edits: ONE entry per section changed or added. Each: { section (heading name), before_text (original verbatim or null if new section), after_text (rewritten — wrap changed tokens in **double asterisks**), ai_reason (one line why) }
- estimated_match_score: honest 0-100 estimate`,
    TailorSessionSchema,
    3072,
  );
}

// ---------------------------------------------------------------------------
// Job matching for consultant recommended feed
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

  const hasResume =
    !!consultantProfile.resume_excerpt && consultantProfile.resume_excerpt.trim().length > 0;
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

  const result = await anthropicParse(
    'matchJobsForConsultant',
    `You are ranking jobs for a specific consultant. Score each job 0-100 and return sorted matches. Return JSON with: matches (array of { job_id, match_score, reasons }).

== CONSULTANT ==
Skills (recruiter-curated): ${skillsBlock}
Years of experience: ${consultantProfile.experienceYears}
Preferred locations: ${(consultantProfile.preferredLocations ?? []).join(', ') || '(any)'}
${
  hasResume
    ? `\n== RESUME (primary source of truth) ==\n${clip(consultantProfile.resume_excerpt)}\n`
    : '\n(No resume on file — use curated skills as primary signal.)\n'
}
== JOBS ==
${JSON.stringify(slimJobs)}

== SCORING ==
- 85+ = strong match: most required skills evidenced, seniority fits
- 70-84 = good match: majority of required skills present
- 50-69 = fair match: some overlap, 2-4 gaps
- <50 = weak match: ≤30% required skills or seniority mismatch

For each job: job_id (verbatim), match_score (0-100), reasons (2-3 short bullets citing SPECIFIC evidence).
${
  hasResume
    ? 'IMPORTANT: Trust the resume over the curated skills list. Do not fabricate skills not in the resume.'
    : 'IMPORTANT: With no resume, score conservatively against curated skill keywords.'
}
Return all jobs sorted by match_score descending.`,
    JobMatchListSchema,
    800,
  );
  return result.matches;
}
