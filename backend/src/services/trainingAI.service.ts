import { z } from 'zod';
import type { TextBlockParam } from '@anthropic-ai/sdk/resources/messages';
import Anthropic from '@anthropic-ai/sdk';
import {
  anthropic,
  ANTHROPIC_MODEL,
  TRAINING_CONTENT_MODEL,
  AI_AVAILABLE,
} from '../config/anthropic';
import { logger } from '../config/logger';
import { withCache, trainingPlanCache, interviewQuestionsCache, quizCache } from './aiCache';
import { normalizeSkill, normalizeSkills, diffSkills } from './skillNorm';

/**
 * AI helpers for the Training module.
 *
 * Improvements vs. the original:
 *   1. Prompt caching — stable system blocks are marked `cache_control: ephemeral`.
 *   2. LRU response cache — identical inputs skip the API for 1 h – 24 h.
 *   3. Library-based skill gap — `skillGapAnalysis` uses `diffSkills` from
 *      skillNorm.ts (fast, deterministic, free) instead of an AI call.
 *   4. Better prompts — instructional-design best practices, Bloom's taxonomy
 *      verbs for objectives, interleaved practice theory for quizzes.
 */

// ---------------------------------------------------------------------------
// Internals
// ---------------------------------------------------------------------------

function aiError(status: number, message: string): Error {
  return Object.assign(new Error(message), { status, isHttpError: true as const });
}

/**
 * Mark a block as prompt-cacheable when it's large enough to benefit.
 * Anthropic requires ≥ 1 024 tokens (≈ 4 096 chars) for Haiku cache hits.
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

/**
 * Single entry point for every structured generation.
 * `systemPrompt` is always marked cacheable — it's large and stable.
 * `userContent` can be an array of blocks so callers can mark specific
 * parts (e.g. resume text) as cacheable independently.
 *
 * Model fallback: if `opts.model` returns a 400/404 model-availability error,
 * the call is retried once with `ANTHROPIC_MODEL` (Haiku) so a mis-configured
 * TRAINING_CONTENT_MODEL never permanently blocks generation.
 */
