// ---------------------------------------------------------------------------
// Synthetic-data mode for the four-source job-ingestion drivers.
//
// When `process.env.JOB_SOURCES_MOCK === 'true'`, fetchDice / fetchLinkedIn
// / fetchMonster / fetchCareerBuilder short-circuit before making any HTTP
// call and return the arrays generated below. The whole point is to verify
// the pipeline end-to-end — migration applied → source rows active →
// scheduler picks them up → driver invoked → dedup → upsert → SSE notify →
// frontend renders — without burning any RapidAPI quota or Playwright.
//
// External IDs are deterministic per (source, slug, index) so re-running the
// sync replays the same rows. That lets the upsert path test the dedup
// branch (existing rows get refreshed, no duplicates). Cleanup is one query:
//   DELETE FROM public.jobs WHERE external_id LIKE 'MOCK-%';
// ---------------------------------------------------------------------------

import type { NormalizedJob } from './jobIngestion.service';

/** Toggle. Cheap to call — drivers check this on every invocation. */
export function mockEnabled(): boolean {
  return process.env.JOB_SOURCES_MOCK === 'true';
}

const COMPANIES = [
  'Acme Test Co',
  'Stark Industries',
  'Wayne Enterprises',
  'Umbrella Corp',
  'Cyberdyne Systems',
];

const LOCATIONS = [
  'Remote — United States',
  'San Francisco, CA',
  'New York, NY',
  'Austin, TX',
  'Seattle, WA',
];

const SKILLS_POOL = [
  ['TypeScript', 'React', 'Node.js'],
  ['Python', 'AWS', 'PostgreSQL'],
  ['Java', 'Spring Boot', 'Kubernetes'],
  ['Go', 'gRPC', 'Docker'],
  ['Salesforce', 'Apex', 'Lightning'],
];

function buildMockJobs(args: {
  source: NormalizedJob['source'];
  slug: string;
  publisher: NormalizedJob['publisher'];
  count?: number;
  titleOverride?: string;
}): NormalizedJob[] {
  const count = args.count ?? 5;
  const title = (args.titleOverride ?? humanizeSlug(args.slug)).trim() || 'Software Engineer';
  const slugHash = simpleHash(args.slug || 'default')
    .toString(36)
    .slice(0, 6);
  const out: NormalizedJob[] = [];
  for (let i = 0; i < count; i++) {
    const company = COMPANIES[i % COMPANIES.length]!;
    const location = LOCATIONS[i % LOCATIONS.length]!;
    const skills = SKILLS_POOL[i % SKILLS_POOL.length]!;
    const externalId = `MOCK-${args.source}-${slugHash}-${String(i).padStart(2, '0')}`;
    out.push({
      source: args.source,
      external_id: externalId,
      title: `${title} (TEST DATA)`,
      company_name: company,
      description:
        `[MOCK] Synthetic data. Set JOB_SOURCES_MOCK=false to disable. ` +
        `Source: ${args.source}. Slug: ${args.slug || '(none)'}. Publisher: ${args.publisher ?? '(none)'}.`,
      location,
      remote: location.startsWith('Remote'),
      job_type: 'FTE',
      level: i % 3 === 0 ? 'Senior' : 'Mid',
      required_skills: skills,
      rate_min: 80 + i * 10,
      rate_max: 120 + i * 10,
      apply_url: `https://example.com/mock-job/${externalId}`,
      posted_at: new Date(Date.now() - i * 3600 * 1000).toISOString(),
      publisher: args.publisher,
    });
  }
  return out;
}

/** LinkedIn mock — slug is a pipe-separated title list. */
export function mockLinkedIn(slug: string | null): NormalizedJob[] {
  const titles = (slug ?? 'Software Engineer|Data Engineer|Full Stack Developer')
    .split('|')
    .map((s) => s.trim())
    .filter(Boolean);
  return titles.flatMap((t) =>
    buildMockJobs({
      source: 'linkedin',
      slug: t,
      publisher: 'LinkedIn',
      titleOverride: t,
      count: 3,
    }),
  );
}

/** Dice mock — slug is the search query. */
export function mockDice(slug: string | null): NormalizedJob[] {
  const queries = (slug ?? 'software engineer|data engineer|java developer')
    .split('|')
    .map((s) => s.trim())
    .filter(Boolean);
  return queries.flatMap((q) =>
    buildMockJobs({ source: 'dice', slug: q, publisher: 'Dice', titleOverride: q, count: 4 }),
  );
}

/** Monster mock — slug is "keyword" or "keyword|location". */
export function mockMonster(slug: string | null): NormalizedJob[] {
  const keyword = slug?.split('|')[0]?.trim() ?? 'software engineer';
  return buildMockJobs({
    source: 'monster',
    slug: keyword,
    publisher: 'Monster',
    titleOverride: keyword,
    count: 4,
  });
}

/** CareerBuilder mock — slug is the search query. */
export function mockCareerBuilder(slug: string | null): NormalizedJob[] {
  const queries = (slug ?? 'software engineer|data engineer|java developer')
    .split('|')
    .map((s) => s.trim())
    .filter(Boolean);
  return queries.flatMap((q) =>
    buildMockJobs({
      source: 'careerbuilder',
      slug: q,
      publisher: 'CareerBuilder',
      titleOverride: q,
      count: 4,
    }),
  );
}

// --- helpers ---------------------------------------------------------------

function humanizeSlug(slug: string): string {
  return slug.replace(/\|.*$/, '').trim();
}

function simpleHash(s: string): number {
  let h = 5381;
  for (let i = 0; i < s.length; i++) {
    h = ((h << 5) + h + s.charCodeAt(i)) >>> 0;
  }
  return h;
}
