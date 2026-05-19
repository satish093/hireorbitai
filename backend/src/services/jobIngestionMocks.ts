// ---------------------------------------------------------------------------
// Synthetic-data mode for the Plan B job-ingestion drivers.
//
// When `process.env.JOB_SOURCES_MOCK === 'true'`, fetchLinkedIn / fetchJSearch
// / fetchAdzuna short-circuit before making any HTTP call and return the
// arrays generated below. The whole point is to verify the pipeline end-to-
// end — migration applied → source rows active → scheduler picks them up →
// driver invoked → dedup → upsert → SSE notify → frontend renders — without
// burning any RapidAPI / Adzuna quota.
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

// Fictional companies. Clearly fake so a reviewer skimming the jobs list
// can spot test data at a glance. Rotated by index.
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

/**
 * Generate N synthetic NormalizedJob rows for one driver call. The data is
 * marked as mock via the `external_id` prefix and the `[MOCK]` description
 * prefix so it's impossible to mistake for a real posting.
 */
function buildMockJobs(args: {
  source: NormalizedJob['source'];
  slug: string;
  publisher: NormalizedJob['publisher'];
  count?: number;
  /** Override the title; otherwise derived from the slug. */
  titleOverride?: string;
}): NormalizedJob[] {
  const count = args.count ?? 5;
  const title = (args.titleOverride ?? humanizeSlug(args.slug)).trim() || 'Software Engineer';
  // Stable hash of the slug so external_ids are reproducible across runs.
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
        `[MOCK] This is synthetic data for Plan B testing. Set ` +
        `JOB_SOURCES_MOCK=false to disable. Source: ${args.source}. Slug: ` +
        `${args.slug || '(none)'}. Publisher: ${args.publisher ?? '(none)'}.`,
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

/** LinkedIn mock — slug is a job title. Publisher is always LinkedIn. */
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

/**
 * JSearch mock — slug is a pipe-delimited query list. Each chunk may include
 * a `site:<domain>` operator which we use to set the publisher field. Matches
 * the real driver's normalizePublisher() behaviour.
 */
export function mockJSearch(slug: string | null): NormalizedJob[] {
  const queries = (slug ?? 'software engineer')
    .split('|')
    .map((s) => s.trim())
    .filter(Boolean);
  return queries.flatMap((q) => {
    const publisher = publisherFromQuery(q);
    const titleOverride = q
      .replace(/site:\S+/gi, '')
      .replace(/\s+/g, ' ')
      .trim();
    return buildMockJobs({
      source: 'jsearch',
      slug: q,
      publisher,
      titleOverride,
      count: 4,
    });
  });
}

/** Adzuna mock — slug is unused by the real driver. Publisher stays null. */
export function mockAdzuna(_slug: string | null): NormalizedJob[] {
  return buildMockJobs({
    source: 'adzuna',
    slug: 'adzuna-default',
    publisher: null,
    titleOverride: 'Software Engineer',
    count: 5,
  });
}

// --- helpers ---------------------------------------------------------------

function publisherFromQuery(q: string): NormalizedJob['publisher'] {
  const lower = q.toLowerCase();
  if (lower.includes('site:linkedin.com')) return 'LinkedIn';
  if (lower.includes('site:dice.com')) return 'Dice';
  if (lower.includes('site:monster.com')) return 'Monster';
  if (lower.includes('site:careerbuilder.com')) return 'CareerBuilder';
  if (lower.includes('site:indeed.com')) return 'Indeed';
  return null;
}

function humanizeSlug(slug: string): string {
  // Drop site: operators and pipe separators so the title reads naturally.
  return slug
    .replace(/site:\S+/gi, '')
    .replace(/\|.*$/, '')
    .trim();
}

function simpleHash(s: string): number {
  let h = 5381;
  for (let i = 0; i < s.length; i++) {
    h = ((h << 5) + h + s.charCodeAt(i)) >>> 0;
  }
  return h;
}
