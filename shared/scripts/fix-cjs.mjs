// After tsc emits ESM to dist/esm and CJS to dist/cjs, write a tiny
// package.json into each directory so Node's resolver doesn't confuse the
// two when called from a parent package that doesn't set `"type"`.
//
// Without this, Node treats `.js` files according to the nearest package.json,
// and our root shared/package.json doesn't set `"type"`, so dist/esm/*.js
// would be loaded as CJS — which fails because tsc emitted ESM `import`
// statements into them.

import { writeFileSync, mkdirSync } from 'node:fs';

mkdirSync('dist/esm', { recursive: true });
mkdirSync('dist/cjs', { recursive: true });

writeFileSync('dist/esm/package.json', JSON.stringify({ type: 'module' }, null, 2) + '\n');
writeFileSync('dist/cjs/package.json', JSON.stringify({ type: 'commonjs' }, null, 2) + '\n');

console.log('  ✓ wrote dist/esm/package.json and dist/cjs/package.json');