async function generateStructured<S extends z.ZodTypeAny>(
  schema: S,
  systemPrompt: string,
  userContent: string | TextBlockParam[],
  opts: { model: string; maxTokens: number; client?: Anthropic },
): Promise<z.infer<S>> {
  const client = opts.client ?? anthropic;

  // Skip the global AI_AVAILABLE check when the caller supplies their own client
  // (user-provided key/token bypasses the server's env config).
  if (!opts.client && !AI_AVAILABLE) {
    throw aiError(503, 'AI is not configured — ask your admin to set ANTHROPIC_API_KEY.');
  }

  const userBlocks: TextBlockParam[] =
    typeof userContent === 'string' ? [{ type: 'text', text: userContent }] : userContent;

  const modelsToTry = opts.model !== ANTHROPIC_MODEL ? [opts.model, ANTHROPIC_MODEL] : [opts.model];

  let raw: string | undefined;
  let lastErr: unknown;

  for (const model of modelsToTry) {
    try {
      const response = await client.messages.create({
        model,
        max_tokens: opts.maxTokens,
        system: [cacheableBlock(systemPrompt, 0)],
        messages: [{ role: 'user', content: userBlocks }],
      });
      const block = response.content[0];
      raw = block?.type === 'text' ? block.text.trim() : '{}';
      if (response.stop_reason === 'max_tokens') {
        throw aiError(
          502,
          `AI response truncated (hit ${opts.maxTokens}-token limit) — try again or reduce input length.`,
        );
      }
      break;
    } catch (err: any) {
      if ((err as { isHttpError?: boolean }).isHttpError) throw err;
      // Retry with fallback model on 400/404 model-availability errors
      const isModelError =
        (err?.status === 400 || err?.status === 404) && model !== ANTHROPIC_MODEL;
      if (isModelError) {
        lastErr = err;
        logger.warn(
          { model, fallback: ANTHROPIC_MODEL, errStatus: err?.status },
          'training AI: model error, retrying with fallback model',
        );
        continue;
      }
      throw aiError(502, `AI request failed: ${err?.message ?? String(err)}`);
    }
  }

  if (raw === undefined) {
    throw aiError(502, `AI request failed: ${String(lastErr)}`);
  }

  let text = raw
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```\s*$/, '')
    .trim();

  // Extract the outermost JSON object/array; the model sometimes appends
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

  let obj: unknown;
  try {
    obj = JSON.parse(text);
  } catch {
    throw aiError(502, 'AI returned malformed JSON — please try again.');
  }

  const result = schema.safeParse(obj);
  if (!result.success) {
    logger.warn({ issues: result.error.issues.slice(0, 3) }, 'AI schema validation failed');
    throw aiError(502, 'AI returned an unexpected structure — please try again.');
  }
  return result.data as z.infer<S>;
}

async function safeGenerate<T>(
  label: string,
  fn: () => Promise<T>,
  fallback: () => T,
): Promise<{ data: T; degraded: boolean }> {
  if (!AI_AVAILABLE) {
    return { data: fallback(), degraded: true };
  }
  try {
    return { data: await fn(), degraded: false };
  } catch (err) {
    logger.error({ err, label }, 'training AI generation failed — using fallback');
    return { data: fallback(), degraded: true };
  }
}

// ---------------------------------------------------------------------------
// 1) generateTrainingPlan
// ---------------------------------------------------------------------------

const TrainingPlanSchema = z.object({
  missing_skills: z.array(z.string()),
  recommended_courses: z.array(
    z.object({
      title: z.string(),
      category: z.string(),
      difficulty: z.enum(['BEGINNER', 'INTERMEDIATE', 'ADVANCED']),
      why_recommended: z.string(),
    }),
  ),
  learning_roadmap: z.array(
    z.object({
      phase: z.string(),
      duration_weeks: z.number().nullable(),
      focus_areas: z.array(z.string()),
    }),
  ),
  summary: z.string(),
});
export type TrainingPlan = z.infer<typeof TrainingPlanSchema>;

const TRAINING_PLAN_SYSTEM = `You are a senior L&D (Learning & Development) consultant at a top-tier IT staffing firm. Your job is to build focused, achievable training plans that close a specific consultant's skill gaps before an upcoming engagement.

ANALYSIS APPROACH:
1. Read the resume carefully — note what's present, at what depth, and how recently used.
2. Extract every hard requirement from the JD (skills, tools, certifications, methodologies).
3. Identify gaps (required but not evidenced in resume) vs. depth gaps (mentioned but likely shallow).
4. Sequence the roadmap so each phase unblocks the next — don't recommend advanced topics before foundations.

OUTPUT RULES:
- missing_skills: 5–12 items. Use canonical names (React not ReactJS). Omit skills the resume clearly demonstrates.
- recommended_courses: 4–8 items. Use EXACTLY these field names: title (course name), category (e.g. "Security", "Cloud"), difficulty ("BEGINNER"|"INTERMEDIATE"|"ADVANCED"), why_recommended (specific JD requirement it addresses).
- learning_roadmap: 2–4 phases ordered by dependency. Phase 1 = most critical blockers.
  Use EXACTLY these field names: phase (name), duration_weeks (number or null), focus_areas (string array).
- summary: 2–3 sentences addressing the consultant directly — what to focus on and why the order matters.

Return valid JSON matching this exact structure — no extra keys, no markdown:
{"missing_skills":["..."],"recommended_courses":[{"title":"...","category":"...","difficulty":"BEGINNER","why_recommended":"..."}],"learning_roadmap":[{"phase":"...","duration_weeks":4,"focus_areas":["..."]}],"summary":"..."}`;

export async function generateTrainingPlan(input: {
  resume_text: string;
  job_description: string;
}): Promise<TrainingPlan> {
  const clippedResume = input.resume_text.slice(0, 6000);
  const clippedJd = input.job_description.slice(0, 3000);
  return withCache(trainingPlanCache, { r: clippedResume, jd: clippedJd }, () =>
    generateStructured(
      TrainingPlanSchema,
      TRAINING_PLAN_SYSTEM,
      [
        cacheableBlock(`CONSULTANT RESUME:\n\n${clippedResume}`),
        { type: 'text', text: `TARGET JOB DESCRIPTION:\n\n${clippedJd}` },
      ],
      { model: ANTHROPIC_MODEL, maxTokens: 4096 },
    ),
  );
}

// ---------------------------------------------------------------------------
// 2) generateInterviewQuestions
// ---------------------------------------------------------------------------

const InterviewQuestionsSchema = z
  .object({
    technical: z.array(
      z.object({ question: z.string(), expected_signal: z.string().optional().default('') }),
    ),
    behavioral: z.array(
      z.object({ question: z.string(), expected_signal: z.string().optional().default('') }),
    ),
    scenarios: z.array(
      z.object({ situation: z.string(), question: z.string().optional().default('') }),
    ),
  })
  .transform((d) => ({
    technical: d.technical.filter((q) => q.question),
    behavioral: d.behavioral.filter((q) => q.question),
    scenarios: d.scenarios.filter((s) => s.situation && s.question) as {
      situation: string;
      question: string;
    }[],
  }));
export type InterviewQuestions = z.infer<typeof InterviewQuestionsSchema>;

const INTERVIEW_QUESTIONS_SYSTEM = `You are a principal-level technical interviewer at a FAANG-calibre firm. You write questions that reveal how candidates actually think, not just whether they've memorised vocabulary.

QUESTION DESIGN PRINCIPLES:
- Technical questions: probe depth, not definitions. "How would you debug X in production?" beats "What is X?".
  expected_signal: describe what distinguishes a good answer (specific behaviour, tool, or reasoning pattern).
- Behavioral questions: STAR-format prompts (Situation, Task, Action, Result). One question per competency.
  expected_signal: the competency being tested (ownership, cross-functional influence, resilience, etc.).
- Scenario questions: realistic on-the-job situations tied to the role's actual daily work.
  situation: 2–3 sentences of realistic context; question: what the interviewer asks next.

VOLUME:
- technical: 6–10 questions covering the most critical JD requirements, ordered from foundational to advanced.
- behavioral: 4–6 questions — vary the competency (don't ask 4 "tell me about a challenge" variants).
- scenarios: 3–5 situations — at least one should involve a system failure or stakeholder conflict.

Return valid JSON matching this exact structure — use these exact top-level keys:
{"technical":[{"question":"...","expected_signal":"..."}],"behavioral":[{"question":"...","expected_signal":"..."}],"scenarios":[{"situation":"...","question":"..."}]}

No generic filler questions ("Tell me about yourself"). No markdown, no explanation.`;

export async function generateInterviewQuestions(input: {
  job_description: string;
  skills: string[];
}): Promise<InterviewQuestions> {
  const normSkills = normalizeSkills(input.skills);
  const clippedJd = input.job_description.slice(0, 3000);
  return withCache(interviewQuestionsCache, { jd: clippedJd, skills: [...normSkills].sort() }, () =>
    generateStructured(
      InterviewQuestionsSchema,
      INTERVIEW_QUESTIONS_SYSTEM,
      [
        cacheableBlock(`JOB DESCRIPTION:\n${clippedJd}`),
        {
          type: 'text',
          text: `Required skills (normalised): ${normSkills.join(', ') || '(see JD)'}`,
        },
      ],
      { model: ANTHROPIC_MODEL, maxTokens: 4096 },
    ),
  );
}

// ---------------------------------------------------------------------------
// 3) generateQuiz — multiple-choice from lesson content (library-assisted)
// ---------------------------------------------------------------------------

const QuizSchema = z.object({
  questions: z.array(
    z
      .object({
        question: z.string(),
        options: z.array(z.string()).min(3).max(5),
        correct_answer: z.string(),
        explanation: z.string(),
        points: z.preprocess((v) => (v == null ? 1 : v), z.number()),
      })
      .refine((q) => q.options.includes(q.correct_answer), {
        message: 'correct_answer must be one of the options',
        path: ['correct_answer'],
      }),
  ),
});
export type GeneratedQuiz = z.infer<typeof QuizSchema>;

const QUIZ_SYSTEM = `You are a certified instructional designer writing formative assessments for an online course. Apply interleaved practice theory: space questions across the full lesson, not just the last topic.

QUESTION DESIGN (Bloom's taxonomy levels):
- ~50% Remember / Understand — direct recall of definitions, facts, sequences from the lesson.
- ~30% Apply — "given [scenario], what would you do / which approach is correct?"
- ~20% Analyze / Evaluate — "which option is BEST and why?" or "what is the flaw in this approach?"

QUALITY RULES:
- Every question must be answerable from the lesson body alone — no outside knowledge required.
- Distractors must be plausible (common misconceptions, near-synonyms) — not obviously wrong.
- correct_answer must be the EXACT TEXT of one of the options array items (copy-paste identical).
- explanation: 1–2 sentences citing the specific lesson section that supports the answer.
- points: 1 for recall/apply questions; 2 for analysis/evaluation questions.

Return valid JSON only.`;

export async function generateQuiz(input: {
  lesson_content: string;
  count?: number;
}): Promise<GeneratedQuiz> {
  const count = Math.max(3, Math.min(15, input.count ?? 5));
  const clipped = input.lesson_content.slice(0, 6000);
  return withCache(quizCache, { lesson: clipped, count }, () =>
    generateStructured(
      QuizSchema,
      QUIZ_SYSTEM,
      [
        cacheableBlock(`LESSON CONTENT:\n\n${clipped}`),
        { type: 'text', text: `Generate exactly ${count} questions.` },
      ],
      { model: ANTHROPIC_MODEL, maxTokens: 3072 },
    ),
  );
}

// ---------------------------------------------------------------------------
// 4) skillGapAnalysis — LIBRARY-BASED (no AI call)
//    Uses diffSkills + normalizeSkills from skillNorm.ts for fast, deterministic,
//    free skill-gap computation. No API cost, no latency, no failure mode.
// ---------------------------------------------------------------------------

export const SkillGapSchema = z.object({
  matched_skills: z.array(z.string()),
  missing_skills: z.array(z.string()),
  partial_skills: z.array(z.object({ skill: z.string(), evidence: z.string() })),
  recommended_training: z.array(
    z.object({
      category: z.string(),
      rationale: z.string(),
      priority: z.enum(['LOW', 'MEDIUM', 'HIGH']),
    }),
  ),
  overall_score: z.number(),
  readiness_summary: z.string(),
});
export type SkillGap = z.infer<typeof SkillGapSchema>;

export async function skillGapAnalysis(input: {
  consultant_skills: string[];
  job_skills: string[];
  resume_text?: string;
  job_description?: string;
}): Promise<SkillGap> {
  const normConsultant = normalizeSkills(input.consultant_skills);
  const normJob = normalizeSkills(input.job_skills);

  const { matched, missing } = diffSkills(normJob, normConsultant);
  const normConsultantLower = normConsultant.map((s) => s.toLowerCase());

  // Partial match: required skill substring-overlaps an existing candidate skill.
  const partialSkills = missing
    .filter((req) => {
      const rLow = normalizeSkill(req).toLowerCase();
      return normConsultantLower.some((c) => c.includes(rLow) || rLow.includes(c));
    })
    .map((skill) => ({
      skill,
      evidence: 'Partial overlap detected with existing skill set',
    }));

  const partialSet = new Set(partialSkills.map((p) => p.skill));
  const trulyMissing = missing.filter((s) => !partialSet.has(s));

  const total = normJob.length || 1;
  const overallScore = Math.round((matched.length / total) * 100);

  const recommended_training = trulyMissing.slice(0, 6).map((skill, i) => ({
    category: skill,
    rationale: `Required by the target role and not evidenced in the current skill set.`,
    priority: (i < 2 ? 'HIGH' : i < 5 ? 'MEDIUM' : 'LOW') as 'HIGH' | 'MEDIUM' | 'LOW',
  }));

  const readinessLabel =
    overallScore >= 80 ? 'strong' : overallScore >= 60 ? 'moderate' : 'limited';
  const gapSentence =
    trulyMissing.length > 0
      ? `Priority gaps: ${trulyMissing.slice(0, 3).join(', ')}${trulyMissing.length > 3 ? ` and ${trulyMissing.length - 3} more` : ''}.`
      : 'All key skill requirements are covered.';
  const readiness_summary = `Consultant shows ${readinessLabel} readiness (${overallScore}/100) for this role. ${gapSentence}`;

  return {
    matched_skills: matched,
    missing_skills: trulyMissing,
    partial_skills: partialSkills,
    recommended_training,
    overall_score: overallScore,
    readiness_summary,
  };
}

// ===========================================================================
// FULL-COURSE GENERATION (LMS)
// ===========================================================================

// ---------------------------------------------------------------------------
// Course outline
// ---------------------------------------------------------------------------

const ResourceSchema = z.object({
  title: z.string(),
  url: z.string(),
  // Accept any string from the model and normalise to the closest known type
  type: z
    .string()
    .transform((v) => {
      const u = v.toUpperCase();
      if (u.includes('VIDEO') || u.includes('YOUTUBE')) return 'VIDEO';
      if (u.includes('TOOL') || u.includes('PACKAGE') || u.includes('LIBRAR')) return 'TOOL';
      if (u.includes('ARTICLE') || u.includes('BLOG') || u.includes('TUTORIAL')) return 'ARTICLE';
      return 'DOC';
    })
    .pipe(z.enum(['DOC', 'VIDEO', 'ARTICLE', 'TOOL'])),
});

const CourseOutlineSchema = z.object({
  overview: z.string(),
  learning_objectives: z.array(z.string()),
  skills_taught: z.array(z.string()),
  expected_outcomes: z.array(z.string()),
  roadmap: z.array(
    z.object({
      phase: z.string(),
      duration_label: z.string(),
      focus_areas: z.array(z.string()),
    }),
  ),
  resources: z.array(ResourceSchema),
  completion_criteria: z.object({
    minimum_time_minutes: z.number().int().min(0),
    quiz_passing_score: z.number().min(0).max(100),
    quiz_max_attempts: z.number().int().min(1),
    requires_manager_approval: z.boolean(),
  }),
  estimated_duration_hours: z.number().min(0),
  lessons: z.array(
    z.object({
      title: z.string(),
      summary: z.string(),
      objective: z.string(),
      estimated_minutes: z.number().int().min(1),
      lesson_order: z.number().int().min(0),
    }),
  ),
});
export type CourseOutline = z.infer<typeof CourseOutlineSchema>;

export interface CourseOutlineInput {
  title: string;
  category: string;
  difficulty: 'BEGINNER' | 'INTERMEDIATE' | 'ADVANCED';
  estimated_duration_hours?: number | null;
  tags?: string[];
  lesson_count?: number | null;
  target_audience?: string | null;
}

function deriveLessonCount(input: CourseOutlineInput): number {
  if (input.lesson_count && input.lesson_count > 0) {
    return Math.max(3, Math.min(20, Math.round(input.lesson_count)));
  }
  const hours = input.estimated_duration_hours ?? 6;
  return Math.max(4, Math.min(12, Math.round(hours)));
}

const COURSE_OUTLINE_SYSTEM = `You are a senior instructional designer creating a complete, teachable online course from minimal metadata. You apply backward design: start with outcomes, then design assessments, then sequence content.

DESIGN PRINCIPLES:
- learning_objectives: 4–8 items using Bloom's verbs (Define, Explain, Apply, Analyze, Design, Evaluate). Avoid "understand" — it's unmeasurable.
- expected_outcomes: outcome statements from the learner's perspective ("You will be able to…"). 3–5 items.
- roadmap: sequence phases logically — foundational concepts → application → practice → mastery. 2–4 phases.
- resources: 3–6 genuinely useful external references. Official documentation > blog posts. ONLY use well-known authoritative domains: docs.*, learn.*, developer.* (official vendor docs), github.com, youtube.com, NIST, OWASP, MDN, AWS/Azure/GCP official docs. Do NOT invent URLs — only use domains you are certain exist.
- completion_criteria: be realistic. minimum_time_minutes = (estimated_duration_hours × 60 × 0.8). quiz_passing_score default 70. requires_manager_approval true only for compliance/safety topics.
- lessons: exactly the requested count, in strict teaching order (0-based). Each lesson has ONE measurable objective (single Bloom's verb). Do NOT write lesson bodies here — summaries only (1 sentence). estimated_minutes: foundational concept lessons = 30–45 min, applied/lab lessons = 45–60 min, advanced architecture lessons = 50–70 min.

DIFFICULTY CALIBRATION:
- BEGINNER: assumes no prior knowledge of the topic; introduces vocabulary and basic concepts.
- INTERMEDIATE: assumes 6–12 months of practice; goes deeper into trade-offs and patterns.
- ADVANCED: assumes professional experience; covers edge cases, performance, and architecture decisions.

Return valid JSON only. No markdown, no preamble.`;

export async function generateCourseOutline(
  input: CourseOutlineInput,
): Promise<{ data: CourseOutline; degraded: boolean }> {
  const count = deriveLessonCount(input);

  const userText = [
    `Course title: ${input.title}`,
    `Category: ${input.category}`,
    `Difficulty: ${input.difficulty}`,
    input.target_audience ? `Target audience: ${input.target_audience}` : '',
    input.estimated_duration_hours ? `Target length: ~${input.estimated_duration_hours} hours` : '',
    input.tags?.length ? `Tags: ${input.tags.join(', ')}` : '',
    `Produce exactly ${count} lessons in teaching order (lesson_order 0 to ${count - 1}).`,
  ]
    .filter(Boolean)
    .join('\n');

  return safeGenerate(
    'course-outline',
    () =>
      generateStructured(CourseOutlineSchema, COURSE_OUTLINE_SYSTEM, userText, {
        model: ANTHROPIC_MODEL,
        maxTokens: 3072,
      }),
    () => fallbackOutline(input, count),
  );
}

function fallbackOutline(input: CourseOutlineInput, count: number): CourseOutline {
  const lessons = Array.from({ length: Math.max(4, Math.min(count, 5)) }, (_, i) => ({
    title: `Module ${i + 1}: ${input.title}`,
    summary: `Auto-stub for "${input.title}". Edit this lesson's title and content.`,
    objective: `Understand a core part of ${input.title}.`,
    estimated_minutes: 30,
    lesson_order: i,
  }));
  return {
    overview: `# ${input.title}\n\n_AI generation was unavailable — this is an editable stub. Replace this overview and the lesson content below._`,
    learning_objectives: [`Understand the fundamentals of ${input.title}.`],
    skills_taught: input.tags?.length ? input.tags : [input.category],
    expected_outcomes: [`Apply ${input.title} concepts in practice.`],
    roadmap: [{ phase: 'Phase 1', duration_label: 'Week 1', focus_areas: [input.category] }],
    resources: [],
    completion_criteria: {
      minimum_time_minutes: 0,
      quiz_passing_score: 70,
      quiz_max_attempts: 3,
      requires_manager_approval: false,
    },
    estimated_duration_hours: input.estimated_duration_hours ?? 4,
    lessons,
  };
}

