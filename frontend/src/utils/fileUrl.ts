import { config as appConfig } from '../config/env';

/**
 * Centralized URL builders for backend-served files (resume downloads,
 * task attachments, avatar uploads, etc.).
 *
 * Solves three recurring papercuts:
 *   1. Double slashes when callers do `${API_BASE}/foo` and the base ends
 *      with `/`. The base in `config/env.ts` is already trimmed but a
 *      typo elsewhere has bitten us before.
 *   2. CDN/domain-split: when a future build serves static asset URLs from
 *      a different host than the API, every call site doesn't have to know.
 *   3. Already-absolute URLs (signed storage URLs) must be used
 *      as-is, NOT re-prefixed with our API base.
 *
 * Use these from any page that opens or renders a server-supplied URL.
 */

/** Strip leading slashes so we can safely concatenate. */
function stripLeading(s: string): string {
  return s.replace(/^\/+/, '');
}

function isAbsolute(url: string): boolean {
  return /^https?:\/\//i.test(url);
}

/**
 * Resolve a path or URL to an absolute, fetchable URL.
 *
 *   resolveUrl('/files/abc.pdf')          → 'https://api.hireorbitai.com/files/abc.pdf'
 *   resolveUrl('https://cdn.example/x')   → 'https://cdn.example/x'           (passthrough)
 *   resolveUrl(undefined)                  → ''                               (safe default)
 */
export function resolveUrl(pathOrUrl: string | null | undefined): string {
  if (!pathOrUrl) return '';
  if (isAbsolute(pathOrUrl)) return pathOrUrl;
  return `${appConfig.apiBaseUrl}/${stripLeading(pathOrUrl)}`;
}

/**
 * Open a server-supplied URL in a new tab, with `noopener,noreferrer` set
 * so the opened tab can't reach `window.opener` or leak referrer.
 *
 * Use this from any "Download" / "View file" button instead of calling
 * `window.open()` directly.
 */
export function openExternal(pathOrUrl: string | null | undefined): boolean {
  const url = resolveUrl(pathOrUrl);
  if (!url) return false;
  // Returning the window reference lets callers detect popup-blocker
  // refusals if they care, but most call sites just want a boolean.
  const ref = window.open(url, '_blank', 'noopener,noreferrer');
  return !!ref;
}

/**
 * Fire a programmatic download for a server-supplied URL. Falls back to
 * openExternal() if the browser doesn't honor the `download` attribute
 * (cross-origin signed URLs often don't).
 */
export function triggerDownload(pathOrUrl: string | null | undefined, filename?: string): void {
  const url = resolveUrl(pathOrUrl);
  if (!url) return;
  const a = document.createElement('a');
  a.href = url;
  a.target = '_blank';
  a.rel = 'noopener noreferrer';
  if (filename) a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
}
