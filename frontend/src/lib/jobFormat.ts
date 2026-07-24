// Shared, pure job-formatting helpers + the Job shape used by the full-page
// job detail (frontend/src/pages/JobDetail.tsx and JobDetailView.tsx). Kept
// dependency-free (no React) so the detail route doesn't have to import the
// heavy JobSearch page module just to reuse a few formatters.

export type AppStatus =
  | 'SUBMITTED'
  | 'SCREENING'
  | 'INTERVIEW'
  | 'OFFER'
  | 'REJECTED'
  | 'WITHDRAWN';

export interface JobRequirements {
  must_haves?: string[];
  nice_to_haves?: string[];
  required_skills?: string[];
  min_years_of_experience?: number | null;
  job_seniority?: string | null;
  work_model?: string | null;
  work_authorization?: string[];
  location_requirements?: string | null;
  core_responsibilities?: string[];
  skill_summaries?: string[];
  benefits_summaries?: string[];
  education_summaries?: string[];
  highlights?: string[];
  recommendation_tags?: string[];
  years_required?: number | null;
  level?: string | null;
}

export interface Job {
  id: string;
  title: string;
  location?: string | null;
  remote?: boolean;
  job_type?: string | null;
  level?: string | null;
  rate_min?: number | null;
  rate_max?: number | null;
  description?: string | null;
  required_skills?: string[] | null;
  posted_at?: string | null;
  created_at: string;
  client?: { id: string; company_name: string } | null;
  vendor?: { id: string; company_name: string } | null;
  liked?: boolean;
  match_score?: number | null;
  application_status?: AppStatus | string;
  source?: string | null;
  apply_url?: string | null;
  company_name?: string | null;
  publisher?: string | null;
  requirements?: JobRequirements | null;
}

export function relative(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const m = Math.round(diff / 60000);
  if (m < 1) return 'just now';
  if (m < 60) return `${m} minute${m === 1 ? '' : 's'} ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h} hour${h === 1 ? '' : 's'} ago`;
  const d = Math.round(h / 24);
  if (d < 7) return `${d} day${d === 1 ? '' : 's'} ago`;
  return new Date(iso).toLocaleDateString();
}

export function prettyType(t?: string | null): string {
  if (!t) return 'Full-time';
  const map: Record<string, string> = { W2: 'W2', C2C: 'C2C', FTE: 'Full-time', '1099': '1099' };
  return map[t] ?? t;
}

export function prettyRate(min?: number | null, max?: number | null): string {
  if (min == null && max == null) return 'Rate undisclosed';
  if (min != null && max != null) return `$${min}/hr – $${max}/hr`;
  return `$${min ?? max}/hr`;
}

// Final apply-URL safety net: synthesize a Google-for-jobs search if the
// stored apply_url is missing/invalid, so the button is always usable.
export function resolveApplyUrl(job: Job): string {
  const u = (job.apply_url ?? '').trim();
  if (u && /^https?:\/\//i.test(u)) return u;
  const company = job.company_name ?? job.client?.company_name ?? '';
  return (
    'https://www.google.com/search?ibp=htl;jobs&q=' + encodeURIComponent(`${job.title} ${company}`)
  );
}

/** Convert a raw job description (possibly HTML) into clean readable text:
 *  block tags -> line breaks, inline tags stripped, common entities decoded. */
export function jdToText(raw: string): string {
  return raw
    .replace(/<\s*(br|\/p|\/li|\/div|\/h[1-6])\s*\/?>/gi, '\n')
    .replace(/<\s*li[^>]*>/gi, '• ')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&#39;|&rsquo;|&lsquo;/gi, "'")
    .replace(/&quot;|&ldquo;|&rdquo;/gi, '"')
    .replace(/\n{3,}/g, '\n\n')
    .replace(/[ \t]{2,}/g, ' ')
    .trim();
}

const NAMED_ENTITIES: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' ',
  rsquo: '’',
  lsquo: '‘',
  ldquo: '“',
  rdquo: '”',
  ndash: '–',
  mdash: '—',
  hellip: '…',
};