// ---------------------------------------------------------------------------
// Lesson content
// ---------------------------------------------------------------------------

const LessonContentSchema = z.object({
  content: z.string(),
  practical_example: z.string().nullable(),
  exercises: z
    .array(
      z.object({
        prompt: z.string(),
        expected_outcome: z.string(),
        hints: z.array(z.string()),
      }),
    )
    .nullable(),
  key_takeaways: z.array(z.string()),
  quiz: z.array(
    z
      .object({
        question: z.string(),
        options: z.array(z.string()).min(3).max(5),
        correct_answer: z.string(),
        explanation: z.string(),
        points: z.preprocess((v) => (v == null ? 1 : v), z.number()),
      })
      .refine((q) => q.options.includes(q.correct_answer), {
        message: 'correct_answer must be one of the options',
        path: ['correct_answer'],
      }),
  ),
});
export type LessonContent = z.infer<typeof LessonContentSchema>;

export interface LessonContentInput {
  course_title: string;
  category: string;
  difficulty: 'BEGINNER' | 'INTERMEDIATE' | 'ADVANCED';
  lesson_title: string;
  lesson_summary?: string | null;
  lesson_objective?: string | null;
}

const LESSON_CONTENT_SYSTEM = `You are a senior technical writer at a top-tier IT staffing firm creating a self-paced e-learning lesson.

TARGET QUALITY: Match professional certification study material — structured prose with named frameworks (CIA triad, ATT&CK tactics, OWASP Top 10, OSI model, etc.), real vendor tools, decision trees, and documented anti-patterns. Readers are working professionals, not students. Every abstract claim needs a concrete, named example.

CONTENT (content field — Markdown):
## [Lesson Title]
### Introduction
1–2 paragraphs: WHY this matters on the job and exactly what the learner will be able to DO after this lesson.
### Core Concepts
Use ### subsections, bullets, and numbered lists to structure distinct concepts.
For technical topics: include runnable code with triple-backtick fences and language tags (\`\`\`python, \`\`\`sql, \`\`\`bash, etc.).
For conceptual topics: include a named framework or taxonomy, then show how to apply it to a real decision.
### [Add further ### subsections as needed for the topic]
Target 600–900 words. Write the COMPLETE lesson body — do NOT truncate or summarise. No "In this lesson we will…" openers.

PRACTICAL EXAMPLE (practical_example — Markdown):
One realistic worked example from professional practice.
Technical: runnable code + line-by-line explanation of what each part does.
Conceptual: a specific on-the-job scenario ("Your SIEM fires 200 alerts on Monday morning — here is how you triage them").

EXERCISES (1–2 items):
- prompt: active verb + specific task ("Build a function that…", "Configure X to enforce Y…", "Analyse the following log and identify…")
- expected_outcome: the observable, verifiable deliverable
- hints: exactly 2 directional nudges that point toward the answer without giving it away

KEY TAKEAWAYS (4–5 items):
Present-tense decision rules, NOT summaries. Use strong verbs: "Use X when Y", "Always Z before W", "Prefer A over B because C". These are rules the learner can apply on the job tomorrow.

QUIZ (3–5 questions — Bloom's mix: ~40 % recall, ~40 % apply, ~20 % analyze):
- correct_answer: copy the EXACT string from the options array — do NOT paraphrase
- explanation: cite the specific section name (e.g., "See Core Concepts → TLS Handshake")
- For apply/analyze questions, distractors must be plausible misconceptions or near-synonyms, not obviously wrong

Return valid JSON matching this exact structure — use these exact top-level keys, no wrapping object:
{"content":"## Title\n...","practical_example":"...","exercises":[{"prompt":"...","expected_outcome":"...","hints":["...","..."]}],"key_takeaways":["...","...","...","..."],"quiz":[{"question":"...","options":["A","B","C","D"],"correct_answer":"A","explanation":"See Core Concepts → ...","points":1}]}

No prose outside the JSON.`;

