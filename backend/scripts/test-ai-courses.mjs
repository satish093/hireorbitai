/**
 * Standalone AI course-feature smoke test.
 * Run: node --env-file=backend/scripts/.env.ai-test backend/scripts/test-ai-courses.mjs
 * (or set ANTHROPIC_API_KEY in the environment before running)
 *
 * Tests every AI path touched by the training module:
 *   1. Course outline generation
 *   2. Lesson content generation
 *   3. Quiz generation
 *   4. Course enrichment (meta + capstone)
 *
 * Does NOT require a database. Uses the Anthropic SDK directly
 * so it works on any machine with Node 22 + the @anthropic-ai/sdk package.
 */

import Anthropic from '@anthropic-ai/sdk';

const KEY = process.env.ANTHROPIC_API_KEY;
if (!KEY || !KEY.startsWith('sk-ant-')) {
  console.error('Set ANTHROPIC_API_KEY before running this script.');
  process.exit(1);
}

const client = new Anthropic({ apiKey: KEY, maxRetries: 0 });
const MODEL = process.env.ANTHROPIC_MODEL ?? 'claude-haiku-4-5-20251001';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function extractJson(raw) {
  let text = raw
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```\s*$/, '')
    .trim();
  const start = text.search(/[\[{]/);
  if (start < 0) return text;
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
  return text.slice(start);
}

async function callAI(system, user, maxTokens = 2048) {
  const res = await client.messages.create({
    model: MODEL,
    max_tokens: maxTokens,
    system,
    messages: [{ role: 'user', content: user }],
  });
  if (res.stop_reason === 'max_tokens') throw new Error(`Truncated at ${maxTokens} tokens`);
  const block = res.content[0];
  const raw = block?.type === 'text' ? block.text.trim() : '{}';
  return JSON.parse(extractJson(raw));
}

let passed = 0,
  failed = 0;

async function test(name, fn) {
  const t0 = Date.now();
  process.stdout.write(`  ${name} ... `);
  try {
    const result = await fn();
    const ms = Date.now() - t0;
    console.log(`PASS (${ms}ms)`);
    if (process.env.VERBOSE) console.log(JSON.stringify(result, null, 2));
    passed++;
    return result;
  } catch (err) {
    const ms = Date.now() - t0;
    console.log(`FAIL (${ms}ms)`);
    console.error(`    ↳ ${err.message}`);
    failed++;
    return null;
  }
}

// ---------------------------------------------------------------------------
// Test data
// ---------------------------------------------------------------------------

const SAMPLE_COURSE = {
  title: 'Modern React Development',
  category: 'Frontend',
  difficulty: 'Intermediate',
  target_audience: 'Mid-level JavaScript developers moving to React',
  lessons: ['React Hooks Deep Dive', 'State Management with Zustand', 'Performance Optimization'],
};

const SAMPLE_LESSON_CONTENT = `
# React Hooks Deep Dive

React Hooks were introduced in React 16.8 to allow using state and lifecycle features in function components.

## Core Hooks

**useState** manages local component state. It returns a tuple of the current value and a setter.

**useEffect** runs side effects after renders. The dependency array controls when it re-runs:
- Empty array: run once on mount
- No array: run after every render
- With deps: run when any dep changes

**useCallback** memoizes a function reference. Use it to prevent unnecessary child re-renders when passing callbacks as props.

**useMemo** memoizes an expensive computation result. Use it sparingly — the overhead of memoization can exceed the savings for cheap computations.

## Custom Hooks

Custom hooks are functions starting with "use" that call other hooks. They let you extract and share stateful logic across components without changing the component hierarchy.

Example: a \`useDebounce\` hook delays updating a value until N ms after the last change, preventing excessive re-renders on rapid input.

## Key Takeaways
- Hooks must be called at the top level (no conditionals)
- Custom hooks enable logic reuse without HOCs or render props
- Prefer useCallback/useMemo only when profiling shows a real bottleneck
`.trim();

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

console.log(`\nAI Course Feature Smoke Test`);
console.log(`Model: ${MODEL}`);
console.log(`─`.repeat(50));

// 1. Course outline
const OUTLINE_SYSTEM = `You are an expert instructional designer. Generate a complete course outline for a professional online course. Return ONLY valid JSON matching this exact structure — no prose outside the JSON:
{
  "overview": "string (2-3 sentences)",
  "learning_objectives": ["string", ...],
  "skills_taught": ["string", ...],
  "expected_outcomes": ["string", ...],
  "roadmap": [{ "phase": "string", "duration_label": "string", "focus_areas": ["string"] }],
  "resources": [{ "title": "string", "url": "string (https://...)", "type": "DOC|VIDEO|ARTICLE|TOOL" }],
  "completion_criteria": { "minimum_time_minutes": number, "quiz_passing_score": number, "quiz_max_attempts": number, "requires_manager_approval": boolean },
  "estimated_duration_hours": number,
  "lessons": [{ "title": "string", "summary": "string", "objective": "string", "estimated_minutes": number }]
}`;

const outline = await test('1. generateCourseOutline', async () => {
  const result = await callAI(
    OUTLINE_SYSTEM,
    `Course: ${SAMPLE_COURSE.title}\nCategory: ${SAMPLE_COURSE.category}\nDifficulty: ${SAMPLE_COURSE.difficulty}\nTarget audience: ${SAMPLE_COURSE.target_audience}\nGenerate an outline with 4-6 lessons.`,
    3072,
  );
  if (!result.overview) throw new Error('Missing overview');
  if (!Array.isArray(result.lessons) || result.lessons.length < 2)
    throw new Error('Missing or too few lessons');
  if (!Array.isArray(result.learning_objectives) || result.learning_objectives.length === 0)
    throw new Error('Missing learning_objectives');
  if (typeof result.completion_criteria?.quiz_passing_score !== 'number')
    throw new Error('Missing completion_criteria');
  return result;
});

// 2. Lesson content
const LESSON_SYSTEM = `You are an expert technical writer creating an online course lesson. Return ONLY valid JSON:
{
  "body": "markdown string (the full lesson — headings, paragraphs, code blocks)",
  "key_takeaways": ["string", ...],
  "quiz": [{ "question": "string", "options": ["A","B","C","D"], "correct_answer": "string (exact match of one option)", "explanation": "string", "points": 1 }]
}
CRITICAL: correct_answer MUST be copied exactly from one of the options strings.`;

const lessonResult = await test('2. generateLessonContent', async () => {
  const result = await callAI(
    LESSON_SYSTEM,
    `Course: ${SAMPLE_COURSE.title} (${SAMPLE_COURSE.category}, ${SAMPLE_COURSE.difficulty})\nLesson: ${SAMPLE_COURSE.lessons[0]}\nGenerate the full lesson with 3 quiz questions.`,
    4096,
  );
  if (!result.body || result.body.length < 200) throw new Error('Body too short');
  if (!Array.isArray(result.quiz) || result.quiz.length < 2) throw new Error('Missing quiz');
  // Validate correct_answer is in options (the bug we just fixed)
  for (const q of result.quiz) {
    if (!q.options.includes(q.correct_answer)) {
      throw new Error(
        `correct_answer "${q.correct_answer}" not in options: ${q.options.join(', ')}`,
      );
    }
  }
  return result;
});

// 3. Quiz generation (standalone)
const QUIZ_SYSTEM = `You are a certified instructional designer writing formative assessments.
RULES:
- correct_answer must be the EXACT TEXT of one of the options array items (copy-paste identical).
- explanation: 1-2 sentences from the lesson content.
- points: 1 for recall; 2 for analysis.
Return valid JSON only: { "questions": [{ "question": "...", "options": ["A","B","C","D"], "correct_answer": "...", "explanation": "...", "points": 1 }] }`;

await test('3. generateQuiz (standalone)', async () => {
  const result = await callAI(
    QUIZ_SYSTEM,
    `LESSON CONTENT:\n\n${SAMPLE_LESSON_CONTENT}\n\nGenerate exactly 5 questions.`,
    2048,
  );
  if (!Array.isArray(result.questions) || result.questions.length < 3)
    throw new Error('Too few questions');
  const broken = result.questions.filter((q) => !q.options.includes(q.correct_answer));
  if (broken.length > 0) {
    throw new Error(
      `${broken.length} question(s) have correct_answer not in options (the hallucination bug)`,
    );
  }
  return result;
});

// 4. Course enrichment
const ENRICH_SYSTEM = `You are an instructional designer enriching an existing course. Given a course title, category, difficulty, and lesson list, generate the surrounding metadata. Return ONLY valid JSON:
{
  "overview": "string",
  "learning_objectives": ["string"],
  "skills_taught": ["string"],
  "expected_outcomes": ["string"],
  "roadmap": [{ "phase": "string", "duration_label": "string", "focus_areas": ["string"] }],
  "resources": [{ "title": "string", "url": "string", "type": "DOC|VIDEO|ARTICLE|TOOL" }],
  "completion_criteria": { "minimum_time_minutes": 0, "quiz_passing_score": 70, "quiz_max_attempts": 3, "requires_manager_approval": false },
  "capstone": { "assessment_type": "PROJECT|QUIZ|SHORT_ANSWER|PRESENTATION", "instructions": "string", "questions": [{ "prompt": "string", "guidance": "string" }], "rubric": [{ "criterion": "string", "weight": 25 }] }
}`;

await test('4. enrichCourseMeta', async () => {
  const result = await callAI(
    ENRICH_SYSTEM,
    [
      `Course title: ${SAMPLE_COURSE.title}`,
      `Category: ${SAMPLE_COURSE.category}`,
      `Difficulty: ${SAMPLE_COURSE.difficulty}`,
      `Target audience: ${SAMPLE_COURSE.target_audience}`,
      `Existing lessons:\n- ${SAMPLE_COURSE.lessons.join('\n- ')}`,
    ].join('\n'),
    3072,
  );
  if (!result.overview) throw new Error('Missing overview');
  if (!result.capstone?.instructions) throw new Error('Missing capstone');
  if (!Array.isArray(result.resources)) throw new Error('Missing resources');
  return result;
});

// ---------------------------------------------------------------------------
// Summary
// ---------------------------------------------------------------------------

console.log(`─`.repeat(50));
console.log(`Results: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
