/**
 * Rule-based resume analysis — zero AI tokens.
 *
 * Replaces Anthropic calls for scoring, profile parsing, job-requirement
 * extraction, skill-match scoring, and batch job matching.  Results are
 * deterministic and fast; quality is slightly lower than a model but
 * sufficient for the UI features (score cards, profile fields, match ranks).
 *
 * The existing `atsScore()` function (already free) is used as the backbone
 * for all matching functions here.
 */

import { normalizeSkills, extractKnownSkills, diffSkills } from './skillNorm';
import { atsScore } from './atsScore.service';
import type {
  ResumeScoreResult,
  ResumeProfile,
  JobRequirements,
  SkillMatchResult,
  JobMatchResult,
} from './ai.service';

// ---------------------------------------------------------------------------
// Shared constants
// ---------------------------------------------------------------------------

const ACTION_VERB_SET = new Set([
  'led',
  'built',
  'reduced',
  'increased',
  'shipped',
  'architected',
  'designed',
  'implemented',
  'launched',
  'negotiated',
  'developed',
  'created',
  'established',
  'automated',
  'optimized',
  'improved',
  'managed',
  'delivered',
  'deployed',
  'migrated',
  'refactored',
  'integrated',
  'collaborated',
  'scaled',
  'drove',
  'spearheaded',
  'oversaw',
  'mentored',
  'coordinated',
  'analyzed',
  'streamlined',
  'consolidated',
  'revamped',
  'pioneered',
  'accelerated',
  'secured',
  'resolved',
  'enhanced',
  'generated',
  'transformed',
  'modernized',
  'standardized',
  'formulated',
  'crafted',
  'published',
  'presented',
  'researched',
  'engineered',
  'orchestrated',
  'provisioned',
  'configured',
  'monitored',
  'audited',
  'directed',
  'facilitated',
  'defined',
  'identified',
  'eliminated',
  'contributed',
  'wrote',
  'trained',
  'built',
  'owned',
  'shaped',
  'grew',
  'won',
  'closed',
  'recruited',
  'hired',
  'onboarded',
  'advised',
  'consulted',
  'reviewed',
  'approved',
  'launched',
]);

const FILLER_PHRASES = [
  'team player',
  'detail-oriented',
  'self-motivated',
  'hard worker',
  'results-driven',
  'dynamic',
  'passionate about',
  'strong communication',
  'go-getter',
  'proactive',
  'synergy',
  'leverage',
  'utilize',
];

// ---------------------------------------------------------------------------
// Dimension scorers (each 0–20)
// ---------------------------------------------------------------------------

function scoreQuantifiedImpact(text: string): number {
  const lines = text.split('\n').filter((l) => /^\s*[-•*]\s/.test(l));
  if (lines.length === 0) return 10;
  const re =
    /\d+\s*%|\$\s*\d+|\d+\s*[KMBkmb]\b|\d+\s*(users?|clients?|engineers?|people|teams?|customers?|employees?|repos?|hrs?|hours?|minutes?|days?|months?)/i;
  const withMetrics = lines.filter((l) => re.test(l)).length;
  return Math.min(20, Math.round((withMetrics / lines.length) * 20));
}

function scoreActionVerbs(text: string): number {
  const bullets = text.split('\n').filter((l) => /^\s*[-•*]\s/.test(l));
  if (bullets.length === 0) return 10;
  let strong = 0;
  for (const b of bullets) {
    const first =
      b
        .replace(/^\s*[-•*]\s+/, '')
        .split(/\s+/)[0]
        ?.toLowerCase() ?? '';
    if (ACTION_VERB_SET.has(first)) strong++;
  }
  return Math.min(20, Math.round((strong / bullets.length) * 20));
}

function scoreAtsFormatting(text: string): number {
  const lower = text.toLowerCase();
  let score = 20;
  if (!/\b(work\s+experience|professional\s+experience|experience)\b/.test(lower)) score -= 6;
  if (!/\bskills\b/.test(lower)) score -= 4;
  if (!/\beducation\b/.test(lower)) score -= 4;
  if (/\|/.test(text)) score -= 6; // table characters
  return Math.max(0, score);
}

function scoreSkillsDepth(text: string): number {
  const n = extractKnownSkills(text).length;
  if (n >= 12) return 20;
  if (n >= 8) return 15;
  if (n >= 5) return 10;
  if (n >= 2) return 5;
  return 0;
}