export async function generateLessonContent(
  input: LessonContentInput,
  opts?: { strict?: boolean; client?: Anthropic },
): Promise<{ data: LessonContent; degraded: boolean }> {
  const contextLines = [
    `Course: ${input.course_title} (${input.category}, ${input.difficulty})`,
    `Lesson title: ${input.lesson_title}`,
    input.lesson_summary ? `Lesson summary: ${input.lesson_summary}` : '',
    input.lesson_objective ? `Lesson objective: ${input.lesson_objective}` : '',
  ]
    .filter(Boolean)
    .join('\n');

  const generate = () =>
    generateStructured(LessonContentSchema, LESSON_CONTENT_SYSTEM, contextLines, {
      model: TRAINING_CONTENT_MODEL,
      maxTokens: 8192,
      client: opts?.client,
    });

  if (opts?.strict) {
    const data = await generate();
    return { data, degraded: false };
  }

  return safeGenerate('lesson-content', generate, () => ({
    content: `## ${input.lesson_title}\n\n_Content generation failed — edit this lesson manually._${
      input.lesson_objective ? `\n\n**Objective:** ${input.lesson_objective}` : ''
    }`,
    practical_example: null,
    exercises: null,
    key_takeaways: [],
    quiz: [],
  }));
}

// ---------------------------------------------------------------------------
// Capstone
// ---------------------------------------------------------------------------

