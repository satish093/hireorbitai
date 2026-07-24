#!/usr/bin/env node
/* eslint-disable no-console */
// =============================================================================
// Deploy-safe DB bootstrap for the Render `dev` / staging backend service.
//
// Runs in the Render BUILD step (see render.yaml buildCommand). Idempotent and
// safe to run on every deploy:
//
//   1. Refuses anything that looks like the PRODUCTION database.
//   2. If the schema is MISSING (fresh/empty DB) → applies database/init.sql,
//      the full consolidated schema + reference data (all feature tables, the
//      feature_flags table seeded all-enabled, training content, etc.).
//      init.sql is built for a freshly-created schema (its `CREATE TYPE … AS
//      ENUM` statements are NOT `IF NOT EXISTS`), so we ONLY apply it when the
//      schema is absent — never blind-re-run it on an existing DB.
//   3. ALWAYS applies the incremental migrations under backend/migrations/
//      (node-pg-migrate tracks them in public.pgmigrations — re-runs are no-ops).
//   4. On a FRESH init, seeds the known dev accounts (seed-leadership →
//      seed-users → seed-mock-data) so you log in with the SAME admin you've
//      always used — admin@hireorbitai.test / SEED_PASSWORD (default
//      Passw0rd!2026) — and every dashboard shows realistic data. The full org
//      tree (CEO satish@, CTO rishi@, …) is seeded too. Set SEED_DEV=false to
//      provision a blank, schema-only environment instead.
//
// Unlike scripts/reset-dev.mjs this NEVER drops or wipes anything — it only
// creates-if-absent. reset-dev.mjs remains the (destructive) "start over" tool.
//
// Reads DATABASE_URL from the environment (Render injects service env vars into
// the build). If DATABASE_URL is unset it logs and exits 0 so a not-yet-wired
// service still builds; the app will then surface the missing-config error.
// =============================================================================

import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import pg from 'pg';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');

const url = process.env.DATABASE_URL;
if (!url) {
  console.warn(
    '⚠ db-bootstrap: DATABASE_URL is not set — skipping DB init (configure it in Render).',
  );
  process.exit(0);
}

const lower = url.toLowerCase();

// Safety: this is a DEV/STAGING tool. Production is the VPS (push to main) and
// must never be touched by the Render build.
if (lower.includes('hireorbit_prod')) {
  console.error(
    '✗ db-bootstrap: DATABASE_URL points at production. Refusing. (This is the dev/staging bootstrap.)',
  );
  process.exit(1);
}

const ssl =
  lower.includes('neon.tech') ||
  lower.includes('sslmode=require') ||
  (process.env.DATABASE_SSL ?? '') === 'require'
    ? { rejectUnauthorized: false }
    : false;

function run(label, cmd, cmdArgs, opts = {}) {
  console.log(`\n→ ${label}`);
  const r = spawnSync(cmd, cmdArgs, {
    stdio: 'inherit',
    shell: false,
    ...opts,
    env: { ...process.env, ...(opts.env ?? {}) },
  });
  if (r.status !== 0) {
    console.error(`✗ ${label} failed (exit ${r.status ?? 'null'})`);
    process.exit(r.status ?? 1);
  }
}

async function main() {
  let freshInit = false;

  const client = new pg.Client({ connectionString: url, ssl });
  await client.connect();
  try {
    // `to_regclass` returns NULL when the table doesn't exist — our "is the
    // schema present?" probe. public.users is created by init.sql and never
    // dropped by a migration, so it's a reliable sentinel.
    const { rows } = await client.query("SELECT to_regclass('public.users') AS t");
    const schemaPresent = rows[0]?.t != null;

    if (schemaPresent) {
      console.log('✓ db-bootstrap: schema already present — skipping init.sql.');
    } else {
      const initPath = resolve(ROOT, 'database', 'init.sql');
      console.log(`→ db-bootstrap: empty database — applying ${initPath}`);
      const sql = readFileSync(initPath, 'utf8');
      // node-postgres simple query supports multiple ;-separated statements.
      await client.query(sql);
      freshInit = true;
      console.log('  ✓ schema + reference data loaded (feature_flags seeded all-enabled).');
    }
  } finally {
    await client.end();
  }

  // Always apply incremental migrations (tracked in public.pgmigrations).
  run(
    'apply incremental migrations',
    process.execPath,
    [
      resolve(ROOT, 'backend', 'scripts', 'migrate.mjs'),
      'up',
      '--migrations-dir',
      'migrations',
      '--migration-file-language',
      'sql',
    ],
    { cwd: resolve(ROOT, 'backend') },
  );

  // First-time only: seed the known dev accounts + demo data so the env is
  // immediately usable with the admin we've always used (admin@hireorbitai.test).
  // Gated on freshInit so an existing DB — with its real data and any users
  // already invited — is NEVER re-seeded. Set SEED_DEV=false for schema-only.
  if (freshInit && process.env.SEED_DEV !== 'false') {
    const backend = resolve(ROOT, 'backend');
    run('seed: leadership (admin + org tree)', process.execPath, ['scripts/seed-leadership.mjs'], {
      cwd: backend,
    });
    run('seed: demo users', process.execPath, ['scripts/seed-users.mjs'], { cwd: backend });
    run('seed: mock data', process.execPath, ['scripts/seed-mock-data.mjs'], { cwd: backend });
    console.log(
      '\nℹ Log in as admin@hireorbitai.test with your seed password (default Passw0rd!2026).',
    );
  } else if (freshInit) {
    console.log('\nℹ db-bootstrap: SEED_DEV=false — schema created, no demo accounts seeded.');
  }

  console.log('\n✓ db-bootstrap complete.');
}

main().catch((err) => {
  console.error('✗ db-bootstrap failed:', err.message);
  process.exit(1);
});
