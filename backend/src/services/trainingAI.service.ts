import { z } from 'zod';
import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod';
import { anthropic, ANTHROPIC_MODEL } from '../config/anthropic';

/**
 * Anthropic-backed AI helpers for the Training module.
 *
 * All four endpoints use messages.parse() + Zod so the controller receives a
 * typed object — no JSON.parse / try/catch needed at the call site.
 */

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

  const r = await anthropic.messages.parse({
    model: ANTHROPIC_MODEL,
    max_tokens: 3072,
    messages: [{ role: 'user', content: prompt }],
    output_config: { format: zodOutputFormat(TrainingPlanSchema) },
  });
  return r.parsed_output!;
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

  const r = await anthropic.messages.parse({
    model: ANTHROPIC_MODEL,
    max_tokens: 3072,
    messages: [{ role: 'user', content: prompt }],
    output_config: { format: zodOutputFormat(InterviewQuestionsSchema) },
  });
  return r.parsed_output!;
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
      points: z.number().default(1),
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

  const r = await anthropic.messages.parse({
    model: ANTHROPIC_MODEL,
    max_tokens: 3072,
    messages: [{ role: 'user', content: prompt }],
    output_config: { format: zodOutputFormat(QuizSchema) },
  });
  return r.parsed_output!;
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

  const r = await anthropic.messages.parse({
    model: ANTHROPIC_MODEL,
    max_tokens: 2048,
    messages: [{ role: 'user', content: prompt }],
    output_config: { format: zodOutputFormat(SkillGapSchema) },
  });
  return r.parsed_output!;
}
