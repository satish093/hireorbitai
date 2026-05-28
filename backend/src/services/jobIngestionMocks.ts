// Synthetic-data mode. Set JOB_SOURCES_MOCK=true to skip real HTTP calls.
// Cleanup: DELETE FROM public.jobs WHERE external_id LIKE 'MOCK-%';

import type { NormalizedJob } from './jobIngestion.service';

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
const BOARDS = ['Dice', 'Monster', 'CareerBuilder'];

function buildMockJobs(args: {
  slug: string;
  count?: number;
  titleOverride?: string;
}): NormalizedJob[] {
  const count = args.count ?? 5;
  const title = (args.titleOverride ?? args.slug).trim() || 'Software Engineer';
  const slugHash = simpleHash(args.slug || 'default')
    .toString(36)
    .slice(0, 6);
  const out: NormalizedJob[] = [];
  for (let i = 0; i < count; i++) {
    const company = COMPANIES[i % COMPANIES.length]!;
    const location = LOCATIONS[i % LOCATIONS.length]!;
    const board = BOARDS[i % BOARDS.length]!;
    const externalId = `MOCK-jooble-${slugHash}-${String(i).padStart(2, '0')}`;
    out.push({
      source: 'jooble',
      external_id: externalId,
      title: `${title} (TEST DATA)`,
      company_name: company,
      description: `[MOCK] Synthetic data. Board: ${board}. Set JOB_SOURCES_MOCK=false to disable.`,
      location,
      remote: location.startsWith('Remote'),
      job_type: 'FTE',
      level: i % 3 === 0 ? 'Senior' : 'Mid',
      required_skills: [],
      rate_min: 80 + i * 10,
      rate_max: 120 + i * 10,
      apply_url: `https://example.com/mock-job/${externalId}`,
      posted_at: new Date(Date.now() - i * 3600 * 1000).toISOString(),
      publisher: board,
    });
  }
  return out;
}

/** Jooble mock — returns synthetic Dice/Monster/CareerBuilder jobs. */
export function mockJooble(slug: string | null): NormalizedJob[] {
  const queries = (slug ?? 'software engineer|data engineer|java developer')
    .split('|')
    .map((s) => s.trim())
    .filter(Boolean);
  return queries.flatMap((q) => buildMockJobs({ slug: q, titleOverride: q, count: 5 }));
}

function simpleHash(s: string): number {
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) >>> 0;
  return h;
}
