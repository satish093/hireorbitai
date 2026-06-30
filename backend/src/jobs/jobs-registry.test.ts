/**
 * Regression test for the job registry.
 *
 * The production-readiness audit caught that `workAuthExpiryJob` was
 * implemented + tested-against-schema + had a Brevo template but was never
 * registered with the scheduler — so 60/30/7-day H1B / EAD / I797 alerts
 * silently never fired. This test pins the source of jobs/index.ts so the
 * same omission can't recur.
 *
 * The test does pure source inspection (no runtime import) because the job
 * modules pull in `pg`, `brevo`, and the rest of the config tree — mocking
 * all of them just to read a single import list would be brittle.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const REGISTRY_SOURCE = readFileSync(join(__dirname, 'index.ts'), 'utf-8');

describe('jobs/index — every expected job is registered', () => {
  // Each tuple is [imported symbol, function-call line ‒ regex-friendly].
  const expected: Array<[string, RegExp]> = [
    ['remindersJob', /register\(remindersJob\)/],
    ['sessionsPurgeJob', /register\(sessionsPurgeJob\)/],
    ['jobsSyncJob', /register\(jobsSyncJob\)/],
    ['dailyDigestJob', /register\(dailyDigestJob\)/],
    ['attachmentsPurgeJob', /register\(attachmentsPurgeJob\)/],
    // Audit regression — was implemented + tested but never registered,
    // so the H1B/EAD/I797 expiry alerts never fired in production.
    ['workAuthExpiryJob', /register\(workAuthExpiryJob\)/],
    ['invoiceOverdueJob', /register\(invoiceOverdueJob\)/],
  ];

  for (const [symbol, call] of expected) {
    it(`imports + registers ${symbol}`, () => {
      expect(REGISTRY_SOURCE, `expected import of ${symbol}`).toMatch(
        new RegExp(`import\\s+\\{\\s*${symbol}\\s*\\}`),
      );
      expect(REGISTRY_SOURCE, `expected register(${symbol})`).toMatch(call);
    });
  }
});
