import { useState } from 'react';

const ATS_HOSTS =
  /(greenhouse|lever|ashbyhq|workable|myworkdayjobs|workday|bamboohr|smartrecruiters|recruiting|icims|taleo|jazzhr|breezy|remoteok|remotive|arbeitnow|indeed|linkedin|ziprecruiter|glassdoor|google)\./i;

/** Best-effort company domain: prefer the apply-URL host (unless it's an ATS),
 *  else slugify the name → "{slug}.com". Null when nothing plausible. */
function companyDomain(name?: string | null, applyUrl?: string | null): string | null {
  if (applyUrl) {
    try {
      const host = new URL(applyUrl).hostname.replace(/^www\./, '');
      if (host && !ATS_HOSTS.test(host) && host.includes('.')) return host;
    } catch {
      /* not a URL — fall through to the name slug */
    }
  }
  if (!name) return null;
  const slug = name
    .toLowerCase()
    .replace(/\b(inc|llc|ltd|corp|co|gmbh|s\.?a|plc|group|technologies|labs)\b/g, '')
    .replace(/[^a-z0-9]/g, '');
  return slug.length >= 2 ? `${slug}.com` : null;
}

function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '—';
  if (parts.length === 1) return parts[0]!.slice(0, 2).toUpperCase();
  return (parts[0]![0]! + parts[1]![0]!).toUpperCase();
}

/**
 * Company logo with a graceful initials fallback (Jobright-style). Tries the
 * company's real logo by domain (Clearbit — no API key); on any load error it
 * falls back to the initials avatar, so a missing/blocked logo never renders
 * broken.
 */
export function CompanyLogo({
  name,
  applyUrl,
  size = 40,
  rounded = 'rounded-[8px]',
}: {
  name?: string | null;
  applyUrl?: string | null;
  size?: number;
  rounded?: string;
}) {
  const label = name?.trim() || 'Confidential';
  const domain = companyDomain(name, applyUrl);
  const [failed, setFailed] = useState(false);

  return (
    <span
      className={`shrink-0 grid place-items-center overflow-hidden border border-border bg-accent-soft text-accent font-semibold ${rounded}`}
      style={{ width: size, height: size, fontSize: Math.round(size * 0.34) }}
      aria-hidden="true"
    >
      {domain && !failed ? (
        <img
          src={`https://logo.clearbit.com/${domain}?size=${size * 2}`}
          alt=""
          width={size}
          height={size}
          loading="lazy"
          onError={() => setFailed(true)}
          className="h-full w-full bg-white object-contain"
        />
      ) : (
        initials(label)
      )}
    </span>
  );
}
