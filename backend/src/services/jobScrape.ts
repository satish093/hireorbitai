/**
 * Pure HTML/JSON-LD job parsers — no DB, no network, no app imports.
 *
 * Split out of jobIngestion.service so it can be unit-tested in isolation
 * (importing the service would pull in pg/Pool). The service imports
 * `parseJobsFromHtml` (JSON-LD scraper) and `parseLinkedInGuestCards`
 * (LinkedIn guest endpoint) from here.
 */

import type { NormalizedJob } from './jobIngestion.service';

// --- small self-contained helpers (duplicated intentionally to stay db-free) -

export function decodeEntities(s: string): string {
  return s
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&#39;|&rsquo;|&lsquo;|&apos;/gi, "'")
    .replace(/&quot;|&ldquo;|&rdquo;/gi, '"')
    .replace(/&nbsp;/gi, ' ')
    .trim();
}

function stripHtmlText(input: string | null | undefined): string | null {
  if (input == null) return null;
  const text = decodeEntities(
    String(input)
      .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, ' ')
      .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, ' ')
      .replace(/<\s*br\s*\/?>/gi, '\n')
      .replace(/<\/(p|div|li|h[1-6])>/gi, '\n')
      .replace(/<[^>]+>/g, ' ')
      .replace(/[ \t]+\n/g, '\n')
      .replace(/\n{3,}/g, '\n\n')
      .replace(/[ \t]{2,}/g, ' '),
  );
  return text.length > 0 ? text : null;
}

function cleanSkillList(tags: unknown): string[] {
  if (!Array.isArray(tags)) return [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const t of tags) {
    if (typeof t !== 'string') continue;
    const v = t.trim();
    if (!v) continue;
    const key = v.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(v);
    if (out.length >= 12) break;
  }
  return out;
}

function nonZeroNum(n: unknown): number | null {
  const x = Number(n);
  return typeof x === 'number' && isFinite(x) && x > 0 ? x : null;
}

function hostOf(url: string): string | null {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return null;
  }
}

function normalizePub(raw: string | null): string | null {
  if (!raw) return null;
  const s = raw.toLowerCase();
  if (s.includes('linkedin')) return 'LinkedIn';
  if (s.includes('dice')) return 'Dice';
  if (s.includes('monster')) return 'Monster';
  if (s.includes('careerbuilder')) return 'CareerBuilder';
  if (s.includes('indeed')) return 'Indeed';
  if (s.includes('glassdoor')) return 'Glassdoor';
  return /^https?:\/\//i.test(raw) ? null : raw.slice(0, 40);
}

function safeUrl(primary: string | null, title: string, company: string): string {
  const ok = (u: string | null) => (u && /^https?:\/\//i.test(u.trim()) ? u.trim() : null);
  return (
    ok(primary) ??
    `https://www.google.com/search?ibp=htl;jobs&q=${encodeURIComponent(`${title} ${company}`)}`
  );
}

function firstStr(...vals: unknown[]): string | null {
  for (const v of vals) if (typeof v === 'string' && v.trim()) return v.trim();
  return null;
}

// --- JSON-LD JobPosting parsing ---------------------------------------------

export function extractJsonLdJobs(html: string): Record<string, unknown>[] {
  const out: Record<string, unknown>[] = [];
  const re = /<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html))) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(m[1].trim());
    } catch {
      continue;
    }
    const top = Array.isArray(parsed)
      ? parsed
      : ((parsed as { '@graph'?: unknown[] })?.['@graph'] ?? [parsed]);
    for (const node of Array.isArray(top) ? top : [top]) {
      const t = (node as { '@type'?: unknown })?.['@type'];
      const isJob = Array.isArray(t) ? t.includes('JobPosting') : t === 'JobPosting';
      if (isJob && node && typeof node === 'object') out.push(node as Record<string, unknown>);
    }
  }
  return out;
}

function jsonLdLocation(node: Record<string, any>): string | null {
  const loc = Array.isArray(node.jobLocation) ? node.jobLocation[0] : node.jobLocation;
  const addr = loc?.address ?? node.address;
  if (!addr) return node.applicantLocationRequirements ? 'Remote' : null;
  const parts = [addr.addressLocality, addr.addressRegion, addr.addressCountry]
    .map((p: unknown) => (p && typeof p === 'object' ? (p as { name?: string }).name : p))
    .filter(Boolean);
  return parts.join(', ') || null;
}

// Only hourly rates (the schema's columns are /hr); annual figures are dropped.
function jsonLdHourly(node: Record<string, any>): { min: number | null; max: number | null } {
  const val = node.baseSalary?.value ?? node.estimatedSalary?.value;
  if (!val) return { min: null, max: null };
  const unit = String(val.unitText ?? '').toUpperCase();
  if (unit && unit !== 'HOUR') return { min: null, max: null };
  const min = nonZeroNum(val.minValue);
  const max = nonZeroNum(val.maxValue);
  const single = nonZeroNum(val.value);
  return { min: min ?? single, max };
}

