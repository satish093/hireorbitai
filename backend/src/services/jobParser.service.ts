/**
 * Free, local job-requirement parser.
 *
 * Turns a raw job posting (mostly LinkedIn descriptions, often HTML) into the
 * same `JobRequirements` shape the AI extractor produces — but with $0 cost
 * and no network call. It's heuristic (regex + keyword matching), so it's not
 * as sharp as the LLM, but it reliably surfaces sections, skills, seniority,
 * work model, and authorization flags so the detail panel can render clean
 * structured content for every job.
 *
 * Drop-in replacement for `extractJobRequirements` in jobs.controller.ts.
 */

import type { JobRequirements } from './ai.service';

// ---------------------------------------------------------------------------
// Curated skill dictionary. Word-boundary matched against the description so
// "Java" doesn't match "JavaScript" and "Go" doesn't match "Google". Display
// form is preserved; matching is case-insensitive.
// ---------------------------------------------------------------------------
const SKILL_DICTIONARY: string[] = [
  // languages
  'JavaScript',
  'TypeScript',
  'Python',
  'Java',
  'C++',
  'C#',
  'Go',
  'Golang',
  'Rust',
  'Ruby',
  'PHP',
  'Swift',
  'Kotlin',
  'Scala',
  'Perl',
  'R',
  'MATLAB',
  'Dart',
  'Elixir',
  'Objective-C',
  'Bash',
  'Shell',
  'PowerShell',
  'SQL',
  'PL/SQL',
  'T-SQL',
  'Solidity',
  // frontend
  'React',
  'React Native',
  'Angular',
  'Vue',
  'Vue.js',
  'Svelte',
  'Next.js',
  'Nuxt',
  'Redux',
  'jQuery',
  'HTML',
  'CSS',
  'Sass',
  'SCSS',
  'Tailwind',
  'Bootstrap',
  'Webpack',
  'Vite',
  'Three.js',
  'D3.js',
  'WebGL',
  // backend / frameworks
  'Node.js',
  'Express',
  'NestJS',
  'Django',
  'Flask',
  'FastAPI',
  'Spring',
  'Spring Boot',
  'Rails',
  'Ruby on Rails',
  'Laravel',
  'ASP.NET',
  '.NET',
  'GraphQL',
  'gRPC',
  'REST',
  'Microservices',
  'Kafka',
  'RabbitMQ',
  'Celery',
  // data / ml
  'Pandas',
  'NumPy',
  'TensorFlow',
  'PyTorch',
  'Keras',
  'scikit-learn',
  'Spark',
  'Hadoop',
  'Airflow',
  'dbt',
  'Snowflake',
  'Databricks',
  'Tableau',
  'Power BI',
  'Looker',
  'Machine Learning',
  'Deep Learning',
  'NLP',
  'Computer Vision',
  'LLM',
  'Data Science',
  // databases
  'PostgreSQL',
  'Postgres',
  'MySQL',
  'MongoDB',
  'Redis',
  'Cassandra',
  'DynamoDB',
  'Elasticsearch',
  'SQLite',
  'Oracle',
  'SQL Server',
  'MariaDB',
  'Neo4j',
  'BigQuery',
  // cloud / devops
  'AWS',
  'Azure',
  'GCP',
  'Google Cloud',
  'Docker',
  'Kubernetes',
  'Terraform',
  'Ansible',
  'Jenkins',
  'CircleCI',
  'GitHub Actions',
  'GitLab CI',
  'Helm',
  'Prometheus',
  'Grafana',
  'CI/CD',
  'DevOps',
  'Linux',
  'Nginx',
  'Lambda',
  'EC2',
  'S3',
  'CloudFormation',
  // tools / practice
  'Git',
  'Jira',
  'Figma',
  'Agile',
  'Scrum',
  'Kanban',
  'TDD',
  'Selenium',
  'Cypress',
  'Jest',
  'Playwright',
  'Postman',
  'Salesforce',
  'SAP',
  'Workday',
  'ServiceNow',
];

