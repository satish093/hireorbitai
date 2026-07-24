/**
 * ATS keyword-matching scorer — no AI call, fully deterministic.
 * Extracted into its own module so rule-based services can import it
 * without creating a circular dependency with ai.service.ts.
 */

import { z } from 'zod/v4';
import { extractKnownSkills } from './skillNorm';
import { withCache, atsScoreCache } from './aiCache';
import { AI_MAX_INPUT_CHARS } from '../config/anthropic';

function clip(text: string | null | undefined, max = AI_MAX_INPUT_CHARS): string {
  const s = (text ?? '').trim();
  return s.length > max ? s.slice(0, max) : s;
}

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
 * Scans both the JD and the resume for any skill in the canonical alias table
 * (skillNorm.ts). Score = (matched / jdSkills) × 100. Fast, deterministic,
 * free, and cached.
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
      if (resumeSkillSet.has(skill.toLowerCase())) matched.push(skill);
      else missing.push(skill);
    }

    const total = jdSkills.length || 1;
    const score = Math.round((matched.length / total) * 100);

    const gapPhrase =
      missing.length === 0
        ? 'All identified technical requirements are covered.'
        : `Key gaps: ${missing.slice(0, 3).join(', ')}${missing.length > 3 ? ` and ${missing.length - 3} more` : ''}.`;

    return {
      score,
      matched_keywords: matched,
      missing_keywords: missing,
      summary: `Resume matches ${matched.length} of ${total} technical skills detected in the job description. ${gapPhrase}`,
    };
  });
}
