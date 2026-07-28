/**
 * Intl-free formatting helpers.
 *
 * WHY THIS EXISTS: the Hermes engine in this app's release build does NOT ship
 * the `Intl` global — `new Intl.RelativeTimeFormat(...)` and
 * `new Intl.NumberFormat(...)` throw "undefined is not an object", which
 * white-screened every screen that formatted a relative time or a currency
 * (messages, applications, invitations, ai-usage, audit-log, invoices, job
 * detail). `Date.prototype.toLocale*` still works, so those are fine — only the
 * `Intl` constructors are unavailable.
 *
 * These helpers reproduce the formatting we need by hand, so the app never
 * depends on Hermes being built with Intl. Do NOT reintroduce `Intl.*`.
 */

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

/** "3m ago" / "5h ago" / "2d ago", falling back to a plain date past ~30 days. */
export function relativeDate(iso?: string | null): string {
  if (!iso) return '';
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return '';
  const diff = Date.now() - then;
  // Future or sub-minute → "just now" (also absorbs small clock skew).
  if (diff < 60_000) return 'just now';
  if (diff < 3_600_000) return `${Math.round(diff / 60_000)}m ago`;
  if (diff < 86_400_000) return `${Math.round(diff / 3_600_000)}h ago`;
  if (diff < 30 * 86_400_000) return `${Math.round(diff / 86_400_000)}d ago`;
  return shortDate(iso);
}

/** "Jul 28, 2026" — Intl-free, stable across devices. */
export function shortDate(iso?: string | null): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return `${MONTHS[d.getMonth()]} ${d.getDate()}, ${d.getFullYear()}`;
}

/** "Monday, 28 Jul" — the dashboard greeting date line. */
export function longDate(d: Date = new Date()): string {
  return `${WEEKDAYS[d.getDay()]}, ${d.getDate()} ${MONTHS[d.getMonth()]}`;
}

/** 1234 → "1,234". */
export function withThousands(n: number): string {
  return Math.round(n)
    .toString()
    .replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

const CURRENCY_SYMBOL: Record<string, string> = {
  USD: '$',
  EUR: '€',
  GBP: '£',
  INR: '₹',
  CAD: 'CA$',
  AUD: 'A$',
};

/** "$1,200" — rounded, no decimals. Falls back to "1,200 XYZ" for unknown codes. */
export function money(amount: number, currency?: string | null): string {
  const cur = (currency || 'USD').toUpperCase();
  const sym = CURRENCY_SYMBOL[cur];
  const num = withThousands(amount);
  return sym ? `${sym}${num}` : `${num} ${cur}`;
}

/** 1234567 → "1.2M". Raw token counts are unreadable at a glance. */
export function compactNumber(n: number): string {
  const abs = Math.abs(n);
  const trim = (x: number) => (Math.round(x * 10) / 10).toString();
  if (abs < 1_000) return String(Math.round(n));
  if (abs < 1_000_000) return `${trim(n / 1_000)}K`;
  if (abs < 1_000_000_000) return `${trim(n / 1_000_000)}M`;
  return `${trim(n / 1_000_000_000)}B`;
}