/** Strip HTML to readable text with newlines preserved at block boundaries. */
function stripHtml(raw: string): string {
  return raw
    .replace(/<\s*(br|\/p|\/li|\/div|\/h[1-6]|\/tr)\s*\/?>/gi, '\n')
    .replace(/<\s*li[^>]*>/gi, '\n• ')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&#39;|&rsquo;|&lsquo;/gi, "'")
    .replace(/&quot;|&ldquo;|&rdquo;/gi, '"')
    .replace(/\r/g, '')
    .replace(/[ \t]{2,}/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

type Section = 'responsibilities' | 'requirements' | 'benefits' | 'education' | null;

const SECTION_PATTERNS: { section: Exclude<Section, null>; re: RegExp }[] = [
  {
    section: 'responsibilities',
    re: /responsibilit|what you('|’)?ll do|the role|day[- ]to[- ]day|duties|you will/i,
  },
  {
    section: 'requirements',
    re: /requirement|qualification|what you('|’)?ll bring|must[- ]have|we('|’)?re looking for|skills|you have|basic qualif|preferred qualif/i,
  },
  { section: 'benefits', re: /benefit|perks?\b|what we offer|we offer|compensation|our offer/i },
  { section: 'education', re: /education|degree/i },
];

/** A line is a section header if it's short and matches a header pattern,
 *  typically ending in ":" or being a standalone heading. */
function headerSection(line: string): Section {
  const trimmed = line.trim();
  if (trimmed.length === 0 || trimmed.length > 60) return null;
  // Heuristic: headers are short, often end in ':' or have no trailing period.
  const looksHeader =
    /:$/.test(trimmed) || (!/[.!?]$/.test(trimmed) && trimmed.split(' ').length <= 7);
  if (!looksHeader) return null;
  for (const { section, re } of SECTION_PATTERNS) {
    if (re.test(trimmed)) return section;
  }
  return null;
}

/** Clean a bullet/line: strip leading markers, collapse spaces. */
function cleanBullet(line: string): string {
  return line
    .replace(/^\s*[•\-*–·▪◦‣]\s*/, '')
    .replace(/^\s*\d+[.)]\s*/, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function dedupe(arr: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const x of arr) {
    const key = x.toLowerCase();
    if (x && !seen.has(key)) {
      seen.add(key);
      out.push(x);
    }
  }
  return out;
}

function detectSkills(text: string, incoming?: string[] | null): string[] {
  const found: string[] = [];
  for (const skill of SKILL_DICTIONARY) {
    // Escape regex specials in the skill, match on word-ish boundaries.
    const esc = skill.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const re = new RegExp(`(^|[^a-zA-Z0-9.+#])${esc}([^a-zA-Z0-9.+#]|$)`, 'i');
    if (re.test(text)) found.push(skill);
  }
  return dedupe([...(incoming ?? []).map((s) => s.trim()).filter(Boolean), ...found]).slice(0, 20);
}

function detectSeniority(text: string): string | null {
  if (/\bprincipal\b/i.test(text)) return 'Principal';
  if (/\b(staff|lead)\b/i.test(text)) return 'Lead/Staff';
  if (/\bdirector\b/i.test(text)) return 'Director';
  if (/\bmanager\b/i.test(text)) return 'Manager';
  if (/\b(senior|sr\.?)\b/i.test(text)) return 'Senior';
  if (/\b(junior|jr\.?|entry[- ]level|associate|intern)\b/i.test(text)) return 'Entry';
  if (/\bmid[- ]?(level|senior)?\b/i.test(text)) return 'Mid';
  return null;
}

function detectWorkModel(text: string, remote?: boolean): string | null {
  if (/\bhybrid\b/i.test(text)) return 'Hybrid';
  if (remote || /\bremote\b/i.test(text)) return 'Remote';
  if (/\bon[- ]?site\b|\bin[- ]office\b|\bonsite\b/i.test(text)) return 'Onsite';
  return null;
}

function detectMinYears(text: string): number | null {
  const matches = [...text.matchAll(/(\d{1,2})\s*\+?\s*(?:years|yrs)\b/gi)];
  const nums = matches.map((m) => parseInt(m[1]!, 10)).filter((n) => n >= 0 && n <= 30);
  return nums.length ? Math.min(...nums) : null;
}

function detectAuthorization(text: string): { auth: string[]; tags: string[] } {
  const auth: string[] = [];
  const tags: string[] = [];
  const noSponsor =
    /\bno (?:visa )?sponsorship\b|without sponsorship|not (?:able to|be able to) sponsor|unable to sponsor/i.test(
      text,
    );
  if (noSponsor) {
    auth.push('No Sponsorship');
    tags.push('No Sponsorship');
  } else if (/\bh-?1b\b|sponsor(?:ship)?/i.test(text)) {
    auth.push('H1B Sponsor Likely');
    tags.push('H1B Sponsor Likely');
  }
  if (/\b(security clearance|secret|ts\/sci|top secret|public trust)\b/i.test(text)) {
    auth.push('Security Clearance');
    tags.push('Security Clearance');
  }
  if (/\bu\.?s\.? citizen/i.test(text)) auth.push('US Citizen');
  if (/\bgreen card\b|permanent resident/i.test(text)) auth.push('Green Card');
  return { auth: dedupe(auth), tags: dedupe(tags) };
}

/**
 * Parse a raw job posting into structured requirements — free, no network.
 */
export function parseJobRequirements(input: {
  title: string;
  description?: string | null;
  required_skills?: string[] | null;
  location?: string | null;
  remote?: boolean | null;
}): JobRequirements {
  const text = stripHtml(input.description ?? '');
  const titleAndText = `${input.title}\n${text}`;
  const lines = text
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l.length > 0);

  // Walk lines, bucketing bullets under the most recent recognised header.
  const buckets: Record<Exclude<Section, null>, string[]> = {
    responsibilities: [],
    requirements: [],
    benefits: [],
    education: [],
  };
  let current: Section = null;
  for (const line of lines) {
    const header = headerSection(line);
    if (header) {
      current = header;
      continue;
    }
    if (!current) continue;
    const bullet = cleanBullet(line);
    // Keep substantive lines only.
    if (bullet.length >= 8 && bullet.length <= 280) buckets[current].push(bullet);
  }

  const core_responsibilities = buckets.responsibilities.slice(0, 8);
  const skill_summaries = buckets.requirements.slice(0, 8);
  const benefits_summaries = buckets.benefits.slice(0, 6);
  const education_summaries = dedupe(
    lines
      .filter((l) => /\b(bachelor|master|b\.?s\.?|m\.?s\.?|phd|degree)\b/i.test(l))
      .map(cleanBullet),
  ).slice(0, 4);

  const nice_to_haves = dedupe(
    buckets.requirements
      .filter((l) => /\b(nice to have|preferred|bonus|a plus|plus)\b/i.test(l))
      .map(cleanBullet),
  ).slice(0, 8);

  const required_skills = detectSkills(titleAndText, input.required_skills);
  const job_seniority = detectSeniority(titleAndText);
  const work_model = detectWorkModel(titleAndText, input.remote ?? undefined);
  const min_years_of_experience = detectMinYears(text);
  const { auth, tags } = detectAuthorization(text);

  // recommendation_tags: authorization flags + work-model badge.
  const recommendation_tags = dedupe([
    ...tags,
    ...(work_model === 'Remote' ? ['Remote'] : []),
    ...(work_model === 'Hybrid' ? ['Hybrid'] : []),
  ]);

  // highlights: short candidate-facing positives from signals + a summary.
  const highlights: string[] = [];
  if (work_model === 'Remote') highlights.push('Remote-friendly role');
  else if (work_model === 'Hybrid') highlights.push('Hybrid work model');
  if (auth.includes('H1B Sponsor Likely')) highlights.push('May sponsor work visas');
  if (job_seniority) highlights.push(`${job_seniority}-level position`);
  // First substantive sentence as a one-line summary.
  const firstSentence = text.split(/(?<=[.!?])\s+/).find((s) => s.trim().length > 40);
  if (firstSentence) highlights.push(firstSentence.trim().slice(0, 160));

  return {
    must_haves: skill_summaries.slice(0, 6),
    nice_to_haves,
    required_skills,
    min_years_of_experience,
    job_seniority,
    work_model,
    work_authorization: auth,
    location_requirements: input.location ?? null,
    core_responsibilities,
    skill_summaries,
    benefits_summaries,
    education_summaries,
    highlights: dedupe(highlights).slice(0, 5),
    recommendation_tags,
  };
}
