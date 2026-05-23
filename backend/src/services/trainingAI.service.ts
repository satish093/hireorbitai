import { z } from 'zod';
import {
  anthropic,
  ANTHROPIC_MODEL,
  TRAINING_CONTENT_MODEL,
  AI_AVAILABLE,
} from '../config/anthropic';
import { logger } from '../config/logger';

/**
 * AI helpers for the Training module.
 *
 * Every call goes through `generateStructured`, which uses the Anthropic
 * Messages API with ANTHROPIC_API_KEY ('api' provider). Set
 * TRAINING_AI_PROVIDER=stub to disable AI and always return editable stubs.
 *
 * The full-course generators (outline / lesson / capstone) additionally run
 * through `safeGenerate`, which returns a deterministic fallback when the
 * provider is unavailable or the call fails — so the authoring pipeline never
 * 500s and the generated stub stays fully editable by hand.
 */

/** Attach a status code + isHttpError to any thrown Error so the errorHandler formats it correctly. */
function aiError(status: number, message: string): Error {
  return Object.assign(new Error(message), { status, isHttpError: true as const });
}

/** Single entry point for every structured generation. */
async function generateStructured<S extends z.ZodTypeAny>(
  schema: S,
  prompt: string,
  opts: { model: string; maxTokens: number },
): Promise<z.infer<S>> {
  if (!AI_AVAILABLE) {
    throw aiError(503, 'AI is not configured — ask your admin to set ANTHROPIC_API_KEY.');
  }

  let raw: string;
  try {
    const response = await anthropic.messages.create({
      model: opts.model,
      max_tokens: opts.maxTokens,
      system: 'Output valid JSON only. No markdown fences, no explanation.',
      messages: [{ role: 'user', content: prompt }],
    });
    const block = response.content[0];
    raw = block?.type === 'text' ? block.text.trim() : '{}';
  } catch (err: any) {
    // Remap Anthropic SDK errors so the errorHandler doesn't confuse a bad API
    // key (upstream 401) with an unauthenticated user request.
    throw aiError(502, `AI request failed: ${err?.message ?? String(err)}`);
  }

  // Strip markdown fences that models sometimes add despite the system prompt.
  let text = raw
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```\s*$/, '')
    .trim();

  // If the model returned prose surrounding the JSON, extract the object/array.
  if (!text.startsWith('{') && !text.startsWith('[')) {
    const m = text.match(/(\{[\s\S]*\}|\[[\s\S]*\])/);
    if (m) text = m[1]!;
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

export async function generateTrainingPlan(input: {
  resume_text: string;
  job_description: string;
}): Promise<TrainingPlan> {
  const prompt = `You're an L&D lead building a training plan to close a consultant's skill gaps before they go on a specific engagement.

Resume:
${input.resume_text}

Target job description:
${input.job_description}

Produce:
- missing_skills: skills required by the JD that the resume does NOT clearly evidence (5–12 items)
- recommended_courses: 4–8 specific courses, each with category and difficulty (BEGINNER/INTERMEDIATE/ADVANCED), and a one-sentence "why_recommended"
- learning_roadmap: 2–4 phases, each with a duration and 2–4 focus areas. Order by what unblocks the most JD requirements first.
- summary: 2–3 sentences for the consultant on what to focus on and in what order.`;

  return generateStructured(TrainingPlanSchema, prompt, {
    model: ANTHROPIC_MODEL,
    maxTokens: 3072,
  });
}

// ---------------------------------------------------------------------------
// 2) generateInterviewQuestions
// ---------------------------------------------------------------------------
const InterviewQuestionsSchema = z.object({
  technical: z.array(z.object({ question: z.string(), expected_signal: z.string() })),
  behavioral: z.array(z.object({ question: z.string(), expected_signal: z.string() })),
  scenarios: z.array(z.object({ situation: z.string(), question: z.string() })),
});
export type InterviewQuestions = z.infer<typeof InterviewQuestionsSchema>;

export async function generateInterviewQuestions(input: {
  job_description: string;
  skills: string[];
}): Promise<InterviewQuestions> {
  const prompt = `Generate interview questions for the following role.

JD:
${input.job_description}

Required skills: ${input.skills.join(', ') || '(see JD)'}

Produce:
- technical: 6–10 specific technical questions, each with a one-line "expected_signal" describing what a good answer reveals.
- behavioral: 4–6 behavioral questions, with expected_signal.
- scenarios: 3–5 realistic on-the-job scenarios — each with "situation" (1–2 sentences) and the "question" the interviewer asks.

Avoid generic "tell me about yourself"-style filler. Every item should map back to a JD requirement.`;

  return generateStructured(InterviewQuestionsSchema, prompt, {
    model: ANTHROPIC_MODEL,
    maxTokens: 3072,
  });
}

// ---------------------------------------------------------------------------
// 3) generateQuiz — multiple-choice from lesson content
// ---------------------------------------------------------------------------
const QuizSchema = z.object({
  questions: z.array(
    z.object({
      question: z.string(),
      options: z.array(z.string()).min(3).max(5),
      correct_answer: z.string(),
      explanation: z.string(),
      points: z.preprocess((v) => (v == null ? 1 : v), z.number()),
    }),
  ),
});
export type GeneratedQuiz = z.infer<typeof QuizSchema>;

export async function generateQuiz(input: {
  lesson_content: string;
  count?: number; // default 5
}): Promise<GeneratedQuiz> {
  const count = Math.max(3, Math.min(15, input.count ?? 5));
  const prompt = `Write a multiple-choice quiz for a training lesson. Each question must be answerable from the lesson body alone — don't introduce outside facts.

Lesson:
${input.lesson_content}

Produce ${count} questions. Each:
- question: the prompt
- options: 4 plausible options
- correct_answer: the literal text of the correct option (must match one of options exactly)
- explanation: 1–2 sentences citing the lesson
- points: 1 (or 2 for harder ones)

Mix difficulty: ~60% recall, ~30% applied, ~10% scenario.`;

  return generateStructured(QuizSchema, prompt, { model: ANTHROPIC_MODEL, maxTokens: 3072 });
}

// ---------------------------------------------------------------------------
// 4) skillGapAnalysis
// ---------------------------------------------------------------------------
const SkillGapSchema = z.object({
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
  overall_score: z.number(), // 0..100
  readiness_summary: z.string(),
});
export type SkillGap = z.infer<typeof SkillGapSchema>;

export async function skillGapAnalysis(input: {
  consultant_skills: string[];
  job_skills: string[];
  resume_text?: string;
  job_description?: string;
}): Promise<SkillGap> {
  const prompt = `Run a skill-gap analysis comparing a consultant against a target job.

Consultant skills (recruiter-curated): ${input.consultant_skills.join(', ') || '(none listed)'}
${input.resume_text ? `\nResume excerpt:\n${input.resume_text.slice(0, 3000)}\n` : ''}
Job-required skills: ${input.job_skills.join(', ') || '(see JD)'}
${input.job_description ? `\nJD:\n${input.job_description.slice(0, 2500)}\n` : ''}

Produce:
- matched_skills: required skills the consultant clearly has
- missing_skills: required skills with no evidence
- partial_skills: skills where there's adjacent or limited evidence (with a 1-line "evidence" quote/paraphrase)
- recommended_training: 3–6 training topics with category + rationale + priority (HIGH/MEDIUM/LOW)
- overall_score: 0–100 readiness score
- readiness_summary: 2–3 sentences a recruiter would forward to the consultant.`;

  return generateStructured(SkillGapSchema, prompt, { model: ANTHROPIC_MODEL, maxTokens: 2048 });
}

// ===========================================================================
// FULL-COURSE GENERATION (LMS)
// ===========================================================================
// These power the "type a title → get a teachable course" flow. Each call is
// bounded (one outline call, one call per lesson, one capstone call) so no
// single request blows the token/HTTP budget. Every call is wrapped in
// `safeGenerate` so a missing key or a transient model error degrades to an
// editable stub instead of a 500.

/**
 * Run an AI generator, falling back to a deterministic stub when the API key
 * is absent or the call throws. The `degraded` flag lets the caller mark the
 * persisted row FAILED so the UI can offer a Retry.
 */
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
// Course outline — overview + objectives + roadmap + resources + criteria +
// lesson stubs. Cheap model; bodies are filled in per-lesson later.
// ---------------------------------------------------------------------------
const ResourceSchema = z.object({
  title: z.string(),
  url: z.string(),
  type: z.enum(['DOC', 'VIDEO', 'ARTICLE', 'TOOL']),
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

/** ≈1 lesson per hour, clamped 4–12, unless the caller pins lesson_count. */
function deriveLessonCount(input: CourseOutlineInput): number {
  if (input.lesson_count && input.lesson_count > 0) {
    return Math.max(3, Math.min(20, Math.round(input.lesson_count)));
  }
  const hours = input.estimated_duration_hours ?? 6;
  return Math.max(4, Math.min(12, Math.round(hours)));
}

export async function generateCourseOutline(
  input: CourseOutlineInput,
): Promise<{ data: CourseOutline; degraded: boolean }> {
  const count = deriveLessonCount(input);
  const prompt = `You are an instructional designer building a complete, teachable online course from a title and metadata.

Course title: ${input.title}
Category: ${input.category}
Difficulty: ${input.difficulty}
${input.target_audience ? `Target audience: ${input.target_audience}\n` : ''}${input.estimated_duration_hours ? `Target length: ~${input.estimated_duration_hours} hours\n` : ''}${input.tags?.length ? `Tags: ${input.tags.join(', ')}\n` : ''}
Produce a course OUTLINE only (lesson bodies are written separately later):
- overview: 2–4 short paragraphs (markdown) introducing the course, who it's for, and what they'll be able to do at the end.
- learning_objectives: 4–8 concrete, measurable objectives.
- skills_taught: the discrete skills/tools a learner walks away with.
- expected_outcomes: what the learner can DO after finishing (outcome statements).
- roadmap: 2–4 phases, each with a duration_label (e.g. "Week 1") and 2–4 focus_areas.
- resources: 3–6 genuinely useful external references (official docs, well-known articles/videos). Use real, plausible URLs; set type to DOC/VIDEO/ARTICLE/TOOL.
- completion_criteria: sensible gates for this course — minimum_time_minutes (total expected study minutes), quiz_passing_score (0–100, default 70), quiz_max_attempts (default 3), requires_manager_approval (true only if the topic warrants sign-off).
- estimated_duration_hours: your best estimate.
- lessons: exactly ${count} lessons in teaching order. Each lesson: title, a one-sentence summary, a single measurable objective, estimated_minutes, and lesson_order (0-based, sequential). Sequence from fundamentals → application. Do NOT write lesson bodies here.`;

  return safeGenerate(
    'course-outline',
    () =>
      generateStructured(CourseOutlineSchema, prompt, { model: ANTHROPIC_MODEL, maxTokens: 3072 }),
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
// Lesson content — full markdown body + practical example + exercises +
// takeaways + a per-lesson knowledge-check quiz. Heavier model.
// ---------------------------------------------------------------------------
const LessonContentSchema = z.object({
  content: z.string(),
  practical_example: z.string(),
  exercises: z.array(
    z.object({
      prompt: z.string(),
      expected_outcome: z.string(),
      hints: z.array(z.string()),
    }),
  ),
  key_takeaways: z.array(z.string()),
  quiz: z.array(
    z.object({
      question: z.string(),
      options: z.array(z.string()).min(3).max(5),
      correct_answer: z.string(),
      explanation: z.string(),
      points: z.preprocess((v) => (v == null ? 1 : v), z.number()),
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

export async function generateLessonContent(
  input: LessonContentInput,
): Promise<{ data: LessonContent; degraded: boolean }> {
  const prompt = `You are writing one lesson inside an online course.

Course: ${input.course_title} (category: ${input.category}, difficulty: ${input.difficulty})
Lesson title: ${input.lesson_title}
${input.lesson_summary ? `Lesson summary: ${input.lesson_summary}\n` : ''}${input.lesson_objective ? `Lesson objective: ${input.lesson_objective}\n` : ''}
Produce CONCISE output:
- content: lesson body in MARKDOWN (## / ### headings, bullets, code blocks where technical). Aim 300–500 words. No front-matter.
- practical_example: one short worked example (markdown).
- exercises: 1–2 hands-on exercises. Each: prompt, expected_outcome, and 1–2 hints.
- key_takeaways: 3–4 one-line takeaways.
- quiz: 2–4 multiple-choice questions from this lesson. Each: question, 3–4 options, correct_answer (must match one option exactly), short explanation, points (1 or 2).`;

  return safeGenerate(
    'lesson-content',
    () =>
      generateStructured(LessonContentSchema, prompt, {
        model: TRAINING_CONTENT_MODEL,
        maxTokens: 2500,
      }),
    () => ({
      content: `## ${input.lesson_title}\n\n> ⚠️ Content generation failed — edit this lesson manually.\n\n${
        input.lesson_objective ? `**Objective:** ${input.lesson_objective}\n` : ''
      }`,
      practical_example: '',
      exercises: [],
      key_takeaways: [],
      quiz: [],
    }),
  );
}

// ---------------------------------------------------------------------------
// Capstone — course-level final-assessment template. Heavier model.
// ---------------------------------------------------------------------------
const CapstoneSchema = z.object({
  assessment_type: z.enum(['PRACTICAL_ASSIGNMENT', 'SHORT_ANSWER', 'MULTIPLE_CHOICE']),
  instructions: z.string(),
  questions: z.array(
    z.object({
      prompt: z.string(),
      guidance: z.string().default(''),
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

export async function generateCapstone(
  input: CapstoneInput,
): Promise<{ data: Capstone; degraded: boolean }> {
  const prompt = `Design a capstone final assessment for this course.

Course: ${input.course_title} (category: ${input.category}, difficulty: ${input.difficulty})
${input.learning_objectives?.length ? `Objectives:\n- ${input.learning_objectives.join('\n- ')}\n` : ''}
Produce:
- assessment_type: PRACTICAL_ASSIGNMENT (preferred for hands-on topics), SHORT_ANSWER, or MULTIPLE_CHOICE.
- instructions: markdown instructions framing the capstone and how it ties the objectives together.
- questions: 1–5 prompts. For PRACTICAL_ASSIGNMENT, each prompt is a deliverable; include short guidance per prompt.
- rubric: 3–6 grading criteria, each with a weight (weights should sum to ~100).`;

  return safeGenerate(
    'capstone',
    () =>
      generateStructured(CapstoneSchema, prompt, {
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
// Enrich-only — generate the structured META for an existing course (overview,
// objectives, roadmap, resources, completion criteria, capstone) WITHOUT
// touching its lessons/quizzes. Used to backfill hand-seeded courses.
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

export async function enrichCourseMeta(
  input: EnrichInput,
): Promise<{ data: CourseEnrichment; degraded: boolean }> {
  const prompt = `An existing course already has its lessons written. Generate the surrounding STRUCTURE for it — do NOT rewrite or invent lessons.

Course title: ${input.title}
Category: ${input.category}
Difficulty: ${input.difficulty}
${input.target_audience ? `Target audience: ${input.target_audience}\n` : ''}${
    input.existing_lesson_titles?.length
      ? `Existing lessons (for context only):\n- ${input.existing_lesson_titles.join('\n- ')}\n`
      : ''
  }
Produce:
- overview: 2–4 markdown paragraphs introducing the course and who it's for.
- learning_objectives, skills_taught, expected_outcomes: concrete lists derived from the lessons above.
- roadmap: 2–4 phases (phase, duration_label, focus_areas[]).
- resources: 3–6 genuinely useful references (DOC/VIDEO/ARTICLE/TOOL with plausible URLs).
- completion_criteria: minimum_time_minutes, quiz_passing_score (default 70), quiz_max_attempts (default 3), requires_manager_approval.
- capstone: a final assessment tying the lessons together (assessment_type, instructions, questions[], rubric[]).`;

  return safeGenerate(
    'enrich-course',
    () =>
      generateStructured(EnrichSchema, prompt, { model: TRAINING_CONTENT_MODEL, maxTokens: 3072 }),
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
