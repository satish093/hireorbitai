#!/usr/bin/env node
/* eslint-disable no-console */
// =============================================================================
// MODE 1 — DEV RESET.  Wipes the DEVELOPMENT database to a clean schema and
// (optionally) reseeds demo data. Safe to re-run. Cross-platform (no psql
// required) — works from Windows PowerShell, macOS, or Linux.
//
// What it does:
//   1. Verifies the target really is a DEV database (hard refuses prod).
//   2. DROP SCHEMA public CASCADE; CREATE SCHEMA public;   (wipes everything)
//   3. Loads database/init.sql (full consolidated schema + reference data).
//   4. Applies any incremental migrations under backend/migrations/.
//   5. (--seed) runs the demo seed scripts.
//
// It does NOT touch production: it aborts if DATABASE_URL looks like prod, and
// aborts unless the URL clearly points at a dev target (neon.tech / hireorbit_dev
// / localhost) — override that last check with --force-unknown.
//
// Usage (reads DATABASE_URL from the environment or an --env-file):
//   node --env-file=backend/.env.development scripts/reset-dev.mjs --yes
//   node --env-file=backend/.env.development scripts/reset-dev.mjs --yes --seed
//   npm run db:reset:dev -- --yes --seed        (DATABASE_URL must be in env)
//
// Flags:
//   --yes            skip the interactive confirmation prompt
//   --seed           after rebuild, run backend demo seed scripts
//   --no-init        skip database/init.sql (schema via migrations only)
//   --force-unknown  allow a DATABASE_URL that doesn't match known dev hints
// =============================================================================

import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { createInterface } from 'node:readline/promises';
import { stdin, stdout } from 'node:process';
import pg from 'pg';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');
const args = new Set(process.argv.slice(2));

const url = process.env.DATABASE_URL;
if (!url) {
  console.error(
    '✗ DATABASE_URL is not set.\n' +
      '  Pass it via --env-file, e.g.:\n' +
      '    node --env-file=backend/.env.development scripts/reset-dev.mjs --yes',
  );
  process.exit(1);
}

const lower = url.toLowerCase();

// --- Safety: never, ever a prod DB -------------------------------------------
if (lower.includes('hireorbit_prod')) {
  console.error('✗ DATABASE_URL contains "hireorbit_prod". This script only resets DEV. Aborting.');
  process.exit(1);
}

// --- Safety: must look like a known dev target -------------------------------
const looksDev = ['neon.tech', 'hireorbit_dev', 'localhost', '127.0.0.1'].some((m) =>
  lower.includes(m),
);
if (!looksDev && !args.has('--force-unknown')) {
  console.error(
    '✗ DATABASE_URL does not look like a dev database (no neon.tech / hireorbit_dev /\n' +
      '  localhost). Refusing out of caution. If you are sure, pass --force-unknown.',
  );
  process.exit(1);
}

const redacted = url.replace(/\/\/([^:]+):[^@]+@/, '//$1:***@');

async function confirm() {
  if (args.has('--yes')) return true;
  const rl = createInterface({ input: stdin, output: stdout });
  const ans = await rl.question(
    `\nThis will WIPE and rebuild the dev database:\n  ${redacted}\n\nType "reset-dev" to continue: `,
  );
  rl.close();
  return ans.trim() === 'reset-dev';
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
  if (!(await confirm())) {
    console.log('Aborted — no changes made.');
    process.exit(0);
  }

  const client = new pg.Client({ connectionString: url, ssl });
  await client.connect();
  try {
    console.log('\n→ DROP SCHEMA public CASCADE; CREATE SCHEMA public;');
    await client.query('DROP SCHEMA IF EXISTS public CASCADE; CREATE SCHEMA public;');
    await client.query(
      'GRANT ALL ON SCHEMA public TO CURRENT_USER; GRANT ALL ON SCHEMA public TO public;',
    );

    if (!args.has('--no-init')) {
      const initPath = resolve(ROOT, 'database', 'init.sql');
      console.log(`→ loading ${initPath}`);
      const sql = readFileSync(initPath, 'utf8');
      // node-postgres simple query supports multiple ;-separated statements.
      await client.query(sql);
      console.log('  ✓ schema + reference data loaded');
    }
  } finally {
    await client.end();
  }

  // Incremental migrations (uses process.env.DATABASE_URL, no --env-file).
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

  if (args.has('--seed')) {
    run('seed: leadership', process.execPath, ['scripts/seed-leadership.mjs'], {
      cwd: resolve(ROOT, 'backend'),
    });
    run('seed: demo users', process.execPath, ['scripts/seed-users.mjs'], {
      cwd: resolve(ROOT, 'backend'),
    });
  }

  console.log('\n✓ dev reset complete.');
  console.log('  Next: redeploy dev (push to `dev`, or POST the Render deploy hooks).');
  if (!args.has('--seed')) {
    console.log('  Tip: re-run with --seed to load demo users, or bootstrap an admin:');
    console.log('       node --env-file=backend/.env scripts/bootstrap-admin.mjs');
  }
}

main().catch((err) => {
  console.error('✗ reset-dev failed:', err.message);
  process.exit(1);
});