function scoreClarityBrevity(text: string): number {
  let score = 20;
  const bullets = text.split('\n').filter((l) => /^\s*[-•*]\s/.test(l));
  if (bullets.length > 0) {
    const avg = bullets.reduce((s, b) => s + b.split(/\s+/).length, 0) / bullets.length;
    if (avg > 25) score -= 10;
    else if (avg > 18) score -= 5;
  }
  const lower = text.toLowerCase();
  const fillers = FILLER_PHRASES.filter((f) => lower.includes(f)).length;
  score -= Math.min(10, fillers * 3);
  return Math.max(0, score);
}

// ---------------------------------------------------------------------------
// scoreResumeRuleBased
// ---------------------------------------------------------------------------

export function scoreResumeRuleBased(resumeText: string): ResumeScoreResult {
  const qi = scoreQuantifiedImpact(resumeText);
  const av = scoreActionVerbs(resumeText);
  const af = scoreAtsFormatting(resumeText);
  const sd = scoreSkillsDepth(resumeText);
  const cb = scoreClarityBrevity(resumeText);

  const strengths: string[] = [];
  const weaknesses: string[] = [];
  const suggestions: string[] = [];

  if (qi >= 14) strengths.push('Good use of quantified metrics and numbers');
  else {
    weaknesses.push('Few or no quantified achievements');
    suggestions.push('Add numbers, percentages, or $ amounts to at least 2 bullets per role');
  }
  if (av >= 14) strengths.push('Strong action verbs throughout');
  else {
    weaknesses.push('Weak or passive language in bullet points');
    suggestions.push(
      'Start each bullet with a strong action verb (Led, Built, Reduced, Shipped, Automated…)',
    );
  }
  if (af >= 16) strengths.push('ATS-friendly formatting with standard headings');
  else {
    weaknesses.push('Non-standard formatting that may confuse ATS parsers');
    suggestions.push(
      'Use only standard headings: Summary, Skills, Work Experience, Education, Certifications',
    );
  }
  if (sd >= 14) strengths.push('Strong skills section with good breadth');
  else {
    weaknesses.push('Skills section is thin or lacks technical depth');
    suggestions.push(
      'List at least 8 distinct skills with versions where possible (e.g. React 18, Python 3.11)',
    );
  }
  if (cb >= 14) strengths.push('Clear, concise bullet points');
  else {
    weaknesses.push('Some bullets are too long or contain filler phrases');
    suggestions.push(
      'Keep each bullet under 2 lines; remove phrases like "team player" or "detail-oriented"',
    );
  }

  return {
    score: qi + av + af + sd + cb,
    score_breakdown: {
      quantified_impact: qi,
      action_verbs: av,
      ats_formatting: af,
      skills_depth: sd,
      clarity_brevity: cb,
    },
    strengths,
    weaknesses,
    suggestions,
  };
}

// ---------------------------------------------------------------------------
// Helpers for profile parsing
// ---------------------------------------------------------------------------

interface ExpItem {
  company: string;
  title: string;
  start_date: string | null;
  end_date: string | null;
  is_current: boolean;
  description: string | null;
}

interface EduItem {
  institution: string;
  degree: string | null;
  field: string | null;
  graduation_year: number | null;
}

const DATE_RE =
  /((?:Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:tember)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)\s+)?\d{4}\s*[-–—]\s*((?:Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:tember)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)\s+)?(\d{4}|[Pp]resent|[Cc]urrent)/i;

function parseExperiences(content: string): ExpItem[] {
  const results: ExpItem[] = [];
  // Split on blank lines to get candidate blocks
  const blocks = content.split(/\n{2,}/);

  for (const block of blocks) {
    const lines = block
      .split('\n')
      .map((l) => l.trim())
      .filter(Boolean);
    if (lines.length === 0) continue;

    const dateMatch = block.match(DATE_RE);
    if (!dateMatch) continue; // skip blocks with no date range (not an experience entry)

    const dateStr = dateMatch[0];
    const dateParts = dateStr.split(/\s*[-–—]\s*/);
    const isCurrent = /present|current/i.test(dateParts[1] ?? '');

    // Header lines = non-bullet, non-date lines
    const headers = lines.filter((l) => !/^[-•*]/.test(l) && !DATE_RE.test(l)).slice(0, 2);

    const bullets = lines.filter((l) => /^[-•*]/.test(l));

    results.push({
      title: headers[0] ?? '',
      company: headers[1] ?? '',
      start_date: dateParts[0]?.trim() ?? null,
      end_date: isCurrent ? 'Present' : (dateParts[1]?.trim() ?? null),
      is_current: isCurrent,
      description: bullets.join('\n') || null,
    });
  }

  return results.filter((e) => e.title || e.company);
}