const CapstoneSchema = z.object({
  assessment_type: z.enum(['PRACTICAL_ASSIGNMENT', 'SHORT_ANSWER', 'MULTIPLE_CHOICE']),
  instructions: z.string(),
  questions: z.array(
    z.object({
      prompt: z.string(),
      guidance: z
        .string()
        .nullish()
        .transform((v) => v ?? ''),
    }),
  ),
  rubric: z.array(z.object({ criterion: z.string(), weight: z.number() })),
});
export type Capstone = z.infer<typeof CapstoneSchema>;

export interface CapstoneInput {
  course_title: string;
  category: string;
  difficulty: 'BEGINNER' | 'INTERMEDIATE' | 'ADVANCED';
  learning_objectives?: string[];
}

const CAPSTONE_SYSTEM = `You are designing a capstone final assessment that measures whether a learner has achieved the course's learning objectives — not just whether they can recall facts.

ASSESSMENT TYPE SELECTION:
- PRACTICAL_ASSIGNMENT: choose when the course teaches a hands-on skill (coding, configuration, design). Deliverables should be tangible artefacts a reviewer can evaluate.
- SHORT_ANSWER: choose when the course teaches decision-making, strategy, or analysis. 3–5 open questions that require synthesis, not recall.
- MULTIPLE_CHOICE: only for pure knowledge courses where there is one clearly correct answer per question. 8–12 questions covering the full syllabus.

INSTRUCTIONS (Markdown):
- Frame the capstone as a realistic professional task, not a school exam.
- State clearly what to submit, what tools to use, and how it will be graded.
- Reference at least 2 specific learning objectives.

QUESTIONS (1–5):
For PRACTICAL_ASSIGNMENT: each question is one deliverable (e.g. "Implement X", "Write a report on Y").
Include 1–2 sentences of guidance per question.

RUBRIC (3–6 criteria, weights summing to 100):
Criteria should be outcome-based, not process-based ("Demonstrates correct use of X" not "Followed instructions").

Return valid JSON only.`;

