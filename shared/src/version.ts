/**
 * App version comparison — shared so the backend, the web client and the
 * mobile client can never disagree about which of two builds is newer.
 *
 * Store versions are plain dotted numerics ("1.2.10"), which is what both
 * `CFBundleShortVersionString` and Play's versionName carry. This is
 * deliberately NOT full semver: pre-release tags and build metadata have no
 * meaning to the stores, so accepting them would invite a floor like
 * "1.2.0-rc1" that no shipped build can ever satisfy.
 */

/** A dotted-numeric version, e.g. "1", "1.2", "1.2.10". */
const VERSION_RE = /^\d+(\.\d+)*$/;

export function isValidVersion(v: string): boolean {
  return VERSION_RE.test(v.trim());
}

/**
 * Numeric, segment-wise comparison. Missing segments count as 0, so
 * "1.2" === "1.2.0", and "1.10.0" > "1.9.0" (a plain string compare gets
 * that backwards, which is the whole reason this function exists).
 *
 * Returns <0 if a is older, 0 if equal, >0 if a is newer.
 * Unparseable input compares as equal so a malformed value can never lock a
 * user out — see requiresUpdate(), which fails open on the same principle.
 */
export function compareVersions(a: string, b: string): number {
  if (!isValidVersion(a) || !isValidVersion(b)) return 0;

  const pa = a.trim().split('.').map(Number);
  const pb = b.trim().split('.').map(Number);
  const len = Math.max(pa.length, pb.length);

  for (let i = 0; i < len; i++) {
    const diff = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (diff !== 0) return diff < 0 ? -1 : 1;
  }
  return 0;
}

/**
 * Is `current` below the hard floor `minimum`?
 *
 * Fails OPEN. A blank/garbled floor, or a version string the app could not
 * read off the bundle, must NOT strand every user behind an un-dismissable
 * wall — that is a self-inflicted outage with no client-side remedy, since
 * the only way out would itself be a store release.
 */
export function requiresUpdate(current: string, minimum: string): boolean {
  if (!current || !minimum) return false;
  if (!isValidVersion(current) || !isValidVersion(minimum)) return false;
  return compareVersions(current, minimum) < 0;
}
