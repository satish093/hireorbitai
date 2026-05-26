/**
 * Production-safety guard: assert the built bundle contains NO development-only
 * code. The dev toolbar / test panel are reached only behind a
 * `import.meta.env.DEV` guard, which Vite statically evaluates to `false` in a
 * production build — so the dev chunk should be tree-shaken out entirely.
 *
 * This script fails the build if any dev marker string leaks into dist/, which
 * would mean the tree-shaking guard was bypassed (e.g. someone imported a dev
 * module from always-bundled code).
 *
 * Run AFTER a production build:  node scripts/check-dist-clean.mjs
 */

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const distDir = join(dirname(fileURLToPath(import.meta.url)), '..', 'dist');

// Strings that should only ever exist in dev-only modules.
const FORBIDDEN = ['DevToolbar', 'loginAsUser', '/auth/dev/', '/dev/integrations'];

function walk(dir) {
  const out = [];
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) out.push(...walk(p));
    else if (/\.(js|css|html)$/.test(name)) out.push(p);
  }
  return out;
}

let dist;
try {
  dist = walk(distDir);
} catch {
  console.error(`✗ dist/ not found at ${distDir}. Run \`npm run build\` first.`);
  process.exit(1);
}

const hits = [];
for (const file of dist) {
  const text = readFileSync(file, 'utf8');
  for (const marker of FORBIDDEN) {
    if (text.includes(marker)) hits.push(`${file} contains "${marker}"`);
  }
}

if (hits.length > 0) {
  console.error('✗ DEV code leaked into the production bundle:\n  ' + hits.join('\n  '));
  console.error(
    '\nDev-only code must be reached only behind an `import.meta.env.DEV` guard so Vite tree-shakes it.',
  );
  process.exit(1);
}

console.log(`✓ dist clean — no dev markers in ${dist.length} built files.`);