export async function generateCapstone(
  input: CapstoneInput,
): Promise<{ data: Capstone; degraded: boolean }> {
  const contextLines = [
    `Course: ${input.course_title} (${input.category}, ${input.difficulty})`,
    input.learning_objectives?.length
      ? `Learning objectives:\n- ${input.learning_objectives.join('\n- ')}`
      : '',
  ]
    .filter(Boolean)
    .join('\n');

  return safeGenerate(
    'capstone',
    () =>
      generateStructured(CapstoneSchema, CAPSTONE_SYSTEM, contextLines, {
        model: TRAINING_CONTENT_MODEL,
        maxTokens: 3072,
      }),
    () => ({
      assessment_type: 'SHORT_ANSWER' as const,
      instructions: `Reflect on what you learned in "${input.course_title}" and how you will apply it. (AI generation was unavailable — edit this capstone.)`,
      questions: [
        {
          prompt: `Summarize the most important concept from ${input.course_title} and describe a concrete way you would apply it.`,
          guidance: '',
        },
      ],
      rubric: [{ criterion: 'Demonstrates understanding', weight: 100 }],
    }),
  );
}

// ---------------------------------------------------------------------------
// Enrich course meta
// ---------------------------------------------------------------------------

const EnrichSchema = z.object({
  overview: z.string(),
  learning_objectives: z.array(z.string()),
  skills_taught: z.array(z.string()),
  expected_outcomes: z.array(z.string()),
  roadmap: z.array(
    z.object({
      phase: z.string(),
      duration_label: z.string(),
      focus_areas: z.array(z.string()),
    }),
  ),
  resources: z.array(ResourceSchema),
  completion_criteria: z.object({
    minimum_time_minutes: z.number().int().min(0),
    quiz_passing_score: z.number().min(0).max(100),
    quiz_max_attempts: z.number().int().min(1),
    requires_manager_approval: z.boolean(),
  }),
  capstone: CapstoneSchema,
});
export type CourseEnrichment = z.infer<typeof EnrichSchema>;