function jobPostingToNormalized(node: Record<string, any>, pageUrl: string): NormalizedJob | null {
  const title = firstStr(node.title, node.name);
  const org = node.hiringOrganization;
  const company = firstStr(typeof org === 'string' ? org : org?.name, node.publisher?.name);
  if (!title || !company) return null;
  const url = firstStr(node.url, pageUrl) ?? pageUrl;
  const loc = jsonLdLocation(node);
  const sal = jsonLdHourly(node);
  const empType = Array.isArray(node.employmentType)
    ? node.employmentType.join(', ')
    : typeof node.employmentType === 'string'
      ? node.employmentType
      : null;
  const externalId =
    firstStr(
      node.identifier?.value,
      typeof node.identifier === 'string' ? node.identifier : null,
      url,
    ) ?? url;
  const skillsRaw =
    typeof node.skills === 'string'
      ? node.skills.split(/[,;]/)
      : Array.isArray(node.skills)
        ? node.skills
        : [];
  const host = hostOf(pageUrl);
  return {
    source: 'scraper',
    external_id: String(externalId).slice(0, 200),
    title,
    company_name: company,
    description: stripHtmlText(typeof node.description === 'string' ? node.description : null),
    location: loc,
    remote: /remote/i.test(loc ?? '') || !!node.jobLocationType,
    job_type: empType,
    level: null,
    required_skills: cleanSkillList(skillsRaw.map((s: unknown) => String(s).trim())),
    rate_min: sal.min,
    rate_max: sal.max,
    apply_url: safeUrl(firstStr(node.applyUrl, url), title, company),
    posted_at: firstStr(node.datePosted),
    publisher: normalizePub(host),
  };
}

function ogFallback(html: string, pageUrl: string): NormalizedJob | null {
  const meta = (prop: string) =>
    new RegExp(
      `<meta[^>]+(?:property|name)=["']${prop}["'][^>]+content=["']([^"']+)["']`,
      'i',
    ).exec(html)?.[1] ?? null;
  const title = firstStr(meta('og:title'), /<title[^>]*>([^<]+)<\/title>/i.exec(html)?.[1]);
  if (!title) return null;
  const host = hostOf(pageUrl);
  const company = firstStr(meta('og:site_name'), host) ?? 'Unknown';
  return {
    source: 'scraper',
    external_id: pageUrl,
    title: decodeEntities(title),
    company_name: decodeEntities(company),
    description: stripHtmlText(meta('og:description')),
    location: null,
    remote: false,
    job_type: null,
    level: null,
    required_skills: [],
    rate_min: null,
    rate_max: null,
    apply_url: safeUrl(firstStr(meta('og:url'), pageUrl), title, company),
    posted_at: null,
    publisher: normalizePub(host),
  };
}

/** Parse JobPosting(s) out of a raw HTML string (JSON-LD first, then OG/meta). */
export function parseJobsFromHtml(html: string, pageUrl: string): NormalizedJob[] {
  const ld = extractJsonLdJobs(html)
    .map((n) => jobPostingToNormalized(n, pageUrl))
    .filter((j): j is NormalizedJob => j !== null);
  if (ld.length > 0) return ld;
  const og = ogFallback(html, pageUrl);
  return og ? [og] : [];
}

// --- LinkedIn guest-endpoint card parsing -----------------------------------

function pickByClass(block: string, cls: string): string | null {
  const re = new RegExp(`<[^>]*class="[^"]*${cls}[^"]*"[^>]*>([\\s\\S]*?)<`, 'i');
  const m = re.exec(block);
  if (!m) return null;
  const txt = decodeEntities(m[1].replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' '));
  return txt || null;
}

/** Parse the HTML fragment returned by LinkedIn's guest job-search endpoint
 *  into listing-level NormalizedJob rows. */
export function parseLinkedInGuestCards(html: string): NormalizedJob[] {
  const out: NormalizedJob[] = [];
  const cards = html.split(/<li[\s>]/i).slice(1);
  for (const card of cards) {
    const href = /href="(https:\/\/[^"]*\/jobs\/view\/[^"?]+)/i.exec(card)?.[1];
    const title = pickByClass(card, 'base-search-card__title');
    const company = pickByClass(card, 'base-search-card__subtitle');
    const loc = pickByClass(card, 'job-search-card__location');
    const datetime = /datetime="([^"]+)"/i.exec(card)?.[1] ?? null;
    if (!href || !title || !company) continue;
    const externalId = /\/jobs\/view\/(?:[^/]*-)?(\d{6,})/i.exec(href)?.[1] ?? href;
    out.push({
      source: 'linkedin',
      external_id: String(externalId),
      title,
      company_name: company,
      description: null,
      location: loc,
      remote: /remote/i.test(loc ?? ''),
      job_type: null,
      level: null,
      required_skills: [],
      rate_min: null,
      rate_max: null,
      apply_url: safeUrl(href, title, company),
      posted_at: datetime,
      publisher: 'LinkedIn',
    });
  }
  return out;
}
