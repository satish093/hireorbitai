import { describe, it, expect } from 'vitest';
import { parseJobsFromHtml, parseLinkedInGuestCards } from './jobScrape';

// Offline tests for the generic JSON-LD scraper parser — no network.

const JSONLD_PAGE = `
<html><head>
<script type="application/ld+json">
{
  "@context": "https://schema.org",
  "@type": "JobPosting",
  "title": "Senior Java Developer",
  "hiringOrganization": { "@type": "Organization", "name": "Acme Corp" },
  "jobLocation": { "@type": "Place", "address": {
    "@type": "PostalAddress", "addressLocality": "Austin",
    "addressRegion": "TX", "addressCountry": "US" } },
  "datePosted": "2026-05-01",
  "employmentType": "FULL_TIME",
  "description": "<p>Build things with <b>Java</b> and AWS.</p>",
  "skills": "Java, AWS, Spring",
  "url": "https://www.dice.com/job-detail/123",
  "baseSalary": { "@type": "MonetaryAmount", "currency": "USD",
    "value": { "@type": "QuantitativeValue", "minValue": 60, "maxValue": 80, "unitText": "HOUR" } }
}
</script>
</head><body>...</body></html>`;

describe('parseJobsFromHtml — JSON-LD JobPosting', () => {
  it('extracts and normalizes a JobPosting from JSON-LD', () => {
    const jobs = parseJobsFromHtml(JSONLD_PAGE, 'https://www.dice.com/job-detail/123');
    expect(jobs).toHaveLength(1);
    const j = jobs[0]!;
    expect(j.source).toBe('scraper');
    expect(j.title).toBe('Senior Java Developer');
    expect(j.company_name).toBe('Acme Corp');
    expect(j.location).toBe('Austin, TX, US');
    expect(j.rate_min).toBe(60);
    expect(j.rate_max).toBe(80);
    expect(j.posted_at).toBe('2026-05-01');
    expect(j.publisher).toBe('Dice');
    expect(j.required_skills).toEqual(expect.arrayContaining(['Java', 'AWS', 'Spring']));
    expect(j.apply_url).toContain('dice.com');
    // HTML in the description is stripped to text.
    expect(j.description).not.toContain('<');
  });

  it('drops non-hourly salaries (annual would render as $/hr)', () => {
    const annual = JSONLD_PAGE.replace('"unitText": "HOUR"', '"unitText": "YEAR"').replace(
      '"minValue": 60, "maxValue": 80',
      '"minValue": 120000, "maxValue": 160000',
    );
    const j = parseJobsFromHtml(annual, 'https://www.dice.com/job-detail/123')[0]!;
    expect(j.rate_min).toBeNull();
    expect(j.rate_max).toBeNull();
  });

  it('handles @graph-wrapped JSON-LD', () => {
    const graph = `<script type="application/ld+json">
      {"@context":"https://schema.org","@graph":[
        {"@type":"WebSite","name":"x"},
        {"@type":"JobPosting","title":"DevOps Engineer","hiringOrganization":{"name":"Globex"}}
      ]}</script>`;
    const jobs = parseJobsFromHtml(graph, 'https://www.monster.com/jobs/abc');
    expect(jobs).toHaveLength(1);
    expect(jobs[0]!.title).toBe('DevOps Engineer');
    expect(jobs[0]!.company_name).toBe('Globex');
    expect(jobs[0]!.publisher).toBe('Monster');
  });

  it('falls back to OpenGraph meta when no JSON-LD is present', () => {
    const og = `<html><head>
      <meta property="og:title" content="Cloud Architect" />
      <meta property="og:site_name" content="CareerBuilder" />
      <meta property="og:description" content="Design cloud systems." />
      <meta property="og:url" content="https://www.careerbuilder.com/job/xyz" />
    </head><body></body></html>`;
    const jobs = parseJobsFromHtml(og, 'https://www.careerbuilder.com/job/xyz');
    expect(jobs).toHaveLength(1);
    expect(jobs[0]!.title).toBe('Cloud Architect');
    expect(jobs[0]!.company_name).toBe('CareerBuilder');
    expect(jobs[0]!.publisher).toBe('CareerBuilder');
  });

  it('returns nothing for a page with neither JSON-LD nor og:title', () => {
    expect(parseJobsFromHtml('<html><body>no data</body></html>', 'https://x.com')).toEqual([]);
  });
});

describe('parseLinkedInGuestCards — guest endpoint HTML fragment', () => {
  const GUEST = `
  <li>
    <a class="base-card__full-link" href="https://www.linkedin.com/jobs/view/staff-engineer-at-acme-3912345678?trk=x">link</a>
    <h3 class="base-search-card__title">Staff Engineer</h3>
    <h4 class="base-search-card__subtitle">Acme Corp</h4>
    <span class="job-search-card__location">Remote, US</span>
    <time class="job-search-card__listdate" datetime="2026-05-10">2 days ago</time>
  </li>
  <li>
    <a class="base-card__full-link" href="https://www.linkedin.com/jobs/view/data-engineer-globex-3998877665">link</a>
    <h3 class="base-search-card__title">Data Engineer</h3>
    <h4 class="base-search-card__subtitle">Globex</h4>
    <span class="job-search-card__location">Austin, TX</span>
  </li>`;

  it('parses listing-level fields and the numeric job id', () => {
    const jobs = parseLinkedInGuestCards(GUEST);
    expect(jobs).toHaveLength(2);
    expect(jobs[0]).toMatchObject({
      source: 'linkedin',
      title: 'Staff Engineer',
      company_name: 'Acme Corp',
      location: 'Remote, US',
      external_id: '3912345678',
      remote: true,
      posted_at: '2026-05-10',
      publisher: 'LinkedIn',
    });
    expect(jobs[0]!.apply_url).toContain('/jobs/view/');
    expect(jobs[1]!.external_id).toBe('3998877665');
    expect(jobs[1]!.remote).toBe(false);
  });

  it('skips cards missing a title or link', () => {
    expect(parseLinkedInGuestCards('<li><span>nothing useful</span></li>')).toEqual([]);
  });
});
