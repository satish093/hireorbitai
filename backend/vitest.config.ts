import { defineConfig } from 'vitest/config';

// Backend test config. Vitest picks up `*.test.ts` files under src/ by
// default. Globals are off — every test file imports `describe`, `it`,
// `expect`, `vi` explicitly so a `npm run test src/some/file.ts` flow
// works without surprises.
export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
    // Single-thread by default — most of our tests touch a shared module-
    // level cache (permission service). Parallel test files would flake
    // unless every test wipes the cache, which is brittle. The suite is
    // small so the sequential cost is in the milliseconds.
    pool: 'forks',
    poolOptions: { forks: { singleFork: true } },
  },
  // Vitest reads paths from the project's tsconfig but we point explicitly
  // so the typed shared package resolves the same way as the runtime build.
  resolve: {
    conditions: ['node', 'import'],
  },
});
