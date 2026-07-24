/**
 * Rasterise the app icons from the SVG sources in assets/source/.
 *
 *   node mobile/scripts/generate-icons.mjs
 *
 * The sources are derived from frontend/public/logo-mark.svg — the same mark the
 * website uses — so the app and the site stay visually identical. Re-run this
 * after editing anything in assets/source/.
 *
 * `sharp` is intentionally NOT a dependency of the mobile package: it is a
 * native module needed only at authoring time, and adding it to the app's
 * package.json would drag a build-time-only binary into every install. Install
 * it on demand:
 *
 *   npm install --no-save --no-workspaces sharp
 *
 * Outputs (all PNG, all committed so a fresh clone builds without running this):
 *
 *   icon.png              1024²  iOS + store. Full-bleed, opaque, no alpha —
 *                                App Store Connect REJECTS an icon with an
 *                                alpha channel, so it is flattened explicitly.
 *   adaptive-icon.png     1024²  Android foreground. Keeps transparency; the
 *                                background colour comes from app.json.
 *   splash-icon.png        512²  Splash mark, transparent.
 *   notification-icon.png   96²  Android status bar. Android renders this as a
 *                                SILHOUETTE — every non-transparent pixel is
 *                                painted one colour — so it is generated as a
 *                                white-on-transparent shape, not the gradient.
 *   favicon.png             48²  Expo web.
 */

import sharp from 'sharp';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const assets = join(here, '..', 'assets');
const source = join(assets, 'source');

/** Android tints the notification icon itself; only the alpha shape matters. */
const NOTIFICATION_SVG = `
<svg xmlns="http://www.w3.org/2000/svg" width="96" height="96" viewBox="0 0 1024 1024">
  <g transform="translate(512 512) scale(0.86) translate(-512 -512)" fill="none" stroke="#ffffff">
    <ellipse cx="512" cy="512" rx="352" ry="160"
             transform="rotate(-22 512 512)" stroke-width="46"/>
    <circle cx="512" cy="512" r="132" fill="#ffffff" stroke="none"/>
  </g>
</svg>`;

async function render(svgPath, outPath, size, { flatten = false } = {}) {
  const svg = await readFile(svgPath);
  let pipeline = sharp(svg, { density: 400 }).resize(size, size, {
    fit: 'contain',
    background: { r: 0, g: 0, b: 0, alpha: 0 },
  });
  if (flatten) {
    // iOS store icons must have NO alpha channel. Flattening onto the brand
    // navy also guarantees any sub-pixel edge blends into the mark, not black.
    pipeline = pipeline.flatten({ background: '#1e3a8a' });
  }
  const buf = await pipeline.png().toBuffer();
  await writeFile(outPath, buf);
  console.log(`  ✓ ${outPath.replace(assets, 'assets')}  ${size}×${size}`);
}

async function main() {
  await mkdir(assets, { recursive: true });
  console.log('Generating app icons from assets/source/…');

  await render(join(source, 'icon.svg'), join(assets, 'icon.png'), 1024, { flatten: true });
  await render(join(source, 'adaptive-foreground.svg'), join(assets, 'adaptive-icon.png'), 1024);
  await render(join(source, 'adaptive-foreground.svg'), join(assets, 'splash-icon.png'), 512);
  await render(join(source, 'icon.svg'), join(assets, 'favicon.png'), 48, { flatten: true });

  const notif = await sharp(Buffer.from(NOTIFICATION_SVG), { density: 400 })
    .resize(96, 96)
    .png()
    .toBuffer();
  await writeFile(join(assets, 'notification-icon.png'), notif);
  console.log('  ✓ assets/notification-icon.png  96×96');

  console.log('Done.');
}

main().catch((err) => {
  console.error('Icon generation failed:', err);
  process.exit(1);
});
