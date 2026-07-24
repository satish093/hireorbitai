// Vitest global setup — runs before any test module is imported.
//
// The DB and external clients are mocked per-test, but a handful of modules
// (config/env → config/gemini, ai.service, storage, …) validate `process.env`
// at import time and `process.exit(1)` on a missing var. CI has no `.env`, so
// any suite whose import graph reaches one of those modules (e.g.
// resumes.idor.test.ts, resumeText.service.test.ts) would fail to even
// collect. Inject dummy, schema-valid values here so env validation passes.
//
// NODE_ENV=test also exempts the cross-environment DATABASE_URL guard in
// config/env.ts (the DB is mocked in the suite). Values are only set when
// absent, so a real local .env still takes precedence.
const defaults: Record<string, string> = {
  NODE_ENV: 'test',
  APP_URL: 'http://localhost:4000',
  CORS_ORIGIN: 'http://localhost:5173',
  DATABASE_URL: 'postgres://test:test@localhost:5432/hireorbit_test',
  STORAGE_URL_SECRET: 'test-storage-secret-0000000000000000',
  JWT_SECRET: 'test-jwt-secret-000000000000000000000000',
  COOKIE_SECRET: 'test-cookie-secret-000000000000000000000',
  BREVO_API_KEY: 'test-brevo-key-dummy',
  BREVO_MOCK: 'true',
};

for (const [key, value] of Object.entries(defaults)) {
  process.env[key] ??= value;
}