/** Decode HTML entities (named + numeric/hex) in a short label. */
function decodeEntities(s: string): string {
  return s.replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, (m, code: string) => {
    if (code[0] === '#') {
      const hex = code[1] === 'x' || code[1] === 'X';
      const n = parseInt(code.slice(hex ? 2 : 1), hex ? 16 : 10);
      return Number.isFinite(n) ? String.fromCodePoint(n) : m;
    }
    return NAMED_ENTITIES[code.toLowerCase()] ?? m;
  });
}

/**
 * Repair UTF-8 text that an ingestion feed mis-decoded as Latin-1
 * ("Espa~na" -> "Espana" with the tilde restored, "Andaluc-a" -> "Andalucia").
 * Only attempts the fix when the string both LOOKS mojibake'd (a 0xC2/0xC3 lead
 * byte followed by a 0x80-0xBF continuation byte) AND is pure Latin-1, so
 * legitimate multibyte text (real accents, CJK, emoji) is never corrupted; a
 * failed UTF-8 decode also falls back to the original.
 */
function fixMojibake(s: string): string {
  let looksMojibake = false;
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    if (c > 0xff) return s; // a real multibyte char is present — don't touch it
    if ((c === 0xc2 || c === 0xc3) && i + 1 < s.length) {
      const next = s.charCodeAt(i + 1);
      if (next >= 0x80 && next <= 0xbf) looksMojibake = true;
    }
  }
  if (!looksMojibake) return s;
  try {
    const bytes = Uint8Array.from(Array.from(s, (c) => c.charCodeAt(0)));
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    return s;
  }
}

/**
 * Clean a short label from an ingestion feed for display: decode HTML entities
 * ("Johnson &amp; Johnson" -> "Johnson & Johnson") and repair UTF-8-as-Latin1
 * mojibake. Safe to call on any string (incl. null/undefined -> '').
 */
export function cleanText(s?: string | null): string {
  if (!s) return s ?? '';
  return fixMojibake(decodeEntities(s));
}

const JD_KEEP_TAGS = new Set([
  'P',
  'BR',
  'UL',
  'OL',
  'LI',
  'STRONG',
  'B',
  'EM',
  'I',
  'H1',
  'H2',
  'H3',
  'H4',
  'H5',
  'H6',
]);

/** True when the raw description carries HTML markup worth preserving. */
export function looksLikeHtml(raw: string): boolean {
  return /<(p|br|ul|ol|li|strong|b|em|i|h[1-6]|div|span)\b/i.test(raw);
}

/**
 * Sanitize a description's HTML down to a safe structural subset and return
 * the cleaned innerHTML. Walks the parsed DOM keeping only whitelisted tags
 * with no attributes, so headings / lists / bold survive while any executable
 * or styling vector is stripped. Falls back to '' when there's no DOM.
 */
export function jdToSafeHtml(raw: string): string {
  if (typeof window === 'undefined' || typeof window.DOMParser === 'undefined') return '';
  const doc = new DOMParser().parseFromString(raw, 'text/html');
  const out = doc.createElement('div');

  const walk = (src: Node, dest: Node) => {
    src.childNodes.forEach((node) => {
      if (node.nodeType === Node.TEXT_NODE) {
        dest.appendChild(doc.createTextNode(node.textContent ?? ''));
        return;
      }
      if (node.nodeType !== Node.ELEMENT_NODE) return;
      const el = node as Element;
      const tag = el.tagName.toUpperCase();
      if (tag === 'SCRIPT' || tag === 'STYLE') return;
      if (JD_KEEP_TAGS.has(tag)) {
        // createElement creates a bare element with no attributes copied from el.
        // If you ever add <a> or <img> to JD_KEEP_TAGS, allowlist specific safe
        // attributes (href, src) explicitly here rather than copying all of el's.
        const clean = doc.createElement(tag.toLowerCase());
        walk(el, clean);
        dest.appendChild(clean);
      } else {
        walk(el, dest);
      }
    });
  };
  walk(doc.body, out);
  return out.innerHTML.replace(/(\s*<br\s*\/?>\s*){3,}/gi, '<br><br>').trim();
}