function parseEducation(content: string): EduItem[] {
  const results: EduItem[] = [];
  const DEGREE_RE =
    /\b(b\.?s\.?|b\.?a\.?|m\.?s\.?|m\.?b\.?a\.?|ph\.?d\.?|bachelor|master|associate|doctorate|b\.?tech|m\.?tech)\b/i;
  const YEAR_RE = /\b(19|20)\d{2}\b/;

  const blocks = content.split(/\n{2,}/);
  for (const block of blocks) {
    const lines = block
      .split('\n')
      .map((l) => l.trim())
      .filter((l) => !/^[-•*]/.test(l));
    if (lines.length === 0) continue;

    const degreeLine = lines.find((l) => DEGREE_RE.test(l));
    const institutionLine = lines.find((l) => !DEGREE_RE.test(l) && l.length > 3);
    const yearMatch = block.match(YEAR_RE);

    if (degreeLine || institutionLine) {
      results.push({
        institution: institutionLine ?? degreeLine ?? '',
        degree: degreeLine ?? null,
        field: null,
        graduation_year: yearMatch ? parseInt(yearMatch[0]) : null,
      });
    }
  }
  return results;
}

function computeYearsFromExperiences(experiences: ExpItem[]): number | null {
  const YEAR_RE = /\b(19|20)(\d{2})\b/;
  let earliest = Infinity;
  let latest = 0;
  for (const exp of experiences) {
    const sy = exp.start_date?.match(YEAR_RE);
    if (sy) earliest = Math.min(earliest, parseInt(sy[0]));
    if (exp.is_current) latest = new Date().getFullYear();
    else {
      const ey = exp.end_date?.match(YEAR_RE);
      if (ey) latest = Math.max(latest, parseInt(ey[0]));
    }
  }
  if (earliest === Infinity || latest === 0) return null;
  return Math.max(0, latest - earliest);
}

// ---------------------------------------------------------------------------
// parseResumeProfileRuleBased
// ---------------------------------------------------------------------------

