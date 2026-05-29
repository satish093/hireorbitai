/**
 * Shared URL safety helpers — defence-in-depth for any place that renders
 * an `href` / iframe `src` derived from user-supplied data (vendor website,
 * profile links, course resources, job apply_url, etc).
 *
 * The backend training-controller already rejects unsafe schemes at write
 * time (`safeContentUrl` Zod refinement), but the frontend must NOT trust
 * stored values either — DB rows may pre-date the backend hardening, or be
 * set via direct SQL during a manual import, or come from a column that
 * isn't yet validated.
 *
 * `isSafeHttpsUrl` blocks `javascript:`, `data:`, `vbscript:`, `file:`,
 * `ftp:`, and any non-https scheme. Combined with the localStorage-based
 * access token, an unvalidated href on a public page would be a one-click
 * account-takeover vector.
 *
 * `toSafeHref` is the recommended consumer API — returns `'#'` for an
 * unsafe input so the rendered `<a>` is harmless when clicked.
 */

export function isSafeHttpsUrl(raw: string | undefined | null): raw is string {
  if (!raw) return false;
  try {
    const u = new URL(raw);
    return u.protocol === 'https:';
  } catch {
    return false;
  }
}

export function toSafeHref(raw: string | undefined | null): string {
  return isSafeHttpsUrl(raw) ? raw : '#';
}
