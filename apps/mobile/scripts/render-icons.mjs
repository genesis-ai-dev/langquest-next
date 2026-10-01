// Renders every app icon from assets/logo.svg (white bars and check on a
// transparent 100x100 box). Run from the repo root after changing the logo:
//   node apps/mobile/scripts/render-icons.mjs
import { chromium } from 'playwright';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const assets = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'assets');
const inner = readFileSync(path.join(assets, 'logo.svg'), 'utf8').replace(/^[\s\S]*?<svg[^>]*>|<\/svg>\s*$/g, '');

/** The mark on a square `size` px wide: `scale` of the canvas, on `bg` (none = transparent) with corner `radius`. */
function svg({ size, scale = 1, bg, radius = 0, fill = '#fff' }) {
  const off = (100 - 100 * scale) / 2;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 100 100">` +
    (bg ? `<rect width="100" height="100" rx="${radius}" fill="${bg}"/>` : '') +
    `<g transform="translate(${off} ${off}) scale(${scale})" style="color:${fill}">${inner.replaceAll('#fff', fill)}</g></svg>`;
}

// Android's adaptive mask keeps a 66/108 circle; 78% of the canvas keeps the mark inside it.
const ADAPTIVE = 0.78;
const outputs = [
  ['icon.png', svg({ size: 1024, bg: '#000' })],
  ['android-icon-foreground.png', svg({ size: 512, scale: ADAPTIVE })],
  ['android-icon-background.png', svg({ size: 512, bg: '#000', scale: 0 })],
  ['android-icon-monochrome.png', svg({ size: 432, scale: ADAPTIVE })],
  ['splash-icon.png', svg({ size: 1024, bg: '#000', radius: 22, scale: 0.9 })],
  ['favicon.png', svg({ size: 48, bg: '#000', radius: 22 })]
];

const browser = await chromium.launch();
const page = await browser.newPage();
for (const [file, markup] of outputs) {
  const size = Number(/width="(\d+)"/.exec(markup)[1]);
  await page.setViewportSize({ width: size, height: size });
  await page.setContent(`<style>html,body{margin:0;background:transparent}svg{display:block}</style>${markup}`);
  await page.screenshot({ path: path.join(assets, file), omitBackground: true });
  console.log('wrote', file);
}
await browser.close();
