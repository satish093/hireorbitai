#!/usr/bin/env node
// Run node-pg-migrate regardless of whether it was installed per-package
// (legacy `cd backend && npm install`) or hoisted to the workspace root
// (`npm install` at the repo root, which is the canonical layout). The
// hardcoded `node_modules/.bin/node-pg-migrate` path doesn't exist under
// workspaces because npm hoists binaries up.
//
// Usage (from backend/, via npm scripts):
//   node --env-file=.env scripts/migrate.mjs up    --migrations-dir migrations --migration-file-language sql
//   node --env-file=.env scripts/migrate.mjs down  --migrations-dir migrations --migration-file-language sql --count 1
//   node --env-file=.env scripts/migrate.mjs create my_change --migrations-dir migrations --migration-file-language sql
//
// All argv after `migrate.mjs` is forwarded to node-pg-migrate verbatim.

import { createRequire } from 'node:module';
import { spawnSync } from 'node:child_process';
import { dirname, resolve } from 'node:path';

const require = createRequire(import.meta.url);
// require.resolve walks up the directory tree the same way Node would for an
// import statement, so it finds the package whether it lives in this folder's
// node_modules or in the workspace root's node_modules.
const pkgJsonPath = require.resolve('node-pg-migrate/package.json');
const bin = resolve(dirname(pkgJsonPath), 'bin/node-pg-migrate');

const r = spawnSync(process.execPath, [bin, ...process.argv.slice(2)], {
  stdio: 'inherit',
});
process.exit(r.status ?? 1);
