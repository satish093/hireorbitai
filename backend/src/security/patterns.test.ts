/**
 * Static security pattern-guard — an executable form of .claude/rules/security.md.
 *
 * It scans every backend/src/controllers/*.ts source for the regressions the
 * rules forbid and fails the build when a NEW one appears. This is a ratchet,
 * not a one-shot audit: known pre-existing offenders are recorded in BASELINE
 * below so the suite stays green today while blocking any fresh violation in a
 * future controller or PR.
 *
 * Patterns checked:
 *   1. Mass-assignment — `.update(req.body)` / `.insert({ ...req.body })` /
 *      `.insert(req.body)` without a `.strict()` Zod allowlist gating the body.
 *   2. Email wildcard injection — `.ilike('email', ...)` (must be
 *      `.eq('email', email.toLowerCase())`).
 *
 * BASELINE records the count of *known, accepted-as-debt* matches per file. To
 * fix a flagged controller, validate req.body against a strict Zod schema (see
 * applications.controller.ts `updateSchema` for the canonical pattern) and then
 * lower the corresponding BASELINE number — the test will tell you to.
 */

import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const CONTROLLERS_DIR = join(process.cwd(), 'src', 'controllers');

// Known, pre-existing mass-assignment sites tracked as debt. Now EMPTY — the
// clients/jobs/vendors create+update handlers were hardened with `.strict()`
// Zod allowlists (see those controllers + applications.controller.ts). Any new
// `.update/insert(req.body)` is a fresh violation and must be fixed, not
// baselined back in.
const MASS_ASSIGNMENT_BASELINE: Record<string, number> = {};

// No controller may look up a user by email with .ilike (wildcard injection).
const EMAIL_ILIKE_BASELINE: Record<string, number> = {};

const MASS_ASSIGNMENT_PATTERNS = [
  /\.update\(\s*req\.body\s*\)/,
  /\.insert\(\s*req\.body\s*\)/,
  /\.insert\(\s*\{\s*\.\.\.req\.body/,
];
const EMAIL_ILIKE_PATTERN = /\.ilike\(\s*['"`]email['"`]/;

interface Finding {
  file: string;
  line: number;
  text: string;
}

function scan(predicate: (line: string) => boolean): Finding[] {
  const files = readdirSync(CONTROLLERS_DIR).filter(
    (f) => f.endsWith('.ts') && !f.endsWith('.test.ts'),
  );
  const findings: Finding[] = [];
  for (const file of files) {
    const lines = readFileSync(join(CONTROLLERS_DIR, file), 'utf8').split(/\r?\n/);
    lines.forEach((text, i) => {
      if (predicate(text)) findings.push({ file, line: i + 1, text: text.trim() });
    });
  }
  return findings;
}

function countByFile(findings: Finding[]): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const f of findings) counts[f.file] = (counts[f.file] ?? 0) + 1;
  return counts;
}

function assertAgainstBaseline(
  label: string,
  findings: Finding[],
  baseline: Record<string, number>,
): void {
  const counts = countByFile(findings);
  const byFile = new Map<string, Finding[]>();
  for (const f of findings) byFile.set(f.file, [...(byFile.get(f.file) ?? []), f]);

  // 1. No NEW violations: a file with more matches than its baseline (or any
  //    match in a file with no baseline) is a fresh regression.
  for (const [file, count] of Object.entries(counts)) {
    const allowed = baseline[file] ?? 0;
    if (count > allowed) {
      const detail = (byFile.get(file) ?? [])
        .map((f) => `    ${f.file}:${f.line}  ${f.text}`)
        .join('\n');
      throw new Error(
        `${label}: ${count} match(es) in ${file}, baseline allows ${allowed}. ` +
          `New violation — gate req.body with a .strict() Zod schema (see ` +
          `applications.controller.ts updateSchema).\n${detail}`,
      );
    }
  }

  // 2. No STALE baseline: a fixed file must have its baseline lowered so the
  //    ratchet keeps tightening.
  for (const [file, allowed] of Object.entries(baseline)) {
    const count = counts[file] ?? 0;
    if (count < allowed) {
      throw new Error(
        `${label}: ${file} now has ${count} match(es) but baseline still expects ${allowed}. ` +
          `Nice — a known issue was fixed. Lower the baseline in patterns.test.ts to ${count}.`,
      );
    }
  }
}

describe('security pattern guard (controllers)', () => {
  it('introduces no new mass-assignment (db.update/insert of req.body)', () => {
    const findings = scan((line) => MASS_ASSIGNMENT_PATTERNS.some((re) => re.test(line)));
    // Throws with a file:line detail message on a new/stale violation.
    assertAgainstBaseline('mass-assignment', findings, MASS_ASSIGNMENT_BASELINE);
    expect(countByFile(findings)).toEqual(MASS_ASSIGNMENT_BASELINE);
  });

  it('uses no .ilike() on email (wildcard injection)', () => {
    const findings = scan((line) => EMAIL_ILIKE_PATTERN.test(line));
    assertAgainstBaseline('email-ilike', findings, EMAIL_ILIKE_BASELINE);
    expect(countByFile(findings)).toEqual(EMAIL_ILIKE_BASELINE);
  });
});