export function parseResumeProfileRuleBased(text: string): ResumeProfile {
  // Strip template boilerplate before any extraction
  const cleanedText = text
    .replace(/\(Tip:[^)]*\)/gi, '')
    .replace(/\(Note:[^)]*\)/gi, '')
    .replace(/^.*\bTip:/gim, '')
    .replace(/^\s*Page\s+\d+\s*$/gim, '');

  const lines = cleanedText.split('\n');

  // --- Contact fields — restricted to header block (first 30 lines) ---
  const headerBlock = lines.slice(0, 30).join('\n');

  const emailMatch = headerBlock.match(/[\w.+\-]+@[\w\-]+\.[\w.]+/);
  const email = emailMatch?.[0]?.toLowerCase() ?? null;

  const phoneMatch = headerBlock.match(/(\+?1[\s.\-]?)?\(?\d{3}\)?[\s.\-]\d{3}[\s.\-]\d{4}/);
  const phone = phoneMatch?.[0]?.trim() ?? null;

  const liMatch = cleanedText.match(/linkedin\.com\/in\/([\w\-]+)/i);
  const linkedin_url = liMatch ? `https://linkedin.com/in/${liMatch[1]}` : null;

  const webMatch = cleanedText.match(/https?:\/\/(?!(?:www\.)?linkedin)[^\s<>"'\)]+/i);
  const website = webMatch?.[0] ?? null;

  // --- Name: restricted to first 10 lines (header block) ---
  // Title Case: "John Smith", "Mary Jane Watson"
  const NAME_TITLE_RE = /^[A-Z][a-z]+(?:\s+[A-Z][a-z]*\.?){1,3}$/;
  // ALL CAPS (common in some PDF extractors): "JOHN SMITH"
  const NAME_ALLCAPS_RE = /^[A-Z]+(?:\s+[A-Z]+\.?){1,3}$/;
  // CamelCase-concatenated (pdf.js drops the space for large display fonts): "HaydenSmith"
  const NAME_CAMEL_RE = /^[A-Z][a-z]+(?:[A-Z][a-z]+){1,3}$/;
  let name: string | null = null;
  for (const raw of lines.slice(0, 10).map((l) => l.trim())) {
    if (!raw || raw.length > 60) continue;
    // Strip markdown heading markers: "# Hayden Smith" → "Hayden Smith"
    const line = raw.replace(/^#{1,3}\s+/, '');
    if (!line || line.length > 50) continue;
    if (email && line.includes(email)) continue;
    if (phone && line.includes(phone)) continue;
    if (line.includes('http') || line.includes('linkedin')) continue;
    if (NAME_TITLE_RE.test(line)) {
      name = line;
      break;
    }
    if (NAME_ALLCAPS_RE.test(line) && line.split(/\s+/).length >= 2) {
      // Convert ALL CAPS to Title Case: "JOHN SMITH" → "John Smith"
      name = line
        .split(/\s+/)
        .map((w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
        .join(' ');
      break;
    }
    if (NAME_CAMEL_RE.test(line)) {
      // Split CamelCase: "HaydenSmith" → "Hayden Smith"
      name = line.replace(/([A-Z])/g, ' $1').trim();
      break;
    }
  }

  // --- Skills ---
  const skills = normalizeSkills(extractKnownSkills(cleanedText));

  // --- Total years of experience ---
  let total_years_experience: number | null = null;
  const yearsMatch = cleanedText.match(
    /(\d+)\+?\s+years?\s+(?:of\s+)?(?:professional\s+)?experience/i,
  );
  if (yearsMatch) total_years_experience = parseInt(yearsMatch[1]!);

  // --- Section splitting ---
  const SECTION_HEADING_RE =
    /^(?:#{1,3}\s+)?([A-Z][A-Z\s&\/]{2,}|Summary|Skills|Experience|Education|Certifications?|Languages?|Projects?|Work Experience|Professional Experience|Objective|Profile|Accomplishments?)\s*:?\s*$/m;

  type Section = { heading: string; content: string };
  const sections: Section[] = [];
  let cur: Section = { heading: 'header', content: '' };

  for (const line of lines) {
    const trimmed = line.trim();
    if (SECTION_HEADING_RE.test(trimmed) && trimmed.length < 60) {
      sections.push(cur);
      cur = {
        heading: trimmed
          .replace(/^#+\s*/, '')
          .toLowerCase()
          .trim(),
        content: '',
      };
    } else {
      cur.content += line + '\n';
    }
  }
  sections.push(cur);

  // --- Summary ---
  const summarySection = sections.find((s) => /summary|profile|objective/i.test(s.heading));
  const summary = summarySection?.content.trim() || null;

  // --- Location (heuristic: "City, ST" or "City, ST ZIP" in header) ---
  // Validated against known US state/territory abbreviations to avoid matching
  // job-title fragments like "Management, VE" (VE is not a US state).
  const US_STATES = new Set([
    'AL',
    'AK',
    'AZ',
    'AR',
    'CA',
    'CO',
    'CT',
    'DE',
    'FL',
    'GA',
    'HI',
    'ID',
    'IL',
    'IN',
    'IA',
    'KS',
    'KY',
    'LA',
    'ME',
    'MD',
    'MA',
    'MI',
    'MN',
    'MS',
    'MO',
    'MT',
    'NE',
    'NV',
    'NH',
    'NJ',
    'NM',
    'NY',
    'NC',
    'ND',
    'OH',
    'OK',
    'OR',
    'PA',
    'RI',
    'SC',
    'SD',
    'TN',
    'TX',
    'UT',
    'VT',
    'VA',
    'WA',
    'WV',
    'WI',
    'WY',
    'DC',
    'PR',
    'GU',
    'VI',
    'AS',
    'MP',
  ]);
  const headerSec = sections.find((s) => s.heading === 'header');
  let location: string | null = null;
  if (headerSec) {
    const locCandidates = [
      ...headerSec.content.matchAll(
        /([A-Z][a-z]+(?:\s+[A-Z][a-z]+){0,2}),\s*([A-Z]{2})(?:\s+\d{5}(?:-\d{4})?)?/g,
      ),
    ];
    const validLoc = locCandidates.find((m) => US_STATES.has(m[2]!));
    location = validLoc ? validLoc[0].trim() : null;
  }

  // --- Experiences ---
  const expSec = sections.find((s) => /experience|work\s*history/i.test(s.heading));
  const experiences = expSec ? parseExperiences(expSec.content) : [];

  // --- Education ---
  const eduSec = sections.find((s) => /education/i.test(s.heading));
  const education = eduSec ? parseEducation(eduSec.content) : [];

  // --- Certifications ---
  const certSec = sections.find((s) => /certif/i.test(s.heading));
  const certifications = certSec
    ? certSec.content
        .split('\n')
        .map((l) => l.replace(/^[-•*]\s*/, '').trim())
        .filter((l) => l.length > 3)
    : [];

  // --- Languages ---
  const langSec = sections.find((s) => /language/i.test(s.heading));
  const languages = langSec
    ? langSec.content
        .split('\n')
        .map((l) => l.replace(/^[-•*]\s*/, '').trim())
        .filter((l) => l.length > 1 && l.length < 40)
    : [];

  // Fallback: compute years from date spans in experiences
  if (!total_years_experience && experiences.length > 0) {
    total_years_experience = computeYearsFromExperiences(experiences);
  }

  return {
    name,
    headline: null,
    email,
    phone,
    location,
    linkedin_url,
    website,
    summary,
    total_years_experience,
    age: null,
    skills,
    experiences,
    education,
    certifications,
    languages,
  };
}

// ---------------------------------------------------------------------------
// extractJobRequirementsRuleBased
// ---------------------------------------------------------------------------

export function extractJobRequirementsRuleBased(input: {
  title: string;
  description?: string | null;
  required_skills?: string[] | null;
  location?: string | null;
}): JobRequirements {
  const text = [input.title, input.description].filter(Boolean).join('\n');

  const required_skills = normalizeSkills([
    ...extractKnownSkills(text),
    ...(input.required_skills ?? []),
  ]);

  // Seniority from title
  const tl = input.title.toLowerCase();
  let job_seniority: string | null = null;
  if (/\b(principal|staff)\b/.test(tl)) job_seniority = 'Principal';
  else if (/\blead\b/.test(tl)) job_seniority = 'Lead/Staff';
  else if (/\bdirector\b/.test(tl)) job_seniority = 'Director';
  else if (/\bmanager\b/.test(tl)) job_seniority = 'Manager';
  else if (/\b(senior|sr\.)\b/.test(tl)) job_seniority = 'Senior';
  else if (/\b(junior|jr\.|entry.level|associate)\b/.test(tl)) job_seniority = 'Entry';
  else if (/\bmid.level\b/.test(tl)) job_seniority = 'Mid';

  // Work model
  let work_model: string | null = null;
  if (/\bremote\b/i.test(text)) work_model = 'Remote';
  else if (/\bhybrid\b/i.test(text)) work_model = 'Hybrid';
  else if (/\b(onsite|on.site|in.office|in.person)\b/i.test(text)) work_model = 'Onsite';

  // Min years
  let min_years_of_experience: number | null = null;
  const yM = text.match(/(\d+)\+?\s+years?\s+(?:of\s+)?(?:professional\s+)?experience/i);
  if (yM) min_years_of_experience = parseInt(yM[1]!);

  const lines = text.split('\n');

  const must_haves = lines
    .filter((l) => /required|must have|must-have/i.test(l) && l.length < 200)
    .map((l) => l.replace(/^[-•*]\s*/, '').trim())
    .filter((l) => l.length > 5)
    .slice(0, 8);

  const nice_to_haves = lines
    .filter((l) => /preferred|nice.to.have|bonus|plus|desired/i.test(l) && l.length < 200)
    .map((l) => l.replace(/^[-•*]\s*/, '').trim())
    .filter((l) => l.length > 5)
    .slice(0, 8);

  // Work authorization
  const work_authorization: string[] = [];
  if (/h.?1.?b/i.test(text)) {
    work_authorization.push(/no\s+sponsor/i.test(text) ? 'No Sponsorship' : 'H1B Sponsor Likely');
  }
  if (/us\s+citizen|citizenship\s+required/i.test(text)) work_authorization.push('US Citizen');
  if (/green\s+card|permanent\s+resident/i.test(text)) work_authorization.push('Green Card');
  if (/security\s+clearance/i.test(text)) work_authorization.push('Security Clearance');
  if (/public\s+trust/i.test(text)) work_authorization.push('Public Trust');

  const core_responsibilities = lines
    .filter((l) => /^[-•*]\s/.test(l))
    .map((l) => l.replace(/^[-•*]\s*/, '').trim())
    .filter((l) => l.length > 10)
    .slice(0, 6);

  return {
    must_haves,
    nice_to_haves,
    required_skills,
    min_years_of_experience,
    job_seniority,
    work_model,
    work_authorization,
    location_requirements: input.location ?? null,
    core_responsibilities,
    skill_summaries: required_skills.slice(0, 5),
    benefits_summaries: [],
    education_summaries: [],
    highlights: [],
    recommendation_tags: [work_model, job_seniority].filter(Boolean) as string[],
  };
}

// ---------------------------------------------------------------------------
// scoreResumeAgainstJobRuleBased
// ---------------------------------------------------------------------------

export async function scoreResumeAgainstJobRuleBased(input: {
  resumeText: string;
  job: {
    title: string;
    description?: string | null;
    required_skills?: string[] | null;
    min_years_of_experience?: number | null;
    job_seniority?: string | null;
  };
}): Promise<SkillMatchResult> {
  const jdText = [
    input.job.title,
    input.job.description,
    ...(input.job.required_skills ?? []),
  ].join(' ');
  const { score, matched_keywords, missing_keywords } = await atsScore(input.resumeText, jdText);

  const normSkills = normalizeSkills(input.job.required_skills ?? extractKnownSkills(jdText));
  const { matched } = diffSkills(normSkills, extractKnownSkills(input.resumeText));
  const matchedSet = new Set(matched.map((s) => s.toLowerCase()));

  const per_skill = normSkills.map((skill) => ({
    skill,
    score: matchedSet.has(skill.toLowerCase()) ? 1.0 : 0,
    evidence: matchedSet.has(skill.toLowerCase()) ? 'Found in resume' : null,
  }));

  let rank_desc: string;
  if (score >= 85) rank_desc = 'Strong Match';
  else if (score >= 70) rank_desc = 'Good Match';
  else if (score >= 50) rank_desc = 'Fair Match';
  else rank_desc = 'Weak Match';

  return {
    per_skill,
    overall_score: score,
    rank_desc,
    feature_scores: {
      skill_match: score / 100,
      seniority_match: 0.75,
      industry_match: 0.5,
    },
    rationale: [
      `Matched ${matched_keywords.length} of ${normSkills.length || matched_keywords.length + missing_keywords.length} required skills.`,
      missing_keywords.length > 0
        ? `Key gaps: ${missing_keywords.slice(0, 5).join(', ')}.`
        : 'All detected skills are present in the resume.',
    ],
  };
}

// ---------------------------------------------------------------------------
// matchJobsForConsultantRuleBased
// ---------------------------------------------------------------------------

export async function matchJobsForConsultantRuleBased(
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

  const profileText =
    consultantProfile.resume_excerpt?.trim() && consultantProfile.resume_excerpt.length > 50
      ? consultantProfile.resume_excerpt
      : consultantProfile.skills.join(', ');

  const hasResume =
    !!consultantProfile.resume_excerpt && consultantProfile.resume_excerpt.trim().length > 50;

  const results: JobMatchResult[] = [];

  for (const job of jobs) {
    const jdText = [job.title, job.description, ...(job.required_skills ?? [])].join(' ');
    const { score, matched_keywords, missing_keywords } = await atsScore(profileText, jdText);
    const adjusted = hasResume ? score : Math.min(score, 79);

    results.push({
      job_id: job.id,
      match_score: adjusted,
      reasons: [
        matched_keywords.length > 0
          ? `Matched: ${matched_keywords.slice(0, 3).join(', ')}${matched_keywords.length > 3 ? ` +${matched_keywords.length - 3} more` : ''}`
          : 'No key skills matched',
        missing_keywords.length > 0
          ? `Missing: ${missing_keywords.slice(0, 3).join(', ')}`
          : 'All key skills present',
      ],
    });
  }

  return results.sort((a, b) => b.match_score - a.match_score);
}