export interface EnrichInput {
  title: string;
  category: string;
  difficulty: 'BEGINNER' | 'INTERMEDIATE' | 'ADVANCED';
  target_audience?: string | null;
  existing_lesson_titles?: string[];
}

const ENRICH_SYSTEM = `An existing course already has its lessons written. Your job is to generate the surrounding STRUCTURE that frames those lessons into a coherent learning experience.

DO NOT rewrite, reorder, or invent new lessons. The lesson list is fixed.

DERIVATION RULES:
- Infer learning_objectives, skills_taught, and expected_outcomes from the lesson titles — they must reflect what the existing lessons actually teach.
- roadmap phases should group related lessons logically (e.g., "Foundations", "Core Patterns", "Advanced Topics").
- resources: choose references that directly support the lesson topics (official docs, well-known tutorials).
- capstone: design a final assessment that integrates the skills from ALL lessons, not just the last one.

OUTPUT — return a single flat JSON object with EXACTLY these top-level keys (no wrapping parent key):
{
  "overview": "<Markdown string — 2–4 paragraphs>",
  "learning_objectives": ["<string>"],
  "skills_taught": ["<string>"],
  "expected_outcomes": ["<string>"],
  "roadmap": [{"phase":"<string>","duration_label":"<string>","focus_areas":["<string>"]}],
  "resources": [{"title":"<string>","url":"<string>","type":"DOC|VIDEO|ARTICLE|TOOL"}],
  "completion_criteria": {"minimum_time_minutes":<int>,"quiz_passing_score":<0-100>,"quiz_max_attempts":<int>,"requires_manager_approval":<bool>},
  "capstone": {"assessment_type":"PRACTICAL_ASSIGNMENT|SHORT_ANSWER|MULTIPLE_CHOICE","instructions":"<Markdown>","questions":[{"prompt":"<string>","guidance":"<string>"}],"rubric":[{"criterion":"<string>","weight":<number>}]}
}

Return valid JSON only. No markdown fences, no prose outside the JSON.`;

export async function enrichCourseMeta(
  input: EnrichInput,
): Promise<{ data: CourseEnrichment; degraded: boolean }> {
  const lessonList = input.existing_lesson_titles?.length
    ? `Existing lessons:\n- ${input.existing_lesson_titles.join('\n- ')}`
    : '(no lesson titles provided)';

  const contextLines = [
    `Course title: ${input.title}`,
    `Category: ${input.category}`,
    `Difficulty: ${input.difficulty}`,
    input.target_audience ? `Target audience: ${input.target_audience}` : '',
    lessonList,
  ]
    .filter(Boolean)
    .join('\n');

  return safeGenerate(
    'enrich-course',
    () =>
      generateStructured(EnrichSchema, ENRICH_SYSTEM, contextLines, {
        model: TRAINING_CONTENT_MODEL,
        maxTokens: 3072,
      }),
    () => ({
      overview: `# ${input.title}\n\n_Enrichment was unavailable — edit this overview._`,
      learning_objectives: [],
      skills_taught: input.category ? [input.category] : [],
      expected_outcomes: [],
      roadmap: [],
      resources: [],
      completion_criteria: {
        minimum_time_minutes: 0,
        quiz_passing_score: 70,
        quiz_max_attempts: 3,
        requires_manager_approval: false,
      },
      capstone: {
        assessment_type: 'SHORT_ANSWER' as const,
        instructions: `Reflect on "${input.title}".`,
        questions: [{ prompt: `What was the most important thing you learned?`, guidance: '' }],
        rubric: [{ criterion: 'Demonstrates understanding', weight: 100 }],
      },
    }),
  );
}
